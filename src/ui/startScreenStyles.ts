/**
 * The start screen's stylesheet, as a stylesheet.
 *
 * Everything else in this UI is built with inline `style.cssText`, which is
 * fine for layout and cannot express the one thing this screen was most missing:
 * **state**. `:hover`, `:focus-visible` and `:active` have no inline form, so
 * every control on the character panel was completely inert to the touch —
 * fields gave no focus ring beyond the browser's default, buttons did not
 * respond until they were clicked, and the two places that did respond had a
 * pair of hand-written mouseenter/mouseleave listeners doing it. That absence is
 * most of what made a panel full of working controls feel unfinished.
 *
 * Injected once, on the first screen that asks for it, and scoped behind a `jg-`
 * prefix so it cannot reach anything the editor's React tree owns.
 */

const STYLE_ID = 'jg-start-styles';

const CSS = `
.jg-panel {
  box-sizing: border-box;
  background: #181820;
  border: 1px solid #333;
  border-radius: 12px;
  box-shadow: 0 10px 34px rgba(0, 0, 0, 0.5);
}

.jg-label {
  font-size: 10px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  opacity: 0.5;
}

/* Hairline between sections. Grouping by whitespace alone left the shirt's
   controls looking like a continuation of the body's. */
.jg-divider {
  height: 1px;
  background: #2a2a33;
  margin: 16px 0 14px;
}

.jg-field {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  background: #0f0f14;
  color: inherit;
  border: 1px solid #3a3a46;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  transition: border-color 0.12s, box-shadow 0.12s;
}
.jg-field::placeholder { color: #eee; opacity: 0.32; }
.jg-field:hover:not(:disabled) { border-color: #4d4d5c; }
.jg-field:focus {
  outline: none;
  border-color: #3a7bd5;
  box-shadow: 0 0 0 3px rgba(58, 123, 213, 0.22);
}
.jg-field:disabled { opacity: 0.4; cursor: not-allowed; }

.jg-btn {
  font: inherit;
  cursor: pointer;
  border-radius: 6px;
  border: 1px solid #3a3a46;
  background: #0f0f14;
  color: #eee;
  transition: background 0.12s, border-color 0.12s, color 0.12s, transform 0.06s;
}
.jg-btn:hover { background: #1e1e28; border-color: #4d4d5c; }
/* A press should be felt. One pixel is enough and nothing reflows. */
.jg-btn:active { transform: translateY(1px); }
.jg-btn:focus-visible {
  outline: none;
  border-color: #3a7bd5;
  box-shadow: 0 0 0 3px rgba(58, 123, 213, 0.3);
}

.jg-primary {
  background: #3a7bd5;
  border-color: #3a7bd5;
  color: #fff;
  font-weight: 700;
}
.jg-primary:hover { background: #4a8be5; border-color: #4a8be5; }

/* Quiet by default, ordinary on hover: reachable without competing with Play. */
.jg-quiet { opacity: 0.6; background: transparent; }
.jg-quiet:hover { opacity: 1; background: #1e1e28; }

.jg-swatch {
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.12s;
}
.jg-swatch:hover { transform: scale(1.14); }
.jg-swatch:focus-visible { outline: none; transform: scale(1.14); }
/* Ringed rather than outlined, with a gap in the panel's own colour, so the
   marker reads against a swatch of any brightness — including the white one. */
.jg-swatch[data-on='1'] {
  box-shadow: 0 0 0 2px #181820, 0 0 0 4px #3a7bd5;
}

.jg-chip {
  padding: 3px 9px;
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
}
.jg-chip[data-on='1'] {
  background: #1b2740;
  border-color: #3a7bd5;
  color: #fff;
}

.jg-colour {
  width: 40px;
  height: 28px;
  padding: 0;
  flex-shrink: 0;
  cursor: pointer;
  background: #0f0f14;
  border: 1px solid #3a3a46;
  border-radius: 6px;
  transition: border-color 0.12s;
}
.jg-colour:hover { border-color: #4d4d5c; }

.jg-range {
  width: 100%;
  accent-color: #3a7bd5;
  cursor: pointer;
}

/* The panels are tall and the page scrolls; a default scrollbar down the middle
   of a dark card is the loudest thing on the screen. */
.jg-scroll::-webkit-scrollbar { width: 10px; }
.jg-scroll::-webkit-scrollbar-track { background: transparent; }
.jg-scroll::-webkit-scrollbar-thumb {
  background: #33333f;
  border: 3px solid #181820;
  border-radius: 6px;
}
.jg-scroll::-webkit-scrollbar-thumb:hover { background: #45455a; }
`;

export function ensureStartScreenStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
