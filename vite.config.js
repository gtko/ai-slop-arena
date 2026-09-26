import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, renameSync, readFileSync } from 'node:fs';
import { sentryVitePlugin } from '@sentry/vite-plugin';

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

// Mobile apps (`vite build --mode app`, see capacitor.config.json): only the game, as index.html, in
// dist-app/, without the showcase site's trailer and screenshots.
const appBuild = {
  name: 'app-build',
  apply: 'build',
  closeBundle() {
    const out = resolve(__dirname, 'dist-app');
    renameSync(resolve(out, 'play.html'), resolve(out, 'index.html'));
    rmSync(resolve(out, 'assets', 'site'), { recursive: true, force: true });
  },
};

// Authoritative server (`vite build --mode server`): the game rules bundled for the Cloudflare
// Worker as worker/sim.js, with the sound and translation modules swapped for server stubs.
const serverBuild = {
  resolve: {
    alias: [
      { find: /^\.\/audio\.js$/, replacement: resolve(__dirname, 'src/server/audio.js') },
      { find: /^\.\/i18n\/index\.js$/, replacement: resolve(__dirname, 'src/server/i18n.js') },
      { find: /^meshoptimizer$/, replacement: resolve(__dirname, 'src/server/meshopt.js') },
    ],
  },
  publicDir: false,
  build: {
    outDir: 'worker/build', emptyOutDir: true, minify: false, target: 'es2022',
    lib: { entry: resolve(__dirname, 'src/server/sim.js'), formats: ['es'], fileName: () => 'sim.js' },
  },
};

// Crash reports readable in Sentry: with SENTRY_AUTH_TOKEN set (a Sentry "organization token"), the
// build makes source maps, uploads them for this release (src/telemetry.js) and deletes them, so
// players never download them. Without the token the build is unchanged.
const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'));
const SOURCE_MAPS = !!process.env.SENTRY_AUTH_TOKEN;
const sourceMaps = out => SOURCE_MAPS ? [sentryVitePlugin({
  org: 'odykit', project: 'ai-slop-arena', // the token also names the region (de.sentry.io)
  authToken: process.env.SENTRY_AUTH_TOKEN,
  release: { name: `ai-slop-arena@${version}` },
  sourcemaps: { filesToDeleteAfterUpload: [`${out}/**/*.map`] },
  telemetry: false,
})] : [];

// Three pages: the landing site (index.html, "/"), the roadmap (roadmap.html, "/roadmap") and the game (play.html, "/play").
export default defineConfig(({ mode }) => mode === 'server' ? serverBuild : mode === 'app' ? {
  plugins: [appBuild, ...sourceMaps('dist-app')],
  build: { outDir: 'dist-app', sourcemap: SOURCE_MAPS ? 'hidden' : false, rollupOptions: { input: { play: resolve(__dirname, 'play.html') } } },
} : {
  plugins: [capture, ...sourceMaps('dist')],
  build: {
    sourcemap: SOURCE_MAPS ? 'hidden' : false,
    rollupOptions: {
      input: {
        site: resolve(__dirname, 'index.html'),
        roadmap: resolve(__dirname, 'roadmap.html'),
        play: resolve(__dirname, 'play.html'),
      },
    },
  },
});
