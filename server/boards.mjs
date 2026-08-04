/**
 * One high score table per map.
 *
 * A single shared board across every map would rank a 260m climb up the tallest
 * map above a 180m climb up the hardest one, which tells nobody anything. The
 * store itself is unchanged and still one JSON file — there are simply several
 * of them now, one per map id.
 *
 * The map list is read from the same `public/levels/index.json` the client
 * uses. Two lists is how a map ends up playable but unable to record a score.
 */

import { copyFile, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createScoreBoard } from './scores.mjs';

const INDEX_FILE = resolve('public', 'levels', 'index.json');

/**
 * Where a map's table lives.
 *
 * The id is already URL-safe by contract, but it arrives from a query string,
 * so it is filtered here as well rather than trusted into a path.
 */
function fileFor(dir, suffix, id) {
  return join(dir, `scores.${id}${suffix}.json`);
}

const SAFE_ID = /^[a-z0-9][a-z0-9-]{0,40}$/;

export async function readMapIds() {
  try {
    const parsed = JSON.parse(await readFile(INDEX_FILE, 'utf8'));
    const ids = (parsed?.maps ?? []).map((m) => m?.id).filter((id) => SAFE_ID.test(id ?? ''));
    if (ids.length) return ids;
  } catch {
    // Index missing or unreadable. Fall through to the default so scores still
    // work rather than the endpoint disappearing.
  }
  return ['ai-jungle'];
}

/**
 * A set of per-map boards, created lazily.
 *
 * @param storeFile Path the single-board version used, e.g. data/scores.json.
 *   Its directory and dev/prod suffix are reused so nothing moves.
 */
export async function createBoards(storeFile) {
  const dir = dirname(storeFile);
  // data/scores.dev.json -> '.dev', data/scores.json -> ''
  const match = /^scores(\.[^.]+)?\.json$/.exec(storeFile.split(/[\\/]/).pop() ?? '');
  const suffix = match?.[1] ?? '';

  const ids = await readMapIds();
  const fallback = ids[0];
  const boards = new Map();

  // Every score recorded before maps had ids was set on the one map that
  // existed, which is the first one here. Adopt the old file rather than
  // leaving it on disk next to an empty board — a feature that silently wipes
  // the leaderboard is a feature nobody thanks you for.
  const legacy = fileFor(dir, suffix, fallback);
  try {
    await stat(legacy);
  } catch {
    try {
      await stat(storeFile);
      await copyFile(storeFile, legacy);
      console.log(`[scores] adopted ${storeFile} as the ${fallback} board`);
    } catch {
      // No old file either. A clean install; nothing to carry over.
    }
  }

  const get = (id) => {
    const key = SAFE_ID.test(id ?? '') && ids.includes(id) ? id : fallback;
    let board = boards.get(key);
    if (!board) {
      board = createScoreBoard(fileFor(dir, suffix, key));
      boards.set(key, board);
    }
    return board;
  };

  return {
    ids,
    fallback,
    /** The board for a map id, falling back to the first map for anything odd. */
    for: get,
    /** Rate limiting is per address, not per map, so it lives on one board. */
    allow: (ip) => get(fallback).allow(ip),
    sweep: () => {
      for (const b of boards.values()) b.sweep();
      get(fallback).sweep();
    },
  };
}
