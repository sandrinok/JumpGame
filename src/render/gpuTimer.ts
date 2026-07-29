import type * as THREE from 'three';

/**
 * How long the GPU actually spent on a frame, as opposed to how long the frame
 * took.
 *
 * Wall-clock frame time is useless for tuning a game that hits its refresh
 * rate: everything reads 16.7ms whether the GPU worked for 2ms or 15ms, so you
 * cannot tell a cheap change from an expensive one. `EXT_disjoint_timer_query`
 * asks the driver instead, which is the number to optimise against.
 *
 * Results arrive a few frames late — the query cannot be read back until the
 * GPU has drained that far — so `ms` is always slightly stale. That is fine for
 * a readout and unavoidable without stalling the pipeline, which would change
 * the very thing being measured.
 */
export interface GpuTimer {
  /** True if the driver exposes timer queries at all. */
  readonly supported: boolean;
  /** Smoothed GPU milliseconds for one frame, or 0 before the first result. */
  readonly ms: number;
  /** Bracket the work to measure. Must be called in pairs, once per frame. */
  begin(): void;
  end(): void;
}

/** Smoothing factor for the running average. Low enough to read, high enough to react. */
const SMOOTHING = 0.1;
/** Queries waiting on the GPU. More than this and something is wrong; drop the oldest. */
const MAX_IN_FLIGHT = 8;

export function createGpuTimer(renderer: THREE.WebGLRenderer): GpuTimer {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension?.('EXT_disjoint_timer_query_webgl2') as
    | { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
    | null;

  if (!ext || typeof gl.createQuery !== 'function') {
    return { supported: false, ms: 0, begin() {}, end() {} };
  }

  /** Queries whose results have not been read back yet, oldest first. */
  const inFlight: WebGLQuery[] = [];
  /** Finished query objects kept for reuse — allocating one per frame churns. */
  const free: WebGLQuery[] = [];
  let active: WebGLQuery | null = null;
  let smoothed = 0;

  const drain = (): void => {
    // Only the head can be the oldest finished one, but the driver may finish
    // out of order after a disjoint, so walk the whole list.
    for (let i = inFlight.length - 1; i >= 0; i--) {
      const q = inFlight[i];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
      // A disjoint means the GPU was interrupted (power state change, another
      // process taking the device) and every outstanding timing is garbage.
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
      if (!disjoint) {
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
        const ms = ns / 1e6;
        smoothed = smoothed === 0 ? ms : smoothed + (ms - smoothed) * SMOOTHING;
      }
      inFlight.splice(i, 1);
      free.push(q);
    }
  };

  return {
    supported: true,
    get ms() {
      return smoothed;
    },
    begin() {
      drain();
      // Nested TIME_ELAPSED queries are illegal, so never start a second one.
      if (active) return;
      if (inFlight.length >= MAX_IN_FLIGHT) return;
      const q = free.pop() ?? gl.createQuery();
      if (!q) return;
      active = q;
      gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    },
    end() {
      if (!active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      inFlight.push(active);
      active = null;
    },
  };
}
