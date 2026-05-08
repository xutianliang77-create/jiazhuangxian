const SIMPLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

export function prepareSqlReference(path: string): string {
  const segments = splitPath(path);
  if (segments.length === 0) throw new Error("path is required");
  return segments.map(quoteSegment).join(".");
}

function splitPath(path: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: '"' | "`" | null = null;
  for (const ch of path.trim()) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ".") {
      if (current.trim()) out.push(unquote(current.trim()));
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(unquote(current.trim()));
  return out;
}

function unquote(segment: string): string {
  if (
    (segment.startsWith('"') && segment.endsWith('"')) ||
    (segment.startsWith("`") && segment.endsWith("`"))
  ) {
    return segment.slice(1, -1);
  }
  return segment;
}

function quoteSegment(segment: string): string {
  if (SIMPLE_IDENTIFIER.test(segment) && !segment.startsWith("@")) return segment;
  return `"${segment.replace(/"/g, '""')}"`;
}
