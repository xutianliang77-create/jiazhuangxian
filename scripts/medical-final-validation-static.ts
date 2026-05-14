import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { runMedicalAgentWorkerOnceAsync, type MedicalAgentWorkerResult } from "../src/medical/agentWorker";
import {
  MedicalCaseRepo,
  type MeasurementRecord,
  type ModelJobRecord,
  type ReportRecord,
  type StudyBundle,
  type StudyRecord,
  type TiradsResultRecord,
} from "../src/medical/storage";
import { openDataDb } from "../src/storage/db";

type JsonObject = Record<string, unknown>;

interface StaticImageSpec {
  image_id: string;
  path: string;
  annotation_path?: string;
  review_overlay_path?: string;
  bbox_xyxy?: number[];
  class_label?: string;
  source_relative_path?: string;
  sha256?: string;
  width?: number;
  height?: number;
}

interface UltrasoundLabelSpec {
  target_nodule_size_mm?: {
    long_axis?: number | null;
    short_axis?: number | null;
    ap_axis?: number | null;
  };
  target_nodule_features?: string[];
  tirads_reported?: string;
}

interface CaseManifest {
  case_id: string;
  dataset_id?: string;
  source_root?: string;
  source_type?: string;
  workspace_path?: string;
  clinical_labels?: {
    ultrasound_report?: UltrasoundLabelSpec;
    pathology?: JsonObject;
  };
  static_images?: StaticImageSpec[];
}

interface CliArgs {
  caseRoot: string;
  caseJson: string;
  artifactRoot: string;
  dataDb: string;
  ragDb?: string;
  workspace: string;
  remoteModelGatewayUrl?: string;
  imageWorkerUrl?: string;
  workerId: string;
  intervalMs: number;
  maxSteps: number;
  detectorModel: string;
  detectorModelVersion: string;
  segmenterModel: string;
  segmenterModelVersion: string;
  measureModel: string;
  measureModelVersion: string;
  allowBBoxFallback: boolean;
  prepareOnly: boolean;
  imageIds: string[];
  reportOutputDir?: string;
  datasetRoot?: string;
  datasetManifest?: string;
  datasetId?: string;
  maxImages?: number;
  perClassLimit?: number;
  pipelineMode: "full_case" | "image_model_smoke";
}

interface StaticRunSummary {
  imageId: string;
  artifactUri: string;
  localStagedPath: string;
  remoteUpload?: {
    artifactUri: string;
    sizeBytes: number;
    sha256: string;
  };
  studyId?: string;
  imageRecordId?: string;
  sessionId?: string;
  taskEvents: Array<Record<string, unknown>>;
  injectedTiradsFeatureId?: string;
  detection?: {
    bbox: unknown;
    confidence: number | null;
    iouVsAnnotation: number | null;
  };
  measurement?: {
    longAxisMm: number | null;
    shortAxisMm: number | null;
    apAxisMm: number | null;
    areaMm2: number | null;
    aspectRatio: number | null;
    measurementSource: string;
  };
  tirads?: {
    category: string | null;
    score: number | null;
    recommendation: string | null;
    reportedByCase: string | null;
  };
  report?: {
    id: string;
    status: string;
    evidenceSources: string[];
  };
  safetyReview?: {
    status: string | null;
    action: string | null;
  };
  modelArtifacts?: Array<{
    jobType: string;
    modelName: string | null;
    status: string;
    artifactUri: string | null;
    nestedArtifacts: Record<string, string>;
  }>;
  datasetLabel?: string;
  sourceRelativePath?: string;
  note?: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manifest = loadInputManifest(args);
  const selectedImages = selectStaticImages(manifest, args.imageIds);
  const timestamp = timestampLabel(new Date());
  const reportOutputDir = path.resolve(
    args.reportOutputDir ?? path.join(args.artifactRoot, "reports", manifest.case_id, `static-e2e-${timestamp}`)
  );
  mkdirSync(reportOutputDir, { recursive: true });

  const handle = openDataDb({ path: args.dataDb, singleton: false });
  const repo = new MedicalCaseRepo(handle.db);
  let validationRunId: string | null = null;
  try {
    const validationRun = repo.createFinalValidationRun({
      datasetId: manifest.dataset_id ?? manifest.case_id,
      datasetRoot: args.datasetRoot ?? args.caseRoot,
      datasetManifestUri: args.datasetManifest ?? args.caseJson,
      caseId: manifest.case_id,
      pipelineMode: args.pipelineMode,
      status: "running",
      remoteModelGatewayUrl: args.remoteModelGatewayUrl ?? null,
      dataDbPath: args.dataDb,
      ragDbPath: args.ragDb ?? null,
      summary: {
        selected_image_count: selectedImages.length,
        prepare_only: args.prepareOnly,
        source_type: manifest.source_type ?? null,
      },
      createdBy: "medical-final-validation-static",
    });
    validationRunId = validationRun.id;
    const patient = repo.upsertPatient({
      externalPatientId: `FV-${manifest.case_id}`,
      meta: {
        case_id: manifest.case_id,
        source_type: "final_validation_case_manifest",
      },
    });

    const summaries: StaticRunSummary[] = [];
    for (const image of selectedImages) {
      const staged = stageStaticImage(args, manifest, image);
      const remoteUpload = args.remoteModelGatewayUrl
        ? await uploadArtifactToRemote(args.remoteModelGatewayUrl, staged.artifactUri, staged.localStagedPath)
        : undefined;

      if (args.prepareOnly) {
        const summary: StaticRunSummary = {
          imageId: image.image_id,
          artifactUri: staged.artifactUri,
          localStagedPath: staged.localStagedPath,
          remoteUpload,
          taskEvents: [],
          datasetLabel: image.class_label,
          sourceRelativePath: image.source_relative_path ?? image.path,
          note: image.bbox_xyxy
            ? undefined
            : "no bbox/mask ground truth; detection and segmentation metrics are smoke-only for this image",
        };
        summaries.push(summary);
        persistStaticRunSummary(repo, validationRun.id, summary, "prepared");
        continue;
      }

      const study = repo.createStudy({
        patientId: patient.id,
        accessionNo: `${manifest.case_id}-${validationRun.id}-${image.image_id}`,
        sourceType: "final_validation",
        clinicalContext: "static_image_gpu_e2e_final_validation",
        createdBy: "medical-final-validation-static",
      });
      const imageRecord = repo.addImage({
        studyId: study.id,
        fileUri: staged.artifactUri,
        modelReadyUri: staged.artifactUri,
        fileType: path.extname(staged.localStagedPath).replace(/^\./, "") || "png",
        checksumSha256: sha256File(staged.localStagedPath),
      });
      const analysis = createStaticValidationAnalysisSession(repo, study, imageRecord, args);
      const summary = await runStaticStudyE2E(repo, study, image, manifest, args, staged, remoteUpload, analysis);
      summaries.push(summary);
      persistStaticRunSummary(repo, validationRun.id, summary, "succeeded");
    }

    const output = {
      case_id: manifest.case_id,
      dataset_id: manifest.dataset_id ?? null,
      source_type: manifest.source_type ?? null,
      generated_at: new Date().toISOString(),
      data_db: args.dataDb,
      rag_db: args.ragDb ?? null,
      remote_model_gateway_url: args.remoteModelGatewayUrl ?? null,
      pipeline_mode: args.pipelineMode,
      prepare_only: args.prepareOnly,
      runs: summaries,
    };
    const jsonPath = path.join(reportOutputDir, "summary.json");
    const markdownPath = path.join(reportOutputDir, "SUMMARY.md");
    writeFileSync(jsonPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    writeFileSync(markdownPath, renderSummaryMarkdown(output), "utf8");
    repo.updateFinalValidationRun(validationRun.id, {
      status: "succeeded",
      reportJsonUri: artifactOrFileUri(args.artifactRoot, jsonPath),
      reportMarkdownUri: artifactOrFileUri(args.artifactRoot, markdownPath),
      summary: finalValidationRunSummary(output),
      completedAt: Date.now(),
    });
    console.log(JSON.stringify({ status: "ok", validation_run_id: validationRun.id, output_json: jsonPath, output_markdown: markdownPath }, null, 2));
  } catch (error) {
    if (validationRunId) {
      repo.updateFinalValidationRun(validationRunId, {
        status: "failed",
        summary: { error: error instanceof Error ? error.message : String(error) },
        completedAt: Date.now(),
      });
    }
    throw error;
  } finally {
    handle.close();
  }
}

function parseArgs(argv: string[]): CliArgs {
  const defaultCaseRoot = path.resolve("data/artifacts/datasets/final-validation-local-thyroid-case-001");
  const parsed: CliArgs = {
    caseRoot: defaultCaseRoot,
    caseJson: path.join(defaultCaseRoot, "metadata", "case.json"),
    artifactRoot: path.resolve(process.env.JZX_ARTIFACT_ROOT ?? "data/artifacts"),
    dataDb: path.resolve(process.env.JZX_DATA_DB ?? path.join("data", "artifacts", "final-validation-static", "data.db")),
    ragDb: process.env.JZX_RAG_DB ? path.resolve(process.env.JZX_RAG_DB) : undefined,
    workspace: path.resolve(process.env.JZX_WORKSPACE ?? process.cwd()),
    remoteModelGatewayUrl: process.env.JZX_REMOTE_MODEL_GATEWAY_URL?.trim() || undefined,
    imageWorkerUrl: process.env.JZX_IMAGE_WORKER_URL?.trim() || undefined,
    workerId: process.env.JZX_MEDICAL_AGENT_WORKER_ID?.trim() || "medical-final-validation-static",
    intervalMs: positiveIntValue(process.env.JZX_MEDICAL_AGENT_WORKER_INTERVAL_MS, 1200),
    maxSteps: positiveIntValue(process.env.JZX_MEDICAL_AGENT_MAX_STEPS, 60),
    detectorModel: process.env.JZX_FINAL_VALIDATION_DETECTOR_MODEL?.trim() || "rf-detr-medium-thyroid-detector",
    detectorModelVersion: process.env.JZX_FINAL_VALIDATION_DETECTOR_MODEL_VERSION?.trim() || "final-validation",
    segmenterModel: process.env.JZX_FINAL_VALIDATION_SEGMENTER_MODEL?.trim() || "nnunet-tight-roi-segmenter",
    segmenterModelVersion: process.env.JZX_FINAL_VALIDATION_SEGMENTER_MODEL_VERSION?.trim() || "final-validation",
    measureModel: process.env.JZX_FINAL_VALIDATION_MEASURE_MODEL?.trim() || "mask-measurement-worker",
    measureModelVersion: process.env.JZX_FINAL_VALIDATION_MEASURE_MODEL_VERSION?.trim() || "final-validation",
    allowBBoxFallback: process.env.JZX_FINAL_VALIDATION_ALLOW_BBOX_FALLBACK === "1",
    prepareOnly: false,
    imageIds: [],
    pipelineMode: "full_case",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--case-root") {
      parsed.caseRoot = path.resolve(requireValue(arg, next));
      index += 1;
    } else if (arg === "--case-json") {
      parsed.caseJson = path.resolve(requireValue(arg, next));
      index += 1;
    } else if (arg === "--artifact-root") {
      parsed.artifactRoot = path.resolve(requireValue(arg, next));
      index += 1;
    } else if (arg === "--data-db") {
      parsed.dataDb = path.resolve(requireValue(arg, next));
      index += 1;
    } else if (arg === "--rag-db") {
      parsed.ragDb = path.resolve(requireValue(arg, next));
      index += 1;
    } else if (arg === "--workspace") {
      parsed.workspace = path.resolve(requireValue(arg, next));
      index += 1;
    } else if (arg === "--remote-model-gateway-url") {
      parsed.remoteModelGatewayUrl = requireValue(arg, next);
      index += 1;
    } else if (arg === "--image-worker-url") {
      parsed.imageWorkerUrl = requireValue(arg, next);
      index += 1;
    } else if (arg === "--worker-id") {
      parsed.workerId = requireValue(arg, next);
      index += 1;
    } else if (arg === "--interval-ms") {
      parsed.intervalMs = positiveInt(arg, next);
      index += 1;
    } else if (arg === "--max-steps") {
      parsed.maxSteps = positiveInt(arg, next);
      index += 1;
    } else if (arg === "--detector-model") {
      parsed.detectorModel = requireValue(arg, next);
      index += 1;
    } else if (arg === "--detector-model-version") {
      parsed.detectorModelVersion = requireValue(arg, next);
      index += 1;
    } else if (arg === "--segmenter-model") {
      parsed.segmenterModel = requireValue(arg, next);
      index += 1;
    } else if (arg === "--segmenter-model-version") {
      parsed.segmenterModelVersion = requireValue(arg, next);
      index += 1;
    } else if (arg === "--measure-model") {
      parsed.measureModel = requireValue(arg, next);
      index += 1;
    } else if (arg === "--measure-model-version") {
      parsed.measureModelVersion = requireValue(arg, next);
      index += 1;
    } else if (arg === "--allow-bbox-fallback") {
      parsed.allowBBoxFallback = true;
    } else if (arg === "--prepare-only") {
      parsed.prepareOnly = true;
    } else if (arg === "--image-id") {
      parsed.imageIds.push(requireValue(arg, next));
      index += 1;
    } else if (arg === "--report-output-dir") {
      parsed.reportOutputDir = path.resolve(requireValue(arg, next));
      index += 1;
    } else if (arg === "--dataset-root") {
      parsed.datasetRoot = path.resolve(requireValue(arg, next));
      parsed.pipelineMode = "image_model_smoke";
      index += 1;
    } else if (arg === "--dataset-manifest") {
      parsed.datasetManifest = path.resolve(requireValue(arg, next));
      index += 1;
    } else if (arg === "--dataset-id") {
      parsed.datasetId = requireValue(arg, next);
      index += 1;
    } else if (arg === "--max-images") {
      parsed.maxImages = positiveInt(arg, next);
      index += 1;
    } else if (arg === "--per-class-limit") {
      parsed.perClassLimit = positiveInt(arg, next);
      index += 1;
    } else if (arg === "--pipeline-mode") {
      const value = requireValue(arg, next);
      if (value !== "full_case" && value !== "image_model_smoke") {
        throw new Error("--pipeline-mode must be full_case or image_model_smoke");
      }
      parsed.pipelineMode = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (parsed.datasetRoot && !parsed.datasetManifest) {
    parsed.datasetManifest = path.join(parsed.datasetRoot, "metadata", "file_manifest.csv");
  }
  if (argv.includes("--case-root") && !argv.includes("--case-json")) {
    parsed.caseJson = path.join(parsed.caseRoot, "metadata", "case.json");
  }
  return parsed;
}

function loadInputManifest(args: CliArgs): CaseManifest {
  if (args.datasetRoot) return loadFangDaiDatasetManifest(args);
  return loadCaseManifest(args.caseJson);
}

function loadCaseManifest(caseJsonPath: string): CaseManifest {
  const raw = JSON.parse(readFileSync(caseJsonPath, "utf8")) as Partial<CaseManifest>;
  if (!raw.case_id) throw new Error(`case_id missing in ${caseJsonPath}`);
  return {
    case_id: raw.case_id,
    dataset_id: raw.dataset_id,
    source_root: raw.source_root,
    source_type: raw.source_type,
    workspace_path: raw.workspace_path,
    clinical_labels: raw.clinical_labels,
    static_images: raw.static_images ?? [],
  };
}

function loadFangDaiDatasetManifest(args: CliArgs): CaseManifest {
  const datasetRoot = args.datasetRoot;
  if (!datasetRoot) throw new Error("datasetRoot is required");
  const manifestPath = args.datasetManifest ?? path.join(datasetRoot, "metadata", "file_manifest.csv");
  if (!existsSync(manifestPath)) throw new Error(`dataset manifest not found: ${manifestPath}`);
  const rows = parseCsv(readFileSync(manifestPath, "utf8"));
  const selectedRows = limitDatasetRows(rows, args);
  return {
    case_id: args.datasetId ?? "fangdai-thyroid-ultrasound-images",
    dataset_id: args.datasetId ?? "fangdai-thyroid-ultrasound-images",
    source_root: path.join(datasetRoot, "raw"),
    source_type: "class_folder_external_final_validation",
    static_images: selectedRows.map((row) => {
      const relativePath = requiredCsvValue(row, "relative_path");
      const classLabel = requiredCsvValue(row, "class");
      return {
        image_id: stableImageId(classLabel, relativePath),
        path: relativePath,
        class_label: classLabel,
        source_relative_path: relativePath,
        sha256: row.sha256,
        width: optionalCsvNumber(row.width),
        height: optionalCsvNumber(row.height),
      };
    }),
  };
}

function parseCsv(raw: string): Array<Record<string, string>> {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function limitDatasetRows(rows: Array<Record<string, string>>, args: CliArgs): Array<Record<string, string>> {
  let selected = rows.filter((row) => requiredCsvValue(row, "relative_path").length > 0);
  if (args.perClassLimit) {
    const counts = new Map<string, number>();
    selected = selected.filter((row) => {
      const label = requiredCsvValue(row, "class");
      const count = counts.get(label) ?? 0;
      if (count >= args.perClassLimit!) return false;
      counts.set(label, count + 1);
      return true;
    });
  }
  if (args.maxImages) selected = selected.slice(0, args.maxImages);
  return selected;
}

function requiredCsvValue(row: Record<string, string>, key: string): string {
  return (row[key] ?? "").trim();
}

function optionalCsvNumber(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stableImageId(classLabel: string, relativePath: string): string {
  const baseName = path.basename(relativePath, path.extname(relativePath));
  const safeBase = baseName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 64);
  const digest = createHash("sha1").update(relativePath).digest("hex").slice(0, 8);
  return `${classLabel}-${safeBase}-${digest}`;
}

function selectStaticImages(manifest: CaseManifest, requestedIds: string[]): StaticImageSpec[] {
  const images = manifest.static_images ?? [];
  if (images.length === 0) throw new Error(`no static_images in case manifest: ${manifest.case_id}`);
  if (requestedIds.length === 0) return images;
  const byId = new Map(images.map((image) => [image.image_id, image]));
  return requestedIds.map((id) => {
    const image = byId.get(id);
    if (!image) throw new Error(`image_id not found in case manifest: ${id}`);
    return image;
  });
}

function stageStaticImage(
  args: CliArgs,
  manifest: CaseManifest,
  image: StaticImageSpec
): { artifactUri: string; localStagedPath: string } {
  const sourcePath = path.resolve(manifest.source_root ?? args.caseRoot, image.path);
  if (!existsSync(sourcePath)) throw new Error(`static image not found: ${sourcePath}`);
  const ext = path.extname(sourcePath) || ".png";
  const relative = path.join("model-ready", "final-validation", manifest.case_id, `${image.image_id}${ext}`).replace(/\\/g, "/");
  const stagedPath = path.join(args.artifactRoot, relative);
  mkdirSync(path.dirname(stagedPath), { recursive: true });
  copyFileSync(sourcePath, stagedPath);
  return {
    artifactUri: `artifact://${relative}`,
    localStagedPath: stagedPath,
  };
}

async function uploadArtifactToRemote(
  gatewayUrl: string,
  artifactUri: string,
  localPath: string
): Promise<{ artifactUri: string; sizeBytes: number; sha256: string }> {
  const body = readFileSync(localPath);
  const response = await fetch(`${gatewayUrl.replace(/\/+$/, "")}/model/v1/artifacts/upload?uri=${encodeURIComponent(artifactUri)}`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(body.length),
    },
    body,
  });
  const payload = await response.json().catch(() => null) as { status?: string; result?: Record<string, unknown>; error?: { message?: string } } | null;
  if (!response.ok || payload?.status !== "ok" || !payload.result) {
    throw new Error(payload?.error?.message ?? `remote artifact upload failed: HTTP ${response.status}`);
  }
  return {
    artifactUri: String(payload.result.artifact_uri ?? artifactUri),
    sizeBytes: Number(payload.result.size_bytes ?? body.length),
    sha256: String(payload.result.sha256 ?? sha256Bytes(body)),
  };
}

function createStaticValidationAnalysisSession(
  repo: MedicalCaseRepo,
  study: StudyRecord,
  imageRecord: { id: string },
  args: CliArgs
): { sessionId: string; taskIds: string[] } {
  const now = Date.now();
  const session = repo.createAnalysisSession({
    studyId: study.id,
    status: "queued",
    triggerSource: "final_validation_static",
    createdBy: "medical-final-validation-static",
    summary: {
      selected_image_id: imageRecord.id,
      source: "final_validation_static",
      strict_real_inference: !args.allowBBoxFallback,
    },
    now,
  });
  const tasks = [
    { agentName: "ImageQcAgent", taskType: "image_qc", input: {} },
    { agentName: "NoduleDetectionAgent", taskType: "detect_nodules", input: { model: args.detectorModel, model_version: args.detectorModelVersion } },
    { agentName: "SegmentationAgent", taskType: "segment_nodules", input: { model: args.segmenterModel, model_version: args.segmenterModelVersion, allow_bbox_fallback: args.allowBBoxFallback } },
    { agentName: "MeasurementAgent", taskType: "measure_nodules", input: { model: args.measureModel, model_version: args.measureModelVersion } },
  ];
  if (args.pipelineMode === "full_case") {
    tasks.push(
      { agentName: "TiradsFeatureAgent", taskType: "classify_tirads_features", input: {} },
      { agentName: "TiradsRuleAgent", taskType: "calculate_tirads", input: {} },
      { agentName: "ReportDraftAgent", taskType: "draft_report", input: {} },
      { agentName: "SafetyReviewAgent", taskType: "safety_review", input: {} }
    );
  }

  let parentTaskId: string | undefined;
  const createdIds: string[] = [];
  for (const [index, task] of tasks.entries()) {
    const created = repo.createAgentTask({
      analysisSessionId: session.id,
      parentTaskId,
      agentName: task.agentName,
      taskType: task.taskType,
      status: "queued",
      input: {
        study_id: study.id,
        image_id: imageRecord.id,
        sequence: index + 1,
        tool_name: task.taskType,
        ...task.input,
      },
      now: now + index,
    });
    parentTaskId = created.id;
    createdIds.push(created.id);
  }
  return { sessionId: session.id, taskIds: createdIds };
}

async function runStaticStudyE2E(
  repo: MedicalCaseRepo,
  study: StudyRecord,
  image: StaticImageSpec,
  manifest: CaseManifest,
  args: CliArgs,
  staged: { artifactUri: string; localStagedPath: string },
  remoteUpload: { artifactUri: string; sizeBytes: number; sha256: string } | undefined,
  analysis: { sessionId: string; taskIds: string[] }
): Promise<StaticRunSummary> {
  const taskEvents: Array<Record<string, unknown>> = [];
  let injectedTiradsFeatureId: string | undefined;

  for (let step = 0; step < args.maxSteps; step += 1) {
    const result = await runMedicalAgentWorkerOnceAsync(repo, {
      workerId: args.workerId,
      imageWorkerUrl: args.imageWorkerUrl,
      remoteModelGatewayUrl: args.remoteModelGatewayUrl,
      dataDbPath: args.dataDb,
      ragDbPath: args.ragDb,
      workspace: args.workspace,
      knowledgeTopK: 3,
    });
    taskEvents.push(normalizeWorkerResult(result));
    if (result.status === "failed") {
      throw new Error(`static validation worker failed for ${study.id}: ${JSON.stringify(result.error ?? {})}`);
    }
    if (result.status === "waiting_doctor_input") {
      if (!injectedTiradsFeatureId) {
        if (!manifest.clinical_labels?.ultrasound_report) {
          throw new Error(
            `study ${study.id} requires doctor TI-RADS input, but the selected dataset has no TI-RADS ground-truth labels`
          );
        }
        injectedTiradsFeatureId = injectConfirmedTiradsFeature(repo, study.id, manifest);
        taskEvents.push({
          status: "injected_confirmed_tirads_feature",
          study_id: study.id,
          tirads_feature_id: injectedTiradsFeatureId,
        });
      }
      await sleep(args.intervalMs);
      continue;
    }
    if (result.status === "waiting_model") {
      await sleep(args.intervalMs);
      continue;
    }
    if (result.status === "idle") {
      if (countWaitingModelTasks(repo) > 0 || hasQueuedRunnableTasks(repo, study.id)) {
        await sleep(args.intervalMs);
        continue;
      }
      break;
    }
  }

  const bundle = repo.getStudyBundle(study.id);
  if (!bundle) throw new Error(`study bundle missing after static E2E: ${study.id}`);
  return buildStaticRunSummary(bundle, image, staged, remoteUpload, taskEvents, injectedTiradsFeatureId, manifest);
}

function injectConfirmedTiradsFeature(repo: MedicalCaseRepo, studyId: string, manifest: CaseManifest): string {
  const bundle = repo.getStudyBundle(studyId);
  if (!bundle || bundle.nodules.length === 0) {
    throw new Error(`cannot inject TI-RADS feature without detected nodule: ${studyId}`);
  }
  const nodule = bundle.nodules[0];
  const featureSpec = manifest.clinical_labels?.ultrasound_report;
  const features = caseFeaturePayload(featureSpec);
  const feature = repo.createTiradsFeature({
    noduleId: nodule.id,
    systemName: "ACR_TI_RADS",
    features,
    confidence: {
      source: "final_validation_case_manifest",
      doctor_confirmation_required: false,
    },
    sourceModel: "final_validation_case_manifest",
    requiresReview: false,
  });
  repo.createAuditLog({
    studyId,
    actorType: "agent",
    actorId: "medical-final-validation-static",
    action: "medical.static_validation.inject_tirads_features",
    targetType: "nodule",
    targetId: nodule.id,
    detail: {
      tirads_feature_id: feature.id,
      features: feature.features,
      source_case_id: manifest.case_id,
    },
    traceId: feature.id,
  });
  return feature.id;
}

function caseFeaturePayload(spec: UltrasoundLabelSpec | undefined): JsonObject {
  const features: JsonObject = {
    composition: "solid",
    echogenicity: "hypoechoic",
    shape: "taller_than_wide",
    margin: "ill_defined",
    echogenic_foci: ["punctate_echogenic_foci"],
  };
  const target = spec?.target_nodule_features ?? [];
  if (target.includes("solid")) features.composition = "solid";
  if (target.includes("hypoechoic")) features.echogenicity = "hypoechoic";
  if (target.includes("very_hypoechoic")) features.echogenicity = "very_hypoechoic";
  if (target.includes("taller_than_wide_on_some_planes")) features.shape = "taller_than_wide";
  if (target.includes("wider_than_tall")) features.shape = "wider_than_tall";
  if (target.includes("smooth_margin")) features.margin = "smooth";
  if (target.includes("ill_defined_margin")) features.margin = "ill_defined";
  if (target.includes("irregular_margin")) features.margin = "irregular";
  if (target.includes("punctate_echogenic_foci")) features.echogenic_foci = ["punctate_echogenic_foci"];
  if (target.includes("macrocalcifications")) features.echogenic_foci = ["macrocalcifications"];
  const size = spec?.target_nodule_size_mm;
  if (size && (size.long_axis || size.short_axis || size.ap_axis)) {
    features.size_mm = {
      long_axis: size.long_axis ?? undefined,
      short_axis: size.short_axis ?? undefined,
      ap_axis: size.ap_axis ?? undefined,
    };
  }
  return features;
}

function buildStaticRunSummary(
  bundle: StudyBundle,
  image: StaticImageSpec,
  staged: { artifactUri: string; localStagedPath: string },
  remoteUpload: { artifactUri: string; sizeBytes: number; sha256: string } | undefined,
  taskEvents: Array<Record<string, unknown>>,
  injectedTiradsFeatureId: string | undefined,
  manifest: CaseManifest
): StaticRunSummary {
  const nodule = bundle.nodules[0] ?? null;
  const measurement = latestMeasurementForNodule(bundle.measurements, nodule?.id ?? null);
  const tirads = latestTiradsForNodule(bundle.tiradsResults, nodule?.id ?? null);
  const report = bundle.reports.at(-1) ?? null;
  const safety = bundle.auditLogs.filter((audit) => audit.action === "medical.safety_review").at(-1) ?? null;
  return {
    imageId: image.image_id,
    artifactUri: staged.artifactUri,
    localStagedPath: staged.localStagedPath,
    remoteUpload,
    studyId: bundle.study.id,
    imageRecordId: bundle.images[0]?.id,
    sessionId: bundle.analysisSessions[0]?.id,
    taskEvents,
    injectedTiradsFeatureId,
    datasetLabel: image.class_label,
    sourceRelativePath: image.source_relative_path ?? image.path,
    note: image.bbox_xyxy
      ? undefined
      : "no bbox/mask ground truth; detection and segmentation metrics are smoke-only for this image",
    detection: nodule
      ? {
          bbox: nodule.bbox,
          confidence: nodule.detectionConfidence,
          iouVsAnnotation: image.bbox_xyxy ? bboxIoU(nodule.bbox, image.bbox_xyxy) : null,
        }
      : undefined,
    measurement: measurement
      ? {
          longAxisMm: measurement.longAxisMm,
          shortAxisMm: measurement.shortAxisMm,
          apAxisMm: measurement.apAxisMm,
          areaMm2: measurement.areaMm2,
          aspectRatio: measurement.aspectRatio,
          measurementSource: measurement.measurementSource,
        }
      : undefined,
    tirads: tirads
      ? {
          category: tirads.category,
          score: tirads.score,
          recommendation: tirads.recommendation,
          reportedByCase: manifest.clinical_labels?.ultrasound_report?.tirads_reported ?? null,
        }
      : undefined,
    report: report
      ? {
          id: report.id,
          status: report.status,
          evidenceSources: reportEvidenceSources(report),
        }
      : undefined,
    safetyReview: safety
      ? {
          status: stringValue(safety.detail.safety_status),
          action: safety.action,
        }
      : undefined,
    modelArtifacts: modelArtifactSummaries(bundle.modelJobs),
  };
}

function persistStaticRunSummary(
  repo: MedicalCaseRepo,
  runId: string,
  summary: StaticRunSummary,
  status: string
): void {
  repo.upsertFinalValidationImageResult({
    runId,
    studyId: summary.studyId ?? null,
    imageId: summary.imageRecordId ?? null,
    analysisSessionId: summary.sessionId ?? null,
    datasetImageId: summary.imageId,
    datasetLabel: summary.datasetLabel ?? null,
    sourceRelativePath: summary.sourceRelativePath ?? null,
    artifactUri: summary.artifactUri,
    localStagedPath: summary.localStagedPath,
    remoteUpload: recordOrEmpty(summary.remoteUpload),
    expected: {
      dataset_label: summary.datasetLabel ?? null,
      source_relative_path: summary.sourceRelativePath ?? null,
    },
    detection: recordOrEmpty(summary.detection),
    measurement: recordOrEmpty(summary.measurement),
    tirads: recordOrEmpty(summary.tirads),
    report: recordOrEmpty(summary.report),
    safetyReview: recordOrEmpty(summary.safetyReview),
    modelArtifacts: summary.modelArtifacts ?? [],
    taskEvents: summary.taskEvents,
    note: summary.note ?? null,
    status,
    reviewStatus: "unreviewed",
    completedAt: Date.now(),
  });
}

function latestMeasurementForNodule(measurements: MeasurementRecord[], noduleId: string | null): MeasurementRecord | null {
  if (!noduleId) return null;
  return measurements.filter((measurement) => measurement.noduleId === noduleId).at(-1) ?? null;
}

function latestTiradsForNodule(results: TiradsResultRecord[], noduleId: string | null): TiradsResultRecord | null {
  if (!noduleId) return null;
  return results.filter((result) => result.noduleId === noduleId).at(-1) ?? null;
}

function normalizeWorkerResult(result: MedicalAgentWorkerResult): Record<string, unknown> {
  return {
    status: result.status,
    claimed: result.claimed,
    task_id: result.taskId ?? null,
    task_type: result.taskType ?? null,
    model_job_id: result.modelJobId ?? null,
    error: result.error ?? null,
  };
}

function countWaitingModelTasks(repo: MedicalCaseRepo): number {
  return repo.listWaitingModelAgentTasks().length;
}

function hasQueuedRunnableTasks(repo: MedicalCaseRepo, studyId: string): boolean {
  const bundle = repo.getStudyBundle(studyId);
  if (!bundle) return false;
  const taskById = new Map(bundle.agentTasks.map((task) => [task.id, task]));
  return bundle.agentTasks.some((task) => {
    if (task.status !== "queued") return false;
    if (!task.parentTaskId) return true;
    return taskById.get(task.parentTaskId)?.status === "succeeded";
  });
}

function reportEvidenceSources(report: ReportRecord): string[] {
  const sources = new Set<string>();
  for (const item of report.evidence) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const source = (item as JsonObject).source;
    if (typeof source === "string" && source.length > 0) sources.add(source);
  }
  return [...sources];
}

function modelArtifactSummaries(modelJobs: ModelJobRecord[]): NonNullable<StaticRunSummary["modelArtifacts"]> {
  return modelJobs
    .filter((job) => job.status === "succeeded" || job.artifactUri)
    .map((job) => ({
      jobType: job.jobType,
      modelName: job.modelName,
      status: job.status,
      artifactUri: job.artifactUri,
      nestedArtifacts: nestedArtifactUris(job.output),
    }));
}

function nestedArtifactUris(output: JsonObject | null): Record<string, string> {
  const artifacts = output?.artifacts;
  if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts)) return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(artifacts as JsonObject)) {
    if (typeof value === "string" && value.startsWith("artifact://")) result[key] = value;
  }
  return result;
}

function finalValidationRunSummary(output: {
  runs: StaticRunSummary[];
  prepare_only: boolean;
  pipeline_mode?: string;
  remote_model_gateway_url: string | null;
}): JsonObject {
  const statusCounts: Record<string, number> = {};
  const labelCounts: Record<string, number> = {};
  for (const run of output.runs) {
    const status = run.taskEvents.some((event) => event.error) ? "has_error_event" : "completed";
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    if (run.datasetLabel) labelCounts[run.datasetLabel] = (labelCounts[run.datasetLabel] ?? 0) + 1;
  }
  return {
    total_images: output.runs.length,
    prepare_only: output.prepare_only,
    pipeline_mode: output.pipeline_mode ?? null,
    remote_model_gateway_url: output.remote_model_gateway_url,
    status_counts: statusCounts,
    label_counts: labelCounts,
  };
}

function artifactOrFileUri(artifactRoot: string, filePath: string): string {
  const relative = path.relative(path.resolve(artifactRoot), path.resolve(filePath));
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return `artifact://${relative.replace(/\\/g, "/")}`;
  }
  return filePath;
}

function recordOrEmpty(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function bboxIoU(left: unknown, right: unknown): number | null {
  const a = numberTuple4(left);
  const b = numberTuple4(right);
  if (!a || !b) return null;
  const leftX = Math.max(a[0], b[0]);
  const topY = Math.max(a[1], b[1]);
  const rightX = Math.min(a[2], b[2]);
  const bottomY = Math.min(a[3], b[3]);
  const intersection = Math.max(0, rightX - leftX) * Math.max(0, bottomY - topY);
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const union = areaA + areaB - intersection;
  return union > 0 ? roundNumber(intersection / union) : null;
}

function numberTuple4(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const numbers = value.map((item) => (typeof item === "number" && Number.isFinite(item) ? item : null));
  return numbers.every((item): item is number => item !== null) ? numbers : null;
}

function renderSummaryMarkdown(output: {
  case_id: string;
  dataset_id?: string | null;
  source_type?: string | null;
  generated_at: string;
  remote_model_gateway_url: string | null;
  pipeline_mode?: string;
  prepare_only: boolean;
  runs: StaticRunSummary[];
}): string {
  const lines: string[] = [];
  lines.push(`# Static Final Validation Summary`);
  lines.push("");
  lines.push(`- case_id: ${output.case_id}`);
  if (output.dataset_id) lines.push(`- dataset_id: ${output.dataset_id}`);
  if (output.source_type) lines.push(`- source_type: ${output.source_type}`);
  lines.push(`- generated_at: ${output.generated_at}`);
  lines.push(`- remote_model_gateway_url: ${output.remote_model_gateway_url ?? "local_only"}`);
  if (output.pipeline_mode) lines.push(`- pipeline_mode: ${output.pipeline_mode}`);
  lines.push(`- prepare_only: ${String(output.prepare_only)}`);
  lines.push("");
  for (const run of output.runs) {
    lines.push(`## ${run.imageId}`);
    lines.push("");
    lines.push(`- artifact_uri: ${run.artifactUri}`);
    if (run.datasetLabel) lines.push(`- dataset_label: ${run.datasetLabel}`);
    if (run.sourceRelativePath) lines.push(`- source_relative_path: ${run.sourceRelativePath}`);
    if (run.note) lines.push(`- note: ${run.note}`);
    if (run.studyId) lines.push(`- study_id: ${run.studyId}`);
    if (run.detection) {
      lines.push(`- detection_bbox: ${JSON.stringify(run.detection.bbox)}`);
      lines.push(`- detection_confidence: ${run.detection.confidence ?? "null"}`);
      lines.push(`- detection_iou_vs_annotation: ${run.detection.iouVsAnnotation ?? "null"}`);
    }
    if (run.measurement) {
      lines.push(`- measurement_source: ${run.measurement.measurementSource}`);
      lines.push(`- long_axis_mm: ${run.measurement.longAxisMm ?? "null"}`);
      lines.push(`- short_axis_mm: ${run.measurement.shortAxisMm ?? "null"}`);
    }
    if (run.tirads) {
      lines.push(`- tirads_category: ${run.tirads.category ?? "null"}`);
      lines.push(`- tirads_score: ${run.tirads.score ?? "null"}`);
      lines.push(`- clinical_reported_tirads: ${run.tirads.reportedByCase ?? "null"}`);
    }
    if (run.report) {
      lines.push(`- report_status: ${run.report.status}`);
      lines.push(`- report_evidence_sources: ${run.report.evidenceSources.join(", ")}`);
    }
    if (run.safetyReview) {
      lines.push(`- safety_review_status: ${run.safetyReview.status ?? "null"}`);
    }
    if (run.modelArtifacts && run.modelArtifacts.length > 0) {
      for (const artifact of run.modelArtifacts) {
        lines.push(`- ${artifact.jobType}_artifact: ${artifact.artifactUri ?? "null"}`);
        for (const [key, value] of Object.entries(artifact.nestedArtifacts)) {
          lines.push(`- ${artifact.jobType}_${key}: ${value}`);
        }
      }
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function timestampLabel(date: Date): string {
  return date.toISOString().replace(/[:]/g, "").replace(/\..+/, "").replace("T", "-");
}

function sha256File(filePath: string): string {
  return sha256Bytes(readFileSync(filePath));
}

function sha256Bytes(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function positiveInt(flag: string, value: string | undefined): number {
  const parsed = Number(requireValue(flag, value));
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function positiveIntValue(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function roundNumber(value: number): number {
  return Math.round(value * 10000) / 10000;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
