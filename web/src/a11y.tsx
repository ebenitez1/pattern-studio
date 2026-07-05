/**
 * Accessibility preferences: persisted in localStorage, exposed via context.
 * High-contrast mode also flips a data attribute on <html> so plain CSS can
 * react (stronger borders, pure white text).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_A11Y, type AccessibilityPrefs } from "@pattern-studio/core";

const STORAGE_KEY = "pattern-studio:a11y";

function loadPrefs(): AccessibilityPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_A11Y;
    const parsed = JSON.parse(raw) as Partial<AccessibilityPrefs>;
    return {
      symbolScale:
        typeof parsed.symbolScale === "number"
          ? Math.min(2, Math.max(0.75, parsed.symbolScale))
          : DEFAULT_A11Y.symbolScale,
      highContrast: !!parsed.highContrast,
      colorblindHighlight: !!parsed.colorblindHighlight,
    };
  } catch {
    return DEFAULT_A11Y;
  }
}

interface A11yContextValue {
  prefs: AccessibilityPrefs;
  updatePrefs: (patch: Partial<AccessibilityPrefs>) => void;
}

const A11yContext = createContext<A11yContextValue>({
  prefs: DEFAULT_A11Y,
  updatePrefs: () => undefined,
});

export function A11yProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<AccessibilityPrefs>(loadPrefs);

  const updatePrefs = useCallback((patch: Partial<AccessibilityPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage full / unavailable — prefs still apply for this session
      }
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.highContrast = prefs.highContrast
      ? "true"
      : "false";
  }, [prefs.highContrast]);

  return (
    <A11yContext.Provider value={{ prefs, updatePrefs }}>
      {children}
    </A11yContext.Provider>
  );
}

export function useA11y(): A11yContextValue {
  return useContext(A11yContext);
}
