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
git clone <repo> /srv/jumpgame && cd /srv/jumpgame
npm ci
npm run build            # tsc --noEmit && vite build -> dist/

mkdir -p /var/lib/jumpgame/levels
npm run set-editor-password   # type a password; writes .env (mode 600)
```

Then set the runtime config. Either put these in `.env` next to the generated
password lines, or pass them as real environment variables:

```sh
PORT=8080
HOST=127.0.0.1                        # localhost only when nginx sits in front
TRUST_PROXY=1                         # see below
LEVELS_DIR=/var/lib/jumpgame/levels   # see below
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

## systemd

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
| One wrong password locks out everyone | `TRUST_PROXY` not set while behind nginx |
