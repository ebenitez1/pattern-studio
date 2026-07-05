/**
 * Bridges the shared design tokens into CSS custom properties on :root so the
 * plain-CSS stylesheets stay in sync with @pattern-studio/core.
 */
import { colors, radii, spacing, typography } from "@pattern-studio/core";

export function applyThemeVariables(): void {
  const root = document.documentElement;
  const set = (name: string, value: string) => root.style.setProperty(name, value);

  set("--color-bg", colors.bg);
  set("--color-surface", colors.surface);
  set("--color-surface-raised", colors.surfaceRaised);
  set("--color-border", colors.border);
  set("--color-text", colors.text);
  set("--color-text-muted", colors.textMuted);
  set("--color-accent", colors.accent);
  set("--color-highlight", colors.highlight);
  set("--color-status-completed", colors.statusCompleted);
  set("--color-status-skipped", colors.statusSkipped);
  set("--color-status-needs-review", colors.statusNeedsReview);
  set("--color-grid-line", colors.gridLine);
  set("--color-grid-line-major", colors.gridLineMajor);

  set("--space-xs", `${spacing.xs}px`);
  set("--space-sm", `${spacing.sm}px`);
  set("--space-md", `${spacing.md}px`);
  set("--space-lg", `${spacing.lg}px`);
  set("--space-xl", `${spacing.xl}px`);

  set("--radius-sm", `${radii.sm}px`);
  set("--radius-md", `${radii.md}px`);
  set("--radius-lg", `${radii.lg}px`);

  set("--font-family", typography.fontFamily);
  set("--font-size-xs", `${typography.sizeXs}px`);
  set("--font-size-sm", `${typography.sizeSm}px`);
  set("--font-size-md", `${typography.sizeMd}px`);
  set("--font-size-lg", `${typography.sizeLg}px`);
  set("--font-size-xl", `${typography.sizeXl}px`);
}
