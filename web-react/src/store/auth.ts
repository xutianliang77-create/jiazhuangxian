/**
 * Auth state（B.2）· token + 连接状态
 */

import { create } from "zustand";

const STORAGE_KEY = "codeclaw_token";

interface AuthState {
  token: string;
  connected: boolean;
  setToken(t: string): void;
  setConnected(b: boolean): void;
  logout(): void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: readStoredToken(),
  connected: false,
  setToken(t) {
    writeStoredToken(t);
    set({ token: t });
  },
  setConnected(b) {
    set({ connected: b });
  },
  logout() {
    writeStoredToken("");
    set({ token: "", connected: false });
  },
}));

function storage(): Storage | null {
  if (typeof localStorage === "undefined") return null;
  if (typeof localStorage.getItem !== "function") return null;
  if (typeof localStorage.setItem !== "function") return null;
  if (typeof localStorage.removeItem !== "function") return null;
  return localStorage;
}

function readStoredToken(): string {
  try {
    return storage()?.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeStoredToken(token: string): void {
  try {
    const s = storage();
    if (!s) return;
    if (token) s.setItem(STORAGE_KEY, token);
    else s.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be unavailable in privacy/test environments.
  }
}
