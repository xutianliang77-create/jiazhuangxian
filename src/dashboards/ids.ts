import { randomUUID } from "node:crypto";

export function createDashboardId(prefix = "dashboard"): string {
  return `${prefix}-${randomUUID()}`;
}
