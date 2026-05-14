import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { MedicalCaseRepo } from "../src/medical/storage";
import { openDataDb } from "../src/storage/db";

type JsonObject = Record<string, unknown>;

interface CliArgs {
  dataDb: string;
  summaryJson: string;
  artifactRoot: string;
  datasetId: string;
  caseId: string;
  pipelineMode: string;
  remoteModelGatewayUrl?: string;
  runId?: string;
}

interface VideoSmokeSummary {
  video_id: string;
  frame_count: number;
  prompt_frame_index: number;
  prompt_bbox: number[];
  segmentation_uri: string;
  measurement_uri: string;
  track_count: number;
  segmented_frame_count: number;
  segmentation_warnings?: string[];
  measurement_count: number;
  measurement_warnings?: string[];
  selected_frame_index?: number | null;
  long_axis_mm?: number | null;
  short_axis_mm?: number | null;
}

const DEFAULT_SUMMARY_JSON = "data/artifacts/reports/video-sam2-smoke-case001-bidirectional/summary.json";
const DEFAULT_ARTIFACT_ROOT = "data/artifacts";
const DEFAULT_DATASET_ID = "final-validation-local-thyroid-case-001";
const DEFAULT_PIPELINE_MODE = "video_sam2_smoke";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rows = readSummary(args.summaryJson);
  const handle = openDataDb({ path: args.dataDb, singleton: false });

  try {
    const repo = new MedicalCaseRepo(handle.db);
    const startedAt = Date.now();
    const run = repo.createFinalValidationRun({
      id: args.runId,
      datasetId: args.datasetId,
      datasetRoot: args.artifactRoot,
      datasetManifestUri: artifactUri(args.artifactRoot, args.summaryJson),
      caseId: args.caseId,
      pipelineMode: args.pipelineMode,
      status: "running",
      remoteModelGatewayUrl: args.remoteModelGatewayUrl ?? null,
      dataDbPath: args.dataDb,
      reportJsonUri: artifactUri(args.artifactRoot, args.summaryJson),
      summary: runSummary(rows),
      createdBy: "medical-video-smoke-import",
      startedAt,
      now: startedAt,
    });

    const resultIds: string[] = [];
    for (const row of rows) {
      const result = repo.upsertFinalValidationImageResult({
        runId: run.id,
        datasetImageId: row.video_id,
        datasetLabel: "thyroid_dicom_video",
        sourceRelativePath: `dicom/video/${row.video_id}`,
        artifactUri: `artifact://datasets/${args.caseId}/dicom/video/${row.video_id}`,
        expected: {
          modality: "ultrasound_video",
          prompt_frame_index: row.prompt_frame_index,
          prompt_bbox: row.prompt_bbox,
          frame_count: row.frame_count,
          label_status: "rough_prompt_only_not_training_label",
        },
        measurement: {
          measurement_uri: row.measurement_uri,
          measurement_count: row.measurement_count,
          selected_frame_index: row.selected_frame_index ?? null,
          long_axis_mm: row.long_axis_mm ?? null,
          short_axis_mm: row.short_axis_mm ?? null,
          warnings: row.measurement_warnings ?? [],
        },
        safetyReview: {
          status: "needs_doctor_review",
          reasons: [
            "manual_rough_bbox_prompt",
            "video_track_requires_review_before_training_or_clinical_use",
            ...(row.measurement_warnings ?? []),
          ],
        },
        modelArtifacts: [
          {
            job_type: "thyroid.segment_video_nodule",
            model_name: "sam2-video-thyroid-segmenter",
            artifact_uri: row.segmentation_uri,
            track_count: row.track_count,
            segmented_frame_count: row.segmented_frame_count,
            warnings: row.segmentation_warnings ?? [],
          },
          {
            job_type: "thyroid.measure_video_nodule",
            model_name: "video-mask-measurement-worker",
            artifact_uri: row.measurement_uri,
            measurement_count: row.measurement_count,
            warnings: row.measurement_warnings ?? [],
          },
        ],
        taskEvents: [
          {
            task_type: "segment_video_nodules",
            status: row.segmented_frame_count > 0 ? "succeeded" : "failed",
            artifact_uri: row.segmentation_uri,
          },
          {
            task_type: "measure_video_nodules",
            status: row.measurement_count > 0 ? "succeeded" : "failed",
            artifact_uri: row.measurement_uri,
          },
        ],
        note: "SAM2 video smoke result from rough mid-frame bbox prompt; keep for review, not for supervised training labels.",
        status: row.segmented_frame_count > 0 && row.measurement_count > 0 ? "succeeded" : "failed",
        reviewStatus: "needs_review",
        completedAt: Date.now(),
      });
      resultIds.push(result.id);
    }

    const completed = repo.updateFinalValidationRun(run.id, {
      status: "succeeded",
      reportJsonUri: artifactUri(args.artifactRoot, args.summaryJson),
      summary: {
        ...runSummary(rows),
        result_count: resultIds.length,
        result_ids: resultIds,
      },
      completedAt: Date.now(),
    });
    console.log(JSON.stringify({ status: "ok", run: completed, resultIds }, null, 2));
  } finally {
    handle.close();
  }
}

function parseArgs(argv: string[], cwd: string = process.cwd()): CliArgs {
  const parsed: CliArgs = {
    dataDb: path.resolve(cwd, process.env.JZX_DATA_DB ?? "data/artifacts/live-demo-002/data.db"),
    summaryJson: path.resolve(cwd, DEFAULT_SUMMARY_JSON),
    artifactRoot: path.resolve(cwd, DEFAULT_ARTIFACT_ROOT),
    datasetId: DEFAULT_DATASET_ID,
    caseId: DEFAULT_DATASET_ID,
    pipelineMode: DEFAULT_PIPELINE_MODE,
    remoteModelGatewayUrl: process.env.JZX_REMOTE_MODEL_GATEWAY_URL,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--data-db") {
      parsed.dataDb = path.resolve(cwd, requireValue(arg, next));
      i += 1;
    } else if (arg === "--summary-json") {
      parsed.summaryJson = path.resolve(cwd, requireValue(arg, next));
      i += 1;
    } else if (arg === "--artifact-root") {
      parsed.artifactRoot = path.resolve(cwd, requireValue(arg, next));
      i += 1;
    } else if (arg === "--dataset-id") {
      parsed.datasetId = requireValue(arg, next);
      i += 1;
    } else if (arg === "--case-id") {
      parsed.caseId = requireValue(arg, next);
      i += 1;
    } else if (arg === "--pipeline-mode") {
      parsed.pipelineMode = requireValue(arg, next);
      i += 1;
    } else if (arg === "--remote-model-gateway-url") {
      parsed.remoteModelGatewayUrl = requireValue(arg, next);
      i += 1;
    } else if (arg === "--run-id") {
      parsed.runId = requireValue(arg, next);
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function readSummary(filePath: string): VideoSmokeSummary[] {
  if (!existsSync(filePath)) throw new Error(`summary json not found: ${filePath}`);
  const value = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
  if (!Array.isArray(value)) throw new Error("summary json must be an array");
  return value.map(validateSummaryRow);
}

function validateSummaryRow(value: unknown): VideoSmokeSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("summary row must be an object");
  const row = value as JsonObject;
  const videoId = requiredString(row, "video_id");
  return {
    video_id: videoId,
    frame_count: requiredNumber(row, "frame_count"),
    prompt_frame_index: requiredNumber(row, "prompt_frame_index"),
    prompt_bbox: requiredNumberArray(row, "prompt_bbox"),
    segmentation_uri: requiredString(row, "segmentation_uri"),
    measurement_uri: requiredString(row, "measurement_uri"),
    track_count: requiredNumber(row, "track_count"),
    segmented_frame_count: requiredNumber(row, "segmented_frame_count"),
    segmentation_warnings: optionalStringArray(row, "segmentation_warnings"),
    measurement_count: requiredNumber(row, "measurement_count"),
    measurement_warnings: optionalStringArray(row, "measurement_warnings"),
    selected_frame_index: optionalNumber(row, "selected_frame_index"),
    long_axis_mm: optionalNumber(row, "long_axis_mm"),
    short_axis_mm: optionalNumber(row, "short_axis_mm"),
  };
}

function runSummary(rows: VideoSmokeSummary[]): JsonObject {
  return {
    video_count: rows.length,
    total_frames: rows.reduce((sum, row) => sum + row.frame_count, 0),
    total_segmented_frames: rows.reduce((sum, row) => sum + row.segmented_frame_count, 0),
    videos: rows.map((row) => ({
      video_id: row.video_id,
      frame_count: row.frame_count,
      segmented_frame_count: row.segmented_frame_count,
      measurement_count: row.measurement_count,
      warnings: [...(row.segmentation_warnings ?? []), ...(row.measurement_warnings ?? [])],
    })),
  };
}

function artifactUri(artifactRoot: string, filePath: string): string {
  const relative = path.relative(artifactRoot, filePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return `artifact://${relative.split(path.sep).join("/")}`;
  }
  return pathToFileURL(filePath).href;
}

function requiredString(row: JsonObject, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`summary row missing string ${key}`);
  return value;
}

function requiredNumber(row: JsonObject, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`summary row missing number ${key}`);
  return value;
}

function optionalNumber(row: JsonObject, key: string): number | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`summary row has invalid number ${key}`);
  return value;
}

function requiredNumberArray(row: JsonObject, key: string): number[] {
  const value = row[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "number" || !Number.isFinite(item))) {
    throw new Error(`summary row missing number array ${key}`);
  }
  return value;
}

function optionalStringArray(row: JsonObject, key: string): string[] {
  const value = row[key];
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`summary row has invalid string array ${key}`);
  }
  return value;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
