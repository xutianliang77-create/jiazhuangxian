const READ_PREFIX = /^(select|with|show|describe|desc|explain)\b/i;
const BLOCKED_WORDS =
  /\b(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|copy|vacuum|call|use)\b/i;

export function assertReadOnlySql(sql: string): string {
  const normalized = sql.trim().replace(/;+\s*$/, "");
  if (!normalized) throw new Error("sql is required");
  if (!READ_PREFIX.test(normalized)) {
    throw new Error("only read-only SQL is allowed: SELECT/WITH/SHOW/DESCRIBE/EXPLAIN");
  }
  if (normalized.includes(";")) {
    throw new Error("multiple SQL statements are not allowed");
  }
  if (BLOCKED_WORDS.test(normalized)) {
    throw new Error("unsafe SQL keyword detected; only read-only SQL is allowed");
  }
  return normalized;
}
