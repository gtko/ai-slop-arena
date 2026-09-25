// Google Play phone screenshots (2608x1304) without a phone: Electron emulates a landscape touch phone
// (872x436 CSS px at 3x like the phone the first ones came from, coarse pointer, French UI) on the dev server, lets the brawler fight on its
// own (a bot brain), and saves google-play/screenshot-*.png. The menu shot is taken first.
// Usage (dev server running): npx electron art-src/gp_screenshots.cjs [http://localhost:5173]
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const BASE = process.argv.find(a => a.startsWith('http')) || 'http://localhost:5173';
const OUT = path.join(__dirname, '..', 'google-play');
// menu map cards: 0 random, 1 oasis, 2 dunes, 3 grove, 4 frost, 5 marsh
const SHOTS = [
  ['screenshot-1-dunes_0', 'bomber', 2],
  ['screenshot-2-frost_0', 'gunslinger', 4],
  ['screenshot-3-grove_0', 'blaster', 3],
  ['screenshot-4-oasis_1', 'gunslinger', 1],
  ['screenshot-5-marsh_0', 'bomber', 5],
  ['screenshot-6-dunes_1', 'blaster', 2],
];
const PHONE = `
  const mm = window.matchMedia.bind(window);
  window.matchMedia = q => /pointer:\\s*coarse/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} }
    : /pointer:\\s*fine|hover:\\s*hover/.test(q) ? { matches: false, media: q, addEventListener() {}, removeEventListener() {} } : mm(q);
  Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr'] });
  Object.defineProperty(navigator, 'language', { get: () => 'fr-FR' });
`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// the main process' stdout is detached on Windows: progress goes to google-play/.screenshots.log
const log = (...a) => fs.appendFileSync(path.join(OUT, '.screenshots.log'), a.join(' ') + '\n');
process.on('unhandledRejection', e => { log('error', e && e.stack || e); app.quit(); });

app.commandLine.appendSwitch('ignore-gpu-blocklist');
// keep rendering while other windows cover this one (Windows occlusion would freeze rAF and the game)
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 872, height: 436, useContentSize: true, webPreferences: { backgroundThrottling: false } });
  const dbg = win.webContents.debugger;
  dbg.attach('1.3');
  await win.loadURL('about:blank'); // CDP emulation commands hang until a page exists
  await dbg.sendCommand('Page.enable');
  await dbg.sendCommand('Emulation.setDeviceMetricsOverride', { width: 872, height: 436, deviceScaleFactor: 3, mobile: true });
  await dbg.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: PHONE });
  const js = code => win.webContents.executeJavaScript(code, true);
  const shot = async name => {
    const { data } = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const img = nativeImage.createFromBuffer(Buffer.from(data, 'base64')).resize({ width: 2608, height: 1304, quality: 'best' });
    fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
    log('saved', name);
  };
  const boot = async () => {
    await win.loadURL(`${BASE}/play.html`);
    for (let i = 0; i < 120; i++) {
      const state = await js(`[!!window.__arena, (document.body.innerText.match(/\d+%/) || [''])[0]]`);
      if (i % 10 === 0) log('loading', JSON.stringify(state));
      if (state[0] && (state[1] === '100%' || state[1] === '')) break; // the loader's percentage goes away once ready
      await sleep(1000);
    }
    await sleep(4000);
  };

  await boot();
  await sleep(8000); // the loading screen fades out
  await shot('screenshot-7-menu');
  for (const [name, type, map] of SHOTS) {
    await boot();
    await js(`(() => {
      [...document.querySelectorAll('.card')].find(c => c.textContent.toLowerCase().includes('${type}'))?.click();
      [...document.querySelectorAll('#maps > *')][${map}]?.click();
      document.querySelector('#play').click();
    })()`);
    await sleep(9000); // spawn shield and calm bots
    await js(`import('/src/ai.js').then(({ BotBrain }) => {
      const g = window.__arena.game, p = g.brawlers.find(b => b.isPlayer);
      g.brains.set(p, new BotBrain(g, p));
    })`);
    // shoot once the brawler is in a fight (an enemy within 8 m), 40 s at most
    for (let i = 0; i < 40; i++) {
      await sleep(1000);
      if (await js(`(() => { const g = window.__arena.game, p = g.brawlers.find(b => b.isPlayer);
        return p.alive && g.brawlers.some(o => o !== p && o.alive && o.pos.distanceTo(p.pos) < 8); })()`)) break;
    }
    await sleep(1200);
    await shot(name);
  }
  app.quit();
});
