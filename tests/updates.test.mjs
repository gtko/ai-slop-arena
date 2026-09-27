// Over-the-air updates of the mobile bundle (src/updates.js): version order, manifest checks, which
// downloaded bundle to switch to, and bundles that failed to boot.
import assert from 'node:assert/strict';
import { parseVersion, compareVersions, manifestFor, shouldDownload, pickDownloaded, settleAttempt, MIN_NATIVE, bundleUrl } from '../src/updates.js';

let n = 0;
const test = (name, fn) => { fn(); n++; };

test('parseVersion', () => {
  assert.deepEqual(parseVersion('0.16.0'), [0, 16, 0]);
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('1.2.3-beta.1'), [1, 2, 3]);
  for (const bad of ['', '1.2', '1.2.3.4', 'builtin', null, undefined, 'x1.2.3', '1.2.a']) assert.equal(parseVersion(bad), null, String(bad));
});

test('compareVersions is numeric, not lexical', () => {
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('0.16.0', '0.16.0'), 0);
  assert.equal(compareVersions('0.16.0', '0.16.1'), -1);
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
  assert.equal(compareVersions('builtin', '0.1.0'), null);
});

test('manifestFor points at the GitHub release asset', () => {
  const m = manifestFor('0.17.0');
  assert.equal(m.version, '0.17.0');
  assert.equal(m.minNative, MIN_NATIVE);
  assert.equal(m.url, 'https://github.com/gtko/ai-slop-arena/releases/download/v0.17.0/AISlopArena-app-bundle.zip');
  assert.equal(bundleUrl('1.0.0'), 'https://github.com/gtko/ai-slop-arena/releases/download/v1.0.0/AISlopArena-app-bundle.zip');
});

test('shouldDownload', () => {
  const m = manifestFor('0.17.0', '0.16.0');
  const ctx = { running: '0.16.0', native: '0.16.0' };
  assert.equal(shouldDownload(m, ctx), true);
  assert.equal(shouldDownload(m, { ...ctx, running: '0.17.0' }), false, 'same version');
  assert.equal(shouldDownload(m, { ...ctx, running: '0.18.0' }), false, 'older than the running bundle');
  assert.equal(shouldDownload(m, { ...ctx, native: '0.15.2' }), false, 'native shell too old');
  assert.equal(shouldDownload(m, { ...ctx, native: '0.20.0' }), true, 'newer native shell');
  assert.equal(shouldDownload(m, { ...ctx, native: undefined }), false, 'unknown native version');
  assert.equal(shouldDownload(m, { ...ctx, failed: ['0.17.0'] }), false, 'failed to boot before');
  assert.equal(shouldDownload({ ...m, url: 'http://x/y.zip' }, ctx), false, 'not https');
  assert.equal(shouldDownload({ ...m, version: 'latest' }, ctx), false, 'bad version');
  assert.equal(shouldDownload({ ...m, minNative: undefined }, ctx), false, 'no minNative');
  for (const bad of [null, undefined, 'x', 42, []]) assert.equal(shouldDownload(bad, ctx), false);
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

test('settleAttempt remembers bundles that never booted', () => {
  assert.deepEqual(settleAttempt(null, '0.16.0', []), []);
  assert.deepEqual(settleAttempt('0.17.0', '0.17.0', []), [], 'booted: nothing failed');
  assert.deepEqual(settleAttempt('0.17.0', '0.16.0', []), ['0.17.0'], 'rolled back');
  assert.deepEqual(settleAttempt('0.17.0', '0.16.0', ['0.17.0']), ['0.17.0'], 'no duplicates');
  assert.deepEqual(settleAttempt('9.0.0', '0.16.0', ['1.0.0', '2.0.0', '3.0.0', '4.0.0', '5.0.0']), ['2.0.0', '3.0.0', '4.0.0', '5.0.0', '9.0.0']);
});

console.log(`ok   ${n} OTA update checks`);
