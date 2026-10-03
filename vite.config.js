import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Authoritative server (`vite build --mode server`): the game rules bundled for the Cloudflare
// Worker as worker/build/sim.js. The shared game modules still import the sound, translation and
// ambient fauna modules of the old three.js client (deleted): the server stubs stand in for them.
const serverBuild = {
  resolve: {
    alias: [
      { find: /^\.\/audio\.js$/, replacement: resolve(import.meta.dirname, 'src/server/audio.js') },
      { find: /^\.\/i18n\/index\.js$/, replacement: resolve(import.meta.dirname, 'src/server/i18n.js') },
      { find: /^\.\/ambient\/index\.js$/, replacement: resolve(import.meta.dirname, 'src/server/ambient.js') },
      { find: /^meshoptimizer$/, replacement: resolve(import.meta.dirname, 'src/server/meshopt.js') },
    ],
  },
  publicDir: false,
  build: {
    outDir: 'worker/build', emptyOutDir: true, minify: false, target: 'es2022',
    lib: { entry: resolve(import.meta.dirname, 'src/server/sim.js'), formats: ['es'], fileName: () => 'sim.js' },
  },
};

// The website: the landing page (index.html, "/") and the roadmap (roadmap.html, "/roadmap"). The game
// is the Godot client (godot/), served from R2 at /godot/ by the Worker; /play redirects there.
export default defineConfig(({ mode }) => mode === 'server' ? serverBuild : {
  build: {
    rollupOptions: {
      input: {
        site: resolve(import.meta.dirname, 'index.html'),
        roadmap: resolve(import.meta.dirname, 'roadmap.html'),
      },
    },
  },
});
