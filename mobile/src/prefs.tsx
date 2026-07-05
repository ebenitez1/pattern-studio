/**
 * App-level preferences: accessibility settings + backend URL, persisted in
 * AsyncStorage and exposed through React context.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_A11Y, type AccessibilityPrefs } from "@pattern-studio/core";
import { DEFAULT_API_BASE_URL, loadApiBaseUrl, saveApiBaseUrl } from "./api";

const A11Y_KEY = "ps.a11y";

export const SYMBOL_SCALE_MIN = 0.75;
export const SYMBOL_SCALE_MAX = 2;

export interface PrefsContextValue {
  ready: boolean;
  a11y: AccessibilityPrefs;
  updateA11y: (patch: Partial<AccessibilityPrefs>) => void;
  apiBaseUrl: string;
  setApiBaseUrl: (url: string) => void;
}

const PrefsContext = createContext<PrefsContextValue>({
  ready: false,
  a11y: DEFAULT_A11Y,
  updateA11y: () => undefined,
  apiBaseUrl: DEFAULT_API_BASE_URL,
  setApiBaseUrl: () => undefined,
});

function clampScale(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.min(SYMBOL_SCALE_MAX, Math.max(SYMBOL_SCALE_MIN, v));
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [a11y, setA11y] = useState<AccessibilityPrefs>(DEFAULT_A11Y);
  const [apiBaseUrl, setApiBaseUrlState] = useState(DEFAULT_API_BASE_URL);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [rawA11y, url] = await Promise.all([
          AsyncStorage.getItem(A11Y_KEY),
          loadApiBaseUrl(),
        ]);
        if (cancelled) return;
        if (rawA11y) {
          const parsed = JSON.parse(rawA11y) as Partial<AccessibilityPrefs>;
          setA11y({
            symbolScale: clampScale(parsed.symbolScale ?? 1),
            highContrast: !!parsed.highContrast,
            colorblindHighlight: !!parsed.colorblindHighlight,
          });
        }
        setApiBaseUrlState(url);
      } catch {
        // fall back to defaults
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateA11y = useCallback((patch: Partial<AccessibilityPrefs>) => {
    setA11y((prev) => {
      const next: AccessibilityPrefs = {
        ...prev,
        ...patch,
        symbolScale: clampScale(patch.symbolScale ?? prev.symbolScale),
      };
      void AsyncStorage.setItem(A11Y_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const setApiBaseUrl = useCallback((url: string) => {
    setApiBaseUrlState(url);
    void saveApiBaseUrl(url);
  }, []);

  const value = useMemo(
    () => ({ ready, a11y, updateA11y, apiBaseUrl, setApiBaseUrl }),
    [ready, a11y, updateA11y, apiBaseUrl, setApiBaseUrl],
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsContextValue {
  return useContext(PrefsContext);
}
