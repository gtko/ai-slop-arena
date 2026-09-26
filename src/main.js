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
import { GADGET_ICONS, STARS, parseLoadout } from './gadgets.js';
import { brawlerString, loadout, setLoadout, progress, award, GADGET_B_AT, STAR_2_AT } from './mastery.js';
import { makeRoster, randomMap } from './game.js';
import { MAPS } from './maps.js';
import { Net, randomCode, serverError } from './net.js';
import { SteamNet } from './steamnet.js';
import { Matchmaking } from './matchmaking.js';
import { isDesktop, isPackagedApp, isNativeApp, desktop, steam, steamInfo, epic, presence, platformName, WEB_ORIGIN, serverOrigin, clientId } from './platform.js';
import { achievements } from './achievements.js';
import { botLevel, recordResult } from './skill.js';
import { installBugReport, openBugReport } from './bugreport.js';
import { installTelemetry, track, breadcrumb, perfReset, perfFrame, perfReport } from './telemetry.js';
import { installSurvey, maybeAskSurvey } from './survey.js';
import { t, translateDom } from './i18n/index.js';
import { TouchControls, isTouchDevice } from './touch.js';
import { AutoQuality } from './autoquality.js';
import { VisionFog } from './visionfog.js';
import { Sight } from './sight.js';
import { initAudio, playMusic, setAmbience, sfx, toggleMute, setVolume, setMuted, setTrack, settings as audio } from './audio.js';
import { loadTextures, ASSET_BASE, TEX_FILES } from './assets.js';
import { shared } from './materials.js';
import { settings, set as setSetting, onChange, MOBILE } from './settings.js';
import { Menus } from './menu.js';
import { OUTLINES } from './models.js';
import { preloadFigurines, setFigurineDetail } from './figurines.js';
import { preloadProps, PROPS } from './props.js';
import { enableCartoonShading, cartoonGradePass } from './cartoon.js';
import { PAD } from './input.js';
import { MetaUI, skinFilter, framed, titleText } from './metaui.js';
import { awardMatch, leagueBotLevel, cosFor, unlock, owns } from './profile.js';
import { parseCos, FRAMES } from './cosmetics.js';
import { EmoteWheel } from './emotewheel.js';
import { weeklyMutator, MUT_ICONS } from './mutators.js';
import { PERSONA_ICONS } from './ai.js';
import { recordMatch } from './quests.js';
import './style.css';
import './meta.css';
import './home.css';

installTelemetry(); // crash reports first: the rest of the start-up can fail
translateDom();

const $ = s => document.querySelector(s);
const CARTOON = settings.art === 'cartoon';
if (CARTOON) enableCartoonShading(); // must run before any material compiles

/* ------------------------------ renderer ------------------------------ */

const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
// Phones have 2.5-3x screens: 1.25 is plenty for this camera and saves a lot of fill rate.
const DPR = Math.min(devicePixelRatio, MOBILE ? 1.25 : 1.5);
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
const lights = new LightPool(scene, MOBILE ? 6 : 12); // every material pays for every light, per pixel
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
const sight = new Sight(); // dims what walls, trees and crates hide from you
composer.addPass(sight.pass);
const visionFog = new VisionFog(); // limited field of view on fog maps, before bloom so lights glow through
composer.addPass(visionFog.pass);

const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight).multiplyScalar(MOBILE ? 0.5 : 1), 0.4, 0.5, 1.6);
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

const BASE_DPR = DPR;
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
    case 'detail': setFigurineDetail(v ?? 1); break; // figurine level of detail (mobile)
    case 'colorblind': document.body.classList.toggle('cb', v); game.colorblind = v; for (const b of game.brawlers) b.teamColors(); break;
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
  onBug: () => openBugReport(),
});
// Automatic graphics quality (preset "auto"): GPU guess, then follows the measured frame rate.
const autoQuality = new AutoQuality(renderer);
menus.ctx.autoQuality = autoQuality;
// Phones and tablets: virtual sticks + pause button (touch.js).
const touch = isTouchDevice ? new TouchControls(input, { onPause: () => { if (!menus.paused && game.mode === 'play') menus.openPause(); } }) : null;
if (touch) touch.setSuperLabel(t('hud.super'));
// Emote wheel (v0.13): B, R3 or the 😀 touch button during a match.
const wheel = new EmoteWheel(input, i => game.localEmote(i));
// Android / iOS app: the back button closes panels and pauses the match, leaving the app pauses it.
if (isNativeApp) {
  const pauseMatch = () => { if (!menus.paused && menus.ctx.isInMatch()) { menus.openPause(); return true; } return false; };
  import('./native.js').then(m => m.bindAppEvents({ onBack: () => meta.close() || menus.back() || pauseMatch(), onHide: pauseMatch }))
    .catch(e => console.warn('[native]', e));
}

$('#optionsBtn').addEventListener('click', () => { sfx('click'); menus.openOptions('#menu'); });
// Android app: achievements mirrored to Google Play Games, and a button for Play's achievements screen.
if (platformName === 'android') {
  import('./playgames.js').then(m => m.setupPlayGames()).then(play => {
    if (!play) return;
    achievements.connect(play);
    $('#achBtn').classList.remove('hidden');
    $('#achBtn').addEventListener('click', () => {
      sfx('click');
      play.open(() => achievements.sync([play])).catch(e => console.warn('[play games]', e));
    });
  }).catch(e => console.warn('[play games]', e));
}

let chosen = localStorage.getItem('iaslop-brawler') || 'blaster';
let chosenMap = 'random';
const MAP_ICON = { clear: '☀️', sandstorm: '🌪️', rain: '🌧️', snow: '❄️', fog: '🌫️' };
const portrait = key => `${ASSET_BASE}ui/${key}.png`;

// Home (v0.13 menu): the roster is a row of portrait tiles; the chosen brawler is on show (hero).
const hexOf = key => '#' + TYPES[key].palette.main.toString(16).padStart(6, '0');
const cards = $('#cards');
for (const T of Object.values(TYPES)) {
  const c = document.createElement('button');
  c.className = 'rt' + (T.key === chosen ? ' on' : '');
  c.dataset.key = T.key;
  c.style.setProperty('--c', hexOf(T.key));
  c.title = `${T.name} · ${t(`brawler.${T.key}.role`)}`;
  c.innerHTML = `<img src="${portrait(T.key)}" alt="" onerror="this.remove()"><b>${T.name}</b><i></i>`;
  c.addEventListener('click', () => { sfx('click'); pickBrawler(T.key); });
  cards.appendChild(c);
}
function renderHero() {
  const T = TYPES[chosen], P = progress(chosen), C = parseCos(cosFor(chosen));
  $('.hero').style.setProperty('--c', hexOf(chosen));
  const art = $('#heroArt');
  art.src = portrait(chosen);
  art.style.filter = `${skinFilter(chosen, C.skin)} drop-shadow(0 10px 0 rgba(0, 0, 0, 0.3))`;
  art.classList.remove('hero-in'); void art.offsetWidth; art.classList.add('hero-in');
  $('#heroName').textContent = T.name;
  $('#heroRole').textContent = t(`brawler.${chosen}.role`);
  $('#heroDesc').textContent = t(`brawler.${chosen}.desc`);
  $('#heroMastery').innerHTML = `<b>${t('menu.mastery', { n: P.level })}</b><i><u style="width:${(P.frac * 100).toFixed(0)}%"></u></i>`;
  const bar = (label, v, max) => `<div><small>${label}</small><i><u style="width:${Math.min(100, v / max * 100).toFixed(0)}%"></u></i><b>${v}</b></div>`;
  $('#heroStats').innerHTML = bar(t('menu.hp'), T.hp, 5000) + bar(t('menu.range'), T.range, 16) + bar(t('menu.speed'), T.speed, 7);
  cards.querySelectorAll('.rt').forEach(c => { c.querySelector('i').textContent = progress(c.dataset.key).level; });
}

// Loadout of the chosen brawler: its mastery, gadget A / B and star power 1 / 2 (mastery.js gates).
const typeOf = s => { const k = parseLoadout(s).type; return Object.hasOwn(TYPES, k) ? k : 'blaster'; };
const STAR_ICONS = ['⭐', '🌟'];
function renderLoadout() {
  const root = $('#loadout'), key = chosen, lo = loadout(key), P = progress(key);
  const opt = (kind, v, icon, name, lock) => `<button class="lo-opt${lo.includes(v) ? ' on' : ''}${lock ? ' locked' : ''}" data-${kind}="${v}"${lock ? ' disabled' : ''}
    title="${lock ? t('menu.locked', { n: lock }) : name}"><span class="lo-ico">${lock ? '🔒' : icon}</span><span class="lo-name">${lock ? t('menu.locked', { n: lock }) : name}</span></button>`;
  const lvl = P.level;
  root.innerHTML = `<div class="lo-group"><em>${t('menu.gadget')}</em>
      ${opt('g', 'A', GADGET_ICONS[key + 'A'], t(`gad.${key}A.name`), 0)}${opt('g', 'B', GADGET_ICONS[key + 'B'], t(`gad.${key}B.name`), lvl < GADGET_B_AT ? GADGET_B_AT : 0)}</div>
    <div class="lo-group"><em>${t('menu.star')}</em>
      ${opt('s', '1', STAR_ICONS[0], t(`star.${STARS[key][0]}.name`), 0)}${opt('s', '2', STAR_ICONS[1], t(`star.${STARS[key][1]}.name`), lvl < STAR_2_AT ? STAR_2_AT : 0)}</div>
    <p class="lo-desc"><b>${GADGET_ICONS[key + lo[0]]}</b> ${t(`gad.${key}${lo[0]}.desc`)}<br><b>${STAR_ICONS[+lo[1] - 1]}</b> ${t(`star.${STARS[key][+lo[1] - 1]}.desc`)}</p>`;
  root.querySelectorAll('.lo-opt:not(.locked)').forEach(b => b.addEventListener('click', () => {
    sfx('click');
    const cur = loadout(key);
    setLoadout(key, b.dataset.g ? b.dataset.g + cur[1] : cur[0] + b.dataset.s);
    renderLoadout();
    if (net.connected) net.send({ t: 'pick', brawler: key, lo: loadout(key), cos: cosFor(key) });
  }));
}

function pickBrawler(key) {
  chosen = key;
  try { localStorage.setItem('iaslop-brawler', key); } catch { /* private mode */ }
  document.querySelectorAll('[data-key]').forEach(x => x.classList.toggle('on', x.dataset.key === key));
  renderLoadout();
  renderHero();
  if (net.connected) net.send({ t: 'pick', brawler: key, lo: loadout(key), cos: cosFor(key) });
  if ($('#ljAvatar')) showAvatar();
}

renderLoadout();

// Progression pages (v0.13): quests, Trophy Road, shop, collection, under the top navigation.
const meta = new MetaUI({ brawlers: Object.keys(TYPES), portrait, chosen: () => chosen, onWear: () => {
  renderHero();
  if (net.connected) net.send({ t: 'pick', brawler: chosen, lo: loadout(chosen), cos: cosFor(chosen) });
} });
renderHero();

function showMastery(m, key) {
  const el = $('#resMastery');
  const unlock = m.after > m.before && (m.after === GADGET_B_AT ? t('result.unlockGadget') : m.after === STAR_2_AT ? t('result.unlockStar') : '');
  el.className = 'res-mastery' + (m.after > m.before ? ' up' : '');
  el.innerHTML = `<img src="${portrait(key)}" alt=""><div><b>${m.after > m.before ? t('result.masteryUp', { n: m.after }) : t('menu.mastery', { n: m.after })}</b>
    <i><u style="width:${(m.frac * 100).toFixed(0)}%"></u></i><small>${t('result.mastery', { n: m.gained })}${unlock ? ' · ' + unlock : ''}</small></div>`;
  if (m.after > m.before) setTimeout(() => sfx('ready'), 400);
  renderLoadout();
  renderHero();
}

// Weekly Chaos (v0.13): this week's mutator, on or off for solo; the room leader sets it for a room.
let chaosOn = false;
try { chaosOn = localStorage.getItem('iaslop-chaos') === '1'; } catch { /* private mode */ }
function chaosChip(btn, on, enabled = true) {
  const m = weeklyMutator();
  btn.innerHTML = `🌀 ${t('chaos.name')}: <b>${MUT_ICONS[m]} ${t('mut.' + m)}</b> <em>${on ? t('chaos.on') : t('chaos.off')}</em>`;
  btn.classList.toggle('on', on);
  btn.disabled = !enabled;
  btn.title = t('mut.' + m + '.desc');
}
chaosChip($('#chaosBtn'), chaosOn);
$('#chaosBtn').addEventListener('click', () => {
  sfx('click');
  chaosOn = !chaosOn;
  try { localStorage.setItem('iaslop-chaos', chaosOn ? '1' : '0'); } catch { /* private mode */ }
  chaosChip($('#chaosBtn'), chaosOn);
});
$('#chaosRoomBtn').addEventListener('click', () => { if (net.isHost) { sfx('click'); net.send({ t: 'chaos', on: !net.chaos }); } });

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
function showMapPick() {
  const key = chosenMap, M = MAPS[key];
  const b = $('#mapPick');
  b.style.backgroundImage = key === 'random' ? '' : `linear-gradient(90deg, rgba(10,8,22,0.85) 30%, rgba(10,8,22,0.2)), url(${ASSET_BASE}ui/map_${key}.jpg)`;
  b.innerHTML = `<small>${t('menu.map')}</small><b>${key === 'random' ? '🎲' : MAP_ICON[M.weather]} ${t(`map.${key}`)}</b><em>${t(`map.${key}.tag`)}</em><i>▾</i>`;
}
buildMaps($('#maps'), key => { chosenMap = key; syncMaps($('#maps'), key); showMapPick(); $('#maps').classList.add('hidden'); });
syncMaps($('#maps'), chosenMap);
showMapPick();
$('#mapPick').addEventListener('click', e => { sfx('click'); e.stopPropagation(); $('#maps').classList.toggle('hidden'); });
addEventListener('pointerdown', e => { if (!e.target.closest('#maps, #mapPick')) $('#maps').classList.add('hidden'); });
const resolveMap = key => (key === 'random' || !MAPS[key] ? randomMap() : key);

// The match being played, for the statistics (telemetry.js): how it started, KOs so far.
let played = null;
function matchStarted(info) {
  played = { ...info, kos: 0, ended: false };
  perfReset();
  breadcrumb('match start', info);
  track('match_started', info);
}
const matchProps = () => ({ mode: played.mode, map: played.map, brawler: played.brawler, duration_s: Math.round(game.time), kos: played.kos });
// Left before the end (quit, back to the menu or the room, disconnected, restarted).
function matchLeft(reason) {
  if (!played || played.ended) return;
  played.ended = true;
  track('match_abandoned', { ...matchProps(), reason, alive: game.brawlers.filter(b => b.alive).length });
  perfReport({ mode: played.mode, map: played.map });
}

/* ---- solo ---- */

// Training dojo (v0.12): your brawler and loadout against dummies, no gas, unlimited gadgets.
function dojo() {
  initAudio();
  sfx('click');
  $('#menu').classList.add('hidden');
  $('#result').classList.add('hidden');
  hud.show(true);
  playMusic('menu');
  finalMusic = true; // no final-showdown theme in the dojo
  matchLeft('restart');
  game.newMatch({ mapKey: 'oasis', roster: makeRoster([{ id: 'me', name: t('hud.you'), type: brawlerString(chosen), cos: cosFor(chosen) }], { level: 0.3 }), localId: 'me', dojo: true });
  track('dojo_opened', { brawler: chosen, loadout: loadout(chosen) });
  canvas.focus();
}

function play() {
  initAudio();
  sfx('click');
  $('#menu').classList.add('hidden');
  $('#result').classList.add('hidden');
  hud.show(true);
  const mapKey = resolveMap(chosenMap);
  playMusic('m_' + mapKey);
  finalMusic = false;
  matchLeft('restart');
  const level = leagueBotLevel(chosen, botLevel()); // Bot League: this brawler's trophies nudge the bots
  const mutator = chaosOn ? weeklyMutator() : null;
  game.newMatch({ mapKey, roster: makeRoster([{ id: 'me', name: t('hud.you'), type: brawlerString(chosen), cos: cosFor(chosen) }], { level }), localId: 'me', mutator });
  hud.titleCard();
  achievements.matchStart({ mapKey, brawler: chosen });
  matchStarted({ mode: 'solo', map: mapKey, map_random: chosenMap === 'random', brawler: chosen, loadout: loadout(chosen), bot_level: level, humans: 1, mutator });
  presence(t('presence.solo', { map: t(`map.${mapKey}`) }));
  canvas.focus();
}
let finalMusic = false; // the final showdown theme already started this match
function attract() { achievements.end(); game.newMatch({ mapKey: randomMap() }); }
function toMenu() {
  matchLeft('menu');
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
$('#dojo').addEventListener('click', dojo);
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
  $('.lj-friends > .hint').textContent = t('lobby.steamHint');
  $('#createWeb').classList.remove('hidden');
  $('#crossHint').classList.remove('hidden');
}
const status = msg => { $('#lobbyStatus').textContent = msg || ''; };

function openLobby() {
  initAudio();
  sfx('click');
  track('lobby_opened');
  $('#menu').classList.add('hidden');
  $('#lobby').classList.remove('hidden');
  showRoomView(net.connected);
  playMusic('lobby');
  loadRank();
  showAvatar();
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
    const lo = loadout(chosen), cos = cosFor(chosen);
    if (lobbyId) { use(steamNet); await net.joinLobby(lobbyId, name, chosen, lo, cos); }
    else if (steamNet && !code && !web) { use(steamNet); await net.create(name, chosen, lo, cos); }
    else if (web) { use(webNet); await net.connect(code || randomCode(), name, chosen, lo, cos); }
    else if (steamNet && await steam.findLobby(code)) { use(steamNet); await net.connect(code, name, chosen, lo, cos); }
    else { use(webNet); await net.connect(code, name, chosen, lo, cos); }
    if (net === webNet) presence(t('presence.room'));
    track('room_joined', { kind: net === steamNet ? 'steam_lobby' : net.matchmade ? 'matchmaking' : 'room', created: !code && !lobbyId, friend: !!lobbyId });
    status('');
    sfx('join');
    if (!isPackagedApp && !net.matchmade) history.replaceState(null, '', `?room=${net.code}`); // matchmade rooms are not for sharing
    showRoomView(true);
  } catch (e) {
    track('room_join_failed', { error: String(e.message).slice(0, 80) });
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

/* ---- matchmaking: one queue for every platform; bots fill the match after 1 minute ---- */

const mm = new Matchmaking();
let queuedAt = 0;
const waited = () => Math.round((performance.now() - queuedAt) / 1000);
const clock = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const PLAT_ICON = { web: '🌐', steam: '🎮', epic: '🛒', android: '🤖', ios: '🍏' };
// Visible rank (tier + RP) from the server; the hidden MMR never reaches the client.
const TIER_ICON = { bronze: '🥉', silver: '🥈', gold: '🥇', diamond: '💎', mythic: '🔮', legend: '👑' };
const rankText = r => (r.matches ? t('rank.badge', { icon: TIER_ICON[r.tier], tier: t(`rank.${r.tier}`), rp: r.rp }) : t('rank.unranked'));
// Rank card in the online menu: tier emblem, RP and progress to the next tier.
const TIER_MIN = [['bronze', 0], ['silver', 200], ['gold', 500], ['diamond', 900], ['mythic', 1400], ['legend', 2000]];
function showRank(r) {
  if (!r || r.rp === undefined) return;
  $('#qRank').textContent = rankText(r);
  const ranked = r.matches > 0;
  $('#rankEmblem').dataset.tier = ranked ? r.tier : 'none';
  $('#rankEmblem i').textContent = ranked ? TIER_ICON[r.tier] : '❔';
  $('#rankTier').textContent = ranked ? `${t(`rank.${r.tier}`)} · ${r.rp} RP` : t('rank.none');
  const i = TIER_MIN.findIndex(([name]) => name === r.tier), next = TIER_MIN[i + 1];
  $('#rankSub').textContent = !ranked ? t('rank.unranked') : next ? t('rank.toNext', { rp: next[1] - r.rp, tier: t(`rank.${next[0]}`) }) : t('rank.top');
  $('#rankFill').style.width = !ranked ? '0%' : next ? `${Math.round((r.rp - TIER_MIN[i][1]) / (next[1] - TIER_MIN[i][1]) * 100)}%` : '100%';
}
// Your brawler on the profile card.
function showAvatar() {
  $('#ljAvatar').src = portrait(chosen);
  $('.lj-avatar').style.setProperty('--c', '#' + TYPES[chosen].palette.main.toString(16).padStart(6, '0'));
}
async function loadRank() {
  try { const r = await (await fetch(`${serverOrigin()}/api/rank?cid=${clientId()}`)).json(); if (r.ok) showRank(r); } catch { /* offline */ }
}
function findMatch() {
  const name = nick.value.trim() || t('lobby.namePlaceholder');
  try { if (!steam) localStorage.setItem('iaslop-name', name); } catch { /* ignore */ }
  sfx('click');
  status('');
  mm.start(name, chosen, loadout(chosen));
  queuedAt = performance.now();
  track('mm_search_started', { brawler: chosen });
  $('#qCount').textContent = t('lobby.connecting');
  $('#qTime').textContent = $('#qBotsIn').textContent = $('#qPlats').textContent = '';
  $('#qFill').style.width = '0%';
  showRoomView(false);
  presence(t('mm.searching'));
}
$('#quick').addEventListener('click', findMatch);
$('#qCancel').addEventListener('click', () => { sfx('click'); track('mm_search_cancelled', { wait_s: waited() }); mm.cancel(); showRoomView(false); presence(t('presence.menu')); });
$('#qBots').addEventListener('click', () => { sfx('click'); track('mm_bots_requested', { wait_s: waited() }); mm.bots(); });
mm.on('rank', m => showRank(m));
mm.on('queue', m => {
  $('#qCount').textContent = t('mm.inQueue', { n: m.n, need: m.need });
  $('#qFill').style.width = `${Math.min(100, (m.n / m.need) * 100)}%`;
  $('#qTime').textContent = t('mm.waited', { time: clock(m.waited) });
  $('#qBotsIn').textContent = t('mm.botsIn', { time: clock(m.botsIn) });
  $('#qPlats').textContent = Object.entries(m.plats || {}).map(([k, n]) => `${PLAT_ICON[k] || '•'} ${n}`).join('   ');
});
mm.on('matched', m => {
  track('mm_matched', { wait_s: waited() });
  sfx('join');
  status(t('mm.found'));
  showRoomView(false);
  joinRoom(m.code, null, true);
});
mm.on('error', m => { track('mm_error', { code: m.code || 'unreachable' }); mm.cancel(); showRoomView(false); status(m.code ? serverError(m) : t('err.unreachable')); });
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
    const C = parseCos(p.cos), key = typeOf(p.brawler);
    li.innerHTML = `${framed(C.frame, `<img src="${portrait(key)}" alt="" style="filter:${skinFilter(key, C.skin)}">`, 'p-pf')}<span class="${me ? 'you' : ''}"></span>${p.host ? `<span class="crown">${t('lobby.host')}</span>` : ''}`
      + (me ? '' : `<span class="p-act"><button class="p-rep" title="${t('mod.report')}">⚑</button>${canKick ? `<button class="p-kick" title="${t('mod.kick')}">✕</button>` : ''}</span>`);
    li.children[1].textContent = (PLAT_ICON[p.plat] ? PLAT_ICON[p.plat] + ' ' : '') + (me ? t('lobby.you', { name: p.name }) : p.name);
    if (C.title) li.children[1].dataset.title = titleText(C.title);
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
  $('#chaosRoomBtn').classList.toggle('hidden', !!m.matchmade);
  chaosChip($('#chaosRoomBtn'), !!m.chaos, host);
  $('#start').classList.toggle('hidden', !host);
  $('#waiting').classList.toggle('hidden', host);
  $('#waiting').textContent = m.inMatch ? t('lobby.inProgress') : m.matchmade ? t('mm.matchmade') : t('lobby.waiting');
  // host ended the match -> everyone back to the room
  if (!m.inMatch && game.net) { if (matchmadeMatch) matchmadeOver(); else backToRoom(); }
});

/* ---- pre-match loading screen: everyone builds the match, then 3-2-1 together ---- */

// next frame, or 150 ms if nothing renders (app in the background): loading must still finish
const nextFrame = () => new Promise(r => { requestAnimationFrame(() => r()); setTimeout(r, 150); });
let loadState = null; // { ready: Set, humans: [...], timer } while we (the Steam host) wait for peers
function showMatchLoad(mapKey, roster) {
  $('#mlMap').textContent = t(`map.${mapKey}`);
  $('#mlTag').textContent = t(`map.${mapKey}.tag`);
  $('#mlCount').textContent = '';
  const cards = $('#mlCards');
  cards.innerHTML = '';
  for (const r of roster) {
    const T = TYPES[typeOf(r.type)], el = document.createElement('div');
    el.className = 'ml-card' + (r.human ? '' : ' ready') + (r.id === net.id ? ' me' : '');
    el.dataset.id = r.id;
    el.dataset.human = r.human ? '1' : '';
    el.style.setProperty('--c', '#' + T.palette.main.toString(16).padStart(6, '0'));
    const C = parseCos(r.cos);
    if (r.human && C.frame) el.classList.add('ml-fr', 'fr-' + FRAMES[C.frame]);
    el.innerHTML = `<span class="ml-ok">✓</span><img src="${portrait(typeOf(r.type))}" alt="" style="filter:${skinFilter(typeOf(r.type), C.skin)}"><div class="ml-name"></div><div class="ml-title"></div><div class="ml-sub"></div><div class="ml-bar"><i></i></div>`;
    el.querySelector('.ml-title').textContent = r.human ? titleText(C.title) : '';
    el.querySelector('.ml-name').textContent = r.id === net.id ? t('lobby.you', { name: r.name }) : r.name;
    el.querySelector('.ml-sub').textContent = r.human ? `${PLAT_ICON[r.plat] || '🌐'} ${T.name}`
      : `${r.per ? PERSONA_ICONS[r.per] + ' ' + t('persona.' + r.per) : t('load.bot')} · ${T.name}`;
    if (!r.human) el.querySelector('.ml-bar i').style.width = '100%';
    cards.appendChild(el);
  }
  updateLoadStatus();
  $('#matchload').classList.remove('hidden');
}
function setLoadProgress(id, p) {
  const el = $(`#mlCards [data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.querySelector('.ml-bar i').style.width = `${p}%`;
  el.classList.toggle('ready', p >= 100);
  updateLoadStatus();
}
function updateLoadStatus() {
  const humans = [...document.querySelectorAll('#mlCards .ml-card[data-human="1"]')];
  $('#mlStatus').textContent = t('load.waiting', { n: humans.filter(c => c.classList.contains('ready')).length, total: humans.length });
}
// 3-2-1-FIGHT, then the match runs (the server starts its simulation at the same moment).
async function countdown(ms) {
  const el = $('#mlCount');
  $('#mlStatus').textContent = '';
  for (let n = Math.round(ms / 1000); n > 0; n--) {
    el.textContent = n; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    sfx('click');
    await new Promise(r => setTimeout(r, 1000));
  }
  el.textContent = t('load.fight'); el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  sfx('ready');
  await new Promise(r => setTimeout(r, 450));
}
async function goMatch(ms) {
  if (!game.net || game.state !== 'waiting') return;
  if (!game.localReady) status(t('load.late')); // still loading: a bot plays for us meanwhile
  await countdown(ms);
  if (!game.net) return;
  $('#matchload').classList.add('hidden');
  hud.show(true);
  game.time = 0; // the spawn shield counts from here
  game.state = 'playing';
  hud.titleCard();
  canvas.focus();
}

// A matchmaking match: when it ends we do not go back to that room of strangers, the result screen
// offers to queue again or to go back to the online menu. (Remembered here: the room stops being
// "matchmade" on the server the moment the match ends.)
let matchmadeMatch = false, resultShown = false, rankedText = '';
function matchmadeOver() {
  // our own result may not be on screen yet (knocked out while the app was in the background):
  // fill it from where our brawler finished before leaving the match
  if (!resultShown) {
    const P = game.player, alive = game.brawlers.filter(b => b.alive).length;
    const rank = P ? P.rank || alive || 1 : 1;
    game.onResult(rank, rank === 1);
  }
  matchmadeMatch = false;
  net.close(); // leave the matchmade room; the server drops it once empty
  game.net = null;
  hud.show(false);
  playMusic('lobby');
  attract();
  presence(t('presence.menu'));
  $('#soloBtns').classList.add('hidden');
  $('#onlineBtns').classList.add('hidden');
  $('#mmBtns').classList.remove('hidden');
  $('#result').classList.remove('hidden');
}
$('#mmAgain').addEventListener('click', () => { $('#result').classList.add('hidden'); openLobby(); findMatch(); });
$('#mmMenu').addEventListener('click', () => { sfx('click'); $('#result').classList.add('hidden'); openLobby(); });

async function startOnline(mapKey, roster, role, mutator = null) {
  matchmadeMatch = !!net.matchmade;
  resultShown = false;
  rankedText = '';
  playMusic('m_' + mapKey);
  finalMusic = false;
  $('#lobby').classList.add('hidden');
  $('#result').classList.add('hidden');
  hud.show(false);
  showMatchLoad(mapKey, roster);
  await nextFrame();
  // sendTo: per-player snapshots (only what each one can see); the Steam P2P host has it.
  const sendTo = role === 'host' && net.sendTo ? (id, msg) => net.sendTo(id, msg) : null;
  game.newMatch({ mapKey, roster, localId: net.id, net: { role, send: msg => net.send(msg), sendTo }, mutator });
  game.state = 'waiting'; // nothing moves until everyone is in
  game.localReady = false;
  const me = roster.find(r => r.id === net.id);
  const humans = roster.filter(r => r.human).length;
  achievements.matchStart({ mapKey, brawler: me ? typeOf(me.type) : chosen, online: true, humans });
  matchStarted({ mode: net === steamNet ? 'steam_lobby' : matchmadeMatch ? 'matchmaking' : 'room', map: mapKey, brawler: me ? typeOf(me.type) : chosen, loadout: loadout(chosen), humans, host: role === 'host' });
  net.send({ t: 'lprog', p: 50 });
  setLoadProgress(net.id, 50);
  // compile the shaders now rather than stuttering on the first frames of the match
  try { if (renderer.compileAsync) await renderer.compileAsync(scene, camera); else renderer.compile(scene, camera); } catch { /* fine */ }
  await nextFrame();
  if (!game.net) return;
  game.localReady = true;
  setLoadProgress(net.id, 100);
  net.send({ t: 'loaded' });
  if (role === 'host') { // Steam P2P host: we are the one who waits for everybody
    loadState = { ready: new Set([net.id]), humans: roster.filter(r => r.human).map(r => r.id) };
    loadState.timer = setTimeout(() => hostGo(), 25000);
    hostMaybeGo();
  }
}
function hostMaybeGo() {
  const present = new Set(net.players.map(p => p.id));
  if (loadState && loadState.humans.every(id => loadState.ready.has(id) || !present.has(id))) hostGo();
}
function hostGo() {
  if (!loadState) return;
  clearTimeout(loadState.timer);
  for (const id of loadState.humans) if (!loadState.ready.has(id)) game.onLeft(id); // bot until they load
  loadState = null;
  net.send({ t: 'go', in: 3000 });
  goMatch(3000);
}
onNet('loaded', m => { // Steam host: a peer finished loading
  setLoadProgress(m.from, 100);
  if (loadState) { loadState.ready.add(m.from); hostMaybeGo(); } else if (game.net && game.net.role === 'host') game.onRejoin(m.from);
});
onNet('lprog', m => setLoadProgress(m.id, m.p));
onNet('go', m => goMatch(m.in || 3000));
$('#start').addEventListener('click', () => {
  if (!net.isHost) return;
  sfx('click');
  // Server rooms: the server builds the roster and starts everyone (the leader included).
  if (net.serverAuthority) { net.send({ t: 'start' }); return; }
  const roster = makeRoster(net.players.map(p => ({ id: p.id, name: p.name, type: p.brawler, lo: p.lo, cos: p.cos })), { level: botLevel() });
  const mapKey = resolveMap(lobbyMap), mut = net.chaos ? weeklyMutator() : null;
  net.send({ t: 'start', map: mapKey, roster, mut });
  startOnline(mapKey, roster, 'host', mut);
});
onNet('start', m => startOnline(m.map, m.roster, 'client', m.mut));
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
// Ranked match over: RP gained / lost and the new tier (on the result screen and in the room).
onNet('ranked', m => {
  const txt = m.visible
    ? t('rank.change', { delta: (m.delta > 0 ? '+' : '') + m.delta, icon: TIER_ICON[m.tier], tier: t(`rank.${m.tier}`), rp: m.rp })
      + (m.tier !== m.prevTier ? ' ' + t('rank.newTier') : '')
    : t('rank.practice');
  rankedText = txt;
  track('ranked_result', { visible: !!m.visible, delta: m.delta, rp: m.rp, tier: m.tier, prev_tier: m.prevTier, promoted: m.tier !== m.prevTier });
  $('#resRank').textContent = txt;
  $('#resRank').classList.remove('hidden');
  status(txt);
  if (m.visible) showRank({ rp: m.rp, tier: m.tier, matches: 1 });
});

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
  if (b.dataset.reason && reportTarget) { net.report(reportTarget.id, b.dataset.reason); track('player_reported', { reason: b.dataset.reason }); }
  reportTarget = null;
}));

function backToRoom() {
  matchLeft('room');
  $('#result').classList.add('hidden');
  $('#matchload').classList.add('hidden');
  loadState = null;
  hud.show(false);
  $('#lobby').classList.remove('hidden');
  showRoomView(net.connected);
  playMusic('lobby');
  attract();
}
game.onMatchEnd = () => { if (game.net && game.net.role === 'host') net.send({ t: 'end' }); else backToRoom(); };
$('#spectate').addEventListener('click', () => $('#result').classList.add('hidden'));

// Bug reports (bugreport.js): a screenshot of the next rendered frame + what the game was doing.
let captureNext = null;
installBugReport({
  // the next rendered frame; if nothing renders (hidden tab) the form opens without a screenshot
  captureFrame: () => new Promise(resolve => { captureNext = resolve; setTimeout(() => { if (captureNext === resolve) { captureNext = null; resolve(''); } }, 400); }),
  info: () => ({
    fps: Math.round(lastFps), mode: game.mode, map: game.mapKey, online: !!game.net,
    room: net.connected ? net.code : null, matchTime: Math.round(game.time), alive: game.brawlers.filter(b => b.alive).length,
  }),
});
$('#resBug').addEventListener('click', () => openBugReport());
installSurvey();
achievements.onUnlock = id => track('achievement_unlocked', { achievement: id });
// Options the players change by hand (the ones worth a chart).
onChange((key, value) => {
  if (['preset', 'lang', 'art', 'shake', 'fps', 'vibration', 'tod'].includes(key) && !$('#options').classList.contains('hidden')) track('setting_changed', { key, value: String(value) });
});

game.onFeat = (kind, n) => {
  if (played && (kind === 'ko' || kind === 'superko')) played.kos++;
  if (kind === 'ko') achievements.ko();
  else if (kind === 'superko') achievements.superKo();
  else if (kind === 'crate') achievements.crate();
  else achievements.cubes(n);
};
// Result stat card: your damage, KOs, cubes and gadgets, then the match awards (v0.13): the MVP
// (most damage) and the best at K.O.s, cubes, gadgets, supers, crates and emotes.
const AWARDS = [['kos', '💀', 2], ['cubes', '💎', 3], ['supers', '🌟', 2], ['gadgets', '🧰', 3], ['crates', '📦', 3], ['emotes', '💬', 2]];
const who = b => (b === game.player ? t('hud.you') : b.name);
function showStats() {
  const P = game.player, el = $('#resStats');
  if (!P) { el.innerHTML = ''; return; }
  const tile = (icon, v, label) => `<div><span>${icon}</span><b>${v}</b><small>${label}</small></div>`;
  const best = k => game.brawlers.reduce((a, b) => (b.stats[k] > a.stats[k] ? b : a), P);
  const mvp = best('dmg');
  const list = [{ b: mvp, html: `<i>👑</i><span>${t('award.mvp')}</span> <b></b>` }];
  for (const [k, icon, min] of AWARDS) {
    const b = best(k);
    if (b.stats[k] >= min) list.push({ b, html: `<i>${icon}</i><span>${t('award.' + k, { n: b.stats[k] })}</span> <b></b>` });
  }
  // yours first, then the others; 5 at most
  list.sort((x, y) => (y.b === P) - (x.b === P));
  el.innerHTML = tile('💥', Math.round(P.stats.dmg), t('result.dmg')) + tile('💀', P.stats.kos, t('result.kos'))
    + tile('💎', P.stats.cubes, t('result.cubes')) + tile(GADGET_ICONS[P.type.key + P.gadget], P.stats.gadgets, t('result.gadgets'))
    + `<div class="awards">${list.slice(0, 5).map(a => `<span class="award${a.b === P ? ' me' : ''}">${a.html}</span>`).join('')}</div>`;
  el.querySelectorAll('.award b').forEach((n, i) => { n.textContent = who(list[i].b); });
}

// Podium (v0.13): the top 3 on steps, with their looks, once the match has a winner.
let podiumFor = null, resultMatch = null;
function showPodium() {
  const el = $('#resPodium');
  if (!game.ended || !game.player) { el.innerHTML = ''; $('.result').classList.remove('podium-on'); podiumFor = null; return; }
  if (podiumFor === game.matchNo) return;
  podiumFor = game.matchNo;
  const top = game.brawlers.filter(b => b.rank >= 1 && b.rank <= 3).sort((a, b) => a.rank - b.rank);
  const order = [top[1], top[0], top[2]].filter(Boolean); // 2 - 1 - 3
  el.innerHTML = order.map(b => {
    const C = b.cos;
    return `<div class="pd p${b.rank}${b === game.player ? ' me' : ''}">${framed(C.frame, `<img src="${portrait(b.type.key)}" alt="" style="filter:${skinFilter(b.type.key, C.skin)}">`)}
      <span class="pd-name"></span><span class="pd-title">${b.human ? titleText(C.title) : b.persona ? PERSONA_ICONS[b.persona] + ' ' + t('persona.' + b.persona) : ''}</span><span class="pd-step">${b.rank}</span></div>`;
  }).join('');
  el.querySelectorAll('.pd-name').forEach((n, i) => { n.textContent = who(order[i]); });
  $('.result').classList.add('podium-on');
}

game.onResult = (rank, won) => {
  showStats();
  showPodium();
  achievements.result(rank, won, { night: lighting.night >= 0.5 });
  if (played && !played.ended) {
    played.ended = true;
    track('match_ended', { ...matchProps(), rank, won, players: game.brawlers.length });
    perfReport({ mode: played.mode, map: played.map });
    maybeAskSurvey({ mode: played.mode, map: played.map, brawler: played.brawler, rank, won });
  }
  // hidden level: the bots of the next solo / private match follow it (never shown)
  recordResult(rank, won);
  resultMatch = game.matchNo;
  // "Agent of Chaos": the first Weekly Chaos win
  const chaosTitle = won && game.mutator && !owns('title:10') ? [unlock('title:10')] : [];
  // mastery of the brawler you played: points, and a little ceremony when it levels up
  const key = played && played.brawler && TYPES[played.brawler] ? played.brawler : null;
  if (key) {
    const m = award(key, { rank, kos: played.kos });
    showMastery(m, key);
    // account level, Slop Coins, Bot League trophies (solo) and quests (v0.13)
    const P = game.player, st = P ? P.stats : {};
    const res = awardMatch({ rank, won, kos: played.kos, key, vsBots: played.mode === 'solo', mastery: m.after });
    const q = recordMatch({ rank, won, brawler: key, kos: played.kos, dmg: Math.round(st.dmg || 0), cubes: st.cubes || 0,
      gadgets: st.gadgets || 0, supers: st.supers || 0, crates: st.crates || 0, emotes: st.emotes || 0 }, Object.keys(TYPES));
    meta.showResult({ ...res, extra: chaosTitle }, q, key);
    track('progress', { level: res.after.level, xp: res.xp, coins: res.coins + q.coins, trophies: res.league ? res.league.total : undefined,
      quests_done: q.moved.filter(x => x.done).length });
    for (const x of q.moved) if (x.done) track('quest_completed', { kind: x.q.kind, weekly: x.weekly });
  } else $('#resProgress').innerHTML = '';
  resultShown = true;
  // ranked (matchmaking) result: arrives from the server when the match ends (maybe already here)
  $('#resRank').classList.toggle('hidden', !matchmadeMatch);
  $('#resRank').textContent = matchmadeMatch ? rankedText || t('rank.pending') : '';
  playMusic(null);
  sfx(won ? 'victory' : 'defeat');
  $('#resTitle').textContent = won ? t('result.victory') : t('result.rank', { rank });
  $('#resTitle').className = won ? 'win' : '';
  $('#resSub').textContent = won ? t('result.won') : t('result.lost', { n: rank - 1 });
  $('#soloBtns').classList.toggle('hidden', !!game.net);
  $('#onlineBtns').classList.toggle('hidden', !game.net);
  $('#mmBtns').classList.add('hidden');
  // matchmaking: the ranked result and the next choices come when the whole match is over
  $('#onlineBtns .hint').textContent = matchmadeMatch ? t('rank.pending') : t('result.backSoon');
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
let fpsAcc = 0, fpsN = 0, statT = 0, lastFps = 0;

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
    preloadFigurines(Object.keys(TYPES), renderer, tick(t('loader.brawlers'))).then(() => setFigurineDetail(settings.detail ?? 1)),
    preloadProps(renderer, tick(t('loader.decor'))),
  ]);
  clearInterval(tipTimer);
  $('#ldStep').textContent = t('loader.ready');
  let first = false;
  try { first = !localStorage.getItem('iaslop-opened'); localStorage.setItem('iaslop-opened', '1'); } catch { /* private mode */ }
  track('app_opened', { load_ms: Math.round(performance.now()), first_launch: first, gpu: (settings.gpu || '').slice(0, 120), screen: `${innerWidth}x${innerHeight}`, touch: isTouchDevice });
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

// Phones: 60 FPS at most. 90/120 Hz screens would otherwise double the work (and the heat) for a
// top-down game that does not need it.
const FRAME_MS = MOBILE ? 1000 / 60 : 0;
let lastFrame = 0;
function frame(ts) {
  if (FRAME_MS && ts - lastFrame < FRAME_MS - 2) return;
  lastFrame = ts;
  timer.update(ts);
  const dt = Math.min(timer.getDelta(), 0.05);
  renderer.info.reset();
  input.poll();
  menus.update(dt);
  if (!$('#result').classList.contains('hidden') && game.ended && game.player && game.matchNo === resultMatch && podiumFor !== game.matchNo) { showPodium(); showStats(); } // solo: the bots finished the match
  const inMatch = game.mode === 'play' && game.player && !menus.paused && !$('#hud').classList.contains('hidden') && $('#result').classList.contains('hidden');
  if (inMatch) wheel.update(); else if (wheel.open) wheel.close();
  if (input.padHit(PAD.Y)) nextTimeOfDay();
  if (input.padHit(PAD.BACK)) setSetting('debugPanel', !settings.debugPanel);
  game.update(dt);
  if (touch) touch.update(game.player);
  autoQuality.update(document.visibilityState === 'visible' && $('#loader').classList.contains('done'));
  if (played && !played.ended && game.mode === 'play' && !menus.paused && document.visibilityState === 'visible' && !$('#hud').classList.contains('hidden')) perfFrame(dt);
  // Last 3 brawlers standing: the final showdown theme takes over until the result.
  if (!finalMusic && game.mode === 'play' && !game.ended && !$('#hud').classList.contains('hidden')) {
    const alive = game.brawlers.reduce((n, b) => n + (b.alive ? 1 : 0), 0);
    if (alive <= 3 && alive > 1) { finalMusic = true; playMusic('final'); }
  }
  // Sun direction/colour in view space for the foliage rim + translucency term.
  shared.sunDirView.value.copy(lighting.sunDir).transformDirection(camera.matrixWorldInverse);
  shared.sunColor.value.copy(lighting.sun.color).multiplyScalar(lighting.sun.intensity);
  setAmbience(lighting.night);
  sight.update(dt, camera, game.arena, game.mode === 'play' ? game.sightViewer : null,
    game.weather && game.weather.kind === 'sandstorm' ? scene.fog.color : null, game.sightRange || 0);
  visionFog.update(dt, camera, game.visionRadius || 0, game.visionCenter, scene.fog.color, game.time);
  bloom.strength = lighting.bloom;
  composer.render(dt);
  if (captureNext) { const done = captureNext; captureNext = null; done(canvas.toDataURL('image/jpeg', 0.85)); }

  fpsAcc += dt; fpsN++; statT += dt;
  if (statT > 0.5) {
    const fps = Math.round(fpsN / fpsAcc);
    lastFps = fps;
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
