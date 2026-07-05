/**
 * Shared design tokens — single source of truth for both platforms so the web
 * and mobile apps stay visually consistent.
 */

export const colors = {
  // dark workspace (default)
  bg: "#000000",
  surface: "#111318",
  surfaceRaised: "#1a1d24",
  border: "#2a2e38",
  text: "#f2f4f8",
  textMuted: "#9aa3b2",
  accent: "#4f8cff",

  // cell status colours (colorblind-friendly: distinguishable by luminance too)
  statusNotStarted: "transparent",
  statusCompleted: "#2e7d32cc",
  statusSkipped: "#8e24aacc",
  statusNeedsReview: "#e65100cc",

  // filter rendering
  highlight: "#ffd60a", // bright yellow
  highlightAlt: "#00e5ff", // colorblind-friendly alternative
  dimmed: "#55555588",

  gridLine: "#333842",
  gridLineMajor: "#4a5160",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const typography = {
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  sizeXs: 12,
  sizeSm: 14,
  sizeMd: 16,
  sizeLg: 20,
  sizeXl: 28,
} as const;

export const radii = { sm: 4, md: 8, lg: 16 } as const;

export interface AccessibilityPrefs {
  /** multiplier applied to symbol/cell render size */
  symbolScale: number;
  highContrast: boolean;
  /** use the cyan highlight instead of yellow */
  colorblindHighlight: boolean;
}

export const DEFAULT_A11Y: AccessibilityPrefs = {
  symbolScale: 1,
  highContrast: false,
  colorblindHighlight: false,
};

export function highlightColor(prefs: AccessibilityPrefs): string {
  return prefs.colorblindHighlight ? colors.highlightAlt : colors.highlight;
}
