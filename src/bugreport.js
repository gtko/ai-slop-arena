import { serverOrigin, platformName, appInfo } from './platform.js';
import { settings } from './settings.js';
import { lang, t } from './i18n/index.js';
import { version } from '../package.json';
import { lastCrashId, reportProblem, track } from './telemetry.js';

// "Report a bug": a small form sent to the server (/api/bug, see worker/index.js) with what the
// player wrote, a screenshot of the game and technical details. It shows up where it is useful:
// the pause menu, the result screen, F8 anywhere, and a discreet prompt when the game hits an error.

const $ = s => document.querySelector(s);
const errors = []; // the last few errors, sent with the report
let ctx = null;    // { captureFrame(): Promise<dataURL>, info(): {...} } from main.js
let shot = '';
let prompted = false;

function remember(msg) {
  errors.push(`${new Date().toISOString().slice(11, 19)} ${String(msg).slice(0, 300)}`);
  if (errors.length > 8) errors.shift();
}

// A downscaled JPEG of the game view (the overlays are HTML, not on the canvas).
function shrink(dataUrl, width = 640) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = width; c.height = Math.round(img.height * width / img.width);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.7));
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}

export async function openBugReport() {
  if (!ctx || !$('#bug').classList.contains('hidden')) return;
  hideToast();
  shot = '';
  try { const frame = await ctx.captureFrame(); shot = frame ? await shrink(frame) : ''; } catch { /* no screenshot */ }
  $('#bugPreview').src = shot || '';
  $('#bugPreview').classList.toggle('hidden', !shot);
  $('#bugShotRow').classList.toggle('hidden', !shot);
  $('#bugStatus').textContent = '';
  $('#bugSend').disabled = false;
  $('#bug').classList.remove('hidden');
  $('#bugText').focus();
}

function close() { $('#bug').classList.add('hidden'); }

async function send() {
  const text = $('#bugText').value.trim();
  if (!text) { $('#bugStatus').textContent = t('bug.empty'); $('#bugText').focus(); return; }
  $('#bugSend').disabled = true;
  $('#bugStatus').textContent = t('lobby.connecting');
  const info = {
    version, platform: platformName, store: appInfo.store, lang, userAgent: navigator.userAgent.slice(0, 200),
    screen: `${innerWidth}x${innerHeight}@${devicePixelRatio}`, gpu: settings.gpu, preset: settings.preset,
    tier: settings.autoTier, errors: errors.slice(), sentry: lastCrashId(), ...(ctx ? ctx.info() : {}),
  };
  try {
    const r = await fetch(`${serverOrigin()}/api/bug`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, info, shot: $('#bugShot').checked ? shot : '' }),
    });
    const out = await r.json().catch(() => ({}));
    if (!out.ok) throw new Error(out.error || r.status);
    $('#bugStatus').textContent = t('bug.sent');
    track('bug_report_sent', { screenshot: !!($('#bugShot').checked && shot), errors: errors.length });
    $('#bugText').value = '';
    setTimeout(close, 1400);
  } catch (e) {
    $('#bugSend').disabled = false;
    $('#bugStatus').textContent = String(e.message) === 'limit' ? t('bug.limit') : t('err.unreachable');
  }
}

// Something broke: offer (once per session, discreetly) to report it.
function toast() {
  if (prompted || !$('#bug').classList.contains('hidden')) return;
  prompted = true;
  $('#bugToast').classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(hideToast, 15000);
}
function hideToast() { $('#bugToast').classList.add('hidden'); }

export function installBugReport(context) {
  ctx = context;
  $('#bugSend').addEventListener('click', send);
  $('#bugCancel').addEventListener('click', close);
  $('#bugToastGo').addEventListener('click', openBugReport);
  $('#bugToastX').addEventListener('click', hideToast);
  // typing in the form must not move the brawler or trigger shortcuts
  $('#bug').addEventListener('keydown', e => { if (e.code === 'Escape') close(); e.stopPropagation(); });
  addEventListener('keydown', e => { if (e.code === 'F8') { e.preventDefault(); openBugReport(); } });
  addEventListener('error', e => { remember(e.message || e.error); toast(); });
  addEventListener('unhandledrejection', e => { remember(e.reason && (e.reason.stack || e.reason.message) || e.reason); toast(); });
  const canvas = document.querySelector('#c');
  if (canvas) canvas.addEventListener('webglcontextlost', () => { remember('WebGL context lost'); reportProblem('WebGL context lost'); toast(); });
}
