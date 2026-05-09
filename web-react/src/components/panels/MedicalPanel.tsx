import type { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  createMedicalImage,
  createMedicalPatient,
  createMedicalStudy,
  getMedicalStudy,
  getMedicalModelGatewayCheck,
  getMedicalSummary,
  medicalArtifactUrl,
  reviewMedicalReport,
  reviseMedicalNodule,
  searchMedicalKnowledge,
  startMedicalAnalysis,
  type MedicalAgentTask,
  type MedicalAuditLog,
  type MedicalDoctorReview,
  type MedicalImage,
  type MedicalKnowledgeSearchResult,
  type MedicalModelGatewayCheck,
  type MedicalModelJob,
  type MedicalNodule,
  type MedicalRecentStudy,
  type MedicalReport,
  type MedicalStudyBundle,
  type MedicalSummary,
  type MedicalTiradsResult,
} from "@/api/endpoints";

interface Props {
  onError(msg: string | null): void;
}

const COUNT_LABELS: Array<[keyof MedicalSummary["counts"], string]> = [
  ["patients", "Patients"],
  ["studies", "Studies"],
  ["images", "Images"],
  ["analysisSessions", "Analysis"],
  ["nodules", "Nodules"],
  ["reports", "Reports"],
  ["pendingReviews", "Review"],
];

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
  const [knowledgeQuery, setKnowledgeQuery] = useState("TI-RADS TR4");
  const [knowledgeResult, setKnowledgeResult] = useState<MedicalKnowledgeSearchResult | null>(null);
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);

  async function refresh() {
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
    } catch (err) {
      const message = `Medical 加载失败：${(err as Error).message}`;
      setLocalError(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function loadStudyDetail(studyId: string) {
    setDetailBusy(true);
    setDetailError(null);
    try {
      const result = await getMedicalStudy(studyId);
      setStudyBundle(result.bundle);
    } catch (err) {
      const message = `Medical 病例加载失败：${(err as Error).message}`;
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
      const message = `Medical 分析启动失败：${(err as Error).message}`;
      setDetailError(message);
      onError(message);
    } finally {
      setAnalysisBusyImageId(null);
    }
  }

  async function reviewReport(report: MedicalReport, action: "approve" | "reject", finalText?: string, comment?: string) {
    setReviewBusyReportId(report.id);
    setDetailError(null);
    try {
      const result = await reviewMedicalReport(report.id, {
        action,
        finalText: action === "approve" ? finalText ?? report.finalText ?? report.draftText ?? undefined : undefined,
        comment,
      });
      setStudyBundle(result.bundle);
      await refresh();
    } catch (err) {
      const message = `Medical 报告审核失败：${(err as Error).message}`;
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
      const message = `Medical 结节修订失败：${(err as Error).message}`;
      setDetailError(message);
      onError(message);
      throw err;
    } finally {
      setNoduleBusyId(null);
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
      const message = `Medical 证据检索失败：${(err as Error).message}`;
      setKnowledgeError(message);
      onError(message);
    } finally {
      setKnowledgeBusy(false);
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
      await createMedicalImage({
        studyId: study.study.id,
        fileUri: imageUri,
        fileType: optionalText(manualCase.fileType),
        width: optionalNumber(manualCase.width),
        height: optionalNumber(manualCase.height),
      });
      setManualCase(EMPTY_MANUAL_CASE);
      setFormMessage(`已登记 ${accessionNo}`);
      setSelectedStudyId(study.study.id);
      await Promise.all([refresh(), loadStudyDetail(study.study.id)]);
    } catch (err) {
      const message = `Medical 登记失败：${(err as Error).message}`;
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
    return <div className="p-4 text-sm text-muted">Loading medical workspace...</div>;
  }

  if (!summary.enabled) {
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">Medical Workstation</h2>
          <button onClick={refresh} disabled={busy} className="btn-secondary text-sm">
            {busy ? "刷新中..." : "刷新"}
          </button>
        </div>
        <div className="border border-warning rounded p-3 text-sm text-warning">
          {summary.message ?? "medical storage disabled"}
        </div>
        <ModelGatewayStatus check={gatewayCheck} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] min-h-0 h-full">
      <aside className="border-b lg:border-b-0 lg:border-r border-border p-4 overflow-y-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold">Medical Workstation</h2>
            <p className="text-xs text-muted">{summary.recentStudies.length} recent study(s)</p>
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

        <QueueBlock title="Model Jobs" values={summary.queues.modelJobs} />
        <QueueBlock title="Agent Tasks" values={summary.queues.agentTasks} />
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

        <StudyDetail
          bundle={studyBundle}
          busy={detailBusy}
          error={detailError}
          analyzingImageId={analysisBusyImageId}
          reviewingReportId={reviewBusyReportId}
          revisingNoduleId={noduleBusyId}
          onStartAnalysis={launchAnalysis}
          onReviewReport={reviewReport}
          onReviseNodule={reviseNodule}
        />

        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold">Recent Studies</h3>
          {summary.warnings.length > 0 && (
            <span className="text-xs text-warning">{summary.warnings.join(", ")}</span>
          )}
        </div>
        {summary.recentStudies.length === 0 ? (
          <p className="text-sm text-muted">暂无甲状腺超声验证病例。</p>
        ) : (
          <div className="space-y-2">
            {summary.recentStudies.map((study) => (
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
        <h3 className="text-sm font-bold">Manual Case</h3>
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? "登记中..." : "登记"}
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
            <option value="F">F</option>
            <option value="M">M</option>
            <option value="O">O</option>
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
            <span>{result.mode}</span>
            <span>{result.count} evidence</span>
            {result.warnings.map((warning) => (
              <span key={warning} className="text-warning">{warning}</span>
            ))}
          </div>
          {result.evidence.length === 0 ? (
            <div className="text-sm text-muted border border-border rounded p-2">none</div>
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

function QueueBlock({ title, values }: { title: string; values: Record<string, number> }) {
  const entries = Object.entries(values);
  return (
    <div>
      <h3 className="text-xs uppercase text-muted mb-2">{title}</h3>
      {entries.length === 0 ? (
        <div className="text-sm text-muted border border-border rounded p-2">none</div>
      ) : (
        <div className="space-y-1">
          {entries.map(([status, count]) => (
            <div key={status} className="flex items-center justify-between text-sm border border-border rounded px-2 py-1.5">
              <span>{status}</span>
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
      <h3 className="text-xs uppercase text-muted mb-2">Model Gateway</h3>
      <div className="border border-border rounded p-2 text-xs space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{status}</span>
          <span className="border border-border rounded px-1.5 py-0.5">
            {check?.reachable ? "online" : "offline"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="ready" value={readyDetectors.length > 0 ? readyDetectors.join(", ") : "none"} />
          <Metric label="gpu" value={gpuLabel(result)} />
          <Metric label="latency" value={check ? `${check.durationMs}ms` : "pending"} />
          <Metric label="checked" value={check ? formatTime(check.checkedAt) : "pending"} />
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
  onStartAnalysis,
  onReviewReport,
  onReviseNodule,
}: {
  bundle: MedicalStudyBundle | null;
  busy: boolean;
  error: string | null;
  analyzingImageId: string | null;
  reviewingReportId: string | null;
  revisingNoduleId: string | null;
  onStartAnalysis(imageId: string): void;
  onReviewReport(report: MedicalReport, action: "approve" | "reject", finalText?: string, comment?: string): void;
  onReviseNodule(nodule: MedicalNodule, bbox: number[]): Promise<void>;
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
    tiradsResults,
    reports,
    auditLogs,
    doctorReviews,
    modelJobs,
    analysisSessions,
    agentTasks,
  } = bundle;
  return (
    <div className="border border-border rounded p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-muted">{study.id}</div>
          <h3 className="text-sm font-bold mt-1">{study.accessionNo ?? "manual study"}</h3>
          <p className="text-xs text-muted mt-1">
            {patient?.externalPatientId ?? "unknown patient"} · {study.modality}/{study.bodyPart}
          </p>
        </div>
        <span className="text-xs border border-border rounded px-2 py-1">{study.status}</span>
      </div>

      {error && <div className="mt-3 text-sm text-danger">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-xs">
        <Metric label="source" value={study.sourceType} />
        <Metric label="images" value={String(images.length)} />
        <Metric label="nodules" value={String(nodules.length)} />
        <Metric label="reports" value={String(reports.length)} />
        <Metric label="audits" value={String(auditLogs.length)} />
        <Metric label="model jobs" value={String(modelJobs.length)} />
        <Metric label="analysis" value={String(analysisSessions.length)} />
        <Metric label="tasks" value={String(agentTasks.length)} />
      </div>

      <div className="mt-4">
        <h4 className="text-xs uppercase text-muted mb-2">Images</h4>
        {images.length === 0 ? (
          <div className="text-sm text-muted border border-border rounded p-2">none</div>
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
        <h4 className="text-xs uppercase text-muted mb-2">AI Results</h4>
        {nodules.length === 0 && tiradsResults.length === 0 ? (
          <div className="text-sm text-muted border border-border rounded p-2">none</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {nodules.map((nodule) => (
              <NoduleResultRow
                key={nodule.id}
                nodule={nodule}
                result={tiradsResults.find((item) => item.noduleId === nodule.id) ?? null}
                busy={busy || revisingNoduleId !== null}
                revising={revisingNoduleId === nodule.id}
                onRevise={(bbox) => onReviseNodule(nodule, bbox)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <h4 className="text-xs uppercase text-muted mb-2">Reports</h4>
        {reports.length === 0 ? (
          <div className="text-sm text-muted border border-border rounded p-2">none</div>
        ) : (
          <div className="space-y-2">
            {reports.map((report) => (
              <ReportRow
                key={report.id}
                report={report}
                busy={busy || reviewingReportId !== null}
                reviewing={reviewingReportId === report.id}
                onReview={(action, finalText, comment) => onReviewReport(report, action, finalText, comment)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <h4 className="text-xs uppercase text-muted mb-2">Doctor Reviews</h4>
        {doctorReviews.length === 0 ? (
          <div className="text-sm text-muted border border-border rounded p-2">none</div>
        ) : (
          <div className="space-y-2">
            {doctorReviews.map((review) => (
              <DoctorReviewRow key={review.id} review={review} />
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <h4 className="text-xs uppercase text-muted mb-2">Safety Audit</h4>
        {auditLogs.length === 0 ? (
          <div className="text-sm text-muted border border-border rounded p-2">none</div>
        ) : (
          <div className="space-y-2">
            {auditLogs.map((audit) => (
              <AuditRow key={audit.id} audit={audit} />
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <h4 className="text-xs uppercase text-muted mb-2">Model Jobs</h4>
        {modelJobs.length === 0 ? (
          <div className="text-sm text-muted border border-border rounded p-2">none</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {modelJobs.map((job) => (
              <ModelJobRow key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>

      <div className="mt-4">
        <h4 className="text-xs uppercase text-muted mb-2">Agent Tasks</h4>
        {agentTasks.length === 0 ? (
          <div className="text-sm text-muted border border-border rounded p-2">none</div>
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

  const selectedNodule = overlay?.nodules.find((nodule) => nodule.id === selectedNoduleId)
    ?? overlay?.nodules[0]
    ?? null;
  const displayBbox = draftBbox ?? selectedNodule?.bbox ?? null;

  useEffect(() => {
    if (!overlay) {
      setSelectedNoduleId(null);
      setDraftBbox(null);
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
  }, [selectedNodule?.id, selectedNodule?.updatedAt]);

  if (!overlay || overlay.nodules.length === 0) return null;

  function beginDrag(event: ReactMouseEvent<HTMLDivElement>) {
    if (busy || !overlay) return;
    const point = mousePointToImagePoint(event, overlay.image);
    if (!point) return;
    setDragStart(point);
    setDraftBbox([point.x, point.y, point.x, point.y]);
    setEditError(null);
  }

  function updateDrag(event: ReactMouseEvent<HTMLDivElement>) {
    if (!dragStart || !overlay) return;
    const point = mousePointToImagePoint(event, overlay.image);
    if (!point) return;
    setDraftBbox(bboxFromPoints(dragStart, point));
  }

  function endDrag(event: ReactMouseEvent<HTMLDivElement>) {
    if (!dragStart || !overlay) return;
    const point = mousePointToImagePoint(event, overlay.image);
    if (point) setDraftBbox(bboxFromPoints(dragStart, point));
    setDragStart(null);
  }

  async function saveOverlayRevision() {
    if (!selectedNodule) return;
    if (!isNumberTuple4(draftBbox)) {
      setEditError("请先在 overlay 上拖拽框选新 bbox。");
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
          <h4 className="text-xs uppercase text-muted">Overlay Revision</h4>
          <div className="mt-1 text-xs text-muted">拖拽图像区域生成新 bbox，再保存到选中的结节。</div>
        </div>
        <button type="button" className="btn-secondary" disabled={busy} onClick={saveOverlayRevision}>
          {selectedNodule && revisingNoduleId === selectedNodule.id ? "保存中..." : "保存 overlay 修订"}
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
        aria-label="overlay bbox revision canvas"
        data-testid="overlay-revision-canvas"
        className="relative mt-3 max-h-[520px] overflow-hidden rounded border border-border bg-bg select-none cursor-crosshair"
        onMouseDown={beginDrag}
        onMouseMove={updateDrag}
        onMouseUp={endDrag}
        onMouseLeave={() => setDragStart(null)}
      >
        <img
          src={medicalArtifactUrl(overlay.overlayUri)}
          alt="overlay revision preview"
          className="block h-auto w-full object-contain"
          draggable={false}
        />
        {overlay.nodules.map((nodule) => (
          <BboxOverlay
            key={nodule.id}
            bbox={nodule.bbox}
            image={overlay.image}
            active={selectedNodule?.id === nodule.id}
            label={`N${nodule.noduleIndex}`}
          />
        ))}
        {isNumberTuple4(displayBbox) && (
          <BboxOverlay bbox={displayBbox} image={overlay.image} active label="draft" dashed />
        )}
      </div>

      <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
        <Metric label="image" value={overlay.image.id} />
        <Metric label="current bbox" value={formatBbox(selectedNodule?.bbox)} />
        <Metric label="draft bbox" value={formatBbox(draftBbox)} />
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
  return (
    <div className="border border-border rounded p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate">{job.jobType}</span>
        <span className="border border-border rounded px-1.5 py-0.5">{job.status}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <Metric label="model" value={job.modelName ?? "unknown"} />
        <Metric label="version" value={job.modelVersion ?? "unknown"} />
        <Metric label="attempts" value={`${job.attempts}/${job.maxAttempts}`} />
        <Metric label="updated" value={formatTime(job.updatedAt)} />
      </div>
      {detectionsJsonUri && (
        <ArtifactLine label="detections" value={detectionsJsonUri} />
      )}
      {overlayUri && (
        <ArtifactLine label="overlay" value={overlayUri} />
      )}
      {overlayUri && (
        <img
          src={medicalArtifactUrl(overlayUri)}
          alt="detector overlay preview"
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

function ArtifactLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2 min-w-0">
      <span className="text-muted">{label}: </span>
      <span className="font-mono text-[11px] text-muted break-all">{value}</span>
    </div>
  );
}

function NoduleResultRow({
  nodule,
  result,
  busy,
  revising,
  onRevise,
}: {
  nodule: MedicalNodule;
  result: MedicalTiradsResult | null;
  busy: boolean;
  revising: boolean;
  onRevise(bbox: number[]): Promise<void>;
}) {
  const [bboxText, setBboxText] = useState(formatBbox(nodule.bbox));
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    setBboxText(formatBbox(nodule.bbox));
    setEditError(null);
  }, [nodule.id, nodule.updatedAt, nodule.bbox]);

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

  return (
    <div className="border border-border rounded p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">Nodule {nodule.noduleIndex}</span>
        <span className="border border-border rounded px-1.5 py-0.5">{nodule.status}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-2">
        <Metric label="confidence" value={formatOptionalNumber(nodule.detectionConfidence)} />
        <Metric label="source" value={nodule.source} />
        <Metric label="TI-RADS" value={result?.category ?? "pending"} />
        <Metric label="score" value={result?.score === null || result?.score === undefined ? "pending" : String(result.score)} />
      </div>
      {result?.recommendation && <div className="text-muted mt-2">{result.recommendation}</div>}
      <div className="mt-2 flex flex-col gap-2">
        <label className="text-muted">
          bbox xyxy
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

function ReportRow({
  report,
  busy,
  reviewing,
  onReview,
}: {
  report: MedicalReport;
  busy: boolean;
  reviewing: boolean;
  onReview(action: "approve" | "reject", finalText?: string, comment?: string): void;
}) {
  const text = report.finalText ?? report.draftText ?? "";
  const [editedText, setEditedText] = useState(text);
  const [comment, setComment] = useState("");
  const canReview = report.status === "draft" || report.status === "pending_review";

  useEffect(() => {
    setEditedText(text);
    setComment("");
  }, [report.id, report.updatedAt, text]);

  function submit(action: "approve" | "reject") {
    onReview(action, action === "approve" ? editedText : undefined, optionalText(comment));
  }

  return (
    <div className="border border-border rounded p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-muted">{report.id}</span>
        <span className="border border-border rounded px-1.5 py-0.5">{report.status}</span>
      </div>
      <div className="text-muted mt-1">
        {report.reportType} · {report.templateId ?? "no template"} · {formatTime(report.updatedAt)}
      </div>
      {canReview ? (
        <div className="mt-2 space-y-2">
          <label className="block text-muted">
            报告正文
            <textarea
              className={`${inputClass} mt-1 min-h-32 font-mono text-xs`}
              value={editedText}
              onChange={(event) => setEditedText(event.target.value)}
            />
          </label>
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
            <div className="rounded border border-warning/40 px-2 py-1 text-warning">
              已修改草稿：{text.length} → {editedText.length} 字符
            </div>
          )}
        </div>
      ) : text ? (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border bg-bg px-2 py-1.5 text-xs">
          {text}
        </pre>
      ) : null}
      {canReview && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" disabled={busy} onClick={() => submit("approve")}>
            {reviewing ? "处理中..." : "确认报告"}
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => submit("reject")}>
            驳回
          </button>
        </div>
      )}
    </div>
  );
}

function DoctorReviewRow({ review }: { review: MedicalDoctorReview }) {
  const before = review.before ?? {};
  const after = review.after ?? {};
  const beforeStatus = stringValue(before.status) ?? "unknown";
  const afterStatus = stringValue(after.status) ?? "unknown";
  const beforeText = stringValue(before.final_text) ?? stringValue(before.draft_text) ?? "";
  const afterText = stringValue(after.final_text) ?? stringValue(after.draft_text) ?? "";
  const textChanged = beforeText !== afterText;
  return (
    <div className="border border-border rounded p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{review.action}</span>
        <span className="border border-border rounded px-1.5 py-0.5">{review.reviewerName}</span>
      </div>
      <div className="text-muted mt-1">
        {review.reportId} · {formatTime(review.createdAt)}
      </div>
      <div className="mt-2 rounded border border-border px-2 py-1">
        {beforeStatus} → {afterStatus}
        {textChanged && <span className="ml-2 text-warning">文本 {beforeText.length} → {afterText.length}</span>}
      </div>
      {review.comment && <div className="mt-2 text-muted">{review.comment}</div>}
    </div>
  );
}

function AuditRow({ audit }: { audit: MedicalAuditLog }) {
  const safetyStatus = stringValue(audit.detail.safety_status) ?? audit.action;
  const issues = Array.isArray(audit.detail.issues) ? audit.detail.issues : [];
  const bboxChange = bboxChangeLabel(audit.detail);
  return (
    <div className="border border-border rounded p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{safetyStatus}</span>
        <span className="border border-border rounded px-1.5 py-0.5">{audit.action}</span>
      </div>
      <div className="text-muted mt-1">
        {audit.actorType}:{audit.actorId ?? "unknown"} · {formatTime(audit.createdAt)}
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
    </div>
  );
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
  const size = image.width && image.height ? `${image.width}×${image.height}` : "unknown";
  return (
    <div className="flex flex-col md:flex-row md:items-center gap-3 border border-border rounded p-2">
      <div className="min-w-0 flex-1">
        <div className="font-mono text-xs text-muted truncate">{image.id}</div>
        <div className="font-mono text-xs truncate mt-1">{image.fileUri}</div>
        <div className="text-xs text-muted mt-1">
          {image.fileType} · {size} · {image.processingStatus}
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
        <span className="border border-border rounded px-1.5 py-0.5">{task.status}</span>
      </div>
      <div className="text-muted mt-1 truncate">{task.taskType}</div>
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
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left border rounded p-3 hover:border-accent ${
        selected ? "border-accent bg-accent/5" : "border-border"
      }`}
    >
      <div className="flex items-start gap-3">
        <div>
          <div className="font-mono text-xs text-muted">{study.id}</div>
          <h4 className="text-sm font-semibold mt-1">
            {study.accessionNo ?? study.externalPatientId ?? "manual study"}
          </h4>
        </div>
        <span className="ml-auto text-xs border border-border rounded px-2 py-1">{study.status}</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mt-3 text-xs">
        <Metric label="modality" value={`${study.modality}/${study.bodyPart}`} />
        <Metric label="source" value={study.sourceType} />
        <Metric label="images" value={String(study.imageCount)} />
        <Metric label="nodules" value={String(study.noduleCount)} />
        <Metric label="analysis" value={study.latestAnalysisStatus ?? "none"} />
        <Metric label="report" value={study.latestReportStatus ?? "none"} />
        <Metric label="updated" value={formatTime(study.updatedAt)} />
        <Metric label="created by" value={study.createdBy ?? "local"} />
      </div>
    </button>
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
  if (!Number.isFinite(value) || value <= 0) return "unknown";
  return new Date(value).toLocaleString();
}

function formatOptionalNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "unknown" : value.toFixed(2);
}

function formatBbox(value: unknown): string {
  return isNumberTuple4(value) ? value.map((item) => Number(item.toFixed(2))).join(", ") : "";
}

function parseBboxInput(value: string): number[] | string {
  const parts = value.split(/[\s,]+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 4) return "bbox 需要 4 个数字：x1, y1, x2, y2";
  const numbers = parts.map(Number);
  if (!numbers.every(Number.isFinite)) return "bbox 只能包含有限数字";
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

function gpuLabel(result: Record<string, unknown> | null): string {
  const runtime = objectValue(result?.runtime);
  const gpu = objectValue(runtime?.gpu);
  if (!gpu) return "unknown";
  if (gpu.cuda_available === true) {
    const count = typeof gpu.device_count === "number" ? gpu.device_count : 0;
    return `cuda:${count}`;
  }
  return "no cuda";
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
  return `bbox ${formatBbox(before.bbox)} -> ${formatBbox(after.bbox)}`;
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
