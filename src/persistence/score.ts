const KEY = 'jumpgame.score.v1';

export interface ScoreData {
  name: string;
  best: number;
}

export function loadScore(): ScoreData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as ScoreData;
  } catch {
    // ignore
  }
  return { name: 'Player', best: 0 };
}

export function saveScore(data: ScoreData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}
