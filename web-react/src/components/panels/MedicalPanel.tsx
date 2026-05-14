import type { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  createMedicalImage,
  createMedicalPatient,
  createMedicalStudy,
  getMedicalStudy,
  getMedicalFinalValidationResults,
  getMedicalFinalValidationRuns,
  getMedicalModelGatewayCheck,
  getMedicalSummary,
  medicalArtifactUrl,
  reviewMedicalFinalValidationResult,
  reviewMedicalReport,
  reviseMedicalNodule,
  searchMedicalKnowledge,
  startMedicalAnalysis,
  submitMedicalTiradsFeatures,
  type MedicalAgentTask,
  type MedicalAuditLog,
  type MedicalDoctorReview,
  type MedicalFinalValidationImageResult,
  type MedicalFinalValidationReviewStatus,
  type MedicalFinalValidationRun,
  type MedicalImage,
  type MedicalKnowledgeSearchResult,
  type MedicalMeasurement,
  type MedicalModelGatewayCheck,
  type MedicalModelJob,
  type MedicalNodule,
  type MedicalRecentStudy,
  type MedicalReport,
  type MedicalStudyBundle,
  type MedicalSummary,
  type MedicalTiradsFeature,
  type MedicalTiradsResult,
} from "@/api/endpoints";

interface Props {
  onError(msg: string | null): void;
}

const COUNT_LABELS: Array<[keyof MedicalSummary["counts"], string]> = [
  ["patients", "患者"],
  ["studies", "检查"],
  ["images", "图像"],
  ["analysisSessions", "分析"],
  ["nodules", "结节"],
  ["reports", "报告"],
  ["pendingReviews", "待审核"],
];

const SEGMENT_MODEL_JOB_TYPE = "thyroid.segment_nodule";
const MEASURE_MODEL_JOB_TYPE = "thyroid.measure_nodule";
const MIN_REVISION_BBOX_EDGE_PX = 1;
type MedicalReportReviewAction = "approve" | "revise" | "reject" | "archive";
type StudyQueueFilter = "all" | "tirads" | "review" | "archive" | "progress" | "exception";
type ValidationReviewFilter = MedicalFinalValidationReviewStatus | "all";
type TiradsFeatureFormKey = "composition" | "echogenicity" | "shape" | "margin" | "echogenicFoci";

type BatchQueueAction =
  | { kind: "confirm_tirads"; label: string; reason: string | null; noduleId: string | null }
  | { kind: "confirm_report"; label: string; reason: string | null; reportId: string | null }
  | { kind: "archive_report"; label: string; reason: string | null; reportId: string | null }
  | { kind: "none"; label: string; reason: string | null };

interface TiradsFeatureFormState {
  composition: string;
  echogenicity: string;
  shape: string;
  margin: string;
  echogenicFoci: string;
}

const TIRADS_FEATURE_OPTIONS: Record<TiradsFeatureFormKey, Array<[string, string]>> = {
  composition: [
    ["cystic", "囊性"],
    ["almost_completely_cystic", "几乎完全囊性"],
    ["spongiform", "海绵状"],
    ["mixed_cystic_solid", "囊实混合"],
    ["solid", "实性"],
    ["almost_completely_solid", "几乎完全实性"],
  ],
  echogenicity: [
    ["anechoic", "无回声"],
    ["hyperechoic", "高回声"],
    ["isoechoic", "等回声"],
    ["hypoechoic", "低回声"],
    ["very_hypoechoic", "极低回声"],
  ],
  shape: [
    ["wider_than_tall", "宽大于高"],
    ["taller_than_wide", "高大于宽"],
  ],
  margin: [
    ["smooth", "光滑"],
    ["ill_defined", "边界不清"],
    ["lobulated", "分叶"],
    ["irregular", "不规则"],
    ["extrathyroidal_extension", "甲状腺外侵犯"],
  ],
  echogenicFoci: [
    ["none", "无"],
    ["large_comet_tail", "大彗尾伪像"],
    ["macrocalcifications", "粗大钙化"],
    ["peripheral_rim_calcifications", "周边环状钙化"],
    ["punctate_echogenic_foci", "点状强回声"],
  ],
};

const EMPTY_TIRADS_FEATURE_FORM: TiradsFeatureFormState = {
  composition: "",
  echogenicity: "",
  shape: "",
  margin: "",
  echogenicFoci: "none",
};

interface ManualCaseFormState {
  externalPatientId: string;
  accessionNo: string;
  sex: string;
  birthYear: string;
  clinicalContext: string;
  imageUri: string;
  fileType: string;
  width: string;
  height: string;
}

const EMPTY_MANUAL_CASE: ManualCaseFormState = {
  externalPatientId: "",
  accessionNo: "",
  sex: "",
  birthYear: "",
  clinicalContext: "",
  imageUri: "",
  fileType: "png",
  width: "",
  height: "",
};

export default function MedicalPanel({ onError }: Props) {
  const [summary, setSummary] = useState<MedicalSummary | null>(null);
  const [gatewayCheck, setGatewayCheck] = useState<MedicalModelGatewayCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [manualCase, setManualCase] = useState<ManualCaseFormState>(EMPTY_MANUAL_CASE);
  const [selectedStudyId, setSelectedStudyId] = useState<string | null>(null);
  const [studyBundle, setStudyBundle] = useState<MedicalStudyBundle | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [analysisBusyImageId, setAnalysisBusyImageId] = useState<string | null>(null);
  const [reviewBusyReportId, setReviewBusyReportId] = useState<string | null>(null);
  const [noduleBusyId, setNoduleBusyId] = useState<string | null>(null);
  const [tiradsFeatureBusyNoduleId, setTiradsFeatureBusyNoduleId] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState<StudyQueueFilter>("all");
  const [knowledgeQuery, setKnowledgeQuery] = useState("TI-RADS TR4");
  const [knowledgeResult, setKnowledgeResult] = useState<MedicalKnowledgeSearchResult | null>(null);
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);
  const [validationRuns, setValidationRuns] = useState<MedicalFinalValidationRun[]>([]);
  const [validationReviewQueues, setValidationReviewQueues] = useState<Record<string, number>>({});
  const [selectedValidationRunId, setSelectedValidationRunId] = useState<string | null>(null);
  const [validationResults, setValidationResults] = useState<MedicalFinalValidationImageResult[]>([]);
  const [validationReviewCounts, setValidationReviewCounts] = useState<Record<string, number>>({});
  const [validationReviewFilter, setValidationReviewFilter] = useState<ValidationReviewFilter>("unreviewed");
  const [validationBusy, setValidationBusy] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validationReviewBusyId, setValidationReviewBusyId] = useState<string | null>(null);
  const activeWorkPollKey = studyBundle ? medicalActiveWorkPollKey(studyBundle) : "";
  const summaryStudies = summary?.recentStudies ?? [];
  const workQueueStudies = sortedWorkQueueStudies(summaryStudies).filter((study) =>
    queueFilterMatches(study, queueFilter)
  );
  const queueCounts = workQueueCounts(summaryStudies);
  const workQueueKey = workQueueStudies.map((study) => study.id).join("|");
  const currentQueueIndex = selectedStudyId
    ? workQueueStudies.findIndex((study) => study.id === selectedStudyId)
    : -1;
  const currentQueueStudy = currentQueueIndex >= 0 ? workQueueStudies[currentQueueIndex] : null;
  const activeQueueBundle = currentQueueStudy && studyBundle?.study.id === currentQueueStudy.id ? studyBundle : null;
  const batchQueueAction = batchQueuePrimaryAction(queueFilter, activeQueueBundle);
  const nextQueueFilter = queueFilter !== "all" ? nextRecommendedQueueFilter(queueCounts, queueFilter) : null;

  async function refresh(): Promise<MedicalSummary | null> {
    setBusy(true);
    setLocalError(null);
    try {
      const [nextSummary, nextGatewayCheck] = await Promise.all([
        getMedicalSummary(),
        getMedicalModelGatewayCheck().catch((err): MedicalModelGatewayCheck => ({
          gatewayUrl: "unknown",
          reachable: false,
          httpStatus: null,
          checkedAt: Date.now(),
          durationMs: 0,
          result: null,
          warnings: ["model_gateway_check_failed"],
          error: { code: "model-gateway-check-failed", message: (err as Error).message },
        })),
      ]);
      setSummary(nextSummary);
      setGatewayCheck(nextGatewayCheck);
      return nextSummary;
    } catch (err) {
      const message = `医疗工作台加载失败：${(err as Error).message}`;
      setLocalError(message);
      onError(message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    void loadFinalValidationRuns();
  }, []);

  useEffect(() => {
    if (!selectedStudyId || !activeWorkPollKey) return;
    let cancelled = false;
    const intervalId = window.setInterval(() => {
      void Promise.all([getMedicalStudy(selectedStudyId), getMedicalSummary()])
        .then(([detail, nextSummary]) => {
          if (cancelled) return;
          setStudyBundle(detail.bundle);
          setSummary(nextSummary);
        })
        .catch(() => {
          // Background refresh is best-effort; explicit user actions still surface errors.
        });
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [selectedStudyId, activeWorkPollKey]);

  useEffect(() => {
    if (!summary?.enabled || queueFilter === "all" || detailBusy || workQueueStudies.length === 0) return;
    if (!selectedStudyId || currentQueueIndex < 0) {
      const targetId = workQueueStudies[0]?.id;
      if (targetId && targetId !== selectedStudyId) {
        void selectStudy(targetId);
      }
    }
  }, [summary?.enabled, queueFilter, detailBusy, selectedStudyId, currentQueueIndex, workQueueKey]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || !event.altKey) return;
      const editableTarget = isEditableKeyboardTarget(event.target);
      if (event.key === "ArrowUp" && !event.shiftKey) {
        if (editableTarget) return;
        event.preventDefault();
        void selectAdjacentQueuedStudy(-1);
        return;
      }
      if (event.key === "ArrowDown" && !event.shiftKey) {
        if (editableTarget) return;
        event.preventDefault();
        void selectAdjacentQueuedStudy(1);
        return;
      }
      if (event.key === "Enter" && event.shiftKey) {
        event.preventDefault();
        triggerReportShortcutAction("archive");
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        triggerReportShortcutAction("approve");
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [currentQueueIndex, workQueueKey, reviewBusyReportId, detailBusy]);

  async function loadStudyDetail(studyId: string) {
    setDetailBusy(true);
    setDetailError(null);
    try {
      const result = await getMedicalStudy(studyId);
      setStudyBundle(result.bundle);
    } catch (err) {
      const message = `医疗病例加载失败：${(err as Error).message}`;
      setDetailError(message);
      onError(message);
    } finally {
      setDetailBusy(false);
    }
  }

  async function selectStudy(studyId: string) {
    setSelectedStudyId(studyId);
    setStudyBundle(null);
    await loadStudyDetail(studyId);
  }

  async function launchAnalysis(imageId: string) {
    if (!studyBundle) return;
    setAnalysisBusyImageId(imageId);
    setDetailError(null);
    try {
      await startMedicalAnalysis(studyBundle.study.id, { imageId });
      await Promise.all([refresh(), loadStudyDetail(studyBundle.study.id)]);
    } catch (err) {
      const message = `医疗分析启动失败：${(err as Error).message}`;
      setDetailError(message);
      onError(message);
    } finally {
      setAnalysisBusyImageId(null);
    }
  }

  async function reviewReport(
    report: MedicalReport,
    action: MedicalReportReviewAction,
    finalText?: string,
    comment?: string,
    structured?: Record<string, unknown>
  ) {
    const advancePlan = queueAdvancePlan(summary, queueFilter, studyBundle?.study.id ?? null);
    setReviewBusyReportId(report.id);
    setDetailError(null);
    try {
      const result = await reviewMedicalReport(report.id, {
        action,
        finalText: action === "reject" ? undefined : finalText ?? report.finalText ?? report.draftText ?? undefined,
        comment,
        structured: action === "reject" ? undefined : structured,
      });
      setStudyBundle(result.bundle);
      const nextSummary = await refresh();
      const nextStudyId = nextQueueStudyId(nextSummary, advancePlan);
      if (nextStudyId) {
        await selectStudy(nextStudyId);
      }
    } catch (err) {
      const message = `医疗报告审核失败：${(err as Error).message}`;
      setDetailError(message);
      onError(message);
    } finally {
      setReviewBusyReportId(null);
    }
  }

  async function reviseNodule(nodule: MedicalNodule, bbox: number[]) {
    setNoduleBusyId(nodule.id);
    setDetailError(null);
    try {
      const result = await reviseMedicalNodule(nodule.id, {
        bbox,
        status: "doctor_revised",
      });
      setStudyBundle(result.bundle);
      await refresh();
    } catch (err) {
      const message = `医疗结节修订失败：${(err as Error).message}`;
      setDetailError(message);
      onError(message);
      throw err;
    } finally {
      setNoduleBusyId(null);
    }
  }

  async function submitTiradsFeatureInput(nodule: MedicalNodule, features: TiradsFeatureFormState) {
    const advancePlan = queueAdvancePlan(summary, queueFilter, studyBundle?.study.id ?? null);
    setTiradsFeatureBusyNoduleId(nodule.id);
    setDetailError(null);
    try {
      const result = await submitMedicalTiradsFeatures(nodule.id, {
        features: {
          composition: features.composition,
          echogenicity: features.echogenicity,
          shape: features.shape,
          margin: features.margin,
          echogenic_foci: [features.echogenicFoci],
        },
        sourceModel: "doctor_structured_input",
        requiresReview: false,
      });
      setStudyBundle(result.bundle);
      const nextSummary = await refresh();
      const nextStudyId = nextQueueStudyId(nextSummary, advancePlan);
      if (nextStudyId) {
        await selectStudy(nextStudyId);
      }
    } catch (err) {
      const message = `医疗 TI-RADS 特征保存失败：${(err as Error).message}`;
      setDetailError(message);
      onError(message);
      throw err;
    } finally {
      setTiradsFeatureBusyNoduleId(null);
    }
  }

  async function searchKnowledgeEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = knowledgeQuery.trim();
    if (!query) {
      setKnowledgeError("请输入检索词。");
      return;
    }
    setKnowledgeBusy(true);
    setKnowledgeError(null);
    try {
      const result = await searchMedicalKnowledge(query, 5);
      setKnowledgeResult(result);
    } catch (err) {
      const message = `医学证据检索失败：${(err as Error).message}`;
      setKnowledgeError(message);
      onError(message);
    } finally {
      setKnowledgeBusy(false);
    }
  }

  async function loadFinalValidationRuns() {
    setValidationBusy(true);
    setValidationError(null);
    try {
      const payload = await getMedicalFinalValidationRuns(20);
      setValidationRuns(payload.runs);
      setValidationReviewQueues(payload.reviewQueues);
      const nextRunId = selectedValidationRunId ?? payload.runs[0]?.id ?? null;
      setSelectedValidationRunId(nextRunId);
      if (nextRunId) {
        await loadFinalValidationResults(nextRunId, validationReviewFilter);
      } else {
        setValidationResults([]);
        setValidationReviewCounts({});
      }
    } catch (err) {
      const message = `最终验证加载失败：${(err as Error).message}`;
      setValidationError(message);
      onError(message);
    } finally {
      setValidationBusy(false);
    }
  }

  async function loadFinalValidationResults(runId: string, reviewStatus: ValidationReviewFilter = validationReviewFilter) {
    setValidationBusy(true);
    setValidationError(null);
    try {
      const payload = await getMedicalFinalValidationResults(runId, { reviewStatus, limit: 200 });
      setSelectedValidationRunId(runId);
      setValidationResults(payload.results);
      setValidationReviewCounts(payload.reviewCounts);
    } catch (err) {
      const message = `最终验证结果加载失败：${(err as Error).message}`;
      setValidationError(message);
      onError(message);
    } finally {
      setValidationBusy(false);
    }
  }

  async function changeValidationReviewFilter(next: ValidationReviewFilter) {
    setValidationReviewFilter(next);
    if (selectedValidationRunId) await loadFinalValidationResults(selectedValidationRunId, next);
  }

  async function reviewValidationResult(
    result: MedicalFinalValidationImageResult,
    reviewStatus: MedicalFinalValidationReviewStatus,
    comment?: string
  ) {
    setValidationReviewBusyId(result.id);
    setValidationError(null);
    try {
      const response = await reviewMedicalFinalValidationResult(result.id, {
        reviewStatus,
        comment,
      });
      setValidationResults((current) => current.map((item) => item.id === response.result.id ? response.result : item));
      if (selectedValidationRunId) {
        const refreshed = await getMedicalFinalValidationResults(selectedValidationRunId, {
          reviewStatus: validationReviewFilter,
          limit: 200,
        });
        setValidationResults(refreshed.results);
        setValidationReviewCounts(refreshed.reviewCounts);
      }
      const runs = await getMedicalFinalValidationRuns(20);
      setValidationRuns(runs.runs);
      setValidationReviewQueues(runs.reviewQueues);
    } catch (err) {
      const message = `最终验证复核保存失败：${(err as Error).message}`;
      setValidationError(message);
      onError(message);
    } finally {
      setValidationReviewBusyId(null);
    }
  }

  async function registerManualCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const externalPatientId = manualCase.externalPatientId.trim();
    const accessionNo = manualCase.accessionNo.trim();
    const imageUri = manualCase.imageUri.trim();
    if (!externalPatientId || !accessionNo || !imageUri) {
      setFormError("请填写患者编号、检查号和图像 URI。");
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setFormMessage(null);
    try {
      const patient = await createMedicalPatient({
        externalPatientId,
        sex: optionalText(manualCase.sex),
        birthYear: optionalNumber(manualCase.birthYear),
        meta: { source: "web_manual_case" },
      });
      const study = await createMedicalStudy({
        patientId: patient.patient.id,
        accessionNo,
        clinicalContext: optionalText(manualCase.clinicalContext),
        sourceType: "manual",
      });
      const image = await createMedicalImage({
        studyId: study.study.id,
        fileUri: imageUri,
        fileType: optionalText(manualCase.fileType),
        width: optionalNumber(manualCase.width),
        height: optionalNumber(manualCase.height),
      });
      await startMedicalAnalysis(study.study.id, {
        imageId: image.image.id,
        triggerSource: "web_manual_case_auto",
      });
      setManualCase(EMPTY_MANUAL_CASE);
      setFormMessage(`已登记并启动分析 ${accessionNo}`);
      setSelectedStudyId(study.study.id);
      await Promise.all([refresh(), loadStudyDetail(study.study.id)]);
    } catch (err) {
      const message = `医疗病例登记失败：${(err as Error).message}`;
      setFormError(message);
      onError(message);
    } finally {
      setSubmitting(false);
    }
  }

  if (localError) {
    return (
      <div className="p-4">
        <div className="border border-danger rounded p-3 text-sm text-danger">{localError}</div>
        <button onClick={refresh} className="btn-secondary mt-3">重试加载</button>
      </div>
    );
  }

  if (!summary) {
    return <div className="p-4 text-sm text-muted">正在加载医疗工作台...</div>;
  }

  if (!summary.enabled) {
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">医生工作台</h2>
          <button onClick={refresh} disabled={busy} className="btn-secondary text-sm">
            {busy ? "刷新中..." : "刷新"}
          </button>
        </div>
        <div className="border border-warning rounded p-3 text-sm text-warning">
          {medicalStorageMessage(summary.message)}
        </div>
        <ModelGatewayStatus check={gatewayCheck} />
      </div>
    );
  }

  async function selectAdjacentQueuedStudy(step: -1 | 1) {
    const baseIndex = currentQueueIndex >= 0 ? currentQueueIndex : -1;
    const next = workQueueStudies[baseIndex + step];
    if (next) await selectStudy(next.id);
  }

  function triggerReportShortcutAction(action: "approve" | "archive", reportId: string | null = null) {
    const exactSelector = reportId
      ? `button[data-medical-report-shortcut="${action}"][data-medical-report-id="${reportId}"]`
      : null;
    const fallbackSelector = `button[data-medical-report-shortcut="${action}"]`;
    const button =
      (exactSelector ? window.document.querySelector<HTMLButtonElement>(exactSelector) : null)
      ?? Array.from(window.document.querySelectorAll<HTMLButtonElement>(fallbackSelector))
        .find((candidate) => !candidate.disabled)
      ?? null;
    if (!button || button.disabled) return;
    button.click();
  }

  function triggerTiradsShortcutAction(noduleId: string | null = null) {
    const selector = noduleId
      ? `button[data-medical-tirads-shortcut="confirm"][data-medical-nodule-id="${noduleId}"]`
      : `button[data-medical-tirads-shortcut="confirm"]`;
    const button = window.document.querySelector<HTMLButtonElement>(selector);
    if (!button || button.disabled) return;
    button.click();
  }

  function triggerBatchQueueAction(action: BatchQueueAction) {
    if (action.kind === "confirm_tirads") {
      triggerTiradsShortcutAction(action.noduleId);
      return;
    }
    if (action.kind === "confirm_report") {
      triggerReportShortcutAction("approve", action.reportId);
      return;
    }
    if (action.kind === "archive_report") {
      triggerReportShortcutAction("archive", action.reportId);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] min-h-0 h-full">
      <aside className="border-b lg:border-b-0 lg:border-r border-border p-4 overflow-y-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold">医生工作台</h2>
            <p className="text-xs text-muted">最近检查 {summary.recentStudies.length} 例</p>
          </div>
          <button onClick={refresh} disabled={busy} className="btn-secondary text-sm">
            {busy ? "刷新中..." : "刷新"}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {COUNT_LABELS.map(([key, label]) => (
            <div key={key} className="border border-border rounded p-2">
              <div className="text-[11px] text-muted uppercase">{label}</div>
              <div className="text-xl font-semibold mt-1">{summary.counts[key]}</div>
            </div>
          ))}
        </div>

        <QueueBlock title="模型任务" values={summary.queues.modelJobs} />
        <QueueBlock title="智能体任务" values={summary.queues.agentTasks} />
        <ModelGatewayStatus check={gatewayCheck} />
      </aside>

      <section className="p-4 overflow-y-auto space-y-4">
        <ManualCaseForm
          value={manualCase}
          busy={submitting}
          error={formError}
          message={formMessage}
          onChange={setManualCase}
          onSubmit={registerManualCase}
        />

        <KnowledgeEvidencePanel
          query={knowledgeQuery}
          busy={knowledgeBusy}
          error={knowledgeError}
          result={knowledgeResult}
          onQueryChange={setKnowledgeQuery}
          onSubmit={searchKnowledgeEvidence}
        />

        <FinalValidationReviewPanel
          runs={validationRuns}
          reviewQueues={validationReviewQueues}
          selectedRunId={selectedValidationRunId}
          results={validationResults}
          reviewCounts={validationReviewCounts}
          reviewFilter={validationReviewFilter}
          busy={validationBusy}
          error={validationError}
          reviewingResultId={validationReviewBusyId}
          onRefresh={loadFinalValidationRuns}
          onSelectRun={(runId) => void loadFinalValidationResults(runId)}
          onFilterChange={(next) => void changeValidationReviewFilter(next)}
          onReview={(result, status, comment) => void reviewValidationResult(result, status, comment)}
        />

        {queueFilter !== "all" && (
          workQueueStudies.length > 0 ? (
            <BatchQueueModeBar
              filter={queueFilter}
              study={currentQueueStudy}
              position={currentQueueIndex >= 0 ? currentQueueIndex + 1 : 0}
              total={workQueueStudies.length}
              action={batchQueueAction}
              busy={detailBusy || reviewBusyReportId !== null || tiradsFeatureBusyNoduleId !== null}
              onSelectPrev={() => void selectAdjacentQueuedStudy(-1)}
              onSelectNext={() => void selectAdjacentQueuedStudy(1)}
              onTriggerAction={() => triggerBatchQueueAction(batchQueueAction)}
            />
          ) : (
            <EmptyQueueStateBar
              filter={queueFilter}
              recommendedFilter={nextQueueFilter}
              onSelectRecommended={(next) => setQueueFilter(next)}
            />
          )
        )}

        <StudyDetail
          bundle={studyBundle}
          busy={detailBusy}
          error={detailError}
          analyzingImageId={analysisBusyImageId}
          reviewingReportId={reviewBusyReportId}
          revisingNoduleId={noduleBusyId}
          tiradsFeatureBusyNoduleId={tiradsFeatureBusyNoduleId}
          onStartAnalysis={launchAnalysis}
          onReviewReport={reviewReport}
          onReviseNodule={reviseNodule}
          onSubmitTiradsFeatures={submitTiradsFeatureInput}
        />

        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold">病例工作队列</h3>
            <div className="text-xs text-muted mt-1">
              {workQueueStudies.length} / {summary.recentStudies.length} 例
            </div>
          </div>
          {summary.warnings.length > 0 && (
            <span className="text-xs text-warning">{summary.warnings.join(", ")}</span>
          )}
        </div>
        <QueueFilterBar value={queueFilter} counts={queueCounts} onChange={setQueueFilter} />
        <div className="mb-3 text-xs text-muted">
          快捷键: `Alt+↑` / `Alt+↓` 切换，`Alt+Enter` 确认，`Alt+Shift+Enter` 归档
        </div>
        {workQueueStudies.length === 0 ? (
          <p className="text-sm text-muted">暂无甲状腺超声验证病例。</p>
        ) : (
          <div className="space-y-2">
            {workQueueStudies.map((study) => (
              <StudyRow
                key={study.id}
                study={study}
                selected={selectedStudyId === study.id}
                onSelect={() => selectStudy(study.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ManualCaseForm({
  value,
  busy,
  error,
  message,
  onChange,
  onSubmit,
}: {
  value: ManualCaseFormState;
  busy: boolean;
  error: string | null;
  message: string | null;
  onChange(next: ManualCaseFormState): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}) {
  function update<K extends keyof ManualCaseFormState>(key: K, next: ManualCaseFormState[K]) {
    onChange({ ...value, [key]: next });
  }

  return (
    <form onSubmit={onSubmit} className="border border-border rounded p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold">手工登记病例</h3>
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? "登记中..." : "登记并启动分析"}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
        <Field label="患者编号">
          <input
            className={inputClass}
            value={value.externalPatientId}
            onChange={(event) => update("externalPatientId", event.target.value)}
            required
          />
        </Field>
        <Field label="检查号">
          <input
            className={inputClass}
            value={value.accessionNo}
            onChange={(event) => update("accessionNo", event.target.value)}
            required
          />
        </Field>
        <Field label="图像 URI">
          <input
            className={inputClass}
            value={value.imageUri}
            onChange={(event) => update("imageUri", event.target.value)}
            placeholder="artifact://raw/S1/IMG1.png"
            required
          />
        </Field>
        <Field label="性别">
          <select
            className={inputClass}
            value={value.sex}
            onChange={(event) => update("sex", event.target.value)}
          >
            <option value="">未填</option>
            <option value="F">女</option>
            <option value="M">男</option>
            <option value="O">其他</option>
          </select>
        </Field>
        <Field label="出生年">
          <input
            className={inputClass}
            value={value.birthYear}
            onChange={(event) => update("birthYear", event.target.value)}
            inputMode="numeric"
          />
        </Field>
        <Field label="图像类型">
          <input
            className={inputClass}
            value={value.fileType}
            onChange={(event) => update("fileType", event.target.value)}
          />
        </Field>
        <Field label="宽度">
          <input
            className={inputClass}
            value={value.width}
            onChange={(event) => update("width", event.target.value)}
            inputMode="numeric"
          />
        </Field>
        <Field label="高度">
          <input
            className={inputClass}
            value={value.height}
            onChange={(event) => update("height", event.target.value)}
            inputMode="numeric"
          />
        </Field>
        <Field label="临床信息">
          <input
            className={inputClass}
            value={value.clinicalContext}
            onChange={(event) => update("clinicalContext", event.target.value)}
          />
        </Field>
      </div>

      {error && <div className="mt-3 text-sm text-danger">{error}</div>}
      {message && <div className="mt-3 text-sm text-ok">{message}</div>}
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="min-w-0 text-xs text-muted">
      <span>{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function KnowledgeEvidencePanel({
  query,
  busy,
  error,
  result,
  onQueryChange,
  onSubmit,
}: {
  query: string;
  busy: boolean;
  error: string | null;
  result: MedicalKnowledgeSearchResult | null;
  onQueryChange(value: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
}) {
  return (
    <form onSubmit={onSubmit} className="border border-border rounded p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <Field label="知识证据">
          <input
            className={inputClass}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="TI-RADS TR4"
          />
        </Field>
        <button type="submit" disabled={busy} className="btn-secondary md:mb-0.5">
          {busy ? "检索中..." : "检索"}
        </button>
      </div>
      {error && <div className="mt-3 text-sm text-danger">{error}</div>}
      {result && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{knowledgeSearchModeLabel(result.mode)}</span>
            <span>{result.count} 条证据</span>
            {result.warnings.map((warning) => (
              <span key={warning} className="text-warning">{warning}</span>
            ))}
          </div>
          {result.evidence.length === 0 ? (
            <div className="text-sm text-muted border border-border rounded p-2">暂无</div>
          ) : (
            result.evidence.map((item) => (
              <KnowledgeEvidenceRow key={item.chunkId} item={item} />
            ))
          )}
        </div>
      )}
    </form>
  );
}

function KnowledgeEvidenceRow({ item }: { item: MedicalKnowledgeSearchResult["evidence"][number] }) {
  return (
    <div className="border border-border rounded p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{item.document.title}</span>
        <span className="border border-border rounded px-1.5 py-0.5">{item.score.toFixed(2)}</span>
      </div>
      <div className="mt-1 text-muted">
        {item.document.sourceName} · {item.document.version} · {item.metadata.sectionTitle ?? item.metadata.chunkType}
      </div>
      <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-border bg-bg px-2 py-1.5">
        {item.text}
      </pre>
      <div className="mt-2 font-mono text-[11px] text-muted">
        {item.metadata.relPath}:{item.metadata.lineStart}-{item.metadata.lineEnd}
      </div>
    </div>
  );
}

const VALIDATION_REVIEW_FILTERS: Array<[ValidationReviewFilter, string]> = [
  ["unreviewed", "待复核"],
  ["needs_review", "需再看"],
  ["accepted", "已接受"],
  ["rejected", "已退回"],
  ["all", "全部"],
];

function FinalValidationReviewPanel({
  runs,
  reviewQueues,
  selectedRunId,
  results,
  reviewCounts,
  reviewFilter,
  busy,
  error,
  reviewingResultId,
  onRefresh,
  onSelectRun,
  onFilterChange,
  onReview,
}: {
  runs: MedicalFinalValidationRun[];
  reviewQueues: Record<string, number>;
  selectedRunId: string | null;
  results: MedicalFinalValidationImageResult[];
  reviewCounts: Record<string, number>;
  reviewFilter: ValidationReviewFilter;
  busy: boolean;
  error: string | null;
  reviewingResultId: string | null;
  onRefresh(): void;
  onSelectRun(runId: string): void;
  onFilterChange(next: ValidationReviewFilter): void;
  onReview(result: MedicalFinalValidationImageResult, status: MedicalFinalValidationReviewStatus, comment?: string): void;
}) {
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? null;
  return (
    <section className="border border-border rounded p-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-sm font-bold">最终验证复核</h3>
          <div className="mt-1 text-xs text-muted">
            {runs.length} 个批次 · {reviewQueues.unreviewed ?? 0} 条待复核结果
          </div>
        </div>
        <button type="button" onClick={onRefresh} disabled={busy} className="btn-secondary">
          {busy ? "刷新中..." : "刷新验证"}
        </button>
      </div>

      {error && <div className="mt-3 text-sm text-danger">{error}</div>}

      {runs.length === 0 ? (
        <div className="mt-3 border border-border rounded p-2 text-sm text-muted">暂无最终验证批次。</div>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <Field label="验证批次">
              <select
                className={inputClass}
                value={selectedRunId ?? ""}
                onChange={(event) => onSelectRun(event.target.value)}
              >
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.datasetId} · {statusLabel(run.status)} · {formatTime(run.createdAt)}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2 text-xs md:min-w-[260px]">
              <Metric label="流程" value={selectedRun?.pipelineMode ?? "无"} />
              <Metric label="状态" value={statusLabel(selectedRun?.status)} />
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {VALIDATION_REVIEW_FILTERS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => onFilterChange(value)}
                className={value === reviewFilter ? "btn-primary" : "btn-secondary"}
              >
                {label} {value !== "all" ? `(${reviewCounts[value] ?? 0})` : ""}
              </button>
            ))}
          </div>

          {results.length === 0 ? (
            <div className="mt-3 border border-border rounded p-2 text-sm text-muted">当前筛选没有结果。</div>
          ) : (
            <div className="mt-3 space-y-3">
              {results.map((result) => (
                <FinalValidationResultRow
                  key={result.id}
                  result={result}
                  busy={reviewingResultId === result.id}
                  onReview={onReview}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function FinalValidationResultRow({
  result,
  busy,
  onReview,
}: {
  result: MedicalFinalValidationImageResult;
  busy: boolean;
  onReview(result: MedicalFinalValidationImageResult, status: MedicalFinalValidationReviewStatus, comment?: string): void;
}) {
  const artifactUris = finalValidationArtifactUris(result);
  const confidence = numberFromRecord(result.detection, "confidence");
  const bbox = result.detection.bbox;
  const measurementSource = stringFromRecord(result.measurement, "measurementSource");
  function review(status: MedicalFinalValidationReviewStatus) {
    const comment = status === "accepted" || status === "unreviewed"
      ? undefined
      : window.prompt("复核备注", result.reviewComment ?? "") ?? undefined;
    onReview(result, status, comment);
  }

  return (
    <article className="border border-border rounded p-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[160px_1fr]">
        <div className="min-w-0">
          <img
            src={medicalArtifactUrl(result.artifactUri)}
            alt={result.datasetImageId}
            className="h-32 w-full rounded border border-border object-contain bg-black"
          />
          {artifactUris.overlay_image && (
            <img
              src={medicalArtifactUrl(artifactUris.overlay_image)}
              alt={`${result.datasetImageId} 叠加图`}
              className="mt-2 h-32 w-full rounded border border-border object-contain bg-black"
            />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-mono text-xs font-semibold truncate">{result.datasetImageId}</div>
              <div className="mt-1 text-xs text-muted truncate">{result.sourceRelativePath ?? "来源未知"}</div>
            </div>
            <div className="flex flex-wrap gap-1 text-xs">
              <span className="rounded border border-border px-1.5 py-0.5">{result.datasetLabel ?? "未标注"}</span>
              <span className="rounded border border-border px-1.5 py-0.5">{statusLabel(result.status)}</span>
              <span className="rounded border border-border px-1.5 py-0.5">{reviewStatusLabel(result.reviewStatus)}</span>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs lg:grid-cols-4">
            <Metric label="置信度" value={confidence === null ? "无" : confidence.toFixed(3)} />
            <Metric label="测量" value={measurementSource ?? "无"} />
            <Metric label="产物" value={String(Object.keys(artifactUris).length)} />
            <Metric label="复核时间" value={result.reviewedAt ? formatTime(result.reviewedAt) : "未复核"} />
          </div>

          <div className="mt-3 text-xs text-muted">
            检测框：<span className="font-mono">{Array.isArray(bbox) ? JSON.stringify(bbox) : "无"}</span>
          </div>
          {result.note && <div className="mt-2 text-xs text-warning">{result.note}</div>}
          {result.reviewComment && <div className="mt-2 text-xs text-muted">备注：{result.reviewComment}</div>}

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => review("accepted")} className="btn-primary">
              接受
            </button>
            <button type="button" disabled={busy} onClick={() => review("needs_review")} className="btn-secondary">
              需再看
            </button>
            <button type="button" disabled={busy} onClick={() => review("rejected")} className="btn-secondary">
              退回
            </button>
            {artifactUris.detections_json && (
              <a className="btn-secondary" href={medicalArtifactUrl(artifactUris.detections_json)} target="_blank" rel="noreferrer">
                检测 JSON
              </a>
            )}
            {artifactUris.segmentation_json && (
              <a className="btn-secondary" href={medicalArtifactUrl(artifactUris.segmentation_json)} target="_blank" rel="noreferrer">
                分割 JSON
              </a>
            )}
            {artifactUris.measurements_json && (
              <a className="btn-secondary" href={medicalArtifactUrl(artifactUris.measurements_json)} target="_blank" rel="noreferrer">
                测量 JSON
              </a>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function finalValidationArtifactUris(result: MedicalFinalValidationImageResult): Record<string, string> {
  const uris: Record<string, string> = {};
  for (const artifact of recordList(result.modelArtifacts)) {
    const jobType = stringValue(artifact.jobType);
    const artifactUri = stringValue(artifact.artifactUri);
    if (jobType && artifactUri) uris[`${jobType}_artifact`] = artifactUri;
    const nestedArtifacts = objectValue(artifact.nestedArtifacts);
    if (!nestedArtifacts) continue;
    for (const [key, value] of Object.entries(nestedArtifacts)) {
      if (typeof value === "string" && value.startsWith("artifact://")) uris[key] = value;
    }
  }
  return uris;
}

function numberFromRecord(record: Record<string, unknown>, key: string): number | null {
  return numberValue(record[key]);
}

function stringFromRecord(record: Record<string, unknown>, key: string): string | undefined {
  return stringValue(record[key]);
}

function reviewStatusLabel(status: MedicalFinalValidationReviewStatus): string {
  if (status === "unreviewed") return "待复核";
  if (status === "accepted") return "已接受";
  if (status === "rejected") return "已退回";
  return "需再看";
}

function reviewActionLabel(action: string): string {
  const labels: Record<string, string> = {
    approve: "确认",
    revise: "修订",
    reject: "驳回",
    archive: "归档",
  };
  return labels[action] ?? action;
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return "未知";
  const labels: Record<string, string> = {
    created: "已创建",
    uploaded: "已上传",
    pending: "待处理",
    queued: "排队中",
    running: "运行中",
    waiting_model: "等待模型",
    waiting_doctor_input: "等待医生确认",
    succeeded: "成功",
    completed: "已完成",
    ok: "正常",
    failed: "失败",
    error: "异常",
    draft: "草稿",
    pending_review: "待审核",
    confirmed: "已确认",
    archived: "已归档",
    rejected: "已退回",
    reviewed: "已复核",
    unreviewed: "待复核",
    accepted: "已接受",
    needs_review: "需再看",
    needs_doctor_review: "需医生复核",
    pending_llm: "等待大模型",
    consistent: "一致",
    matched: "已匹配",
    none: "无",
    unknown: "未知",
    ready: "就绪",
    reachable: "可连接",
    unreachable: "不可连接",
    checking: "检查中",
    online: "在线",
    offline: "离线",
    doctor_revised: "医生已修订",
    measured: "已测量",
  };
  return labels[status] ?? status;
}

function sourceTypeLabel(source: string | null | undefined): string {
  if (!source) return "未知";
  const labels: Record<string, string> = {
    manual: "手工录入",
    final_validation: "最终验证",
    dicom_import: "DICOM 导入",
    csv_import: "CSV 导入",
    json_import: "JSON 导入",
  };
  return labels[source] ?? source;
}

function medicalStorageMessage(message: string | null | undefined): string {
  if (!message) return "医疗数据存储未启用";
  if (message.includes("medical storage disabled")) return `医疗数据存储未启用${message.includes("no data.db") ? "（缺少 data.db）" : ""}`;
  return message;
}

function taskTypeLabel(taskType: string): string {
  const labels: Record<string, string> = {
    image_qc: "图像质控",
    detect_nodules: "结节检测",
    segment_nodules: "结节分割",
    measure_nodules: "结节测量",
    classify_tirads_features: "TI-RADS 特征识别",
    calculate_tirads: "TI-RADS 规则计算",
    draft_report: "报告生成",
    safety_review: "安全审核",
  };
  return labels[taskType] ?? taskType;
}

function modelJobTypeLabel(jobType: string): string {
  const labels: Record<string, string> = {
    "thyroid.detect_nodules": "甲状腺结节检测",
    "thyroid.segment_nodule": "甲状腺结节分割",
    "thyroid.measure_nodule": "甲状腺结节测量",
  };
  return labels[jobType] ?? jobType;
}

function knowledgeSearchModeLabel(mode: string): string {
  const labels: Record<string, string> = {
    hybrid: "混合检索",
    bm25: "关键词检索",
    vector: "向量检索",
    semantic: "语义检索",
  };
  return labels[mode] ?? mode;
}

function auditActionLabel(action: string): string {
  const labels: Record<string, string> = {
    "medical.nodule.revise": "医生修订结节检测框",
    "medical.report.review": "医生审核报告",
    "medical.report.archive": "报告归档",
    "medical.final_validation.review": "最终验证复核",
  };
  return labels[action] ?? action;
}

function actorTypeLabel(actorType: string): string {
  const labels: Record<string, string> = {
    doctor: "医生",
    system: "系统",
    worker: "工作器",
    agent: "智能体",
    user: "用户",
  };
  return labels[actorType] ?? actorType;
}

function QueueBlock({ title, values }: { title: string; values: Record<string, number> }) {
  const entries = Object.entries(values);
  return (
    <div>
      <h3 className="text-xs uppercase text-muted mb-2">{title}</h3>
      {entries.length === 0 ? (
        <div className="text-sm text-muted border border-border rounded p-2">暂无</div>
      ) : (
        <div className="space-y-1">
          {entries.map(([status, count]) => (
            <div key={status} className="flex items-center justify-between text-sm border border-border rounded px-2 py-1.5">
              <span>{statusLabel(status)}</span>
              <strong>{count}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ModelGatewayStatus({ check }: { check: MedicalModelGatewayCheck | null }) {
  const result = check?.result ?? null;
  const readyDetectors = stringList(result?.ready_detectors);
  const status = !check
    ? "checking"
    : check.reachable
      ? stringValue(result?.status) ?? "reachable"
      : "unreachable";
  return (
    <div>
      <h3 className="text-xs uppercase text-muted mb-2">模型网关</h3>
      <div className="border border-border rounded p-2 text-xs space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{statusLabel(status)}</span>
          <span className="border border-border rounded px-1.5 py-0.5">
            {check?.reachable ? "在线" : "离线"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="可用模型" value={readyDetectors.length > 0 ? readyDetectors.join(", ") : "无"} />
          <Metric label="GPU" value={gpuLabel(result)} />
          <Metric label="延迟" value={check ? `${check.durationMs}ms` : "等待中"} />
          <Metric label="检查时间" value={check ? formatTime(check.checkedAt) : "等待中"} />
        </div>
        {check?.gatewayUrl && <div className="font-mono text-[11px] text-muted truncate">{check.gatewayUrl}</div>}
        {check?.warnings && check.warnings.length > 0 && (
          <div className="text-warning">{check.warnings.join(", ")}</div>
        )}
      </div>
    </div>
  );
}

function StudyDetail({
  bundle,
  busy,
  error,
  analyzingImageId,
  reviewingReportId,
  revisingNoduleId,
  tiradsFeatureBusyNoduleId,
  onStartAnalysis,
  onReviewReport,
  onReviseNodule,
  onSubmitTiradsFeatures,
}: {
  bundle: MedicalStudyBundle | null;
  busy: boolean;
  error: string | null;
  analyzingImageId: string | null;
  reviewingReportId: string | null;
  revisingNoduleId: string | null;
  tiradsFeatureBusyNoduleId: string | null;
  onStartAnalysis(imageId: string): void;
  onReviewReport(
    report: MedicalReport,
    action: MedicalReportReviewAction,
    finalText?: string,
    comment?: string,
    structured?: Record<string, unknown>
  ): void;
  onReviseNodule(nodule: MedicalNodule, bbox: number[]): Promise<void>;
  onSubmitTiradsFeatures(nodule: MedicalNodule, features: TiradsFeatureFormState): Promise<void>;
}) {
  if (!bundle) {
    return (
      <div className="border border-border rounded p-3 text-sm text-muted">
        {busy ? "病例加载中..." : error ?? "请选择一个病例。"}
      </div>
    );
  }

  const {
    patient,
    study,
    images,
    nodules,
    measurements,
    tiradsFeatures,
    tiradsResults,
    reports,
    auditLogs,
    doctorReviews,
    modelJobs,
    analysisSessions,
    agentTasks,
  } = bundle;
  const noduleEvidenceRows = buildNoduleModelEvidence(nodules, measurements, reports, modelJobs);
  const featureByNodule = latestTiradsFeatureByNodule(tiradsFeatures);
  const measurementByNodule = latestMeasurementByNodule(measurements);
  return (
    <div className="border border-border rounded p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-muted">{study.id}</div>
          <h3 className="text-sm font-bold mt-1">{study.accessionNo ?? "手工病例"}</h3>
          <p className="text-xs text-muted mt-1">
            {patient?.externalPatientId ?? "未知患者"} · {study.modality}/{study.bodyPart}
          </p>
        </div>
        <span className="text-xs border border-border rounded px-2 py-1">{statusLabel(study.status)}</span>
      </div>

      {error && <div className="mt-3 text-sm text-danger">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-xs">
        <Metric label="来源" value={sourceTypeLabel(study.sourceType)} />
        <Metric label="图像" value={String(images.length)} />
        <Metric label="结节" value={String(nodules.length)} />
        <Metric label="报告" value={String(reports.length)} />
        <Metric label="审计" value={String(auditLogs.length)} />
        <Metric label="模型任务" value={String(modelJobs.length)} />
        <Metric label="分析" value={String(analysisSessions.length)} />
        <Metric label="智能体任务" value={String(agentTasks.length)} />
      </div>

      <div className="mt-4">
        <h4 className="text-xs uppercase text-muted mb-2">图像</h4>
        {images.length === 0 ? (
          <div className="text-sm text-muted border border-border rounded p-2">暂无</div>
        ) : (
          <div className="space-y-2">
            {images.map((image) => (
              <ImageRow
                key={image.id}
                image={image}
                busy={busy || analyzingImageId !== null}
                analyzing={analyzingImageId === image.id}
                onStart={() => onStartAnalysis(image.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <OverlayRevisionWorkspace
          images={images}
          nodules={nodules}
          modelJobs={modelJobs}
          busy={busy || revisingNoduleId !== null}
          revisingNoduleId={revisingNoduleId}
          onRevise={onReviseNodule}
        />
      </div>

      <div className="mt-4">
        <h4 className="text-xs uppercase text-muted mb-2">AI 结果</h4>
        {nodules.length === 0 && tiradsResults.length === 0 ? (
          <div className="text-sm text-muted border border-border rounded p-2">暂无</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {nodules.map((nodule) => (
              <NoduleResultRow
                key={nodule.id}
                nodule={nodule}
                result={tiradsResults.find((item) => item.noduleId === nodule.id) ?? null}
                feature={featureByNodule.get(nodule.id) ?? null}
                measurement={measurementByNodule.get(nodule.id) ?? null}
                busy={busy || revisingNoduleId !== null || tiradsFeatureBusyNoduleId !== null}
                revising={revisingNoduleId === nodule.id}
                savingFeatures={tiradsFeatureBusyNoduleId === nodule.id}
                onRevise={(bbox) => onReviseNodule(nodule, bbox)}
                onSubmitTiradsFeatures={(features) => onSubmitTiradsFeatures(nodule, features)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <ModelEvidencePanel rows={noduleEvidenceRows} />
      </div>

      <div className="mt-4">
        <h4 className="text-xs uppercase text-muted mb-2">报告</h4>
        {hasReportStageSignal(reports, agentTasks) && <RealDemoModelNotice reports={reports} agentTasks={agentTasks} />}
        {reports.length === 0 ? (
          <div className="text-sm text-muted border border-border rounded p-2">暂无</div>
        ) : (
          <div className="space-y-2">
            {reports.map((report) => (
              <ReportRow
                key={report.id}
                report={report}
                reviews={doctorReviews.filter((review) => review.reportId === report.id)}
                busy={busy || reviewingReportId !== null}
                reviewing={reviewingReportId === report.id}
                onReview={(action, finalText, comment, structured) => onReviewReport(report, action, finalText, comment, structured)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <h4 className="text-xs uppercase text-muted mb-2">医生审核记录</h4>
        {doctorReviews.length === 0 ? (
          <div className="text-sm text-muted border border-border rounded p-2">暂无</div>
        ) : (
          <div className="space-y-2">
            {doctorReviews.map((review) => (
              <DoctorReviewRow key={review.id} review={review} />
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <h4 className="text-xs uppercase text-muted mb-2">安全审计</h4>
        {auditLogs.length === 0 ? (
          <div className="text-sm text-muted border border-border rounded p-2">暂无</div>
        ) : (
          <div className="space-y-2">
            {auditLogs.map((audit) => (
              <AuditRow key={audit.id} audit={audit} evidenceRows={noduleEvidenceRows} reports={reports} />
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <h4 className="text-xs uppercase text-muted mb-2">模型任务</h4>
        {modelJobs.length === 0 ? (
          <div className="text-sm text-muted border border-border rounded p-2">暂无</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {modelJobs.map((job) => (
              <ModelJobRow key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <h4 className="text-xs uppercase text-muted mb-2">智能体任务</h4>
        {agentTasks.length === 0 ? (
          <div className="text-sm text-muted border border-border rounded p-2">暂无</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {agentTasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface OverlaySelection {
  image: MedicalImage;
  overlayUri: string;
  nodules: MedicalNodule[];
}

interface ImagePoint {
  x: number;
  y: number;
}

function OverlayRevisionWorkspace({
  images,
  nodules,
  modelJobs,
  busy,
  revisingNoduleId,
  onRevise,
}: {
  images: MedicalImage[];
  nodules: MedicalNodule[];
  modelJobs: MedicalModelJob[];
  busy: boolean;
  revisingNoduleId: string | null;
  onRevise(nodule: MedicalNodule, bbox: number[]): Promise<void>;
}) {
  const overlay = firstOverlaySelection(images, nodules, modelJobs);
  const [selectedNoduleId, setSelectedNoduleId] = useState<string | null>(null);
  const [draftBbox, setDraftBbox] = useState<number[] | null>(null);
  const [dragStart, setDragStart] = useState<ImagePoint | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [loadedImageSize, setLoadedImageSize] = useState<{ width: number; height: number } | null>(null);

  const selectedNodule = overlay?.nodules.find((nodule) => nodule.id === selectedNoduleId)
    ?? overlay?.nodules[0]
    ?? null;
  const displayBbox = draftBbox ?? selectedNodule?.bbox ?? null;
  const revisionImage = overlay
    ? {
        ...overlay.image,
        width: overlay.image.width ?? loadedImageSize?.width ?? null,
        height: overlay.image.height ?? loadedImageSize?.height ?? null,
      }
    : null;

  useEffect(() => {
    if (!overlay) {
      setSelectedNoduleId(null);
      setDraftBbox(null);
      setLoadedImageSize(null);
      return;
    }
    if (!selectedNoduleId || !overlay.nodules.some((nodule) => nodule.id === selectedNoduleId)) {
      setSelectedNoduleId(overlay.nodules[0]?.id ?? null);
      setDraftBbox(null);
    }
  }, [overlay?.image.id, overlay?.nodules, selectedNoduleId]);

  useEffect(() => {
    setDraftBbox(null);
    setEditError(null);
    setLoadedImageSize(null);
  }, [selectedNodule?.id, selectedNodule?.updatedAt]);

  if (!overlay || overlay.nodules.length === 0) return null;

  function beginDrag(event: ReactMouseEvent<HTMLDivElement>) {
    if (busy || !revisionImage) return;
    const point = mousePointToImagePoint(event, revisionImage);
    if (!point) return;
    setDragStart(point);
    setDraftBbox([point.x, point.y, point.x, point.y]);
    setEditError(null);
  }

  function updateDrag(event: ReactMouseEvent<HTMLDivElement>) {
    if (!dragStart || !revisionImage) return;
    const point = mousePointToImagePoint(event, revisionImage);
    if (!point) return;
    setDraftBbox(bboxFromPoints(dragStart, point));
  }

  function endDrag(event: ReactMouseEvent<HTMLDivElement>) {
    if (!dragStart || !revisionImage) return;
    const point = mousePointToImagePoint(event, revisionImage);
    if (point) setDraftBbox(bboxFromPoints(dragStart, point));
    setDragStart(null);
  }

  async function saveOverlayRevision() {
    if (!selectedNodule) return;
    if (!isNumberTuple4(draftBbox)) {
      setEditError("请先在叠加图上拖拽框选新的检测框。");
      return;
    }
    const validationError = bboxValidationMessage(draftBbox);
    if (validationError) {
      setEditError(validationError);
      return;
    }
    setEditError(null);
    try {
      await onRevise(selectedNodule, normalizedBbox(draftBbox));
    } catch {
      // Parent surface already shows the API error.
    }
  }

  return (
    <div className="border border-border rounded p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-xs uppercase text-muted">叠加图修订</h4>
          <div className="mt-1 text-xs text-muted">拖拽图像区域生成新的检测框，再保存到选中的结节。</div>
        </div>
        <button type="button" className="btn-secondary" disabled={busy} onClick={saveOverlayRevision}>
          {selectedNodule && revisingNoduleId === selectedNodule.id ? "保存中..." : "保存叠加图修订"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {overlay.nodules.map((nodule) => (
          <button
            key={nodule.id}
            type="button"
            className={`rounded border px-2 py-1 text-xs ${
              selectedNodule?.id === nodule.id ? "border-accent bg-accent/10" : "border-border"
            }`}
            onClick={() => {
              setSelectedNoduleId(nodule.id);
              setDraftBbox(null);
            }}
          >
            N{nodule.noduleIndex}
          </button>
        ))}
      </div>

      <div
        role="img"
        aria-label="叠加图检测框修订画布"
        data-testid="overlay-revision-canvas"
        className="relative mt-3 max-h-[520px] overflow-hidden rounded border border-border bg-bg select-none cursor-crosshair"
        onMouseDown={beginDrag}
        onMouseMove={updateDrag}
        onMouseUp={endDrag}
        onMouseLeave={() => setDragStart(null)}
      >
        <img
          src={medicalArtifactUrl(overlay.overlayUri)}
          alt="叠加图修订预览"
          className="block h-auto w-full object-contain"
          draggable={false}
          onLoad={(event) => {
            const element = event.currentTarget;
            if ((!overlay.image.width || !overlay.image.height) && element.naturalWidth > 0 && element.naturalHeight > 0) {
              setLoadedImageSize({ width: element.naturalWidth, height: element.naturalHeight });
            }
          }}
        />
        {overlay.nodules.map((nodule) => (
          <BboxOverlay
            key={nodule.id}
            bbox={nodule.bbox}
            image={revisionImage ?? overlay.image}
            active={selectedNodule?.id === nodule.id}
            label={`N${nodule.noduleIndex}`}
          />
        ))}
        {isNumberTuple4(displayBbox) && (
          <BboxOverlay bbox={displayBbox} image={revisionImage ?? overlay.image} active label="草稿" dashed />
        )}
      </div>

      <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
        <Metric label="图像" value={overlay.image.id} />
        <Metric label="当前检测框" value={formatBbox(selectedNodule?.bbox)} />
        <Metric label="草稿检测框" value={formatBbox(draftBbox)} />
      </div>
      {editError && <div className="mt-2 text-xs text-danger">{editError}</div>}
    </div>
  );
}

function BboxOverlay({
  bbox,
  image,
  active,
  label,
  dashed = false,
}: {
  bbox: unknown;
  image: MedicalImage;
  active: boolean;
  label: string;
  dashed?: boolean;
}) {
  const style = bboxStyle(bbox, image);
  if (!style) return null;
  return (
    <div
      className={`pointer-events-none absolute border-2 ${
        active ? "border-accent" : "border-warning"
      } ${dashed ? "border-dashed" : ""}`}
      style={style}
    >
      <span className="absolute left-0 top-0 bg-bg/90 px-1 py-0.5 text-[10px] font-semibold text-fg">
        {label}
      </span>
    </div>
  );
}

function ModelJobRow({ job }: { job: MedicalModelJob }) {
  const artifacts = objectValue(job.output?.artifacts);
  const detectionsJsonUri = job.artifactUri ?? stringValue(artifacts?.detections_json);
  const overlayUri = stringValue(artifacts?.overlay_image);
  const comparisonJsonUri = stringValue(artifacts?.model_comparison_json);
  const comparison = objectValue(job.output?.comparison);
  const llmEvaluation = objectValue(job.output?.llm_evaluation);
  return (
    <div className="border border-border rounded p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">{modelJobTypeLabel(job.jobType)}</span>
        <span className="border border-border rounded px-1.5 py-0.5">{statusLabel(job.status)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <Metric label="模型" value={job.modelName ?? "未知"} />
        <Metric label="版本" value={job.modelVersion ?? "未知"} />
        <Metric label="尝试次数" value={`${job.attempts}/${job.maxAttempts}`} />
        <Metric label="更新时间" value={formatTime(job.updatedAt)} />
      </div>
      {detectionsJsonUri && (
        <ArtifactLine label="检测结果" value={detectionsJsonUri} />
      )}
      {overlayUri && (
        <ArtifactLine label="叠加图" value={overlayUri} />
      )}
      {comparisonJsonUri && (
        <ArtifactLine label="模型对比" value={comparisonJsonUri} />
      )}
      <DetectorComparisonSummary comparison={comparison} llmEvaluation={llmEvaluation} />
      {overlayUri && (
        <img
          src={medicalArtifactUrl(overlayUri)}
          alt="检测叠加图预览"
          className="mt-2 max-h-48 w-full rounded border border-border object-contain bg-bg"
        />
      )}
      {job.error && (
        <div className="mt-2 rounded border border-danger/40 px-2 py-1 text-danger">
          {stringValue(job.error.code) ?? "model_job_error"}
        </div>
      )}
    </div>
  );
}

function DetectorComparisonSummary({
  comparison,
  llmEvaluation,
}: {
  comparison?: Record<string, unknown>;
  llmEvaluation?: Record<string, unknown>;
}) {
  const consensus = objectValue(comparison?.consensus) ?? objectValue(llmEvaluation?.comparison_summary);
  if (!consensus && !llmEvaluation) return null;
  const focus = stringList(llmEvaluation?.doctor_review_focus);
  const constraints = stringList(llmEvaluation?.constraints);
  const intendedModel = stringValue(llmEvaluation?.intended_model) ?? "Qwen3.5-9B";
  const llmStatus = stringValue(llmEvaluation?.status) ?? "pending_llm";
  const assessment = stringValue(llmEvaluation?.overall_assessment) ?? "needs_review";
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">检测模型一致性</span>
        <span className="border border-border rounded px-1.5 py-0.5">
          {statusLabel(stringValue(consensus?.status) ?? "unknown")}
        </span>
      </div>
      {consensus && (
        <div className="grid grid-cols-2 gap-2">
          <Metric label="一致检出" value={numberLabel(consensus.matched_count)} />
          <Metric label="主模型独有" value={numberLabel(consensus.primary_only_count)} />
          <Metric label="YOLO 独有" value={numberLabel(consensus.comparator_only_count)} />
          <Metric label="模型检出数" value={`${numberLabel(consensus.primary_count)}/${numberLabel(consensus.comparator_count)}`} />
        </div>
      )}
      {llmEvaluation && (
        <div className="text-muted">
          {intendedModel} · {statusLabel(llmStatus)} · {statusLabel(assessment)}
        </div>
      )}
      {focus.length > 0 && (
        <div className="space-y-1">
          {focus.map((item, index) => (
            <div key={index} className="rounded border border-warning/40 px-2 py-1 text-warning">
              {item}
            </div>
          ))}
        </div>
      )}
      {constraints.length > 0 && (
        <div className="text-[11px] text-muted">
          {constraints[0]}
        </div>
      )}
    </div>
  );
}

function ArtifactLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2 min-w-0">
      <span className="text-muted">{label}: </span>
      <span className="font-mono text-[11px] text-muted break-all">{value}</span>
    </div>
  );
}

interface NoduleModelEvidence {
  nodule: MedicalNodule;
  segmentationEvidence: Record<string, unknown> | null;
  measurementEvidence: Record<string, unknown> | null;
  measurement: MedicalMeasurement | null;
  segmentationJob: MedicalModelJob | null;
  measurementJob: MedicalModelJob | null;
}

function ModelEvidencePanel({ rows }: { rows: NoduleModelEvidence[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs uppercase text-muted mb-2">模型依据</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {rows.map((row) => (
          <NoduleModelEvidenceRow key={row.nodule.id} row={row} />
        ))}
      </div>
    </div>
  );
}

function NoduleModelEvidenceRow({ row }: { row: NoduleModelEvidence }) {
  const segmentation = row.segmentationEvidence;
  const measurement = row.measurementEvidence;
  const metadata = objectValue(segmentation?.metadata);
  const pixelMeasurements = objectValue(measurement?.pixel_measurements);
  const maskUri = stringValue(segmentation?.mask_uri) ?? row.nodule.maskUri;
  const longAxisMm = numberValue(measurement?.long_axis_mm) ?? row.measurement?.longAxisMm ?? null;
  const shortAxisMm = numberValue(measurement?.short_axis_mm) ?? row.measurement?.shortAxisMm ?? null;
  const apAxisMm = numberValue(measurement?.ap_axis_mm) ?? row.measurement?.apAxisMm ?? null;
  const areaMm2 = numberValue(measurement?.area_mm2) ?? row.measurement?.areaMm2 ?? null;
  const aspectRatio = numberValue(measurement?.aspect_ratio) ?? row.measurement?.aspectRatio ?? null;
  const pixelSummary = formatPixelMeasurements(pixelMeasurements);

  return (
    <div className="border border-border rounded p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">结节 {row.nodule.noduleIndex}</span>
        <span className="border border-border rounded px-1.5 py-0.5">
          {segmentation || measurement ? "报告依据" : "等待依据"}
        </span>
      </div>

      <div className="mt-3">
        <div className="font-semibold">分割</div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <Metric label="来源" value={stringValue(segmentation?.segmentation_source) ?? "待生成"} />
          <Metric label="模型" value={modelLabel(segmentation, row.segmentationJob)} />
          <Metric label="版本" value={versionLabel(segmentation, row.segmentationJob)} />
          <Metric label="置信度" value={formatUnknownNumber(segmentation?.confidence)} />
          <Metric label="裁剪框" value={formatNumberList(metadata?.crop_box_xyxy)} />
          <Metric label="ROI" value={formatNumberList(metadata?.roi_size)} />
        </div>
        {maskUri && <ArtifactLine label="掩膜" value={maskUri} />}
        {stringValue(segmentation?.artifact_uri) && (
          <ArtifactLine label="分割结果" value={stringValue(segmentation?.artifact_uri)!} />
        )}
      </div>

      <div className="mt-3 border-t border-border pt-3">
        <div className="font-semibold">测量</div>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <Metric label="来源" value={stringValue(measurement?.measurement_source) ?? row.measurement?.measurementSource ?? "待生成"} />
          <Metric label="模型" value={modelLabel(measurement, row.measurementJob)} />
          <Metric label="长径" value={formatMm(longAxisMm)} />
          <Metric label="短径" value={formatMm(shortAxisMm)} />
          <Metric label="前后径" value={formatMm(apAxisMm)} />
          <Metric label="面积" value={formatArea(areaMm2)} />
          <Metric label="纵横比" value={formatNullableNumber(aspectRatio)} />
          <Metric label="置信度" value={formatUnknownNumber(measurement?.confidence ?? row.measurement?.confidence)} />
        </div>
        {pixelSummary !== "待生成" && (
          <div className="mt-2 text-muted">
            像素测量 {pixelSummary}
          </div>
        )}
        {stringValue(measurement?.artifact_uri) && (
          <ArtifactLine label="测量结果" value={stringValue(measurement?.artifact_uri)!} />
        )}
      </div>
    </div>
  );
}

function buildNoduleModelEvidence(
  nodules: MedicalNodule[],
  measurements: MedicalMeasurement[],
  reports: MedicalReport[],
  modelJobs: MedicalModelJob[]
): NoduleModelEvidence[] {
  const segmentEvidence = latestReportEvidenceByNodule(reports, "segmentation_result");
  const measurementEvidence = latestReportEvidenceByNodule(reports, "measurement_result");
  const measurementByNodule = latestMeasurementByNodule(measurements);
  const segmentJobs = latestModelJobByNodule(modelJobs, SEGMENT_MODEL_JOB_TYPE, "segmentations");
  const measureJobs = latestModelJobByNodule(modelJobs, MEASURE_MODEL_JOB_TYPE, "measurements");
  return nodules.map((nodule) => ({
    nodule,
    segmentationEvidence: evidenceForNodule(segmentEvidence, nodule),
    measurementEvidence: evidenceForNodule(measurementEvidence, nodule),
    measurement: measurementByNodule.get(nodule.id) ?? null,
    segmentationJob: evidenceForNodule(segmentJobs, nodule),
    measurementJob: evidenceForNodule(measureJobs, nodule),
  }));
}

function latestReportEvidenceByNodule(reports: MedicalReport[], source: string): Map<string, Record<string, unknown>> {
  const byNodule = new Map<string, Record<string, unknown>>();
  for (const report of [...reports].sort((a, b) => a.updatedAt - b.updatedAt)) {
    for (const rawEvidence of report.evidence) {
      const evidence = objectValue(rawEvidence);
      if (!evidence || evidence.source !== source) continue;
      for (const key of noduleKeysFromRecord(evidence)) {
        byNodule.set(key, evidence);
      }
    }
  }
  return byNodule;
}

function latestMeasurementByNodule(measurements: MedicalMeasurement[]): Map<string, MedicalMeasurement> {
  const byNodule = new Map<string, MedicalMeasurement>();
  for (const measurement of [...measurements].sort((a, b) => a.createdAt - b.createdAt)) {
    byNodule.set(measurement.noduleId, measurement);
  }
  return byNodule;
}

function latestTiradsFeatureByNodule(features: MedicalTiradsFeature[]): Map<string, MedicalTiradsFeature> {
  const byNodule = new Map<string, MedicalTiradsFeature>();
  for (const feature of [...features].sort((a, b) => a.createdAt - b.createdAt)) {
    byNodule.set(feature.noduleId, feature);
  }
  return byNodule;
}

function tiradsFeatureFormState(feature: MedicalTiradsFeature | null): TiradsFeatureFormState {
  if (!feature) return EMPTY_TIRADS_FEATURE_FORM;
  return {
    composition: stringValue(feature.features.composition) ?? "",
    echogenicity: stringValue(feature.features.echogenicity) ?? "",
    shape: stringValue(feature.features.shape) ?? "",
    margin: stringValue(feature.features.margin) ?? "",
    echogenicFoci: stringList(feature.features.echogenic_foci)[0] ?? "none",
  };
}

function latestModelJobByNodule(
  modelJobs: MedicalModelJob[],
  jobType: string,
  outputKey: string
): Map<string, MedicalModelJob> {
  const byNodule = new Map<string, MedicalModelJob>();
  for (const job of [...modelJobs].sort((a, b) => a.updatedAt - b.updatedAt)) {
    if (job.jobType !== jobType || job.status !== "succeeded") continue;
    for (const output of recordList(job.output?.[outputKey])) {
      for (const key of noduleKeysFromRecord(output)) {
        byNodule.set(key, job);
      }
    }
  }
  return byNodule;
}

function evidenceForNodule<T>(items: Map<string, T>, nodule: MedicalNodule): T | null {
  return items.get(nodule.id) ?? items.get(`index:${nodule.noduleIndex}`) ?? null;
}

function noduleKeysFromRecord(record: Record<string, unknown>): string[] {
  const keys: string[] = [];
  const noduleId = stringValue(record.nodule_id) ?? stringValue(record.noduleId);
  const noduleIndex = numberValue(record.nodule_index) ?? numberValue(record.noduleIndex);
  if (noduleId) keys.push(noduleId);
  if (noduleIndex !== null) keys.push(`index:${noduleIndex}`);
  return keys;
}

function modelLabel(evidence: Record<string, unknown> | null, job: MedicalModelJob | null): string {
  return stringValue(evidence?.model_name) ?? job?.modelName ?? "待生成";
}

function versionLabel(evidence: Record<string, unknown> | null, job: MedicalModelJob | null): string {
  return stringValue(evidence?.model_version) ?? job?.modelVersion ?? "待生成";
}

function evidenceRowForAudit(audit: MedicalAuditLog, rows: NoduleModelEvidence[]): NoduleModelEvidence | null {
  if (audit.action !== "medical.nodule.revise") return null;
  const before = objectValue(audit.detail.before);
  const after = objectValue(audit.detail.after);
  const ids = new Set<string>();
  const indexes = new Set<number>();
  if (audit.targetType === "nodule" && audit.targetId) ids.add(audit.targetId);
  for (const snapshot of [before, after]) {
    const id = stringValue(snapshot?.id);
    const index = numberValue(snapshot?.nodule_index) ?? numberValue(snapshot?.noduleIndex);
    if (id) ids.add(id);
    if (index !== null) indexes.add(index);
  }
  return rows.find((row) => ids.has(row.nodule.id) || indexes.has(row.nodule.noduleIndex)) ?? null;
}

function latestReportForNodule(reports: MedicalReport[], nodule: MedicalNodule): MedicalReport | null {
  const keys = new Set([nodule.id, `index:${nodule.noduleIndex}`]);
  let latest: MedicalReport | null = null;
  for (const report of [...reports].sort((a, b) => a.updatedAt - b.updatedAt)) {
    const hasEvidence = report.evidence.some((rawEvidence) => {
      const evidence = objectValue(rawEvidence);
      return evidence ? noduleKeysFromRecord(evidence).some((key) => keys.has(key)) : false;
    });
    if (hasEvidence) latest = report;
  }
  return latest;
}

function reportEvidenceSourceLabel(report: MedicalReport): string {
  const sources = new Set<string>();
  for (const rawEvidence of report.evidence) {
    const source = stringValue(objectValue(rawEvidence)?.source);
    if (source) sources.add(reportEvidenceSourceDisplayLabel(source));
  }
  return sources.size === 0 ? "等待依据" : Array.from(sources).join(", ");
}

function hasReportStageSignal(reports: MedicalReport[], agentTasks: MedicalAgentTask[]): boolean {
  return reports.length > 0 || agentTasks.some((task) => task.taskType === "draft_report" || task.taskType === "safety_review");
}

function reportUsesTemplateDraft(report: MedicalReport): boolean {
  return stringValue(report.structured.generator) !== "llm_provider_structured_report";
}

function reportEvidenceRows(evidence: unknown[]): ReportEvidenceDisplayRow[] {
  return recordList(evidence).map((item) => {
    const source = stringValue(item.source) ?? "unknown";
    if (source === "medical_guideline") return guidelineEvidenceRow(item, source);
    if (source === "tirads_rule") return tiradsRuleEvidenceRow(item, source);
    if (source === "tirads_result") return tiradsResultEvidenceRow(item, source);
    if (source === "segmentation_result") return segmentationEvidenceRow(item, source);
    if (source === "measurement_result") return measurementEvidenceRow(item, source);
    return {
      source: reportEvidenceSourceDisplayLabel(source),
      title: "其他依据",
      summary: compactTextSnippet(JSON.stringify(item)),
      detail: null,
      artifactUri: stringValue(item.artifact_uri) ?? null,
    };
  });
}

function reportEvidenceSourceDisplayLabel(source: string): string {
  const labels: Record<string, string> = {
    medical_guideline: "医学指南",
    tirads_rule: "TI-RADS 规则",
    tirads_result: "TI-RADS 结果",
    segmentation_result: "分割结果",
    measurement_result: "测量结果",
    report_template: "报告模板",
    similar_case: "相似病例",
    unknown: "未知来源",
  };
  return labels[source] ?? source;
}

function reportEvidenceFingerprint(evidence: unknown[]): string {
  const text = JSON.stringify(recordList(evidence).map((item) => ({
    source: stringValue(item.source) ?? "unknown",
    rule: stringValue(item.rule_code),
    chunk: stringValue(item.chunk_id) ?? stringValue(item.chunkId),
    nodule: numberValue(item.nodule_index) ?? numberValue(item.noduleIndex),
    artifact: stringValue(item.artifact_uri),
    model: stringValue(item.model_name),
    version: stringValue(item.model_version) ?? stringValue(item.system_version),
  })));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `ev-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function guidelineEvidenceRow(item: Record<string, unknown>, source: string): ReportEvidenceDisplayRow {
  const document = objectValue(item.document);
  const metadata = objectValue(item.metadata);
  const title = stringValue(document?.title) ?? stringValue(item.document_title) ?? "医学知识库";
  const section = stringValue(metadata?.sectionTitle) ?? stringValue(metadata?.section_title);
  const relPath = stringValue(metadata?.relPath) ?? stringValue(metadata?.rel_path);
  const lineStart = numberValue(metadata?.lineStart) ?? numberValue(metadata?.line_start);
  const lineEnd = numberValue(metadata?.lineEnd) ?? numberValue(metadata?.line_end);
  const location = relPath && lineStart !== null && lineEnd !== null ? `${relPath}:${lineStart}-${lineEnd}` : null;
  return {
    source: reportEvidenceSourceDisplayLabel(source),
    title: "医学知识库",
    summary: [title, section].filter(Boolean).join(" / "),
    detail: location ?? compactOptionalText(stringValue(item.text)),
    artifactUri: stringValue(document?.fileUri) ?? stringValue(document?.file_uri) ?? null,
  };
}

function tiradsRuleEvidenceRow(item: Record<string, unknown>, source: string): ReportEvidenceDisplayRow {
  const ruleCode = stringValue(item.rule_code) ?? "未知规则";
  const category = stringValue(item.category);
  const points = numberValue(item.points);
  return {
    source: reportEvidenceSourceDisplayLabel(source),
    title: "TI-RADS 规则库",
    summary: [ruleCode, category, points !== null ? `${points} 分` : null].filter(Boolean).join(" · "),
    detail: compactOptionalText(stringValue(item.recommendation) ?? stringValue(item.rule)),
    artifactUri: null,
  };
}

function tiradsResultEvidenceRow(item: Record<string, unknown>, source: string): ReportEvidenceDisplayRow {
  const ruleCodes = evidenceRuleCodeList(item);
  return {
    source: reportEvidenceSourceDisplayLabel(source),
    title: "TI-RADS 计算结果",
    summary: ruleCodes.length > 0 ? ruleCodes.join("、") : stringValue(item.rule_code) ?? "规则结果待补充",
    detail: stringValue(item.recommendation) ?? null,
    artifactUri: null,
  };
}

function segmentationEvidenceRow(item: Record<string, unknown>, source: string): ReportEvidenceDisplayRow {
  return {
    source: reportEvidenceSourceDisplayLabel(source),
    title: `分割依据${noduleIndexLabel(item)}`,
    summary: [
      stringValue(item.segmentation_source) ?? "分割",
      stringValue(item.model_name),
      stringValue(item.model_version),
      confidenceLabel(item.confidence),
    ].filter(Boolean).join(" · "),
    detail: stringValue(item.mask_uri) ? `掩膜 ${stringValue(item.mask_uri)}` : null,
    artifactUri: stringValue(item.artifact_uri) ?? null,
  };
}

function measurementEvidenceRow(item: Record<string, unknown>, source: string): ReportEvidenceDisplayRow {
  const longAxis = numberValue(item.long_axis_mm);
  const shortAxis = numberValue(item.short_axis_mm);
  const area = numberValue(item.area_mm2);
  return {
    source: reportEvidenceSourceDisplayLabel(source),
    title: `测量依据${noduleIndexLabel(item)}`,
    summary: [
      stringValue(item.measurement_source) ?? "测量",
      longAxis !== null ? `长径 ${formatMm(longAxis)}` : null,
      shortAxis !== null ? `短径 ${formatMm(shortAxis)}` : null,
      area !== null ? `面积 ${formatArea(area)}` : null,
      confidenceLabel(item.confidence),
    ].filter(Boolean).join(" · "),
    detail: null,
    artifactUri: stringValue(item.artifact_uri) ?? null,
  };
}

function evidenceRuleCodeList(item: Record<string, unknown>): string[] {
  const direct = stringValue(item.rule_code);
  const nested = recordList(item.evidence_rules)
    .map((rule) => stringValue(rule.rule_code))
    .filter((value): value is string => value !== undefined);
  return direct ? [direct, ...nested] : nested;
}

function noduleIndexLabel(item: Record<string, unknown>): string {
  const index = numberValue(item.nodule_index) ?? numberValue(item.noduleIndex);
  return index === null ? "" : ` N${index}`;
}

function confidenceLabel(value: unknown): string | null {
  const confidence = numberValue(value);
  return confidence === null ? null : `置信度 ${confidence.toFixed(2)}`;
}

function snapshotMaskUri(snapshot: Record<string, unknown> | undefined): string | null {
  return stringValue(snapshot?.mask_uri) ?? stringValue(snapshot?.maskUri) ?? null;
}

function NoduleResultRow({
  nodule,
  result,
  feature,
  measurement,
  busy,
  revising,
  savingFeatures,
  onRevise,
  onSubmitTiradsFeatures,
}: {
  nodule: MedicalNodule;
  result: MedicalTiradsResult | null;
  feature: MedicalTiradsFeature | null;
  measurement: MedicalMeasurement | null;
  busy: boolean;
  revising: boolean;
  savingFeatures: boolean;
  onRevise(bbox: number[]): Promise<void>;
  onSubmitTiradsFeatures(features: TiradsFeatureFormState): Promise<void>;
}) {
  const [bboxText, setBboxText] = useState(formatBbox(nodule.bbox));
  const [editError, setEditError] = useState<string | null>(null);
  const [featureForm, setFeatureForm] = useState<TiradsFeatureFormState>(() => tiradsFeatureFormState(feature));
  const [featureError, setFeatureError] = useState<string | null>(null);

  useEffect(() => {
    setBboxText(formatBbox(nodule.bbox));
    setEditError(null);
  }, [nodule.id, nodule.updatedAt, nodule.bbox]);

  useEffect(() => {
    setFeatureForm(tiradsFeatureFormState(feature));
    setFeatureError(null);
  }, [feature?.id, feature?.createdAt]);

  async function submitRevision() {
    const parsed = parseBboxInput(bboxText);
    if (typeof parsed === "string") {
      setEditError(parsed);
      return;
    }
    setEditError(null);
    try {
      await onRevise(parsed);
    } catch {
      // Parent surface already shows the API error.
    }
  }

  async function submitFeatures() {
    if (!featureForm.composition || !featureForm.echogenicity || !featureForm.shape || !featureForm.margin || !featureForm.echogenicFoci) {
      setFeatureError("请完整选择 TI-RADS 特征。");
      return;
    }
    setFeatureError(null);
    try {
      await onSubmitTiradsFeatures(featureForm);
    } catch {
      // Parent surface already shows the API error.
    }
  }

  function updateFeature(key: TiradsFeatureFormKey, value: string) {
    setFeatureForm({ ...featureForm, [key]: value });
  }

  return (
    <div className="border border-border rounded p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">结节 {nodule.noduleIndex}</span>
        <span className="border border-border rounded px-1.5 py-0.5">{statusLabel(nodule.status)}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <Metric label="置信度" value={formatOptionalNumber(nodule.detectionConfidence)} />
        <Metric label="来源" value={nodule.source === "ai" ? "AI" : nodule.source === "doctor" ? "医生" : nodule.source} />
        <Metric label="TI-RADS" value={result?.category ?? "待计算"} />
        <Metric label="分值" value={result?.score === null || result?.score === undefined ? "待计算" : String(result.score)} />
        <Metric label="特征来源" value={feature?.sourceModel ?? "待确认"} />
        <Metric label="长径" value={measurement?.longAxisMm === null || measurement?.longAxisMm === undefined ? "待测量" : `${measurement.longAxisMm}mm`} />
      </div>
      {result?.recommendation && <div className="text-muted mt-2">{result.recommendation}</div>}
      <div className="mt-3 border-t border-border pt-2">
        {feature?.requiresReview && (
          <div className="mb-2 rounded border border-warning/40 px-2 py-1 text-warning">
            已自动预填 TI-RADS 候选，请医生确认后保存。
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <FeatureSelect label="成分" value={featureForm.composition} options={TIRADS_FEATURE_OPTIONS.composition} onChange={(value) => updateFeature("composition", value)} />
          <FeatureSelect label="回声" value={featureForm.echogenicity} options={TIRADS_FEATURE_OPTIONS.echogenicity} onChange={(value) => updateFeature("echogenicity", value)} />
          <FeatureSelect label="形态" value={featureForm.shape} options={TIRADS_FEATURE_OPTIONS.shape} onChange={(value) => updateFeature("shape", value)} />
          <FeatureSelect label="边缘" value={featureForm.margin} options={TIRADS_FEATURE_OPTIONS.margin} onChange={(value) => updateFeature("margin", value)} />
          <FeatureSelect label="强回声灶" value={featureForm.echogenicFoci} options={TIRADS_FEATURE_OPTIONS.echogenicFoci} onChange={(value) => updateFeature("echogenicFoci", value)} />
        </div>
        <button
          type="button"
          className="btn-secondary mt-2"
          disabled={busy}
          data-medical-tirads-shortcut="confirm"
          data-medical-nodule-id={nodule.id}
          onClick={submitFeatures}
        >
          {savingFeatures ? "保存中..." : (feature?.requiresReview ? "确认并保存 TI-RADS 特征" : "保存 TI-RADS 特征")}
        </button>
        {featureError && <div className="text-danger mt-1">{featureError}</div>}
      </div>
      <div className="mt-2 flex flex-col gap-2">
        <label className="text-muted">
          检测框坐标 xyxy
          <input
            className={`${inputClass} mt-1 font-mono text-xs`}
            value={bboxText}
            onChange={(event) => setBboxText(event.target.value)}
            placeholder="10, 20, 30, 40"
          />
        </label>
        <button type="button" className="btn-secondary self-start" disabled={busy} onClick={submitRevision}>
          {revising ? "保存中..." : "保存修订"}
        </button>
        {editError && <div className="text-danger">{editError}</div>}
      </div>
    </div>
  );
}

function FeatureSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange(value: string): void;
}) {
  return (
    <label className="text-muted">
      {label}
      <select className={`${inputClass} mt-1 text-xs`} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">待选择</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </select>
    </label>
  );
}

function ReportRow({
  report,
  reviews,
  busy,
  reviewing,
  onReview,
}: {
  report: MedicalReport;
  reviews: MedicalDoctorReview[];
  busy: boolean;
  reviewing: boolean;
  onReview(
    action: MedicalReportReviewAction,
    finalText?: string,
    comment?: string,
    structured?: Record<string, unknown>
  ): void;
}) {
  const text = report.finalText ?? report.draftText ?? "";
  const sourceSections = reportSectionsFromText(text, report.structured);
  const [sections, setSections] = useState<ReportSection[]>(() => sourceSections);
  const [comment, setComment] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const canReview = report.status === "draft" || report.status === "pending_review";
  const canArchive = report.status === "confirmed";
  const editedText = composeReportText(sections);
  const structured = reportStructuredForSave(report, sections, comment);
  const sectionsDirty = !sameReportSections(sourceSections, sections);
  const textDirty = editedText !== text;
  const generator = stringValue(report.structured.generator) ?? report.createdByAgent ?? "doctor_workbench";

  useEffect(() => {
    setSections(sourceSections);
    setComment("");
    setActionError(null);
  }, [report.id, report.status, report.updatedAt, text, report.structured]);

  function submit(action: MedicalReportReviewAction) {
    if (action !== "reject" && editedText.trim().length === 0) {
      setActionError("报告正文不能为空。");
      return;
    }
    if ((action === "reject" || action === "archive") && !optionalText(comment)) {
      setActionError(action === "reject" ? "驳回时请填写审核意见。" : "归档时请填写归档说明。");
      return;
    }
    setActionError(null);
    onReview(
      action,
      action === "reject" ? undefined : editedText,
      optionalText(comment),
      action === "reject" ? undefined : structured
    );
  }

  function resetSections() {
    setSections(sourceSections);
    setActionError(null);
  }

  return (
    <div className="border border-border rounded p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-muted">{report.id}</span>
        <span className="border border-border rounded px-1.5 py-0.5">{statusLabel(report.status)}</span>
      </div>
      <div className="text-muted mt-1">
        {report.reportType} · {report.templateId ?? "无模板"} · {formatTime(report.updatedAt)}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
        <Metric label="生成器" value={generator} />
        <Metric label="段落" value={String(structuredSectionCount(structured))} />
        <Metric label="证据" value={String(report.evidence.length)} />
        <Metric label="历史" value={String(reviews.length)} />
      </div>
      <ReportVersionPanel report={report} reviews={reviews} dirty={sectionsDirty || textDirty} />
      {reportUsesTemplateDraft(report) && <ReportModelStageNotice report={report} />}
      {canReview ? (
        <div className="mt-2 space-y-2">
          <StructuredReportEditor
            sections={sections}
            dirty={sectionsDirty || textDirty}
            onChange={setSections}
            onReset={resetSections}
          />
          <div className="rounded border border-border px-2 py-1.5 text-muted">
            正文编辑只影响结构化段落与报告正文，下方证据引用保持固定，不会被手工改写。
          </div>
          <ReportEvidencePanel evidence={report.evidence} />
          <InlineReportReviewHistory reviews={reviews} />
          <label className="block text-muted">
            审核意见
            <input
              className={`${inputClass} mt-1 text-xs`}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="可选"
            />
          </label>
          {text !== editedText && (
            <ReportTextDiff beforeText={text} afterText={editedText} tone="warning" />
          )}
          {actionError && <div className="text-danger">{actionError}</div>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => submit("revise")}>
              {reviewing ? "保存中..." : "保存报告修订"}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              data-medical-report-shortcut="approve"
              data-medical-report-id={report.id}
              aria-keyshortcuts="Alt+Enter"
              onClick={() => submit("approve")}
            >
              {reviewing ? "处理中..." : "确认报告"}
            </button>
            <button
              type="button"
              className="btn-secondary border-danger text-danger"
              disabled={busy}
              onClick={() => submit("reject")}
            >
              驳回
            </button>
          </div>
        </div>
      ) : text ? (
        <div className="mt-2 space-y-2">
          <ReadonlyReportSections sections={sourceSections} />
          <ReportEvidencePanel evidence={report.evidence} />
          <InlineReportReviewHistory reviews={reviews} />
        </div>
      ) : null}
      {canArchive && (
        <div className="mt-2 space-y-2">
          <div className="rounded border border-border px-2 py-1.5 text-muted">
            已确认报告处于待归档状态，正文和证据引用只读；归档后需创建修订版本才能再次修改。
          </div>
          <label className="block text-muted">
            审核意见
            <input
              className={`${inputClass} mt-1 text-xs`}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="可选"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              data-medical-report-shortcut="archive"
              data-medical-report-id={report.id}
              aria-keyshortcuts="Alt+Shift+Enter"
              onClick={() => submit("archive")}
            >
              {reviewing ? "归档中..." : "审核归档"}
            </button>
            <span className="text-muted">确认医生：{report.confirmedBy ?? "医生"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

interface ReportSection {
  id: string;
  title: string;
  text: string;
  includeTitle: boolean;
}

function ReportVersionPanel({
  report,
  reviews,
  dirty,
}: {
  report: MedicalReport;
  reviews: MedicalDoctorReview[];
  dirty: boolean;
}) {
  const version = reportVersionNumber(report, reviews);
  const latestReview = [...reviews].sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
  const state = reportProductState(report, dirty);
  const fingerprint = reportEvidenceFingerprint(report.evidence);
  return (
    <div className="mt-2 rounded border border-border px-2 py-1.5 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">报告版本 v{version}</span>
        <span className={state.className}>{state.label}</span>
      </div>
      <div className="mt-1 grid grid-cols-2 md:grid-cols-4 gap-2">
        <Metric label="证据指纹" value={fingerprint} />
        <Metric label="证据锁定" value="已锁定" />
        <Metric label="最近动作" value={latestReview ? reviewActionLabel(latestReview.action) : "AI 草稿"} />
        <Metric label="更新时间" value={formatTime(report.updatedAt)} />
      </div>
      <div className="mt-1 text-[11px] text-muted">{state.description}</div>
    </div>
  );
}

function reportVersionNumber(report: MedicalReport, reviews: MedicalDoctorReview[]): number {
  return Math.max(1, reviews.filter((review) => review.reportId === report.id).length + 1);
}

function reportProductState(report: MedicalReport, dirty: boolean): { label: string; description: string; className: string } {
  if (report.status === "archived") {
    return {
      label: "只读归档",
      description: "归档报告不可直接覆盖；需要再次修改时应创建新的修订版本。",
      className: "rounded border border-border px-1.5 py-0.5 text-muted",
    };
  }
  if (report.status === "confirmed") {
    return {
      label: "待归档只读",
      description: "报告已确认，归档前正文和证据保持只读。",
      className: "rounded border border-border px-1.5 py-0.5 text-fg",
    };
  }
  if (dirty) {
    return {
      label: "有未保存修改",
      description: "保存报告修订会保留证据引用，并将报告维持在待审核状态。",
      className: "rounded border border-warning/40 px-1.5 py-0.5 text-warning",
    };
  }
  return {
    label: "可编辑待审核",
    description: "医生可编辑结构化段落；证据引用和模型依据不会随正文编辑而改变。",
    className: "rounded border border-border px-1.5 py-0.5 text-muted",
  };
}

function RealDemoModelNotice({
  reports,
  agentTasks,
}: {
  reports: MedicalReport[];
  agentTasks: MedicalAgentTask[];
}) {
  const draftReportTasks = agentTasks.filter((task) => task.taskType === "draft_report");
  const templateDrafts = reports.filter(reportUsesTemplateDraft).length;
  const queuedDrafts = draftReportTasks.filter((task) => task.status === "queued" || task.status === "pending").length;
  return (
    <div className="mb-2 rounded border border-border px-2 py-1.5 text-xs">
      <div className="font-semibold text-warning">真实演示提示：主报告大模型需手动加载</div>
      <div className="mt-1 text-muted">
        演示 Qwen 主报告生成前，请先在 5090 上加载 qwen/qwen3.5-9b。若使用自动演示 Runner，
        系统会在此阶段等待模型 loaded 后继续运行 draft_report / safety_review。未加载时系统会保留规则、知识库、分割和测量依据。
      </div>
      <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted">
        <span>模板草稿 {templateDrafts}</span>
        <span>报告生成任务 {draftReportTasks.length}</span>
        {queuedDrafts > 0 && <span className="text-warning">排队中 {queuedDrafts}</span>}
      </div>
    </div>
  );
}

function ReportModelStageNotice({ report }: { report: MedicalReport }) {
  const generator = stringValue(report.structured.generator) ?? "structured_template_validation";
  return (
    <div className="mt-2 rounded border border-border px-2 py-1.5 text-xs">
      <div className="font-medium text-warning">当前报告尚未由主报告大模型生成</div>
      <div className="mt-1 text-muted">
        生成器：{generator}。真实演示主报告阶段前，请手动加载 qwen/qwen3.5-9b；自动演示 Runner 会检测模型 loaded 后继续生成报告。
      </div>
    </div>
  );
}

function StructuredReportEditor({
  sections,
  dirty,
  onChange,
  onReset,
}: {
  sections: ReportSection[];
  dirty: boolean;
  onChange(next: ReportSection[]): void;
  onReset(): void;
}) {
  function updateSection(index: number, patch: Partial<ReportSection>) {
    onChange(sections.map((section, itemIndex) => itemIndex === index ? { ...section, ...patch } : section));
  }

  function addSection() {
    onChange([
      ...sections,
      { id: `section-${sections.length + 1}`, title: `补充段落 ${sections.length + 1}`, text: "", includeTitle: true },
    ]);
  }

  function duplicateSection(index: number) {
    const section = sections[index];
    if (!section) return;
    const copy: ReportSection = {
      ...section,
      id: `${section.id}-copy-${sections.length + 1}`,
      title: `${section.title} 副本`,
    };
    onChange([...sections.slice(0, index + 1), copy, ...sections.slice(index + 1)]);
  }

  function moveSection(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= sections.length) return;
    const next = [...sections];
    const [section] = next.splice(index, 1);
    next.splice(targetIndex, 0, section);
    onChange(next);
  }

  function removeSection(index: number) {
    if (sections.length <= 1) return;
    onChange(sections.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <div className="rounded border border-border p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">结构化段落编辑</span>
        <div className="flex flex-wrap gap-2">
          {dirty && <button type="button" className="btn-secondary" onClick={onReset}>重置改动</button>}
          <button type="button" className="btn-secondary" onClick={addSection}>新增段落</button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
        <Metric label="段落" value={String(sections.length)} />
        <Metric label="字符数" value={String(composeReportText(sections).length)} />
        <Metric label="标题数" value={String(sections.filter((section) => section.includeTitle).length)} />
        <Metric label="状态" value={dirty ? "已修改" : "未修改"} />
      </div>
      <div className="mt-2 space-y-2">
        {sections.map((section, index) => (
          <div key={section.id} className="rounded border border-border p-2">
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <label className="min-w-0 flex-1 text-muted">
                段落标题
                <input
                  className={`${inputClass} mt-1 text-xs`}
                  value={section.title}
                  onChange={(event) => updateSection(index, { title: event.target.value })}
                />
              </label>
              <div className="flex flex-wrap gap-2 md:mt-5">
                <button type="button" className="btn-secondary" disabled={index === 0} onClick={() => moveSection(index, -1)}>
                  上移
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={index === sections.length - 1}
                  onClick={() => moveSection(index, 1)}
                >
                  下移
                </button>
                <button type="button" className="btn-secondary" onClick={() => duplicateSection(index)}>
                  复制
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={sections.length <= 1}
                  onClick={() => removeSection(index)}
                >
                  删除
                </button>
              </div>
            </div>
            <label className="mt-2 flex items-center gap-2 text-muted">
              <input
                type="checkbox"
                checked={section.includeTitle}
                onChange={(event) => updateSection(index, { includeTitle: event.target.checked })}
              />
              正文包含段落标题
            </label>
            <label className="mt-2 block text-muted">
              段落内容
              <textarea
                aria-label={`段落内容 ${index + 1}`}
                className={`${inputClass} mt-1 min-h-24 font-mono text-xs`}
                value={section.text}
                onChange={(event) => updateSection(index, { text: event.target.value })}
              />
            </label>
          </div>
        ))}
      </div>
      <div className="mt-2 rounded border border-border bg-bg px-2 py-1.5">
        <div className="text-muted">报告正文预览</div>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
          {composeReportText(sections)}
        </pre>
      </div>
    </div>
  );
}

function ReadonlyReportSections({ sections }: { sections: ReportSection[] }) {
  return (
    <div className="mt-2 space-y-2">
      {sections.map((section) => (
        <div key={section.id} className="rounded border border-border px-2 py-1.5">
          {section.includeTitle && <div className="font-semibold">{section.title}</div>}
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
            {section.text || "无"}
          </pre>
        </div>
      ))}
    </div>
  );
}

interface ReportEvidenceDisplayRow {
  source: string;
  title: string;
  summary: string;
  detail: string | null;
  artifactUri: string | null;
}

function ReportEvidencePanel({ evidence }: { evidence: unknown[] }) {
  const rows = reportEvidenceRows(evidence);
  const sources = Array.from(new Set(rows.map((row) => row.source)));
  const sourceLabels = sources.map(reportEvidenceSourceDisplayLabel);
  const fingerprint = reportEvidenceFingerprint(evidence);
  return (
    <div className="mt-3 border-t border-border pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold">报告依据</span>
        <span className="text-muted">证据引用固定 · {rows.length} 项 · {fingerprint}</span>
      </div>
      {sources.length > 0 && (
        <div className="mt-1 text-[11px] text-muted">
          {sourceLabels.join(", ")}
        </div>
      )}
      <div className="mt-1 text-[11px] text-muted">
        证据引用固定，编辑正文不会改变这些来源。
      </div>
      {rows.length === 0 ? (
        <div className="mt-2 text-xs text-warning">未记录结构化报告依据，需医生人工复核。</div>
      ) : (
        <div className="mt-2 divide-y divide-border">
          {rows.map((row, index) => (
            <div key={`${row.source}-${index}`} className="py-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{index + 1}. {row.title}</span>
                <span className="rounded border border-border px-1.5 py-0.5 text-muted">{row.source}</span>
              </div>
              <div className="mt-1 text-muted">{row.summary}</div>
              {row.detail && <div className="mt-1 text-[11px] text-muted">{row.detail}</div>}
              {row.artifactUri && <ArtifactLine label="产物" value={row.artifactUri} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InlineReportReviewHistory({ reviews }: { reviews: MedicalDoctorReview[] }) {
  if (reviews.length === 0) return null;
  const latest = [...reviews].sort((left, right) => right.createdAt - left.createdAt).slice(0, 4);
  return (
    <div className="mt-3 border-t border-border pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-semibold">审核历史</span>
        <span className="text-muted">{reviews.length} 条</span>
      </div>
      <div className="mt-2 space-y-2">
        {latest.map((review) => (
          <div key={review.id} className="rounded border border-border px-2 py-1.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{reviewActionLabel(review.action)}</span>
              <span className="text-muted">{formatTime(review.createdAt)}</span>
            </div>
            <div className="mt-1 text-muted">{review.reviewerName}</div>
            <div className="mt-1 text-[11px] text-muted">
              {reviewStatusTransition(review.before, review.after)}
            </div>
            {review.comment && <div className="mt-1 text-muted">{review.comment}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function DoctorReviewRow({ review }: { review: MedicalDoctorReview }) {
  const before = review.before ?? {};
  const after = review.after ?? {};
  const beforeStatus = statusLabel(stringValue(before.status));
  const afterStatus = statusLabel(stringValue(after.status));
  const beforeText = stringValue(before.final_text) ?? stringValue(before.draft_text) ?? "";
  const afterText = stringValue(after.final_text) ?? stringValue(after.draft_text) ?? "";
  const textChanged = beforeText !== afterText;
  return (
    <div className="border border-border rounded p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{reviewActionLabel(review.action)}</span>
        <span className="border border-border rounded px-1.5 py-0.5">{review.reviewerName}</span>
      </div>
      <div className="text-muted mt-1">
        {review.reportId} · {formatTime(review.createdAt)}
      </div>
      <div className="mt-2 rounded border border-border px-2 py-1">
        {beforeStatus} → {afterStatus}
        {textChanged && <span className="ml-2 text-warning">文本 {beforeText.length} → {afterText.length}</span>}
      </div>
      <ReviewEvidenceSnapshot before={before} after={after} />
      {textChanged && <ReportTextDiff beforeText={beforeText} afterText={afterText} />}
      {review.comment && <div className="mt-2 text-muted">{review.comment}</div>}
    </div>
  );
}

function ReviewEvidenceSnapshot({
  before,
  after,
}: {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}) {
  const beforeCount = numberValue(before.evidence_count);
  const afterCount = numberValue(after.evidence_count);
  const beforeSources = stringList(before.evidence_sources).map(reportEvidenceSourceDisplayLabel);
  const afterSources = stringList(after.evidence_sources).map(reportEvidenceSourceDisplayLabel);
  if (beforeCount === null && afterCount === null && beforeSources.length === 0 && afterSources.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 rounded border border-border px-2 py-1.5 text-muted">
      <div className="font-semibold text-fg">证据快照</div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <Metric label="审核前证据" value={beforeCount === null ? "未知" : `${beforeCount} 项`} />
        <Metric label="审核后证据" value={afterCount === null ? "未知" : `${afterCount} 项`} />
      </div>
      <div className="mt-1 text-[11px]">
        {(afterSources.length > 0 ? afterSources : beforeSources).join(", ") || "无来源"}
      </div>
    </div>
  );
}

function ReportTextDiff({
  beforeText,
  afterText,
  tone = "default",
}: {
  beforeText: string;
  afterText: string;
  tone?: "default" | "warning";
}) {
  const diff = textDiffSummary(beforeText, afterText);
  const borderClass = tone === "warning" ? "border-warning/40 text-warning" : "border-border text-muted";
  return (
    <div className={`mt-2 rounded border px-2 py-1.5 text-xs ${borderClass}`}>
      <div className="font-semibold text-fg">修改痕迹</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
        <Metric label="原文字符" value={String(diff.beforeLength)} />
        <Metric label="新文字符" value={String(diff.afterLength)} />
        <Metric label="变化" value={diff.deltaLabel} />
        <Metric label="修改字符" value={String(diff.changedChars)} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
        <div>
          <div className="text-muted">原文片段</div>
          <div className="mt-1 rounded border border-border bg-bg px-2 py-1 font-mono text-[11px] whitespace-pre-wrap">
            {diff.beforeSnippet}
          </div>
        </div>
        <div>
          <div className="text-muted">新文片段</div>
          <div className="mt-1 rounded border border-border bg-bg px-2 py-1 font-mono text-[11px] whitespace-pre-wrap">
            {diff.afterSnippet}
          </div>
        </div>
      </div>
    </div>
  );
}

function AuditRow({
  audit,
  evidenceRows,
  reports,
}: {
  audit: MedicalAuditLog;
  evidenceRows: NoduleModelEvidence[];
  reports: MedicalReport[];
}) {
  const safetyStatus = statusLabel(stringValue(audit.detail.safety_status) ?? audit.action);
  const issues = Array.isArray(audit.detail.issues) ? audit.detail.issues : [];
  const bboxChange = bboxChangeLabel(audit.detail);
  const revisionEvidence = evidenceRowForAudit(audit, evidenceRows);
  return (
    <div className="border border-border rounded p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{safetyStatus}</span>
        <span className="border border-border rounded px-1.5 py-0.5">{auditActionLabel(audit.action)}</span>
      </div>
      <div className="text-muted mt-1">
        {actorTypeLabel(audit.actorType)}:{audit.actorId ?? "未知"} · {formatTime(audit.createdAt)}
      </div>
      {bboxChange && (
        <div className="mt-2 rounded border border-border px-2 py-1 font-mono text-[11px] text-muted">
          {bboxChange}
        </div>
      )}
      {issues.length > 0 && (
        <div className="mt-2 space-y-1">
          {issues.map((issue, index) => (
            <div key={index} className="rounded border border-warning/40 px-2 py-1 text-warning">
              {issueLabel(issue)}
            </div>
          ))}
        </div>
      )}
      {revisionEvidence && (
        <RevisionEvidenceDiff audit={audit} row={revisionEvidence} reports={reports} />
      )}
    </div>
  );
}

function RevisionEvidenceDiff({
  audit,
  row,
  reports,
}: {
  audit: MedicalAuditLog;
  row: NoduleModelEvidence;
  reports: MedicalReport[];
}) {
  const before = objectValue(audit.detail.before);
  const after = objectValue(audit.detail.after);
  const serverEvidence = objectValue(audit.detail.revision_evidence);
  const serverMeasurement = objectValue(serverEvidence?.measurement);
  const serverStatus = stringValue(serverEvidence?.status);
  const serverEvidenceSources = stringList(serverEvidence?.evidence_sources);
  const serverReportId = stringValue(serverEvidence?.report_id);
  const afterBbox = isNumberTuple4(after?.bbox) ? normalizedBbox(after.bbox) : null;
  const afterBboxError = afterBbox ? bboxValidationMessage(afterBbox) : null;
  const noduleMatchesRevision = !afterBbox || bboxNearlyEqual(row.nodule.bbox, afterBbox);
  const segmentationBbox = segmentationPromptBbox(row.segmentationEvidence);
  const segmentationMatchesRevision = !afterBbox || !segmentationBbox || bboxNearlyEqual(segmentationBbox, afterBbox);
  const evidenceMatchesRevision = !afterBboxError && noduleMatchesRevision && segmentationMatchesRevision;
  const latestReport = latestReportForNodule(reports, row.nodule);
  const hasFreshReport = !!latestReport && latestReport.updatedAt > audit.createdAt;
  const freshReport = hasFreshReport && evidenceMatchesRevision ? latestReport : null;
  const freshSegmentationEvidence = freshReport ? row.segmentationEvidence : null;
  const freshMeasurementEvidence = freshReport ? row.measurementEvidence : null;
  const freshMeasurement = evidenceMatchesRevision && row.measurement && row.measurement.createdAt > audit.createdAt ? row.measurement : null;
  const freshNodule = evidenceMatchesRevision && row.nodule.updatedAt > audit.createdAt ? row.nodule : null;
  const newMaskUri = serverEvidence
    ? stringValue(serverEvidence.new_mask_uri)
    : stringValue(freshSegmentationEvidence?.mask_uri) ?? freshNodule?.maskUri ?? null;
  const longAxisMm = serverEvidence
    ? numberValue(serverMeasurement?.long_axis_mm)
    : numberValue(freshMeasurementEvidence?.long_axis_mm) ?? freshMeasurement?.longAxisMm ?? null;
  const shortAxisMm = serverEvidence
    ? numberValue(serverMeasurement?.short_axis_mm)
    : numberValue(freshMeasurementEvidence?.short_axis_mm) ?? freshMeasurement?.shortAxisMm ?? null;
  const measurementLabel = longAxisMm === null && shortAxisMm === null
    ? "等待刷新"
    : `${formatMm(longAxisMm)} x ${formatMm(shortAxisMm)}`;
  const oldMaskUri = snapshotMaskUri(before);
  const sourceLabel = serverEvidence
    ? (serverEvidenceSources.length > 0 ? serverEvidenceSources.map(reportEvidenceSourceDisplayLabel).join(", ") : "等待刷新")
    : freshReport ? reportEvidenceSourceLabel(freshReport) : "等待刷新";
  const refreshStatus = serverStatus
    ? revisionEvidenceStatusLabel(serverStatus)
    : afterBboxError
    ? "无效修订框"
    : hasFreshReport && !evidenceMatchesRevision
      ? "检测框不匹配"
      : freshReport
        ? "已刷新"
        : "等待刷新";

  return (
    <div className="mt-3 border-t border-border pt-2">
      <div className="font-semibold">修订后依据变化</div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <Metric label="结节" value={`结节 ${row.nodule.noduleIndex}`} />
        <Metric label="刷新状态" value={refreshStatus} />
        <Metric label="原检测框" value={formatBbox(before?.bbox) || "未知"} />
        <Metric label="新检测框" value={formatBbox(after?.bbox) || "未知"} />
        <Metric label="原掩膜" value={oldMaskUri ? "已捕获" : "未捕获"} />
        <Metric label="新掩膜" value={newMaskUri ? "已生成" : "等待刷新"} />
        <Metric label="新测量" value={measurementLabel} />
        <Metric label="报告依据" value={sourceLabel} />
      </div>
      {oldMaskUri && <ArtifactLine label="原掩膜" value={oldMaskUri} />}
      {newMaskUri && <ArtifactLine label="新掩膜" value={newMaskUri} />}
      {(serverReportId || freshReport) && <ArtifactLine label="报告" value={serverReportId ?? freshReport!.id} />}
    </div>
  );
}

function revisionEvidenceStatusLabel(status: string): string {
  if (status === "invalid_revision_bbox") return "无效修订框";
  if (status === "pending_refresh") return "等待刷新";
  if (status === "bbox_mismatch") return "检测框不匹配";
  if (status === "refreshed") return "已刷新";
  return status;
}

function segmentationPromptBbox(evidence: Record<string, unknown> | null): number[] | null {
  const metadata = objectValue(evidence?.metadata);
  const value = evidence?.prompt_bbox
    ?? evidence?.prompt_bbox_xyxy
    ?? metadata?.prompt_bbox
    ?? metadata?.prompt_bbox_xyxy
    ?? metadata?.bbox;
  return isNumberTuple4(value) ? normalizedBbox(value) : null;
}

function bboxNearlyEqual(left: unknown, right: unknown): boolean {
  if (!isNumberTuple4(left) || !isNumberTuple4(right)) return false;
  const normalizedLeft = normalizedBbox(left);
  const normalizedRight = normalizedBbox(right);
  return normalizedLeft.every((value, index) => Math.abs(value - normalizedRight[index]) <= 1);
}

function ImageRow({
  image,
  busy,
  analyzing,
  onStart,
}: {
  image: MedicalImage;
  busy: boolean;
  analyzing: boolean;
  onStart(): void;
}) {
  const size = image.width && image.height ? `${image.width}×${image.height}` : "未知";
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-3 border border-border rounded p-2">
      <div className="min-w-0 flex-1">
        <div className="font-mono text-xs text-muted truncate">{image.id}</div>
        <div className="font-mono text-xs truncate mt-1">{image.fileUri}</div>
        <div className="text-xs text-muted mt-1">
          {image.fileType} · {size} · {statusLabel(image.processingStatus)}
        </div>
      </div>
      <button onClick={onStart} disabled={busy} className="btn-primary md:self-start">
        {analyzing ? "启动中..." : "启动分析"}
      </button>
    </div>
  );
}

function TaskRow({ task }: { task: MedicalAgentTask }) {
  return (
    <div className="border border-border rounded p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">{task.agentName}</span>
        <span className="border border-border rounded px-1.5 py-0.5">{statusLabel(task.status)}</span>
      </div>
      <div className="text-muted mt-1 truncate">{taskTypeLabel(task.taskType)}</div>
    </div>
  );
}

function StudyRow({
  study,
  selected,
  onSelect,
}: {
  study: MedicalRecentStudy;
  selected: boolean;
  onSelect(): void;
}) {
  const queue = recentStudyQueueMeta(study);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left border rounded p-3 hover:border-accent ${
        selected ? "border-accent bg-accent/5 ring-1 ring-accent/60 shadow-sm" : "border-border"
      }`}
    >
      <div className="flex items-start gap-3">
        <div>
          <div className="font-mono text-xs text-muted">{study.id}</div>
          <h4 className="text-sm font-semibold mt-1">
            {study.accessionNo ?? study.externalPatientId ?? "手工病例"}
          </h4>
        </div>
        <div className="ml-auto flex flex-col items-end gap-1">
          <span className="text-xs border border-border rounded px-2 py-1">{statusLabel(study.status)}</span>
          {selected && <span className="text-[11px] rounded px-2 py-0.5 border border-accent text-accent">当前</span>}
          <span className={`text-[11px] rounded px-2 py-0.5 ${queue.toneClass}`}>{queue.label}</span>
        </div>
      </div>
      <div className="mt-2 text-xs text-muted">{queue.reason}</div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3 text-xs">
        <Metric label="模态" value={`${study.modality}/${study.bodyPart}`} />
        <Metric label="来源" value={sourceTypeLabel(study.sourceType)} />
        <Metric label="图像" value={String(study.imageCount)} />
        <Metric label="结节" value={String(study.noduleCount)} />
        <Metric label="分析" value={statusLabel(study.latestAnalysisStatus)} />
        <Metric label="报告" value={statusLabel(study.latestReportStatus)} />
        <Metric label="更新时间" value={formatTime(study.updatedAt)} />
        <Metric label="创建者" value={study.createdBy ?? "本地"} />
      </div>
    </button>
  );
}

function QueueFilterBar({
  value,
  counts,
  onChange,
}: {
  value: StudyQueueFilter;
  counts: Record<StudyQueueFilter, number>;
  onChange(next: StudyQueueFilter): void;
}) {
  const filters: Array<{ id: StudyQueueFilter; label: string }> = [
    { id: "all", label: "全部" },
    { id: "tirads", label: "待确认特征" },
    { id: "review", label: "待审核报告" },
    { id: "archive", label: "待归档" },
    { id: "progress", label: "分析中" },
    { id: "exception", label: "异常/驳回" },
  ];
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {filters.map((filter) => (
        <button
          key={filter.id}
          type="button"
          className={value === filter.id ? "btn-primary text-xs" : "btn-secondary text-xs"}
          onClick={() => onChange(filter.id)}
        >
          {filter.label} {counts[filter.id] ?? 0}
        </button>
      ))}
    </div>
  );
}

function BatchQueueModeBar({
  filter,
  study,
  position,
  total,
  action,
  busy,
  onSelectPrev,
  onSelectNext,
  onTriggerAction,
}: {
  filter: StudyQueueFilter;
  study: MedicalRecentStudy | null;
  position: number;
  total: number;
  action: BatchQueueAction;
  busy: boolean;
  onSelectPrev(): void;
  onSelectNext(): void;
  onTriggerAction(): void;
}) {
  const queueMeta = study ? recentStudyQueueMeta(study) : null;
  const canTrigger = !busy && action.kind !== "none" && !action.reason;
  return (
    <div className="sticky top-0 z-10 rounded border border-border bg-bg/95 px-3 py-2 backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase text-muted">批量队列</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="font-semibold">{queueFilterLabel(filter)}</span>
            <span className="text-muted">{position} / {total}</span>
            {queueMeta && <span className={`text-[11px] rounded px-2 py-0.5 ${queueMeta.toneClass}`}>{queueMeta.label}</span>}
          </div>
          <div className="mt-1 text-sm">
            {study?.accessionNo ?? study?.externalPatientId ?? "未选中病例"}
          </div>
          <div className="mt-1 text-xs text-muted">
            {queueMeta?.reason ?? "选择队列病例后可连续处理。"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-xs" disabled={busy || position <= 1} onClick={onSelectPrev}>
            上一例
          </button>
          <button
            type="button"
            className="btn-primary text-xs"
            disabled={!canTrigger}
            onClick={onTriggerAction}
          >
            {action.label}
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={busy || position <= 0 || position >= total}
            onClick={onSelectNext}
          >
            下一例
          </button>
        </div>
      </div>
      {action.reason && <div className="mt-2 text-xs text-warning">{action.reason}</div>}
    </div>
  );
}

function EmptyQueueStateBar({
  filter,
  recommendedFilter,
  onSelectRecommended,
}: {
  filter: StudyQueueFilter;
  recommendedFilter: StudyQueueFilter | null;
  onSelectRecommended(next: StudyQueueFilter): void;
}) {
  return (
    <div className="sticky top-0 z-10 rounded border border-border bg-bg/95 px-3 py-2 backdrop-blur">
      <div className="text-[11px] uppercase text-muted">批量队列</div>
      <div className="mt-1 font-semibold">当前队列已清空</div>
      <div className="mt-1 text-xs text-muted">
        {queueFilterLabel(filter)} 已处理完。
      </div>
      {recommendedFilter ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">推荐下一队列：{queueFilterLabel(recommendedFilter)}</span>
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={() => onSelectRecommended(recommendedFilter)}
          >
            切换到 {queueFilterLabel(recommendedFilter)}
          </button>
        </div>
      ) : (
        <div className="mt-2 text-xs text-muted">当前没有其他待处理队列。</div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-muted">{label}</div>
      <div className="font-medium truncate">{value}</div>
    </div>
  );
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "未知";
  return new Date(value).toLocaleString();
}

function sortedWorkQueueStudies(studies: MedicalRecentStudy[]): MedicalRecentStudy[] {
  return [...studies].sort((left, right) => {
    const leftPriority = recentStudyQueueMeta(left).priority;
    const rightPriority = recentStudyQueueMeta(right).priority;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return right.updatedAt - left.updatedAt;
  });
}

function queueAdvancePlan(
  summary: MedicalSummary | null,
  filter: StudyQueueFilter,
  currentStudyId: string | null
): { filter: StudyQueueFilter; currentStudyId: string; currentIndex: number } | null {
  if (!summary || !currentStudyId || filter === "all") return null;
  const filtered = sortedWorkQueueStudies(summary.recentStudies).filter((study) => queueFilterMatches(study, filter));
  const currentIndex = filtered.findIndex((study) => study.id === currentStudyId);
  return currentIndex >= 0 ? { filter, currentStudyId, currentIndex } : null;
}

function nextQueueStudyId(
  summary: MedicalSummary | null,
  plan: { filter: StudyQueueFilter; currentStudyId: string; currentIndex: number } | null
): string | null {
  if (!summary || !plan) return null;
  const filtered = sortedWorkQueueStudies(summary.recentStudies).filter((study) => queueFilterMatches(study, plan.filter));
  if (filtered.some((study) => study.id === plan.currentStudyId)) return null;
  return filtered[plan.currentIndex]?.id ?? filtered[plan.currentIndex - 1]?.id ?? null;
}

function workQueueCounts(studies: MedicalRecentStudy[]): Record<StudyQueueFilter, number> {
  return {
    all: studies.length,
    tirads: studies.filter((study) => queueFilterMatches(study, "tirads")).length,
    review: studies.filter((study) => queueFilterMatches(study, "review")).length,
    archive: studies.filter((study) => queueFilterMatches(study, "archive")).length,
    progress: studies.filter((study) => queueFilterMatches(study, "progress")).length,
    exception: studies.filter((study) => queueFilterMatches(study, "exception")).length,
  };
}

function nextRecommendedQueueFilter(
  counts: Record<StudyQueueFilter, number>,
  current: StudyQueueFilter
): StudyQueueFilter | null {
  const priority: StudyQueueFilter[] = ["tirads", "review", "archive", "exception", "progress"];
  for (const filter of priority) {
    if (filter !== current && (counts[filter] ?? 0) > 0) return filter;
  }
  return null;
}

function batchQueuePrimaryAction(filter: StudyQueueFilter, bundle: MedicalStudyBundle | null): BatchQueueAction {
  if (filter === "tirads") {
    if (!bundle) {
      return { kind: "confirm_tirads", label: "确认特征并下一例", reason: "正在加载病例详情。", noduleId: null };
    }
    const targetNoduleId = firstPendingTiradsNoduleId(bundle);
    return {
      kind: "confirm_tirads",
      label: "确认特征并下一例",
      reason: targetNoduleId ? null : "当前病例没有可直接确认的 TI-RADS 预填特征。",
      noduleId: targetNoduleId,
    };
  }
  if (filter === "review") {
    if (!bundle) {
      return { kind: "confirm_report", label: "确认并下一例", reason: "正在加载病例详情。", reportId: null };
    }
    const report = latestReportByStatuses(bundle.reports, ["draft", "pending_review"]);
    return {
      kind: "confirm_report",
      label: "确认并下一例",
      reason: report ? null : "当前病例没有待审核报告。",
      reportId: report?.id ?? null,
    };
  }
  if (filter === "archive") {
    if (!bundle) {
      return { kind: "archive_report", label: "归档并下一例", reason: "正在加载病例详情。", reportId: null };
    }
    const report = latestReportByStatuses(bundle.reports, ["confirmed"]);
    return {
      kind: "archive_report",
      label: "归档并下一例",
      reason: report ? null : "当前病例没有可归档报告。",
      reportId: report?.id ?? null,
    };
  }
  if (filter === "progress") {
    return { kind: "none", label: "当前队列无批量动作", reason: "分析中病例请等待模型链路完成。" };
  }
  if (filter === "exception") {
    return { kind: "none", label: "当前队列无批量动作", reason: "异常病例需人工判断后再处理。" };
  }
  return { kind: "none", label: "当前队列无批量动作", reason: null };
}

function queueFilterMatches(study: MedicalRecentStudy, filter: StudyQueueFilter): boolean {
  const stage = recentStudyQueueMeta(study).stage;
  if (filter === "all") return true;
  if (filter === "tirads") return stage === "waiting_tirads_confirmation";
  if (filter === "review") return stage === "pending_report_review";
  if (filter === "archive") return stage === "ready_archive";
  if (filter === "progress") return stage === "analysis_in_progress";
  return stage === "analysis_failed" || stage === "report_rejected";
}

function recentStudyQueueMeta(study: MedicalRecentStudy): {
  stage: string;
  label: string;
  reason: string;
  priority: number;
  toneClass: string;
} {
  const stage = study.queueStage ?? fallbackRecentStudyQueueStage(study);
  const reason = study.queueReason ?? fallbackRecentStudyQueueReason(stage);
  if (stage === "waiting_tirads_confirmation") {
    return { stage, label: "待确认特征", reason, priority: study.queuePriority ?? 30, toneClass: "border border-warning/40 text-warning" };
  }
  if (stage === "pending_report_review") {
    return { stage, label: "待审核报告", reason, priority: study.queuePriority ?? 10, toneClass: "border border-warning/40 text-warning" };
  }
  if (stage === "ready_archive") {
    return { stage, label: "待归档", reason, priority: study.queuePriority ?? 20, toneClass: "border border-border text-fg" };
  }
  if (stage === "analysis_in_progress") {
    return { stage, label: "分析中", reason, priority: study.queuePriority ?? 50, toneClass: "border border-border text-muted" };
  }
  if (stage === "analysis_failed" || stage === "report_rejected") {
    return { stage, label: "异常", reason, priority: study.queuePriority ?? 5, toneClass: "border border-danger/40 text-danger" };
  }
  if (stage === "archived") {
    return { stage, label: "已归档", reason, priority: study.queuePriority ?? 90, toneClass: "border border-border text-muted" };
  }
  return { stage, label: "待处理", reason, priority: study.queuePriority ?? 60, toneClass: "border border-border text-muted" };
}

function latestReportByStatuses(reports: MedicalReport[], statuses: string[]): MedicalReport | null {
  const matches = reports
    .filter((report) => statuses.includes(report.status))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  return matches[0] ?? null;
}

function firstPendingTiradsNoduleId(bundle: MedicalStudyBundle): string | null {
  const featureByNodule = latestTiradsFeatureByNodule(bundle.tiradsFeatures);
  for (const nodule of bundle.nodules) {
    const feature = featureByNodule.get(nodule.id);
    if (feature?.requiresReview) return nodule.id;
  }
  return null;
}

function queueFilterLabel(filter: StudyQueueFilter): string {
  if (filter === "tirads") return "待确认特征";
  if (filter === "review") return "待审核报告";
  if (filter === "archive") return "待归档";
  if (filter === "progress") return "分析中";
  if (filter === "exception") return "异常/驳回";
  return "全部";
}

function fallbackRecentStudyQueueStage(study: MedicalRecentStudy): string {
  if (study.latestReportStatus === "draft" || study.latestReportStatus === "pending_review") return "pending_report_review";
  if (study.latestReportStatus === "confirmed") return "ready_archive";
  if (study.latestReportStatus === "archived") return "archived";
  if (study.latestAnalysisStatus === "failed") return "analysis_failed";
  if (study.latestAnalysisStatus === "queued" || study.latestAnalysisStatus === "running") return "analysis_in_progress";
  if (study.imageCount === 0) return "awaiting_image";
  return "ready_to_start";
}

function fallbackRecentStudyQueueReason(stage: string): string {
  if (stage === "pending_report_review") return "等待医生审核报告草稿";
  if (stage === "ready_archive") return "报告已确认，等待归档";
  if (stage === "archived") return "病例已归档";
  if (stage === "analysis_failed") return "AI 分析失败，等待复核或重跑";
  if (stage === "analysis_in_progress") return "AI 分析进行中";
  if (stage === "awaiting_image") return "等待上传图像";
  return "可启动 AI 分析";
}

function reportSectionsFromText(text: string, structured: Record<string, unknown>): ReportSection[] {
  const structuredSections = recordList(structured.sections)
    .map((section, index) => {
      const sectionText = stringValue(section.text) ?? stringValue(section.content) ?? "";
      return {
        id: stringValue(section.id) ?? `structured-${index + 1}`,
        title: stringValue(section.title) ?? `段落 ${index + 1}`,
        text: sectionText,
        includeTitle: booleanValue(section.includeTitle) ?? true,
      };
    })
    .filter((section) => section.text.trim().length > 0 || section.title.trim().length > 0);
  if (structuredSections.length > 0) return structuredSections;

  const lines = text.split(/\r?\n/);
  const sections = lines.map((line, index) => {
    const trimmed = line.trim();
    const heading = trimmed.match(/^([^：:]{1,24})[：:]\s*(.*)$/);
    if (heading) {
      return {
        id: `line-${index + 1}`,
        title: heading[1].trim(),
        text: heading[2].trim(),
        includeTitle: true,
      };
    }
    return {
      id: `line-${index + 1}`,
      title: `段落 ${index + 1}`,
      text: line,
      includeTitle: false,
    };
  });
  return sections.length > 0 ? sections : [{ id: "line-1", title: "段落 1", text: "", includeTitle: false }];
}

function reportStructuredForSave(
  report: MedicalReport,
  sections: ReportSection[],
  comment: string
): Record<string, unknown> {
  const evidenceSources = Array.from(new Set(reportEvidenceRows(report.evidence).map((row) => row.source)));
  const nextStructured = {
    ...report.structured,
    sections: serializeReportSections(sections),
    editor: {
      mode: "doctor_workbench_v1",
      evidence_locked: true,
      evidence_count: report.evidence.length,
      evidence_sources: evidenceSources,
      evidence_fingerprint: reportEvidenceFingerprint(report.evidence),
      base_report_id: report.id,
      base_report_updated_at: report.updatedAt,
      section_count: sections.length,
      last_comment: optionalText(comment) ?? null,
      updated_at: Date.now(),
    },
  };
  return nextStructured;
}

function serializeReportSections(sections: ReportSection[]): Array<Record<string, unknown>> {
  return sections
    .map((section) => ({
      id: section.id,
      title: section.title.trim(),
      text: section.text,
      includeTitle: section.includeTitle,
    }))
    .filter((section) => section.text.trim().length > 0 || (section.includeTitle && section.title.trim().length > 0));
}

function sameReportSections(left: ReportSection[], right: ReportSection[]): boolean {
  return JSON.stringify(serializeReportSections(left)) === JSON.stringify(serializeReportSections(right));
}

function structuredSectionCount(structured: Record<string, unknown>): number {
  return serializeReportSections(reportSectionsFromText("", structured)).length;
}

function composeReportText(sections: ReportSection[]): string {
  const rendered = sections.map((section) => {
      const title = section.title.trim();
      const text = section.text.trimEnd();
      if (!section.includeTitle || !title) return text;
      return text ? `${title}：${text}` : `${title}：`;
    });
  while (rendered.length > 1 && rendered[rendered.length - 1] === "") rendered.pop();
  return rendered.join("\n");
}

function textDiffSummary(beforeText: string, afterText: string): {
  beforeLength: number;
  afterLength: number;
  deltaLabel: string;
  changedChars: number;
  beforeSnippet: string;
  afterSnippet: string;
} {
  const beforeLength = beforeText.length;
  const afterLength = afterText.length;
  let prefix = 0;
  while (prefix < beforeLength && prefix < afterLength && beforeText[prefix] === afterText[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < beforeLength - prefix
    && suffix < afterLength - prefix
    && beforeText[beforeLength - 1 - suffix] === afterText[afterLength - 1 - suffix]
  ) {
    suffix += 1;
  }
  const beforeChanged = beforeText.slice(prefix, beforeLength - suffix);
  const afterChanged = afterText.slice(prefix, afterLength - suffix);
  const delta = afterLength - beforeLength;
  return {
    beforeLength,
    afterLength,
    deltaLabel: delta === 0 ? "0" : `${delta > 0 ? "+" : ""}${delta}`,
    changedChars: Math.max(beforeChanged.length, afterChanged.length),
    beforeSnippet: compactTextSnippet(beforeChanged || beforeText),
    afterSnippet: compactTextSnippet(afterChanged || afterText),
  };
}

function reviewStatusTransition(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): string {
  const beforeStatus = statusLabel(stringValue(before?.status));
  const afterStatus = statusLabel(stringValue(after?.status));
  const beforeCount = numberValue(before?.evidence_count);
  const afterCount = numberValue(after?.evidence_count);
  const countLabel = beforeCount === null && afterCount === null
    ? ""
    : ` · 证据 ${beforeCount ?? "?"} -> ${afterCount ?? "?"}`;
  return `${beforeStatus} -> ${afterStatus}${countLabel}`;
}

function compactTextSnippet(value: string): string {
  const normalized = value.trim();
  if (!normalized) return "无";
  if (normalized.length <= 120) return normalized;
  return `${normalized.slice(0, 60)} ... ${normalized.slice(-40)}`;
}

function compactOptionalText(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  return compactTextSnippet(value);
}

function formatOptionalNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "未知" : value.toFixed(2);
}

function formatBbox(value: unknown): string {
  return isNumberTuple4(value) ? value.map((item) => Number(item.toFixed(2))).join(", ") : "";
}

function parseBboxInput(value: string): number[] | string {
  const parts = value.split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 4) return "检测框需要 4 个数字：x1, y1, x2, y2";
  const numbers = parts.map(Number);
  if (!numbers.every(Number.isFinite)) return "检测框只能包含有限数字";
  const validationError = bboxValidationMessage(numbers);
  if (validationError) return validationError;
  return normalizedBbox(numbers);
}

function isNumberTuple4(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 4 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function firstOverlaySelection(
  images: MedicalImage[],
  nodules: MedicalNodule[],
  modelJobs: MedicalModelJob[]
): OverlaySelection | null {
  for (const job of modelJobs) {
    const artifacts = objectValue(job.output?.artifacts);
    const overlayUri = stringValue(artifacts?.overlay_image);
    if (!overlayUri) continue;
    const image = images.find((item) => item.id === job.imageId) ?? images[0];
    if (!image) continue;
    const imageNodules = nodules.filter((nodule) => nodule.imageId === image.id);
    if (imageNodules.length > 0) return { image, overlayUri, nodules: imageNodules };
  }
  return null;
}

function bboxStyle(bbox: unknown, image: MedicalImage): CSSProperties | null {
  if (!isNumberTuple4(bbox) || !image.width || !image.height) return null;
  const [x1, y1, x2, y2] = normalizedBbox(bbox);
  const left = clampNumber(x1, 0, image.width);
  const top = clampNumber(y1, 0, image.height);
  const right = clampNumber(x2, 0, image.width);
  const bottom = clampNumber(y2, 0, image.height);
  return {
    left: `${(left / image.width) * 100}%`,
    top: `${(top / image.height) * 100}%`,
    width: `${(Math.max(0, right - left) / image.width) * 100}%`,
    height: `${(Math.max(0, bottom - top) / image.height) * 100}%`,
  };
}

function mousePointToImagePoint(event: ReactMouseEvent<HTMLDivElement>, image: MedicalImage): ImagePoint | null {
  const rect = event.currentTarget.getBoundingClientRect();
  const imageWidth = image.width ?? rect.width;
  const imageHeight = image.height ?? rect.height;
  if (rect.width <= 0 || rect.height <= 0 || imageWidth <= 0 || imageHeight <= 0) return null;
  const x = ((event.clientX - rect.left) / rect.width) * imageWidth;
  const y = ((event.clientY - rect.top) / rect.height) * imageHeight;
  return {
    x: clampNumber(round2(x), 0, imageWidth),
    y: clampNumber(round2(y), 0, imageHeight),
  };
}

function bboxFromPoints(start: ImagePoint, end: ImagePoint): number[] {
  return normalizedBbox([start.x, start.y, end.x, end.y]);
}

function bboxValidationMessage(value: number[]): string | null {
  const [x1, y1, x2, y2] = normalizedBbox(value);
  if (x2 - x1 < MIN_REVISION_BBOX_EDGE_PX || y2 - y1 < MIN_REVISION_BBOX_EDGE_PX) {
    return "检测框宽度和高度至少需要 1 像素，请重新拖拽框选。";
  }
  return null;
}

function normalizedBbox(value: number[]): number[] {
  const [x1, y1, x2, y2] = value;
  return [
    round2(Math.min(x1, x2)),
    round2(Math.min(y1, y2)),
    round2(Math.max(x1, x2)),
    round2(Math.max(y1, y2)),
  ];
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function recordList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.map(objectValue).filter((item): item is Record<string, unknown> => item !== undefined)
    : [];
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input"
    || tagName === "textarea"
    || tagName === "select"
    || target.isContentEditable;
}

function numberLabel(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "0";
}

function formatUnknownNumber(value: unknown): string {
  const number = numberValue(value);
  return number === null ? "待生成" : number.toFixed(2);
}

function formatNullableNumber(value: number | null): string {
  return value === null ? "待生成" : value.toFixed(2);
}

function formatMm(value: number | null): string {
  return value === null ? "待生成" : `${value.toFixed(2)} mm`;
}

function formatArea(value: number | null): string {
  return value === null ? "待生成" : `${value.toFixed(2)} mm2`;
}

function formatNumberList(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "待生成";
  const numbers = value.map(numberValue);
  if (numbers.some((item) => item === null)) return "待生成";
  return numbers.map((item) => item!.toFixed(2).replace(/\.00$/, "")).join(", ");
}

function formatPixelMeasurements(value: Record<string, unknown> | undefined): string {
  if (!value) return "待生成";
  const parts = Object.entries(value)
    .map(([key, raw]) => {
      const number = numberValue(raw);
      return number === null ? null : `${key}=${number.toFixed(2).replace(/\.00$/, "")}`;
    })
    .filter((item): item is string => item !== null);
  return parts.length === 0 ? "待生成" : parts.join(", ");
}

function gpuLabel(result: Record<string, unknown> | null): string {
  const runtime = objectValue(result?.runtime);
  const gpu = objectValue(runtime?.gpu);
  if (!gpu) return "未知";
  if (gpu.cuda_available === true) {
    const count = typeof gpu.device_count === "number" ? gpu.device_count : 0;
    return `cuda:${count}`;
  }
  return "无 CUDA";
}

function issueLabel(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return String(value);
  const record = value as Record<string, unknown>;
  return [record.rule_code, record.severity, record.message].filter((item) => typeof item === "string").join(" · ");
}

function bboxChangeLabel(detail: Record<string, unknown>): string | null {
  const before = objectValue(detail.before);
  const after = objectValue(detail.after);
  if (!isNumberTuple4(before?.bbox) || !isNumberTuple4(after?.bbox)) return null;
  return `检测框 ${formatBbox(before.bbox)} → ${formatBbox(after.bbox)}`;
}

function medicalActiveWorkPollKey(bundle: MedicalStudyBundle): string {
  const waitingDoctorInput = isWaitingDoctorTiradsInput(bundle);
  const taskKey = bundle.agentTasks
    .filter((task) => shouldPollMedicalTask(task, waitingDoctorInput))
    .map((task) => `${task.id}:${task.status}:${task.updatedAt}`)
    .join("|");
  const modelJobKey = bundle.modelJobs
    .filter((job) => isActiveMedicalStatus(job.status))
    .map((job) => `${job.id}:${job.status}:${job.updatedAt}`)
    .join("|");
  return [taskKey, modelJobKey].filter(Boolean).join(";");
}

function shouldPollMedicalTask(task: MedicalAgentTask, waitingDoctorInput: boolean): boolean {
  if (!isActiveMedicalStatus(task.status)) return false;
  if (waitingDoctorInput && task.status === "queued") return false;
  return true;
}

function isWaitingDoctorTiradsInput(bundle: MedicalStudyBundle): boolean {
  return bundle.agentTasks.some((task) => task.taskType === "calculate_tirads" && task.status === "queued")
    && !bundleHasConfirmedTiradsFeature(bundle);
}

function bundleHasConfirmedTiradsFeature(bundle: MedicalStudyBundle): boolean {
  if (bundle.nodules.length === 0) return false;
  const latestByNodule = latestTiradsFeatureByNodule(bundle.tiradsFeatures);
  return bundle.nodules.every((nodule) => {
    const feature = latestByNodule.get(nodule.id);
    if (!feature || feature.requiresReview) return false;
    const features = feature.features;
    return ["composition", "echogenicity", "shape", "margin", "echogenic_foci"].every((key) => {
      const value = features[key];
      return Array.isArray(value) ? value.length > 0 : typeof value === "string" && value.trim().length > 0;
    });
  });
}

function isActiveMedicalStatus(status: string): boolean {
  return status === "queued" || status === "running" || status === "waiting_model";
}

const inputClass = "w-full min-w-0 rounded border border-border bg-bg px-2 py-1.5 text-sm text-fg";

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}
