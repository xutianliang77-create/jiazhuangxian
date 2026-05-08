/**
 * Sessions state（B.2）· 当前 active session + 全部 list
 */

import { create } from "zustand";
import type { SessionMeta } from "@/api/endpoints";

interface SessionsState {
  list: SessionMeta[];
  activeId: string | null;
  setList(next: SessionMeta[]): void;
  setActive(id: string | null): void;
  upsert(s: SessionMeta): void;
  remove(sessionId: string): void;
}

export const useSessionsStore = create<SessionsState>((set) => ({
  list: [],
  activeId: null,
  setList(next) {
    set({ list: next });
  },
  setActive(id) {
    set({ activeId: id });
  },
  upsert(s) {
    set((state) => {
      const idx = state.list.findIndex((x) => x.sessionId === s.sessionId);
      const list = [...state.list];
      if (idx >= 0) list[idx] = s;
      else list.unshift(s);
      return { list };
    });
  },
  remove(sessionId) {
    set((state) => {
      const list = state.list.filter((session) => session.sessionId !== sessionId);
      const activeId = state.activeId === sessionId ? list[0]?.sessionId ?? null : state.activeId;
      return { list, activeId };
    });
  },
}));
