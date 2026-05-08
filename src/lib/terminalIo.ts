export function isTerminalIoError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "EIO" || code === "EPIPE") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\b(read|write)\s+(EIO|EPIPE)\b/i.test(message);
}

export function formatTerminalIoLog(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const message = error instanceof Error ? error.message : String(error);
  return `terminal io closed${code ? ` (${code})` : ""}: ${message.split("\n")[0]}`;
}

export function formatTerminalSignalLog(signal: NodeJS.Signals): string {
  return `terminal session closed (${signal})`;
}
