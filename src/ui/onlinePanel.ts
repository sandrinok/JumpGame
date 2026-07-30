import type { RemoteState } from '../net/multiplayer';

/**
 * Who is in the world right now, and how high they have got.
 *
 * The scoreboard answers "who has ever done best"; this answers "who is winning
 * at this moment", which during a session is the more interesting question and
 * the one the shared world makes possible. Heights come off the same snapshot
 * that moves the avatars, so it is live rather than a run's end result.
 */

export interface SelfEntry {
  name: string;
  colour: string;
  height: number;
}

export interface OnlinePanel {
  /**
   * Redraw. Safe to call every frame — the DOM is only touched when what it
   * would say has changed.
   */
  update(self: SelfEntry | null, others: RemoteState[], connected: boolean): void;
}

export function createOnlinePanel(parent: HTMLElement): OnlinePanel {
  const root = document.createElement('div');
  root.style.cssText = `
    position: absolute; top: 12px; right: 12px;
    min-width: 168px; max-width: 260px;
    background: rgba(8,12,20,0.62); color: #eee;
    font: 12px/1.5 system-ui, sans-serif;
    border-radius: 6px; padding: 7px 9px;
    pointer-events: none; user-select: none;
  `;
  parent.appendChild(root);

  const header = document.createElement('div');
  header.style.cssText =
    'font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.5; margin-bottom: 4px;';
  root.appendChild(header);

  const list = document.createElement('div');
  root.appendChild(list);

  /** What the panel currently shows, so an unchanged frame costs nothing. */
  let signature = '';

  return {
    update(self, others, connected) {
      const rows = [
        ...(self ? [{ ...self, isSelf: true }] : []),
        ...others.map((o) => ({ name: o.name, colour: o.colour, height: o.h, isSelf: false })),
      ].sort((a, b) => b.height - a.height);

      const next = `${connected}|${rows.map((r) => `${r.name}:${r.height}:${r.colour}`).join('|')}`;
      if (next === signature) return;
      signature = next;

      // Offline is worth saying plainly. Otherwise a player alone in an empty
      // world cannot tell whether nobody else is playing or their connection
      // never came up.
      if (!connected) {
        header.textContent = 'offline';
        list.replaceChildren();
        return;
      }
      header.textContent = rows.length === 1 ? '1 player' : `${rows.length} players`;

      list.replaceChildren();
      for (const row of rows) {
        const line = document.createElement('div');
        line.style.cssText = 'display: flex; align-items: baseline; gap: 6px;';

        const dot = document.createElement('span');
        dot.style.cssText = `
          width: 7px; height: 7px; flex-shrink: 0; border-radius: 50%;
          background: ${row.colour};
        `;

        const name = document.createElement('span');
        // The one piece of player-supplied text here. Set as text, never HTML.
        name.textContent = row.name;
        name.style.cssText = `
          flex: 1; min-width: 0; overflow: hidden;
          text-overflow: ellipsis; white-space: nowrap;
          ${row.isSelf ? 'font-weight: 700;' : 'opacity: 0.85;'}
        `;

        const height = document.createElement('span');
        height.textContent = `${row.height.toFixed(1)} m`;
        height.style.cssText =
          'flex-shrink: 0; font-variant-numeric: tabular-nums; opacity: 0.7;';

        line.append(dot, name, height);
        list.appendChild(line);
      }
    },
  };
}
