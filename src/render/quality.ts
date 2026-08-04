/**
 * What the renderer is allowed to cost, and how it stays inside that.
 *
 * Two separate ideas live here. The tier is a one-time guess at what the
 * machine can handle, fixing things that cannot change cheaply at runtime —
 * shadow map size and multisampling both mean reallocating framebuffers, and
 * scatter density means rebuilding instanced meshes. The adaptive scale is the
 * per-frame correction on top, because the guess is only a guess and because
 * load varies with what is on screen.
 *
 * **The tier decides what exists, not only how sharp it is.** That distinction
 * is the whole point of the rewrite. The first version of this file moved five
 * numbers — samples, shadow size, bloom resolution, pixel ratio, render scale —
 * and every one of them is a *per-pixel* setting. Low therefore drew exactly
 * the same world as High: the same six thousand foliage cards, the same
 * thousand motes, the same three fullscreen post passes, just at fewer pixels.
 * On the machines Low exists for, the frame was never bound on pixels; it was
 * bound on draw calls, overdraw and the post chain, none of which Low touched.
 *
 * So the tiers now differ in content as well:
 *
 * | | low | medium | high | ultra |
 * |---|---|---|---|---|
 * | post chain | none | bloom | bloom + shafts + aberration | all of it, bigger |
 * | shadows | 512, hard | 1024, hard | 2048, soft | 4096, soft |
 * | foliage | 18% | 55% | 100% | 135% |
 * | canopy ceiling | no | yes | yes | yes |
 * | rubble, motes, cloud deck | no | yes | yes | yes |
 *
 * Low is meant to be genuinely light — a phone or an old integrated part should
 * be running a small, plain, complete game rather than a blurry expensive one.
 */

import { withEffectPrefs } from './effects';

export type QualityTier = 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  tier: QualityTier;

  /* ---- per-pixel cost ---- */

  /** MSAA samples on the HDR buffer. 0 disables multisampling entirely. */
  msaaSamples: number;
  /** Ceiling on devicePixelRatio. A 3x phone screen is not worth 9x the pixels. */
  maxPixelRatio: number;
  /** How far the adaptive controller may scale down before it gives up. */
  minRenderScale: number;

  /* ---- shadows ---- */

  /** Directional shadow map resolution, per side. */
  shadowMapSize: number;
  /**
   * Variance shadows rather than hard PCF.
   *
   * VSM keeps genuinely soft edges, which is what dappled light through a
   * canopy needs — but it blurs the map in two extra passes every frame the
   * light moves, and the light here follows the player, so it moves every
   * frame. That is a real per-frame cost for something a low tier should not be
   * paying, and hard PCF at 512 still puts a shadow under the player's feet,
   * which is the one shadow the game cannot do without.
   */
  softShadows: boolean;

  /* ---- post-processing ---- */

  /**
   * Run bloom at all.
   *
   * Off on low. The pass is a downsample/upsample pyramid — five render target
   * pairs, ten fullscreen draws — for an effect that exists to make the sun and
   * wet speculars glow. It is the single most expensive thing in the chain and
   * the least load-bearing.
   */
  bloom: boolean;
  /**
   * Bloom's internal resolution as a fraction of the frame. The pass already
   * halves internally and the result is a wide blur, so it survives being
   * rendered small far better than anything else in the chain.
   */
  bloomScale: number;
  /** Screen-space light shafts. A full radial march per pixel; high and up. */
  godRays: boolean;
  /**
   * Lens dispersion, in UV units at the frame edge. 0 disables it.
   *
   * Folded into the output pass rather than run as its own, so it costs two
   * extra texture reads on pixels that pass was already touching — which is why
   * it can be afforded at all. Kept far below where it becomes an effect you
   * notice: this is a game about judging the edge of a ledge, and a visibly
   * fringed edge is a lie about where that edge is.
   */
  aberration: number;

  /* ---- what the world contains ---- */

  /**
   * Multiplier on every foliage scatter count.
   *
   * The jungle is ~6,000 instanced cards in ~24 draw calls, so its cost is not
   * geometry and not draw calls — it is overdraw. Every card is a
   * screen-filling alpha-tested quad when you stand near it, and a dozen of
   * them stacked between the camera and a slab means the same pixel is shaded a
   * dozen times. Halving the count halves that, which is the only lever on it
   * that works.
   */
  vegetationScale: number;
  /** The overhead canopy ceiling at 30m. Pure overdraw when looking up. */
  canopy: boolean;
  /** Instanced rubble on the slabs and the forest floor. Real triangles. */
  debris: boolean;
  /** Multiplier on the drifting mote count. 0 skips the system entirely. */
  motes: number;
  /** The drifting cloud deck. One big transparent quad across the sky. */
  clouds: boolean;
  /** How many trees the hub scatters over its valley and mountains. */
  hubTrees: number;
  /** Anisotropic filtering on world textures. */
  anisotropy: number;
}

const TIERS: Record<QualityTier, Omit<QualitySettings, 'tier'>> = {
  /*
   * Low is a different game, not a smaller picture.
   *
   * No post chain at all beyond the output pass that has to exist (tone mapping
   * and the sRGB transfer are not optional), a fifth of the foliage, no canopy,
   * no rubble, no motes, no cloud deck, and a small hard shadow map. What is
   * left is the level, the player, the sky and the ground — which is the whole
   * game, and it runs on anything.
   */
  low: {
    msaaSamples: 0,
    maxPixelRatio: 1,
    minRenderScale: 0.5,
    shadowMapSize: 512,
    softShadows: false,
    bloom: false,
    bloomScale: 0.5,
    godRays: false,
    aberration: 0,
    vegetationScale: 0.18,
    canopy: false,
    debris: false,
    motes: 0,
    clouds: false,
    hubTrees: 35,
    anisotropy: 1,
  },

  /*
   * Medium is where the world becomes whole.
   *
   * Everything that was cut for Low comes back — canopy, rubble, motes, clouds —
   * at about half density, plus bloom. What it still does not buy is anything
   * per-pixel: no multisampling, a modest pixel ratio ceiling, and hard
   * shadows. That ordering is deliberate. On the laptops this tier is for, a
   * canopy overhead is worth far more to how the game looks than a smooth edge
   * on a slab.
   */
  medium: {
    msaaSamples: 0,
    // A 1.5x panel at 1.25 is a visible sharpening over 1.0 for 56% more
    // pixels; going to a full 1.5 is 125% more for the rest of the difference.
    maxPixelRatio: 1.25,
    // Room to halve the pixel count if a laptop cannot hold 60. Sharpness is
    // worth less than a steady frame on a machine being played on, not admired.
    minRenderScale: 0.5,
    shadowMapSize: 1024,
    softShadows: false,
    bloom: true,
    bloomScale: 0.5,
    godRays: false,
    aberration: 0,
    vegetationScale: 0.55,
    canopy: true,
    debris: true,
    motes: 0.5,
    clouds: true,
    hubTrees: 110,
    anisotropy: 4,
  },

  /*
   * High is the game as it was designed to look. This is the reference: the
   * densities, the shafts and the soft shadows the jungle was tuned against.
   */
  high: {
    msaaSamples: 4,
    maxPixelRatio: 2,
    minRenderScale: 0.75,
    shadowMapSize: 2048,
    softShadows: true,
    bloom: true,
    bloomScale: 0.75,
    godRays: true,
    // Sub-pixel at 1080p and about one pixel at the very corners of a 4K frame.
    aberration: 0.0016,
    vegetationScale: 1,
    canopy: true,
    debris: true,
    motes: 1,
    clouds: true,
    hubTrees: 260,
    anisotropy: 8,
  },

  /*
   * Ultra spends everything on the two things that still visibly improve, and
   * nothing on the things that do not.
   *
   * Shadow resolution is the first: at 2048 over a 44-unit frustum a texel is
   * about 2cm, and the character's own contact shadow — the thing you judge a
   * landing by — is where that shows. 4096 halves it.
   *
   * Resolution is the second, and it is bought by *refusing to give it back*:
   * minRenderScale 0.9 means the adaptive controller may shave a tenth off in a
   * bad moment and no more. On a machine that cannot hold that, this is the
   * wrong tier and the panel says so.
   *
   * Deliberately not here: more foliage than the jungle was authored for beyond
   * a small margin. Doubling the scatter does not read as a denser jungle, it
   * reads as a wall of leaves in front of the ledge you are aiming at.
   */
  ultra: {
    // Clamped by three to whatever the driver reports as its maximum, so asking
    // for 8 on hardware that does 4 is not an error.
    msaaSamples: 8,
    maxPixelRatio: 2,
    minRenderScale: 0.9,
    shadowMapSize: 4096,
    softShadows: true,
    bloom: true,
    bloomScale: 1,
    godRays: true,
    aberration: 0.0026,
    vegetationScale: 1.35,
    canopy: true,
    debris: true,
    motes: 1.4,
    clouds: true,
    hubTrees: 430,
    anisotropy: 16,
  },
};

export const TIER_ORDER: QualityTier[] = ['low', 'medium', 'high', 'ultra'];

const STORAGE_KEY = 'jumpgame.quality';

function isTier(v: string | null): v is QualityTier {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'ultra';
}

/**
 * Pick a tier for this machine.
 *
 * Deliberately conservative and coarse. There is no reliable way to ask a
 * browser how fast its GPU is — the renderer string is the only real signal and
 * it is a marketing name, not a benchmark — so this only tries to separate
 * "phone or integrated graphics" from "desktop with a discrete card" and lets
 * the adaptive scale sort out everything it gets wrong.
 *
 * An explicit choice always wins and sticks: `?quality=low` is remembered for
 * later visits, and `?quality=high` undoes it again. Someone who has had to
 * force a tier once should not have to keep a query string around to keep it.
 */
export function detectTier(): QualityTier {
  const forced = new URLSearchParams(location.search).get('quality');
  if (isTier(forced)) {
    storeTier(forced);
    return forced;
  }
  return storedTier() ?? autoTier();
}

/**
 * The tier this player has pinned, or null if they are letting it be guessed.
 *
 * Kept separate from detectTier so the settings panel can show which of the two
 * is in force. Without it "Auto" would be indistinguishable from whichever tier
 * Auto happened to pick, and a player could not tell a choice they had made
 * from one that had been made for them.
 */
export function storedTier(): QualityTier | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTier(stored) ? stored : null;
  } catch {
    // Private mode / storage disabled.
    return null;
  }
}

/** Go back to guessing. Takes effect on the next load, like storeTier. */
export function clearStoredTier(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored means nothing to clear.
  }
}

/**
 * What this machine looks like, ignoring anything the player has chosen.
 *
 * **Never returns ultra.** Nothing detectable here distinguishes a card that
 * can hold 4096 shadows at 90% of a 4K panel from one that cannot — both answer
 * "NVIDIA GeForce" — and the failure mode of guessing too high is a game that
 * stutters on first load, before anyone has found the settings panel. Ultra is
 * something you choose after seeing High run well.
 */
export function autoTier(): QualityTier {
  const mobile =
    (navigator as { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile ??
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  if (mobile) return 'low';

  const cores = navigator.hardwareConcurrency ?? 4;
  const renderer = probeRendererName();

  // Apple Silicon is deceptively easy to over-serve. The GPU is capable, but it
  // is paired with a Retina panel, so treating it as a desktop card means
  // rendering four times the pixels of the same laptop at 1x — and the post
  // chain, which is the bulk of the frame, is purely per-pixel. Held one tier
  // down so a MacBook starts inside its budget rather than climbing out of a
  // hole the adaptive scale then has to dig it out of.
  if (/Apple M/i.test(renderer)) return 'medium';

  // Integrated parts share bandwidth with the CPU, which is what the
  // post-processing chain is bound by. Treat them as a step down regardless of
  // core count.
  if (/(Intel|UHD|Iris|Mali|Adreno|PowerVR|llvmpipe|SwiftShader)/i.test(renderer)) {
    return cores >= 8 ? 'medium' : 'low';
  }
  if (/(NVIDIA|GeForce|RTX|Radeon|RX )/i.test(renderer)) return 'high';
  return cores >= 8 ? 'medium' : 'low';
}

/** Remember a tier across sessions. Takes effect on the next load. */
export function storeTier(tier: QualityTier): void {
  try {
    localStorage.setItem(STORAGE_KEY, tier);
  } catch {
    // Nothing to do; the tier still applies for this session.
  }
}

/**
 * The settings a page should run with.
 *
 * The tier's table, with the player's individual effect switches folded in —
 * one place, so both entry points get the same answer and nothing has to
 * remember to apply the overrides afterwards. `rawTier` is there for the
 * settings panel, which needs to show what the tier would give before anyone
 * overrode it.
 */
export function qualityFor(tier: QualityTier): QualitySettings {
  return withEffectPrefs(rawTier(tier));
}

/** The tier's own values, with no per-effect overrides applied. */
export function rawTier(tier: QualityTier): QualitySettings {
  return { tier, ...TIERS[tier] };
}

/**
 * Read the GPU name, if the browser will say.
 *
 * Costs a throwaway context; called once at startup. Some browsers mask this
 * for fingerprinting reasons and return a generic string, in which case the
 * caller falls back to core count.
 */
function probeRendererName(): string {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext
      ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch {
    return '';
  }
}

/* ------------------------------------------------------------------ */

export interface AdaptiveResolution {
  /** Current fraction of the display resolution to render at, 0..1. */
  readonly scale: number;
  /**
   * Feed one frame's wall-clock duration in milliseconds.
   * @returns true when the scale changed and buffers need resizing.
   */
  update(frameMs: number): boolean;
  /** Forget the learned refresh rate — call when the window is resized. */
  reset(): void;
}

/** Steps the scale moves in. Coarse enough to be worth a reallocation. */
const SCALE_STEP = 0.1;
/** Seconds of calm before the scale is allowed to move again. */
const COOLDOWN = 0.8;
/** Seconds of comfortable frames required before scaling back up. */
const RECOVERY = 2.5;
/** Frame time above this multiple of the refresh interval counts as dropped. */
const DROP_RATIO = 1.3;
/** Frame time below this multiple counts as comfortable. */
const COMFORT_RATIO = 1.08;
/** How fast the frame-time average follows reality. */
const EMA = 0.1;
/** Frames faster than this are measurement noise, not a real refresh interval. */
const MIN_REFRESH_MS = 4;

/**
 * Hold the frame budget by rendering fewer pixels.
 *
 * The tricky part is that wall-clock frame time says almost nothing on its own:
 * with vsync on, a frame that took the GPU 1ms and one that took it 15ms both
 * arrive 16.7ms apart, so scaling on raw frame time would shrink the picture on
 * a machine with plenty of headroom. What it does reveal is *missed* frames, so
 * the controller learns the display's own interval as the fastest frame it has
 * seen and reacts to frames that come in meaningfully slower than that.
 *
 * Downscaling is prompt and upscaling is slow and stepwise, because a wrong
 * downscale costs some sharpness for a moment while a wrong upscale costs
 * dropped frames — and oscillating between the two is worse than either.
 */
export function createAdaptiveResolution(minScale: number): AdaptiveResolution {
  let scale = 1;
  let refreshMs = Infinity;
  let avgMs = 0;
  let cooldown = 0;
  let comfortable = 0;
  /** Frames to ignore at startup, while shaders compile and assets settle. */
  let warmup = 30;

  return {
    get scale() {
      return scale;
    },
    reset() {
      refreshMs = Infinity;
      avgMs = 0;
      cooldown = COOLDOWN;
      comfortable = 0;
      warmup = 30;
    },
    update(frameMs) {
      if (warmup > 0) {
        warmup--;
        return false;
      }
      // A tab that was backgrounded or a level that just loaded produces one
      // enormous frame; letting it into the average would drop the resolution
      // for something already over.
      if (frameMs > 200) return false;

      if (frameMs >= MIN_REFRESH_MS && frameMs < refreshMs) refreshMs = frameMs;
      if (!Number.isFinite(refreshMs)) return false;

      avgMs = avgMs === 0 ? frameMs : avgMs + (frameMs - avgMs) * EMA;

      const dt = frameMs / 1000;
      if (cooldown > 0) cooldown -= dt;

      if (avgMs > refreshMs * DROP_RATIO) {
        comfortable = 0;
        if (cooldown > 0 || scale <= minScale) return false;
        scale = Math.max(minScale, Number((scale - SCALE_STEP).toFixed(2)));
        cooldown = COOLDOWN;
        return true;
      }

      if (avgMs < refreshMs * COMFORT_RATIO) {
        comfortable += dt;
        if (comfortable < RECOVERY || cooldown > 0 || scale >= 1) return false;
        scale = Math.min(1, Number((scale + SCALE_STEP / 2).toFixed(2)));
        comfortable = 0;
        cooldown = COOLDOWN;
        return true;
      }

      comfortable = 0;
      return false;
    },
  };
}
