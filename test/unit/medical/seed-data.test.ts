import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { calculateAcrTirads } from "../../../packages/medical-mcp/src/tirads";
import { currentVersion, migrateIfNeeded } from "../../../src/storage/migrate";

let tmpRoot: string;
let db: Database.Database;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "jzx-seed-"));
  db = new Database(path.join(tmpRoot, "data.db"));
  db.pragma("foreign_keys = ON");
  migrateIfNeeded(db, "data");
});

afterEach(() => {
  try {
    db.close();
  } catch {
    // noop
  }
  if (tmpRoot) rmSync(tmpRoot, { recursive: true, force: true });
});

describe("medical seed data migration", () => {
  it("seeds ACR TI-RADS 2017 rules, report templates, and safety rules", () => {
    expect(currentVersion(db)).toBeGreaterThanOrEqual(7);

    const ruleCount = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM tirads_rules
         WHERE system_name = 'ACR_TI_RADS' AND system_version = '2017' AND status = 'active'`
      )
      .get() as { count: number };
    expect(ruleCount.count).toBe(36);

    expect(getRule("ACR_2017_composition_solid")).toMatchObject({
      feature_group: "composition",
      feature_name: "solid",
      points: 2,
    });
    expect(getRule("ACR_2017_echogenicity_very_hypoechoic")).toMatchObject({
      feature_group: "echogenicity",
      feature_name: "very_hypoechoic",
      points: 3,
    });
    expect(getRule("ACR_2017_category_TR5")).toMatchObject({
      feature_group: "category",
      category: "TR5",
      min_score: 7,
      max_score: null,
    });
    expect(JSON.parse(String(getRule("ACR_2017_recommend_TR5_fna").rule_json))).toMatchObject({
      recommendation_code: "fna",
      min_long_axis_mm: 10,
    });

    const templates = db
      .prepare("SELECT id, status FROM report_templates ORDER BY id")
      .all() as Array<{ id: string; status: string }>;
    expect(templates.map((row) => row.id)).toEqual([
      "tpl-thyroid-doctor-review-summary-v1",
      "tpl-thyroid-tirads-explanation-v1",
      "tpl-thyroid-ultrasound-draft-v1",
    ]);
    expect(templates.every((row) => row.status === "active")).toBe(true);

    const safetyCodes = db
      .prepare("SELECT rule_code FROM safety_rules ORDER BY rule_code")
      .all()
      .map((row: unknown) => (row as { rule_code: string }).rule_code);
    expect(safetyCodes).toEqual([
      "BLOCK_LOW_CONFIDENCE_AUTOMATION",
      "NO_FINAL_DIAGNOSIS_WITHOUT_DOCTOR",
      "NO_UNSUPPORTED_FNA_RECOMMENDATION",
      "PHI_NOT_ALLOWED_IN_MODEL_LOG",
      "REQUIRE_MANUAL_CALIBRATION_FOR_MM",
    ]);
  });

  it("keeps static calculator evidence rule codes backed by DB rows", () => {
    const calculated = calculateAcrTirads({
      features: {
        composition: "solid",
        echogenicity: "hypoechoic",
        shape: "taller_than_wide",
        margin: "irregular",
        echogenic_foci: ["punctate_echogenic_foci"],
      },
      size_mm: { long_axis: 12 },
    });

    for (const evidence of calculated.result.evidence_rules) {
      const row = getRule(evidence.rule_code);
      expect(row).toMatchObject({
        feature_group: evidence.feature_group,
        feature_name: evidence.feature_value,
        points: evidence.points,
      });
    }
  });

  it("does not duplicate seed rows on a second migration run", () => {
    migrateIfNeeded(db, "data");
    const tables = ["medical_documents", "tirads_rules", "report_templates", "safety_rules"];
    const counts = Object.fromEntries(
      tables.map((table) => [
        table,
        (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
      ])
    );
    expect(counts).toEqual({
      medical_documents: 3,
      tirads_rules: 36,
      report_templates: 3,
      safety_rules: 5,
    });
  });
});

function getRule(ruleCode: string): Record<string, unknown> {
  const row = db
    .prepare("SELECT * FROM tirads_rules WHERE system_name = 'ACR_TI_RADS' AND system_version = '2017' AND rule_code = ?")
    .get(ruleCode) as Record<string, unknown> | undefined;
  if (!row) throw new Error(`Missing rule: ${ruleCode}`);
  return row;
}
