import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  createMedicalImage,
  createMedicalPatient,
  createMedicalStudy,
  getMedicalStudy,
  getMedicalSummary,
  reviewMedicalReport,
  startMedicalAnalysis,
  type MedicalAgentTask,
  type MedicalAuditLog,
  type MedicalDoctorReview,
  type MedicalImage,
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

  async function refresh() {
    setBusy(true);
    setLocalError(null);
    try {
      setSummary(await getMedicalSummary());
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

  async function reviewReport(report: MedicalReport, action: "approve" | "reject") {
    setReviewBusyReportId(report.id);
    setDetailError(null);
    try {
      const result = await reviewMedicalReport(report.id, {
        action,
        finalText: action === "approve" ? report.finalText ?? report.draftText ?? undefined : undefined,
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

        <StudyDetail
          bundle={studyBundle}
          busy={detailBusy}
          error={detailError}
          analyzingImageId={analysisBusyImageId}
          reviewingReportId={reviewBusyReportId}
          onStartAnalysis={launchAnalysis}
          onReviewReport={reviewReport}
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

function StudyDetail({
  bundle,
  busy,
  error,
  analyzingImageId,
  reviewingReportId,
  onStartAnalysis,
  onReviewReport,
}: {
  bundle: MedicalStudyBundle | null;
  busy: boolean;
  error: string | null;
  analyzingImageId: string | null;
  reviewingReportId: string | null;
  onStartAnalysis(imageId: string): void;
  onReviewReport(report: MedicalReport, action: "approve" | "reject"): void;
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
                onReview={(action) => onReviewReport(report, action)}
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

function NoduleResultRow({ nodule, result }: { nodule: MedicalNodule; result: MedicalTiradsResult | null }) {
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
  onReview(action: "approve" | "reject"): void;
}) {
  const text = report.finalText ?? report.draftText ?? "";
  const canReview = report.status === "draft" || report.status === "pending_review";
  return (
    <div className="border border-border rounded p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-muted">{report.id}</span>
        <span className="border border-border rounded px-1.5 py-0.5">{report.status}</span>
      </div>
      <div className="text-muted mt-1">
        {report.reportType} · {report.templateId ?? "no template"} · {formatTime(report.updatedAt)}
      </div>
      {text && (
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-border bg-bg px-2 py-1.5 text-xs">
          {text}
        </pre>
      )}
      {canReview && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" disabled={busy} onClick={() => onReview("approve")}>
            {reviewing ? "处理中..." : "确认报告"}
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => onReview("reject")}>
            驳回
          </button>
        </div>
      )}
    </div>
  );
}

function DoctorReviewRow({ review }: { review: MedicalDoctorReview }) {
  return (
    <div className="border border-border rounded p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{review.action}</span>
        <span className="border border-border rounded px-1.5 py-0.5">{review.reviewerName}</span>
      </div>
      <div className="text-muted mt-1">
        {review.reportId} · {formatTime(review.createdAt)}
      </div>
      {review.comment && <div className="mt-2 text-muted">{review.comment}</div>}
    </div>
  );
}

function AuditRow({ audit }: { audit: MedicalAuditLog }) {
  const safetyStatus = stringValue(audit.detail.safety_status) ?? audit.action;
  const issues = Array.isArray(audit.detail.issues) ? audit.detail.issues : [];
  return (
    <div className="border border-border rounded p-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{safetyStatus}</span>
        <span className="border border-border rounded px-1.5 py-0.5">{audit.action}</span>
      </div>
      <div className="text-muted mt-1">
        {audit.actorType}:{audit.actorId ?? "unknown"} · {formatTime(audit.createdAt)}
      </div>
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function issueLabel(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return String(value);
  const record = value as Record<string, unknown>;
  return [record.rule_code, record.severity, record.message].filter((item) => typeof item === "string").join(" · ");
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
