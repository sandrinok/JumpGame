import type { ScoreData } from '../persistence/score';
import { saveScore } from '../persistence/score';

export interface StartScreen {
  show(): void;
  hide(): void;
  onPlay: () => void;
}

export function createStartScreen(parent: HTMLElement, score: ScoreData): StartScreen {
  const root = document.createElement('div');
  root.style.cssText = `
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    background: linear-gradient(180deg, rgba(8,12,20,0.85), rgba(8,12,20,0.95));
    color: #eee; font: 14px system-ui, sans-serif;
    z-index: 100;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    min-width: 320px; padding: 28px 32px;
    background: #181820; border: 1px solid #333; border-radius: 10px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.5);
    text-align: center;
  `;
  root.appendChild(card);

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
    bestEl.textContent = score.best > 0
      ? `Best: ${score.name} — ${score.best.toFixed(1)} m`
      : 'No runs yet — make the first one count.';
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
  hint.textContent = 'Click canvas after Play for mouse-look · F1 toggles editor';
  hint.style.cssText = 'margin-top: 20px; font-size: 12px; opacity: 0.5;';
  card.appendChild(hint);

  parent.appendChild(root);

  const api: StartScreen = {
    onPlay: () => undefined,
    show() {
      renderBest();
      nameInput.value = score.name;
      root.style.display = 'flex';
    },
    hide() {
      root.style.display = 'none';
    },
  };

  const startRun = (): void => {
    const name = nameInput.value.trim() || 'Player';
    if (name !== score.name) {
      score.name = name;
      saveScore(score);
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
