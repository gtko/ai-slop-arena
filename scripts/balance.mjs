// Balance report: headless bot tournaments on the real game rules (worker/build/sim.js, built by
// `npm run build`). Every match puts 8 bots of the same skill on a map with random brawlers; the
// report gives, per brawler, the average placement and the win / top-4 rates, overall and per map.
// Usage: npm run balance [-- matches]   (default 200 matches, ~1 minute)
// A brawler whose top-4 rate leaves the 40-60% band is worth a look (docs/roadmap.md, T01).
const { ServerMatch, makeRoster, BRAWLER_KEYS, MAP_KEYS } = await import(new URL('../worker/build/sim.js', import.meta.url));

const N = +process.argv[2] || 200;
const stats = {}; // `${map}|${brawler}` -> { n, rank, wins, top4 }
const add = (key, rank) => {
  const s = (stats[key] ||= { n: 0, rank: 0, wins: 0, top4: 0 });
  s.n++; s.rank += rank; s.wins += rank === 1; s.top4 += rank <= 4;
};

const t0 = performance.now();
for (let i = 0; i < N; i++) {
  const map = MAP_KEYS[i % MAP_KEYS.length];
  const roster = makeRoster([], { level: 0.6 });
  roster.forEach(r => { r.skill = 0.6; });
  const m = new ServerMatch({ map, roster, send() {}, sendTo() {}, onEnd() {}, onCheat() {} });
  const g = m.game;
  while (g.brawlers.filter(b => b.alive).length > 1 && g.time < 300) m.advance(0.05);
  for (const b of g.brawlers) {
    const rank = b.alive ? 1 : b.rank || 8;
    add(`${map}|${b.type.key}`, rank);
    add(`all|${b.type.key}`, rank);
  }
  if ((i + 1) % 25 === 0) process.stderr.write(`${i + 1}/${N} matches\r`);
}

const pct = v => `${Math.round(v * 100)}%`.padStart(5);
const row = (label, s) => `${label.padEnd(12)} ${String(s.n).padStart(5)} ${(s.rank / s.n).toFixed(2).padStart(6)} ${pct(s.wins / s.n)} ${pct(s.top4 / s.n)}${s.top4 / s.n < 0.4 || s.top4 / s.n > 0.6 ? '  <-' : ''}`;
console.log(`\n${N} bot matches in ${((performance.now() - t0) / 1000).toFixed(0)} s\n`);
for (const map of ['all', ...MAP_KEYS]) {
  console.log(`${map === 'all' ? 'ALL MAPS' : map.toUpperCase()}\n${'brawler'.padEnd(12)} ${'games'.padStart(5)} ${'place'.padStart(6)} ${'win'.padStart(5)} ${'top4'.padStart(5)}`);
  for (const k of BRAWLER_KEYS) if (stats[`${map}|${k}`]) console.log(row(k, stats[`${map}|${k}`]));
  console.log('');
}
