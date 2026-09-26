import * as THREE from 'three';

// Touch controls (phones, tablets, Steam Deck touchscreen), Brawl Stars style:
//   left half of the screen  : floating joystick, appears where the thumb lands, moves the brawler
//   attack stick (right)     : tap = shoot at the nearest enemy, drag = aim, release = shoot
//   super button (above it)  : lights up when charged, drag to aim, release to fire
//   pause button (top)       : the Esc of touch screens
// It only fills input.touch; Input and Game read it like the mouse and the gamepad.

export const isTouchDevice = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1 && !matchMedia('(pointer: fine)').matches;

const TAP_MS = 220, DRAG = 0.22, R = 58; // stick radius in px

export class TouchControls {
  constructor(input, { onPause } = {}) {
    this.input = input;
    const T = input.touch = {
      move: new THREE.Vector2(),     // left stick, length <= 1
      aim: new THREE.Vector2(),      // attack or super stick while dragged
      aiming: false,                 // attack stick dragged past the dead zone
      superAiming: false,
      fireUntil: 0,                  // attack "held" until then (a release is a short press)
      autoAim: false,                // tap: aim at the nearest enemy
      superFired: false,
      gadgetFired: false,
      superReady: false,
    };
    this.T = T;
    const root = this.root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `
      <div class="t-zone t-left"></div>
      <div class="t-stick t-move hidden"><i></i></div>
      <div class="t-btn t-attack"><i></i></div>
      <div class="t-btn t-super"><i></i><b>SUPER</b></div>
      <div class="t-btn t-gadget"><i></i><span class="t-pips"><u></u><u></u><u></u></span></div>
      <button class="t-pause" aria-label="Pause"><span></span><span></span></button>`;
    document.querySelector('#hud').appendChild(root);
    this.moveStick = root.querySelector('.t-move');
    this.attackBtn = root.querySelector('.t-attack');
    this.superBtn = root.querySelector('.t-super');
    this.gadgetBtn = root.querySelector('.t-gadget');
    this.gadgetBtn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.touched(); this.T.gadgetFired = true; });
    root.querySelector('.t-pause').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (onPause) onPause(); });

    this.bindMove(root.querySelector('.t-left'));
    this.bindAim(this.attackBtn, false);
    this.bindAim(this.superBtn, true);
    document.body.classList.add('touch');
    input.usingTouch = true; // until a mouse, keyboard or gamepad takes over
  }

  setSuperLabel(text) { this.superBtn.querySelector('b').textContent = text; }

  // Floating joystick: centred where the finger lands.
  bindMove(zone) {
    let id = null, ox = 0, oy = 0;
    const knob = this.moveStick.querySelector('i');
    zone.addEventListener('pointerdown', e => {
      if (id !== null) return;
      id = e.pointerId; ox = e.clientX; oy = e.clientY;
      try { zone.setPointerCapture(id); } catch { /* synthetic or already released */ }
      this.moveStick.style.left = `${ox}px`; this.moveStick.style.top = `${oy}px`;
      this.moveStick.classList.remove('hidden');
      knob.style.transform = '';
      this.touched();
    });
    zone.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      const v = this.stick(e.clientX - ox, e.clientY - oy, knob);
      this.T.move.copy(v);
    });
    const end = e => {
      if (e.pointerId !== id) return;
      id = null;
      this.T.move.set(0, 0);
      this.moveStick.classList.add('hidden');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  // Attack / super: a fixed button that turns into an aiming stick while held.
  bindAim(btn, isSuper) {
    let id = null, ox = 0, oy = 0, t0 = 0, dragged = false;
    const knob = btn.querySelector('i');
    btn.addEventListener('pointerdown', e => {
      if (id !== null || (isSuper && !this.T.superReady)) return;
      e.preventDefault();
      id = e.pointerId; t0 = performance.now(); dragged = false;
      const r = btn.getBoundingClientRect();
      ox = r.left + r.width / 2; oy = r.top + r.height / 2;
      try { btn.setPointerCapture(id); } catch { /* synthetic or already released */ }
      btn.classList.add('held');
      this.touched();
    });
    btn.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      const v = this.stick(e.clientX - ox, e.clientY - oy, knob);
      if (v.length() > DRAG) dragged = true;
      if (!dragged) return;
      this.T.aim.copy(v);
      if (isSuper) this.T.superAiming = true; else this.T.aiming = true;
    });
    const end = (e, cancel) => {
      if (e.pointerId !== id) return;
      id = null;
      btn.classList.remove('held');
      knob.style.transform = '';
      const tap = !dragged && performance.now() - t0 < TAP_MS * 3;
      if (!cancel && (dragged || tap)) {
        if (!dragged) this.T.autoAim = true; // quick tap: nearest enemy
        if (isSuper) this.T.superFired = true;
        else this.T.fireUntil = performance.now() + 200; // long enough for the 20 Hz client input tick, and a 120 ms buffer
      }
      if (isSuper) this.T.superAiming = false; else this.T.aiming = false;
    };
    btn.addEventListener('pointerup', e => end(e, false));
    btn.addEventListener('pointercancel', e => end(e, true));
  }

  stick(dx, dy, knob) {
    const l = Math.hypot(dx, dy), k = l > R ? R / l : 1;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    return _v.set(dx * k / R, dy * k / R);
  }

  touched() {
    this.input.usingTouch = true;
    this.input.usingPad = false;
  }

  // Per frame: super button state.
  update(player) {
    const ready = !!player && player.alive && player.superCharge >= 1;
    this.T.superReady = ready;
    this.superBtn.classList.toggle('ready', ready);
    this.superBtn.style.setProperty('--charge', player ? Math.min(1, player.superCharge) : 0);
    const n = player ? player.gadgetCharges : 0, busy = !player || !player.alive || n <= 0 || player.gadgetCd > 0;
    this.gadgetBtn.classList.toggle('off', busy);
    this.gadgetBtn.querySelectorAll('u').forEach((u, k) => u.classList.toggle('on', k < n));
  }
}
const _v = new THREE.Vector2();
