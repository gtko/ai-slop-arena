import * as THREE from 'three';
import { sfx } from './audio.js';

// Kit 2.0 (v0.12, docs/brainstorm/iter3_maya.md §2a): every brawler picks one of two gadgets (A =
// mobility, B = utility) and one of two star powers (passives) before the match.
//
// A gadget has 3 charges per match and a 5 s lockout. It runs in three parts:
//  - move():   on the machine that controls the brawler (your own brawler, bots on the host): dashes,
//              slides and hops are ordinary movement, so the host only widens its move check.
//  - effect(): on the authority (solo, host, server): damage, roots, reveals, walls, buffs.
//  - fx():     everywhere (the host broadcasts a 'gad' event): visuals, plus its `sound`, if you can see it.

export const GADGET_CHARGES = 3, GADGET_LOCKOUT = 5;
// HUD / lobby icon of each gadget
export const GADGET_ICONS = { blasterA: '🐏', blasterB: '🪵', gunslingerA: '🌀', gunslingerB: '🎆', bomberA: '🦘', bomberB: '🧨',
  frostbiteA: '⛸️', frostbiteB: '🧊', voltA: '⚡', voltB: '🔋', kappaA: '🤿', kappaB: '🥣' };
const YELLOW = new THREE.Color(3.2, 2.6, 0.6), ICE = new THREE.Color(1.4, 2.8, 3.6), ZAP = new THREE.Color(2.2, 3.4, 4.6);
const LAVA = new THREE.Color(3.4, 1.2, 0.2), BARK = new THREE.Color(1.6, 1.1, 0.5), PINK = new THREE.Color(3.4, 1.4, 2.4);
const WATER = new THREE.Color(0.8, 2.2, 3.4), HEAL = new THREE.Color(0.8, 3.2, 1.4);

// A dash: velocity for `time` seconds, walls stop it like any movement (air: flies over them).
const dash = (b, dx, dz, dist, time, air = false) => { b.dash = { vx: dx * dist / time, vz: dz * dist / time, t: time, air, T: time }; };

export const GADGETS = {
  blasterA: {
    sound: 'gad_dash',
    // Root Charge: 4 m shoulder dash; the first enemy bumped takes 400 and is rooted 0.6 s
    dist: 4,
    move(g, b, dx, dz) { dash(b, dx, dz, 4, 0.25); },
    effect(g, b) { b.chargeT = 0.35; b.chargeHit = null; },
    fx(g, b, dx, dz) { g.effects.dust(b.pos.x, b.pos.z, 10, 0xb58a5a, 1.2); b.attacked(); },
  },
  blasterB: {
    sound: 'gad_bark',
    // Bark Skin: 2.5 s of -35% damage taken, -20% speed
    move(g, b) { b.slowSelfT = 2.5; },
    effect(g, b) { b.armorT = 2.5; b.slowSelfT = 2.5; },
    fx(g, b) { g.effects.ring(b.pos.x, b.pos.z, 1.3, BARK, 0.6); g.effects.debrisBurst(b.pos.x, 1, b.pos.z, 0x8a5a2e, 8, 0.2, 3); },
  },
  gunslingerA: {
    sound: 'gad_dash',
    // Tail Roll: 3.5 m roll, 0.25 s untouchable, +1 ammo
    dist: 3.5,
    move(g, b, dx, dz) { dash(b, dx, dz, 3.5, 0.22); },
    effect(g, b) { b.ghostT = 0.25; b.ammo = Math.min(b.type.ammo, b.ammo + 1); },
    fx(g, b) { g.effects.dust(b.pos.x, b.pos.z, 8, 0xf0b8d0, 1); },
  },
  gunslingerB: {
    sound: 'gad_flare',
    // Star Flare: a flare to the aim point (up to 16 m) that reveals everyone within 6 m for 3 s
    effect(g, b, dx, dz, p) {
      const [x, z] = reach(g, b, dx, dz, p, 16);
      for (const o of g.brawlers) if (o !== b && !g.ally(b, o) && o.alive && Math.hypot(o.pos.x - x, o.pos.z - z) < 6) o.revealT = Math.max(o.revealT, 3);
      g.ev({ e: 'flare', x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100 });
      flareFx(g, x, z);
    },
    fx() {},
  },
  bomberA: {
    sound: 'gad_hop',
    // Lava Hop: a 5 m jump (0.6 s in the air, over one wall at most); the landing burns 300/s for 2 s
    dist: 5.5, air: true,
    move(g, b, dx, dz) {
      const A = g.arena;
      let d = 5;
      while (d > 1 && A.blocksMoveAt(b.pos.x + dx * d, b.pos.z + dz * d)) d -= 0.5; // land on open ground
      dash(b, dx, dz, d, 0.6, true);
    },
    effect(g, b) { b.hopLandT = 0.6; },
    fx(g, b) { g.effects.dust(b.pos.x, b.pos.z, 8, 0x6a4a3a, 1); },
  },
  bomberB: {
    sound: 'gad_fuse',
    // Fuse Cut: the next fireball flies 40% faster
    effect(g, b) { b.fuseNext = true; },
    fx(g, b) { b.fuseNext = true; g.effects.sparkBurst(b.pos.x, 1.6, b.pos.z, LAVA, 16, 5, 0.4, 0.14); },
  },
  frostbiteA: {
    sound: 'gad_dash',
    // Ice Slide: 5 m slide in 0.35 s
    dist: 5,
    move(g, b, dx, dz) { dash(b, dx, dz, 5, 0.35); },
    effect() {},
    fx(g, b) { g.effects.sparkBurst(b.pos.x, 0.3, b.pos.z, ICE, 18, 4, 0.5, 0.14); },
  },
  frostbiteB: {
    sound: 'gad_icewall',
    // Ice Wall: 3 ice blocks across the aim, 4 m ahead, for 3 s: they stop bullets, feet and eyes
    effect(g, b, dx, dz) {
      const x = b.pos.x + dx * 4, z = b.pos.z + dz * 4, A = g.arena, tiles = [];
      const ci = A.toTile(x), cj = A.toTile(z), across = Math.abs(dx) > Math.abs(dz) ? [0, 1] : [1, 0];
      for (let k = -1; k <= 1; k++) tiles.push([ci + across[0] * k, cj + across[1] * k]);
      const placed = g.iceWall(tiles);
      if (placed.length) g.ev({ e: 'ice', t: placed });
    },
    fx(g, b) { g.effects.sparkBurst(b.pos.x, 1.2, b.pos.z, ICE, 10, 3, 0.4, 0.12); },
  },
  voltA: {
    sound: 'gad_blink',
    // Blink: 5 m teleport after a 0.15 s charge, only where you can see; leaves a zap trap (500)
    dist: 5.5,
    move(g, b, dx, dz) {
      const A = g.arena;
      let d = 5;
      while (d > 0.5 && (A.blocksMoveAt(b.pos.x + dx * d, b.pos.z + dz * d) || !A.los(b.pos.x, b.pos.z, b.pos.x + dx * d, b.pos.z + dz * d))) d -= 0.5;
      b.blink = { x: b.pos.x + dx * d, z: b.pos.z + dz * d, t: 0.15 };
    },
    effect(g, b) {
      const p = b.netDriven ? { x: b.net.x, z: b.net.y } : b.pos;
      g.combat.zone({ x: p.x, z: p.z, r: 1.1, dmg: 500, once: true, t: 2, owner: b, col: ZAP, delay: 0.15 }, true);
    },
    fx(g, b) { g.effects.ring(b.pos.x, b.pos.z, 1.1, ZAP, 0.4); g.effects.sparkBurst(b.pos.x, 1, b.pos.z, ZAP, 16, 5, 0.3, 0.12); },
  },
  voltB: {
    sound: 'gad_overclock',
    // Overclock: instant full reload, +30% reload speed for 3 s
    move(g, b) { b.ammo = b.type.ammo; b.overclockT = 3; },
    effect(g, b) { b.ammo = b.type.ammo; b.overclockT = 3; },
    fx(g, b) { g.effects.ring(b.pos.x, b.pos.z, 1.2, ZAP, 0.5); },
  },
};

// Nurse Kappa (v0.14)
GADGETS.kappaA = {
  sound: 'gad_dive',
  // River Dive: a 5 m dive (8 m from water), untouchable for 0.3 s
  dist: 8,
  move(g, b, dx, dz) { dash(b, dx, dz, g.arena.isWaterAt(b.pos.x, b.pos.z) ? 8 : 5, 0.3); },
  effect(g, b) { b.ghostT = 0.3; },
  fx(g, b) { g.effects.splash(b.pos.x, b.pos.z, 0.8); },
};
GADGETS.kappaB = {
  sound: 'gad_bowl',
  // Bowl Splash: she empties her head dish: a 2 m puddle heals her and her partner 400/s for 3 s; with
  // the bowl empty she walks 20% slower for 4 s after
  move(g, b) { b.bowlSlowAt = g.time + 3; },
  effect(g, b) {
    b.bowlSlowAt = g.time + 3;
    const p = b.netDriven ? { x: b.net.x, z: b.net.y } : b.pos;
    g.combat.zone({ x: p.x, z: p.z, r: 2, heal: 400, t: 3, owner: b, col: HEAL }, true);
  },
  fx(g, b) { g.effects.splash(b.pos.x, b.pos.z, 0.6); g.effects.ring(b.pos.x, b.pos.z, 2, WATER, 0.5); },
};

// Star powers: passives read by the rules where they apply (brawler.js, combat.js).
export const STARS = {
  blaster: ['sapRegen', 'splinters'],       // regen after 2 s (not 3) | seeds that hit a wall split into 2 shards
  gunslinger: ['steadyAim', 'axoRegen'],    // -50% burst spread standing still | regen 13 -> 18%/s
  bomber: ['magmaPuddle', 'bigBang'],       // fireballs leave a 1.5 m puddle (200/s, 2 s) | radius 2.0 -> 2.4, damage 800 -> 720
  frostbite: ['deepFreeze', 'permafrost'],  // shards slow x0.45 (not 0.55) | nova radius +25%, freeze 1.0 s (not 1.4)
  volt: ['conductor', 'surge'],             // +1 chain | storm 7 bolts x 450 (not 5 x 600)
  kappa: ['hydrotherapy', 'undertow'],      // heals +30% | the Tidal Wave pulls enemies toward her instead of pushing
};
export const hasStar = (b, id) => STARS[b.type.key]?.[(b.star || 1) - 1] === id;

// Loadout in a brawler string: 'volt' (gadget A, star 1) or 'volt:B2'.
export function parseLoadout(s) {
  const [type, lo = ''] = String(s || '').split(':');
  return { type, gadget: lo[0] === 'B' ? 'B' : 'A', star: lo[1] === '2' ? 2 : 1 };
}
export const LOADOUT = /^[a-z]+(?::[AB][12])?$/;
// A brawler string the network may carry: a known brawler, with or without a loadout.
export const validBrawler = s => typeof s === 'string' && LOADOUT.test(s) && Object.hasOwn(STARS, s.split(':')[0]);
// The loadout travels on its own ('B2') so older builds, which only know the brawler name, still work.
export const validLoadout = s => typeof s === 'string' && /^[AB][12]$/.test(s);

function reach(g, b, dx, dz, p, max) {
  let x = p ? p.x : b.pos.x + dx * max, z = p ? p.z : b.pos.z + dz * max;
  const d = Math.hypot(x - b.pos.x, z - b.pos.z);
  if (d > max) { x = b.pos.x + (x - b.pos.x) / d * max; z = b.pos.z + (z - b.pos.z) / d * max; }
  return [x, z];
}

export function flareFx(g, x, z) {
  g.effects.ring(x, z, 6, YELLOW, 0.9);
  g.effects.flash(x, 3, z, 1, 0.9, 0.5, 260, 14, 0.6);
  g.effects.sparkBurst(x, 2.5, z, YELLOW, 30, 6, 0.8, 0.16);
  sfx('boom', g.volumeAt(x, z) * 0.5);
}

export { PINK };

// The look and sound of a gadget, for everyone who can see its user.
export function gadgetFx(g, b, dx, dz) {
  const G = GADGETS[b.type.key + b.gadget];
  if (!G) return;
  G.fx(g, b, dx, dz);
  if (g.fxVisible(b)) sfx(G.sound, g.volumeAt(b.pos.x, b.pos.z));
}
