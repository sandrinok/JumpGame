import type { ScoreData } from '../persistence/score';
import { saveScore } from '../persistence/score';
import { createLeaderboard } from './leaderboard';
import type { ScoreEntry } from '../persistence/leaderboard';

export interface StartScreen {
  show(): void;
  hide(): void;
  onPlay: () => void;
  onCredits: () => void;
  /** Draw a board the caller already has, e.g. one a submission returned. */
  setScores(scores: ScoreEntry[]): void;
}

export function createStartScreen(parent: HTMLElement, score: ScoreData): StartScreen {
  const root = document.createElement('div');
  root.style.cssText = `
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(180deg, rgba(8,12,20,0.85), rgba(8,12,20,0.95));
    color: #eee; font: 14px system-ui, sans-serif;
    z-index: 100; overflow: auto;
  `;

  // Side by side on a desktop, stacked on anything narrow. The board is the
  // point of the screen as much as the Play button is, so it sits beside it
  // rather than behind another click.
  const layout = document.createElement('div');
  layout.style.cssText = `
    display: flex; flex-wrap: wrap; gap: 20px;
    align-items: flex-start; justify-content: center;
    padding: 24px; margin: auto;
  `;
  root.appendChild(layout);

  const card = document.createElement('div');
  card.style.cssText = `
    width: 320px; max-width: calc(100vw - 48px); box-sizing: border-box;
    padding: 28px 32px;
    background: #181820; border: 1px solid #333; border-radius: 10px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.5);
    text-align: center;
  `;
  layout.appendChild(card);

  const leaderboard = createLeaderboard();
  layout.appendChild(leaderboard.element);

  const title = document.createElement('div');
  title.textContent = 'JumpGame';
  title.style.cssText = 'font-size: 32px; font-weight: 800; letter-spacing: 1px; margin-bottom: 4px;';
  card.appendChild(title);

  const sub = document.createElement('div');
  sub.textContent = 'Get as high as you can. Don\'t fall.';
  sub.style.cssText = 'opacity: 0.7; margin-bottom: 22px;';
  card.appendChild(sub);

  const nameRow = document.createElement('label');
  nameRow.style.cssText = 'display: block; text-align: left; margin-bottom: 16px;';
  nameRow.innerHTML = '<div style="opacity:0.7; margin-bottom:4px;">Your name</div>';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 24;
  nameInput.value = score.name;
  nameInput.style.cssText = `
    width: 100%; box-sizing: border-box; padding: 8px 10px;
    background: #0f0f14; color: inherit; border: 1px solid #444; border-radius: 4px;
    font: inherit;
  `;
  nameRow.appendChild(nameInput);
  card.appendChild(nameRow);

  const bestEl = document.createElement('div');
  bestEl.style.cssText = 'opacity: 0.85; margin-bottom: 22px;';
  const renderBest = (): void => {
    // "Your best", not "Best". This is the record on this browser; the board
    // beside it is the one everybody shares, and labelling both the same way
    // was how the local number came to read as the record.
    bestEl.textContent = score.best > 0
      ? `Your best: ${score.best.toFixed(1)} m`
      : 'No runs yet.';
  };
  renderBest();
  card.appendChild(bestEl);

  const playBtn = document.createElement('button');
  playBtn.textContent = 'Play';
  playBtn.style.cssText = `
    padding: 10px 28px; font: inherit; font-weight: 700; font-size: 16px;
    background: #3a7bd5; color: #fff; border: 0; border-radius: 6px;
    cursor: pointer;
  `;
  card.appendChild(playBtn);

  const hint = document.createElement('div');
  hint.textContent = 'Click the canvas after Play for mouse-look';
  hint.style.cssText = 'margin-top: 20px; font-size: 12px; opacity: 0.5;';
  card.appendChild(hint);

  // Most of the 3D assets are CC-BY, which requires the credit to be reachable
  // from the published game — not just sitting in a file in the repo.
  const creditsBtn = document.createElement('button');
  creditsBtn.textContent = 'Credits';
  creditsBtn.style.cssText = `
    margin-top: 10px; padding: 4px 10px; font: inherit; font-size: 12px;
    background: transparent; color: #eee; opacity: 0.55;
    border: 1px solid #444; border-radius: 5px; cursor: pointer;
  `;
  creditsBtn.addEventListener('mouseenter', () => (creditsBtn.style.opacity = '0.9'));
  creditsBtn.addEventListener('mouseleave', () => (creditsBtn.style.opacity = '0.55'));
  creditsBtn.addEventListener('click', () => api.onCredits());
  card.appendChild(creditsBtn);

  parent.appendChild(root);

  const api: StartScreen = {
    onPlay: () => undefined,
    onCredits: () => undefined,
    setScores(scores) {
      leaderboard.render(scores);
    },
    show() {
      renderBest();
      nameInput.value = score.name;
      leaderboard.setHighlight(score.name);
      root.style.display = 'flex';
      // Fetched every time the screen appears, not once at startup: between one
      // run and the next, the person on the laptop opposite has been playing too.
      void leaderboard.refresh();
    },
    hide() {
      root.style.display = 'none';
    },
  };

  leaderboard.setHighlight(score.name);
  void leaderboard.refresh();

  const startRun = (): void => {
    const name = nameInput.value.trim() || 'Player';
    if (name !== score.name) {
      score.name = name;
      saveScore(score);
      leaderboard.setHighlight(name);
    }
    api.hide();
    api.onPlay();
  };

  playBtn.addEventListener('click', startRun);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startRun();
  });

  return api;
}
