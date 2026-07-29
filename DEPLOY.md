# Deploying JumpGame

The game is a static bundle plus a small Node server. The server exists for one
reason: the level editor needs an authenticated place to write to. Players never
touch it beyond fetching files.

**Requires Node >= 20.12** (the server uses `process.loadEnvFile`). It refuses to
start on anything older rather than silently running without its config.

## What ships and what doesn't

Everything the build needs is committed. Notably **not** committed, and not
needed on the server:

- `3dassets/` — the raw Sketchfab / character-pack downloads, ~215MB. These are
  the *sources* for the asset pipeline. The optimized output in
  `public/assets/` is what's committed. `npm run build` runs the asset
  optimizer, finds no sources, prints "nothing to do", and carries on. That is
  the expected output on a server, not a problem to fix.
- `.env` — the editor password lives here. Create it on the server (below).

A finished build is ~15MB, almost all of it `public/assets/`.

## First deploy

```sh
git clone --depth 1 <repo> /srv/jumpgame && cd /srv/jumpgame
npm ci
npm run build            # tsc --noEmit && vite build -> dist/

mkdir -p /var/lib/jumpgame/levels
npm run set-editor-password   # type a password; writes .env (mode 600)
```

`--depth 1` is worth it here: the working tree is ~13MB but the full history
is ~75MB, because earlier commits still contain the raw asset pack that was
removed when the build was slimmed down. The server has no use for that
history, and `git pull` on a shallow clone works fine for updates.

Then set the runtime config. Either put these in `.env` next to the generated
password lines, or pass them as real environment variables:

```sh
PORT=8080
HOST=127.0.0.1                        # localhost only when nginx sits in front
TRUST_PROXY=1                         # see below
LEVELS_DIR=/var/lib/jumpgame/levels   # see below
SCORES_FILE=/var/lib/jumpgame/scores.json   # see below
```

### TRUST_PROXY

Behind a reverse proxy every request arrives from the proxy's own address. The
login rate limiter (5 attempts, then 15 minutes) would then count all visitors
as one client — one person fumbling their password locks out everybody. With
`TRUST_PROXY=1` the limiter reads `X-Forwarded-For` instead.

Only set it when something in front is actually setting that header. If the
server is exposed directly, leaving it on lets anyone spoof the header and walk
straight past the rate limit.

### LEVELS_DIR

**Point this outside the build directory.** It defaults to `dist/levels`, which
works but means every deploy that replaces `dist/` destroys levels saved from
the editor. The server warns about this at startup.

Reads fall back to the copy inside `dist/` until the first save, so a fresh
install serves the level shipped with the build without any manual copying.

### The shared world needs a WebSocket through your proxy

Players see each other over a WebSocket at `/ws`. nginx does not forward the
upgrade handshake unless told to, and without it the game still runs — it just
quietly stays single-player forever, which is a hard failure to notice because
nothing errors.

```nginx
location /ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    # Idle players send nothing; the default 60s would disconnect them.
    proxy_read_timeout 300s;
}
```

The server pings every 15 seconds and drops a connection after 45 seconds of
silence, so a proxy timeout shorter than that will cut people off mid-game.

### SCORES_FILE

Where the shared high score table is written. Defaults to `data/scores.json`
relative to the working directory — outside `dist/` on purpose, since a
leaderboard that forgets everyone's runs on each deploy is worse than none.
Put it on the same persistent volume as `LEVELS_DIR`.

The process needs write access to the containing directory: the file is written
as `scores.json.tmp` and renamed, so a crash mid-write cannot leave a truncated
table behind.

There is no authentication on score submission, and no way to add one that
would be worth the effort. The height is a number the browser posts, so anyone
who opens the developer console can post any number they like. Validation stops
`Infinity` and negatives from wedging the board, and a rate limit stops it being
flooded; beyond that the leaderboard is exactly as honest as the people playing.
If it ever needs to be more than that, the fix is simulating runs server-side,
which costs more than the rest of the game.

## Docker

The shortest path to a running copy, and the one that cannot be broken by the
Node version on the box or by a dependency resolving differently than it did
last week:

```sh
docker compose up -d --build
```

Served on `127.0.0.1:8080`. Put nginx in front for TLS and the `/ws` block
above; change the port mapping in `compose.yaml` to expose it directly instead.

### What is in the image

The build stage installs everything — Vite, sharp, gltf-transform — and none of
it survives into the image that runs. The runtime layer is Node, `dist/` and
`server/`, with **no `node_modules` at all**, because the server imports only
`node:` builtins. There is no `npm install` when you deploy, so there is nothing
to resolve and nothing to go wrong between building and running.

`.dockerignore` keeps `.env`, `3dassets/` and the raw downloads out of the
context. That matters beyond build speed: anything copied in stays readable in
the layer history even if a later step deletes it, so the editor password must
never be one of them. It is passed to the running container instead.

### How it is locked down

`compose.yaml` applies all of this, so it does not depend on anyone remembering
the flags:

| | why |
|---|---|
| `USER node` | uid 1000, never root |
| `read_only: true` | nothing writes outside `/data` |
| `tmpfs: /tmp` | the one place Node still expects to write |
| `cap_drop: ALL` | port 8080 is unprivileged, so none are needed |
| `no-new-privileges` | no setuid escalation from inside |
| `init: true` | forwards SIGTERM so the shutdown handler runs |

Running it by hand, the same thing is:

```sh
docker run -d --name jumpgame \
  -p 127.0.0.1:8080:8080 \
  -v jumpgame-data:/data \
  --env-file .env -e TRUST_PROXY=1 \
  --init --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges:true \
  jumpgame
```

### The volume is the whole state

`/data` holds saved levels and the high score table, and nothing else in the
container is worth keeping. Lose it and you lose the scoreboard.

A **named volume** (what `compose.yaml` uses) picks up the right ownership from
the image, which creates `/data` owned by uid 1000. A **bind mount** does not —
`-v /srv/jumpgame:/data` arrives owned by root and the server cannot write to
it, which surfaces as high scores that never appear. Fix it on the host:

```sh
mkdir -p /srv/jumpgame && chown -R 1000:1000 /srv/jumpgame
```

### Stopping

`docker stop` sends SIGTERM and waits ten seconds. The server closes the shared
world's WebSockets properly first, so players see everyone leave rather than the
world freezing, and then exits — usually in well under a second.

## systemd

Only needed when running Node directly rather than in a container.

`/etc/systemd/system/jumpgame.service`:

```ini
[Unit]
Description=JumpGame
After=network.target

[Service]
Type=simple
User=jumpgame
WorkingDirectory=/srv/jumpgame
ExecStart=/usr/bin/node server/index.mjs
Restart=on-failure
Environment=NODE_ENV=production
# Or drop the .env file and use: EnvironmentFile=/etc/jumpgame.env
StateDirectory=jumpgame
ProtectSystem=strict
ReadWritePaths=/var/lib/jumpgame
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

```sh
systemctl enable --now jumpgame
journalctl -u jumpgame -f
```

The startup log tells you whether the editor is enabled, where levels are being
written, and whether it thinks it's behind a proxy. Read it once after the first
start.

## nginx

```nginx
server {
    listen 443 ssl http2;
    server_name jumpgame.example.com;

    # ssl_certificate ... (certbot)

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # The editor PUTs whole levels; the server caps them at 5MB itself.
    client_max_body_size 6m;
}
```

**TLS is not optional.** The session cookie is set `Secure`, so over plain HTTP
the browser discards it and login silently never sticks. (Browsers make an
exception for `localhost`, which is why local testing works without it.)

The server sets its own cache headers — fingerprinted assets immutable, levels
`no-cache`. Don't let nginx override them.

## Updating

```sh
cd /srv/jumpgame
git pull
npm ci
npm run build
systemctl restart jumpgame
```

`.env` and `LEVELS_DIR` are untouched by this, so the password stays valid and
saved levels survive.

## Changing the editor password

```sh
npm run set-editor-password
systemctl restart jumpgame
```

Existing sessions stay valid — the signing secret is kept. To force everyone
out, delete the `SESSION_SECRET` line from `.env` before running it; a new one
is generated when it's missing.

## Verifying a deploy

```sh
curl -s https://your-host/api/session
# {"authenticated":false,"configured":true}
```

`configured: false` means the server has no password set — the editor is off and
F2 does nothing. That is also the correct, safe state if you never want an editor
in production.

```sh
curl -s -X PUT https://your-host/api/level/dev.json -d '{}' -o /dev/null -w '%{http_code}\n'
# 401
```

Anything other than 401 there means the write endpoint is unprotected. Stop and
investigate.

## Troubleshooting

| Symptom | Cause |
|---|---|
| F2 does nothing | No password set (`configured: false`), or Node too old to read `.env` — check the startup log |
| Login accepted but editor never opens | Site not on HTTPS, so the `Secure` cookie is dropped |
| "Too many attempts" and you're locked out | Rate limiter; it's in memory, so `systemctl restart jumpgame` clears it |
| Saved levels vanish after deploy | `LEVELS_DIR` still points inside `dist/` |
| High scores vanish after deploy | `SCORES_FILE` points inside `dist/`, or at a path that is not persisted |
| High scores never appear | The server cannot write `SCORES_FILE`'s directory — check the startup log and permissions |
| Nobody ever sees anyone else | The proxy is not forwarding the `/ws` upgrade — see above |
| High scores never appear, in Docker | `/data` is a bind mount owned by root; `chown 1000:1000` it |
| `docker stop` takes ten seconds | `init: true` missing, so SIGTERM never reaches Node |
| Players vanish after a minute | `proxy_read_timeout` is shorter than the 45s idle window |
| One wrong password locks out everyone | `TRUST_PROXY` not set while behind nginx |
