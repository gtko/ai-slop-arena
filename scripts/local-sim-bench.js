// Offline match benchmark for the local room bundle (godot/local/sim_local.js), engine-agnostic:
// concatenate the bundle and this file, then run it with node (V8) or qjs (QuickJS):
//   cat godot/local/sim_local.js scripts/local-sim-bench.js > /tmp/b.js && node /tmp/b.js
//   qjs /tmp/b.js            (prepend `globalThis.DOJO = true;` for the training dojo)
// One human (stands still, fires now and then) vs 7 bots, 60 polls per simulated second.
// globalThis.FULL = true: the human cannot die, so the bots play a whole match (worst-case load).
(function () {
  const log = typeof print === 'function' ? print : console.log;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const L = globalThis.SlopLocal;
  const dojo = !!globalThis.DOJO;
  const map = globalThis.MAP || 'oasis';
  const full = !!globalThis.FULL;
  const t0 = now();
  if (globalThis.T_LOAD !== undefined) log('bundle eval ms: ' + Math.round(t0 - globalThis.T_LOAD));
  const id = L.open(JSON.stringify({ name: 'Bench', brawler: 'blaster', level: 0.45, dojo }));
  L.send(id, JSON.stringify({ t: 'map', map }));
  L.send(id, JSON.stringify({ t: 'start' }));
  const first = JSON.parse(L.poll(id, 0));
  const start = first.find(m => m.t === 'start');
  const tStart = now() - t0;
  L.send(id, JSON.stringify({ t: 'loaded' }));
  let snaps = 0, evs = 0, bytes = 0, me = null, over = false, simT = 0, fire = 0, k = 0;
  const steps = [], dt = 1 / 60, maxT = globalThis.MAXT || (dojo ? 30 : 300), buckets = [];
  while (!over && simT < maxT) {
    simT += dt;
    if (k++ % 3 === 0 && me) L.send(id, JSON.stringify({ t: 'in', x: me[0], z: me[1], ax: 0, az: 1, px: me[0], pz: me[1] + 4, f: (fire++ % 10) < 2 ? 1 : 0, s: 0, g: 0, gx: 0, gz: 1, em: 0, ei: -1 }));
    if (full) { const g = L.room(id).match?.game, h = g && g.byId.get('local'); if (h && h.alive) h.hp = h.maxHp; }
    const a = now();
    const raw = L.poll(id, dt);
    steps.push(now() - a);
    const bk = Math.floor(simT / 10), g = L.room(id).match?.game;
    buckets[bk] = buckets[bk] || [0, 0];
    buckets[bk][0] += steps[steps.length - 1];
    if (g) buckets[bk][1] = g.brawlers.filter(b => b.alive).length;
    bytes += raw.length;
    for (const m of JSON.parse(raw)) {
      if (m.t === 'snap') { snaps++; if (m.me) me = m.me; }
      else if (m.t === 'ev') evs += m.list.length;
      else if (m.t === 'room' && !m.inMatch) over = true;
      else if (m.t === 'error') log('ERROR ' + m.msg);
    }
  }
  steps.sort((x, y) => x - y);
  const sum = steps.reduce((s, x) => s + x, 0);
  const q = p => +steps[Math.min(steps.length - 1, Math.floor(steps.length * p))].toFixed(3);
  log(JSON.stringify({
    map: start && start.map, dojo, full, roster: start && start.roster.length, setupMs: Math.round(tStart), simSeconds: Math.round(simT), over,
    polls: steps.length, meanMs: +(sum / steps.length).toFixed(3), p50: q(0.5), p95: q(0.95), p99: q(0.99), maxMs: +steps[steps.length - 1].toFixed(2),
    cpuMsPerSimSecond: Math.round(sum / simT), snaps, events: evs, kbPerSimSecond: +(bytes / 1024 / simT).toFixed(1),
  }));
  if (globalThis.BUCKETS) log('per 10 s [cpu ms per sim s, alive]: ' + JSON.stringify(buckets.map(b => [Math.round(b[0] / 10), b[1]])));
})();
