// Weekly Chaos (v0.13 LEVEL UP, A05): one mutator a week, the same for everyone (UTC weeks, from
// Monday). Solo players and room leaders switch it on; ranked matchmaking never uses it.
//   cubeRain      power cubes fall from the sky all match long
//   nightHunt     night falls: you see 9 m, the lanterns matter
//   gasBreath     the gas starts early and closes in fast
//   superRush     supers charge twice as fast
//   gadgetFrenzy  6 gadget charges and a 2 s lockout
// The rules live where they apply (game.js, poison timings, gadgets); this file only names them.

export const MUTATORS = ['cubeRain', 'nightHunt', 'gasBreath', 'superRush', 'gadgetFrenzy'];
export const MUT_ICONS = { cubeRain: '💎', nightHunt: '🌙', gasBreath: '☠️', superRush: '🌟', gadgetFrenzy: '🧰' };

// Week number from Monday 00:00 UTC (1970-01-05 was a Monday: day 4 of the epoch).
export const weekIndex = (now = Date.now()) => Math.floor((now / 864e5 + 3) / 7);
export const weeklyMutator = (now = Date.now()) => MUTATORS[weekIndex(now) % MUTATORS.length];
export const validMutator = m => MUTATORS.includes(m);
