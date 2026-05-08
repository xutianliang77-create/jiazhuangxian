/**
 * CodeClaw Data Golden Suite types.
 *
 * This suite is focused on data-analysis behavior, not general /ask quality.
 */

export type DataGoldenLayer =
  | "metadata"
  | "semantic"
  | "sql"
  | "execution"
  | "repair"
  | "chart"
  | "report"
  | "security"
  | "workflow"
  | "runtime";

export type DataGoldenDifficulty = "easy" | "medium" | "hard";

export interface DataGoldenToolCallSpec {
  must_invoke?: string[];
  must_not_invoke?: string[];
}

export interface DataGoldenCase {
  id: string;
  version: number;
  layer: DataGoldenLayer;
  difficulty: DataGoldenDifficulty;
  prompt: string;
  expected: {
    must_mention?: string[];
    must_not_mention?: string[];
    tool_calls?: DataGoldenToolCallSpec;
    rubric?: string;
  };
  deprecated?: boolean;
}

export interface DataGoldenScoreResult {
  pass: boolean;
  matched: string[];
  missed: string[];
  triggered: string[];
  invokedOk: string[];
  invokedMissing: string[];
  invokedForbidden: string[];
  reason: string;
}

export interface DataGoldenRunRecord {
  id: string;
  version: number;
  layer: DataGoldenLayer;
  difficulty: DataGoldenDifficulty;
  provider?: string;
  modelId?: string;
  promptChars: number;
  answerChars: number;
  answerExcerpt: string;
  toolsInvoked: string[];
  latencyMs: number;
  score: DataGoldenScoreResult;
  timestamp: number;
}

export interface DataGoldenRunSummary {
  total: number;
  passed: number;
  failed: number;
  byLayer: Record<DataGoldenLayer, { total: number; passed: number; rate: number }>;
  overallRate: number;
  meetsGate: boolean;
  startedAt: number;
  durationMs: number;
}

export interface DataGoldenRunnerConfig {
  ids?: string[];
  layerFilter?: DataGoldenLayer[];
  dryRun?: boolean;
  verbose?: boolean;
  reportPath?: string;
  useMock?: boolean;
}
