// Steam integration (godot/scripts/steam_platform.gd, achievements.gd): the data the Godot client and
// the Steamworks partner site share must not drift. The GDScript logic itself is tested by
// godot/tools/test_steam.gd (godot --headless --path godot --script tools/test_steam.gd).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let n = 0;
const test = (name, fn) => { fn(); n++; };
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const json = p => JSON.parse(read(p));

test('achievements.gd declares the achievements and stats of src/achievements.json (the Steamworks API names)', () => {
  const gd = read('godot/scripts/achievements.gd');
  const list = name => [...gd.match(new RegExp(String.raw`const ${name} := \[([^\]]*)\]`, 's'))[1].matchAll(/"([A-Z_]+)"/g)].map(m => m[1]);
  const data = json('src/achievements.json');
  assert.deepEqual(list('IDS').sort(), Object.keys(data.achievements).sort());
  assert.deepEqual(list('STATS').sort(), [...data.stats].sort());
  for (const id of Object.keys(data.achievements)) assert.ok(gd.includes(`unlock("${id}")`), `${id} is never unlocked`);
});

test('steam.json carries package.json steam.appId (npm: node godot/tools/export-data.mjs)', () => {
  assert.equal(json('godot/data/steam.json').appId, json('package.json').steam.appId);
});

test('steam_langs.json maps every Steam language name to a game language (node godot/tools/export-i18n.mjs)', () => {
  const rows = json('src/i18n/langs.json');
  const map = json('godot/data/i18n/steam_langs.json');
  assert.equal(Object.keys(map).length, rows.length);
  for (const [code, , steam] of rows) assert.equal(map[steam], code, steam);
});

test('map and brawler keys are append-only: MAPS_MASK / WINS_MASK bits follow the data order', () => {
  const keys = f => Object.keys(json(f));
  const maps = ['oasis', 'dunes', 'grove', 'frost', 'isles', 'marsh'];
  const brawlers = ['blaster', 'gunslinger', 'bomber', 'frostbite', 'volt', 'kappa', 'pipchomp', 'mochi'];
  assert.deepEqual(keys('godot/data/maps.json').slice(0, maps.length), maps);
  assert.deepEqual(keys('godot/data/brawlers.json').slice(0, brawlers.length), brawlers);
});

test('rich presence: every token steam_platform.gd can set is localised in steam/rich_presence.vdf', () => {
  const vdf = read('steam/rich_presence.vdf');
  for (const what of ['menu', 'queue', 'lobby', 'match']) assert.ok(vdf.includes(`"#Status_${what[0].toUpperCase()}${what.slice(1)}"`), what);
  assert.ok(read('godot/scripts/main.gd').includes('State.QUEUE: what = "queue"'));
});

test('the GodotSteam plugin is only packed into the Steam presets', () => {
  const presets = read('godot/export_presets.cfg').split(/\r?\n(?=\[preset\.\d+\]\r?$)/m);
  assert.equal(presets.length, 7);
  for (const p of presets) {
    const name = p.match(/^name="(.*)"/m)[1];
    const excluded = /^exclude_filter=".*addons\/godotsteam\/\*/m.test(p);
    assert.equal(excluded, !name.includes('(Steam)'), `${name}: godotsteam ${excluded ? 'excluded' : 'packed'}`);
  }
});

console.log(`steam: ${n} tests passed`);
