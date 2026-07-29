# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build: everything that needs a toolchain happens here and stays here.
#
# The asset pipeline pulls in sharp, gltf-transform and meshoptimizer, and Vite
# pulls in the rest. None of it is needed to serve the game, so none of it
# reaches the image that runs.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Manifests first. Source changes then rebuild without reinstalling, which is
# the difference between a ten-second and a two-minute rebuild.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# prebuild runs the asset pipeline and the credits generator. 3dassets/ is
# excluded from the context on purpose; the optimizer finds nothing to do and
# the committed output under public/assets is used as-is.
RUN npm run build

# ---------------------------------------------------------------------------
# Runtime: Node, the build output, and the server. Nothing else.
#
# There is no npm install here and no node_modules at all — the server imports
# only node: builtins. That is most of why this image is small, and it means a
# deploy cannot be broken by a dependency resolving differently than it did
# yesterday.
# ---------------------------------------------------------------------------
FROM node:22-alpine

# Unprivileged from the start. The node image ships a `node` user at uid 1000;
# creating the data directory here with that owner is also what gives a named
# volume the right ownership when Docker first populates it.
WORKDIR /app
RUN mkdir -p /data/levels && chown -R node:node /data

COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node server ./server

USER node

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    LEVELS_DIR=/data/levels \
    SCORES_FILE=/data/scores.json

# Levels and high scores are the only state. Everything else in the container is
# replaceable, which is what makes running with a read-only root filesystem
# possible — see DEPLOY.md.
VOLUME /data

EXPOSE 8080

# Alpine has no curl, and adding one for a health check would be a package in
# the runtime image for the sake of not writing one line of JavaScript.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/scores').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
