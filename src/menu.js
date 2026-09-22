import { settings, set, applyQuality, bind, resetBinds, resetGroup, keyName, DEFAULTS } from './settings.js';
import { settings as audio, setVolume, setMuted, setTrack, sfx, initAudio } from './audio.js';
import { PAD } from './input.js';

// Video-game style menus: Options (tabs of rows) + Pause, plus console-like navigation for every
// overlay in the game: ↑↓ / D-pad / left stick move the focus, ←→ change the focused option,
// Enter / A activates, Esc / B goes back, Q-E / LB-RB switch tabs.

const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

const toggle = (key, label, hint) => ({ label, hint, type: 'choice', opts: [[false, 'Off'], [true, 'On']], get: () => settings[key], set: v => set(key, v) });
const choice = (key, label, opts, hint) => ({ label, hint, type: 'choice', opts, get: () => settings[key], set: v => set(key, v) });
const slider = (key, label, min, max, step, fmt, hint) => ({ label, hint, type: 'slider', min, max, step, fmt, get: () => settings[key], set: v => set(key, v) });
const vol = (ch, label) => ({
  label, type: 'slider', min: 0, max: 100, step: 5, fmt: v => `${v}%`,
  get: () => Math.round(audio[ch] * 100), set: v => { initAudio(); setVolume(ch, v / 100); },
});

const ACTIONS = [
  ['up', 'Move up'], ['down', 'Move down'], ['left', 'Move left'], ['right', 'Move right'],
  ['super', 'Super'], ['tod', 'Next time of day'], ['mute', 'Mute'], ['panel', 'Lighting debug panel'], ['pause', 'Pause / back'],
];

function tabs(ctx) {
  return {
    graphics: {
      title: 'Graphics',
      rows: [
        { label: 'Quality preset', type: 'choice', opts: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra'], ['custom', 'Custom']],
          get: () => settings.preset, set: v => { if (v !== 'custom') applyQuality(v); }, hint: 'Sets resolution, AA, shadows, AO, bloom and weather at once.' },
        { section: 'Display' },
        choice('art', 'Art style', [['cartoon', 'Cartoon'], ['realistic', 'Realistic']], 'Cartoon: soft cel shading and vivid colours. Changing it reloads the game.'),
        choice('renderScale', 'Render resolution', [[0.5, '50%'], [0.75, '75%'], [1, '100%'], [1.25, '125%'], [1.5, '150%']], 'Lower = faster, higher = sharper.'),
        choice('msaa', 'Anti-aliasing', [[0, 'Off'], [2, 'MSAA 2x'], [4, 'MSAA 4x']]),
        slider('exposure', 'Brightness', 0.5, 1.8, 0.05, v => v.toFixed(2)),
        choice('tod', 'Time of day', [['0', 'Morning'], ['1', 'Noon'], ['2', 'Sunset'], ['3', 'Night'], ['cycle', 'Day / night cycle']]),
        { section: 'Lighting & shadows' },
        choice('shadows', 'Shadow quality', [[0, 'Off'], [1024, 'Low'], [2048, 'High'], [4096, 'Ultra']]),
        choice('shadowFilter', 'Shadow filter', [['pcf', 'Soft (PCF)'], ['vsm', 'Very soft (VSM)'], ['basic', 'Hard']]),
        slider('softness', 'Shadow softness', 0, 8, 0.5, v => v.toFixed(1)),
        toggle('ao', 'Ambient occlusion', 'Contact shadows in corners and under objects (GTAO).'),
        toggle('bloom', 'Bloom', 'Glow around lanterns, projectiles and explosions.'),
        toggle('dynLights', 'Dynamic lights', 'Projectiles, torches and explosions light the scene.'),
        choice('weather', 'Weather particles', [[0.35, 'Low'], [0.7, 'Medium'], [1, 'High']]),
        { section: 'Gameplay & interface' },
        toggle('shake', 'Camera shake'),
        toggle('fps', 'FPS counter'),
        { section: 'Advanced' },
        toggle('fitFrustum', 'Camera-fitted shadows', 'Sharper shadows: the shadow map only covers what you see.'),
        toggle('texelSnap', 'Shadow texel snapping', 'Stops shadow edges shimmering while the camera moves.'),
        toggle('showFrustum', 'Show shadow frustum'),
        toggle('aoView', 'View AO buffer only'),
        toggle('debugPanel', 'Lighting debug panel'),
      ],
      reset: () => applyQuality('high') || resetGroup(['exposure', 'tod', 'shake', 'fps', 'fitFrustum', 'texelSnap', 'showFrustum', 'aoView', 'debugPanel', 'dynLights']),
    },
    audio: {
      title: 'Audio',
      rows: [
        vol('master', 'Master volume'),
        vol('music', 'Music'),
        vol('sfx', 'Sound effects'),
        vol('amb', 'Ambience & weather'),
        { label: 'Music track', type: 'choice', opts: [['auto', 'Auto'], ['menu', 'Lobby'], ['battle', 'Battle'], ['off', 'Off']],
          get: () => audio.track, set: v => { initAudio(); setTrack(v); } },
        { label: 'Mute everything', type: 'choice', opts: [[false, 'Off'], [true, 'On']], get: () => audio.muted, set: v => setMuted(v) },
        { label: 'Test sound effects', type: 'button', text: '▶ Play', run: () => { initAudio(); ['shotgun', 'shot', 'boom', 'pickup'].forEach((n, i) => setTimeout(() => sfx(n), i * 280)); } },
      ],
      reset: () => { setVolume('master', 1); setVolume('music', 0.8); setVolume('sfx', 1); setVolume('amb', 0.8); setTrack('auto'); setMuted(false); },
    },
    controls: {
      title: 'Controls',
      rows: [
        { section: 'Keyboard (select a row, then press the new key)' },
        ...ACTIONS.map(([a, label]) => ({ label, type: 'key', action: a })),
        { section: 'Mouse (fixed)' },
        { label: 'Aim', type: 'info', text: 'Mouse cursor' },
        { label: 'Attack', type: 'info', text: 'Left click (hold)' },
        { label: 'Super', type: 'info', text: 'Right click: hold to aim, release to fire' },
        { label: 'Reset key bindings', type: 'button', text: 'Reset', run: () => resetBinds() },
      ],
      reset: () => resetBinds(),
    },
    gamepad: {
      title: 'Gamepad',
      rows: [
        { label: 'Controller', type: 'info', text: () => (ctx.input.padName ? ctx.input.padName.replace(/\(.*?\)/g, '').trim().slice(0, 40) : 'None detected: press any button') },
        slider('deadzone', 'Stick dead zone', 0.05, 0.4, 0.01, v => `${Math.round(v * 100)}%`),
        toggle('vibration', 'Vibration'),
        { section: 'Layout' },
        { label: 'Move', type: 'info', text: 'Left stick / D-pad' },
        { label: 'Aim', type: 'info', text: 'Right stick (tilt = throw distance)' },
        { label: 'Attack', type: 'info', text: 'RT (hold)' },
        { label: 'Super', type: 'info', text: 'RB, or hold LT to aim and release' },
        { label: 'Time of day', type: 'info', text: 'Y' },
        { label: 'Pause', type: 'info', text: 'Start' },
        { label: 'Menus', type: 'info', text: 'D-pad / stick · A select · B back · LB / RB tabs' },
      ],
      reset: () => resetGroup(['deadzone', 'vibration']),
    },
  };
}

export class Menus {
  constructor(ctx) {
    this.ctx = ctx; // { input, onResume, onQuit, isInMatch }
    this.tabs = tabs(ctx);
    this.tab = 'graphics';
    this.optionsOpen = false;
    this.returnTo = null;
    this.capture = null;
    this.repeat = { dir: null, t: 0 };
    this.buildTabs();
    this.render();

    $('#optClose').addEventListener('click', () => this.closeOptions());
    $('#optReset').addEventListener('click', () => { sfx('click'); this.tabs[this.tab].reset(); this.render(); });
    for (const b of document.querySelectorAll('#pause [data-act]')) b.addEventListener('click', () => this.pauseAction(b.dataset.act));
    addEventListener('keydown', e => this.onKey(e), true);
  }

  /* ------------------------------ options ------------------------------ */

  buildTabs() {
    const nav = $('#optTabs');
    nav.innerHTML = '';
    for (const [k, t] of Object.entries(this.tabs)) {
      const b = el('button', 'opt-tab', t.title);
      b.dataset.tab = k;
      b.addEventListener('click', () => { sfx('click'); this.setTab(k); });
      nav.appendChild(b);
    }
  }

  setTab(k) {
    this.tab = k;
    this.render();
    const first = $('#optBody .opt-row');
    if (first) first.focus();
  }

  cycleTab(d) {
    const keys = Object.keys(this.tabs);
    this.setTab(keys[(keys.indexOf(this.tab) + d + keys.length) % keys.length]);
    sfx('click');
  }

  render() {
    document.querySelectorAll('.opt-tab').forEach(b => b.classList.toggle('on', b.dataset.tab === this.tab));
    const body = $('#optBody'), focused = document.activeElement && document.activeElement.dataset.idx;
    body.innerHTML = '';
    this.tabs[this.tab].rows.forEach((r, idx) => {
      if (r.section) { body.appendChild(el('div', 'opt-section', r.section)); return; }
      const row = el('div', 'opt-row');
      row.tabIndex = 0;
      row.dataset.idx = idx;
      row.appendChild(el('span', 'opt-label', r.label));
      row.appendChild(this.control(r));
      if (r.hint) row.title = r.hint;
      row.addEventListener('mouseenter', () => row.focus({ preventScroll: true }));
      row.addEventListener('focus', () => { $('#optHint').textContent = r.hint || ''; });
      row.addEventListener('click', e => { if (e.target === row || e.target.classList.contains('opt-label')) this.activate(r); });
      body.appendChild(row);
    });
    if (focused !== undefined) { const f = body.querySelector(`[data-idx="${focused}"]`); if (f) f.focus({ preventScroll: true }); }
  }

  control(r) {
    if (r.type === 'choice') {
      const cur = r.get(), i = Math.max(0, r.opts.findIndex(o => o[0] === cur));
      const w = el('span', 'opt-choice');
      const prev = el('button', 'arr', '◀'), next = el('button', 'arr', '▶');
      prev.tabIndex = next.tabIndex = -1;
      prev.addEventListener('click', e => { e.stopPropagation(); this.step(r, -1); });
      next.addEventListener('click', e => { e.stopPropagation(); this.step(r, 1); });
      const val = el('b', '', r.opts[i][1]);
      const dots = el('span', 'dots', r.opts.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join(''));
      w.append(prev, val, next, dots);
      return w;
    }
    if (r.type === 'slider') {
      const v = r.get(), f = (v - r.min) / (r.max - r.min);
      const w = el('span', 'opt-slider');
      const bar = el('span', 'bar', `<span class="fill" style="width:${(f * 100).toFixed(1)}%"></span>`);
      bar.addEventListener('pointerdown', e => {
        const move = ev => {
          const rect = bar.getBoundingClientRect(), k = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
          r.set(+(Math.round((r.min + k * (r.max - r.min)) / r.step) * r.step).toFixed(3));
          this.render();
        };
        move(e);
        const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
      });
      w.append(bar, el('b', '', r.fmt ? r.fmt(v) : v));
      return w;
    }
    if (r.type === 'key') {
      const listening = this.capture === r.action;
      return el('span', 'opt-key' + (listening ? ' listening' : ''), listening ? 'Press a key… (Esc cancels)' : `<kbd>${keyName(settings.binds[r.action])}</kbd>`);
    }
    if (r.type === 'button') {
      const b = el('button', 'opt-btn', r.text);
      b.tabIndex = -1;
      b.addEventListener('click', e => { e.stopPropagation(); sfx('click'); r.run(); this.render(); });
      return b;
    }
    return el('span', 'opt-info', typeof r.text === 'function' ? r.text() : r.text);
  }

  step(r, d) {
    if (r.type === 'choice') {
      const cur = r.get(), i = Math.max(0, r.opts.findIndex(o => o[0] === cur));
      let n = (i + d + r.opts.length) % r.opts.length;
      if (r.opts[n][0] === 'custom') n = (n + d + r.opts.length) % r.opts.length; // "custom" is a state, not a pick
      r.set(r.opts[n][0]);
    } else if (r.type === 'slider') {
      r.set(+Math.min(r.max, Math.max(r.min, r.get() + d * r.step)).toFixed(3));
    } else return;
    sfx('click');
    this.render();
  }

  activate(r) {
    if (r.type === 'key') { this.capture = r.action; this.ctx.input.captureKey = r.action; this.render(); return; }
    if (r.type === 'button') { sfx('click'); r.run(); this.render(); return; }
    if (r.type === 'choice') this.step(r, 1);
  }

  openOptions(from) {
    this.returnTo = from || null;
    this.optionsOpen = true;
    for (const id of ['#menu', '#pause', '#lobby']) if (!$(id).classList.contains('hidden')) { this.returnTo = id; $(id).classList.add('hidden'); }
    $('#options').classList.remove('hidden');
    this.render();
    const first = $('#optBody .opt-row');
    if (first) first.focus();
  }

  closeOptions() {
    sfx('click');
    this.optionsOpen = false;
    this.capture = null; this.ctx.input.captureKey = null;
    $('#options').classList.add('hidden');
    if (this.returnTo) { $(this.returnTo).classList.remove('hidden'); this.focusFirst($(this.returnTo)); }
  }

  /* ------------------------------ pause ------------------------------ */

  get paused() { return !$('#pause').classList.contains('hidden'); }

  openPause() {
    $('#pause').classList.remove('hidden');
    $('#pauseNote').textContent = this.ctx.isOnline() ? 'Online match: the game keeps running.' : '';
    this.ctx.onPause(true);
    this.focusFirst($('#pause'));
  }

  closePause() { $('#pause').classList.add('hidden'); this.ctx.onPause(false); }

  pauseAction(a) {
    sfx('click');
    if (a === 'resume') this.closePause();
    if (a === 'options') this.openOptions('#pause');
    if (a === 'quit') { this.closePause(); this.ctx.onQuit(); }
  }

  /* ------------------------------ navigation ------------------------------ */

  activeOverlay() {
    for (const id of ['#options', '#pause', '#result', '#lobby', '#menu']) {
      const o = $(id);
      if (o && !o.classList.contains('hidden')) return o;
    }
    return null;
  }

  focusables(root) {
    return [...root.querySelectorAll('button, input, .opt-row, [tabindex="0"]')]
      .filter(e => e.tabIndex >= 0 && !e.disabled && e.offsetParent !== null && !e.closest('.hidden'));
  }

  focusFirst(root) {
    const f = this.focusables(root)[0];
    if (f) f.focus({ preventScroll: true });
  }

  // Move focus to the nearest element in a direction (spatial navigation).
  move(root, dx, dy) {
    const items = this.focusables(root);
    const cur = document.activeElement;
    if (!items.includes(cur)) { if (items[0]) items[0].focus(); return; }
    const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestS = Infinity;
    for (const it of items) {
      if (it === cur) continue;
      const b = it.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const ddx = bx - ax, ddy = by - ay, along = ddx * dx + ddy * dy;
      if (along <= 4) continue;
      const across = Math.abs(ddx * dy) + Math.abs(ddy * dx);
      const s = along + across * 2.5;
      if (s < bestS) { bestS = s; best = it; }
    }
    if (best) { best.focus({ preventScroll: false }); best.scrollIntoView({ block: 'nearest' }); sfx('click'); }
  }

  nav(dir) {
    const root = this.activeOverlay();
    if (!root) return false;
    const cur = document.activeElement;
    if (root.id === 'options' && cur && cur.classList.contains('opt-row') && (dir === 'left' || dir === 'right')) {
      this.step(this.tabs[this.tab].rows[+cur.dataset.idx], dir === 'left' ? -1 : 1);
      return true;
    }
    const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
    this.move(root, d[0], d[1]);
    return true;
  }

  confirm() {
    const cur = document.activeElement, root = this.activeOverlay();
    if (!root || !cur || !root.contains(cur)) { if (root) this.focusFirst(root); return; }
    if (cur.classList.contains('opt-row')) this.activate(this.tabs[this.tab].rows[+cur.dataset.idx]);
    else if (cur.tagName === 'INPUT') cur.focus();
    else cur.click();
  }

  // returns true when the event was consumed
  back() {
    if (this.optionsOpen) { this.closeOptions(); return true; }
    if (this.paused) { this.closePause(); return true; }
    const root = this.activeOverlay();
    if (root && root.id === 'lobby') { $('#lobbyBack').click(); return true; }
    if (root && root.id === 'result' && this.ctx.isOnline()) { $('#result').classList.add('hidden'); return true; }
    return false;
  }

  onKey(e) {
    // rebinding: grab the next key, whatever it is
    if (this.capture) {
      e.preventDefault(); e.stopPropagation();
      if (e.code !== 'Escape') { bind(this.capture, e.code); sfx('click'); }
      this.capture = null; this.ctx.input.captureKey = null;
      this.render();
      return;
    }
    const root = this.activeOverlay();
    const typing = e.target && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox' && e.target.type !== 'range';
    if (e.code === settings.binds.pause || e.code === 'Escape') {
      if (this.back()) { e.preventDefault(); e.stopPropagation(); return; }
      if (!root && this.ctx.isInMatch()) { this.openPause(); e.preventDefault(); e.stopPropagation(); }
      return;
    }
    if (!root || typing) return;
    const dirs = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
    if (dirs[e.code]) { e.preventDefault(); e.stopPropagation(); this.nav(dirs[e.code]); return; }
    if (e.code === 'Enter' && document.activeElement && document.activeElement.classList.contains('opt-row')) {
      e.preventDefault(); e.stopPropagation(); this.confirm(); return;
    }
    if (root.id === 'options' && (e.code === 'KeyQ' || e.code === 'KeyE')) { e.preventDefault(); this.cycleTab(e.code === 'KeyQ' ? -1 : 1); }
  }

  // Gamepad: call every frame after input.poll().
  update(dt) {
    const I = this.ctx.input, root = this.activeOverlay();
    if (I.padHit(PAD.START)) {
      if (this.paused || this.optionsOpen) this.back();
      else if (!root && this.ctx.isInMatch()) this.openPause();
      else if (root && root.id === 'menu') $('#play').click();
      return;
    }
    if (!root) { this.repeat.dir = null; return; }
    if (I.padHit(PAD.A)) this.confirm();
    if (I.padHit(PAD.B)) this.back();
    if (root.id === 'options') {
      if (I.padHit(PAD.LB)) this.cycleTab(-1);
      if (I.padHit(PAD.RB)) this.cycleTab(1);
    }
    if (this.optionsOpen && this.tab === 'gamepad') {
      this.infoT = (this.infoT || 0) - dt;
      if (this.infoT <= 0) { this.infoT = 1; const f = document.activeElement && document.activeElement.dataset.idx; if (f === undefined) this.render(); }
    }
    // D-pad / left stick with key-repeat
    const s = I.stickL;
    let dir = null;
    if (I.padHeld(PAD.UP) || s.y < -0.6) dir = 'up';
    else if (I.padHeld(PAD.DOWN) || s.y > 0.6) dir = 'down';
    else if (I.padHeld(PAD.LEFT) || s.x < -0.6) dir = 'left';
    else if (I.padHeld(PAD.RIGHT) || s.x > 0.6) dir = 'right';
    if (!dir) { this.repeat.dir = null; return; }
    if (dir !== this.repeat.dir) { this.repeat.dir = dir; this.repeat.t = 0.38; this.nav(dir); return; }
    this.repeat.t -= dt;
    if (this.repeat.t <= 0) { this.repeat.t = 0.11; this.nav(dir); }
  }
}

export { DEFAULTS };
