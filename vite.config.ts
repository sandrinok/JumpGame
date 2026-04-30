import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

function levelSavePlugin(): Plugin {
  const publicDir = resolve(process.cwd(), 'public');
  return {
    name: 'jumpgame-level-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__save-level', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('method not allowed');
          return;
        }
        const rel = (req.url ?? '').replace(/^\/+/, '').replace(/\?.*$/, '');
        if (!rel.endsWith('.json') || rel.includes('..')) {
          res.statusCode = 400;
          res.end('bad path');
          return;
        }
        const target = join(publicDir, rel);
        if (!target.startsWith(publicDir)) {
          res.statusCode = 400;
          res.end('outside public');
          return;
        }
        let body = '';
        for await (const chunk of req) body += chunk;
        try {
          JSON.parse(body);
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, body, 'utf8');
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ ok: true, path: rel }));
        } catch (e) {
          res.statusCode = 500;
          res.end(`save failed: ${(e as Error).message}`);
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
    sourcemap: true,
  },
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
