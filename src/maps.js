// Map definitions. Each layout is the top-left quadrant incl. the centre row/column
// (index 12); the arena mirrors it 4 ways. Spawns ('S') sit at the same spots on every map.
//
//  X boundary   # wall (breakable)   B bush     W water    C power-cube crate
//  T lantern    K obstacle (cactus / boulder / stump, per theme)   I ice (walkable, slippery)
//  S spawn      . floor

export const MAPS = {
  oasis: {
    name: 'Oasis', weather: 'clear', tag: 'Clear skies',
    swatch: ['#f3cf8c', '#3fae5a'],
    layout: [
      'XXXXXXXXXXXXX',
      'X...BBB......',
      'X.S.BB...#..S',
      'X........#...',
      'XBB..WWT....C',
      'XBB..WW......',
      'X...C....BB..',
      'X.##.....BB..',
      'X..#..##.....',
      'X...T.....BBB',
      'X.C...BB..BBB',
      'X.....BB..#..',
      'X.S....T.#..C',
    ],
    ground: 'sand', checker: 'rgba(150,92,38,0.14)', outer: 'grass',
    wall: 'brick', wallCap: 0xf2c48a, wallTint: [0.08, 0.15, 0.86], debris: 0xd98a4c,
    bound: 'stone', boundCap: 0x6a6478, boundTint: [0.7, 0.08, 0.8],
    bush: [0.27, 0.35, 0.82], trees: { round: 0.65, pine: 0.35 }, water: 'water', obstacle: 'rock',
  },

  dunes: {
    name: 'Dune Storm', weather: 'sandstorm', tag: 'Sandstorm',
    swatch: ['#e88a4a', '#a8532a'],
    layout: [
      'XXXXXXXXXXXXX',
      'X............',
      'X.S..K...#..S',
      'X....##..#...',
      'X.K...T...K..',
      'X...BB..##...',
      'X.#.BB.......',
      'X.#....K...C.',
      'X.....###....',
      'X.C.K......BB',
      'X......BB..BB',
      'X..##..BB....',
      'X.S......K..C',
    ],
    ground: 'clay', checker: 'rgba(110,40,15,0.12)', outer: 'sand',
    wall: 'brick', wallCap: 0xe9a86e, wallTint: [0.04, 0.4, 0.78], debris: 0xc9643a,
    bound: 'stone', boundCap: 0x8a6a58, boundTint: [0.06, 0.25, 0.72],
    bush: [0.13, 0.5, 0.95], trees: { cactus: 0.7, dead: 0.3 }, water: 'none', obstacle: 'cactus',
  },

  grove: {
    name: 'Rainy Grove', weather: 'rain', tag: 'Rain & thunder',
    swatch: ['#3d6b4a', '#4a6f9a'],
    layout: [
      'XXXXXXXXXXXXX',
      'X.BBB....BBB.',
      'X.SBB..#...BS',
      'X..B...#.....',
      'X.....WWW..C.',
      'XBB..WWW..BB.',
      'XBB.WWT...BB.',
      'X..........##',
      'X.C..##..B...',
      'X....#..BBB..',
      'X.BB....BBB.C',
      'X.BB.T.......',
      'X.S....##...C',
    ],
    ground: 'forest', checker: 'rgba(0,0,0,0.12)', outer: 'grass', wet: true,
    wall: 'mossbrick', wallCap: 0x9aa593, wallTint: [0.3, 0.05, 0.85], debris: 0x8a8f86,
    bound: 'stone', boundCap: 0x5c5a66, boundTint: [0.62, 0.06, 0.7],
    bush: [0.3, 0.45, 0.72], trees: { round: 0.8, pine: 0.2 }, water: 'water', obstacle: 'stump',
  },

  frost: {
    name: 'Frost Peak', weather: 'snow', tag: 'Snowfall · slippery ice',
    swatch: ['#eef4ff', '#7fb0e6'],
    layout: [
      'XXXXXXXXXXXXX',
      'X......BB....',
      'X.S....BB...S',
      'X...K.......K',
      'X.##..IIII...',
      'X.#..IIIIII..',
      'X...IIIIIII.C',
      'X.BB.IIIII...',
      'X.BB..III..#.',
      'X.......T..#.',
      'X.C..K.......',
      'X......BB..##',
      'X.S....BB....',
    ],
    ground: 'snow', checker: 'rgba(90,120,180,0.08)', outer: 'snow', snow: true,
    wall: 'icestone', wallCap: 0xf6f9ff, wallTint: [0.6, 0.12, 0.92], debris: 0xcfdcf0,
    bound: 'icestone', boundCap: 0xf0f5ff, boundTint: [0.62, 0.18, 0.7],
    bush: [0.36, 0.25, 0.95], trees: { pine: 1 }, water: 'none', obstacle: 'boulder',
  },

  marsh: {
    name: 'Misty Marsh', weather: 'fog', tag: 'Fog · limited vision',
    vision: 8.5, // world units you can see around your brawler; brawlers beyond it are hidden
    swatch: ['#5f6b4a', '#9fb3a4'],
    layout: [
      'XXXXXXXXXXXXX',
      'X.BB......BB.',
      'X.SB..WW...BS',
      'X....WWW.T...',
      'XBB..WW..##..',
      'XBB.......#.C',
      'X...T..BB....',
      'X.C....BB.WW.',
      'X..##....WWW.',
      'X........WWB.',
      'X.BBB.K......',
      'X.BBB.....T..',
      'X.S.......BBB',
    ],
    ground: 'mud', checker: 'rgba(0,0,0,0.1)', outer: 'grass', wet: true,
    wall: 'mossbrick', wallCap: 0x7d8672, wallTint: [0.25, 0.08, 0.75], debris: 0x7a7f70,
    bound: 'stone', boundCap: 0x4c4a55, boundTint: [0.6, 0.05, 0.62],
    bush: [0.22, 0.35, 0.62], trees: { dead: 0.5, round: 0.5 }, water: 'swamp', obstacle: 'stump',
  },
};

export const MAP_KEYS = Object.keys(MAPS);
