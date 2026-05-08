export type TeamRunStatus =
  | "planning"
  | "running"
  | "waiting_approval"
  | "blocked"
  | "completed"
  | "failed"
  | "cancelled";

export type TeamWorkerRole =
  | "explorer"
  | "implementer"
  | "test_engineer"
  | "reviewer"
  | "writer";

export type TeamMergeStrategy = "reviewer-gated" | "test-gated" | "manual-gated";

export type TeamWritePolicy =
  | "read_only"
  | "claimed_files_only"
  | "approval_required";

export interface TeamBudget {
  maxWorkers: number;
  maxConcurrentWorkers: number;
  maxToolCallsPerWorker: number;
  maxDurationMsPerWorker: number;
  maxOutputBytesPerWorker: number;
  maxTotalDurationMs: number;
}

export interface TeamScope {
  files?: string[];
  directories?: string[];
  symbols?: string[];
  maxFiles?: number;
}

export interface TeamTask {
  id: string;
  role: TeamWorkerRole;
  objective: string;
  scope: TeamScope;
  deps: string[];
  allowedTools: string[];
  writePolicy: TeamWritePolicy;
  model?: string;
  acceptance: string[];
}

export interface TeamPlan {
  id: string;
  userGoal: string;
  status: Extract<TeamRunStatus, "planning">;
  tasks: TeamTask[];
  budget: TeamBudget;
  mergeStrategy: TeamMergeStrategy;
  stagingReason?: string;
  warnings: string[];
}

export interface TeamPlanOptions {
  maxWorkers?: number;
  maxConcurrentWorkers?: number;
  roleModels?: Partial<Record<TeamWorkerRole, string>>;
}

export type TeamTaskRunStatus = "pending" | "running" | "completed" | "blocked" | "failed";

export interface EvidenceRef {
  type: "tool" | "artifact" | "file" | "test" | "approval" | "blackboard";
  id?: string;
  path?: string;
  status?: "passed" | "failed" | "blocked";
}

export interface WorkerResult {
  taskId: string;
  role: TeamWorkerRole;
  status: Extract<TeamTaskRunStatus, "completed" | "failed" | "blocked">;
  summary: string;
  changedFiles: string[];
  evidence: EvidenceRef[];
  risks: string[];
  nextSteps: string[];
}

export type BlackboardEntryKind = "fact" | "risk" | "decision" | "artifact" | "test_result" | "handoff";

export interface BlackboardEntry {
  id: string;
  taskId: string;
  kind: BlackboardEntryKind;
  summary: string;
  evidenceRefs: EvidenceRef[];
  createdAt: number;
}

export type TeamMailboxMessageKind =
  | "handoff"
  | "question"
  | "permission_request"
  | "permission_response";

export interface TeamMailboxMessage {
  id: string;
  teamRunId: string;
  fromTaskId: string;
  toTaskId?: string;
  kind: TeamMailboxMessageKind;
  summary: string;
  text: string;
  evidenceRefs: EvidenceRef[];
  read: boolean;
  createdAt: number;
}

export interface TeamTaskRun {
  task: TeamTask;
  status: TeamTaskRunStatus;
  result?: WorkerResult;
  blockedReason?: string;
  startedAt?: number;
  completedAt?: number;
}

export type TeamClaimMode = "read" | "write";
export type TeamClaimStatus = "pending_approval" | "active" | "released" | "blocked";

export interface TeamClaim {
  id: string;
  teamRunId: string;
  taskId: string;
  path: string;
  mode: TeamClaimMode;
  status: TeamClaimStatus;
  reason?: string;
  createdAt: number;
  releasedAt?: number;
}

export type TeamMergeGateStatus = "passed" | "blocked";

export interface TeamMergeGateResult {
  status: TeamMergeGateStatus;
  strategy: TeamMergeStrategy;
  requiredRoles: TeamWorkerRole[];
  satisfiedRoles: TeamWorkerRole[];
  missingRoles: TeamWorkerRole[];
  evidence: EvidenceRef[];
  summary: string;
}

export interface TeamRun {
  id: string;
  sessionId?: string;
  userGoal: string;
  status: TeamRunStatus;
  plan: TeamPlan;
  taskRuns: TeamTaskRun[];
  claims: TeamClaim[];
  mergeGate: TeamMergeGateResult;
  blackboard: BlackboardEntry[];
  mailbox: TeamMailboxMessage[];
  summary: string;
  createdAt: number;
  updatedAt: number;
}
