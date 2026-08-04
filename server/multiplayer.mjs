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

/**
 * A shirt colour, or the empty string for no shirt.
 *
 * Separate from cleanColour because "nothing" is a legitimate answer here and
 * has to survive the round trip: falling back to grey the way cleanColour does
 * would put a grey shirt on everyone who chose not to wear one.
 */
function cleanShirt(value) {
  if (typeof value !== 'string' || value === '') return '';
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '';
}

/** Longest chest print accepted. Past this it stops fitting on a chest. */
const MAX_PRINT_LENGTH = 12;

/**
 * Clean the text printed across a player's shirt.
 *
 * Same reasoning as chat: only control characters are stripped, and only
 * because they would break the rendering. This string reaches the client and is
 * drawn onto a canvas with fillText — as glyphs, never as markup — so there is
 * no escaping question for this function to answer.
 */
function cleanPrint(value) {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_PRINT_LENGTH);
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Keep a number inside the range the client offers, or fall back to a default. */
function clamped(value, lo, hi, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

/*
 * Bounds on the shirt's shape, mirroring src/game/character/appearance.ts.
 *
 * Duplicated rather than imported because that module is TypeScript and pulls
 * in three; and because these are not really the same numbers doing the same
 * job. There they are the ends of a slider, here they are the only thing
 * standing between a hand-written message and a client asked to cut a garment
 * out of a body using coordinates from beyond the end of it.
 */
const HEM_MIN = 0.02;
const HEM_MAX = 0.34;
const SLEEVE_MIN = 0.26;
const SLEEVE_MAX = 0.72;
const PRINT_SCALE_MIN = 0.5;
const PRINT_SCALE_MAX = 1.8;

/**
 * Ceiling on an uploaded print, in characters of data URL.
 *
 * The client aims well under this; the check is here because the client is not
 * the one to trust with it. Sixteen players at this size is under 400kB of
 * one-off transfer, and no single upload can wedge a socket.
 */
const MAX_LOGO_CHARS = 24_000;
/**
 * What a print may be. Only the two formats the uploader produces, and only
 * base64 — a data URL is handed straight to an <img> on every other client, so
 * this is the one place to be strict about it. Anything else becomes no print
 * rather than an error: a malformed upload should cost the wearer their logo,
 * not their connection.
 */
const LOGO_PATTERN = /^data:image\/(?:webp|png);base64,[A-Za-z0-9+/]+={0,2}$/;

function cleanLogo(value) {
  if (typeof value !== 'string' || value === '') return '';
  if (value.length > MAX_LOGO_CHARS) return '';
  return LOGO_PATTERN.test(value) ? value : '';
}

/**
 * Copy whatever a message says about who someone is onto their record.
 *
 * Shared by hello and state because the two carry the same fields for the same
 * reason: hello is the introduction, state is how a change between runs gets
 * noticed without needing a second one. Only fields actually present are
 * touched, so a client sending a smaller message keeps what it had rather than
 * being reset to defaults.
 */
/** Map ids are URL-safe by contract; anything else is treated as unset. */
const SAFE_MAP = /^[a-z0-9][a-z0-9-]{0,40}$/;

function applyIdentity(player, msg) {
  // Which world this player is standing in. Everything below is scoped by it:
  // two people climbing different maps share a server but not a sky, and a
  // record set on one map must not shuffle the board being shown on another.
  if (typeof msg.map === 'string' && SAFE_MAP.test(msg.map)) player.map = msg.map;
  if (typeof msg.name === 'string') player.name = cleanName(msg.name);
  if (typeof msg.colour === 'string') player.colour = cleanColour(msg.colour);
  if (typeof msg.shirt === 'string') player.shirt = cleanShirt(msg.shirt);
  if (msg.hem !== undefined) player.hem = clamped(msg.hem, HEM_MIN, HEM_MAX, player.hem);
  if (msg.sleeve !== undefined) {
    player.sleeve = clamped(msg.sleeve, SLEEVE_MIN, SLEEVE_MAX, player.sleeve);
  }
  if (typeof msg.print === 'string') player.print = cleanPrint(msg.print);
  if (typeof msg.printColour === 'string') player.printColour = cleanColour(msg.printColour);
  if (msg.printScale !== undefined) {
    player.printScale = clamped(msg.printScale, PRINT_SCALE_MIN, PRINT_SCALE_MAX, player.printScale);
  }
}

export function createRoom() {
  /** @type {Map<string, {conn: object, name: string, colour: string, shirt: string, print: string, printColour: string, p: number[], yaw: number, state: string, moved: boolean}>} */
  const players = new Map();
  let timer = null;

  const describe = (id, p) => ({
    id,
    name: p.name,
    colour: p.colour,
    shirt: p.shirt,
    hem: p.hem,
    sleeve: p.sleeve,
    print: p.print,
    printColour: p.printColour,
    printScale: p.printScale,
    p: p.p.map((v) => Math.round(v * 100) / 100),
    y: Math.round(p.yaw * 100) / 100,
    a: p.state,
    // Current height, so everyone can see who is climbing without waiting for
    // a run to end and reach the scoreboard.
    h: Math.round(p.height * 10) / 10,
  });

  /** @param map when given, only players on that map receive the message. */
  function broadcast(message, map) {
    const text = JSON.stringify(message);
    for (const p of players.values()) {
      if (map !== undefined && p.map !== map) continue;
      p.conn.send(text);
    }
  }

  function tick() {
    if (players.size === 0) return;
    // Grouped by map. One payload per map rather than per player: everyone on a
    // map receives everyone on it, themselves included, and filtering the
    // recipient out would mean building a different payload each for the sake
    // of one entry the client already ignores.
    const byMap = new Map();
    // Someone who has connected but not yet reported a position would otherwise
    // appear standing at the world origin for a moment before teleporting to
    // wherever they actually spawned.
    for (const [id, p] of players) {
      if (!p.moved) continue;
      let list = byMap.get(p.map);
      if (!list) byMap.set(p.map, (list = []));
      list.push(describe(id, p));
    }
    for (const [map, world] of byMap) broadcast({ t: 'world', players: world }, map);
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
        /**
         * Which map they are on. Unset until their hello arrives, which is
         * deliberately not the same as any real map id — a connection that has
         * not said where it is should be visible to nobody rather than to
         * everybody on whichever map happens to be first.
         */
        map: '',
        name: 'Player',
        colour: '#cccccc',
        shirt: '',
        hem: 0.16,
        sleeve: 0.46,
        print: '',
        printColour: '#ffffff',
        printScale: 1,
        /** Uploaded chest print, relayed on its own rather than per tick. */
        logo: '',
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

      // Catch the newcomer up on prints already being worn. They are broadcast
      // on change, so without this replay someone joining a room in progress
      // would see blank shirts on everybody until they each changed theirs.
      for (const [id, other] of players) {
        if (id !== conn.id && other.logo) {
          conn.send(JSON.stringify({ t: 'logo', id, image: other.logo }));
        }
      }

      conn.onMessage = (text) => {
        // Anything thrown in here reaches a socket 'data' handler with nothing
        // above it to catch it, so it does not fail this message — it takes the
        // process down and every player in the room with it. The parse was
        // already guarded; the handling below deserves the same, now that some
        // of it works on strings a client chose.
        try {
          handleMessage(text);
        } catch (err) {
          console.error(`[room] dropped a message from ${conn.id}:`, err);
        }
      };

      const handleMessage = (text) => {
        let msg;
        try {
          msg = JSON.parse(text);
        } catch {
          return;
        }
        if (msg?.t === 'hello') {
          applyIdentity(player, msg);
          return;
        }
        if (msg?.t === 'logo') {
          const image = cleanLogo(msg.image);
          if (image === player.logo) return;
          player.logo = image;
          // Straight out to everyone, including the sender — one message per
          // change, never per tick.
          broadcast({ t: 'logo', id: conn.id, image });
          return;
        }
        if (msg?.t === 'state') {
          const p = Array.isArray(msg.p) ? msg.p : [];
          player.p = [finite(p[0]), finite(p[1]), finite(p[2])];
          player.yaw = finite(msg.y);
          player.state = STATES.has(msg.a) ? msg.a : 'idle';
          player.height = finite(msg.h);
          player.moved = true;
          // A change mid-session — someone fixing their spelling between runs,
          // or picking a different shirt — rides along on the state message
          // rather than arriving as a second hello.
          applyIdentity(player, msg);
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
    announceScores(scores, map) {
      if (players.size === 0) return;
      broadcast({ t: 'scores', map, scores }, map);
    },

    /** Close every connection. Used when the process is shutting down. */
    closeAll() {
      for (const p of players.values()) p.conn.close();
      players.clear();
      stop();
    },
  };
}
