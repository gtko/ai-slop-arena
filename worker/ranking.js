// Ranking maths (pure, tested by tests/ranking.test.mjs). Two numbers per player, kept by the
// server (Players object in worker/index.js), never by the client:
//   - MMR (hidden): Elo-style skill estimate. Matchmaking pairs players with close MMRs and tunes
//     the bots of a match to it. Every matchmade match moves it.
//   - RP (visible rank points) and their tier: what players see. Only matchmade matches with at
//     least 2 humans move it (a player alone with bots could farm them otherwise).

export const START_MMR = 1000;
export const TIERS = [['bronze', 0], ['silver', 200], ['gold', 500], ['diamond', 900], ['mythic', 1400], ['legend', 2000]];
export const tierOf = rp => TIERS.reduce((t, [name, min]) => (rp >= min ? name : t), 'bronze');

// RP per placement (1st .. 8th), like trophies: the top half gains, the bottom half loses.
const RP_BY_RANK = [30, 20, 12, 6, 0, -4, -8, -12];

// Where RP "should" be for a given MMR: players below it climb faster, above it drop faster, so
// the visible rank converges on the hidden skill without being a copy of it.
export const rpForMmr = mmr => Math.max(0, (mmr - 850) * 2);

// Bot skill (0..1, see game.js makeRoster) for a match around this MMR.
export const botLevelFor = mmr => Math.min(0.95, Math.max(0.05, 0.3 + (mmr - START_MMR) / 1200));

// Matchmaking: how far apart MMRs may be, growing with the oldest player's wait (ms).
export const mmrWindow = waitMs => 150 + (waitMs / 1000) * 2.5;

// players: [{ key, mmr, rp, matches, rank }] (humans of one match, rank 1..8).
// Returns [{ key, mmr, rp, matches, wins, delta, tier, prevTier }].
export function rate(players, { visible = true } = {}) {
  const avg = players.reduce((s, p) => s + p.mmr, 0) / players.length;
  return players.map(p => {
    const actual = (8 - Math.min(8, Math.max(1, p.rank))) / 7;            // 1 = winner, 0 = first out
    const expected = 1 / (1 + 10 ** ((avg - p.mmr) / 400));             // vs the lobby (bots sit at avg)
    const k = (p.matches < 10 ? 60 : 30) * (players.length > 1 ? 1 : 0.5);
    const mmr = Math.round(p.mmr + k * (actual - expected) * 2);
    let delta = 0;
    if (visible) {
      delta = RP_BY_RANK[Math.min(8, Math.max(1, p.rank)) - 1];
      const target = rpForMmr(mmr);
      if (delta > 0 && p.rp < target - 100) delta = Math.round(delta * 1.5); // underrated: climb faster
      if (delta < 0 && p.rp > target + 100) delta = Math.round(delta * 1.5); // overrated: drop faster
      delta = Math.max(-p.rp, delta);                                      // never below 0
    }
    const rp = p.rp + delta;
    return { key: p.key, mmr, rp, delta, matches: p.matches + 1, win: p.rank === 1, tier: tierOf(rp), prevTier: tierOf(p.rp) };
  });
}

// Group players for a match: the oldest player waits the longest, so they anchor the group; the
// closest MMRs within the window join them. Once the anchor has waited forceAt, the match starts with
// the closest players queued, whatever their MMR (a match with humans beats one with bots), and bots
// fill the rest. Returns the group (up to size) or null.
export function pickGroup(queue, now, size = 8, forceAt = 60 * 1000) {
  if (!queue.length) return null;
  const q = [...queue].sort((a, b) => a.joined - b.joined);
  const anchor = q[0], waited = now - anchor.joined;
  const near = q.filter(p => Math.abs(p.mmr - anchor.mmr) <= mmrWindow(waited))
    .sort((a, b) => Math.abs(a.mmr - anchor.mmr) - Math.abs(b.mmr - anchor.mmr));
  if (near.length >= size) return near.slice(0, size);
  if (waited >= forceAt) return q.sort((a, b) => Math.abs(a.mmr - anchor.mmr) - Math.abs(b.mmr - anchor.mmr)).slice(0, size);
  return null;
}
