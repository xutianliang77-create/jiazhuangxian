import type { BlackboardEntry, BlackboardEntryKind, EvidenceRef } from "./types";

export class TeamBlackboard {
  private entries: BlackboardEntry[] = [];

  add(input: {
    taskId: string;
    kind: BlackboardEntryKind;
    summary: string;
    evidenceRefs?: EvidenceRef[];
  }): BlackboardEntry {
    const normalizedSummary = input.summary.trim().slice(0, 500);
    const existing = this.entries.find(
      (entry) => entry.kind === input.kind && entry.summary === normalizedSummary
    );
    if (existing) {
      return existing;
    }
    const entry: BlackboardEntry = {
      id: `bb-${this.entries.length + 1}`,
      taskId: input.taskId,
      kind: input.kind,
      summary: normalizedSummary,
      evidenceRefs: input.evidenceRefs ?? [],
      createdAt: Date.now(),
    };
    this.entries.push(entry);
    return entry;
  }

  list(): BlackboardEntry[] {
    return this.entries.map((entry) => ({ ...entry, evidenceRefs: [...entry.evidenceRefs] }));
  }
}
