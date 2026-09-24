// The bots' difficulty is never chosen: it follows the player. Solo and private rooms use this
// hidden level (0..1, kept on the device) that follows the results: winning or finishing high
// moves it up, going out early moves it down, in small steps. Matchmaking uses the hidden MMR the
// server keeps instead (worker/ranking.js). Bots of a match are a mix around it (game.js makeRoster).

const KEY = 'iaslop-level';
let rating = 0.3; // new players start on the gentle side
try { const v = parseFloat(localStorage.getItem(KEY)); if (Number.isFinite(v)) rating = v; } catch { /* private mode */ }

export const levelOf = r => Math.round(r * 9) + 1; // 1..10, for display

// What the bots are tuned to for the next match.
export function botLevel() { return rating; }
export function playerLevel() { return levelOf(rating); }

// After a match: rank 1..8. Returns { before, after } levels (1..10) for the result screen.
export function recordResult(rank, won) {
  const before = levelOf(rating);
  const perf = (8 - Math.min(8, Math.max(1, rank))) / 7; // 1 = winner, 0 = first out
  rating = Math.min(1, Math.max(0, rating + 0.1 * (perf - 0.5) + (won ? 0.04 : 0)));
  try { localStorage.setItem(KEY, rating.toFixed(3)); } catch { /* ignore */ }
  return { before, after: levelOf(rating) };
}
