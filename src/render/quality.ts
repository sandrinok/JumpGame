/**
 * What the renderer is allowed to cost, and how it stays inside that.
 *
 * Two separate ideas live here. The tier is a one-time guess at what the
 * machine can handle, fixing things that cannot change cheaply at runtime —
 * shadow map size and multisampling both mean reallocating framebuffers. The
 * adaptive scale is the per-frame correction on top, because the guess is only
 * a guess and because load varies with what is on screen.
 */

export type QualityTier = 'low' | 'medium' | 'high';

export interface QualitySettings {
  tier: QualityTier;
  /** MSAA samples on the HDR buffer. 0 disables multisampling entirely. */
  msaaSamples: number;
  /** Directional shadow map resolution, per side. */
  shadowMapSize: number;
  /**
   * Bloom's internal resolution as a fraction of the frame. The pass already
   * halves internally and the result is a wide blur, so it survives being
   * rendered small far better than anything else in the chain.
   */
  bloomScale: number;
  /** Ceiling on devicePixelRatio. A 3x phone screen is not worth 9x the pixels. */
  maxPixelRatio: number;
  /** How far the adaptive controller may scale down before it gives up. */
  minRenderScale: number;
}

const TIERS: Record<QualityTier, Omit<QualitySettings, 'tier'>> = {
  low: {
    msaaSamples: 0,
    shadowMapSize: 1024,
    bloomScale: 0.5,
    maxPixelRatio: 1,
    minRenderScale: 0.5,
  },
  medium: {
    msaaSamples: 2,
    shadowMapSize: 2048,
    bloomScale: 0.5,
    maxPixelRatio: 1.5,
    // Room to halve the pixel count if a laptop cannot hold 60. Sharpness is
    // worth less than a steady frame on a machine being played on, not admired.
    minRenderScale: 0.5,
  },
  high: {
    msaaSamples: 4,
    shadowMapSize: 2048,
    bloomScale: 0.75,
    maxPixelRatio: 2,
    minRenderScale: 0.75,
  },
};

const STORAGE_KEY = 'jumpgame.quality';

function isTier(v: string | null): v is QualityTier {
  return v === 'low' || v === 'medium' || v === 'high';
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
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isTier(stored)) return stored;
  } catch {
    // Private mode / storage disabled. Fall through to detection.
  }

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

export function qualityFor(tier: QualityTier): QualitySettings {
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
