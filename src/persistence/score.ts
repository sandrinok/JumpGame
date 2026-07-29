const KEY = 'jumpgame.score.v1';

export interface ScoreData {
  name: string;
  best: number;
  /** How this player appears to everyone else, as #rrggbb. */
  colour: string;
}

/** Assigned to a first-time player so not everyone turns up the same colour. */
const PALETTE = [
  '#e5533d',
  '#f2a541',
  '#f2e14c',
  '#6cc551',
  '#3fb8af',
  '#4a8fe7',
  '#8b5cf6',
  '#e368b8',
];

export function loadScore(): ScoreData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<ScoreData>;
      return {
        name: stored.name ?? 'Player',
        best: stored.best ?? 0,
        // Saves written before colours existed have none, so one is picked now
        // rather than leaving the field empty and defaulting to grey forever.
        colour: stored.colour ?? randomColour(),
      };
    }
  } catch {
    // ignore
  }
  return { name: 'Player', best: 0, colour: randomColour() };
}

function randomColour(): string {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

export function saveScore(data: ScoreData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}
