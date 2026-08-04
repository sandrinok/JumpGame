import type { QualitySettings } from './quality';

/**
 * Individual effects the player can switch off, on top of whatever tier they are
 * running.
 *
 * Separate from the tier on purpose, and the reason is that they answer
 * different questions. A tier answers "how much can this machine afford"; these
 * answer "what do I want to look at". Bloom is the clear case: it costs a real
 * slice of the frame *and* some people simply do not like it, and folding those
 * two into one slider means the only way to get rid of the glow is to also give
 * up the shadows, the foliage and the resolution.
 *
 * A preference that is absent follows the tier. Only an explicit choice is
 * stored, so someone who has never opened this panel keeps getting whatever
 * their tier decides — including when the tier's defaults change under them.
 */

export type EffectKey = 'bloom' | 'godRays' | 'aberration' | 'motes' | 'speedFov';

export type EffectPrefs = Partial<Record<EffectKey, boolean>>;

const STORAGE_KEY = 'jumpgame.effects';

/**
 * What an effect is turned up to when the player switches it on from a tier
 * that had it off.
 *
 * The tier's own value is used where it has one; these are the fallbacks for
 * "low says zero, but this player asked for it anyway". Matching the `high`
 * tier rather than inventing a number, so enabling an effect on Low gives the
 * same effect everyone else sees, not a timid version of it.
 */
const ABERRATION_ON = 0.0016;
const MOTES_ON = 1;

const KEYS: EffectKey[] = ['bloom', 'godRays', 'aberration', 'motes', 'speedFov'];

function isKey(v: string): v is EffectKey {
  return (KEYS as string[]).includes(v);
}

/** Every explicit choice this player has made. */
export function storedEffects(): EffectPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: EffectPrefs = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isKey(key) && typeof value === 'boolean') out[key] = value;
    }
    return out;
  } catch {
    // Private mode, disabled storage, or something else wrote nonsense here.
    // Following the tier is always a valid answer.
    return {};
  }
}

/** Record a choice, or pass null to go back to following the tier. */
export function storeEffect(key: EffectKey, on: boolean | null): void {
  try {
    const prefs = storedEffects();
    if (on === null) delete prefs[key];
    else prefs[key] = on;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // The choice still applies to this session; it just will not be remembered.
  }
}

/** Forget every explicit choice. */
export function clearEffects(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored means nothing to clear.
  }
}

/**
 * The tier, with this player's explicit choices folded in.
 *
 * Applied before anything is built rather than only as a live toggle, so a
 * reload gives exactly what was asked for — an effect switched off stays off
 * through its pass never being constructed, which is the only version of "off"
 * that costs nothing.
 */
export function withEffectPrefs(quality: QualitySettings, prefs = storedEffects()): QualitySettings {
  const out = { ...quality };
  if (prefs.bloom !== undefined) out.bloom = prefs.bloom;
  if (prefs.godRays !== undefined) out.godRays = prefs.godRays;
  if (prefs.aberration !== undefined) {
    out.aberration = prefs.aberration ? quality.aberration || ABERRATION_ON : 0;
  }
  if (prefs.motes !== undefined) {
    out.motes = prefs.motes ? quality.motes || MOTES_ON : 0;
  }
  return out;
}

/** Whether an effect is on, given a resolved tier. `speedFov` defaults to on. */
export function effectIsOn(key: EffectKey, quality: QualitySettings, prefs: EffectPrefs): boolean {
  switch (key) {
    case 'bloom':
      return quality.bloom;
    case 'godRays':
      return quality.godRays;
    case 'aberration':
      return quality.aberration > 0;
    case 'motes':
      return quality.motes > 0;
    case 'speedFov':
      // Not a tier setting at all — it costs nothing to run and exists purely
      // as a comfort choice, so there is nothing for a tier to have an opinion
      // about. On unless someone says otherwise.
      return prefs.speedFov ?? true;
  }
}

/**
 * Everything a running page can switch without being rebuilt.
 *
 * Returns false when the effect cannot be reached from here — usually because
 * the tier never built the machinery for it, and turning it on needs a reload.
 * The settings panel uses that answer to decide whether to offer one, rather
 * than claiming a change took effect when it did not.
 */
export interface EffectControls {
  set(key: EffectKey, on: boolean): boolean;
}
