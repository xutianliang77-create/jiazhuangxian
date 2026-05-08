import type { EvidenceRef, TeamMailboxMessage, TeamMailboxMessageKind } from "./types";

export class TeamMailbox {
  private messages: TeamMailboxMessage[] = [];

  write(input: {
    teamRunId: string;
    fromTaskId: string;
    toTaskId?: string;
    kind: TeamMailboxMessageKind;
    summary: string;
    text: string;
    evidenceRefs?: EvidenceRef[];
  }): TeamMailboxMessage {
    const message: TeamMailboxMessage = {
      id: `mail-${this.messages.length + 1}`,
      teamRunId: input.teamRunId,
      fromTaskId: input.fromTaskId,
      ...(input.toTaskId ? { toTaskId: input.toTaskId } : {}),
      kind: input.kind,
      summary: input.summary.trim().slice(0, 120),
      text: input.text.trim().slice(0, 2 * 1024),
      evidenceRefs: input.evidenceRefs ?? [],
      read: false,
      createdAt: Date.now(),
    };
    this.messages.push(message);
    return message;
  }

  unread(toTaskId?: string): TeamMailboxMessage[] {
    return this.messages
      .filter((message) => !message.read && (!toTaskId || message.toTaskId === toTaskId))
      .map((message) => ({ ...message, evidenceRefs: [...message.evidenceRefs] }));
  }

  list(): TeamMailboxMessage[] {
    return this.messages.map((message) => ({ ...message, evidenceRefs: [...message.evidenceRefs] }));
  }
}
