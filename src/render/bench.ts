import * as THREE from 'three';
import type { PostFx } from './postFx';

/**
 * Dev-only handles on the running renderer, exposed as `window.__jg`.
 *
 * Optimising a renderer means answering "what does this one thing cost", and
 * the only honest way to answer it is to render with and without it and
 * compare. Everything here exists so that can be done from the console against
 * the live game rather than by editing code and reloading.
 *
 *   await __jg.bench()
 *   await __jg.compare({ withSky: draw, withoutSky: () => { sky.visible = false; draw(); sky.visible = true; } })
 *
 * Guarded by import.meta.env.DEV, so none of it reaches a production build.
 */
export interface Timing {
  /** Timings the driver actually returned; fewer than asked for is normal. */
  samples: number;
  /** Fastest GPU frame, in milliseconds — the least contaminated reading. */
  min: number;
  median: number;
}

export interface BenchResult extends Timing {
  width: number;
  height: number;
  drawCalls: number;
  triangles: number;
}

/** Everything worth poking at from the console. Rendering, plus what feeds it. */
export interface DevSubjects {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  postFx: PostFx;
  camera(): THREE.Camera;
  /** The live level and asset registry, for stress-testing placement cost. */
  level: unknown;
  registry: unknown;
  /**
   * The moving/crumbling/bouncing/rotating platforms.
   *
   * Exposed because they are the one system with no visible state: when the
   * carry is wrong the platform still animates and the player still stands, and
   * the only way to tell is to read what `carry()` is actually reporting.
   *
   *   __jg.dynamics.carry(feetVec3, outVec3)
   */
  dynamics: unknown;
  /** The shared-world connection, for checking whether it is actually up. */
  net: unknown;
  /**
   * Stand the player on the foothold nearest a given height.
   *
   * Verifying a 183m climb by playing it from the bottom every time is not
   * verification, it is endurance.
   *
   *   __jg.warp(120)
   */
  warp(height: number): { y: number; from: string } | null;
  /**
   * World units per texture repeat on the ruin surfaces, live.
   *
   *   __jg.ruinScale(60)        // both
   *   __jg.ruinScale(60, 45)    // concrete, moss
   */
  ruinScale(concrete: number, moss?: number): void;
}

export interface DevHandles extends DevSubjects {
  /**
   * What the GPU spends on one frame of the game's own chain.
   *
   * Wall-clock timing cannot answer this. A browser only advances
   * requestAnimationFrame while its tab is on screen; with vsync every frame
   * reads as one refresh interval however little work it took; and in Chrome
   * gl.finish() returns once the commands have been handed to the GPU process,
   * not once the GPU has drawn them — it will happily report a third of a
   * millisecond for a frame that took ten. Only the driver's own timer queries
   * measure the thing being optimised.
   */
  bench(frames?: number, render?: () => void): Promise<BenchResult>;
  /**
   * Time several ways of drawing the same scene against each other.
   *
   * The variants are interleaved frame by frame rather than measured one batch
   * after another, because a GPU's clock speed wanders by more than the
   * differences being looked for: run A then B and whichever went second can
   * come out slower for no reason but thermals. Interleaved, any drift lands on
   * every variant equally and the comparison survives it.
   */
  compare(variants: Record<string, () => void>, frames?: number): Promise<Record<string, Timing>>;
}

/** Frames drawn before timing starts, so shader compilation is not measured. */
const WARMUP_FRAMES = 15;
/** How long to wait for the driver to hand back results before giving up. */
const RESULT_TIMEOUT_MS = 3000;

export function installDevHandles(subjects: DevSubjects): void {
  if (!import.meta.env.DEV) return;
  const { renderer, postFx, camera } = subjects;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as
    | { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }
    | null;
  const size = new THREE.Vector2();

  const summarise = (ms: number[]): Timing => {
    const sorted = [...ms].sort((a, b) => a - b);
    return {
      samples: sorted.length,
      min: Number(sorted[0]?.toFixed(3) ?? NaN),
      median: Number(sorted[(sorted.length / 2) | 0]?.toFixed(3) ?? NaN),
    };
  };

  const compare = async (
    variants: Record<string, () => void>,
    frames = 40,
  ): Promise<Record<string, Timing>> => {
    if (!ext) throw new Error('bench: EXT_disjoint_timer_query_webgl2 unavailable');
    const entries = Object.entries(variants);

    for (let i = 0; i < WARMUP_FRAMES; i++) for (const [, draw] of entries) draw();

    // Queue every frame with its own query before reading any of them. Timer
    // queries cannot nest, so they run strictly in order; polling between
    // frames would stall the pipeline and measure the stall.
    renderer.info.reset();
    const queued: Array<[string, WebGLQuery]> = [];
    for (let i = 0; i < frames; i++) {
      for (const [name, draw] of entries) {
        const q = gl.createQuery();
        if (!q) break;
        gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
        draw();
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        queued.push([name, q]);
      }
    }
    gl.flush();

    const last = queued[queued.length - 1]?.[1];
    const deadline = performance.now() + RESULT_TIMEOUT_MS;
    while (last && performance.now() < deadline && !gl.getQueryParameter(last, gl.QUERY_RESULT_AVAILABLE)) {
      await new Promise((r) => setTimeout(r, 50));
    }

    // A disjoint means the GPU was interrupted mid-measurement and every
    // reading in the batch is untrustworthy.
    const disjoint = Boolean(gl.getParameter(ext.GPU_DISJOINT_EXT));
    const collected: Record<string, number[]> = {};
    for (const [name, q] of queued) {
      if (!disjoint && gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
        (collected[name] ??= []).push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      }
      gl.deleteQuery(q);
    }
    if (disjoint) throw new Error('bench: GPU timing was disjoint; run it again');

    const out: Record<string, Timing> = {};
    for (const name of Object.keys(variants)) out[name] = summarise(collected[name] ?? []);
    return out;
  };

  const bench = async (frames = 40, render?: () => void): Promise<BenchResult> => {
    const draw = render ?? (() => postFx.render(camera()));
    const { main } = await compare({ main: draw }, frames);
    renderer.getDrawingBufferSize(size);
    return {
      ...main,
      width: size.x,
      height: size.y,
      drawCalls: Math.round(renderer.info.render.calls / Math.max(1, frames)),
      triangles: Math.round(renderer.info.render.triangles / Math.max(1, frames)),
    };
  };

  const api: DevHandles = { ...subjects, bench, compare };
  (window as unknown as { __jg: DevHandles }).__jg = api;
}
