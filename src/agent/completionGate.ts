import type { ToolEvidence } from "./evidence";

export interface CompletionGateResult {
  text: string;
  blocked: boolean;
  warnings: string[];
}

interface ClaimRule {
  name: string;
  claimPattern: RegExp;
  requiredTools: string[];
  warning: string;
  requiredResultPattern?: RegExp;
}

const CLAIM_RULES: ClaimRule[] = [
  {
    name: "report-created",
    claimPattern: /(报告|report)[\s\S]{0,40}(已|已经|成功|created|saved|generated|可在|visible|see)/i,
    requiredTools: ["CreateReportArtifact", "UpdateReportArtifact", "mcp__beelink__CreateReportArtifact"],
    warning: "报告完成声明缺少 CreateReportArtifact 或 UpdateReportArtifact 成功证据。",
  },
  {
    name: "chart-created",
    claimPattern: /(图表|柱状图|条形图|折线图|饼图|chart|bar chart|line chart|pie chart)[\s\S]{0,40}(已|已经|成功|created|saved|generated|可在|visible|see|更新|覆盖)/i,
    requiredTools: [
      "CreateReportArtifact",
      "UpdateReportArtifact",
      "CreateDashboardSpec",
      "UpgradeReportToDashboard",
      "mcp__beelink__CreateReportArtifact",
      "mcp__beelink__CreateDashboardSpec",
    ],
    warning: "图表完成声明缺少 Report/Dashboard 产品对象创建或更新成功证据。",
    requiredResultPattern: /\bcharts=([1-9]\d*)\b/i,
  },
  {
    name: "report-rendered",
    claimPattern: /(报告|report)[\s\S]{0,40}(HTML|渲染|rendered|打开|view)/i,
    requiredTools: ["RenderReportHtml", "mcp__beelink__RenderReportHtml"],
    warning: "报告 HTML/渲染完成声明缺少 RenderReportHtml 成功证据。",
  },
  {
    name: "dashboard-created",
    claimPattern: /(dashboard|仪表盘|看板)[\s\S]{0,40}(已|已经|成功|created|saved|generated|升级|upgraded|可在|visible|see)/i,
    requiredTools: ["CreateDashboardSpec", "UpgradeReportToDashboard", "mcp__beelink__CreateDashboardSpec"],
    warning: "Dashboard 完成声明缺少 CreateDashboardSpec 或 UpgradeReportToDashboard 成功证据。",
  },
  {
    name: "dashboard-rendered",
    claimPattern: /(dashboard|仪表盘|看板)[\s\S]{0,40}(HTML|渲染|rendered|打开|view)/i,
    requiredTools: ["RenderDashboardHtml", "mcp__beelink__RenderDashboardHtml"],
    warning: "Dashboard HTML/渲染完成声明缺少 RenderDashboardHtml 成功证据。",
  },
  {
    name: "artifact-created",
    claimPattern: /(artifact|文件|HTML|JSON|导出|export)[\s\S]{0,40}(已|已经|成功|created|saved|generated|写入|保存|导出)/i,
    requiredTools: [
      "ExportSqlArtifact",
      "RenderReportHtml",
      "RenderDashboardHtml",
      "write",
      "mcp__beelink__ExportSqlArtifact",
    ],
    warning: "artifact/文件完成声明缺少导出、渲染或写入成功证据。",
  },
];

export function applyCompletionGate(text: string, evidence: ToolEvidence[]): CompletionGateResult {
  const warnings = missingEvidenceWarnings(text, evidence);
  if (warnings.length === 0) {
    return { text, blocked: false, warnings };
  }
  return {
    text: appendGateWarning(text, warnings),
    blocked: true,
    warnings,
  };
}

function missingEvidenceWarnings(text: string, evidence: ToolEvidence[]): string[] {
  const warnings: string[] = [];
  for (const rule of CLAIM_RULES) {
    if (!hasPositiveClaim(text, rule.claimPattern)) continue;
    const matchingEvidence = evidence.filter(
      (item) => item.status === "succeeded" && rule.requiredTools.includes(item.toolName)
    );
    if (
      matchingEvidence.length > 0 &&
      (!rule.requiredResultPattern || matchingEvidence.some((item) => rule.requiredResultPattern!.test(item.resultSummary)))
    ) {
      continue;
    }
    warnings.push(rule.warning);
  }
  return Array.from(new Set(warnings));
}

function hasPositiveClaim(text: string, pattern: RegExp): boolean {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  for (const match of text.matchAll(matcher)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const window = text.slice(Math.max(0, start - 40), Math.min(text.length, end + 40));
    if (!isNonCompletionWindow(window)) return true;
  }
  return false;
}

function isNonCompletionWindow(window: string): boolean {
  return (
    /(不要|不需要|无需|不执行|不生成|不保存|不导出|只输出\s*sql|仅输出\s*sql|sql only)/i.test(window) ||
    /(没有|无|缺少|无法|不能|未)[\s\S]{0,24}(文件|artifact|export|导出|保存|html|json|报告|报表|report)/i.test(window) ||
    /(文件|artifact|export|导出|保存|html|json|报告|报表|report)[\s\S]{0,24}(没有|无|缺少|无法|不能|未)/i.test(window)
  );
}

function appendGateWarning(text: string, warnings: string[]): string {
  return [
    text.trimEnd(),
    "",
    "[CompletionGate]",
    "上面的完成声明缺少对应工具成功证据，因此请把它视为未验证完成。",
    ...warnings.map((warning) => `- ${warning}`),
    "建议继续执行必要工具并验证后，再宣称完成。",
  ].join("\n");
}
