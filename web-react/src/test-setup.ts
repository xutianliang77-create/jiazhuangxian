/**
 * vitest 全局 setup
 *
 * 仅 import @testing-library/jest-dom 注入 expect 扩展。
 * 不做 mock；测试文件按需 vi.mock。
 */
import "@testing-library/jest-dom/vitest";

const storage = globalThis.localStorage as Storage | undefined;
if (
  !storage ||
  typeof storage.getItem !== "function" ||
  typeof storage.setItem !== "function" ||
  typeof storage.removeItem !== "function" ||
  typeof storage.clear !== "function"
) {
  const values = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.has(key) ? values.get(key)! : null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: shim,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: shim,
    });
  }
}
