import * as THREE from 'three';
import type { GpuTimer } from '../render/gpuTimer';

export interface DebugHudOptions {
  gpu?: GpuTimer;
  /** Quality tier the renderer settled on at startup. */
  tier?: string;
  /** Current internal render scale, 0..1, for the adaptive-resolution readout. */
  renderScale?: () => number;
  /** Size the scene is actually drawn at, which is not the canvas size. */
  bufferSize?: () => { width: number; height: number };
}

export interface DebugHud {
  toggle(): void;
  /** True while the overlay is up. Timing work is skipped when it is not. */
  readonly enabled: boolean;
  /**
   * Call once per rendered frame, after drawing.
   * @param cpuMs time spent in this frame's render callback on the main thread.
   */
  sample(renderer: THREE.WebGLRenderer, cpuMs: number): void;
}

const SAMPLE_WINDOW = 0.5;

export function createDebugHud(parent: HTMLElement, opts: DebugHudOptions = {}): DebugHud {
  const root = document.createElement('div');
  root.style.cssText = `
    position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
    background: rgba(0,0,0,0.6); color: #cef;
    font: 12px/1.5 ui-monospace, Menlo, Consolas, monospace;
    padding: 6px 10px; border-radius: 4px;
    pointer-events: none; user-select: none; white-space: pre;
    display: none; min-width: 340px; text-align: left;
  `;
  parent.appendChild(root);

  let visible = false;
  let frames = 0;
  let acc = 0;
  let cpuAcc = 0;
  let last = performance.now();
  let text = '';

  const size = new THREE.Vector2();

  const render = (renderer: THREE.WebGLRenderer, fps: number, cpuMs: number): void => {
    const r = renderer.info.render;
    const m = renderer.info.memory;
    renderer.getDrawingBufferSize(size);
    const scale = opts.renderScale?.() ?? 1;
    const buf = opts.bufferSize?.() ?? { width: size.x, height: size.y };
    // GPU time is the number worth optimising against; when the driver will not
    // report it, say so rather than showing a plausible zero.
    const gpu = opts.gpu?.supported ? `${opts.gpu.ms.toFixed(2)}ms` : 'n/a';
    const next =
      `fps ${fps.toFixed(0).padStart(3)}   cpu ${cpuMs.toFixed(2)}ms   gpu ${gpu}\n` +
      `draws ${r.calls}   tris ${r.triangles.toLocaleString()}   progs ${renderer.info.programs?.length ?? 0}\n` +
      `render ${buf.width}x${buf.height} (${(scale * 100).toFixed(0)}%)  canvas ${size.x}x${size.y}\n` +
      `geo ${m.geometries}   tex ${m.textures}` +
      (opts.tier ? `   tier ${opts.tier}` : '');
    if (next !== text) {
      text = next;
      root.textContent = next;
    }
  };

  return {
    toggle() {
      visible = !visible;
      root.style.display = visible ? 'block' : 'none';
      // Restart the window, or the first reading after opening the overlay
      // averages over however long it was closed.
      last = performance.now();
      frames = 0;
      acc = 0;
      cpuAcc = 0;
    },
    get enabled() {
      return visible;
    },
    sample(renderer, cpuMs) {
      if (!visible) return;
      const now = performance.now();
      acc += (now - last) / 1000;
      last = now;
      frames++;
      cpuAcc += cpuMs;
      if (acc >= SAMPLE_WINDOW) {
        render(renderer, frames / acc, cpuAcc / frames);
        frames = 0;
        acc = 0;
        cpuAcc = 0;
      }
    },
  };
}
