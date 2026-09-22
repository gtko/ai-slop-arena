import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Lighting, PRESETS } from './lighting.js';
import { LightPool } from './effects.js';
import { Game } from './game.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { TYPES } from './brawler.js';
import { makeRoster, randomMap } from './game.js';
import { MAPS } from './maps.js';
import { Net, randomCode } from './net.js';
import { VisionFog } from './visionfog.js';
import { initAudio, playMusic, setAmbience, sfx, toggleMute, setVolume, setMuted, setTrack, settings as audio } from './audio.js';
import { loadTextures, ASSET_BASE } from './assets.js';
import { shared } from './materials.js';
import { settings, set as setSetting, onChange } from './settings.js';
import { Menus } from './menu.js';
import { OUTLINES } from './models.js';
import { PAD } from './input.js';
import './style.css';

const $ = s => document.querySelector(s);

/* ------------------------------ renderer ------------------------------ */

const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const DPR = Math.min(devicePixelRatio, 1.5);
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.info.autoReset = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.5, 260);

const lighting = new Lighting(renderer, scene);
const lights = new LightPool(scene, 12);
const hud = new Hud();
const input = new Input(canvas);
const game = new Game({ scene, camera, lighting, lights, hud, input });

/* ------------------------------ post-processing ------------------------------ */
// HDR (half float) + 4x MSAA target -> GTAO contact shadows -> bloom -> tone map.

const target = new THREE.WebGLRenderTarget(innerWidth * DPR, innerHeight * DPR, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, target);
composer.addPass(new RenderPass(scene, camera));

const gtao = new GTAOPass(scene, camera, innerWidth * DPR, innerHeight * DPR);
gtao.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1.4, thickness: 2.0, scale: 1.3, samples: 16 });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 12 });
gtao.blendIntensity = 1;
// Keep particles, decals, rings and gas out of the AO normal/depth pre-pass.
const hideFx = gtao._overrideVisibility.bind(gtao);
gtao._overrideVisibility = () => {
  hideFx();
  for (const g of [game.fx, game.arena && game.arena.halos, ...OUTLINES]) {
    if (g && g.visible) { g.visible = false; gtao._visibilityCache.push(g); }
  }
  if (lighting.helper && lighting.helper.visible) { lighting.helper.visible = false; gtao._visibilityCache.push(lighting.helper); }
};
composer.addPass(gtao);
const visionFog = new VisionFog(); // limited field of view on fog maps, before bloom so lights glow through
composer.addPass(visionFog.pass);

const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.5, 1.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

/* ------------------------------ settings -> engine ------------------------------ */

const BASE_DPR = Math.min(devicePixelRatio, 1.5);
function applySetting(k) {
  const v = settings[k];
  switch (k) {
    case 'renderScale': {
      const pr = Math.max(0.4, BASE_DPR * v);
      renderer.setPixelRatio(pr);
      composer.setPixelRatio(pr);
      composer.setSize(innerWidth, innerHeight);
      break;
    }
    case 'msaa':
      for (const rt of [composer.renderTarget1, composer.renderTarget2]) { rt.samples = v; rt.dispose(); }
      break;
    case 'shadows': lighting.setShadowSize(v); break;
    case 'shadowFilter': lighting.setFilter(v); break;
    case 'softness': lighting.setSoftness(v); break;
    case 'fitFrustum': lighting.follow = v; break;
    case 'texelSnap': lighting.snap = v; break;
    case 'showFrustum': lighting.showFrustum(v); break;
    case 'ao': gtao.enabled = v; break;
    case 'aoView': gtao.output = v ? GTAOPass.OUTPUT.AO : GTAOPass.OUTPUT.Default; break;
    case 'bloom': bloom.enabled = v; break;
    case 'dynLights': lights.enabled = v; break;
    case 'weather': game.weatherDensity = v; if (game.weather) game.weather.setDensity(v); break;
    case 'exposure': lighting.exposureMul = v; break;
    case 'tod':
      lighting.cycle = v === 'cycle';
      if (v !== 'cycle') lighting.setPreset(+v);
      break;
    case 'shake': game.shakeEnabled = v; break;
    case 'fps': $('#fpsBadge').classList.toggle('hidden', !v); break;
    case 'debugPanel': $('#panel').classList.toggle('off', !v); break;
  }
  syncPanel();
}

/* ------------------------------ lighting debug panel (mirrors the settings) ------------------------------ */

const panel = $('#panel');
const togglePanel = () => panel.classList.toggle('collapsed');
$('#panelToggle').addEventListener('click', togglePanel);

function syncPanel() {
  document.querySelectorAll('[data-tod]').forEach(b => b.classList.toggle('on', b.dataset.tod === settings.tod));
  $('#cycle').checked = settings.tod === 'cycle';
  $('#shadowQ').value = String(settings.shadows);
  $('#shadowF').value = settings.shadowFilter;
  $('#soft').value = settings.softness; $('#softOut').textContent = settings.softness;
  $('#follow').checked = settings.fitFrustum; $('#snap').checked = settings.texelSnap; $('#snap').disabled = !settings.fitFrustum;
  $('#frustum').checked = settings.showFrustum;
  $('#ao').checked = settings.ao; $('#aoView').checked = settings.aoView;
  $('#bloom').checked = settings.bloom; $('#dyn').checked = settings.dynLights;
  $('#exp').value = settings.exposure; $('#expOut').textContent = (+settings.exposure).toFixed(2);
}
const syncTod = syncPanel;
document.querySelectorAll('[data-tod]').forEach(b => b.addEventListener('click', () => setSetting('tod', b.dataset.tod)));
$('#cycle').addEventListener('change', e => setSetting('tod', e.target.checked ? 'cycle' : String(Math.round(lighting.t) % 4)));
$('#shadowQ').addEventListener('change', e => setSetting('shadows', +e.target.value));
$('#shadowF').addEventListener('change', e => setSetting('shadowFilter', e.target.value));
$('#soft').addEventListener('input', e => setSetting('softness', +e.target.value));
$('#follow').addEventListener('change', e => setSetting('fitFrustum', e.target.checked));
$('#snap').addEventListener('change', e => setSetting('texelSnap', e.target.checked));
$('#frustum').addEventListener('change', e => setSetting('showFrustum', e.target.checked));
$('#ao').addEventListener('change', e => setSetting('ao', e.target.checked));
$('#aoView').addEventListener('change', e => setSetting('aoView', e.target.checked));
$('#bloom').addEventListener('change', e => setSetting('bloom', e.target.checked));
$('#dyn').addEventListener('change', e => setSetting('dynLights', e.target.checked));
$('#exp').addEventListener('input', e => setSetting('exposure', +e.target.value));

onChange(k => { applySetting(k); if (k !== 'binds') menus && menus.optionsOpen && menus.render(); });

/* ------------------------------ sound menu ------------------------------ */

const soundRoot = $('#sound'), soundPanel = $('#soundPanel'), soundBtn = $('#soundBtn');
function soundOpen(on = soundPanel.classList.contains('hidden')) {
  soundPanel.classList.toggle('hidden', !on);
  soundBtn.setAttribute('aria-expanded', on);
}
function syncSound() {
  soundRoot.classList.toggle('muted', audio.muted);
  $('#muteAll').checked = audio.muted;
  soundPanel.querySelectorAll('.vol input').forEach(r => {
    r.value = Math.round(audio[r.dataset.ch] * 100);
    r.nextElementSibling.textContent = r.value;
  });
  soundPanel.querySelectorAll('[data-track]').forEach(b => b.classList.toggle('on', b.dataset.track === audio.track));
}
soundBtn.addEventListener('click', () => { initAudio(); soundOpen(); });
$('#soundClose').addEventListener('click', () => soundOpen(false));
soundPanel.querySelectorAll('.vol input').forEach(r => r.addEventListener('input', () => {
  setVolume(r.dataset.ch, r.value / 100);
  r.nextElementSibling.textContent = r.value;
}));
soundPanel.querySelectorAll('.vol input').forEach(r => r.addEventListener('change', () => {
  if (r.dataset.ch === 'sfx' || r.dataset.ch === 'master') sfx('pickup'); // preview the new level
}));
soundPanel.querySelectorAll('[data-track]').forEach(b => b.addEventListener('click', () => {
  initAudio(); setTrack(b.dataset.track); sfx('click'); syncSound();
}));
$('#muteAll').addEventListener('change', e => { setMuted(e.target.checked); syncSound(); });
$('#soundTest').addEventListener('click', () => {
  initAudio();
  ['shotgun', 'shot', 'boom', 'pickup'].forEach((n, i) => setTimeout(() => sfx(n), i * 280));
});
// Keys pressed while adjusting a slider must not also move the brawler.
soundPanel.addEventListener('keydown', e => { if (e.code !== 'Escape' && e.code !== 'KeyM') e.stopPropagation(); });
syncSound();

/* ------------------------------ menu / result ------------------------------ */

const menus = new Menus({
  input,
  isInMatch: () => game.mode === 'play' && !$('#hud').classList.contains('hidden'),
  isOnline: () => !!game.net,
  onPause: p => { game.paused = p; },
  onQuit: () => { if (game.net) { net.close(); history.replaceState(null, '', location.pathname); } toMenu(); },
});
$('#optionsBtn').addEventListener('click', () => { sfx('click'); menus.openOptions('#menu'); });

let chosen = localStorage.getItem('iaslop-brawler') || 'blaster';
let chosenMap = 'random';
const MAP_ICON = { clear: '☀️', sandstorm: '🌪️', rain: '🌧️', snow: '❄️', fog: '🌫️' };
const portrait = key => `${ASSET_BASE}ui/${key}.png`;

const cards = $('#cards');
for (const T of Object.values(TYPES)) {
  const c = document.createElement('button');
  c.className = 'card' + (T.key === chosen ? ' on' : '');
  c.dataset.key = T.key;
  const hex = '#' + T.palette.main.toString(16).padStart(6, '0');
  c.innerHTML = `<span class="portrait" style="--c:${hex}"><img src="${portrait(T.key)}" alt="" onerror="this.remove()"></span><b>${T.name}</b><em>${T.role}</em>
    <p>${T.desc}</p><span class="stat">HP ${T.hp} · Range ${T.range}</span>`;
  c.addEventListener('click', () => { sfx('click'); pickBrawler(T.key); });
  cards.appendChild(c);
}

function pickBrawler(key) {
  chosen = key;
  try { localStorage.setItem('iaslop-brawler', key); } catch { /* private mode */ }
  document.querySelectorAll('[data-key]').forEach(x => x.classList.toggle('on', x.dataset.key === key));
  if (net.connected) net.send({ t: 'pick', brawler: key });
}

// Map chips (menu + lobby share the markup builder).
function buildMaps(root, onPick) {
  root.innerHTML = '';
  const add = (key, name, tag, a, b, icon) => {
    const m = document.createElement('button');
    m.className = 'map';
    m.dataset.map = key;
    m.style.setProperty('--a', a); m.style.setProperty('--b', b);
    if (key !== 'random') m.style.backgroundImage = `linear-gradient(rgba(0,0,0,0) 35%, rgba(0,0,0,0.6)), url(${ASSET_BASE}ui/map_${key}.jpg), linear-gradient(135deg, ${a}, ${b})`;
    m.innerHTML = `<i>${icon}</i><b>${name}</b><em>${tag}</em>`;
    m.addEventListener('click', () => { sfx('click'); onPick(key); });
    root.appendChild(m);
  };
  add('random', 'Random', 'Surprise me', '#6a5acd', '#2b2244', '🎲');
  for (const [key, M] of Object.entries(MAPS)) add(key, M.name, M.tag, M.swatch[0], M.swatch[1], MAP_ICON[M.weather]);
}
const syncMaps = (root, key) => root.querySelectorAll('.map').forEach(m => m.classList.toggle('on', m.dataset.map === key));
buildMaps($('#maps'), key => { chosenMap = key; syncMaps($('#maps'), key); });
syncMaps($('#maps'), chosenMap);
const resolveMap = key => (key === 'random' || !MAPS[key] ? randomMap() : key);

/* ---- solo ---- */

function play() {
  initAudio();
  sfx('click');
  playMusic('battle');
  $('#menu').classList.add('hidden');
  $('#result').classList.add('hidden');
  hud.show(true);
  const mapKey = resolveMap(chosenMap);
  playMusic('m_' + mapKey);
  game.newMatch({ mapKey, roster: makeRoster([{ id: 'me', name: 'YOU', type: chosen }]), localId: 'me' });
  canvas.focus();
}
function attract() { game.newMatch({ mapKey: randomMap() }); }
function toMenu() {
  $('#result').classList.add('hidden');
  $('#lobby').classList.add('hidden');
  $('#menu').classList.remove('hidden');
  hud.show(false);
  sfx('click');
  playMusic('menu');
  attract();
}
$('#play').addEventListener('click', play);
$('#again').addEventListener('click', play);
$('#toMenu').addEventListener('click', toMenu);

/* ---- online (Cloudflare Durable Object rooms, see worker/index.js) ---- */

const net = new Net();
let lobbyMap = 'random';
const nick = $('#nick');
nick.value = localStorage.getItem('iaslop-name') || '';
const status = msg => { $('#lobbyStatus').textContent = msg || ''; };

function openLobby() {
  initAudio();
  sfx('click');
  $('#menu').classList.add('hidden');
  $('#lobby').classList.remove('hidden');
  showRoomView(net.connected);
}
function showRoomView(inRoom) {
  $('#lobbyJoin').classList.toggle('hidden', inRoom);
  $('#lobbyRoom').classList.toggle('hidden', !inRoom);
}
async function joinRoom(code) {
  const name = nick.value.trim() || 'Brawler';
  try { localStorage.setItem('iaslop-name', name); } catch { /* ignore */ }
  status('Connecting…');
  try {
    await net.connect(code, name, chosen);
    status('');
    sfx('join');
    history.replaceState(null, '', `?room=${net.code}`);
    showRoomView(true);
  } catch (e) {
    status(`${e.message}. Is the room server running? (npm run dev:server)`);
  }
}
$('#multi').addEventListener('click', openLobby);
$('#create').addEventListener('click', () => joinRoom(randomCode()));
$('#join').addEventListener('click', () => { const c = $('#code').value.trim().toUpperCase(); if (c.length >= 4) joinRoom(c); else status('Enter a 4-letter room code.'); });
$('#code').addEventListener('keydown', e => { if (e.code === 'Enter') $('#join').click(); e.stopPropagation(); });
nick.addEventListener('keydown', e => e.stopPropagation());
$('#lobbyBack').addEventListener('click', () => { net.close(); history.replaceState(null, '', location.pathname); status(''); toMenu(); });
$('#copyLink').addEventListener('click', async () => {
  const link = `${location.origin}${location.pathname}?room=${net.code}`;
  try { await navigator.clipboard.writeText(link); status('Invite link copied!'); } catch { status(link); }
});

// brawler picker inside the room
const lobbyCards = $('#lobbyCards');
for (const T of Object.values(TYPES)) {
  const b = document.createElement('button');
  b.dataset.key = T.key;
  b.className = T.key === chosen ? 'on' : '';
  b.innerHTML = `<img src="${portrait(T.key)}" alt="">${T.name}`;
  b.addEventListener('click', () => { sfx('click'); pickBrawler(T.key); });
  lobbyCards.appendChild(b);
}
buildMaps($('#lobbyMaps'), key => {
  if (!net.isHost) return;
  lobbyMap = key;
  net.send({ t: 'map', map: key });
  syncMaps($('#lobbyMaps'), key);
});

let lastCount = 0;
net.on('room', m => {
  $('#roomCode').textContent = net.code;
  const ul = $('#players');
  ul.innerHTML = '';
  for (const p of m.players) {
    const li = document.createElement('li');
    li.innerHTML = `<img src="${portrait(p.brawler)}" alt=""><span class="${p.id === net.id ? 'you' : ''}"></span>${p.host ? '<span class="crown">HOST</span>' : ''}`;
    li.children[1].textContent = p.id === net.id ? `${p.name} (you)` : p.name;
    ul.appendChild(li);
  }
  for (let k = m.players.length; k < 8; k++) {
    const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'Bot'; ul.appendChild(li);
  }
  if (m.players.length > lastCount && lastCount) sfx('join');
  lastCount = m.players.length;
  const host = net.isHost;
  lobbyMap = m.map || lobbyMap;
  syncMaps($('#lobbyMaps'), lobbyMap);
  $('#lobbyMaps').querySelectorAll('.map').forEach(b => { b.disabled = !host; });
  $('#mapNote').textContent = host ? '(you pick)' : '(host picks)';
  $('#start').classList.toggle('hidden', !host);
  $('#waiting').classList.toggle('hidden', host);
  $('#waiting').textContent = m.inMatch ? 'Match in progress, you will join the next one…' : 'Waiting for the host to start…';
  // host ended the match -> everyone back to the room
  if (!m.inMatch && game.net) backToRoom();
});

function startOnline(mapKey, roster, role) {
  playMusic('m_' + mapKey);
  $('#lobby').classList.add('hidden');
  $('#result').classList.add('hidden');
  hud.show(true);
  game.newMatch({ mapKey, roster, localId: net.id, net: { role, send: msg => net.send(msg) } });
  canvas.focus();
}
$('#start').addEventListener('click', () => {
  if (!net.isHost) return;
  sfx('click');
  const roster = makeRoster(net.players.map(p => ({ id: p.id, name: p.name, type: p.brawler })));
  const mapKey = resolveMap(lobbyMap);
  net.send({ t: 'start', map: mapKey, roster });
  startOnline(mapKey, roster, 'host');
});
net.on('start', m => startOnline(m.map, m.roster, 'client'));
net.on('in', m => game.onInput(m));
net.on('snap', m => game.applySnap(m));
net.on('ev', m => game.applyEvents(m.list));
net.on('left', m => game.onLeft(m.id));
net.on('hostLeft', () => { backToRoom(); status('The host left, the match was cancelled.'); });
net.on('closed', () => { if (game.net) backToRoom(); showRoomView(false); status('Disconnected from the room.'); });

function backToRoom() {
  $('#result').classList.add('hidden');
  hud.show(false);
  $('#lobby').classList.remove('hidden');
  showRoomView(net.connected);
  playMusic('menu');
  attract();
}
game.onMatchEnd = () => { if (game.net && game.net.role === 'host') net.send({ t: 'end' }); else backToRoom(); };
$('#spectate').addEventListener('click', () => $('#result').classList.add('hidden'));

game.onResult = (rank, won) => {
  playMusic(null);
  sfx(won ? 'victory' : 'defeat');
  $('#resTitle').textContent = won ? 'VICTORY!' : `#${rank}`;
  $('#resTitle').className = won ? 'win' : '';
  $('#resSub').textContent = won ? 'Last brawler standing.' : `You were knocked out. ${rank - 1} brawler${rank - 1 === 1 ? '' : 's'} left standing.`;
  $('#soloBtns').classList.toggle('hidden', !!game.net);
  $('#onlineBtns').classList.toggle('hidden', !game.net);
  $('#result').classList.remove('hidden');
};

const nextTimeOfDay = () => setSetting('tod', String((Math.round(lighting.target) + 1) % 4));
addEventListener('keydown', e => {
  if (input.captureKey || (e.target && e.target.tagName === 'INPUT' && e.target.type === 'text')) return;
  const B = settings.binds;
  if (e.code === B.tod) nextTimeOfDay();
  if (e.code === B.panel) { if (!settings.debugPanel) setSetting('debugPanel', true); else togglePanel(); }
  if (e.code === B.mute) { toggleMute(); syncSound(); }
  if (e.code === 'Escape') soundOpen(false);
});

/* ------------------------------ loop ------------------------------ */

const timer = new THREE.Timer();
timer.connect(document); // pause-safe: no giant delta after the tab was hidden
const stats = $('#stats');
let fpsAcc = 0, fpsN = 0, statT = 0;

// Browsers only allow audio after a user gesture: start the lobby music on the first one.
const unlockAudio = () => { initAudio(); if ($('#hud').classList.contains('hidden')) playMusic('menu'); };
addEventListener('pointerdown', unlockAudio, { once: true });
addEventListener('keydown', unlockAudio, { once: true });

await loadTextures(renderer);
for (const k of Object.keys(settings)) applySetting(k);
lighting.setPreset(settings.tod === 'cycle' ? 2 : +settings.tod, true);
attract();
// invite links: ?room=CODE opens the lobby straight away
const invited = new URLSearchParams(location.search).get('room');
if (invited) { openLobby(); $('#code').value = invited.toUpperCase(); }

renderer.setAnimationLoop(ts => {
  timer.update(ts);
  const dt = Math.min(timer.getDelta(), 0.05);
  renderer.info.reset();
  input.poll();
  menus.update(dt);
  if (input.padHit(PAD.Y)) nextTimeOfDay();
  if (input.padHit(PAD.BACK)) setSetting('debugPanel', !settings.debugPanel);
  game.update(dt);
  // Sun direction/colour in view space for the foliage rim + translucency term.
  shared.sunDirView.value.copy(lighting.sunDir).transformDirection(camera.matrixWorldInverse);
  shared.sunColor.value.copy(lighting.sun.color).multiplyScalar(lighting.sun.intensity);
  setAmbience(lighting.night);
  visionFog.update(dt, camera, game.visionRadius || 0, game.visionCenter, scene.fog.color, game.time);
  bloom.strength = lighting.bloom;
  composer.render(dt);

  fpsAcc += dt; fpsN++; statT += dt;
  if (statT > 0.5) {
    const fps = Math.round(fpsN / fpsAcc);
    if (settings.fps) $('#fpsBadge').textContent = `${fps} FPS`;
    stats.innerHTML = `
      <span>${fps} fps</span><span>${renderer.info.render.calls} draws</span>
      <span>${lights.used}/${lights.size} lights (${lights.candidates} emitters)</span>
      <span>shadow texel ${(lighting.texelSize * 100).toFixed(1)} cm</span>
      <span>${PRESETS[Math.floor(lighting.t) % 4].name} → ${PRESETS[(Math.floor(lighting.t) + 1) % 4].name} ${(lighting.t % 1 * 100).toFixed(0)}%</span>`;
    fpsAcc = 0; fpsN = 0; statT = 0;
  }
});

// The game owns a render loop + WebGL context, so never hot-swap modules in place.
if (import.meta.hot) import.meta.hot.on('vite:beforeUpdate', () => location.reload());

// Dev-only handle for poking at the scene from the console (stripped from production builds).
if (import.meta.env.DEV) window.__arena = { game, lighting, lights, renderer, composer, scene, camera, menus, input, settings };
