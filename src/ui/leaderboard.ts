import { fetchScores, type ScoreEntry } from '../persistence/leaderboard';

export interface LeaderboardPanel {
  /** The element to place next to the start card. */
  element: HTMLElement;
  /** Re-fetch and redraw. Safe to call while a previous refresh is in flight. */
  refresh(): Promise<void>;
  /** Draw a board we already have, e.g. the one a submission returned. */
  render(scores: ScoreEntry[]): void;
  /** Whose row to mark as "you". */
  setHighlight(name: string): void;
}

/** Rows the server sends and the panel shows. */
const TOP_N = 20;

/**
 * The shared top twenty.
 *
 * Rendered in place of the old single "Best:" line, which only ever knew about
 * the one browser it was stored in — everyone saw their own score and called it
 * the record.
 */
export function createLeaderboard(): LeaderboardPanel {
  const root = document.createElement('div');
  root.style.cssText = `
    width: 300px; max-width: calc(100vw - 48px);
    display: flex; flex-direction: column;
    background: #181820; border: 1px solid #333; border-radius: 10px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.5);
    overflow: hidden;
  `;

  const header = document.createElement('div');
  header.style.cssText = `
    padding: 16px 20px 12px; border-bottom: 1px solid #2a2a33;
    display: flex; align-items: baseline; justify-content: space-between;
  `;
  const title = document.createElement('div');
  title.textContent = 'High scores';
  title.style.cssText = 'font-size: 16px; font-weight: 700;';
  const count = document.createElement('div');
  count.style.cssText = 'font-size: 12px; opacity: 0.5;';
  count.textContent = `top ${TOP_N}`;
  header.append(title, count);
  root.appendChild(header);

  const list = document.createElement('ol');
  list.style.cssText = `
    margin: 0; padding: 6px 0; list-style: none;
    max-height: min(420px, 50vh); overflow-y: auto;
  `;
  root.appendChild(list);

  let highlight = '';
  let latest: ScoreEntry[] = [];
  /** Guards against a slow first request landing after a newer one. */
  let generation = 0;

  const message = (text: string): void => {
    list.replaceChildren();
    const li = document.createElement('li');
    li.textContent = text;
    li.style.cssText = 'padding: 18px 20px; opacity: 0.5; font-size: 13px; text-align: center;';
    list.appendChild(li);
  };

  const render = (scores: ScoreEntry[]): void => {
    latest = scores;
    if (scores.length === 0) {
      message('No runs yet — make the first one count.');
      return;
    }
    list.replaceChildren();
    scores.slice(0, TOP_N).forEach((entry, i) => {
      const mine = highlight !== '' && entry.name.toLowerCase() === highlight.toLowerCase();
      const li = document.createElement('li');
      li.style.cssText = `
        display: flex; align-items: baseline; gap: 10px;
        padding: 5px 20px; font-size: 13px;
        ${mine ? 'background: rgba(58,123,213,0.18);' : ''}
      `;

      const rank = document.createElement('span');
      rank.textContent = String(i + 1);
      // Tabular figures so the numbers line up instead of jittering by digit.
      rank.style.cssText = `
        width: 22px; flex-shrink: 0; text-align: right;
        font-variant-numeric: tabular-nums; opacity: ${i < 3 ? '0.9' : '0.45'};
        ${i < 3 ? 'font-weight: 700;' : ''}
      `;

      const name = document.createElement('span');
      name.textContent = entry.name;
      // The name is the one piece of user-supplied text on screen. It is set as
      // textContent, never as HTML, so a player called "<img onerror=...>" is a
      // player with a silly name and nothing more.
      name.style.cssText = `
        flex: 1; min-width: 0; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap;
        ${mine ? 'font-weight: 700;' : ''}
      `;

      const height = document.createElement('span');
      height.textContent = `${entry.height.toFixed(1)} m`;
      height.style.cssText = 'flex-shrink: 0; font-variant-numeric: tabular-nums; opacity: 0.85;';

      li.append(rank, name, height);
      list.appendChild(li);
    });
  };

  message('Loading…');

  return {
    element: root,
    render,
    setHighlight(name) {
      highlight = name;
      if (latest.length > 0) render(latest);
    },
    async refresh() {
      const mine = ++generation;
      const scores = await fetchScores();
      // A refresh triggered while this one was in flight has already drawn
      // something newer; do not paint over it with a stale board.
      if (mine !== generation) return;
      render(scores);
    },
  };
}
