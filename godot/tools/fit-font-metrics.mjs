// Fallback fonts with the line metrics of the game's faces.
//
// Godot's Font.get_height() (Label, Button, LineEdit line boxes) is the TALLEST ascent + descent of
// the font AND all its fallbacks: a fallback taller than Lilita One / Nunito (Noto Sans Arabic has
// 1.07 + 0.37 em) makes every line of every label taller, even pure Latin ones. So each fallback is
// rewritten with ascent / descent no bigger than Lilita One's (0.923 / 0.220 em): hhea and OS/2
// (typo + win) metrics only, the glyphs are untouched (marks may draw a bit outside the line box).
//
//   node godot/tools/fit-font-metrics.mjs                 # the set below, from Blender's OFL fonts
//   node godot/tools/fit-font-metrics.mjs <in> <out>      # one TTF / OTF / WOFF2 file
//
// The fonts below are SIL OFL 1.1 (Noto, Inter), copied from Blender's datafiles/fonts (no download).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ASC = 0.92, DESC = 0.22;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'assets', 'fonts');
const BLENDER = process.env.BLENDER_FONTS || 'C:/Program Files/Blender Foundation/Blender 5.2/5.2/datafiles/fonts';
const SET = [
  [path.join(OUT, 'NotoColorEmoji-game.ttf'), path.join(OUT, 'NotoColorEmoji-game.ttf')],   // after subset-emoji.py
  [path.join(BLENDER, 'NotoSansSymbols-VariableFont_wght.woff2'), path.join(OUT, 'NotoSansSymbols.woff2')],
  [path.join(BLENDER, 'NotoSansSymbols2-Regular.woff2'), path.join(OUT, 'NotoSansSymbols2.woff2')],
  [path.join(BLENDER, 'Inter.woff2'), path.join(OUT, 'Inter.woff2')],
  [path.join(BLENDER, 'NotoSansArabic-VariableFont_wdth,wght.woff2'), path.join(OUT, 'NotoSansArabic.woff2')],
  [path.join(BLENDER, 'NotoSansThai-VariableFont_wdth,wght.woff2'), path.join(OUT, 'NotoSansThai.woff2')],
];

// WOFF2 known table tags (index = 6-bit code in the table directory)
const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep',
  'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS',
  'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln',
  'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf',
  'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

// Patch hhea / OS/2 in place; tables: {tag: Buffer view}. Returns a description.
function fit(tables) {
  const upm = tables.head.readUInt16BE(18);
  const a = Math.floor(ASC * upm), d = Math.floor(DESC * upm);
  const h = tables.hhea;
  const before = `${(h.readInt16BE(4) / upm).toFixed(3)}/${(-h.readInt16BE(6) / upm).toFixed(3)}`;
  h.writeInt16BE(Math.min(h.readInt16BE(4), a), 4);
  h.writeInt16BE(Math.max(h.readInt16BE(6), -d), 6);
  h.writeInt16BE(0, 8);
  const o = tables['OS/2'];
  if (o && o.length >= 78) {
    o.writeInt16BE(Math.min(o.readInt16BE(68), a), 68);
    o.writeInt16BE(Math.max(o.readInt16BE(70), -d), 70);
    o.writeInt16BE(0, 72);
    o.writeUInt16BE(Math.min(o.readUInt16BE(74), a), 74);
    o.writeUInt16BE(Math.min(o.readUInt16BE(76), d), 76);
  }
  return `${before} -> ${(h.readInt16BE(4) / upm).toFixed(3)}/${(-h.readInt16BE(6) / upm).toFixed(3)}`;
}

function csum(b) {
  let s = 0;
  const pad = Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  for (let i = 0; i < pad.length; i += 4) s = (s + pad.readUInt32BE(i)) >>> 0;
  return s;
}

function sfnt(buf) {
  const n = buf.readUInt16BE(4);
  const tables = {}, dir = [];
  for (let i = 0; i < n; i++) {
    const p = 12 + 16 * i;
    const tag = buf.toString('latin1', p, p + 4), off = buf.readUInt32BE(p + 8), len = buf.readUInt32BE(p + 12);
    tables[tag] = buf.subarray(off, off + len);
    dir.push([p, tag]);
  }
  const info = fit(tables);
  // table checksums, then head.checkSumAdjustment
  tables.head.writeUInt32BE(0, 8);
  for (const [p, tag] of dir) buf.writeUInt32BE(csum(tables[tag]), p + 4);
  tables.head.writeUInt32BE((0xB1B0AFBA - csum(buf)) >>> 0, 8);
  return [buf, info];
}

function woff2(buf) {
  if (buf.readUInt32BE(28) || buf.readUInt32BE(40)) throw new Error('WOFF2 with metadata / private data: not handled');
  const n = buf.readUInt16BE(12), compLen = buf.readUInt32BE(20);
  let p = 48;
  const b128 = () => { let v = 0; for (;;) { const c = buf[p++]; v = v * 128 + (c & 127); if (!(c & 128)) return v; } };
  const dir = [];
  for (let i = 0; i < n; i++) {
    const fl = buf[p++];
    let tag;
    if ((fl & 63) === 63) { tag = buf.toString('latin1', p, p + 4); p += 4; } else tag = KNOWN[fl & 63];
    const orig = b128(), tv = (fl >> 6) & 3;
    const transformed = ((tag === 'glyf' || tag === 'loca') && tv === 0) || (tag === 'hmtx' && tv === 1);
    dir.push([tag, transformed ? b128() : orig]);
  }
  if (buf.toString('latin1', 4, 8) === 'ttcf') throw new Error('WOFF2 collections: not handled');
  const head = buf.subarray(0, p);
  const data = zlib.brotliDecompressSync(buf.subarray(p, p + compLen));
  const tables = {};
  let off = 0;
  for (const [tag, len] of dir) { tables[tag] = data.subarray(off, off + len); off += len; }
  if (off !== data.length) throw new Error(`WOFF2 stream size ${data.length} != tables ${off}`);
  const info = fit(tables);
  const comp = zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
    [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_FONT, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } });
  const body = Buffer.concat([Buffer.from(head), comp]);
  const out = Buffer.concat([body, Buffer.alloc((4 - (body.length % 4)) % 4)]);
  out.writeUInt32BE(out.length, 8);
  out.writeUInt32BE(comp.length, 20);
  return [out, info];
}

function run(src, dst) {
  const buf = Buffer.from(fs.readFileSync(src));
  const [out, info] = buf.toString('latin1', 0, 4) === 'wOF2' ? woff2(buf) : sfnt(buf);
  fs.writeFileSync(dst, out);
  console.log(`${path.basename(dst)}: ascent/descent ${info} em, ${out.length} bytes`);
}

const args = process.argv.slice(2);
if (args.length === 2) run(args[0], args[1]);
else for (const [s, d] of SET) run(s, d);
