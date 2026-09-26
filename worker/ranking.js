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
// Duo Showdown: per team placement (1st .. 4th).
const RP_BY_RANK_DUO = [30, 12, -4, -10];

// Where RP "should" be for a given MMR: players below it climb faster, above it drop faster, so
// the visible rank converges on the hidden skill without being a copy of it.
export const rpForMmr = mmr => Math.max(0, (mmr - 850) * 2);

// Bot skill (0..1, see game.js makeRoster) for a match around this MMR.
export const botLevelFor = mmr => Math.min(0.95, Math.max(0.05, 0.3 + (mmr - START_MMR) / 1200));

// Matchmaking: how far apart MMRs may be, growing with the oldest player's wait (ms).
export const mmrWindow = waitMs => 150 + (waitMs / 1000) * 2.5;

// players: [{ key, mmr, rp, matches, rank }] (humans of one match, rank 1..8; Duo: 1..4 per team).
// Returns [{ key, mmr, rp, matches, wins, delta, tier, prevTier }].
export function rate(players, { visible = true, duo = false } = {}) {
  const avg = players.reduce((s, p) => s + p.mmr, 0) / players.length;
  const last = duo ? 4 : 8, TABLE = duo ? RP_BY_RANK_DUO : RP_BY_RANK;
  return players.map(p => {
    const place = Math.min(last, Math.max(1, p.rank));
    const actual = (last - place) / (last - 1);                         // 1 = winner, 0 = first out
    const expected = 1 / (1 + 10 ** ((avg - p.mmr) / 400));             // vs the lobby (bots sit at avg)
    const k = (p.matches < 10 ? 60 : 30) * (players.length > 1 ? 1 : 0.5);
    const mmr = Math.round(p.mmr + k * (actual - expected) * 2);
    let delta = 0;
    if (visible) {
      delta = TABLE[place - 1];
      const target = rpForMmr(mmr);
      if (delta > 0 && p.rp < target - 100) delta = Math.round(delta * 1.5); // underrated: climb faster
      if (delta < 0 && p.rp > target + 100) delta = Math.round(delta * 1.5); // overrated: drop faster
      delta = Math.max(-p.rp, delta);                                      // never below 0
    }
    const rp = p.rp + delta;
    return { key: p.key, mmr, rp, delta, matches: p.matches + 1, win: p.rank === 1, tier: tierOf(rp), prevTier: tierOf(p.rp) };
  });
}

// Group players for a match: the oldest ticket waits the longest, so it anchors the group; the
// closest MMRs within the window join it. Once the anchor has waited forceAt, the match starts with
// the closest tickets queued, whatever their MMR (a match with humans beats one with bots), and bots
// fill the rest. A ticket is a player or a party (size: its players; the whole party or nothing).
// Returns the tickets (their sizes add up to `size` at most) or null.
export function pickGroup(queue, now, size = 8, forceAt = 60 * 1000) {
  if (!queue.length) return null;
  const q = [...queue].sort((a, b) => a.joined - b.joined);
  const anchor = q[0], waited = now - anchor.joined, n = e => e.size || 1;
  const byGap = list => list.sort((a, b) => Math.abs(a.mmr - anchor.mmr) - Math.abs(b.mmr - anchor.mmr));
  const fill = list => {
    const out = [];
    let k = 0;
    for (const e of list) if (k + n(e) <= size) { out.push(e); k += n(e); }
    return [out, k];
  };
  const [near, k] = fill([anchor, ...byGap(q.slice(1).filter(p => Math.abs(p.mmr - anchor.mmr) <= mmrWindow(waited)))]);
  if (k >= size) return near;
  if (waited >= forceAt) return fill([anchor, ...byGap(q.slice(1))])[0];
  return null;
}

// A party's MMR: mostly its best player's, so a strong player cannot drag a weak friend into easy matches.
export const partyMmr = mmrs => Math.max(...mmrs) * 0.6 + mmrs.reduce((s, x) => s + x, 0) / mmrs.length * 0.4;
