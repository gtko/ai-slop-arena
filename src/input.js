import * as THREE from 'three';
import { settings } from './settings.js';

// Standard gamepad layout (Xbox naming; PlayStation: A=Cross, B=Circle, X=Square, Y=Triangle).
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

export class Input {
  constructor(el) {
    this.keys = new Set();
    this.pressed = new Set();
    this.ndc = new THREE.Vector2(0, -0.2);
    this.lmb = false;
    this.rmb = false;
    this.rmbReleased = false;
    // gamepad
    this.pad = null;
    this.padName = '';
    this.btn = new Array(17).fill(false);
    this.btnPrev = new Array(17).fill(false);
    this.stickL = new THREE.Vector2();
    this.stickR = new THREE.Vector2();
    this.usingPad = false;
    this.captureKey = null; // set by the options menu while rebinding a key
    this.touch = null;      // filled by TouchControls (touch.js) on touch screens
    this.usingTouch = false;

    addEventListener('keydown', e => {
      if (this.captureKey) return;
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.usingPad = this.usingTouch = false;
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.lmb = this.rmb = false; });
    el.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') return; // touch screens use the virtual sticks
      this.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this.usingPad = this.usingTouch = false;
    });
    el.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') return;
      if (e.button === 0) this.lmb = true;
      if (e.button === 2) this.rmb = true;
      this.usingPad = this.usingTouch = false;
    });
    addEventListener('pointerup', e => {
      if (e.pointerType === 'touch') return;
      if (e.button === 0) { this.lmb = false; this.tapT = performance.now(); }
      if (e.button === 2) { if (this.rmb) this.rmbReleased = true; this.rmb = false; }
    });
    el.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('gamepadconnected', e => { this.padName = e.gamepad.id; });
    addEventListener('gamepaddisconnected', () => { this.pad = null; this.padName = ''; });
  }

  /* ------------------------------ keyboard / mouse ------------------------------ */

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  // bound actions (see settings.binds)
  held(action) { return this.keys.has(settings.binds[action]); }
  hitAction(action) { return this.pressed.has(settings.binds[action]); }

  /* ------------------------------ gamepad ------------------------------ */

  // Call once per frame, before anything reads the pad.
  poll() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find(p => p && p.connected) || null;
    this.pad = gp;
    for (let i = 0; i < this.btn.length; i++) this.btnPrev[i] = this.btn[i];
    if (!gp) { this.btn.fill(false); this.stickL.set(0, 0); this.stickR.set(0, 0); return; }
    this.padName = gp.id;
    let active = false;
    for (let i = 0; i < this.btn.length; i++) {
      const b = gp.buttons[i];
      this.btn[i] = !!b && (b.pressed || b.value > 0.5);
      if (this.btn[i]) active = true;
    }
    const dz = settings.deadzone;
    const stick = (v, x, y) => {
      v.set(x || 0, y || 0);
      const l = v.length();
      // radial dead zone, rescaled so movement starts smoothly just outside it
      if (l < dz) v.set(0, 0); else v.multiplyScalar(Math.min(1, (l - dz) / (1 - dz)) / l);
      return v.lengthSq() > 0;
    };
    if (stick(this.stickL, gp.axes[0], gp.axes[1])) active = true;
    if (stick(this.stickR, gp.axes[2], gp.axes[3])) active = true;
    if (active) { this.usingPad = true; this.usingTouch = false; }
  }

  padHeld(i) { return this.btn[i]; }
  padHit(i) { return this.btn[i] && !this.btnPrev[i]; }
  padReleased(i) { return !this.btn[i] && this.btnPrev[i]; }

  // Gamepad rumble, or on a touch screen a short vibration (Android; iOS web views have none).
  // every: minimum ms between two of these calls (a fast burst of hits buzzes once).
  rumble(strong, weak, ms, every = 0) {
    if (!settings.vibration) return;
    const now = performance.now();
    if (every && now - (this.rumbleT || 0) < every) return;
    this.rumbleT = now;
    const act = this.pad && this.pad.vibrationActuator;
    if (act) {
      try { act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }); } catch { /* unsupported */ }
    } else if (this.usingTouch && navigator.vibrate) {
      try { navigator.vibrate(Math.max(8, Math.round(ms * Math.max(strong, weak) * 0.6))); } catch { /* blocked */ }
    }
  }

  /* ------------------------------ combined ------------------------------ */

  // Movement from bound keys, arrows and the left stick (length <= 1).
  move(out) {
    const x = (this.held('right') || this.down('ArrowRight') ? 1 : 0) - (this.held('left') || this.down('ArrowLeft') ? 1 : 0)
      + (this.btn[PAD.RIGHT] ? 1 : 0) - (this.btn[PAD.LEFT] ? 1 : 0) + this.stickL.x;
    const z = (this.held('down') || this.down('ArrowDown') ? 1 : 0) - (this.held('up') || this.down('ArrowUp') ? 1 : 0)
      + (this.btn[PAD.DOWN] ? 1 : 0) - (this.btn[PAD.UP] ? 1 : 0) + this.stickL.y;
    const T = this.touch;
    out.set(x + (T ? T.move.x : 0), 0, z + (T ? T.move.y : 0));
    if (out.lengthSq() > 1) out.normalize();
    return out;
  }

  // A click still counts for 120 ms after its release (input buffer): a quick tap during the
  // reload fires as soon as the weapon is ready instead of being lost.
  get attackHeld() { return this.lmb || this.btn[PAD.RT] || performance.now() - (this.tapT || -1e9) < 120 || (!!this.touch && this.touch.fireUntil > performance.now()); }
  get superAimHeld() { return this.rmb || this.btn[PAD.LT] || (!!this.touch && this.touch.superAiming); }
  get superFired() {
    return this.hitAction('super') || this.rmbReleased || this.padHit(PAD.RB) || this.padReleased(PAD.LT) || (!!this.touch && this.touch.superFired);
  }

  endFrame() {
    this.pressed.clear();
    this.rmbReleased = false;
    if (this.touch) this.touch.superFired = false;
  }
}
