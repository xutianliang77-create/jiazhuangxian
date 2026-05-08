import { randomUUID } from "node:crypto";

export function createChartId(prefix = "chart"): string {
  return `${prefix}-${randomUUID()}`;
}
