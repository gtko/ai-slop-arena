// Cosmetics, wave 1 (v0.13 LEVEL UP, P05): recolour skins, golden figurines, trails, K.O. effects,
// emotes, frames, titles and profile icons. Looks only: nothing here changes a rule.
//
// Every list is append-only: an item is known by its index, which travels on the network in the
// `cos` string ('skin.trail.ko.frame.title.icon', e.g. '2.1.0.3.4.7') so everyone sees your looks.
// Pure data (no three.js): the server validates `cos` with it too.

// Skins: 0 is the figurine as painted. 1-2 are recolours (a hue turn, saturation and brightness on
// the texture, per brawler so each one reads well), 3 is the golden figurine of mastery 10.
export const SKINS = ['default', 'candy', 'shadow', 'gold'];
export const RECOLOURS = {
  blaster: { candy: [2.6, 1.25, 1.08], shadow: [3.6, 0.7, 0.72] },
  gunslinger: { candy: [-1.2, 1.2, 1.05], shadow: [2.3, 0.75, 0.7] },
  bomber: { candy: [3.1, 1.2, 1.05], shadow: [4.2, 0.6, 0.7] },
  frostbite: { candy: [2.4, 1.3, 1.05], shadow: [3.3, 0.8, 0.68] },
  volt: { candy: [1.9, 1.3, 1.05], shadow: [-1.6, 0.9, 0.7] },
};
export const GOLD_AT = 10; // mastery level that gives the golden figurine

// Trails behind a running brawler (effects.js draws them).
export const TRAILS = ['none', 'sparkle', 'bubbles', 'flames', 'hearts', 'pixels'];
export const TRAIL_ICONS = ['🚫', '✨', '🫧', '🔥', '💗', '👾'];

// K.O. effects: what bursts out of a brawler you knock out, on top of the usual K.O.
export const KOFX = ['none', 'confetti', 'pixels', 'fireworks', 'slime', 'stars'];
export const KOFX_ICONS = ['🚫', '🎉', '🟪', '🎆', '🟢', '⭐'];

// Emotes: a sticker above your head for 2 s (emote wheel, key B / D-pad down / the 😀 button).
// Using one reveals you in a bush for a moment: no taunting from hiding.
export const EMOTES = ['gg', 'thumbs', 'wave', 'lol', 'cool', 'angry', 'cry', 'love', 'shock', 'sleep', 'clown', 'skull'];
export const EMOTE_ICONS = ['🤝', '👍', '👋', '😂', '😎', '😡', '😭', '😍', '😱', '😴', '🤡', '💀'];
export const EMOTE_FREE = ['gg', 'thumbs', 'wave', 'lol'];

// Frames around your portrait (lobby, loading screen, podium) and titles under your name.
export const FRAMES = ['none', 'wood', 'silver', 'gold', 'slime', 'neon', 'frost', 'flame', 'royal', 'pixel', 'diamond'];
export const TITLES = ['none', 'rookie', 'brawler', 'bushGoblin', 'cubeHoarder', 'gasDodger', 'botBully', 'mvp', 'survivor',
  'showoff', 'chaosAgent', 'quester', 'golden', 'legend', 'slopLord'];

// Profile icons: the 5 brawler portraits (free) and 25 stickers.
export const ICONS = ['p:blaster', 'p:gunslinger', 'p:bomber', 'p:frostbite', 'p:volt',
  '🦊', '🐸', '🐙', '🦖', '🐧', '🦄', '🐝', '🍄', '🌵', '🍕', '🍩', '🎮', '🎲', '🧠', '🤖', '👽', '👻', '🎃', '🌈', '⚡', '💎', '🔥', '🌙', '🏆', '👑'];

// What a new player owns. Keys: 'skin:<brawler>:<n>', 'trail:<n>', 'ko:<n>', 'emote:<id>', 'frame:<n>', 'title:<n>', 'icon:<n>'.
export const FREE = ['title:1', ...EMOTE_FREE.map(e => 'emote:' + e), 'icon:0', 'icon:1', 'icon:2', 'icon:3', 'icon:4'];

// Price in Slop Coins (earned only by playing: there is nothing to buy with money).
export const PRICE = { skin: 750, trail: 400, ko: 450, emote: 150, frame: 300, title: 200, icon: 100 };

// Every item the shop may offer: recolours, trails, K.O. effects, emotes, frames, titles, icons.
// Rewards of levels and the Trophy Road are left out (they are earned, not sold).
export function shopPool(brawlers) {
  const pool = [];
  for (const b of brawlers) for (const s of [1, 2]) pool.push(`skin:${b}:${s}`);
  for (let i = 1; i < TRAILS.length; i++) pool.push('trail:' + i);
  for (let i = 1; i < KOFX.length; i++) pool.push('ko:' + i);
  for (const e of EMOTES) if (!EMOTE_FREE.includes(e)) pool.push('emote:' + e);
  for (let i = 1; i < FRAMES.length; i++) pool.push('frame:' + i);
  for (let i = 2; i < TITLES.length; i++) pool.push('title:' + i);
  for (let i = 5; i < ICONS.length; i++) pool.push('icon:' + i);
  return pool.filter(id => !EARNED.has(id));
}
// Items only levels, the Trophy Road or mastery give.
export const EARNED = new Set(['frame:3', 'frame:10', 'title:13', 'title:14', 'title:12', 'title:11', 'icon:29', 'icon:28']);

export const kindOf = id => id.split(':')[0];
export const priceOf = id => PRICE[kindOf(id)] || 0;

// Network string: '0.0.0.0.1.0' = default skin, no trail, no K.O. effect, no frame, 'rookie', icon 0.
export const COS_DEFAULT = '0.0.0.0.1.0';
export const COS = /^\d{1,2}(\.\d{1,2}){5}$/;
export const validCos = s => typeof s === 'string' && COS.test(s);
export function parseCos(s) {
  const [skin, trail, ko, frame, title, icon] = (validCos(s) ? s : COS_DEFAULT).split('.').map(Number);
  const inRange = (v, list) => (v < list.length ? v : 0);
  return { skin: inRange(skin, SKINS), trail: inRange(trail, TRAILS), ko: inRange(ko, KOFX), frame: inRange(frame, FRAMES),
    title: inRange(title, TITLES), icon: inRange(icon, ICONS) };
}
export const cosString = c => [c.skin, c.trail, c.ko, c.frame, c.title, c.icon].join('.');
