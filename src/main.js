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
import { Net, randomCode, serverError } from './net.js';
import { SteamNet } from './steamnet.js';
import { Matchmaking } from './matchmaking.js';
import { isDesktop, isPackagedApp, desktop, steam, steamInfo, epic, presence, WEB_ORIGIN } from './platform.js';
import { achievements } from './achievements.js';
import { t, translateDom } from './i18n/index.js';
import { TouchControls, isTouchDevice } from './touch.js';
import { AutoQuality } from './autoquality.js';
import { VisionFog } from './visionfog.js';
import { initAudio, playMusic, setAmbience, sfx, toggleMute, setVolume, setMuted, setTrack, settings as audio } from './audio.js';
import { loadTextures, ASSET_BASE, TEX_FILES } from './assets.js';
import { shared } from './materials.js';
import { settings, set as setSetting, onChange } from './settings.js';
import { Menus } from './menu.js';
import { OUTLINES } from './models.js';
import { preloadFigurines } from './figurines.js';
import { preloadProps, PROPS } from './props.js';
import { enableCartoonShading, cartoonGradePass } from './cartoon.js';
import { PAD } from './input.js';
import './style.css';

translateDom();

const $ = s => document.querySelector(s);
const CARTOON = settings.art === 'cartoon';
if (CARTOON) enableCartoonShading(); // must run before any material compiles

/* ------------------------------ renderer ------------------------------ */

const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const DPR = Math.min(devicePixelRatio, 1.5);
renderer.setPixelRatio(DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// Neutral keeps cartoon colours saturated; ACES rolls highlights off more photographically.
renderer.toneMapping = CARTOON ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
renderer.info.autoReset = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.5, 260);

const lighting = new Lighting(renderer, scene);
if (CARTOON) lighting.style = { hemi: 1.45, env: 0.55, exposure: 0.95, sun: 0.9 };
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
if (CARTOON) composer.addPass(cartoonGradePass());
composer.addPass(new OutputPass());

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

/* ------------------------------ settings -> engine ------------------------------ */

const BASE_DPR = Math.min(devicePixelRatio, 1.5);
const BOOT_LANG = settings.lang; // the page is translated once, a change reloads it
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
    case 'art': if ((v === 'cartoon') !== CARTOON) setTimeout(() => location.reload(), 150); break;
    case 'lang': if (v !== BOOT_LANG) setTimeout(() => location.reload(), 150); break;
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
  // General tab: fullscreen through the desktop shell, else the browser's Fullscreen API
  isFullscreen: () => (isDesktop ? innerWidth === screen.width && innerHeight === screen.height : !!document.fullscreenElement),
  setFullscreen: v => {
    if (isDesktop) desktop.fullscreen(v).then(() => menus.render());
    else if (v) document.documentElement.requestFullscreen?.().then(() => menus.render()).catch(() => {});
    else document.exitFullscreen?.().then(() => menus.render()).catch(() => {});
  },
  onQuit: () => { if (game.net) { net.close(); history.replaceState(null, '', location.pathname); } toMenu(); },
});
// Automatic graphics quality (preset "auto"): GPU guess, then follows the measured frame rate.
const autoQuality = new AutoQuality(renderer);
menus.ctx.autoQuality = autoQuality;
// Phones and tablets: virtual sticks + pause button (touch.js).
const touch = isTouchDevice ? new TouchControls(input, { onPause: () => { if (!menus.paused && game.mode === 'play') menus.openPause(); } }) : null;
if (touch) touch.setSuperLabel(t('hud.super'));

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
  c.innerHTML = `<span class="portrait" style="--c:${hex}"><img src="${portrait(T.key)}" alt="" onerror="this.remove()"></span><b>${T.name}</b><em>${t(`brawler.${T.key}.role`)}</em>
    <p>${t(`brawler.${T.key}.desc`)}</p><span class="stat">${t('card.stat', { hp: T.hp, range: T.range })}</span>`;
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
  add('random', t('map.random'), t('map.random.tag'), '#6a5acd', '#2b2244', '🎲');
  for (const [key, M] of Object.entries(MAPS)) add(key, t(`map.${key}`), t(`map.${key}.tag`), M.swatch[0], M.swatch[1], MAP_ICON[M.weather]);
}
const syncMaps = (root, key) => root.querySelectorAll('.map').forEach(m => m.classList.toggle('on', m.dataset.map === key));
buildMaps($('#maps'), key => { chosenMap = key; syncMaps($('#maps'), key); });
syncMaps($('#maps'), chosenMap);
const resolveMap = key => (key === 'random' || !MAPS[key] ? randomMap() : key);

/* ---- solo ---- */

function play() {
  initAudio();
  sfx('click');
  $('#menu').classList.add('hidden');
  $('#result').classList.add('hidden');
  hud.show(true);
  const mapKey = resolveMap(chosenMap);
  playMusic('m_' + mapKey);
  finalMusic = false;
  game.newMatch({ mapKey, roster: makeRoster([{ id: 'me', name: t('hud.you'), type: chosen }]), localId: 'me' });
  achievements.matchStart({ mapKey, brawler: chosen });
  presence(t('presence.solo', { map: t(`map.${mapKey}`) }));
  canvas.focus();
}
let finalMusic = false; // the final showdown theme already started this match
function attract() { achievements.end(); game.newMatch({ mapKey: randomMap() }); }
function toMenu() {
  if (!net.connected) presence(t('presence.menu'));
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

/* ---- online: server rooms + matchmaking (worker/index.js), Steam friend lobbies (steamnet.js) ---- */

// Web rooms and matchmaking run on our server, which plays the match itself (every version can
// join them: web, Steam, Epic, Android, iOS). On Steam there are also Steam lobbies (P2P, friends
// list, invites), hosted by a player.
const webNet = new Net();
const steamNet = steam ? new SteamNet(steam, steamInfo) : null;
let net = steamNet || webNet;
const onNet = (type, fn) => { webNet.on(type, fn); if (steamNet) steamNet.on(type, fn); };
const use = target => { if (net !== target && net.connected) net.close(); net = target; };
let lobbyMap = 'random';
const nick = $('#nick');
nick.value = localStorage.getItem('iaslop-name') || (epic && epic.name) || ''; // Epic: launcher display name
if (steam) {
  // Your Steam name is your name; rooms are Steam lobbies your friends can join.
  nick.value = steamInfo.name;
  nick.disabled = true;
  nick.previousElementSibling.textContent = t('lobby.steamName');
  $('#lobbyJoin .hint').textContent = t('lobby.steamHint');
  $('#createWeb').classList.remove('hidden');
  $('#crossHint').classList.remove('hidden');
}
const status = msg => { $('#lobbyStatus').textContent = msg || ''; };

function openLobby() {
  initAudio();
  sfx('click');
  $('#menu').classList.add('hidden');
  $('#lobby').classList.remove('hidden');
  showRoomView(net.connected);
  playMusic('lobby');
}
function showRoomView(inRoom) {
  $('#lobbyJoin').classList.toggle('hidden', inRoom || mm.searching);
  $('#queue').classList.toggle('hidden', inRoom || !mm.searching);
  $('#lobbyRoom').classList.toggle('hidden', !inRoom);
  // Steam lobby: overlay invite. Cross-play / browser room: copy the web link.
  $('#copyLink').textContent = net === steamNet ? t('lobby.inviteSteam') : t('lobby.copyLink');
  $('#crossBadge').classList.toggle('hidden', !(steamNet && net === webNet));
}
// code: a room code to join (on Steam: a Steam lobby first, then a web room);
// on Steam, no code creates a lobby; web: a web room (new cross-play room, or a matchmade one);
// lobbyId joins a friend's Steam lobby.
async function joinRoom(code, lobbyId = null, web = false) {
  const name = nick.value.trim() || t('lobby.namePlaceholder');
  try { if (!steam) localStorage.setItem('iaslop-name', name); } catch { /* ignore */ }
  status(t('lobby.connecting'));
  try {
    if (lobbyId) { use(steamNet); await net.joinLobby(lobbyId, name, chosen); }
    else if (steamNet && !code && !web) { use(steamNet); await net.create(name, chosen); }
    else if (web) { use(webNet); await net.connect(code || randomCode(), name, chosen); }
    else if (steamNet && await steam.findLobby(code)) { use(steamNet); await net.connect(code, name, chosen); }
    else { use(webNet); await net.connect(code, name, chosen); }
    if (net === webNet) presence(t('presence.room'));
    status('');
    sfx('join');
    if (!isPackagedApp) history.replaceState(null, '', `?room=${net.code}`);
    showRoomView(true);
  } catch (e) {
    status(steam || !import.meta.env.DEV ? `${e.message}.` : `${e.message}. Is the room server running? (npm run dev:server)`);
  }
}
$('#multi').addEventListener('click', openLobby);
$('#create').addEventListener('click', () => joinRoom(steam ? null : randomCode()));
$('#createWeb').addEventListener('click', () => joinRoom(null, null, true));
$('#join').addEventListener('click', () => { const c = $('#code').value.trim().toUpperCase(); if (c.length >= 4) joinRoom(c); else status(t('lobby.enterCode')); });
$('#code').addEventListener('keydown', e => { if (e.code === 'Enter') $('#join').click(); e.stopPropagation(); });
nick.addEventListener('keydown', e => e.stopPropagation());
$('#lobbyBack').addEventListener('click', () => { mm.cancel(); net.close(); history.replaceState(null, '', location.pathname); status(''); toMenu(); });

/* ---- matchmaking: one queue for every platform; bots fill the match after 5 minutes ---- */

const mm = new Matchmaking();
const clock = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const PLAT_ICON = { web: '🌐', steam: '🎮', epic: '🛒', android: '🤖', ios: '🍏' };
function findMatch() {
  const name = nick.value.trim() || t('lobby.namePlaceholder');
  try { if (!steam) localStorage.setItem('iaslop-name', name); } catch { /* ignore */ }
  sfx('click');
  status('');
  mm.start(name, chosen);
  $('#qCount').textContent = t('lobby.connecting');
  $('#qTime').textContent = $('#qBotsIn').textContent = $('#qPlats').textContent = '';
  $('#qFill').style.width = '0%';
  showRoomView(false);
  presence(t('mm.searching'));
}
$('#quick').addEventListener('click', findMatch);
$('#qCancel').addEventListener('click', () => { sfx('click'); mm.cancel(); showRoomView(false); presence(t('presence.menu')); });
$('#qBots').addEventListener('click', () => { sfx('click'); mm.bots(); });
mm.on('queue', m => {
  $('#qCount').textContent = t('mm.inQueue', { n: m.n, need: m.need });
  $('#qFill').style.width = `${Math.min(100, (m.n / m.need) * 100)}%`;
  $('#qTime').textContent = t('mm.waited', { time: clock(m.waited) });
  $('#qBotsIn').textContent = t('mm.botsIn', { time: clock(m.botsIn) });
  $('#qPlats').textContent = Object.entries(m.plats || {}).map(([k, n]) => `${PLAT_ICON[k] || '•'} ${n}`).join('   ');
});
mm.on('matched', m => {
  sfx('join');
  status(t('mm.found'));
  showRoomView(false);
  joinRoom(m.code, null, true);
});
mm.on('error', m => { mm.cancel(); showRoomView(false); status(m.code ? serverError(m) : t('err.unreachable')); });
mm.on('closed', () => { showRoomView(false); status(t('err.unreachable')); });
$('#copyLink').addEventListener('click', async () => {
  if (net === steamNet) { net.invite(); return; } // Steam overlay invite dialog
  const link = isPackagedApp ? `${WEB_ORIGIN}/play?room=${net.code}` : `${location.origin}${location.pathname}?room=${net.code}`;
  try { await navigator.clipboard.writeText(link); status(t('lobby.linkCopied')); } catch { status(link); }
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
onNet('room', m => {
  $('#roomCode').textContent = net.code;
  const ul = $('#players');
  ul.innerHTML = '';
  // Other players: report (everyone) and remove (room leader, not in matchmade rooms).
  const canKick = net.isHost && !m.matchmade;
  for (const p of m.players) {
    const li = document.createElement('li');
    const me = p.id === net.id;
    li.innerHTML = `<img src="${portrait(p.brawler)}" alt=""><span class="${me ? 'you' : ''}"></span>${p.host ? `<span class="crown">${t('lobby.host')}</span>` : ''}`
      + (me ? '' : `<span class="p-act"><button class="p-rep" title="${t('mod.report')}">⚑</button>${canKick ? `<button class="p-kick" title="${t('mod.kick')}">✕</button>` : ''}</span>`);
    li.children[1].textContent = (PLAT_ICON[p.plat] ? PLAT_ICON[p.plat] + ' ' : '') + (me ? t('lobby.you', { name: p.name }) : p.name);
    if (!me) {
      li.querySelector('.p-rep').addEventListener('click', () => openReport(p));
      const k = li.querySelector('.p-kick');
      if (k) k.addEventListener('click', () => { sfx('click'); net.kick(p.id); });
    }
    ul.appendChild(li);
  }
  for (let k = m.players.length; k < 8; k++) {
    const li = document.createElement('li'); li.className = 'empty'; li.textContent = t('lobby.bot'); ul.appendChild(li);
  }
  if (m.players.length > lastCount && lastCount) sfx('join');
  lastCount = m.players.length;
  const host = net.isHost;
  lobbyMap = m.map || lobbyMap;
  syncMaps($('#lobbyMaps'), lobbyMap);
  $('#lobbyMaps').querySelectorAll('.map').forEach(b => { b.disabled = !host; });
  $('#mapNote').textContent = host ? t('lobby.youPick') : t('lobby.hostPicks');
  $('#start').classList.toggle('hidden', !host);
  $('#waiting').classList.toggle('hidden', host);
  $('#waiting').textContent = m.inMatch ? t('lobby.inProgress') : m.matchmade ? t('mm.matchmade') : t('lobby.waiting');
  // host ended the match -> everyone back to the room
  if (!m.inMatch && game.net) backToRoom();
});

function startOnline(mapKey, roster, role) {
  playMusic('m_' + mapKey);
  finalMusic = false;
  $('#lobby').classList.add('hidden');
  $('#result').classList.add('hidden');
  hud.show(true);
  // sendTo: per-player snapshots (only what each one can see); the Steam P2P host has it.
  const sendTo = role === 'host' && net.sendTo ? (id, msg) => net.sendTo(id, msg) : null;
  game.newMatch({ mapKey, roster, localId: net.id, net: { role, send: msg => net.send(msg), sendTo } });
  const me = roster.find(r => r.id === net.id);
  achievements.matchStart({ mapKey, brawler: me ? me.type : chosen, online: true, humans: roster.filter(r => r.human).length });
  canvas.focus();
}
$('#start').addEventListener('click', () => {
  if (!net.isHost) return;
  sfx('click');
  // Server rooms: the server builds the roster and starts everyone (the leader included).
  if (net.serverAuthority) { net.send({ t: 'start' }); return; }
  const roster = makeRoster(net.players.map(p => ({ id: p.id, name: p.name, type: p.brawler })));
  const mapKey = resolveMap(lobbyMap);
  net.send({ t: 'start', map: mapKey, roster });
  startOnline(mapKey, roster, 'host');
});
onNet('start', m => startOnline(m.map, m.roster, 'client'));
onNet('in', m => game.onInput(m));
onNet('snap', m => game.applySnap(m));
onNet('ev', m => game.applyEvents(m.list));
onNet('left', m => game.onLeft(m.id));
onNet('hostLeft', () => { backToRoom(); status(t('lobby.hostLeft')); });
onNet('closed', () => {
  if (game.net) backToRoom();
  showRoomView(false);
  status(net.kickedMsg ? kickedText(net.kickedMsg) : t('lobby.disconnected'));
  net.kickedMsg = null;
});
// Removed by the room leader, or by the server for impossible moves.
const kickedText = m => t(`mod.kicked.${m.code === 'cheat' ? 'cheat' : 'leader'}`);
onNet('kicked', m => {
  net.kickedMsg = m;
  if (net === steamNet) { net.close(); if (game.net) backToRoom(); showRoomView(false); status(kickedText(m)); }
});
onNet('reported', m => status(m.ok ? t('mod.reported') : t('err.unreachable')));

// Report dialog: pick a reason, the server (or /api/report for Steam lobbies) records it.
let reportTarget = null;
function openReport(p) {
  sfx('click');
  reportTarget = p;
  $('#reportWho').textContent = p.name;
  $('#report').classList.remove('hidden');
}
document.querySelectorAll('#report [data-reason]').forEach(b => b.addEventListener('click', () => {
  $('#report').classList.add('hidden');
  if (b.dataset.reason && reportTarget) net.report(reportTarget.id, b.dataset.reason);
  reportTarget = null;
}));

function backToRoom() {
  $('#result').classList.add('hidden');
  hud.show(false);
  $('#lobby').classList.remove('hidden');
  showRoomView(net.connected);
  playMusic('lobby');
  attract();
}
game.onMatchEnd = () => { if (game.net && game.net.role === 'host') net.send({ t: 'end' }); else backToRoom(); };
$('#spectate').addEventListener('click', () => $('#result').classList.add('hidden'));

game.onFeat = (kind, n) => { if (kind === 'ko') achievements.ko(); else achievements.cubes(n); };
game.onResult = (rank, won) => {
  achievements.result(rank, won);
  playMusic(null);
  sfx(won ? 'victory' : 'defeat');
  $('#resTitle').textContent = won ? t('result.victory') : t('result.rank', { rank });
  $('#resTitle').className = won ? 'win' : '';
  $('#resSub').textContent = won ? t('result.won') : t('result.lost', { n: rank - 1 });
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

// Boot screen: one tick per texture, figurine and decor model.
const TIPS = ['tip.bushes', 'tip.crates', 'tip.gas', 'tip.brawlers', 'tip.tod', steam ? 'tip.steam' : 'tip.online'].map(k => t(k));
{
  const total = TEX_FILES + Object.keys(TYPES).length + PROPS.length;
  let done = 0, tip = Math.floor(Math.random() * TIPS.length);
  $('#ldTip').textContent = TIPS[tip];
  const tipTimer = setInterval(() => { tip = (tip + 1) % TIPS.length; $('#ldTip').textContent = TIPS[tip]; }, 3200);
  const tick = step => () => {
    done++;
    const pct = Math.round(done / total * 100);
    $('#ldFill').style.width = `${pct}%`;
    $('#ldPct').textContent = `${pct}%`;
    $('#ldStep').textContent = step;
  };
  await Promise.all([
    loadTextures(renderer, tick(t('loader.ground'))),
    preloadFigurines(Object.keys(TYPES), renderer, tick(t('loader.brawlers'))),
    preloadProps(renderer, tick(t('loader.decor'))),
  ]);
  clearInterval(tipTimer);
  $('#ldStep').textContent = t('loader.ready');
  setTimeout(() => $('#loader').classList.add('done'), 250);
}
for (const k of Object.keys(settings)) applySetting(k);
lighting.setPreset(settings.tod === 'cycle' ? 2 : +settings.tod, true);
attract();
// invite links: ?room=CODE opens the lobby straight away
const invited = new URLSearchParams(location.search).get('room');
if (invited) { openLobby(); $('#code').value = invited.toUpperCase(); }

// Steam: accepting an invite or clicking "Join game" on a friend, before launch or while playing.
if (steam) {
  const joinFriend = id => {
    if (!id || id === steamNet.steamLobby) return;
    if (menus.paused) menus.closePause();
    if (net.connected) net.close();
    toMenu();
    openLobby();
    joinRoom(null, id);
  };
  steam.onJoinRequested(() => steam.takePendingLobby().then(joinFriend));
  steam.takePendingLobby().then(joinFriend);
  achievements.sync();
  presence(t('presence.menu'));
}
if (isDesktop) {
  $('#quitBtn').classList.remove('hidden');
  $('#quitBtn').addEventListener('click', () => desktop.quit());
}

function frame(ts) {
  timer.update(ts);
  const dt = Math.min(timer.getDelta(), 0.05);
  renderer.info.reset();
  input.poll();
  menus.update(dt);
  if (input.padHit(PAD.Y)) nextTimeOfDay();
  if (input.padHit(PAD.BACK)) setSetting('debugPanel', !settings.debugPanel);
  game.update(dt);
  if (touch) touch.update(game.player);
  autoQuality.update(document.visibilityState === 'visible' && $('#loader').classList.contains('done'));
  // Last 3 brawlers standing: the final showdown theme takes over until the result.
  if (!finalMusic && game.mode === 'play' && !game.ended && !$('#hud').classList.contains('hidden')) {
    const alive = game.brawlers.reduce((n, b) => n + (b.alive ? 1 : 0), 0);
    if (alive <= 3 && alive > 1) { finalMusic = true; playMusic('final'); }
  }
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
    if (settings.fps) $('#fpsBadge').textContent = settings.preset === 'auto'
      ? `${fps} FPS · ${t('opt.auto')} ${autoQuality.label(tier => t(`opt.${tier}`))}` : `${fps} FPS`;
    stats.innerHTML = `
      <span>${fps} fps</span><span>${renderer.info.render.calls} draws</span>
      <span>${lights.used}/${lights.size} lights (${lights.candidates} emitters)</span>
      <span>shadow texel ${(lighting.texelSize * 100).toFixed(1)} cm</span>
      <span>${PRESETS[Math.floor(lighting.t) % 4].name} → ${PRESETS[(Math.floor(lighting.t) + 1) % 4].name} ${(lighting.t % 1 * 100).toFixed(0)}%</span>`;
    fpsAcc = 0; fpsN = 0; statT = 0;
  }
}
renderer.setAnimationLoop(frame);

// The game owns a render loop + WebGL context, so never hot-swap modules in place.
if (import.meta.hot) import.meta.hot.on('vite:beforeUpdate', () => location.reload());

// Dev-only handle for poking at the scene from the console (stripped from production builds).
if (import.meta.env.DEV) {
  window.__arena = { game, lighting, lights, renderer, composer, scene, camera, menus, input, settings, frame, timer, autoQuality };
  import('./devtools.js').then(m => m.installDevtools(window.__arena));
}
