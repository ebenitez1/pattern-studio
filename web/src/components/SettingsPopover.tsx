import { useEffect, useRef, useState } from "react";
import { useA11y } from "../a11y";

/** Accessibility settings popover, opened from the top bar. */
export function SettingsPopover() {
  const { prefs, updatePrefs } = useA11y();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="settings-popover-root" ref={rootRef}>
      <button
        type="button"
        className="btn btn-ghost"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="Accessibility settings"
      >
        Settings
      </button>

      {open && (
        <div className="settings-popover" role="dialog" aria-label="Accessibility settings">
          <h3>Accessibility</h3>

          <label className="settings-row">
            <span>
              Symbol scale <strong>{prefs.symbolScale.toFixed(2)}×</strong>
            </span>
            <input
              type="range"
              min={0.75}
              max={2}
              step={0.05}
              value={prefs.symbolScale}
              onChange={(e) =>
                updatePrefs({ symbolScale: Number(e.target.value) })
              }
            />
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={prefs.highContrast}
              onChange={(e) => updatePrefs({ highContrast: e.target.checked })}
            />
            High contrast (stronger grid lines, pure white text)
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={prefs.colorblindHighlight}
              onChange={(e) =>
                updatePrefs({ colorblindHighlight: e.target.checked })
              }
            />
            Colorblind-friendly highlight (cyan instead of yellow)
          </label>
        </div>
      )}
    </div>
  );
}
