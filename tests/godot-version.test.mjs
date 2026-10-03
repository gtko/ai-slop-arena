// Godot client versions (scripts/godot-version.mjs): the Play versionCode scheme and the version fields of
// godot/project.godot and godot/export_presets.cfg kept in sync with package.json.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseGodotVersion, godotVersionCode, presetValues, applyPresets, applyProject, files, packageVersion,
} from '../scripts/godot-version.mjs';

let n = 0;
const test = (name, fn) => { fn(); n++; };

test('versionCode scheme: (maj*10000+min*100+patch)*100 + 99 final / N beta', () => {
  assert.equal(godotVersionCode('0.17.1'), 170199);
  assert.equal(godotVersionCode('1.2.3'), 1020399);
  assert.equal(godotVersionCode('0.18.0-beta.1'), 180001);
  assert.equal(godotVersionCode('0.18.0-beta.98'), 180098);
  assert.ok(godotVersionCode('0.18.0-beta.98') < godotVersionCode('0.18.0'));
  assert.ok(godotVersionCode('0.18.0') < godotVersionCode('0.18.1-beta.1'));
  assert.ok(godotVersionCode('0.17.2') > godotVersionCode('0.17.1'));
  for (const bad of ['1.2', '0.18.0-beta.0', '0.18.0-beta.99', '0.18.0-rc.1', '0.100.0', '0.1.100', '', null]) {
    assert.equal(godotVersionCode(bad), null, String(bad));
  }
});

test('every Godot versionCode is above the Capacitor app\'s (maj*10000+min*100+patch)', () => {
  const capacitor = v => { const p = parseGodotVersion(v); return p.major * 10000 + p.minor * 100 + p.patch; };
  for (const v of ['0.17.1', '0.18.0-beta.1', '0.99.99']) assert.ok(godotVersionCode(v) > capacitor('0.99.99'), v);
});

test('preset values per platform', () => {
  assert.deepEqual(presetValues('Android', '0.18.0-beta.2'), { 'version/code': '180002', 'version/name': '"0.18.0-beta.2"' });
  assert.deepEqual(presetValues('iOS', '0.18.0-beta.2'), { 'application/short_version': '"0.18.0"', 'application/version': '"180002"' });
  assert.deepEqual(presetValues('Windows Desktop', '0.17.1'), { 'application/file_version': '"0.17.1.99"', 'application/product_version': '"0.17.1.99"' });
  assert.deepEqual(presetValues('Linux', '0.17.1'), {});
  assert.deepEqual(presetValues('Web', '0.17.1'), {});
});

test('applyPresets edits only the version keys, adds missing ones, keeps CRLF', () => {
  const cfg = '[preset.0]\r\n\r\nname="A"\r\nplatform="Android"\r\n\r\n[preset.0.options]\r\n\r\nversion/code=1\r\npermissions/internet=true\r\n\r\n'
    + '[preset.1]\r\n\r\nname="W"\r\nplatform="Windows Desktop"\r\n\r\n[preset.1.options]\r\n\r\nbinary_format/embed_pck=false\r\n';
  const out = applyPresets(cfg, '0.17.1');
  assert.match(out, /version\/code=170199\r\n/);
  assert.match(out, /version\/name="0.17.1"\r\npermissions|permissions\/internet=true\r\nversion\/name="0.17.1"/);
  assert.match(out, /application\/file_version="0.17.1.99"/);
  assert.ok(!/[^\r]\n/.test(out), 'line endings stay CRLF');
  assert.equal(applyPresets(out, '0.17.1'), out, 'idempotent');
  assert.match(applyProject('[application]\nconfig/name="X"\n\n[display]\n', '1.0.0'), /config\/name="X"\nconfig\/version="1.0.0"\n\n\[display\]/);
});

test('godot/project.godot and godot/export_presets.cfg carry package.json\'s version (npm run godot:version)', () => {
  const v = packageVersion();
  const project = readFileSync(files.project, 'utf8'), presets = readFileSync(files.presets, 'utf8');
  assert.equal(applyProject(project, v), project, `project.godot is not at ${v}: npm run godot:version`);
  assert.equal(applyPresets(presets, v), presets, `export_presets.cfg is not at ${v}: npm run godot:version`);
  assert.ok(presets.includes('package/unique_name="com.aislop.arena"'), 'the Play package of the Capacitor app');
  assert.ok(presets.includes('application/bundle_identifier="ch.gtko.aisloparena"'), 'the iOS bundle id of the Capacitor app');
});

console.log(`ok   ${n} Godot version checks`);
