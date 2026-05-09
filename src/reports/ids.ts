import { randomUUID } from "node:crypto";

export function createReportId(prefix = "report"): string {
  return `${prefix}-${randomUUID()}`;
}
