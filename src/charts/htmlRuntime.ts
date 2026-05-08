export type EChartsRuntimeMode = "cdn" | "local" | "none";

export interface EChartsRuntimeOptions {
  mode?: EChartsRuntimeMode;
  cdnUrl?: string;
  localPath?: string;
}

export function getEChartsRuntimeModeFromEnv(env: NodeJS.ProcessEnv = process.env): EChartsRuntimeMode {
  const raw = env.CODECLAW_ECHARTS_RUNTIME ?? env.CHATBI_ECHARTS_RUNTIME ?? "cdn";
  return raw === "local" || raw === "none" ? raw : "cdn";
}

export function renderEChartsRuntimeScript(options: EChartsRuntimeOptions = {}): string {
  const mode = options.mode ?? getEChartsRuntimeModeFromEnv();
  if (mode === "none") return "";
  if (mode === "local") {
    if (!options.localPath) return "";
    return `<script src="${escapeHtmlAttr(options.localPath)}"></script>`;
  }
  const cdnUrl = options.cdnUrl ?? "https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js";
  return `<script src="${escapeHtmlAttr(cdnUrl)}"></script>`;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
