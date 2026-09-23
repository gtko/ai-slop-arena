// Dev-only shot list for the site trailer and feature screenshots (not imported by any page).
// Run from the console on /play.html (dev server):
//   const t = await import('/src/trailer.js'); await t.recordTrailer(); await t.recordStills();
// Frames land in .ai3d/capture/, encoded by art-src/encode_trailer.sh.

const A = () => window.__arena;
const dev = () => window.__dev;
const ease = u => u * u * (3 - 2 * u);
const lerp = (a, b, u) => a + (b - a) * u;

function look(cam, x, y, z, tx, ty, tz) {
  cam.position.set(x, y, z);
  cam.lookAt(tx, ty, tz);
}

// follow one brawler (re-picked if it dies), preferring figurines in the thick of the fight
// Brawlers near the arena's edges drag the outer decor into frame (the camera looks down from the
// south), so the fight is picked among brawlers well inside, and dropped if it drifts to an edge.
const inside = b => Math.abs(b.pos.x) < 8 && b.pos.z > -14 && b.pos.z < 2;
function follower() {
  let tgt = null;
  return game => {
    if (!tgt || !tgt.alive || !inside(tgt)) {
      const alive = game.brawlers.filter(b => b.alive);
      const pool = alive.filter(inside).length ? alive.filter(inside) : alive;
      tgt = pool.sort((a, b) => crowd(game, b) - crowd(game, a))[0] || null;
    }
    return tgt;
  };
}
function crowd(game, b) {
  return game.brawlers.filter(o => o !== b && o.alive && o.pos.distanceTo(b.pos) < 9).length;
}
function tile(game, ch) {
  const G = game.arena.grid;
  for (let j = 3; j < G.length - 3; j++) for (let i = 3; i < G.length - 3; i++) if (G[j][i] === ch) return game.arena.center(i, j);
  return game.arena.center(12, 12);
}

// The in-game camera (same offset, same smoothing as Game.updateCamera, minus the menu's side shift),
// following `tgt`, with an optional push-in (zoom < 1 brings the camera closer along its axis).
function gameCam(cam, game, tgt, dt, zoom = 1) {
  const HALF = 25, p = tgt.pos;
  const x = Math.min(HALF - 9, Math.max(-(HALF - 9), p.x)), z = Math.min(HALF - 6, Math.max(-(HALF - 11), p.z));
  game.camFocus.x += (x - game.camFocus.x) * (1 - Math.exp(-2.2 * (dt || 1 / 30)));
  game.camFocus.z += (z - game.camFocus.z) * (1 - Math.exp(-2.2 * (dt || 1 / 30)));
  game.camFocus.y = 0;
  cam.position.copy(game.camFocus).addScaledVector(game.camOffset, zoom);
  cam.lookAt(game.camFocus.x, 0.5, game.camFocus.z);
}

// Gameplay shots: the normal top-down game view following the busiest brawler, one per arena.
export function trailerShots() {
  const shot = (map, tod, frames, extra = {}) => {
    const f = follower();
    let placed = false;
    return {
      map, tod, warm: 170, frames, ...extra,
      camera: (cam, u, game, dt) => {
        const b = f(game);
        if (!b) return;
        game.camTarget = b; // also centres the marsh's fog of war
        if (!placed) { game.camFocus.set(b.pos.x, 0, b.pos.z); placed = true; } // start on the action
        gameCam(cam, game, b, dt, 1 - 0.06 * ease(u)); // a barely visible push-in
      },
    };
  };
  return [
    shot('oasis', 1, 120),
    shot('grove', 3, 110),
    shot('frost', 1, 105),
    shot('dunes', 2, 105, { setup: game => game.weather?.setDensity?.(0.6) }),
    shot('marsh', 1, 100),
    shot('oasis', 2, 120),
  ];
}

export async function recordTrailer(opts = {}) {
  return dev().film(trailerShots(), { dir: 'trailer', ...opts });
}

// re-record some shots (indices into trailerShots) in place: frame numbers stay contiguous
export async function redoShots(indices) {
  const shots = trailerShots();
  let n = 0;
  for (let i = 0; i < shots.length; i++) {
    if (indices.includes(i)) await dev().film([shots[i]], { dir: 'trailer', offset: n });
    n += shots[i].frames;
  }
  return n;
}

// One wide establishing shot per arena, for the site's arena cards (1280x800)
export async function recordMapStills() {
  const d = dev();
  const shots = { oasis: [1, 0.35], dunes: [1, -0.4], grove: [1, 0.5], frost: [1, -0.3], marsh: [1, 0.2] };
  const only = arguments[0];
  for (const [map, [tod, a]] of Object.entries(shots)) {
    if (only && !only.includes(map)) continue;
    await d.still(`site/map_${map}.jpg`, {
      map, tod, warm: 180,
      // wide shots: no fog of war (marsh), a lighter sandstorm (dunes)
      setup: game => { game.visionRadius = 0; game.weather?.setDensity?.(map === 'dunes' ? 0.12 : 1); },
      camera: cam => { const k = map === 'dunes' ? 0.62 : 1; look(cam, Math.sin(a) * 30 * k, 27 * k, Math.cos(a) * 30 * k, 0, 0, -1); }, // the storm hazes distance
    }, { w: 1280, h: 800 });
  }
  return 'ok';
}

// Feature screenshots (1600x900)
export async function recordStills(only) {
  const d = dev();
  const lineup = ['blaster', 'gunslinger', 'bomber', 'frostbite', 'volt'];
  let lineupSpot = null;
  let lantern = null;
  const f = follower();
  const want = n => !only || only.includes(n);
  if (want('feat_light')) await d.still('site/feat_light.jpg', {
    map: 'grove', tod: 3, warm: 160,
    setup: game => { lantern = tile(game, 'T'); },
    camera: cam => look(cam, lantern.x + 5, 6, lantern.z + 8, lantern.x, 1, lantern.z),
  });
  if (want('feat_weather')) await d.still('site/feat_weather.jpg', {
    map: 'frost', tod: 1, warm: 160,
    camera: (cam, u, game) => { const p = f(game).pos; look(cam, p.x + 3, 11, p.z + 12, p.x, 0.5, p.z); },
  });
  if (want('feat_battle')) await d.still('site/feat_battle.jpg', {
    map: 'oasis', tod: 1, warm: 300,
    camera: (cam, u, game) => { const p = f(game).pos; look(cam, p.x, 19, p.z + 15, p.x, 0, p.z); },
  });
  if (want('feat_storm')) await d.still('site/feat_storm.jpg', {
    map: 'dunes', tod: 2, warm: 200,
    camera: (cam, u, game) => { const p = f(game).pos; look(cam, p.x - 4, 10, p.z + 11, p.x, 0.5, p.z); },
  });
  if (want('feat_fog')) await d.still('site/feat_fog.jpg', {
    map: 'marsh', tod: 1, warm: 160,
    setup: game => { game.camTarget = f(game); },
    camera: (cam, u, game) => { const b = f(game); game.camTarget = b; const p = b.pos; look(cam, p.x + 2, 9, p.z + 8, p.x, 0.6, p.z); },
  });
  // the five figurines side by side, frozen
  if (want('feat_figurines')) await d.still('site/feat_figurines.jpg', {
    tod: 1, warm: 4,
    setup: game => {
      const roster = [...lineup, ...lineup.slice(0, 3)].map((type, k) => ({ id: 'b' + k, name: type, type, human: false, spawn: k }));
      game.newMatch({ mapKey: 'oasis', roster });
      game.brains.clear();
      // a row of 5 plain floor tiles with a plain row in front (no crate, no bush)
      const G = game.arena.grid, N = G.length, free = (i, j) => G[j] && G[j][i] === '.';
      let spot = null;
      for (let j = 3; j < N - 4 && !spot; j++) for (let i = 2; i < N - 7 && !spot; i++) {
        let ok = true;
        for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 5; di++) if (!free(i + di, j + dj)) ok = false;
        if (ok) spot = [i, j];
      }
      const c0 = spot ? game.arena.center(spot[0], spot[1]) : d.openSpot().add({ x: -4, y: 0, z: 0 });
      lineupSpot = c0.clone().setX(c0.x + 4);
      game.brawlers.forEach(b => b.setVisible(false));
      for (const c of game.arena.crates.values()) c.group.visible = false; // a clean studio shot
      game.arena.bushes.visible = false;
      lineup.forEach((type, i) => {
        const b = game.brawlers.find(x => x.type.key === type);
        b.setVisible(true);
        b.pos.set(c0.x + i * 2, 0, c0.z);
        b.facing = 0.25;
      });
    },
    camera: (cam, u, game) => {
      const v = lineupSpot;
      game.brawlers.forEach(b => { if (b.root.visible) { b.root.rotation.y = 0.25; b.aimHold = 0; } });
      look(cam, v.x, 2.9, v.z + 8.2, v.x, 1.2, v.z);
    },
  });
  return 'ok';
}
