import { settings, set, applyQuality, bind, resetBinds, resetGroup, keyName, DEFAULTS } from './settings.js';
import { settings as audio, setVolume, setMuted, setTrack, sfx, initAudio } from './audio.js';
import { PAD } from './input.js';
import { t, LANGS } from './i18n/index.js';
import { WEB_ORIGIN } from './platform.js';

// Video-game style menus: Options (tabs of rows) + Pause, plus console-like navigation for every
// overlay in the game: ↑↓ / D-pad / left stick move the focus, ←→ change the focused option,
// Enter / A activates, Esc / B goes back, Q-E / LB-RB switch tabs.

const $ = s => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

const toggle = (key, label, hint) => ({ label, hint, type: 'choice', opts: [[false, t('opt.off')], [true, t('opt.on')]], get: () => settings[key], set: v => set(key, v) });
const choice = (key, label, opts, hint) => ({ label, hint, type: 'choice', opts, get: () => settings[key], set: v => set(key, v) });
const slider = (key, label, min, max, step, fmt, hint) => ({ label, hint, type: 'slider', min, max, step, fmt, get: () => settings[key], set: v => set(key, v) });
const vol = (ch, label) => ({
  label, type: 'slider', min: 0, max: 100, step: 5, fmt: v => `${v}%`,
  get: () => Math.round(audio[ch] * 100), set: v => { initAudio(); setVolume(ch, v / 100); },
});

const ACTIONS = ['up', 'down', 'left', 'right', 'super', 'gadget', 'emote', 'ping', 'tod', 'mute', 'panel', 'pause'];

const TIER_NAME = tier => t(`opt.${tier}`);
// "ANGLE (AMD, AMD Radeon RX 7800 XT (0x0000747E) Direct3D11 ...)" -> "AMD Radeon RX 7800 XT"
const gpuName = g => String(g || '').replace(/^ANGLE \((.*)\)$/, '$1').replace(/ Direct3D.*$/, '')
  .replace(/\s*\(0x[0-9a-f]+\)/i, '').replace(/^([^,]+), (.*\1)/i, '$2').slice(0, 48);

function tabs(ctx) {
  const aq = () => ctx.autoQuality; // set by main.js right after the menus exist
  // Graphics quality: Auto (default, autoquality.js) or a fixed preset. Shown in General and Graphics.
  const presetRow = {
    label: t('opt.preset'), type: 'choice', hint: t('opt.preset.hintAuto'),
    opts: [['auto', () => (aq() ? `${t('opt.auto')} · ${aq().label(TIER_NAME)}` : t('opt.auto'))],
      ['low', t('opt.low')], ['medium', t('opt.medium')], ['high', t('opt.high')], ['ultra', t('opt.ultra')], ['custom', t('opt.custom')]],
    get: () => settings.preset,
    set: v => { const q = aq(); if (v === 'auto' && q) q.apply(q.step, false); else if (v !== 'custom') applyQuality(v); },
  };
  const fullscreenRow = {
    label: t('opt.fullscreen'), type: 'choice', opts: [[false, t('opt.off')], [true, t('opt.on')]],
    get: () => ctx.isFullscreen(), set: v => ctx.setFullscreen(v),
  };
  const langRow = choice('lang', t('opt.language'), [['auto', t('opt.language.auto')], ...LANGS.map(([code, name]) => [code, name])], t('opt.language.hint'));
  return {
    general: {
      title: t('opt.tab.general'),
      rows: [
        langRow,
        fullscreenRow,
        toggle('fps', t('opt.fps')),
        toggle('shake', t('opt.shake')),
        toggle('colorblind', t('opt.colorblind'), t('opt.colorblind.hint')),
        presetRow,
        toggle('crashReports', t('opt.crashReports'), t('opt.crashReports.hint')),
        toggle('analytics', t('opt.analytics'), t('opt.analytics.hint')),
        { label: t('opt.privacy'), type: 'button', text: t('opt.privacy.open'), run: () => window.open(`${WEB_ORIGIN}/privacy.html`, '_blank') },
      ],
      reset: () => resetGroup(['lang', 'fps', 'shake']),
    },
    graphics: {
      title: t('opt.tab.graphics'),
      rows: [
        presetRow,
        { label: t('opt.gpu'), type: 'info', text: () => gpuName(settings.gpu) || t('opt.gpu.unknown') },
        { label: t('opt.redetect'), type: 'button', text: t('opt.detect'), hint: t('opt.preset.hintAuto'), run: () => { const q = aq(); if (q) { q.calibrate(); if (settings.preset !== 'auto') q.apply(q.step, false); } } },
        { section: t('opt.sec.display') },
        choice('art', t('opt.art'), [['cartoon', t('opt.art.cartoon')], ['realistic', t('opt.art.realistic')]], t('opt.art.hint')),
        choice('renderScale', t('opt.renderScale'), [[0.5, '50%'], [0.75, '75%'], [1, '100%'], [1.25, '125%'], [1.5, '150%']], t('opt.renderScale.hint')),
        choice('msaa', t('opt.msaa'), [[0, t('opt.off')], [2, 'MSAA 2x'], [4, 'MSAA 4x']]),
        slider('exposure', t('opt.brightness'), 0.5, 1.8, 0.05, v => v.toFixed(2)),
        choice('tod', t('opt.tod'), [['0', t('opt.tod.morning')], ['1', t('opt.tod.noon')], ['2', t('opt.tod.sunset')], ['3', t('opt.tod.night')], ['cycle', t('opt.tod.cycle')]]),
        { section: t('opt.sec.lighting') },
        choice('shadows', t('opt.shadows'), [[0, t('opt.off')], [1024, t('opt.low')], [2048, t('opt.high')], [4096, t('opt.ultra')]]),
        choice('shadowFilter', t('opt.shadowFilter'), [['pcf', t('opt.shadowFilter.pcf')], ['vsm', t('opt.shadowFilter.vsm')], ['basic', t('opt.shadowFilter.basic')]]),
        slider('softness', t('opt.softness'), 0, 8, 0.5, v => v.toFixed(1)),
        toggle('ao', t('opt.ao'), t('opt.ao.hint')),
        toggle('bloom', t('opt.bloom'), t('opt.bloom.hint')),
        toggle('dynLights', t('opt.dynLights'), t('opt.dynLights.hint')),
        choice('weather', t('opt.weather'), [[0.35, t('opt.low')], [0.7, t('opt.medium')], [1, t('opt.high')]]),
        { section: t('opt.sec.advanced') },
        toggle('fitFrustum', t('opt.fitFrustum'), t('opt.fitFrustum.hint')),
        toggle('texelSnap', t('opt.texelSnap'), t('opt.texelSnap.hint')),
        toggle('showFrustum', t('opt.showFrustum')),
        toggle('aoView', t('opt.aoView')),
        toggle('debugPanel', t('opt.debugPanel')),
      ],
      reset: () => { resetGroup(['exposure', 'tod', 'fitFrustum', 'texelSnap', 'showFrustum', 'aoView', 'debugPanel', 'dynLights']); const q = aq(); if (q) q.apply(q.step, false); else applyQuality('high'); },
    },
    audio: {
      title: t('opt.tab.audio'),
      rows: [
        vol('master', t('opt.vol.master')),
        vol('music', t('opt.vol.music')),
        vol('sfx', t('opt.vol.sfx')),
        vol('amb', t('opt.vol.amb')),
        { label: t('opt.track'), type: 'choice', opts: [['auto', t('sound.auto')], ['menu', t('sound.lobby')], ['battle', t('sound.battle')], ['off', t('opt.off')]],
          get: () => audio.track, set: v => { initAudio(); setTrack(v); } },
        { label: t('opt.muteAll'), type: 'choice', opts: [[false, t('opt.off')], [true, t('opt.on')]], get: () => audio.muted, set: v => setMuted(v) },
        { label: t('opt.testSfx'), type: 'button', text: t('opt.play'), run: () => { initAudio(); ['shotgun', 'shot', 'boom', 'pickup'].forEach((n, i) => setTimeout(() => sfx(n), i * 280)); } },
      ],
      reset: () => { setVolume('master', 0.5); setVolume('music', 0.8); setVolume('sfx', 1); setVolume('amb', 0.8); setTrack('auto'); setMuted(false); },
    },
    controls: {
      title: t('opt.tab.controls'),
      rows: [
        { section: t('opt.sec.keyboard') },
        ...ACTIONS.map(a => ({ label: t(`opt.act.${a}`), type: 'key', action: a })),
        { section: t('opt.sec.mouse') },
        { label: t('opt.aim'), type: 'info', text: t('opt.mouse.aim') },
        { label: t('opt.attack'), type: 'info', text: t('opt.mouse.attack') },
        { label: t('opt.super'), type: 'info', text: t('opt.mouse.super') },
        { label: t('opt.resetKeys'), type: 'button', text: t('opt.reset'), run: () => resetBinds() },
      ],
      reset: () => resetBinds(),
    },
    gamepad: {
      title: t('opt.tab.gamepad'),
      rows: [
        { label: t('opt.controller'), type: 'info', text: () => (ctx.input.padName ? ctx.input.padName.replace(/\(.*?\)/g, '').trim().slice(0, 40) : t('opt.noController')) },
        slider('deadzone', t('opt.deadzone'), 0.05, 0.4, 0.01, v => `${Math.round(v * 100)}%`),
        toggle('vibration', t('opt.vibration')),
        { section: t('opt.sec.layout') },
        { label: t('opt.move'), type: 'info', text: t('opt.pad.move') },
        { label: t('opt.aim'), type: 'info', text: t('opt.pad.aim') },
        { label: t('opt.attack'), type: 'info', text: t('opt.pad.attack') },
        { label: t('opt.super'), type: 'info', text: t('opt.pad.super') },
        { label: t('opt.tod'), type: 'info', text: 'Y' },
        { label: t('opt.pause'), type: 'info', text: 'Start' },
        { label: t('opt.menus'), type: 'info', text: t('opt.pad.menus') },
      ],
      reset: () => resetGroup(['deadzone', 'vibration']),
    },
  };
}

export class Menus {
  constructor(ctx) {
    this.ctx = ctx; // { input, onResume, onQuit, isInMatch }
    this.tabs = tabs(ctx);
    this.tab = 'general';
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
    for (const [k, tab] of Object.entries(this.tabs)) {
      const b = el('button', 'opt-tab', tab.title);
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
      const lbl = r.opts[i][1];
      const val = el('b', '', typeof lbl === 'function' ? lbl() : lbl);
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
      return el('span', 'opt-key' + (listening ? ' listening' : ''), listening ? t('opt.pressKey') : `<kbd>${keyName(settings.binds[r.action])}</kbd>`);
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
    $('#pauseNote').textContent = this.ctx.isOnline() ? t('pause.online') : '';
    this.ctx.onPause(true);
    this.focusFirst($('#pause'));
  }

  closePause() { $('#pause').classList.add('hidden'); this.ctx.onPause(false); }

  pauseAction(a) {
    sfx('click');
    if (a === 'resume') this.closePause();
    if (a === 'options') this.openOptions('#pause');
    if (a === 'quit') { this.closePause(); this.ctx.onQuit(); }
    if (a === 'bug' && this.ctx.onBug) this.ctx.onBug();
  }

  /* ------------------------------ navigation ------------------------------ */

  activeOverlay() {
    for (const id of ['#levelUp', '#options', '#pause', '#result', '#lobby', '#meta', '#mapsPop', '#menu']) {
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
    if (!$('#levelUp').classList.contains('hidden')) { $('#luOk').click(); return true; }
    if (this.optionsOpen) { this.closeOptions(); return true; }
    if (this.paused) { this.closePause(); return true; }
    const root = this.activeOverlay();
    if (root && ['meta', 'menu', 'mapsPop'].includes(root.id) && this.ctx.closePage && this.ctx.closePage()) return true; // a page, the map picker
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
      else if (root && (root.id === 'meta' || root.id === 'mapsPop')) this.back();
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
