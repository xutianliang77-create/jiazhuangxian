import type {
  EvidenceRef,
  TeamMergeGateResult,
  TeamMergeStrategy,
  TeamPlan,
  TeamTaskRun,
  TeamWorkerRole,
} from "./types";

export function evaluateTeamMergeGate(plan: TeamPlan, taskRuns: TeamTaskRun[]): TeamMergeGateResult {
  const requiredRoles = requiredRolesForStrategy(plan.mergeStrategy, plan.tasks.map((task) => task.role));
  const satisfiedRoles: TeamWorkerRole[] = [];
  const evidence: EvidenceRef[] = [];

  for (const role of requiredRoles) {
    const matchingRuns = taskRuns.filter((taskRun) => taskRun.task.role === role);
    const passedEvidence = matchingRuns.flatMap((taskRun) =>
      taskRun.status === "completed" && taskRun.result
        ? taskRun.result.evidence.filter((ref) => ref.status === "passed")
        : []
    );
    if (passedEvidence.length > 0) {
      satisfiedRoles.push(role);
      evidence.push(...passedEvidence);
    }
  }

  const missingRoles = requiredRoles.filter((role) => !satisfiedRoles.includes(role));
  const status = missingRoles.length === 0 ? "passed" : "blocked";

  return {
    status,
    strategy: plan.mergeStrategy,
    requiredRoles,
    satisfiedRoles,
    missingRoles,
    evidence,
    summary: status === "passed"
      ? `Merge gate passed via ${satisfiedRoles.join(", ")} evidence.`
      : `Merge gate blocked; missing passed evidence from ${missingRoles.join(", ")}.`,
  };
}

function requiredRolesForStrategy(strategy: TeamMergeStrategy, plannedRoles: TeamWorkerRole[]): TeamWorkerRole[] {
  if (strategy === "manual-gated") return [];
  const required: TeamWorkerRole[] = ["reviewer"];
  if (strategy === "test-gated" && plannedRoles.includes("test_engineer")) {
    required.unshift("test_engineer");
  }
  return required;
}
