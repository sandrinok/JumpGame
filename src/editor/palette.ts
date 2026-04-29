import type { AssetRegistry } from '../world/registry';

export interface Palette {
  root: HTMLElement;
  setVisible(v: boolean): void;
  /** currently selected asset id, or null */
  current(): string | null;
  refresh(): void;
  selectById(id: string): void;
}

export function createPalette(parent: HTMLElement, registry: AssetRegistry): Palette {
  const root = document.createElement('div');
  root.style.cssText = `
    position: absolute; top: 12px; right: 12px;
    width: 220px; max-height: 70vh; overflow-y: auto;
    background: rgba(20,20,24,0.85); color: #eee;
    font: 13px system-ui, sans-serif;
    border: 1px solid #444; border-radius: 6px;
    padding: 8px; display: none;
  `;
  const title = document.createElement('div');
  title.textContent = 'Assets';
  title.style.cssText = 'font-weight: 700; margin-bottom: 8px; opacity: 0.8;';
  root.appendChild(title);

  const list = document.createElement('div');
  list.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
  root.appendChild(list);
  parent.appendChild(root);

  let currentId: string | null = null;

  const render = (): void => {
    list.innerHTML = '';
    const assets = registry.all();
    for (const a of assets) {
      const btn = document.createElement('button');
      btn.textContent = a.id;
      btn.dataset.id = a.id;
      btn.style.cssText = `
        text-align: left; padding: 6px 8px;
        background: ${currentId === a.id ? '#3a5a8a' : '#2a2a30'};
        color: inherit; border: 1px solid #555; border-radius: 4px;
        cursor: pointer; font: inherit;
      `;
      btn.addEventListener('click', () => {
        currentId = a.id;
        render();
      });
      list.appendChild(btn);
    }
  };
  render();

  const hint = document.createElement('div');
  hint.style.cssText = 'margin-top: 10px; font-size: 11px; opacity: 0.7; line-height: 1.4;';
  hint.innerHTML = `
    <b>Edit mode (F1)</b><br>
    Click asset, then Enter or B to place<br>
    G/T translate · R rotate · S scale<br>
    X delete · Ctrl+D duplicate · Esc deselect<br>
    N toggle snap (0.5m / 15°)<br>
    Ctrl+Z undo · Ctrl+Shift+Z redo<br>
    Ctrl+S save · Ctrl+O load · drag .glb to import
  `;
  root.appendChild(hint);

  return {
    root,
    setVisible(v) {
      root.style.display = v ? 'block' : 'none';
    },
    current() {
      return currentId;
    },
    refresh() {
      render();
    },
    selectById(id) {
      currentId = id;
      render();
    },
  };
}
