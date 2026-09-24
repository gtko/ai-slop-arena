// electron-builder config for the Epic Games Store build (npm run dist:epic): same app as the
// Steam build, flagged "store": "epic" (electron/main.cjs then never loads Steam) and without
// steamworks.js. Output: release/epic/win-unpacked, to upload with Epic's BuildPatchTool.
const base = require('../package.json').build;

module.exports = {
  ...base,
  directories: { output: 'release/epic' },
  files: [...base.files, '!node_modules/steamworks.js/**'],
  asarUnpack: [],
  extraMetadata: { store: 'epic' },
};
