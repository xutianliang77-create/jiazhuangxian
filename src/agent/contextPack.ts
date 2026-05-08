import type { ToolEvidence } from "./evidence";

export interface ContextPackInput {
  prompt: string;
  evidence?: ToolEvidence[];
}

const MAX_PROMPT_CHARS = 220;
const MAX_EVIDENCE_ITEMS = 3;
const MAX_EVIDENCE_SUMMARY_CHARS = 180;

export function buildContextPack(input: ContextPackInput): string | null {
  const prompt = input.prompt.trim();
  const criteria = buildDoneCriteria(prompt);
  const recentEvidence = (input.evidence ?? []).slice(-MAX_EVIDENCE_ITEMS);

  if (criteria.length === 0 && !shouldIncludeEvidenceOnly(prompt, recentEvidence)) {
    return null;
  }

  const lines = ["[ContextPack]", `Task: ${clip(prompt, MAX_PROMPT_CHARS)}`];

  if (criteria.length > 0) {
    lines.push("Done criteria:");
    for (const item of criteria) {
      lines.push(`- ${item}`);
    }
  }

  if (recentEvidence.length > 0) {
    lines.push("Recent evidence:");
    for (const item of recentEvidence) {
      lines.push(
        `- ${item.toolName} ${item.status}: ${clip(item.resultSummary || item.argsPreview, MAX_EVIDENCE_SUMMARY_CHARS)}`
      );
    }
  }

  return lines.join("\n");
}

function buildDoneCriteria(prompt: string): string[] {
  const criteria: string[] = [];
  const lower = prompt.toLowerCase();
  const sqlOnly = isSqlOnlyPrompt(lower);

  if (sqlOnly) {
    criteria.push("The user asked to generate SQL only; final response must be SQL only unless a blocking caveat is required.");
    criteria.push("Do not execute SQL, create reports, create dashboards, render HTML, or export files for SQL-only requests.");
    criteria.push("Metadata/schema lookup is allowed only when needed to avoid guessing table or column references.");
  }

  if (hasPositiveReportIntent(lower)) {
    criteria.push("Call CreateReportArtifact successfully before claiming the report is saved or visible.");
    criteria.push("If correcting or overwriting an existing saved report, call UpdateReportArtifact successfully instead of creating an ad-hoc chart or file.");
    criteria.push("When the user asks for charts, include non-empty report charts in CreateReportArtifact/UpdateReportArtifact and verify with ReadReport.");
    criteria.push("If HTML/viewing is requested, call RenderReportHtml successfully before claiming HTML is ready.");
    criteria.push("Verify report visibility with ListReports or ReadReport when the user asks to see it in Reports.");
  }

  if (hasPositiveChartIntent(lower)) {
    criteria.push("Charts must be saved as CodeClaw ReportArtifact charts via CreateReportArtifact or UpdateReportArtifact; do not use standalone ECharts MCP tools.");
    criteria.push("Use real query result rows or a result artifact as the chart dataset; do not build charts from preview rows when the preview is truncated.");
    criteria.push("After saving chart specs, verify with ReadReport that charts is non-empty and the dataset contains the requested rows.");
  }

  if (/dashboard|仪表盘|看板/.test(lower)) {
    criteria.push(
      "Call CreateDashboardSpec or UpgradeReportToDashboard successfully before claiming the dashboard exists."
    );
    criteria.push("Call ValidateDashboardSpec before relying on a generated dashboard spec.");
    criteria.push("If HTML/viewing is requested, call RenderDashboardHtml successfully before claiming HTML is ready.");
  }

  if (/artifact|export|导出|保存|文件|html|md|markdown/.test(lower)) {
    criteria.push("Do not claim an artifact, export, or file is saved until the matching tool evidence succeeded.");
  }

  return [...new Set(criteria)];
}

export function isSqlOnlyPrompt(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  if (!/sql/.test(lower)) return false;
  return /只输出|仅输出|只生成|仅生成|不要执行|不执行|不要生成报表|不要生成报告|do not execute|only output|sql only/i.test(lower);
}

export function coerceSqlOnlyResponse(text: string): string {
  const fencedSql = /```sql\s*([\s\S]*?)```/i.exec(text);
  if (fencedSql?.[1]?.trim()) return ensureSqlTerminator(fencedSql[1].trim());

  const fencedBlocks = [...text.matchAll(/```([A-Za-z0-9_-]+)?[ \t]*\n([\s\S]*?)```/g)];
  for (const block of fencedBlocks) {
    const language = block[1]?.toLowerCase();
    if (language && language !== "sql") continue;
    const body = block[2]?.trim();
    if (body && isSqlCandidate(body)) {
      return ensureSqlTerminator(body);
    }
  }

  const textWithoutFences = text.replace(/```([A-Za-z0-9_-]+)?[ \t]*\n[\s\S]*?```/g, "");
  const inlineSql = /\b(with|select)\b[\s\S]*?(?:;|$)/i.exec(textWithoutFences);
  if (inlineSql?.[0]?.trim()) return ensureSqlTerminator(inlineSql[0].trim());

  return text;
}

function ensureSqlTerminator(sql: string): string {
  const trimmed = sql.trim();
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

function hasPositiveReportIntent(lower: string): boolean {
  if (!/报告|报表|report/.test(lower)) return false;
  const reportMatches = [...lower.matchAll(/报告|报表|report/g)];
  return !reportMatches.some((match) => {
    const start = match.index ?? 0;
    const before = lower.slice(Math.max(0, start - 64), start);
    return /(不要|不需要|无需|别|禁止|do not|don't|without)[\s\S]{0,64}(生成|创建|制作|保存|输出)?[\s\S]{0,32}$/i.test(before);
  });
}

function hasPositiveChartIntent(lower: string): boolean {
  if (!/图表|柱状图|条形图|饼图|折线图|曲线图|可视化|chart|bar chart|pie chart|line chart/.test(lower)) return false;
  const chartMatches = [...lower.matchAll(/图表|柱状图|条形图|饼图|折线图|曲线图|可视化|chart|bar chart|pie chart|line chart/g)];
  return !chartMatches.some((match) => {
    const start = match.index ?? 0;
    const before = lower.slice(Math.max(0, start - 64), start);
    return /(不要|不需要|无需|别|禁止|do not|don't|without)[\s\S]{0,64}(生成|创建|制作|保存|输出)?[\s\S]{0,32}$/i.test(before);
  });
}

function shouldIncludeEvidenceOnly(prompt: string, evidence: ToolEvidence[]): boolean {
  if (evidence.length === 0) return false;
  return /继续|接着|刚才|上一步|重试|再来|continue|again|retry|resume/i.test(prompt);
}

function clip(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars - 3)}...` : value;
}

function isSqlCandidate(value: string): boolean {
  const withoutLeadingComments = value
    .replace(/^\s*--.*$/gm, "")
    .replace(/^\s*\/\*[\s\S]*?\*\//, "")
    .trim();
  return /^(select|with)\b/i.test(withoutLeadingComments);
}
