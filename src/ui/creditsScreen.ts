interface CreditEntry {
  title: string;
  author: string;
  authorUrl: string;
  license: string;
  licenseUrl: string;
  source: string;
}

export interface CreditsScreen {
  open(): void;
  close(): void;
}

/**
 * Attribution for the 3D assets.
 *
 * Most of them are CC-BY, which requires visible credit wherever the work is
 * published — a public web build counts. The list is generated from the assets
 * themselves by scripts/build-credits.mjs, so it cannot drift out of sync with
 * what actually ships.
 */
export function createCreditsScreen(parent: HTMLElement): CreditsScreen {
  const root = document.createElement('div');
  root.style.cssText = `
    position: absolute; inset: 0; z-index: 200;
    display: none; align-items: center; justify-content: center;
    background: rgba(8, 12, 20, 0.9);
    color: #eee; font: 14px system-ui, sans-serif;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    width: min(640px, calc(100vw - 48px));
    max-height: min(560px, calc(100vh - 48px));
    display: flex; flex-direction: column;
    background: #181820; border: 1px solid #333; border-radius: 10px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.5);
  `;

  const header = document.createElement('div');
  header.style.cssText =
    'padding: 20px 24px 12px; border-bottom: 1px solid #2a2a33; flex-shrink: 0;';
  const title = document.createElement('div');
  title.textContent = 'Credits';
  title.style.cssText = 'font-size: 20px; font-weight: 700;';
  const sub = document.createElement('div');
  sub.textContent = 'This game is built on work by these creators.';
  sub.style.cssText = 'font-size: 12px; opacity: 0.6; margin-top: 4px;';
  header.append(title, sub);

  const list = document.createElement('div');
  list.style.cssText = 'padding: 8px 24px 16px; overflow-y: auto; flex: 1;';

  const footer = document.createElement('div');
  footer.style.cssText =
    'padding: 12px 24px 20px; border-top: 1px solid #2a2a33; flex-shrink: 0; text-align: right;';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText = `
    padding: 8px 20px; border: 0; border-radius: 6px;
    background: #2f81f7; color: #fff; font: 600 14px system-ui, sans-serif; cursor: pointer;
  `;
  footer.appendChild(closeBtn);

  card.append(header, list, footer);
  root.appendChild(card);
  parent.appendChild(root);

  let loaded = false;

  const link = (text: string, href: string): HTMLElement => {
    if (!href) {
      const span = document.createElement('span');
      span.textContent = text;
      return span;
    }
    const a = document.createElement('a');
    a.textContent = text;
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.cssText = 'color: #7cb7ff; text-decoration: none;';
    a.addEventListener('mouseenter', () => (a.style.textDecoration = 'underline'));
    a.addEventListener('mouseleave', () => (a.style.textDecoration = 'none'));
    return a;
  };

  const render = (entries: CreditEntry[]): void => {
    list.textContent = '';
    for (const e of entries) {
      const row = document.createElement('div');
      row.style.cssText = 'padding: 10px 0; border-bottom: 1px solid #232330;';

      const name = document.createElement('div');
      name.style.cssText = 'font-weight: 600; font-size: 13px;';
      name.appendChild(link(e.title, e.source));

      const meta = document.createElement('div');
      meta.style.cssText = 'font-size: 12px; opacity: 0.7; margin-top: 2px;';
      meta.append('by ', link(e.author, e.authorUrl), ' · ', link(e.license, e.licenseUrl));

      row.append(name, meta);
      list.appendChild(row);
    }
  };

  const load = async (): Promise<void> => {
    if (loaded) return;
    loaded = true;
    try {
      const res = await fetch('/assets/credits.json');
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { entries: CreditEntry[] };
      render(data.entries);
    } catch (err) {
      console.warn('[credits] could not load credits.json:', err);
      list.textContent = 'Could not load credits.';
      // Retry on the next open rather than leaving the panel permanently empty.
      loaded = false;
    }
  };

  const close = (): void => {
    root.style.display = 'none';
  };
  const open = (): void => {
    root.style.display = 'flex';
    void load();
  };

  closeBtn.addEventListener('click', close);
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && root.style.display !== 'none') {
      e.stopPropagation();
      close();
    }
  });

  return { open, close };
}
