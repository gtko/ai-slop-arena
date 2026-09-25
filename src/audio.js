import { ASSET_BASE } from './assets.js';

// Sampled SFX / music / ambience (generated with ElevenLabs, see art-src/gen_audio.py),
// with the old procedural WebAudio synth as a fallback for anything missing or still loading.
let ctx = null, master = null, sfxBus = null, musicBus = null, ambBus = null, noise = null;
const buffers = {};

// User mix (0..1 each), persisted per browser. BASE is the internal balance between buses.
const BASE = { master: 0.8, sfx: 0.55, music: 0.28, amb: 0.5 };
// Master starts at 50%: at 100% the first notes were far too loud.
const DEFAULTS = { master: 0.5, music: 0.8, sfx: 1, amb: 0.8, muted: false, track: 'auto', v: 2 };
export const settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('brawl-arena-audio') || '{}')); } catch { /* private mode */ }
const save = () => { try { localStorage.setItem('brawl-arena-audio', JSON.stringify(settings)); } catch { /* ignore */ } };
// Mixes saved before v2 had master at 100% by default: bring them down to 50% once.
if (settings.v !== 2) { settings.master = Math.min(settings.master, 0.5); settings.v = 2; save(); }
let muted = settings.muted;
const last = {};
// The result jingle (the victory fanfare is a whole song) plays until the next song starts.
const JINGLES = ['fanfare', 'victory', 'defeat'];
let jingle = null;

const SFX = ['shot', 'shotgun', 'throw', 'boom', 'boom_big', 'hit', 'hurt', 'break', 'crate', 'pickup',
  'super', 'ready', 'death', 'gas', 'victory', 'defeat', 'click', 'thunder', 'thunder2', 'join',
  // v0.11 sound pass (ElevenLabs): per-brawler shots, hit confirm, KO, match stings, footsteps, voice barks
  'shot_ray', 'shot_ice', 'shot_zap', 'hit_confirm', 'ko', 'sting_three', 'sting_duel', 'heartbeat', 'immune',
  'step_sand', 'step_grass', 'step_snow', 'step_stone', 'step_mud',
  ...['blaster', 'gunslinger', 'bomber', 'frostbite', 'volt'].flatMap(k => [`bark_${k}_super`, `bark_${k}_cheer`])];
const LOOPS = {
  amb_day: 'music/amb_day', amb_night: 'music/amb_night',
  amb_rain: 'music/amb_rain', amb_storm: 'music/amb_storm', amb_snow: 'music/amb_snow', amb_marsh: 'music/amb_marsh',
  fanfare: 'music/victory',
};
// Songs (Lyria 3 Pro, art-src/gen_music.py) stream from <audio> elements instead of being decoded
// up front: a 3-minute song decoded takes ~60 MB of RAM. Each game moment has a playlist; a song
// that ends hands over to the next one, so a long match does not loop the same 2 minutes.
const PLAYLISTS = {
  menu: ['menu', 'menu2'],
  lobby: ['lobby', 'menu2', 'menu'],
  battle: ['battle', 'battle2'],
  final: ['final'],
};
const BEDS = ['amb_rain', 'amb_storm', 'amb_snow', 'amb_marsh'];
let weatherBed = null;
const GAIN = { shot: 0.5, hit: 0.7, hurt: 0.8, click: 0.6, victory: 0.9, defeat: 0.9, gas: 0.6,
  shot_ray: 0.45, shot_ice: 0.5, shot_zap: 0.5, hit_confirm: 0.75, ko: 0.8, heartbeat: 0.9, sting_three: 0.7, sting_duel: 0.75 };

export function initAudio() {
  if (ctx) { ctx.resume(); return; }
  setTimeout(() => setWeatherBed(weatherBed), 0);
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.connect(master);
  // music -> duck (own super, KOs) -> low-pass (low health: the world goes muffled) -> master
  musicDuck = ctx.createGain();
  musicLP = ctx.createBiquadFilter(); musicLP.type = 'lowpass'; musicLP.frequency.value = 20000;
  musicBus = ctx.createGain(); musicBus.connect(musicDuck).connect(musicLP).connect(master);
  ambBus = ctx.createGain(); ambBus.connect(master);
  applyMix(true);
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const fetchBuf = (name, path) => fetch(`${ASSET_BASE}${path}.mp3`)
    .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
    .then(a => ctx.decodeAudioData(a))
    .then(b => { buffers[name] = b; onLoaded(name); })
    .catch(() => console.warn('audio missing, using synth fallback:', path));
  for (const n of SFX) fetchBuf(n, 'sfx/' + n);
  for (const [n, p] of Object.entries(LOOPS)) fetchBuf(n, p);
}

function applyMix(instant = false) {
  if (!ctx) return;
  const set = (node, v) => (instant ? (node.gain.value = v) : node.gain.setTargetAtTime(v, ctx.currentTime, 0.04));
  set(master, muted ? 0 : BASE.master * settings.master);
  set(sfxBus, BASE.sfx * settings.sfx);
  set(musicBus, BASE.music * settings.music);
  set(ambBus, BASE.amb * settings.amb);
}

// channel: 'master' | 'music' | 'sfx' | 'amb', value 0..1
export function setVolume(channel, value) {
  settings[channel] = value;
  save();
  applyMix();
}

export function setMuted(m) {
  muted = settings.muted = m;
  save();
  applyMix();
  return muted;
}
export function toggleMute() { return setMuted(!muted); }

// 'auto' follows the game (lobby / battle), or force 'menu', 'battle' or 'off'.
export function setTrack(track) {
  settings.track = track;
  save();
  playMusic(wantMusic);
}

/* ------------------------------ loops ------------------------------ */

const loops = {}; // name -> { src, gain, target }
let wantMusic = null;
const amb = { day: 0, night: 0 };

function startLoop(name, bus) {
  if (loops[name] || !buffers[name]) return loops[name];
  const src = ctx.createBufferSource(), gain = ctx.createGain();
  src.buffer = buffers[name];
  src.loop = true;
  gain.gain.value = 0;
  src.connect(gain).connect(bus);
  src.start();
  return (loops[name] = { src, gain });
}

function fade(name, to, time = 1.2) {
  const l = loops[name];
  if (l) l.gain.gain.setTargetAtTime(to, ctx.currentTime, time / 3);
}

function onLoaded(name) {
  if (name === weatherBed) setWeatherBed(weatherBed);
  if (name === 'amb_day' || name === 'amb_night') setAmbience(amb.night, true);
}

/* ------------------------------ music ------------------------------ */

const songs = {}; // name -> { el, gain }
let song = null, playlist = [], songIdx = 0;

function songNode(name) {
  if (songs[name]) return songs[name];
  const el = new Audio(`${ASSET_BASE}music/${name}.mp3`);
  el.preload = 'auto';
  const gain = ctx.createGain();
  gain.gain.value = 0;
  ctx.createMediaElementSource(el).connect(gain).connect(musicBus);
  el.addEventListener('ended', () => { if (song === name) nextSong(); });
  return (songs[name] = { el, gain });
}

// Crossfade to another song (null = silence); the old one pauses once faded out.
function switchSong(name) {
  if (song === name) return;
  const old = song && songs[song];
  if (old) {
    old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
    const was = song;
    setTimeout(() => { if (song !== was) old.el.pause(); }, 2500);
  }
  song = name;
  if (!name) return;
  const s = songNode(name);
  if (s.el.ended || s.el.currentTime > s.el.duration - 5) s.el.currentTime = 0;
  s.el.play().catch(() => { /* before the first user gesture: initAudio retries */ });
  s.gain.gain.setTargetAtTime(1, ctx.currentTime, 0.4);
}

function nextSong() {
  if (!playlist.length) return;
  songIdx = (songIdx + 1) % playlist.length;
  const name = playlist[songIdx];
  if (name === song) { songs[name].el.currentTime = 0; songs[name].el.play().catch(() => {}); } else switchSong(name);
}

// What the game wants: 'menu', 'lobby', 'battle', 'm_<map>' (that map's theme first), 'final'
// (last 3 brawlers) or null. The user's track setting (Options > Audio) can override it.
export function playMusic(name) {
  wantMusic = name;
  if (name) stopJingle();
  if (!ctx) return;
  const t = settings.track;
  const want = t === 'auto' ? name : t === 'off' ? null : t;
  let list = [];
  if (want && want.startsWith('m_')) list = amb.night > 0.6 ? ['night', want, 'battle2'] : [want, 'battle', 'battle2'];
  else if (want) list = PLAYLISTS[want] || [want];
  if (list.join() === playlist.join()) { if (song && songs[song].el.paused) songs[song].el.play().catch(() => {}); return; }
  playlist = list;
  songIdx = 0;
  switchSong(list[0] || null);
}

// Ambience follows the lighting: birds and wind by day, crickets and torch crackle at night.
export function setAmbience(night, force = false) {
  if (!ctx) { amb.night = night; return; }
  if (!force && Math.abs(night - amb.night) < 0.01) return;
  amb.night = night;
  // The generated beds are mastered quietly (night ~-43 dBFS RMS), hence the > 1 gains.
  // A weather bed (rain, storm...) pushes the day/night bed back.
  const under = weatherBed ? 0.35 : 1;
  if (startLoop('amb_day', ambBus)) fade('amb_day', (1 - night) * 1.6 * under, 0.6);
  if (startLoop('amb_night', ambBus)) fade('amb_night', night * 3.2 * under, 0.6);
}

// Weather ambience loop for the current map (null = none).
export function setWeatherBed(name) {
  weatherBed = name;
  if (!ctx) return;
  for (const b of BEDS) {
    if (b === name) { startLoop(b, ambBus); fade(b, 1.4, 1.5); } else fade(b, 0, 1.5);
  }
  setAmbience(amb.night, true);
}

/* ------------------------------ mix moments ------------------------------ */

let musicDuck = null, musicLP = null, danger = 0;

// Music dips by 6 dB for a moment (your super, your KOs), back over `sec`.
export function duckMusic(sec = 0.6) {
  if (!ctx) return;
  const g = musicDuck.gain, now = ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setTargetAtTime(0.5, now, 0.05);
  g.setTargetAtTime(1, now + 0.15, sec / 3);
}

// Low health (0..1): the music closes down to a 1200 Hz low-pass.
export function setDanger(v) {
  if (!ctx || Math.abs(v - danger) < 0.01) return;
  danger = v;
  musicLP.frequency.setTargetAtTime(20000 * Math.pow(1200 / 20000, v), ctx.currentTime, 0.25);
}

/* ------------------------------ one-shots ------------------------------ */

// rate: playback speed (the hit-confirm ladder rises in pitch); 1 = a small random jitter
export function sfx(name, vol = 1, rate = 1) {
  if (!ctx || vol < 0.03) return;
  if (name === 'victory' && buffers.fanfare) name = 'fanfare';
  const now = ctx.currentTime;
  if (last[name] && now - last[name] < 0.035) return;
  last[name] = now;
  const buf = buffers[name];
  if (buf) {
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf;
    src.playbackRate.value = rate !== 1 ? rate : 0.94 + Math.random() * 0.12; // small pitch jitter so repeats don't machine-gun
    g.gain.value = vol * (GAIN[name] ?? 1);
    src.connect(g).connect(sfxBus);
    src.start(now);
    if (JINGLES.includes(name)) { stopJingle(); jingle = { src, g }; src.onended = () => { if (jingle && jingle.src === src) jingle = null; }; }
    return;
  }
  synth(FALLBACK[name] || name, vol);
}
const FALLBACK = { shot_ray: 'shot', shot_ice: 'shot', shot_zap: 'shot', hit_confirm: 'hit', ko: 'death' };

// Fades out the result jingle still playing, if any (new match, back to the menu...).
function stopJingle() {
  if (!jingle || !ctx) return;
  const { src, g } = jingle, now = ctx.currentTime;
  jingle = null;
  g.gain.cancelScheduledValues(now);
  g.gain.setValueAtTime(g.gain.value, now);
  g.gain.linearRampToValueAtTime(0, now + 0.3);
  src.stop(now + 0.32);
}

function tone(f0, f1, dur, type, vol) {
  const now = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, now);
  o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), now + dur);
  g.gain.setValueAtTime(vol, now);
  g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
  o.connect(g).connect(sfxBus);
  o.start(now);
  o.stop(now + dur + 0.02);
}

function burst(dur, freq, vol, type = 'lowpass') {
  const now = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noise;
  f.type = type;
  f.frequency.value = freq;
  g.gain.setValueAtTime(vol, now);
  g.gain.exponentialRampToValueAtTime(0.0008, now + dur);
  s.connect(f).connect(g).connect(sfxBus);
  s.start(now, Math.random() * 0.5);
  s.stop(now + dur);
}

function synth(name, vol) {
  switch (name) {
    case 'shot': burst(0.07, 2600, 0.3 * vol, 'bandpass'); tone(900, 380, 0.06, 'square', 0.05 * vol); break;
    case 'shotgun': burst(0.2, 1300, 0.55 * vol); tone(170, 55, 0.16, 'sine', 0.45 * vol); break;
    case 'throw': tone(320, 640, 0.12, 'triangle', 0.14 * vol); break;
    case 'boom': case 'boom_big': burst(0.7, 520, 0.9 * vol); tone(95, 28, 0.55, 'sine', 0.8 * vol); break;
    case 'hit': tone(540, 250, 0.06, 'square', 0.08 * vol); break;
    case 'hurt': tone(220, 120, 0.12, 'sawtooth', 0.14 * vol); break;
    case 'break': case 'crate': burst(0.35, 900, 0.55 * vol); tone(120, 60, 0.2, 'triangle', 0.3 * vol); break;
    case 'pickup': tone(660, 1320, 0.14, 'triangle', 0.22 * vol); break;
    case 'super': tone(220, 880, 0.3, 'sawtooth', 0.12 * vol); burst(0.25, 2400, 0.25 * vol, 'highpass'); break;
    case 'ready': case 'click': tone(880, 1760, 0.12, 'sine', 0.2 * vol); break;
    case 'death': tone(420, 70, 0.55, 'sawtooth', 0.18 * vol); burst(0.4, 700, 0.3 * vol); break;
    case 'gas': tone(80, 60, 0.6, 'sine', 0.25 * vol); break;
    case 'victory': tone(523, 1046, 0.5, 'triangle', 0.3 * vol); break;
    case 'defeat': tone(330, 110, 0.8, 'triangle', 0.3 * vol); break;
    case 'heartbeat': tone(80, 48, 0.1, 'sine', 0.55 * vol); setTimeout(() => tone(72, 44, 0.12, 'sine', 0.4 * vol), 170); break;
  }
}
