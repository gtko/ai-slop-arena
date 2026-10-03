// The profile's economy constants (account level, level rewards, Bot League trophies, Trophy Road),
// the source of truth that godot/tools/export-data.mjs writes into godot/data/cosmetics.json for the
// Godot client (meta_profile.gd). Pure data: no DOM, no storage.

// XP from account level L to L + 1 (~55 XP a match).
export const xpFor = L => 100 + 20 * (L - 1);

// Levels pay Slop Coins (for brawlers and skins); a few milestones also give a prestige look that is never
// sold.
export const LEVEL_REWARDS = { 10: 'frame:3', 20: 'title:13', 25: 'frame:10', 30: 'title:14' };
export const levelCoins = L => 50 + 10 * Math.min(L, 20);

// Bot League: trophies from a match against bots, by placement (1st .. 8th).
export const TROPHY_DELTA = [10, 7, 5, 3, 1, -1, -3, -5];

// Trophy Road: rewards along your total trophies (every brawler counts).
export const ROAD = [
  [10, 'coins:100'], [25, 'coins:150'], [40, 'coins:150'], [60, 'icon:28'], [80, 'coins:200'], [100, 'coins:250'],
  [130, 'coins:250'], [160, 'coins:300'], [200, 'coins:300'], [240, 'coins:350'], [280, 'coins:350'], [330, 'coins:400'],
  [380, 'coins:400'], [440, 'coins:450'], [500, 'title:12'], [570, 'coins:500'], [650, 'coins:550'], [740, 'icon:29'],
  [850, 'coins:700'], [1000, 'title:14'],
];
