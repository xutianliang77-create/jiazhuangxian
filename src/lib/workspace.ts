import { realpathSync } from "node:fs";
import path from "node:path";

export function canonicalizeWorkspace(workspace: string): string {
  const resolved = path.resolve(workspace);
  try {
    return realpathSync.native(resolved);
  } catch {
    try {
      return realpathSync(resolved);
    } catch {
      return resolved;
    }
  }
}
