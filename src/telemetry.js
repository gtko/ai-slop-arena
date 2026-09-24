import * as Sentry from '@sentry/browser';
import { settings, onChange, MOBILE } from './settings.js';
import { platformName, appInfo, clientId, isNativeApp, isPackagedApp } from './platform.js';
import { lang } from './i18n/index.js';
import { version } from '../package.json';

// Crash reports (Sentry) and game statistics (PostHog), both described in public/privacy.html.
//  - Sentry: errors with their stack trace, game version, platform and graphics chip. No IP, no name.
//  - PostHog: what players do (matches, brawlers, maps, queue times, frame rate), keyed by the random
//    device id every player already has (platform.js). No name, no IP (anonymized in the project).
// Each one has its own switch in Options > General; both are off in `npm run dev`.

const SENTRY_DSN = 'https://3fdb3060adf24573f7c7c61bd6112bb1@o4511078519078912.ingest.de.sentry.io/4512143829631056';
const POSTHOG_KEY = 'phc_xXBDA6cXS69ewUvCWF7VKdyqvWBcPvbGyKA4SkJjdMDj';
const POSTHOG_HOST = 'https://eu.i.posthog.com';
const ENABLED = import.meta.env.PROD || import.meta.env.VITE_TELEMETRY === '1';
const RELEASE = `ai-slop-arena@${version}`;
// a build tried on this computer (wrangler dev), kept apart from the players' data
const LOCAL = !isPackagedApp && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const ENVIRONMENT = import.meta.env.PROD && !LOCAL ? 'production' : 'development';

const store = appInfo.store || 'web';
// Sent with every crash and every event: enough to split any chart by device family.
// No location from the IP address ($geoip_disable): the time zone is enough to see the regions.
const timezone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })();
const context = () => ({
  platform: platformName, store, app_version: version, environment: ENVIRONMENT, lang, timezone, mobile: MOBILE,
  gpu_tier: settings.autoTier || '', preset: settings.preset, $geoip_disable: true,
});

/* ------------------------------ Sentry ------------------------------ */

let sentryOn = false;
function startSentry() {
  if (sentryOn || !ENABLED) return;
  sentryOn = true;
  Sentry.init({
    dsn: SENTRY_DSN,
    release: RELEASE,
    environment: ENVIRONMENT,
    sendDefaultPii: false,
    // a small share of page loads and server calls, to see where time goes
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.05,
    tracePropagationTargets: [], // no tracing headers on our own server or anybody else's
    // noise from extensions, ad blockers and the browser itself
    ignoreErrors: ['ResizeObserver loop', 'Non-Error promise rejection captured', /^Script error\.?$/],
    denyUrls: [/extensions\//i, /^chrome:\/\//i, /^moz-extension:\/\//i, /^safari-web-extension:\/\//i],
    beforeSend: event => (settings.crashReports ? event : null),
    beforeSendTransaction: event => (settings.crashReports ? event : null),
  });
  Sentry.setUser({ id: clientId() });
  Sentry.setTags({ platform: platformName, store, lang, mobile: MOBILE, native: isNativeApp });
  Sentry.setContext('graphics', { gpu: settings.gpu, preset: settings.preset, tier: settings.autoTier, scale: settings.autoScale });
}

// Bug reports (bugreport.js) link to the last crash so both can be read together.
export const lastCrashId = () => (sentryOn ? Sentry.lastEventId() || '' : '');

// Something the game noticed without throwing (WebGL context lost, a failed load, ...).
export function reportProblem(message, extra = {}) {
  if (sentryOn && settings.crashReports) Sentry.captureMessage(message, { level: 'warning', extra });
}

// Last steps before a crash (map loaded, match started, ...), shown on the Sentry issue.
export function breadcrumb(message, data) {
  if (sentryOn) Sentry.addBreadcrumb({ category: 'game', message, data });
}

/* ------------------------------ PostHog ------------------------------ */

let posthog = null, loading = false;
const queue = []; // events captured before posthog-js finished loading
function startPostHog() {
  if (!ENABLED || !settings.analytics) return;
  if (posthog) { posthog.opt_in_capturing(); return; } // switched back on in Options
  if (loading) return;
  loading = true;
  // Loaded after the game started: it must not slow the first screen down.
  import('posthog-js/dist/module.slim.no-external').then(({ posthog: ph }) => {
    ph.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      defaults: '2026-08-30',
      bootstrap: { distinctID: clientId() },
      persistence: 'localStorage',
      person_profiles: 'identified_only', // anonymous events only: no person records
      autocapture: false, capture_pageview: false, capture_pageleave: false, capture_dead_clicks: false,
      disable_session_recording: true, disable_surveys: true, disable_web_experiments: true,
      advanced_disable_flags: true, capture_performance: false, capture_exceptions: false,
      disable_external_dependency_loading: true,
      ip: false,
    });
    ph.register(context());
    posthog = ph;
    if (!settings.analytics) { stopPostHog(); return; } // switched off while it loaded
    if (ph.has_opted_out_capturing()) ph.opt_in_capturing(); // off in an earlier session
    for (const [name, props] of queue.splice(0)) ph.capture(name, props);
  }).catch(e => console.warn('[analytics]', e)).finally(() => { loading = false; });
}
function stopPostHog() {
  queue.length = 0;
  if (posthog) posthog.opt_out_capturing();
}

// One game event. Properties: plain values only (no names typed by players).
export function track(name, props = {}) {
  if (!ENABLED || !settings.analytics) return;
  if (posthog) posthog.capture(name, props);
  else if (queue.length < 50) queue.push([name, props]);
}

// Properties that change during a session (auto quality moved to another tier).
function refreshContext() {
  if (posthog) posthog.register(context());
  if (sentryOn) Sentry.setContext('graphics', { gpu: settings.gpu, preset: settings.preset, tier: settings.autoTier, scale: settings.autoScale });
}

/* ------------------------------ frame rate during matches ------------------------------ */

// Frame times of the current match, summed up in one `match_performance` event when it ends.
const perf = { frames: 0, time: 0, slow: 0, hist: new Uint16Array(121), downshifts: 0, startTier: '' };
export function perfReset() {
  perf.frames = 0; perf.time = 0; perf.slow = 0; perf.hist.fill(0); perf.downshifts = 0;
  perf.startTier = settings.autoTier || '';
}
// dt in seconds, only while a match is actually on screen
export function perfFrame(dt) {
  if (!(dt > 0)) return;
  perf.frames++; perf.time += dt;
  if (dt > 1 / 30) perf.slow++;
  perf.hist[Math.min(120, Math.round(1 / dt))]++;
}
// FPS below which the slowest `share` of frames fall (0.05 -> the "5% low").
function lowFps(share) {
  let n = perf.frames * share;
  for (let f = 0; f <= 120; f++) { n -= perf.hist[f]; if (n <= 0) return f; }
  return 120;
}
export function perfReport(extra = {}) {
  if (perf.frames < 60) return;
  track('match_performance', {
    fps_avg: Math.round(perf.frames / perf.time), fps_low5: lowFps(0.05), fps_low1: lowFps(0.01),
    slow_frames_pct: Math.round(perf.slow / perf.frames * 1000) / 10,
    tier_start: perf.startTier, tier_end: settings.autoTier || '', render_scale: settings.autoScale || 1,
    downshifts: perf.downshifts, gpu: (settings.gpu || '').slice(0, 120),
    screen: `${innerWidth}x${innerHeight}`, dpr: devicePixelRatio,
    ...extra,
  });
}

// Automatic quality moved one step (autoquality.js): down when the frame rate is too low.
export function qualityStep({ from, to, fps, down }) {
  if (down) perf.downshifts++;
  track('quality_auto_changed', { from, to, fps: Math.round(fps), direction: down ? 'down' : 'up' });
  refreshContext();
}

/* ------------------------------ start ------------------------------ */

export function installTelemetry() {
  if (settings.crashReports) startSentry();
  if (settings.analytics) startPostHog();
  onChange(key => {
    if (key === 'crashReports' && settings.crashReports) startSentry(); // turned off: beforeSend drops everything
    if (key === 'analytics') { if (settings.analytics) startPostHog(); else stopPostHog(); }
    if (key === 'preset') refreshContext();
  });
}
