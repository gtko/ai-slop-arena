// Over-the-air updates of the mobile bundle (src/updates.js): version order, manifest checks, which
// downloaded bundle to switch to, retries of downloads and boots, and the native build numbers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseVersion, compareVersions, manifestFor, shouldDownload, pickDownloaded, MIN_NATIVE, bundleUrl, buildNumber,
  nativeVersion, loadState, downloadStarted, downloadDone, bootFailed, bootOk, MAX_DOWNLOADS, MAX_BOOTS,
} from '../src/updates.js';

let n = 0;
const test = (name, fn) => { fn(); n++; };

test('parseVersion', () => {
  assert.deepEqual(parseVersion('0.16.0'), [0, 16, 0]);
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('1.2.3-beta.1'), [1, 2, 3]);
  for (const bad of ['', '1.2', '1.0', '1.2.3.4', 'builtin', null, undefined, 'x1.2.3', '1.2.a']) assert.equal(parseVersion(bad), null, String(bad));
});

test('compareVersions is numeric, not lexical', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('0.16.0', '0.16.0'), 0);
  assert.equal(compareVersions('0.16.0', '0.16.1'), -1);
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
  assert.equal(compareVersions('builtin', '0.1.0'), null);
});

test('buildNumber matches the Android versionCode formula and grows with every version', () => {
  assert.equal(buildNumber('0.16.1'), 1601);
  assert.equal(buildNumber('1.2.3'), 10203);
  assert.ok(buildNumber('0.17.0') > buildNumber('0.16.99'));
  assert.equal(buildNumber('1.0'), null);
});

test('nativeVersion prefers what the OS reports, when it is a real version', () => {
  assert.equal(nativeVersion('0.17.0', '0.16.1'), '0.17.0');
  assert.equal(nativeVersion('1.0', '0.16.1'), '0.16.1', 'iOS build straight from Xcode');
  assert.equal(nativeVersion(undefined, '0.16.1'), '0.16.1');
  assert.equal(nativeVersion('1.0', null), null);
});

test('manifestFor points at the GitHub release asset', () => {
  const m = manifestFor('0.17.0');
  assert.equal(m.version, '0.17.0');
  assert.equal(m.minNative, MIN_NATIVE);
  assert.equal(m.url, 'https://github.com/gtko/ai-slop-arena/releases/download/v0.17.0/AISlopArena-app-bundle.zip');
  assert.equal(bundleUrl('1.0.0'), 'https://github.com/gtko/ai-slop-arena/releases/download/v1.0.0/AISlopArena-app-bundle.zip');
});

test('shouldDownload', () => {
  const m = manifestFor('0.17.0', '0.16.1');
  const ctx = { running: '0.16.1', native: '0.16.1' };
  assert.equal(shouldDownload(m, ctx), true);
  assert.equal(shouldDownload(m, { ...ctx, running: '0.17.0' }), false, 'same version');
  assert.equal(shouldDownload(m, { ...ctx, running: '0.18.0' }), false, 'older than the running bundle');
  assert.equal(shouldDownload(m, { ...ctx, native: '0.16.0' }), false, 'native shell too old');
  assert.equal(shouldDownload(m, { ...ctx, native: '0.20.0' }), true, 'newer native shell');
  assert.equal(shouldDownload(m, { ...ctx, native: null }), false, 'unknown native version');
  assert.equal(shouldDownload(m, { ...ctx, state: loadState({ failed: ['0.17.0'] }) }), false, 'given up on');
  assert.equal(shouldDownload({ ...m, url: 'http://x/y.zip' }, ctx), false, 'not https');
  assert.equal(shouldDownload({ ...m, version: 'latest' }, ctx), false, 'bad version');
  assert.equal(shouldDownload({ ...m, minNative: undefined }, ctx), false, 'no minNative');
  for (const bad of [null, undefined, 'x', 42, []]) assert.equal(shouldDownload(bad, ctx), false);
});

test('downloads that never finish are retried once, then skipped until a newer version', () => {
  const m = manifestFor('0.17.0', '0.16.1');
  const ctx = { running: '0.16.1', native: '0.16.1' };
  let s = loadState(null);
  for (let i = 0; i < MAX_DOWNLOADS; i++) {
    assert.equal(shouldDownload(m, { ...ctx, state: s }), true, `try ${i + 1}`);
    s = downloadStarted(s, '0.17.0'); // killed / unzip error / storage full: never downloadDone
  }
  assert.equal(shouldDownload(m, { ...ctx, state: s }), false, 'gave up on 0.17.0');
  assert.equal(shouldDownload(manifestFor('0.17.1', '0.16.1'), { ...ctx, state: s }), true, 'a newer release starts afresh');
  assert.deepEqual(downloadStarted(s, '0.17.1').downloads, { '0.17.1': 1 }, 'only the newest version is tracked');
  assert.deepEqual(downloadDone(downloadStarted(loadState(null), '0.17.0'), '0.17.0').downloads, {}, 'a finished download clears it');
});

test('a bundle that does not boot gets a second chance, then is given up on', () => {
  let s = loadState(null);
  s = bootFailed(s, '0.17.0');
  assert.deepEqual(s.failed, [], 'first failure: may be downloaded and tried again');
  assert.equal(s.boots['0.17.0'], 1);
  for (let i = 1; i < MAX_BOOTS; i++) s = bootFailed(s, '0.17.0');
  assert.deepEqual(s.failed, ['0.17.0']);
  assert.equal(shouldDownload(manifestFor('0.17.0', '0.16.1'), { running: '0.16.1', native: '0.16.1', state: s }), false);
  const ok = bootOk(downloadStarted(bootFailed(loadState(null), '0.18.0'), '0.18.0'), '0.18.0');
  assert.deepEqual([ok.boots, ok.downloads], [{}, {}], 'booting clears the counters');
});

test('loadState survives garbage', () => {
  for (const raw of [null, '', 'nope', '[]', '{"failed":"x","boots":[1],"downloads":7}', 42]) {
    const s = loadState(raw);
    assert.deepEqual(s, { failed: [], boots: {}, downloads: {} }, String(raw));
  }
  assert.deepEqual(loadState(JSON.stringify({ failed: ['1.0.0', 3], boots: { '1.0.0': 1 } })).failed, ['1.0.0']);
});

test('pickDownloaded', () => {
  const bundles = [
    { id: 'builtin', version: '0.16.0', status: 'success' },
    { id: 'a', version: '0.16.1', status: 'pending' },
    { id: 'b', version: '0.17.0', status: 'pending' },
    { id: 'c', version: '0.18.0', status: 'error' },
    { id: 'd', version: '0.17.1', status: 'downloading' },
  ];
  assert.equal(pickDownloaded(bundles, { running: '0.16.0' }).id, 'b');
  assert.equal(pickDownloaded(bundles, { running: '0.16.0', failed: ['0.17.0'] }).id, 'a');
  assert.equal(pickDownloaded(bundles, { running: '0.17.0' }), null);
  assert.equal(pickDownloaded([], { running: '0.16.0' }), null);
  assert.equal(pickDownloaded(undefined, { running: '0.16.0' }), null);
});

test('the iOS project carries package.json\'s version and build number (npm run native:version)', () => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const pbx = readFileSync(new URL('../ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8');
  const all = re => [...pbx.matchAll(re)].map(m => m[1]);
  const mv = all(/MARKETING_VERSION = ([^;]+);/g), cv = all(/CURRENT_PROJECT_VERSION = ([^;]+);/g);
  assert.ok(mv.length && cv.length);
  assert.ok(mv.every(v => v === version), `MARKETING_VERSION ${mv} != ${version}`);
  assert.ok(cv.every(v => +v === buildNumber(version)), `CURRENT_PROJECT_VERSION ${cv} != ${buildNumber(version)}`);
});

console.log(`ok   ${n} OTA update checks`);
