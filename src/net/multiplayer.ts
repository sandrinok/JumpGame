import type { CharacterState } from '../game/character/rig';

/**
 * The connection to the shared world.
 *
 * Like the scoreboard, this fails quietly. Multiplayer is something extra on
 * top of a game that is complete without it, so a server that is down, a
 * corporate proxy that blocks WebSockets, or a laptop that has wandered off the
 * wifi should cost the player nothing but an empty world.
 */

export interface RemoteState {
  id: string;
  name: string;
  colour: string;
  /** World position of the character's feet. */
  p: [number, number, number];
  /** Facing, in radians. */
  y: number;
  a: CharacterState;
  /** Current height above the ground, in metres. */
  h: number;
}

export interface ChatMessage {
  id: string;
  name: string;
  colour: string;
  text: string;
  /** Epoch milliseconds, as stamped by the server. */
  at: number;
}

export interface LocalState {
  p: [number, number, number];
  y: number;
  a: CharacterState;
  h: number;
}

export interface Multiplayer {
  /** Everyone else, as of the last snapshot. Excludes the local player. */
  readonly others: RemoteState[];
  /** Milliseconds between server snapshots, for interpolation. */
  readonly tickMs: number;
  readonly connected: boolean;
  /** Report where the local player is. Cheap to call every frame. */
  send(state: LocalState): void;
  /** Change how the local player appears to everyone else. */
  setIdentity(name: string, colour: string): void;
  /** Called whenever the set of players changes, for the UI. */
  onRoster: ((others: RemoteState[]) => void) | null;
  /** Called for each chat message, including this player's own. */
  onChat: ((message: ChatMessage) => void) | null;
  /** Called when the server pushes an updated scoreboard. */
  onScores: ((scores: Array<{ name: string; height: number; at?: number }>) => void) | null;
  /** Say something to everyone. The server supplies the name and colour. */
  say(text: string): void;
  disconnect(): void;
}

/** Position updates per second. The server broadcasts at its own rate. */
const SEND_HZ = 15;
/** Backoff between reconnection attempts, growing to the second figure. */
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 15000;

export function connectMultiplayer(name: string, colour: string): Multiplayer {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

  let socket: WebSocket | null = null;
  let selfId = '';
  let others: RemoteState[] = [];
  let tickMs = 66;
  let identity = { name, colour };
  let lastSent = 0;
  let retryDelay = RECONNECT_MIN_MS;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const api: Multiplayer = {
    get others() {
      return others;
    },
    get tickMs() {
      return tickMs;
    },
    get connected() {
      return socket?.readyState === WebSocket.OPEN;
    },
    onRoster: null,
    onChat: null,
    onScores: null,
    say(text) {
      const trimmed = text.trim();
      if (!trimmed || socket?.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ t: 'chat', text: trimmed }));
    },
    send(state) {
      if (socket?.readyState !== WebSocket.OPEN) return;
      // Throttled here rather than at the call site, so the game loop can just
      // report every frame and not care what the wire rate is.
      const now = performance.now();
      if (now - lastSent < 1000 / SEND_HZ) return;
      lastSent = now;
      socket.send(
        JSON.stringify({
          t: 'state',
          p: state.p,
          y: state.y,
          a: state.a,
          h: state.h,
          name: identity.name,
          colour: identity.colour,
        }),
      );
    },
    setIdentity(nextName, nextColour) {
      identity = { name: nextName, colour: nextColour };
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ t: 'hello', ...identity }));
      }
    },
    disconnect() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
      socket = null;
      others = [];
    },
  };

  function open(): void {
    if (closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = ws;

    ws.onopen = () => {
      retryDelay = RECONNECT_MIN_MS;
      ws.send(JSON.stringify({ t: 'hello', ...identity }));
    };

    ws.onmessage = (event) => {
      let msg: {
        t?: string;
        id?: string;
        tickMs?: number;
        players?: RemoteState[];
        scores?: Array<{ name: string; height: number; at?: number }>;
        name?: string;
        colour?: string;
        text?: string;
        at?: number;
      };
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.t === 'welcome') {
        selfId = msg.id ?? '';
        if (typeof msg.tickMs === 'number' && msg.tickMs > 0) tickMs = msg.tickMs;
        return;
      }
      if (msg.t === 'world' && Array.isArray(msg.players)) {
        // The snapshot includes us; the local player is already on screen and
        // drawn from the simulation, not from a round trip through the server.
        others = msg.players.filter((p) => p.id !== selfId);
        api.onRoster?.(others);
        return;
      }
      if (msg.t === 'chat' && typeof msg.text === 'string') {
        api.onChat?.({
          id: msg.id ?? '',
          name: msg.name ?? 'Player',
          colour: msg.colour ?? '#cccccc',
          text: msg.text,
          at: msg.at ?? Date.now(),
        });
        return;
      }
      if (msg.t === 'scores' && Array.isArray(msg.scores)) {
        api.onScores?.(msg.scores);
        return;
      }
      if (msg.t === 'left') {
        others = others.filter((p) => p.id !== msg.id);
        api.onRoster?.(others);
        return;
      }
      if (msg.t === 'full') {
        // Nothing to retry: the world is at capacity and reconnecting in a loop
        // would only add to the load that filled it.
        closed = true;
      }
    };

    ws.onclose = () => {
      socket = null;
      others = [];
      api.onRoster?.(others);
      scheduleReconnect();
    };
    // onclose follows onerror, so reconnection is handled in one place.
    ws.onerror = () => undefined;
  }

  function scheduleReconnect(): void {
    if (closed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      // Backing off matters when the server is down rather than restarting:
      // a fixed one-second retry from every open tab is a small flood.
      retryDelay = Math.min(retryDelay * 2, RECONNECT_MAX_MS);
      open();
    }, retryDelay);
  }

  open();
  return api;
}
