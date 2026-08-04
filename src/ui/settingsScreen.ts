import {
  autoTier,
  clearStoredTier,
  qualityFor,
  storeTier,
  storedTier,
  type QualityTier,
} from '../render/quality';
import {
  clearEffects,
  effectIsOn,
  storeEffect,
  storedEffects,
  type EffectControls,
  type EffectKey,
} from '../render/effects';

export interface SettingsScreen {
  open(): void;
  close(): void;
}

/**
 * The effects a player can switch individually, and what each one is.
 *
 * Named for what you see rather than for the technique, with the technique in
 * the blurb — "Bloom" means nothing to most people until you say it is the glow
 * around bright things. The order runs from the one most people come here to
 * turn off to the one fewest will touch.
 */
const EFFECTS: Array<{ key: EffectKey; label: string; blurb: string }> = [
  {
    key: 'bloom',
    label: 'Bloom',
    blurb: 'The glow spilling off the sun and wet surfaces.',
  },
  {
    key: 'godRays',
    label: 'Light shafts',
    blurb: 'Sunbeams through gaps in the canopy. High and Ultra only.',
  },
  {
    key: 'aberration',
    label: 'Lens dispersion',
    blurb: 'Faint colour fringing at the very corners of the frame.',
  },
  {
    key: 'motes',
    label: 'Dust in the air',
    blurb: 'Specks drifting near the camera, for the shafts to catch.',
  },
  {
    key: 'speedFov',
    label: 'Speed field-of-view',
    blurb: 'The view widening as you sprint and fall. Turn off for motion comfort.',
  },
];

/** Null is "Auto" — let the machine be guessed at rather than pinned. */
type Choice = QualityTier | null;

/**
 * What each tier actually changes, in the terms a player would notice.
 *
 * Written as *content* rather than as settings on purpose. "No multisampling,
 * small shadows, one pixel per pixel" is true of Low and tells nobody anything:
 * it names three things they cannot picture and omits the one that matters,
 * which is that Low draws a thinner jungle with no ceiling over it. Someone
 * choosing a tier is deciding what they are willing to give up, so the list has
 * to say what goes.
 */
const CHOICES: Array<{ value: Choice; label: string; blurb: string }> = [
  {
    value: null,
    label: 'Auto',
    blurb: 'Guess from the graphics card, then adapt to the frame rate. Never picks Ultra.',
  },
  {
    value: 'low',
    label: 'Low',
    blurb: 'Thin foliage, no canopy overhead, no glow or light shafts, hard shadows. Runs on anything.',
  },
  {
    value: 'medium',
    label: 'Medium',
    blurb: 'The whole world at about half density, with bloom. Where most laptops belong.',
  },
  {
    value: 'high',
    label: 'High',
    blurb: 'Full jungle, light shafts, soft shadows, lens dispersion. The game as it was tuned.',
  },
  {
    value: 'ultra',
    label: 'Ultra',
    blurb: 'Everything at High plus 4K shadows, 8x multisampling, and no resolution give-back.',
  },
];

/**
 * Somewhere to change how much the renderer is allowed to cost.
 *
 * The tier was reachable only as `?quality=high` in the address bar, which is a
 * fine thing for a developer and no use at all to someone whose laptop is
 * struggling. It is a reload rather than a live switch on purpose: multisampling
 * and shadow map size are baked into framebuffers at startup, and a panel that
 * changed two of the five settings immediately and left the other three until
 * next time would be worse than one that is honest about needing a moment.
 *
 * The adaptive resolution controller still sits underneath whichever tier is
 * chosen, so High on a machine that cannot hold it degrades rather than stutters.
 *
 * The per-effect switches under it work the other way round: those *are* live,
 * because a pass can be skipped without reallocating anything. Someone who
 * wants the bloom gone should see it go, not read a note about reloading.
 *
 * @param activeTier the tier this session is actually running, which is not
 *                   necessarily the stored one — `?quality=` overrides it.
 * @param controls what the running page can switch without being rebuilt. A
 *                 switch it declines is one whose machinery this tier never
 *                 built, and the panel then offers a reload rather than
 *                 pretending the flip did something.
 */
export function createSettingsScreen(
  parent: HTMLElement,
  activeTier: QualityTier,
  controls: EffectControls,
): SettingsScreen {
  const root = document.createElement('div');
  root.style.cssText = `
    position: absolute; inset: 0; z-index: 200;
    display: none; align-items: center; justify-content: center;
    background: rgba(8, 12, 20, 0.9);
    color: #eee; font: 14px system-ui, sans-serif;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    width: min(460px, calc(100vw - 48px));
    max-height: calc(100vh - 48px);
    display: flex; flex-direction: column;
    background: #181820; border: 1px solid #333; border-radius: 10px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.5);
  `;

  const header = document.createElement('div');
  header.style.cssText =
    'padding: 20px 24px 12px; border-bottom: 1px solid #2a2a33; flex-shrink: 0;';
  const title = document.createElement('div');
  title.textContent = 'Settings';
  title.style.cssText = 'font-size: 20px; font-weight: 700;';
  const sub = document.createElement('div');
  sub.style.cssText = 'font-size: 12px; opacity: 0.6; margin-top: 4px;';
  header.append(title, sub);

  const body = document.createElement('div');
  body.style.cssText = 'padding: 16px 24px; overflow-y: auto; flex: 1;';

  const sectionLabel = document.createElement('div');
  sectionLabel.textContent = 'Graphics quality';
  sectionLabel.style.cssText =
    'font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.5; margin-bottom: 8px;';
  body.appendChild(sectionLabel);

  /** Chosen in the panel but not yet committed; committing means reloading. */
  let pending: Choice = storedTier();

  const buttons = new Map<Choice, HTMLButtonElement>();
  for (const choice of CHOICES) {
    const btn = document.createElement('button');
    btn.style.cssText = `
      display: block; width: 100%; text-align: left; margin-bottom: 6px;
      padding: 9px 12px; border-radius: 6px; font: inherit; cursor: pointer;
      background: #0f0f14; color: inherit; border: 1px solid #333;
    `;

    const name = document.createElement('div');
    name.textContent = choice.label;
    name.style.cssText = 'font-weight: 600;';

    const blurb = document.createElement('div');
    blurb.textContent = choice.blurb;
    blurb.style.cssText = 'font-size: 12px; opacity: 0.6; margin-top: 2px;';

    btn.append(name, blurb);
    btn.addEventListener('click', () => {
      pending = choice.value;
      paint();
    });
    body.appendChild(btn);
    buttons.set(choice.value, btn);
  }

  const note = document.createElement('div');
  note.style.cssText = 'font-size: 12px; opacity: 0.55; margin-top: 12px; line-height: 1.5;';
  body.appendChild(note);

  /* ---- individual effects ------------------------------------------- */

  const effectsHead = document.createElement('div');
  effectsHead.style.cssText = `
    display: flex; align-items: baseline; justify-content: space-between;
    margin: 22px 0 8px; padding-top: 18px; border-top: 1px solid #2a2a33;
  `;
  const effectsLabel = document.createElement('div');
  effectsLabel.textContent = 'Effects';
  effectsLabel.style.cssText =
    'font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.5;';
  /** Back to whatever the tier says, for anyone who has switched too much off. */
  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'Reset to tier';
  resetBtn.style.cssText = `
    padding: 2px 8px; font: inherit; font-size: 11px; cursor: pointer;
    background: transparent; color: #eee; opacity: 0.55;
    border: 1px solid #3a3a46; border-radius: 5px;
  `;
  effectsHead.append(effectsLabel, resetBtn);
  body.appendChild(effectsHead);

  /**
   * Effects switched since the panel opened that the page could not honour.
   *
   * Only ever non-empty when someone turns *on* something their tier never
   * built — switching off is always live, because a pass that exists can always
   * be skipped. Kept so the footer can offer a reload for exactly those.
   */
  const needsReload = new Set<EffectKey>();

  const switches = new Map<EffectKey, { row: HTMLElement; knob: HTMLElement; state: HTMLElement }>();
  for (const effect of EFFECTS) {
    const row = document.createElement('button');
    row.style.cssText = `
      display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
      margin-bottom: 4px; padding: 9px 12px; border-radius: 6px; font: inherit;
      cursor: pointer; background: #0f0f14; color: inherit; border: 1px solid #333;
    `;

    const text = document.createElement('div');
    text.style.cssText = 'flex: 1; min-width: 0;';
    const name = document.createElement('div');
    name.textContent = effect.label;
    name.style.cssText = 'font-weight: 600;';
    const blurb = document.createElement('div');
    blurb.textContent = effect.blurb;
    blurb.style.cssText = 'font-size: 12px; opacity: 0.6; margin-top: 2px; line-height: 1.4;';
    const state = document.createElement('div');
    state.style.cssText = 'font-size: 11px; opacity: 0.5; margin-top: 3px;';
    text.append(name, blurb, state);

    // A track and a knob rather than a checkbox: a checkbox reads as "include
    // this in something", and these are on/off switches for a thing you are
    // looking at right now.
    const track = document.createElement('div');
    track.style.cssText = `
      position: relative; flex-shrink: 0; width: 38px; height: 22px;
      border-radius: 11px; transition: background 0.15s;
    `;
    const knob = document.createElement('div');
    knob.style.cssText = `
      position: absolute; top: 3px; width: 16px; height: 16px; border-radius: 50%;
      background: #fff; transition: left 0.15s;
    `;
    track.appendChild(knob);

    row.append(text, track);
    row.addEventListener('click', () => toggleEffect(effect.key));
    body.appendChild(row);
    switches.set(effect.key, { row: track, knob, state });
  }

  /** Flip one effect, live if the page can manage it, on reload if it cannot. */
  function toggleEffect(key: EffectKey): void {
    const quality = qualityFor(activeTier);
    const want = !effectIsOn(key, quality, storedEffects());
    storeEffect(key, want);
    // Asked *after* storing, so a reload finds the new preference either way.
    if (controls.set(key, want)) needsReload.delete(key);
    else needsReload.add(key);
    paint();
  }

  const footer = document.createElement('div');
  footer.style.cssText = `
    padding: 12px 24px 20px; border-top: 1px solid #2a2a33; flex-shrink: 0;
    display: flex; gap: 8px; justify-content: flex-end;
  `;
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Close';
  cancelBtn.style.cssText = `
    padding: 8px 20px; border: 1px solid #444; border-radius: 6px;
    background: transparent; color: #eee; font: 600 14px system-ui, sans-serif; cursor: pointer;
  `;
  const applyBtn = document.createElement('button');
  applyBtn.style.cssText = `
    padding: 8px 20px; border: 0; border-radius: 6px;
    background: #2f81f7; color: #fff; font: 600 14px system-ui, sans-serif; cursor: pointer;
  `;
  footer.append(cancelBtn, applyBtn);

  card.append(header, body, footer);
  root.appendChild(card);
  parent.appendChild(root);

  /** Reflect `pending` in the buttons, the note and the apply button's label. */
  const paint = (): void => {
    for (const [value, btn] of buttons) {
      const on = value === pending;
      btn.style.borderColor = on ? '#2f81f7' : '#333';
      btn.style.background = on ? '#1b2740' : '#0f0f14';
    }

    const detected = autoTier();
    sub.textContent = `Running at ${activeTier}. This machine looks like ${detected}.`;

    // Auto is the only choice whose effect is not written on the button, since
    // what it resolves to depends on the machine.
    note.textContent =
      pending === null
        ? `Auto picks ${detected} here.`
        : pending === 'ultra'
          ? // Ultra is the one tier nothing can vouch for in advance — see
            // autoTier. Saying so is better than letting someone pick it, get a
            // stuttering game, and conclude the game is broken.
            'Never chosen automatically: nothing the browser reports can tell a card that holds this from one that does not. Pick it if High runs comfortably.'
          : pending === detected
            ? 'Same as Auto would pick, but pinned — it will not change if you switch machines.'
            : `Overrides Auto, which would pick ${detected}.`;

    // The effect switches show the value actually in force, which is the tier's
    // unless this player has overridden it.
    const prefs = storedEffects();
    const quality = qualityFor(activeTier);
    for (const effect of EFFECTS) {
      const parts = switches.get(effect.key);
      if (!parts) continue;
      const on = effectIsOn(effect.key, quality, prefs);
      parts.row.style.background = on ? '#2f81f7' : '#3a3a46';
      parts.knob.style.left = on ? '19px' : '3px';
      parts.state.textContent = needsReload.has(effect.key)
        ? 'Reload to apply — this tier did not build it'
        : prefs[effect.key] === undefined
          ? ''
          : 'Your choice, overriding the tier';
      parts.state.style.color = needsReload.has(effect.key) ? '#f0b64b' : 'inherit';
    }
    resetBtn.style.display = Object.keys(prefs).length > 0 ? 'block' : 'none';

    // Nothing to reload for if the pending tier is the one already stored and
    // every effect switch took hold live.
    const dirty = pending !== storedTier() || needsReload.size > 0;
    applyBtn.textContent = dirty ? 'Apply & reload' : 'Apply';
    applyBtn.disabled = !dirty;
    applyBtn.style.opacity = dirty ? '1' : '0.4';
    applyBtn.style.cursor = dirty ? 'pointer' : 'default';
  };

  resetBtn.addEventListener('click', () => {
    clearEffects();
    // Whatever the tier wants, applied live where it can be. Anything that
    // cannot be reached from here is exactly the case the reload is for.
    const quality = qualityFor(activeTier);
    for (const effect of EFFECTS) {
      const on = effectIsOn(effect.key, quality, {});
      if (controls.set(effect.key, on)) needsReload.delete(effect.key);
      else needsReload.add(effect.key);
    }
    paint();
  });

  const close = (): void => {
    root.style.display = 'none';
  };
  const open = (): void => {
    // Re-read rather than trusting the last session's value: another tab may
    // have written one since.
    pending = storedTier();
    paint();
    root.style.display = 'flex';
  };

  applyBtn.addEventListener('click', () => {
    if (pending === null) clearStoredTier();
    else storeTier(pending);
    // Everything the tier decides is allocated at startup, so the only way to
    // apply it in full is to start up again.
    location.reload();
  });

  cancelBtn.addEventListener('click', close);
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' || root.style.display === 'none') return;
    // Immediate, not ordinary: the handler that ends the run is bound to this
    // same window, and stopPropagation does nothing between two listeners on
    // one target. Closing a dialog should not also throw away the run behind it.
    e.stopImmediatePropagation();
    e.preventDefault();
    close();
  });

  return { open, close };
}
