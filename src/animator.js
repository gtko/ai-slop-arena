import * as THREE from 'three';

// Plays a figurine's baked clips (art-src/rig/clips.py) on three layers:
//   base     full body: a looping state (Idle, Run, Sneak, BushIdle, Slide, Victory) or a one-shot
//            (Bored, Fidget, Wave, Super, Death) that falls back to the loop when it ends
//   upper    over the base's spine, arms and head: Aim (held while aiming) and one-shots (Shoot,
//            Cough, Cheer, the Super's upper half while running)
//   additive Hit, a flinch added on top of whatever plays
// Each clip is split into its lower-body half (Hips + legs) and upper-body half, so the upper layer
// replaces the base's upper half instead of averaging with it (the mixer normalises weights).

const LOWER = /^(Hips|(Left|Right)(UpLeg|Leg|Foot|ToeBase))\./;

export class Animator {
  constructor(root, clips) {
    this.mixer = new THREE.AnimationMixer(root);
    this.clips = Object.fromEntries(clips.map(c => [c.name, c]));
    this.halves = {};  // name -> { lo, up } actions
    this.base = {};    // name -> weight of the base state
    this.upper = {};   // name -> { w, target, once }
    this.state = null; // current base state
    this.loop = 'Idle'; // loop the base returns to after a one-shot
    this.fade = 0.2;
    this.speed = 1;
    const hit = this.clips.Hit;
    if (hit) {
      const add = THREE.AnimationUtils.makeClipAdditive(hit.clone());
      this.hitAction = this.mixer.clipAction(add);
      this.hitAction.blendMode = THREE.AdditiveAnimationBlendMode;
      this.hitAction.setLoop(THREE.LoopOnce, 1);
    }
  }

  has(name) { return !!this.clips[name]; }

  half(name) {
    if (this.halves[name]) return this.halves[name];
    const c = this.clips[name];
    const make = (suffix, keep) => this.mixer.clipAction(new THREE.AnimationClip(name + suffix, c.duration,
      c.tracks.filter(t => LOWER.test(t.name) === keep)));
    return (this.halves[name] = { lo: make('_lo', true), up: make('_up', false) });
  }

  // the upper layer's own action of a clip (a Super can fade out on the base while it plays here)
  top(name) {
    const key = name + '_top';
    if (this.halves[key]) return this.halves[key];
    const c = this.clips[name];
    return (this.halves[key] = this.mixer.clipAction(new THREE.AnimationClip(key, c.duration, c.tracks.filter(t => !LOWER.test(t.name)))));
  }

  // Loop `name` as the base state (crossfades from the current one).
  setLoop(name, speed = 1) {
    if (!this.clips[name] || this.held) return;
    this.speed = speed;
    if (this.loop === name && (this.state === name || this.busy)) return;
    this.loop = name;
    if (!this.busy) this.enter(name, true);
  }

  // Full-body one-shot; back to the loop at the end (or holds the last frame: Death).
  once(name, { hold = false, fade = 0.15 } = {}) {
    if (!this.clips[name]) return false;
    this.enter(name, false, hold, fade);
    this.busy = !hold ? name : null;
    this.held = hold;
    if (hold) { // a fall: the whole body goes, arms included
      for (const n of Object.keys(this.upper)) this.top(n).stop();
      this.upper = {};
    }
    return true;
  }

  get oneShot() { return this.busy; }

  // drop the running one-shot (an idle flourish when the brawler starts moving)
  cancel() {
    if (!this.busy) return;
    this.busy = null;
    this.enter(this.loop, true);
  }

  // Show one frame of a clip, alone (dev tools / screenshots).
  pose(name, time) {
    this.mixer.stopAllAction();
    this.base = {}; this.upper = {}; this.busy = null; this.held = false;
    this.state = this.loop = null; // the next setLoop starts cleanly
    const a = this.posed = this.mixer.clipAction(this.clips[name]);
    a.reset().play();
    a.time = time;
    this.mixer.update(0);
  }

  enter(name, loop, hold = false, fade = this.fade) {
    if (this.posed) { this.posed.stop(); this.posed = null; }
    const h = this.half(name);
    for (const a of [h.lo, h.up]) {
      a.reset();
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      a.clampWhenFinished = !loop;
      a.play();
    }
    if (!(name in this.base)) this.base[name] = 0;
    this.state = name;
    this.fade = fade;
    this.hold = hold;
  }

  // Upper-body layer: aim(amount 0..1) every frame; fire(name) for one-shots.
  aim(k) {
    if (this.held) return;
    const u = this.upper.Aim || (this.upper.Aim = { w: 0, target: 0 });
    u.target = this.clips.Aim ? k : 0;
  }

  fire(name) {
    if (!this.clips[name] || this.held) return;
    const a = this.top(name);
    a.reset().setLoop(THREE.LoopOnce, 1).play();
    a.clampWhenFinished = true;
    this.upper[name] = { w: 1, target: 1, once: true };
  }

  hit() {
    if (this.hitAction) this.hitAction.reset().play();
  }

  update(dt) {
    // a finished one-shot hands over to the loop
    if (this.busy) {
      const a = this.half(this.busy).lo;
      if (a.time >= a.getClip().duration - 0.15) { this.busy = null; this.enter(this.loop, true); }
    }
    let U = 0;
    for (const [name, u] of Object.entries(this.upper)) {
      if (u.once) {
        const a = this.top(name), left = a.getClip().duration - a.time;
        u.w = Math.min(1, left / 0.12, a.time / 0.05 + 0.3);
        if (left <= 0) { a.stop(); delete this.upper[name]; continue; }
      } else {
        u.w += Math.sign(u.target - u.w) * Math.min(Math.abs(u.target - u.w), dt / 0.12);
      }
      U = Math.max(U, u.w);
    }
    // the upper one-shots cover the held aim
    const shot = Object.entries(this.upper).reduce((m, [n, u]) => (u.once ? Math.max(m, u.w) : m), 0);
    for (const [name, u] of Object.entries(this.upper)) {
      const w = u.once ? u.w : u.w * (1 - shot);
      const a = this.top(name);
      if (name === 'Aim') {
        if (w > 0 && !a.isRunning()) a.reset().setLoop(THREE.LoopRepeat, Infinity).play();
        if (w <= 0 && a.isRunning()) a.stop();
      }
      a.setEffectiveWeight(w);
    }
    for (const name of Object.keys(this.base)) {
      const target = name === this.state ? 1 : 0;
      let w = this.base[name];
      w += Math.sign(target - w) * Math.min(Math.abs(target - w), dt / Math.max(this.fade, 1e-3));
      this.base[name] = w;
      const h = this.half(name);
      if (w <= 0 && target === 0) { h.lo.stop(); h.up.stop(); delete this.base[name]; continue; }
      h.lo.setEffectiveWeight(w);
      h.up.setEffectiveWeight(w * (1 - U));
      const ts = name === this.loop && name === this.state ? this.speed : 1;
      h.lo.timeScale = h.up.timeScale = ts;
    }
    this.mixer.update(dt);
  }
}
