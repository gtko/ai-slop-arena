import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

// Dev server only: POST /__capture/<path> saves the body under .ai3d/capture/<path>. devtools.js
// uses it to record trailer frames and screenshots straight from the renderer (never built).
const capture = {
  name: 'capture-frames',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__capture/', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
      const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
      if (!/^[\w\-/.]+$/.test(rel) || rel.includes('..')) { res.statusCode = 400; return res.end(); }
      const file = resolve(__dirname, '.ai3d', 'capture', rel);
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, Buffer.concat(chunks));
        res.end('ok');
      });
    });
  },
};

// Two pages: the landing site (index.html, "/") and the game (play.html, "/play").
export default defineConfig({
  plugins: [capture],
  build: {
    rollupOptions: {
      input: {
        site: resolve(__dirname, 'index.html'),
        play: resolve(__dirname, 'play.html'),
      },
    },
  },
});
