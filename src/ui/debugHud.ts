import * as THREE from 'three';

export interface DebugHud {
  toggle(): void;
  /** Call once per rendered frame. */
  sample(renderer: THREE.WebGLRenderer): void;
}

const SAMPLE_WINDOW = 0.5;

export function createDebugHud(parent: HTMLElement): DebugHud {
  const root = document.createElement('div');
  root.style.cssText = `
    position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
    background: rgba(0,0,0,0.6); color: #cef;
    font: 12px ui-monospace, Menlo, Consolas, monospace;
    padding: 6px 10px; border-radius: 4px;
    pointer-events: none; user-select: none;
    display: none; min-width: 280px; text-align: center;
  `;
  parent.appendChild(root);

  let visible = false;
  let frames = 0;
  let acc = 0;
  let last = performance.now();
  let lastDraws = 0;
  let lastTris = 0;
  let lastFps = 0;

  const render = (): void => {
    root.textContent = `FPS ${lastFps.toFixed(0).padStart(3)} · draws ${lastDraws} · tris ${lastTris.toLocaleString()}`;
  };

  return {
    toggle() {
      visible = !visible;
      root.style.display = visible ? 'block' : 'none';
    },
    sample(renderer) {
      if (!visible) return;
      const now = performance.now();
      acc += (now - last) / 1000;
      last = now;
      frames++;
      if (acc >= SAMPLE_WINDOW) {
        lastFps = frames / acc;
        lastDraws = renderer.info.render.calls;
        lastTris = renderer.info.render.triangles;
        frames = 0;
        acc = 0;
        render();
      }
    },
  };
}
