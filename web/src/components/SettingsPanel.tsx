import { useA11y } from "../a11y";

/** Accessibility settings, rendered inline in the sidebar (no popover). */
export function SettingsPanel() {
  const { prefs, updatePrefs } = useA11y();

  return (
    <div className="settings-panel">
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
          onChange={(e) => updatePrefs({ symbolScale: Number(e.target.value) })}
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

      <div className="settings-row settings-row-block">
        <span>Highlight color</span>
        <div className="segmented" role="radiogroup" aria-label="Highlight color">
          <button
            type="button"
            role="radio"
            aria-checked={!prefs.colorblindHighlight}
            className={`segmented-btn ${!prefs.colorblindHighlight ? "active" : ""}`}
            onClick={() => updatePrefs({ colorblindHighlight: false })}
          >
            <span className="hl-swatch" style={{ background: "#ffd60a" }} />
            Yellow
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={prefs.colorblindHighlight}
            className={`segmented-btn ${prefs.colorblindHighlight ? "active" : ""}`}
            onClick={() => updatePrefs({ colorblindHighlight: true })}
          >
            <span className="hl-swatch" style={{ background: "#b45cff" }} />
            Purple
          </button>
        </div>
      </div>
    </div>
  );
}
