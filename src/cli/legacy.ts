import path from "node:path";

export function legacyBinaryWarning(argv1: string | undefined): string | undefined {
  if (!argv1) return undefined;
  const base = path.basename(argv1).replace(/\.(?:c?js|mjs|tsx?)$/i, "");
  if (base !== "chatbi") return undefined;
  return "Note: `chatbi` has been renamed to `codeclaw`; please relink with `npm link` and use `codeclaw` going forward.";
}
