export type ChartKind =
  | "bar"
  | "line"
  | "area"
  | "pie"
  | "scatter"
  | "combo"
  | "heatmap"
  | "histogram"
  | "box"
  | "funnel"
  | "gauge"
  | "map"
  | "pivot";

export type ChartAggregation = "sum" | "count" | "avg" | "min" | "max" | "none";

export interface ForecastSpec {
  enabled: boolean;
  horizon?: number;
  method?: "auto" | "linear" | "moving_average";
}

export interface AnomalySpec {
  enabled: boolean;
  method?: "zscore" | "iqr" | "auto";
  sensitivity?: "low" | "medium" | "high";
}

export interface ChartSpec {
  kind: ChartKind;
  title?: string;
  x?: string;
  y?: string | string[];
  series?: string;
  color?: string;
  sort?: "asc" | "desc" | "none";
  limit?: number;
  aggregation?: ChartAggregation;
  options?: {
    stacked?: boolean;
    horizontal?: boolean;
    showLegend?: boolean;
    showTooltip?: boolean;
    showDataZoom?: boolean;
  };
  forecast?: ForecastSpec;
  anomaly?: AnomalySpec;
}

export interface ChartColumn {
  name: string;
  type?: string;
  semanticRole?: "dimension" | "measure" | "time" | "id" | "geo" | "unknown";
}

export interface ChartRenderInput {
  spec: ChartSpec;
  rows: Array<Record<string, unknown>>;
  columns: ChartColumn[];
}

export interface ChartQualityReview {
  score: number;
  warnings: string[];
  suggestions: string[];
}
