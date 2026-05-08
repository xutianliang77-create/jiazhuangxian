import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SessionsList from "./SessionsList";
import { useMessagesStore } from "@/store/messages";
import { useSessionsStore } from "@/store/sessions";
import { deleteSession, listSessions } from "@/api/endpoints";

vi.mock("@/api/endpoints", () => ({
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  listSessions: vi.fn(),
}));

const sessions = [
  {
    sessionId: "web-active",
    userId: "u1",
    channel: "http" as const,
    createdAt: 1,
    lastSeenAt: 2,
    title: "当前会话",
    messageCount: 2,
  },
  {
    sessionId: "web-next",
    userId: "u1",
    channel: "http" as const,
    createdAt: 1,
    lastSeenAt: 3,
    title: "下一个会话",
  },
];

describe("SessionsList", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(listSessions).mockResolvedValue({ sessions });
    vi.mocked(deleteSession).mockResolvedValue({ ok: true });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    useSessionsStore.setState({ list: [], activeId: null });
    useMessagesStore.setState({ bySession: new Map() });
  });

  it("archives the selected session and switches to the next one", async () => {
    render(<SessionsList onError={() => undefined} />);

    await screen.findByText("当前会话");
    vi.mocked(listSessions).mockResolvedValue({ sessions: [sessions[1]] });
    act(() => {
      useSessionsStore.getState().setActive("web-active");
      useMessagesStore.getState().hydrate("web-active", [
        { id: "m1", sessionId: "web-active", role: "user", text: "hi", ts: 1 },
      ]);
    });

    fireEvent.click(screen.getByLabelText("归档会话 当前会话"));

    await waitFor(() => expect(deleteSession).toHaveBeenCalledWith("web-active"));
    await waitFor(() =>
      expect(useSessionsStore.getState().list.map((session) => session.sessionId)).toEqual(["web-next"])
    );
    expect(useSessionsStore.getState().list.map((session) => session.sessionId)).toEqual(["web-next"]);
    expect(useSessionsStore.getState().activeId).toBe("web-next");
    expect(useMessagesStore.getState().get("web-active")).toEqual([]);
  });
});
