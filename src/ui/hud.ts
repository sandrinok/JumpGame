/**
 * The climb HUD.
 *
 * A number in the corner tells the player how high they are and nothing else.
 * In a game whose entire progression is vertical, the two things worth knowing
 * at a glance are *where am I in the climb* and *how close am I to losing what
 * I have* — and neither is a number, they are both positions on a scale.
 *
 * So the height readout is a vertical gauge running up the side of the screen:
 * the shape of the HUD is the shape of the thing it describes. The player's
 * best sits on it as a mark, which turns the abstract "260.3 m" into something
 * they are physically climbing towards.
 */

/** Bands from DESIGN.md, so the HUD names the same places the level does. */
const BANDS: { name: string; until: number }[] = [
  { name: 'The Floor', until: 20 },
  { name: 'The Undergrowth', until: 50 },
  { name: 'The Canopy', until: 92 },
  { name: 'The Spires', until: 128 },
  { name: 'The Long Fall', until: 152 },
  { name: 'Above the Trees', until: Infinity },
];

/** Top of the gauge. Beyond it the scale simply stops growing. */
const GAUGE_MAX = 190;

export interface Hud {
  setHeight(h: number): void;
  setBest(name: string, best: number): void;
  flashRespawn(): void;
}

function bandFor(h: number): string {
  for (const b of BANDS) if (h < b.until) return b.name;
  return BANDS[BANDS.length - 1].name;
}

export function createHud(parent: HTMLElement): Hud {
  const root = document.createElement('div');
  root.style.cssText = `
    position: absolute; inset: 0;
    font: 600 14px system-ui, sans-serif;
    color: #fff; pointer-events: none; user-select: none;
  `;
  parent.appendChild(root);

  // ---- gauge -------------------------------------------------------------

  const gauge = document.createElement('div');
  gauge.style.cssText = `
    position: absolute; left: 22px; top: 50%; transform: translateY(-50%);
    width: 3px; height: min(46vh, 340px);
    background: linear-gradient(to top, rgba(255,255,255,0.06), rgba(255,255,255,0.16));
    border-radius: 2px;
  `;
  root.appendChild(gauge);

  const fill = document.createElement('div');
  fill.style.cssText = `
    position: absolute; left: 0; bottom: 0; width: 100%; height: 0%;
    background: linear-gradient(to top, rgba(150, 220, 140, 0.55), rgba(220, 245, 190, 0.95));
    border-radius: 2px;
  `;
  gauge.appendChild(fill);

  // Band boundaries as ticks, so the scale is legible without labels on it.
  for (const b of BANDS) {
    if (!Number.isFinite(b.until)) continue;
    const tick = document.createElement('div');
    tick.style.cssText = `
      position: absolute; left: -3px; width: 9px; height: 1px;
      bottom: ${(b.until / GAUGE_MAX) * 100}%;
      background: rgba(255,255,255,0.28);
    `;
    gauge.appendChild(tick);
  }

  const bestMark = document.createElement('div');
  bestMark.style.cssText = `
    position: absolute; left: -6px; width: 15px; height: 2px; bottom: 0%;
    background: rgba(255, 214, 120, 0.95);
    box-shadow: 0 0 6px rgba(255, 190, 80, 0.8);
  `;
  gauge.appendChild(bestMark);

  // ---- readout -----------------------------------------------------------

  const readout = document.createElement('div');
  readout.style.cssText = `
    position: absolute; left: 44px; top: 50%; transform: translateY(-50%);
    text-shadow: 0 1px 3px rgba(0,0,0,0.8);
  `;
  root.appendChild(readout);

  const heightEl = document.createElement('div');
  heightEl.style.cssText = `
    font: 700 30px/1 system-ui, sans-serif;
    /* Tabular figures, or the number jitters sideways as the digits change and
       the eye reads that as the HUD twitching rather than the player moving. */
    font-variant-numeric: tabular-nums;
  `;
  const bandEl = document.createElement('div');
  bandEl.style.cssText = `
    font: 600 12px system-ui, sans-serif; letter-spacing: 0.08em;
    text-transform: uppercase; opacity: 0.75; margin-top: 3px;
  `;
  const bestEl = document.createElement('div');
  bestEl.style.cssText = `
    font: 500 12px system-ui, sans-serif; opacity: 0.6; margin-top: 10px;
    font-variant-numeric: tabular-nums;
  `;
  readout.append(heightEl, bandEl, bestEl);

  const flash = document.createElement('div');
  flash.style.cssText = `
    position: absolute; inset: 0;
    background: rgba(120, 20, 20, 0);
    pointer-events: none; transition: background 0.25s ease-out;
  `;
  root.appendChild(flash);

  let bestHeight = 0;
  let lastBand = '';

  return {
    setHeight(h) {
      heightEl.textContent = `${h.toFixed(1)} m`;
      fill.style.height = `${Math.min(100, Math.max(0, (h / GAUGE_MAX) * 100))}%`;

      const band = bandFor(h);
      if (band !== lastBand) {
        lastBand = band;
        bandEl.textContent = band;
        // Crossing into a new band is the progression beat the level is built
        // around, so it gets a moment rather than silently changing.
        bandEl.animate(
          [
            { opacity: 0, transform: 'translateY(6px)' },
            { opacity: 0.75, transform: 'translateY(0)' },
          ],
          { duration: 420, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
        );
      }

      // Past the record, the mark and the readout go gold.
      const beaten = bestHeight > 0 && h > bestHeight;
      heightEl.style.color = beaten ? '#ffd978' : '#fff';
    },

    setBest(name, best) {
      bestHeight = best;
      bestEl.textContent = `Best ${best.toFixed(1)} m · ${name}`;
      bestMark.style.bottom = `${Math.min(100, (best / GAUGE_MAX) * 100)}%`;
      bestMark.style.display = best > 0 ? 'block' : 'none';
    },

    flashRespawn() {
      flash.style.background = 'rgba(120, 20, 20, 0.45)';
      setTimeout(() => (flash.style.background = 'rgba(120, 20, 20, 0)'), 60);
    },
  };
}
