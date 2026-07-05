import type { PatternSymbol, ProjectSummary } from "../types";

/**
 * Search symbols by OCR text, colour name or colour number/code.
 * Case-insensitive substring match; empty query returns everything.
 */
export function searchSymbols(
  symbols: PatternSymbol[],
  query: string,
): PatternSymbol[] {
  const q = query.trim().toLowerCase();
  if (!q) return symbols;
  return symbols.filter((s) => {
    return (
      (s.ocr_text && s.ocr_text.toLowerCase().includes(q)) ||
      (s.color_name && s.color_name.toLowerCase().includes(q)) ||
      (s.color_code && s.color_code.toLowerCase().includes(q)) ||
      (s.dominant_color && s.dominant_color.toLowerCase().includes(q))
    );
  });
}

/** Filter the project list by name or tag. */
export function searchProjects(
  projects: ProjectSummary[],
  query: string,
  tag?: string,
): ProjectSummary[] {
  const q = query.trim().toLowerCase();
  let out = projects;
  if (tag) out = out.filter((p) => p.tags.includes(tag));
  if (q) {
    out = out.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }
  return [...out].sort((a, b) => b.last_opened_at - a.last_opened_at);
}
