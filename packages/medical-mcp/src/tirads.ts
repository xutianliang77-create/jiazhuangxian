export interface TiradsInput {
  system_name?: string;
  system_version?: string;
  features: {
    composition?: string;
    echogenicity?: string;
    shape?: string;
    margin?: string;
    echogenic_foci?: string | string[];
  };
  size_mm?: {
    long_axis?: number;
    short_axis?: number;
    ap_axis?: number;
  };
}

export interface TiradsResult {
  status: "ok";
  result: {
    system_name: "ACR_TI_RADS";
    system_version: "2017";
    score: number;
    category: "TR1" | "TR2" | "TR3" | "TR4" | "TR5";
    recommendation: string;
    recommendation_code: "none" | "follow_up" | "fna";
    evidence_rules: Array<{
      rule_code: string;
      feature_group: string;
      feature_value: string;
      points: number;
    }>;
  };
  warnings: string[];
}

const COMPOSITION: Record<string, number> = {
  "cystic": 0,
  "almost_completely_cystic": 0,
  "spongiform": 0,
  "mixed_cystic_solid": 1,
  "solid": 2,
  "almost_completely_solid": 2,
};

const ECHOGENICITY: Record<string, number> = {
  "anechoic": 0,
  "hyperechoic": 1,
  "isoechoic": 1,
  "hypoechoic": 2,
  "very_hypoechoic": 3,
};

const SHAPE: Record<string, number> = {
  "wider_than_tall": 0,
  "taller_than_wide": 3,
};

const MARGIN: Record<string, number> = {
  "smooth": 0,
  "ill_defined": 0,
  "lobulated": 2,
  "irregular": 2,
  "extrathyroidal_extension": 3,
};

const ECHOGENIC_FOCI: Record<string, number> = {
  "none": 0,
  "large_comet_tail": 0,
  "macrocalcifications": 1,
  "peripheral_rim_calcifications": 2,
  "punctate_echogenic_foci": 3,
};

export function calculateAcrTirads(input: TiradsInput): TiradsResult {
  const systemName = input.system_name ?? "ACR_TI_RADS";
  const systemVersion = input.system_version ?? "2017";
  if (systemName !== "ACR_TI_RADS" || systemVersion !== "2017") {
    throw new Error(`unsupported TI-RADS system: ${systemName}/${systemVersion}`);
  }

  const warnings: string[] = [];
  const evidenceRules: TiradsResult["result"]["evidence_rules"] = [];
  let score = 0;

  score += addSingleFeature("composition", input.features.composition, COMPOSITION, evidenceRules, warnings);
  score += addSingleFeature("echogenicity", input.features.echogenicity, ECHOGENICITY, evidenceRules, warnings);
  score += addSingleFeature("shape", input.features.shape, SHAPE, evidenceRules, warnings);
  score += addSingleFeature("margin", input.features.margin, MARGIN, evidenceRules, warnings);
  score += addEchogenicFoci(input.features.echogenic_foci, evidenceRules, warnings);

  const category = categoryForScore(score);
  const recommendation = recommendationFor(category, input.size_mm?.long_axis);

  return {
    status: "ok",
    result: {
      system_name: "ACR_TI_RADS",
      system_version: "2017",
      score,
      category,
      recommendation: recommendation.text,
      recommendation_code: recommendation.code,
      evidence_rules: evidenceRules,
    },
    warnings,
  };
}

function addSingleFeature(
  group: string,
  value: string | undefined,
  table: Record<string, number>,
  evidenceRules: TiradsResult["result"]["evidence_rules"],
  warnings: string[]
): number {
  if (!value) {
    warnings.push(`missing_${group}`);
    return 0;
  }
  const normalized = normalize(value);
  const points = table[normalized];
  if (points === undefined) {
    warnings.push(`unknown_${group}:${value}`);
    return 0;
  }
  evidenceRules.push({
    rule_code: `ACR_2017_${group}_${normalized}`,
    feature_group: group,
    feature_value: normalized,
    points,
  });
  return points;
}

function addEchogenicFoci(
  value: string | string[] | undefined,
  evidenceRules: TiradsResult["result"]["evidence_rules"],
  warnings: string[]
): number {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  if (values.length === 0) {
    warnings.push("missing_echogenic_foci");
    return 0;
  }
  let total = 0;
  for (const raw of values) {
    const normalized = normalize(raw);
    const points = ECHOGENIC_FOCI[normalized];
    if (points === undefined) {
      warnings.push(`unknown_echogenic_foci:${raw}`);
      continue;
    }
    if (normalized === "none" && values.length > 1) {
      warnings.push("echogenic_foci_none_should_not_be_combined");
      continue;
    }
    evidenceRules.push({
      rule_code: `ACR_2017_echogenic_foci_${normalized}`,
      feature_group: "echogenic_foci",
      feature_value: normalized,
      points,
    });
    total += points;
  }
  return total;
}

function categoryForScore(score: number): TiradsResult["result"]["category"] {
  if (score === 0) return "TR1";
  if (score <= 2) return "TR2";
  if (score === 3) return "TR3";
  if (score <= 6) return "TR4";
  return "TR5";
}

function recommendationFor(
  category: TiradsResult["result"]["category"],
  longAxisMm: number | undefined
): { code: TiradsResult["result"]["recommendation_code"]; text: string } {
  if (category === "TR1" || category === "TR2") {
    return { code: "none", text: "No FNA or routine follow-up is recommended by ACR TI-RADS." };
  }
  if (!longAxisMm || longAxisMm <= 0) {
    return {
      code: "follow_up",
      text: "Size is unavailable; recommendation requires physician review before FNA/follow-up decision.",
    };
  }
  if (category === "TR3") {
    if (longAxisMm >= 25) return { code: "fna", text: "TR3 nodule >=25 mm: consider FNA." };
    if (longAxisMm >= 15) return { code: "follow_up", text: "TR3 nodule >=15 mm: ultrasound follow-up." };
    return { code: "none", text: "TR3 nodule below follow-up threshold." };
  }
  if (category === "TR4") {
    if (longAxisMm >= 15) return { code: "fna", text: "TR4 nodule >=15 mm: consider FNA." };
    if (longAxisMm >= 10) return { code: "follow_up", text: "TR4 nodule >=10 mm: ultrasound follow-up." };
    return { code: "none", text: "TR4 nodule below follow-up threshold." };
  }
  if (longAxisMm >= 10) return { code: "fna", text: "TR5 nodule >=10 mm: consider FNA." };
  if (longAxisMm >= 5) return { code: "follow_up", text: "TR5 nodule >=5 mm: ultrasound follow-up." };
  return { code: "none", text: "TR5 nodule below follow-up threshold." };
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}
