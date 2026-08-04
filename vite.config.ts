import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
// The real implementation, not a copy. Two servers answering the same endpoint
// with subtly different rules is the kind of thing you only find out about in
// production, when a name the dev server accepted is rejected on the night.
import { cleanHeight, cleanName } from './server/scores.mjs';
import { createBoards } from './server/boards.mjs';
import { createRoom } from './server/multiplayer.mjs';
import { LEVEL_NAME, listLevels } from './server/levels.mjs';

/**
 * Dev-only stand-in for server/index.mjs.
 *
 * It answers the same two endpoints the production server does, so the client
 * has exactly one code path for saving. Auth is skipped here on purpose —
 * you are editing your own checkout on localhost, and typing a password on
 * every reload would make the editor tedious to work on. To exercise the real
 * login flow, build and run `npm run serve` instead.
 */
function levelSavePlugin(): Plugin {
  const levelsDir = resolve(process.cwd(), 'public', 'levels');
  // A separate file from production's, so experimenting locally cannot put a
  // joke entry on the board everyone else is looking at.
  // One table per map, same as production. A dev server that pooled them would
  // hide exactly the bug this split exists to prevent.
  const boardsReady = createBoards(resolve(process.cwd(), 'data', 'scores.dev.json'));
  return {
    name: 'jumpgame-level-save',
    apply: 'serve',
    configureServer(server) {
      // Vite runs its own WebSocket for hot reload on the same port, so this
      // has to claim only /ws and leave every other upgrade alone — swallowing
      // them would break HMR.
      const room = createRoom();
      server.httpServer?.on('upgrade', (req, socket) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        if (url.pathname === '/ws') room.handleUpgrade(req, socket);
      });

      server.middlewares.use('/api/session', (req, res) => {
        res.statusCode = req.method === 'GET' ? 200 : 405;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ authenticated: true, configured: true, devMode: true }));
      });

      server.middlewares.use('/api/scores', async (req, res) => {
        const send = (status: number, body: unknown): void => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        const boards = await boardsReady;
        const url = new URL(req.url ?? '/', 'http://localhost');
        const mapId = url.searchParams.get('map') ?? boards.fallback;
        const scores = boards.for(mapId);
        if (req.method === 'GET') return send(200, { map: mapId, scores: await scores.top() });
        if (req.method !== 'POST') return send(405, { error: 'method not allowed' });

        let raw = '';
        for await (const chunk of req) raw += chunk;
        let body: { name?: unknown; height?: unknown };
        try {
          body = JSON.parse(raw);
        } catch {
          return send(400, { error: 'bad request' });
        }
        const name = cleanName(body?.name);
        const height = cleanHeight(body?.height);
        if (!name || height === null) return send(400, { error: 'need a name and a height' });
        const { improved, entries } = await scores.submit({ name, height });
        // Same push as the production server does. Leaving it out here meant a
        // live scoreboard that worked in production and not in development,
        // which is the worst way round.
        if (improved) room.announceScores(entries, mapId);
        send(200, { ok: true, map: mapId, improved, scores: entries });
      });

      // Mounted before /api/level so the intent is visible; connect matches on
      // a path boundary, so "/api/levels" would not fall into it regardless.
      server.middlewares.use('/api/levels', async (req, res) => {
        res.setHeader('content-type', 'application/json');
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'method not allowed' }));
          return;
        }
        // Only public/levels here: dist/ is a build output that development
        // never reads, and listing it would offer a level the dev server has
        // no way to load.
        res.statusCode = 200;
        res.end(JSON.stringify({ levels: await listLevels([levelsDir]) }));
      });

      server.middlewares.use('/api/level', async (req, res) => {
        const send = (status: number, body: unknown): void => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(body));
        };
        if (req.method !== 'PUT') return send(405, { error: 'method not allowed' });

        const name = decodeURIComponent((req.url ?? '').replace(/^\/+/, '').replace(/\?.*$/, ''));
        if (!LEVEL_NAME.test(name)) return send(400, { error: 'invalid level name' });

        let body = '';
        for await (const chunk of req) body += chunk;
        try {
          JSON.parse(body);
          await mkdir(levelsDir, { recursive: true });
          await writeFile(join(levelsDir, name), body, 'utf8');
          send(200, { ok: true, path: name });
        } catch (e) {
          send(500, { error: `save failed: ${(e as Error).message}` });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), levelSavePlugin()],
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      // Two pages: the hub you land in, and the game a portal takes you to.
      // Without both listed, the build emits only index.html and every portal
      // in the deployed hub leads to a 404.
      input: {
        index: resolve(process.cwd(), 'index.html'),
        play: resolve(process.cwd(), 'play.html'),
      },
    },
    // Off for the public build: the maps were ~5.5MB of the deploy and served
    // the full unminified source to anyone who looked. Flip to true when you
    // need to debug a production issue.
    sourcemap: false,
  },
  optimizeDeps: {
    // Rapier is on the -compat build, which inlines its WebAssembly as base64:
    // ~2MB of JavaScript the browser has to parse before the first frame.
    //
    // The slim @dimforge/rapier3d package was tried with vite-plugin-wasm +
    // vite-plugin-top-level-await. It builds cleanly and emits the .wasm, but
    // Rollup drops the side-effect-only call that binds the module, so nothing
    // ever fetches the file and the first `new World()` throws on undefined
    // bindings. Forcing moduleSideEffects for the package did not help either.
    // Worth retrying after a Rapier or Vite major bump: it is ~200KB gzip and
    // takes JS-to-parse from 2MB down to ~130KB.
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
