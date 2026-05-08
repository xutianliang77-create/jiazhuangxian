import Database from "better-sqlite3";
import os from "node:os";
import path from "node:path";

export interface MedicalKnowledgeStoreOptions {
  db?: Database.Database;
  dbPath?: string;
}

export interface ToolResponse {
  status: "ok" | "error";
  result: Record<string, unknown>;
  warnings: string[];
  error?: {
    code: string;
    message: string;
    detail?: Record<string, unknown>;
  };
}

interface TiradsRuleRow {
  id: string;
  system_name: string;
  system_version: string;
  rule_code: string;
  feature_group: string | null;
  feature_name: string | null;
  points: number | null;
  category: string | null;
  min_score: number | null;
  max_score: number | null;
  recommendation: string | null;
  rule_json: string;
  evidence_document_id: string | null;
  status: string;
  created_at: number;
  updated_at: number;
}

interface ReportTemplateRow {
  id: string;
  template_name: string;
  scene: string;
  tirads_category: string | null;
  template_text: string;
  required_fields_json: string;
  forbidden_phrases_json: string;
  version: string;
  status: string;
  created_at: number;
  updated_at: number;
}

interface MedicalTermRow {
  id: string;
  canonical_name: string;
  synonyms_json: string;
  category: string;
  description: string | null;
  standard_code: string | null;
  forbidden: number;
  created_at: number;
  updated_at: number;
}

export class MedicalKnowledgeStore {
  private readonly externalDb?: Database.Database;
  private readonly dbPath: string;
  private db?: Database.Database;

  constructor(options: MedicalKnowledgeStoreOptions = {}) {
    this.externalDb = options.db;
    this.dbPath = options.dbPath ?? process.env.JZX_DATA_DB ?? path.join(os.homedir(), ".codeclaw", "data.db");
  }

  getTiradsRule(input: Record<string, unknown>): ToolResponse {
    const systemName = optionalString(input.system_name) ?? "ACR_TI_RADS";
    const systemVersion = optionalString(input.system_version) ?? "2017";
    const ruleCode = optionalString(input.rule_code);
    const featureGroup = optionalString(input.feature_group);
    const featureName = optionalString(input.feature_name);
    const category = optionalString(input.category);
    const limit = clampLimit(input.limit, 20);
    return this.withDb((db) => {
      const where = ["system_name = ?", "system_version = ?", "status = 'active'"];
      const params: Array<string | number> = [systemName, systemVersion];
      if (ruleCode) {
        where.push("rule_code = ?");
        params.push(ruleCode);
      }
      if (featureGroup) {
        where.push("feature_group = ?");
        params.push(featureGroup);
      }
      if (featureName) {
        where.push("feature_name = ?");
        params.push(featureName);
      }
      if (category) {
        where.push("category = ?");
        params.push(category);
      }
      params.push(limit);
      const rules = db
        .prepare(
          `SELECT *
           FROM tirads_rules
           WHERE ${where.join(" AND ")}
           ORDER BY feature_group ASC, rule_code ASC
           LIMIT ?`
        )
        .all(...params)
        .map((row) => mapRule(row as TiradsRuleRow));
      if (rules.length === 0) {
        return err("tirads_rule_not_found", "No active TI-RADS rule matched the query.", {
          system_name: systemName,
          system_version: systemVersion,
          rule_code: ruleCode,
          feature_group: featureGroup,
          feature_name: featureName,
          category,
        });
      }
      return ok({ rules, count: rules.length, system_name: systemName, system_version: systemVersion });
    });
  }

  getReportTemplate(input: Record<string, unknown>): ToolResponse {
    const scene = optionalString(input.scene);
    if (!scene) return err("invalid_request", "scene is required");
    const category = optionalString(input.category) ?? optionalString(input.tirads_category);
    const version = optionalString(input.version);
    return this.withDb((db) => {
      const params: Array<string | number | null> = [scene];
      const where = ["scene = ?", "status = 'active'"];
      if (category) {
        where.push("(tirads_category = ? OR tirads_category IS NULL)");
        params.push(category);
      }
      if (version) {
        where.push("version = ?");
        params.push(version);
      }
      const template = db
        .prepare(
          `SELECT *
           FROM report_templates
           WHERE ${where.join(" AND ")}
           ORDER BY
             CASE WHEN tirads_category = ? THEN 0 ELSE 1 END,
             version DESC,
             id ASC
           LIMIT 1`
        )
        .get(...params, category ?? null) as ReportTemplateRow | undefined;
      if (!template) {
        return err("report_template_not_found", "No active report template matched the query.", {
          scene,
          category,
          version,
        });
      }
      return ok({ template: mapTemplate(template) });
    });
  }

  normalizeTerm(input: Record<string, unknown>): ToolResponse {
    const text = optionalString(input.text);
    if (!text) return err("invalid_request", "text is required");
    const category = optionalString(input.category);
    return this.withDb((db) => {
      const rows = category
        ? (db
            .prepare("SELECT * FROM medical_terms WHERE category = ? ORDER BY canonical_name ASC")
            .all(category) as MedicalTermRow[])
        : (db.prepare("SELECT * FROM medical_terms ORDER BY canonical_name ASC").all() as MedicalTermRow[]);
      const normalizedText = normalizeText(text);
      const matches = rows
        .map((row) => matchTerm(row, normalizedText))
        .filter((match): match is NonNullable<ReturnType<typeof matchTerm>> => Boolean(match));
      return ok({ normalized_terms: matches, count: matches.length, text });
    });
  }

  private withDb(callback: (db: Database.Database) => ToolResponse): ToolResponse {
    try {
      const db = this.getDb();
      return callback(db);
    } catch (error) {
      return err("knowledge_db_unavailable", error instanceof Error ? error.message : String(error), {
        db_path: this.dbPath,
      });
    }
  }

  private getDb(): Database.Database {
    if (this.externalDb) return this.externalDb;
    if (!this.db) this.db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
    return this.db;
  }
}

function mapRule(row: TiradsRuleRow): Record<string, unknown> {
  return {
    id: row.id,
    system_name: row.system_name,
    system_version: row.system_version,
    rule_code: row.rule_code,
    feature_group: row.feature_group,
    feature_name: row.feature_name,
    points: row.points,
    category: row.category,
    min_score: row.min_score,
    max_score: row.max_score,
    recommendation: row.recommendation,
    rule: parseJsonObject(row.rule_json),
    evidence_document_id: row.evidence_document_id,
    status: row.status,
  };
}

function mapTemplate(row: ReportTemplateRow): Record<string, unknown> {
  return {
    id: row.id,
    template_name: row.template_name,
    scene: row.scene,
    tirads_category: row.tirads_category,
    template_text: row.template_text,
    required_fields: parseJsonArray(row.required_fields_json),
    forbidden_phrases: parseJsonArray(row.forbidden_phrases_json),
    version: row.version,
    status: row.status,
  };
}

function matchTerm(row: MedicalTermRow, normalizedText: string): Record<string, unknown> | null {
  const terms = [row.canonical_name, ...parseJsonArray(row.synonyms_json).filter((item): item is string => typeof item === "string")];
  const matched = terms.find((term) => {
    const normalizedTerm = normalizeText(term);
    return normalizedTerm.length > 0 && (normalizedText === normalizedTerm || normalizedText.includes(normalizedTerm));
  });
  if (!matched) return null;
  return {
    canonical_name: row.canonical_name,
    matched_text: matched,
    category: row.category,
    description: row.description,
    standard_code: row.standard_code,
    forbidden: row.forbidden === 1,
  };
}

function ok(result: Record<string, unknown>, warnings: string[] = []): ToolResponse {
  return { status: "ok", result, warnings };
}

function err(code: string, message: string, detail?: Record<string, unknown>): ToolResponse {
  return { status: "error", result: {}, warnings: [], error: { code, message, ...(detail ? { detail } : {}) } };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function clampLimit(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(100, Math.floor(value)));
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}
