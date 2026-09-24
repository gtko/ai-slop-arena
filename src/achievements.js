import { steam } from './platform.js';
import { MAPS } from './maps.js';
import { TYPES } from './brawler.js';

// Steam achievements + stats. Progress is always kept locally (so it survives playing without
// Steam and nothing is lost before the Steamworks backend is set up) and mirrored to Steam.
// The API names below must match the achievements and stats declared on the Steamworks partner
// site: see steam/README.md for the exact list to paste in.

export const ACHIEVEMENTS = {
  FIRST_KO: { name: 'First Blood', desc: 'Knock out a brawler.' },
  FIRST_WIN: { name: 'Last One Standing', desc: 'Win a match.' },
  RAMPAGE: { name: 'Rampage', desc: 'Knock out 3 brawlers in one match.' },
  POWER_HUNGRY: { name: 'Power Hungry', desc: 'Hold 8 power cubes in one match.' },
  ONLINE_WIN: { name: 'Crowd Pleaser', desc: 'Win an online match against another human.' },
  SQUAD_UP: { name: 'Squad Up', desc: 'Play an online match with a friend.' },
  WORLD_TOUR: { name: 'World Tour', desc: 'Play on all five arenas.' },
  JACK_OF_ALL: { name: 'Jack of All Slops', desc: 'Win a match with each of the five brawlers.' },
  VETERAN: { name: 'Veteran', desc: 'Play 25 matches.' },
  CENTURION: { name: 'Centurion', desc: 'Knock out 100 brawlers.' },
};
// Int stats (same names on Steam).
const STATS = ['MATCHES', 'WINS', 'KOS', 'MAPS_MASK', 'WINS_MASK'];

const KEY = 'iaslop-progress';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const prog = Object.assign({ stats: {}, unlocked: {} }, load());
for (const s of STATS) prog.stats[s] ||= 0;
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prog)); } catch { /* private mode */ } };

const MAP_BITS = Object.keys(MAPS);
const TYPE_BITS = Object.keys(TYPES);
const all = list => (1 << list.length) - 1;

let match = null; // per-match counters

function unlock(id) {
  if (!ACHIEVEMENTS[id]) return;
  if (!prog.unlocked[id]) { prog.unlocked[id] = Date.now(); save(); }
  if (steam) steam.achieve(id); // idempotent; also re-syncs anything earned offline
}

function pushStats() {
  save();
  if (steam) steam.setStats(prog.stats);
}

export const achievements = {
  // Called when the local player starts a real match (not the menu's attract mode).
  matchStart({ mapKey, brawler, online = false, humans = 1 }) {
    match = { mapKey, brawler, online, humans, kos: 0, cubes: 0, done: false };
    const s = prog.stats;
    s.MATCHES++;
    if (MAP_BITS.includes(mapKey)) s.MAPS_MASK |= 1 << MAP_BITS.indexOf(mapKey);
    if (online && humans > 1) unlock('SQUAD_UP');
    if (s.MAPS_MASK === all(MAP_BITS)) unlock('WORLD_TOUR');
    if (s.MATCHES >= 25) unlock('VETERAN');
    pushStats();
  },
  ko() {
    if (!match) return;
    match.kos++;
    prog.stats.KOS++;
    unlock('FIRST_KO');
    if (match.kos >= 3) unlock('RAMPAGE');
    if (prog.stats.KOS >= 100) unlock('CENTURION');
    save();
  },
  cubes(n) {
    if (!match) return;
    match.cubes = Math.max(match.cubes, n);
    if (n >= 8) unlock('POWER_HUNGRY');
  },
  result(rank, won) {
    if (!match || match.done) return;
    match.done = true;
    const s = prog.stats;
    if (won) {
      s.WINS++;
      unlock('FIRST_WIN');
      if (match.online && match.humans > 1) unlock('ONLINE_WIN');
      if (TYPE_BITS.includes(match.brawler)) s.WINS_MASK |= 1 << TYPE_BITS.indexOf(match.brawler);
      if (s.WINS_MASK === all(TYPE_BITS)) unlock('JACK_OF_ALL');
    }
    pushStats(); // KOs are batched here too
  },
  end() { match = null; },
  // Re-send everything earned so far (first launch with Steam, or after playing offline).
  sync() {
    if (!steam) return;
    for (const id of Object.keys(prog.unlocked)) steam.achieve(id);
    steam.setStats(prog.stats);
  },
  get progress() { return prog; },
};
