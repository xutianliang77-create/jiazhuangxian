import type { ToolDefinition, ToolRegistry } from "../agent/tools/registry";
import { FileReportStore } from "./store";
import { ReportService, type CreateReportInput, type UpdateReportInput } from "./service";
import { validateReportArtifact } from "./validate";
import type { PrincipalRef, ReportListQuery } from "./types";

export interface RegisterReportToolsOptions {
  artifactsRoot?: string;
}

export const REPORT_TOOL_NAMES = [
  "CreateReportArtifact",
  "UpdateReportArtifact",
  "RenderReportHtml",
  "ReadReport",
  "ListReports",
] as const;

export function createReportToolDefinitions(options: RegisterReportToolsOptions = {}): ToolDefinition[] {
  const service = createService(options);
  return [
    {
      name: "CreateReportArtifact",
      description:
        "Create a CodeClaw ReportArtifact from real query datasets, chart specs, insights, caveats, and provenance. Use for one-time analysis reports. If this tool fails, fix the arguments and retry before claiming the report is saved.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          question: { type: "string" },
          originalQuestion: { type: "string" },
          owner: { type: "object" },
          workspaceId: { type: "string" },
          sessionId: { type: "string" },
          traceId: { type: "string" },
          datasets: { type: "array" },
          charts: { type: "array" },
          sections: { type: "array" },
          insights: { type: "array" },
          caveats: { type: "array" },
          provenance: { type: "object" },
          ruleCheck: { type: "object" },
          sqlRuleCheck: { type: "object" },
          ruleChecks: { type: "array" },
          report: { type: "object" },
          reportArtifact: { type: "object" },
          reportSpec: { type: "object" },
          spec: { type: "object" },
        },
        required: ["question", "datasets", "provenance"],
        additionalProperties: false,
      },
      async invoke(args, ctx) {
        const input = normalizeCreateReportArgs(args);
        const question = requiredReportQuestion(input);
        const report = await service.create({
          ...(typeof input.id === "string" ? { id: input.id } : {}),
          ...(typeof input.title === "string" ? { title: input.title } : {}),
          question,
          owner: ownerForContext(ctx.userId, input.owner),
          workspaceId: typeof input.workspaceId === "string" ? input.workspaceId : ctx.workspace,
          ...(typeof input.sessionId === "string" ? { sessionId: input.sessionId } : {}),
          ...(typeof input.traceId === "string" ? { traceId: input.traceId } : {}),
          datasets: reportDatasets(input),
          charts: arrayOrEmpty(input.charts) as CreateReportInput["charts"],
          sections: arrayOrEmpty(input.sections) as CreateReportInput["sections"],
          insights: arrayOrEmpty(input.insights) as CreateReportInput["insights"],
          caveats: arrayOrEmpty(input.caveats) as CreateReportInput["caveats"],
          provenance: reportProvenance(input, question),
        });
        const validation = validateReportArtifact(report, { artifactsRoot: options.artifactsRoot });
        const warnings = validation.warnings.length > 0 ? `\nWarnings:\n${validation.warnings.map((item) => `- ${item}`).join("\n")}` : "";
        return {
          ok: true,
          content: `Report created: ${report.id}\ncharts=${report.charts.length}\ndatasets=${report.datasets.length}${warnings}`,
        };
      },
    },
    {
      name: "UpdateReportArtifact",
      description:
        "Update an existing CodeClaw ReportArtifact by replacing datasets, chart specs, sections, insights, caveats, or provenance. Use this when correcting or overwriting a saved report. After updating, call ReadReport or ListReports to verify the report before claiming it is visible.",
      inputSchema: {
        type: "object",
        properties: {
          reportId: { type: "string" },
          id: { type: "string" },
          title: { type: "string" },
          question: { type: "string" },
          originalQuestion: { type: "string" },
          owner: { type: "object" },
          workspaceId: { type: "string" },
          sessionId: { type: "string" },
          traceId: { type: "string" },
          status: { type: "string" },
          datasets: { type: "array" },
          charts: { type: "array" },
          sections: { type: "array" },
          insights: { type: "array" },
          caveats: { type: "array" },
          provenance: { type: "object" },
          ruleCheck: { type: "object" },
          sqlRuleCheck: { type: "object" },
          ruleChecks: { type: "array" },
          report: { type: "object" },
          reportArtifact: { type: "object" },
          reportSpec: { type: "object" },
          spec: { type: "object" },
        },
        required: [],
        additionalProperties: false,
      },
      async invoke(args, ctx) {
        const input = normalizeCreateReportArgs(args);
        const reportId = optionalString(input.reportId) ?? optionalString(input.id);
        if (!reportId) {
          throw new Error(
            [
              "UpdateReportArtifact requires reportId.",
              "Fix by retrying with the saved report id and the replacement datasets/charts.",
              'Example: {"reportId":"report-123","charts":[{"id":"chart-1","datasetId":"dataset-1","kind":"bar","x":"item_name","y":"total_quantity"}]}',
            ].join("\n")
          );
        }
        const update: UpdateReportInput = {
          id: reportId,
          ...(typeof input.title === "string" ? { title: input.title } : {}),
          ...(optionalString(input.question) || optionalString(input.originalQuestion)
            ? { question: optionalString(input.question) ?? optionalString(input.originalQuestion)! }
            : {}),
          ...(typeof input.owner === "object" ? { owner: ownerForContext(ctx.userId, input.owner) } : {}),
          ...(typeof input.workspaceId === "string" ? { workspaceId: input.workspaceId } : {}),
          ...(typeof input.sessionId === "string" ? { sessionId: input.sessionId } : {}),
          ...(typeof input.traceId === "string" ? { traceId: input.traceId } : {}),
          ...(isReportStatus(input.status) ? { status: input.status } : {}),
          ...(input.datasets ? { datasets: reportDatasets(input) } : {}),
          ...(input.charts ? { charts: arrayOrEmpty(input.charts) as UpdateReportInput["charts"] } : {}),
          ...(input.sections ? { sections: arrayOrEmpty(input.sections) as UpdateReportInput["sections"] } : {}),
          ...(input.insights ? { insights: arrayOrEmpty(input.insights) as UpdateReportInput["insights"] } : {}),
          ...(input.caveats ? { caveats: arrayOrEmpty(input.caveats) as UpdateReportInput["caveats"] } : {}),
          ...(input.provenance ? { provenance: reportProvenance(input, optionalString(input.question) ?? reportId) } : {}),
        };
        const report = await service.update(update);
        const validation = validateReportArtifact(report, { artifactsRoot: options.artifactsRoot });
        const warnings = validation.warnings.length > 0 ? `\nWarnings:\n${validation.warnings.map((item) => `- ${item}`).join("\n")}` : "";
        return {
          ok: true,
          content: `Report updated: ${report.id}\ncharts=${report.charts.length}\ndatasets=${report.datasets.length}${warnings}`,
        };
      },
    },
    {
      name: "RenderReportHtml",
      description: "Render an existing ReportArtifact to a local HTML artifact and return its path.",
      inputSchema: {
        type: "object",
        properties: {
          reportId: { type: "string" },
        },
        required: ["reportId"],
        additionalProperties: false,
      },
      async invoke(args) {
        const id = requiredString(asRecord(args).reportId, "reportId");
        const artifact = await service.renderHtml(id);
        return { ok: true, content: `Report HTML: ${artifact.path}` };
      },
    },
    {
      name: "ReadReport",
      description: "Read a saved CodeClaw ReportArtifact JSON by id.",
      inputSchema: {
        type: "object",
        properties: {
          reportId: { type: "string" },
        },
        required: ["reportId"],
        additionalProperties: false,
      },
      async invoke(args) {
        const id = requiredString(asRecord(args).reportId, "reportId");
        const report = await service.read(id);
        return { ok: true, content: JSON.stringify(report, null, 2) };
      },
    },
    {
      name: "ListReports",
      description: "List saved CodeClaw reports, optionally filtered by owner, workspace, status, or limit.",
      inputSchema: {
        type: "object",
        properties: {
          ownerId: { type: "string" },
          workspaceId: { type: "string" },
          status: { type: "string" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
      async invoke(args) {
        const input = asRecord(args);
        const result = await service.list({
          ...(typeof input.ownerId === "string" ? { ownerId: input.ownerId } : {}),
          ...(typeof input.workspaceId === "string" ? { workspaceId: input.workspaceId } : {}),
          ...(typeof input.status === "string" ? { status: input.status as ReportListQuery["status"] } : {}),
          ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
        });
        return { ok: true, content: JSON.stringify(result, null, 2) };
      },
    },
  ];
}

export function registerReportTools(registry: ToolRegistry, options: RegisterReportToolsOptions = {}): void {
  for (const tool of createReportToolDefinitions(options)) registry.register(tool);
}

function createService(options: RegisterReportToolsOptions): ReportService {
  return new ReportService(new FileReportStore({ artifactsRoot: options.artifactsRoot }), {
    artifactsRoot: options.artifactsRoot,
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeCreateReportArgs(value: unknown): Record<string, unknown> {
  const input = asRecord(value);
  const nested = ["report", "reportArtifact", "reportSpec", "spec"]
    .map((key) => asRecord(input[key]))
    .find((record) => Object.keys(record).length > 0);
  if (!nested) return input;
  return { ...input, ...nested };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

function requiredReportQuestion(input: Record<string, unknown>): string {
  const provenance = asRecord(input.provenance);
  const question =
    optionalString(input.question) ??
    optionalString(input.originalQuestion) ??
    optionalString(provenance.question) ??
    optionalString(input.title);
  if (question) return question;
  throw new Error(
    [
      "CreateReportArtifact requires a non-empty question.",
      "Fix by retrying with top-level question, datasets, and provenance.",
      'Example: {"question":"客户性别对比","datasets":[...],"provenance":{"source":"llm","question":"客户性别对比"}}',
      "Do not claim the report is saved until CreateReportArtifact succeeds and ListReports or ReadReport verifies it.",
    ].join("\n")
  );
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isReportStatus(value: unknown): value is UpdateReportInput["status"] {
  return value === "draft" || value === "reviewed" || value === "shared" || value === "archived";
}

function reportProvenance(input: Record<string, unknown>, question: string): CreateReportInput["provenance"] {
  const provenance = asRecord(input.provenance);
  return {
    source:
      provenance.source === "tool" || provenance.source === "manual" || provenance.source === "llm"
        ? provenance.source
        : "llm",
    question: optionalString(provenance.question) ?? question,
    ...(typeof provenance.sessionId === "string" ? { sessionId: provenance.sessionId } : {}),
    ...(typeof provenance.traceId === "string" ? { traceId: provenance.traceId } : {}),
    ...(typeof provenance.model === "string" ? { model: provenance.model } : {}),
    ...(typeof provenance.provider === "string" ? { provider: provenance.provider } : {}),
    ...(Array.isArray(provenance.toolCalls) ? { toolCalls: provenance.toolCalls as CreateReportInput["provenance"]["toolCalls"] } : {}),
  };
}

type RuleCheck = NonNullable<NonNullable<CreateReportInput["datasets"][number]["provenance"]>["ruleCheck"]>;
type RuleCheckCandidate = RuleCheck & {
  datasetId?: string;
  queryId?: string;
  sql?: string;
};

function reportDatasets(input: Record<string, unknown>): CreateReportInput["datasets"] {
  const datasets = arrayOrEmpty(input.datasets).filter(isRecord);
  const ruleChecks = ruleCheckCandidates(input);
  const sqlDatasets = datasets.filter((dataset) => typeof dataset.sql === "string" || typeof asRecord(dataset.provenance).sql === "string");
  return datasets.map((dataset) => {
    const provenance = asRecord(dataset.provenance);
    if (isRuleCheck(provenance.ruleCheck)) return dataset as unknown as CreateReportInput["datasets"][number];
    const match = matchingRuleCheck(dataset, ruleChecks, sqlDatasets.length);
    if (!match) return dataset as unknown as CreateReportInput["datasets"][number];
    const { datasetId: _datasetId, queryId: _queryId, sql: _sql, ...ruleCheck } = match;
    return {
      ...dataset,
      provenance: {
        ...provenance,
        ruleCheck,
      },
    } as CreateReportInput["datasets"][number];
  });
}

function ruleCheckCandidates(input: Record<string, unknown>): RuleCheckCandidate[] {
  const candidates: RuleCheckCandidate[] = [];
  for (const value of [input.ruleCheck, input.sqlRuleCheck, asRecord(input.provenance).ruleCheck]) {
    if (isRecord(value)) {
      const parsed = parseRuleCheck(value);
      if (parsed) candidates.push(parsed);
    }
  }
  for (const value of arrayOrEmpty(input.ruleChecks)) {
    if (isRecord(value)) {
      const parsed = parseRuleCheck(value);
      if (parsed) candidates.push(parsed);
    }
  }
  return candidates;
}

function matchingRuleCheck(
  dataset: Record<string, unknown>,
  candidates: RuleCheckCandidate[],
  sqlDatasetCount: number
): RuleCheckCandidate | undefined {
  if (candidates.length === 0) return undefined;
  const provenance = asRecord(dataset.provenance);
  const datasetId = optionalString(dataset.id);
  const queryId = optionalString(dataset.queryId) ?? optionalString(provenance.queryId);
  const sql = optionalString(dataset.sql) ?? optionalString(provenance.sql);
  return (
    candidates.find((candidate) => candidate.datasetId && candidate.datasetId === datasetId) ??
    candidates.find((candidate) => candidate.queryId && candidate.queryId === queryId) ??
    candidates.find((candidate) => candidate.sql && candidate.sql === sql) ??
    (candidates.length === 1 && sqlDatasetCount === 1 && sql ? candidates[0] : undefined)
  );
}

function parseRuleCheck(value: Record<string, unknown>): RuleCheckCandidate | undefined {
  const errors = stringArray(value.errors);
  const warnings = stringArray(value.warnings);
  const passed = typeof value.passed === "boolean" ? value.passed : errors.length === 0;
  if (typeof value.passed !== "boolean" && errors.length === 0 && warnings.length === 0) return undefined;
  return {
    passed,
    errors,
    warnings,
    ...(typeof value.datasetId === "string" ? { datasetId: value.datasetId } : {}),
    ...(typeof value.queryId === "string" ? { queryId: value.queryId } : {}),
    ...(typeof value.sql === "string" ? { sql: value.sql } : {}),
  };
}

function isRuleCheck(value: unknown): value is RuleCheck {
  const record = asRecord(value);
  return typeof record.passed === "boolean" && Array.isArray(record.errors) && Array.isArray(record.warnings);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asOwner(value: unknown): PrincipalRef | undefined {
  const record = asRecord(value);
  if (
    (record.type === "user" || record.type === "service" || record.type === "team") &&
    typeof record.id === "string"
  ) {
    return {
      type: record.type,
      id: record.id,
      ...(typeof record.displayName === "string" ? { displayName: record.displayName } : {}),
    };
  }
  return undefined;
}

function ownerForContext(userId: string | undefined, value: unknown): PrincipalRef {
  if (userId) return { type: "user", id: userId };
  return asOwner(value) ?? { type: "user", id: "local" };
}
