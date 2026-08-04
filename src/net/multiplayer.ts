import type { Appearance } from '../game/character/appearance';
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
  /** Shirt colour as #rrggbb, or '' for none. */
  shirt: string;
  hem: number;
  sleeve: number;
  /** Printed across this player's chest. */
  print: string;
  printColour: string;
  printScale: number;
  /**
   * Filled in locally from the logo cache, not carried by the snapshot. An
   * uploaded picture is kilobytes; putting it in a message that goes out
   * fifteen times a second to every player would cost more bandwidth than the
   * entire rest of the game put together.
   */
  printImage: string;
  /** World position of the character's feet. */
  p: [number, number, number];
  /** Facing, in radians. */
  y: number;
  a: CharacterState;
  /** Current height above the ground, in metres. */
  h: number;
}

/** Pull the wearable fields out of a snapshot, for handing to the renderer. */
export function appearanceOfRemote(state: RemoteState): Appearance {
  return {
    body: state.colour,
    shirt: state.shirt,
    hem: state.hem,
    sleeve: state.sleeve,
    print: state.print,
    printColour: state.printColour,
    printScale: state.printScale,
    printImage: state.printImage,
  };
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
  setIdentity(name: string, appearance: Appearance): void;
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

/**
 * The wire form of who someone is: a name, plus everything they are wearing
 * that is small enough to repeat. The uploaded print image is deliberately not
 * here — it travels once, as its own message.
 */
function wireIdentity(map: string, name: string, a: Appearance) {
  return {
    /**
     * Which map this player is standing in.
     *
     * Rides along with the identity rather than as its own message, because it
     * is the one thing that must be true before the first state tick: the
     * server shows a player only to others on the same map, and one that has
     * not said where it is should be visible to nobody rather than to whoever
     * happens to be first.
     */
    map,
    name,
    colour: a.body,
    shirt: a.shirt,
    // Rounded because they came off a slider and the extra digits are noise
    // that would otherwise be paid for on every tick.
    hem: Math.round(a.hem * 1000) / 1000,
    sleeve: Math.round(a.sleeve * 1000) / 1000,
    print: a.print,
    printColour: a.printColour,
    printScale: Math.round(a.printScale * 100) / 100,
  };
}

export function connectMultiplayer(
  map: string,
  name: string,
  appearance: Appearance,
): Multiplayer {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

  let socket: WebSocket | null = null;
  let selfId = '';
  let others: RemoteState[] = [];
  let tickMs = 66;
  let identity = wireIdentity(map, name, appearance);
  /** This player's uploaded print, sent separately from the identity above. */
  let logo = appearance.printImage;
  /**
   * Everyone else's uploaded prints, by player id.
   *
   * Held here rather than on the snapshot because the snapshot is rebuilt from
   * scratch fifteen times a second and these are not. A logo arrives once when
   * its owner joins or changes it, and stays until they leave.
   */
  const logos = new Map<string, string>();
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
          ...identity,
        }),
      );
    },
    setIdentity(nextName, nextAppearance) {
      identity = wireIdentity(map, nextName, nextAppearance);
      const nextLogo = nextAppearance.printImage;
      const logoChanged = nextLogo !== logo;
      logo = nextLogo;
      if (socket?.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ t: 'hello', ...identity }));
      // Only when it actually changed. Dragging a colour slider fires this
      // handler on every frame of the drag, and re-sending a 24kB picture on
      // each of them would be a denial of service against our own room.
      if (logoChanged) socket.send(JSON.stringify({ t: 'logo', image: logo }));
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
      if (logo) ws.send(JSON.stringify({ t: 'logo', image: logo }));
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
        image?: string;
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
        others = msg.players
          .filter((p) => p.id !== selfId)
          // Reunited with the picture the snapshot could not afford to carry.
          .map((p) => ({ ...p, printImage: logos.get(p.id) ?? '' }));
        api.onRoster?.(others);
        return;
      }
      if (msg.t === 'logo' && typeof msg.id === 'string') {
        if (msg.image) logos.set(msg.id, msg.image);
        else logos.delete(msg.id);
        // The next snapshot picks it up; there are fifteen a second, so there
        // is nothing to gain from rebuilding the roster here.
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
        // Or the map grows for the whole session, holding a picture per person
        // who has ever passed through.
        if (msg.id) logos.delete(msg.id);
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
      // Ids are per connection, so nothing cached here survives a reconnect —
      // and the server replays every logo to a client that comes back.
      logos.clear();
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
