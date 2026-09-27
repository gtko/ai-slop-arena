// Writes package.json's version into the iOS project (ios/App/App.xcodeproj/project.pbxproj):
// MARKETING_VERSION = x.y.z (CFBundleShortVersionString) and CURRENT_PROJECT_VERSION = the build number
// major*10000 + minor*100 + patch (CFBundleVersion), the same formula as Android's versionCode
// (android/app/build.gradle, which reads package.json by itself). The build number must grow with every
// store build: the OTA updater (docs/ota-updates.md) drops downloaded bundles when it changes.
// Run by `npm run app:build` and the release workflow; tests/updates.test.mjs checks the file is in sync.
// Usage: node scripts/native-version.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { buildNumber } from '../src/updates.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const build = buildNumber(version);
if (!build) throw new Error(`package.json version ${version} is not x.y.z`);
const file = new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url);
const before = readFileSync(file, 'utf8');
const after = before
  .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`)
  .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);
if (after !== before) writeFileSync(file, after);
console.log(`iOS version ${version} (${build})${after === before ? ', already set' : ''}`);
