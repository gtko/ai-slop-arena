// Game feel (v0.11 IMPACT, tuning sheet in docs/brainstorm/iter3_kenji.md §2d): hit freeze, camera
// trauma, zoom punches, the hit-confirm pitch ladder and the final-KO slow motion. Everything here is
// cosmetic: the match rules never pause, so online play and the headless server are unaffected.

// Per weapon: [victim hit freeze (s), trauma when you land it, trauma when you take it]
const WEAPONS = {
  blaster: [0.025, 0.04, 0.18], blasterS: [0.09, 0.12, 0.35],
  gunslinger: [0.02, 0.02, 0.1], gunslingerS: [0.03, 0.03, 0.12],
  bomber: [0.06, 0.2, 0.3], bomberS: [0.11, 0.55, 0.55],
  frostbite: [0.035, 0.05, 0.15], frostbiteS: [0.12, 0.1, 0.4],
  volt: [0.045, 0.06, 0.18], voltS: [0.07, 0.3, 0.35],
  kappa: [0.04, 0.08, 0.2], kappaS: [0.08, 0.35, 0.4],
};
const DEFAULT = [0.03, 0.05, 0.18];
export const weapon = (source, sup) => (source && WEAPONS[source.type.key + (sup ? 'S' : '')]) || DEFAULT;

// Trauma camera: shake = trauma², smooth noise (not white jitter), max 0.55 m and 1.2° of roll.
const MAX_OFFSET = 0.55, MAX_ROLL = 1.2 * Math.PI / 180, FREQ = 16, DECAY = 1.7;
// cheap smooth noise: a few incommensurate sines per axis
const wobble = (t, s) => (Math.sin(t * 1.0 + s) + Math.sin(t * 1.73 + s * 2.1) * 0.6 + Math.sin(t * 2.91 + s * 3.7) * 0.35) / 1.95;

export class Feel {
  constructor() {
    this.reset();
  }

  reset() {
    this.trauma = 0;
    this.t = 0;
    this.zoom = 1;          // camera distance factor, eased toward zoomWant * punch
    this.punch = 1;         // short zoom punches (KO, own super), eased back to 1
    this.punchBack = 4;
    this.slowT = 0;         // final KO: render time at 35% for a second
    this.orbit = 0;         // final KO: the camera circles the winner
    this.orbitWant = 0;
    this.ladder = 0;        // consecutive hits you landed (pitch ladder), reset after 1 s without one
    this.ladderT = 0;
    this.lookX = 0; this.lookZ = 0;
  }

  add(trauma) { this.trauma = Math.min(1, this.trauma + trauma); }

  // A zoom punch: factor (<1 = closer) reached at once, then eased back over `back` seconds.
  punchTo(factor, back = 0.25) {
    this.punch = Math.min(this.punch, factor);
    this.punchBack = 1 / back;
  }

  // The next hit-confirm step (0..4): each hit you land within a second rises in pitch.
  nextHit() {
    this.ladder = this.ladderT > 0 ? Math.min(this.ladder + 1, 4) : 0;
    this.ladderT = 1;
    return this.ladder;
  }

  // slow: the render slow motion (offline only; online the match keeps real time)
  finalKo(slow = true) {
    if (this.orbitWant) return; // once per match
    this.slowT = slow ? 1 : 0;
    this.orbitWant = 2.1; // ~120° around the winner while the result comes in
  }

  // Render-time scale: the final KO plays at 35% speed for a second (1 s of real time).
  timeScale(dt) {
    if (this.slowT <= 0) return 1;
    this.slowT -= dt;
    return 0.35;
  }

  update(dt, zoomWant) {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - DECAY * dt);
    this.ladderT -= dt;
    this.punch += (1 - this.punch) * (1 - Math.exp(-this.punchBack * 3 * dt));
    this.zoom += (zoomWant - this.zoom) * (1 - Math.exp(-dt / 0.6));
    this.orbit += (this.orbitWant - this.orbit) * (1 - Math.exp(-1.2 * dt));
  }

  // Camera offset from the trauma (x, y, z in metres, roll in radians); 0 when shake is off.
  shake(enabled) {
    const s = enabled === false ? 0 : this.trauma * this.trauma, t = this.t * FREQ;
    return { x: MAX_OFFSET * s * wobble(t, 1), y: MAX_OFFSET * s * wobble(t, 5) * 0.6, z: MAX_OFFSET * s * wobble(t, 9), roll: MAX_ROLL * s * wobble(t, 13) };
  }
}
