#!/usr/bin/env node
/**
 * Production server for JumpGame.
 *
 * Serves the built game to everyone, and exposes a small authenticated API for
 * the level editor. No dependencies — it runs as-is under systemd, in Docker,
 * or behind an nginx reverse proxy.
 *
 *   GET    /api/session          is this browser logged in?
 *   POST   /api/session          { password } -> sets the session cookie
 *   DELETE /api/session          log out
 *   PUT    /api/level/<name>.json  save a level (requires session)
 *   GET    /api/scores           the shared high score table
 *   POST   /api/scores           { name, height } -> record a run
 *
 * Everything else is served from dist/, falling back to index.html.
 *
 * Usage:
 *   npm run build && npm run serve
 *
 * Behind nginx, proxy_pass to this port and let nginx terminate TLS. Set
 * TRUST_PROXY=1 so the rate limiter sees real client IPs from X-Forwarded-For
 * instead of lumping every visitor together as 127.0.0.1.
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import {
  clearCookie,
  clearFailures,
  hasSession,
  isConfigured,
  rateLimit,
  recordFailure,
  sessionCookie,
  createSessionToken,
  sweepRateLimit,
  verifyPassword,
} from './auth.mjs';
import { cleanHeight, cleanName, createScoreBoard } from './scores.mjs';
import { createRoom } from './multiplayer.mjs';

// process.loadEnvFile() needs Node >= 20.12. On an older runtime it would throw
// and the catch below would swallow it, leaving the editor mysteriously
// disabled on a server that looks correctly configured. Fail loudly instead.
if (typeof process.loadEnvFile !== 'function') {
  console.error(
    `[server] Node ${process.versions.node} is too old — needs >= 20.12 for .env support.\n` +
      '[server] Either upgrade Node, or pass the variables from .env as real environment\n' +
      '[server] variables (systemd EnvironmentFile=, docker --env-file) and delete this check.',
  );
  process.exit(1);
}

try {
  process.loadEnvFile();
} catch {
  // No .env file — fall back to real environment variables. Legitimate when
  // secrets come from systemd or the container runtime.
}

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const DIST = resolve(process.env.DIST_DIR ?? 'dist');
const LEVELS = resolve(process.env.LEVELS_DIR ?? join(DIST, 'levels'));
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
/**
 * Where the shared score table lives.
 *
 * Defaults outside dist/ on purpose. Levels default to a path inside the build
 * and warn about it; scores would lose everyone's runs on the next deploy, and
 * a leaderboard that forgets is worse than none.
 */
const SCORES_FILE = resolve(process.env.SCORES_FILE ?? join('data', 'scores.json'));

const MAX_LEVEL_BYTES = 5 * 1024 * 1024;
const MAX_SCORE_BYTES = 1024;
const LEVEL_NAME = /^[a-zA-Z0-9_-]{1,64}\.json$/;

const scores = createScoreBoard(SCORES_FILE);
const room = createRoom();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(text);
}

async function readBody(req, limit) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('payload too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function handleSession(req, res, method) {
  if (method === 'GET') {
    sendJson(res, 200, { authenticated: hasSession(req), configured: isConfigured() });
    return;
  }

  if (method === 'DELETE') {
    sendJson(res, 200, { authenticated: false }, { 'set-cookie': clearCookie() });
    return;
  }

  if (method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }

  if (!isConfigured()) {
    sendJson(res, 503, { error: 'editor not configured on this server' });
    return;
  }

  const ip = clientIp(req);
  const limit = rateLimit(ip);
  if (!limit.allowed) {
    sendJson(
      res,
      429,
      { error: 'too many attempts, try again later' },
      { 'retry-after': String(limit.retryAfterSec) },
    );
    return;
  }

  let password;
  try {
    ({ password } = JSON.parse(await readBody(req, 4096)));
  } catch {
    sendJson(res, 400, { error: 'bad request' });
    return;
  }

  if (!verifyPassword(password)) {
    recordFailure(ip);
    // Deliberately vague: a wrong password and a throttled one look the same.
    sendJson(res, 401, { error: 'invalid password' });
    return;
  }

  clearFailures(ip);
  sendJson(res, 200, { authenticated: true }, { 'set-cookie': sessionCookie(createSessionToken()) });
}

async function handleLevelSave(req, res, name) {
  if (!hasSession(req)) {
    sendJson(res, 401, { error: 'not authenticated' });
    return;
  }
  if (!LEVEL_NAME.test(name)) {
    sendJson(res, 400, { error: 'invalid level name' });
    return;
  }

  let text;
  try {
    text = await readBody(req, MAX_LEVEL_BYTES);
  } catch {
    sendJson(res, 413, { error: 'level too large' });
    return;
  }

  let level;
  try {
    level = JSON.parse(text);
  } catch {
    sendJson(res, 400, { error: 'not valid json' });
    return;
  }
  if (!level || !Array.isArray(level.placements) || !level.spawn) {
    sendJson(res, 400, { error: 'does not look like a level' });
    return;
  }

  const target = join(LEVELS, name);
  try {
    await mkdir(dirname(target), { recursive: true });
    // Write-then-rename, so a failure mid-write cannot leave a half-written
    // level behind for players to load.
    const tmp = `${target}.tmp`;
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, target);
  } catch (e) {
    console.error('[level] save failed:', e);
    sendJson(res, 500, { error: 'save failed' });
    return;
  }

  console.log(`[level] saved ${name} (${level.placements.length} placements)`);
  sendJson(res, 200, { ok: true, path: name });
}

/**
 * The high score table. Readable by anyone, writable by anyone.
 *
 * There is no authentication here and there is no point pretending otherwise:
 * the height is a number the client posts, so it is only as trustworthy as the
 * people playing. Among colleagues on a Friday that is trustworthy enough, and
 * the alternative — simulating each run on the server — would cost more than
 * the whole game.
 */
async function handleScores(req, res, method) {
  if (method === 'GET') {
    sendJson(res, 200, { scores: await scores.top() });
    return;
  }
  if (method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }

  if (!scores.allow(clientIp(req))) {
    sendJson(res, 429, { error: 'too many submissions' }, { 'retry-after': '60' });
    return;
  }

  let body;
  try {
    body = JSON.parse(await readBody(req, MAX_SCORE_BYTES));
  } catch {
    sendJson(res, 400, { error: 'bad request' });
    return;
  }

  const name = cleanName(body?.name);
  const height = cleanHeight(body?.height);
  if (!name || height === null) {
    sendJson(res, 400, { error: 'need a name and a height' });
    return;
  }

  try {
    const { improved, entries } = await scores.submit({ name, height });
    if (improved) console.log(`[scores] ${name} — ${height.toFixed(1)}m`);
    sendJson(res, 200, { ok: true, improved, scores: entries });
  } catch (e) {
    console.error('[scores] save failed:', e);
    sendJson(res, 500, { error: 'save failed' });
  }
}

/**
 * Serve a level from LEVELS_DIR, falling back to the copy inside the build.
 *
 * These two are only the same directory by default. Once LEVELS_DIR points
 * somewhere persistent — which it should, or every deploy wipes your edits —
 * the editor would be writing to one place while players read another. The
 * fallback means a fresh install still serves the level shipped in dist/ until
 * the first save creates the persistent copy.
 */
async function serveLevel(req, res, name) {
  if (!LEVEL_NAME.test(name)) {
    res.writeHead(400).end('invalid level name');
    return;
  }
  for (const file of [join(LEVELS, name), join(DIST, 'levels', name)]) {
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) continue;
    res.writeHead(200, {
      'content-type': MIME['.json'],
      'content-length': info.size,
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
    return;
  }
  res.writeHead(404).end('level not found');
}

async function serveStatic(req, res, pathname) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  let file = resolve(DIST, rel || 'index.html');

  // resolve() collapses ".." — anything landing outside DIST is a traversal attempt.
  if (file !== DIST && !file.startsWith(DIST + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  let info = await stat(file).catch(() => null);
  if (info?.isDirectory()) {
    file = join(file, 'index.html');
    info = await stat(file).catch(() => null);
  }
  if (!info) {
    file = join(DIST, 'index.html');
    info = await stat(file).catch(() => null);
    if (!info) {
      res.writeHead(404).end('not found');
      return;
    }
  }

  const ext = extname(file).toLowerCase();
  // Vite fingerprints filenames in /assets, so those can be cached forever.
  // Levels must not be, or the editor's save would be invisible to players.
  const immutable = file.startsWith(join(DIST, 'assets') + sep) && /-[A-Za-z0-9_-]{8,}\./.test(file);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'content-length': info.size,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;

    if (pathname === '/api/session') {
      await handleSession(req, res, req.method);
      return;
    }
    if (pathname === '/api/scores') {
      await handleScores(req, res, req.method);
      return;
    }
    if (pathname.startsWith('/api/level/')) {
      if (req.method !== 'PUT') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
      }
      await handleLevelSave(req, res, pathname.slice('/api/level/'.length));
      return;
    }
    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'unknown endpoint' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end('method not allowed');
      return;
    }
    if (pathname.startsWith('/levels/')) {
      await serveLevel(req, res, decodeURIComponent(pathname.slice('/levels/'.length)));
      return;
    }
    await serveStatic(req, res, pathname);
  } catch (e) {
    console.error('[server]', e);
    if (!res.headersSent) res.writeHead(500);
    res.end('internal error');
  }
});

// The shared world runs over a WebSocket, which arrives as an HTTP upgrade
// rather than an ordinary request, so it is handled off to the side of the
// normal routing.
server.on('upgrade', (req, socket) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
    return;
  }
  room.handleUpgrade(req, socket);
});

setInterval(() => {
  sweepRateLimit();
  scores.sweep();
}, 5 * 60 * 1000).unref();

server.on('error', (err) => {
  // Node's default for a listen failure is an unhandled 'error' event and a
  // stack trace, which says nothing useful about what to actually do.
  if (err.code === 'EADDRINUSE') {
    console.error(`[server] port ${PORT} is already in use — is another copy running?`);
    console.error('[server] stop it, or start this one with a different PORT.');
  } else if (err.code === 'EACCES') {
    console.error(`[server] not allowed to bind port ${PORT}. Ports below 1024 need root;`);
    console.error('[server] run on a high port and reverse-proxy to it instead.');
  } else {
    console.error('[server]', err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`[server] JumpGame on http://${HOST}:${PORT}`);
  console.log(`[server] serving ${DIST}`);
  console.log(`[server] levels   ${LEVELS}`);
  console.log(`[server] scores   ${SCORES_FILE}`);
  if (!isConfigured()) {
    console.warn('[server] editor DISABLED: run `npm run set-editor-password` and restart.');
  }
  if (!TRUST_PROXY) {
    console.log('[server] set TRUST_PROXY=1 when running behind nginx or another proxy.');
  }
  if (LEVELS.startsWith(DIST)) {
    console.warn(
      '[server] LEVELS_DIR is inside the build directory. Levels saved from the editor\n' +
        '[server] will be destroyed by the next deploy. Point LEVELS_DIR somewhere persistent.',
    );
  }
  if (SCORES_FILE.startsWith(DIST)) {
    console.warn(
      '[server] SCORES_FILE is inside the build directory. Every deploy will wipe the\n' +
        '[server] leaderboard. Point SCORES_FILE somewhere persistent.',
    );
  }
});
