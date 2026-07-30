/**
 * The shared world: who is connected, and where they are.
 *
 * Deliberately not authoritative. Each client reports where it thinks it is and
 * the server forwards that to everyone else — the same trust model as the
 * scoreboard, for the same reason. Simulating every player here would mean
 * running Rapier on the server and reconciling it against clients, which is a
 * different project from the one this is.
 *
 * The only thing the server decides is who exists. Positions are relayed, and
 * anything that is not a finite number is dropped so one broken client cannot
 * put NaN into everybody else's scene graph.
 */

import { upgradeConnection } from './websocket.mjs';
// The same cleaning the scoreboard uses. A player's name appears in both
// places, and having two ideas of what a name may contain is how the board and
// the world end up disagreeing about who someone is.
import { cleanName as cleanScoreName } from './scores.mjs';

/** How often the world snapshot goes out, in milliseconds. */
const TICK_MS = 66;
/**
 * Players allowed at once. Every one of them is another skinned character to
 * animate and draw on every other player's machine, and the target here is a
 * laptop.
 */
const MAX_PLAYERS = 16;

/** Animation states a client may claim, matching src/game/character/rig.ts. */
const STATES = new Set(['idle', 'walk', 'run', 'jump', 'fall', 'land']);

/** Longest chat message accepted. Past this it is a paste, not a sentence. */
const MAX_CHAT_LENGTH = 200;
/**
 * Chat allowance per player: this many messages within the window.
 *
 * Generous enough that nobody typing quickly notices, tight enough that one
 * person cannot scroll everyone else's chat away.
 */
const CHAT_BURST = 6;
const CHAT_WINDOW_MS = 8000;

/** A nameless player still needs a label over their head. */
function cleanName(value) {
  return cleanScoreName(value) ?? 'Player';
}

/**
 * Clean a chat message, or return null if there is nothing left to send.
 *
 * Only control characters are stripped, and only because they would break the
 * rendering rather than because of what they say. The text reaches the client as
 * a string and is put on screen as text, never as markup, so the escaping
 * question is settled there rather than by filtering here.
 */
function cleanChat(value) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return text.length === 0 ? null : text.slice(0, MAX_CHAT_LENGTH);
}

/** Accept a colour only as #rrggbb, so it can be dropped into a style safely. */
function cleanColour(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#cccccc';
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function createRoom() {
  /** @type {Map<string, {conn: object, name: string, colour: string, p: number[], yaw: number, state: string, moved: boolean}>} */
  const players = new Map();
  let timer = null;

  const describe = (id, p) => ({
    id,
    name: p.name,
    colour: p.colour,
    p: p.p.map((v) => Math.round(v * 100) / 100),
    y: Math.round(p.yaw * 100) / 100,
    a: p.state,
    // Current height, so everyone can see who is climbing without waiting for
    // a run to end and reach the scoreboard.
    h: Math.round(p.height * 10) / 10,
  });

  function broadcast(message) {
    const text = JSON.stringify(message);
    for (const p of players.values()) p.conn.send(text);
  }

  function tick() {
    if (players.size === 0) return;
    const world = [];
    // Someone who has connected but not yet reported a position would otherwise
    // appear standing at the world origin for a moment before teleporting to
    // wherever they actually spawned.
    for (const [id, p] of players) if (p.moved) world.push(describe(id, p));
    // Everyone receives everyone, themselves included. Filtering the recipient
    // out would mean building a different payload per player for the sake of
    // one entry the client ignores anyway.
    broadcast({ t: 'world', players: world });
  }

  function start() {
    if (timer) return;
    timer = setInterval(tick, TICK_MS);
    timer.unref?.();
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return {
    get size() {
      return players.size;
    },

    /** Take over an HTTP upgrade and add the client to the world. */
    handleUpgrade(req, socket) {
      const conn = upgradeConnection(req, socket);
      if (!conn) return;

      if (players.size >= MAX_PLAYERS) {
        conn.send(JSON.stringify({ t: 'full' }));
        conn.close();
        return;
      }

      const player = {
        conn,
        name: 'Player',
        colour: '#cccccc',
        p: [0, 0, 0],
        yaw: 0,
        state: 'idle',
        height: 0,
        /** Timestamps of recent chat messages, for the rate limit. */
        chatTimes: [],
        /** Until a first position arrives, this player is not shown to anyone. */
        moved: false,
      };
      players.set(conn.id, player);
      start();

      conn.send(JSON.stringify({ t: 'welcome', id: conn.id, tickMs: TICK_MS }));

      conn.onMessage = (text) => {
        let msg;
        try {
          msg = JSON.parse(text);
        } catch {
          return;
        }
        if (msg?.t === 'hello') {
          player.name = cleanName(msg.name);
          player.colour = cleanColour(msg.colour);
          return;
        }
        if (msg?.t === 'state') {
          const p = Array.isArray(msg.p) ? msg.p : [];
          player.p = [finite(p[0]), finite(p[1]), finite(p[2])];
          player.yaw = finite(msg.y);
          player.state = STATES.has(msg.a) ? msg.a : 'idle';
          player.height = finite(msg.h);
          player.moved = true;
          // A name change mid-session — someone fixing their spelling between
          // runs — arrives on the state message rather than a second hello.
          if (typeof msg.name === 'string') player.name = cleanName(msg.name);
          if (typeof msg.colour === 'string') player.colour = cleanColour(msg.colour);
          return;
        }
        if (msg?.t === 'chat') {
          const text = cleanChat(msg.text);
          if (!text) return;
          const now = Date.now();
          player.chatTimes = player.chatTimes.filter((t) => now - t < CHAT_WINDOW_MS);
          if (player.chatTimes.length >= CHAT_BURST) return;
          player.chatTimes.push(now);
          // Name and colour come from the connection, not from the message, so
          // nobody can put words in somebody else's mouth.
          broadcast({
            t: 'chat',
            id: conn.id,
            name: player.name,
            colour: player.colour,
            text,
            at: now,
          });
          console.log(`[chat] ${player.name}: ${text}`);
        }
      };

      conn.onClose = () => {
        players.delete(conn.id);
        broadcast({ t: 'left', id: conn.id });
        if (players.size === 0) stop();
      };
    },

    /**
     * Push a new scoreboard to everyone connected.
     *
     * Called when a score is recorded, so every open leaderboard updates itself
     * instead of waiting for someone to reopen the menu.
     */
    announceScores(scores) {
      if (players.size === 0) return;
      broadcast({ t: 'scores', scores });
    },

    /** Close every connection. Used when the process is shutting down. */
    closeAll() {
      for (const p of players.values()) p.conn.close();
      players.clear();
      stop();
    },
  };
}
