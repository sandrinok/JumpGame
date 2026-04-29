export interface Hud {
  setHeight(h: number): void;
  setBest(name: string, best: number): void;
  flashRespawn(): void;
}

export function createHud(parent: HTMLElement): Hud {
  const root = document.createElement('div');
  root.style.cssText = `
    position: absolute; top: 12px; left: 12px;
    font: 600 14px system-ui, sans-serif;
    color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.7);
    pointer-events: none; user-select: none;
  `;
  const heightEl = document.createElement('div');
  const bestEl = document.createElement('div');
  bestEl.style.opacity = '0.85';
  root.appendChild(heightEl);
  root.appendChild(bestEl);
  parent.appendChild(root);

  const flash = document.createElement('div');
  flash.style.cssText = `
    position: absolute; inset: 0;
    background: rgba(160, 30, 30, 0.0);
    pointer-events: none; transition: background 0.2s ease-out;
  `;
  parent.appendChild(flash);

  return {
    setHeight(h) {
      heightEl.textContent = `Height: ${h.toFixed(1)} m`;
    },
    setBest(name, best) {
      bestEl.textContent = `Best: ${name} — ${best.toFixed(1)} m`;
    },
    flashRespawn() {
      flash.style.background = 'rgba(160, 30, 30, 0.5)';
      setTimeout(() => (flash.style.background = 'rgba(160, 30, 30, 0.0)'), 50);
    },
  };
}
