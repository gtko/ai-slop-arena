"""Cut Noto Color Emoji down to the emoji the game uses (no dependencies, Python 3).

Godot renders the font's OT-SVG table (ThorVG) and ignores COLRv1, so the COLR/CPAL tables are
dropped and the SVG table keeps only the documents of the glyphs the client can show: every
character >= U+2000 found in scripts/*.gd and data/**/*.json (icons, emotes, cosmetics, i18n),
plus EXTRA below. The other emoji are left out (they draw nothing: the system font, if any, takes over).

    python godot/tools/subset-emoji.py [art-src/fonts/NotoColorEmoji.ttf: the full font, github.com/googlefonts/noto-emoji]

Writes godot/assets/fonts/NotoColorEmoji-game.ttf (1.5 MB instead of 25), then run
`node godot/tools/fit-font-metrics.mjs` (line metrics, see there). Re-run both after
adding an emoji anywhere in the client. Font license: SIL OFL 1.1.
"""
import glob, os, re, struct, sys
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'assets', 'fonts', 'NotoColorEmoji-game.ttf')
# Text-style symbols the game writes without U+FE0F (settings arrows, like the web's buttons): Noto
# draws them as blue emoji keys, the symbol fonts (fonts.gd) as plain triangles
TEXT_STYLE = '◀▶'
# Emoji people often type in names / room chat, kept in colour too
EXTRA = '😀😁😂🤣😃😄😅😆😉😊😋😎😍😘🙂🤗🤩🤔😐😑😶🙄😏😣😥😮😯😪😫😴😌😛😜😝🤤😒😓😔😕🙃🤑😲😖😞😟😤😢😭😦😧😨😩🤯😬😰😱🥵🥶😳🤪😵😡😠🤬😷🤒🤕🤢🤮🤧😇🥳🥺🤠🤡🤥🤫🤭🧐🤓😈👿👹👺💀👻👽🤖💩😺👍👎👊✊👏🙌🙏💪🔥💯⭐🌟✨⚡💥❤️🧡💛💚💙💜🖤🤍💔🎉🎮🏆👑💎🚀🍕🐸🦄🐱🐶🪙💰🎁🎯🏅🥇🥈🥉'


def tables(d):
    n = struct.unpack('>H', d[4:6])[0]
    out = {}
    for i in range(n):
        tag, _cs, off, ln = struct.unpack('>4sIII', d[12 + 16 * i:28 + 16 * i])
        out[tag] = d[off:off + ln]
    return out


def cmap_lookup(cm):
    """codepoint -> glyph id from the best cmap subtable (format 12, else 4)."""
    n = struct.unpack('>H', cm[2:4])[0]
    subs = [struct.unpack('>HHI', cm[4 + 8 * i:12 + 8 * i]) for i in range(n)]
    m = {}
    for _p, _e, off in subs:
        fmt = struct.unpack('>H', cm[off:off + 2])[0]
        if fmt == 12:
            ng = struct.unpack('>I', cm[off + 12:off + 16])[0]
            for g in range(ng):
                a, b, gid = struct.unpack('>III', cm[off + 16 + 12 * g:off + 28 + 12 * g])
                for c in range(a, b + 1):
                    m[c] = gid + c - a
        elif fmt == 4 and not m:
            seg = struct.unpack('>H', cm[off + 6:off + 8])[0] // 2
            ends = struct.unpack('>%dH' % seg, cm[off + 14:off + 14 + 2 * seg])
            p = off + 16 + 2 * seg
            starts = struct.unpack('>%dH' % seg, cm[p:p + 2 * seg])
            deltas = struct.unpack('>%dh' % seg, cm[p + 2 * seg:p + 4 * seg])
            ro_at = p + 4 * seg
            ros = struct.unpack('>%dH' % seg, cm[ro_at:ro_at + 2 * seg])
            for s in range(seg):
                for c in range(starts[s], ends[s] + 1):
                    if c == 0xFFFF:
                        continue
                    if ros[s] == 0:
                        g = (c + deltas[s]) & 0xFFFF
                    else:
                        q = ro_at + 2 * s + ros[s] + 2 * (c - starts[s])
                        g = struct.unpack('>H', cm[q:q + 2])[0]
                        g = (g + deltas[s]) & 0xFFFF if g else 0
                    if g:
                        m[c] = g
    return m


def build_cmap(m):
    """A cmap with a format 4 (BMP) and a format 12 (all) subtable, Unicode + Windows platforms."""
    cps = sorted(m)
    groups = []   # [start, end, first gid] runs of consecutive codepoints and gids
    for c in cps:
        if groups and c == groups[-1][1] + 1 and m[c] == groups[-1][2] + c - groups[-1][0]:
            groups[-1][1] = c
        else:
            groups.append([c, c, m[c]])
    f12 = b''.join(struct.pack('>III', a, b, g) for a, b, g in groups)
    f12 = struct.pack('>HHIII', 12, 0, 16 + len(f12), 0, len(groups)) + f12
    segs = [(a, b, g) for a, b, g in groups if b <= 0xFFFF] + [(0xFFFF, 0xFFFF, 0)]
    n = len(segs)
    es = 1
    while es * 2 <= n:
        es *= 2
    ends = b''.join(struct.pack('>H', b) for a, b, g in segs)
    starts = b''.join(struct.pack('>H', a) for a, b, g in segs)
    deltas = b''.join(struct.pack('>H', (g - a) & 0xFFFF if (a, g) != (0xFFFF, 0) else 1) for a, b, g in segs)
    ros = bytes(2) * n
    body = struct.pack('>HHHH', 2 * n, 2 * es, es.bit_length() - 1, 2 * n - 2 * es) + ends + bytes(2) + starts + deltas + ros
    f4 = struct.pack('>HHH', 4, 6 + len(body), 0) + body
    head = struct.pack('>HH', 0, 4)
    o4, o12 = 4 + 8 * 4, 4 + 8 * 4 + len(f4)
    recs = struct.pack('>HHI', 0, 3, o4) + struct.pack('>HHI', 0, 4, o12) + struct.pack('>HHI', 3, 1, o4) + struct.pack('>HHI', 3, 10, o12)
    return head + recs + f4 + f12


def used_codepoints():
    cps = {ord(c) for c in EXTRA}
    files = glob.glob(os.path.join(ROOT, 'scripts', '*.gd')) + glob.glob(os.path.join(ROOT, 'data', '**', '*.json'), recursive=True)
    for f in files:
        for ch in open(f, encoding='utf-8').read():
            if ord(ch) >= 0x2000:
                cps.add(ord(ch))
    return cps


def sfnt(ver, tabs):
    def csum(b):
        b = b + b'\0' * ((4 - len(b) % 4) % 4)
        return sum(struct.unpack('>%dI' % (len(b) // 4), b)) & 0xFFFFFFFF
    items = sorted(tabs.items())
    n = len(items)
    es = 1
    while es * 2 <= n:
        es *= 2
    head = ver + struct.pack('>HHHH', n, es * 16, es.bit_length() - 1, n * 16 - es * 16)
    off = 12 + 16 * n
    dirs, body = b'', b''
    for tag, data in items:
        if tag == b'head':
            data = data[:8] + b'\0\0\0\0' + data[12:]
        dirs += struct.pack('>4sIII', tag, csum(data), off + len(body), len(data))
        body += data + b'\0' * ((4 - len(data) % 4) % 4)
    out = bytearray(head + dirs + body)
    i = [t for t, _ in items].index(b'head')
    hoff = struct.unpack('>I', out[12 + 16 * i + 8:12 + 16 * i + 12])[0]
    out[hoff + 8:hoff + 12] = struct.pack('>I', (0xB1B0AFBA - csum(bytes(out))) & 0xFFFFFFFF)
    return bytes(out)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(ROOT), 'art-src', 'fonts', 'NotoColorEmoji.ttf')
    d = open(src, 'rb').read()
    t = tables(d)
    cmap = cmap_lookup(t[b'cmap'])
    for c in TEXT_STYLE:   # left to the text fonts (see TEXT_STYLE)
        cmap.pop(ord(c), None)
    # only the kept emoji stay in cmap: Godot picks the first font that has a character, so an emoji
    # without its SVG document would draw nothing instead of falling through to the next font
    gids = {cmap[c] for c in used_codepoints() if c in cmap}
    cmap = {c: g for c, g in cmap.items() if g in gids}
    t[b'cmap'] = build_cmap(cmap)
    s = t[b'SVG ']
    lo = struct.unpack('>I', s[2:6])[0]
    cnt = struct.unpack('>H', s[lo:lo + 2])[0]
    recs = [struct.unpack('>HHII', s[lo + 2 + 12 * i:lo + 14 + 12 * i]) for i in range(cnt)]
    # one small document per glyph: Noto packs most glyphs in one 14 MB document (shared <defs>), and
    # ThorVG parses the whole document for every glyph it draws (a hitch per new emoji on phones)
    entries = []   # (gid, svg bytes)
    for a, b, o, l in recs:
        want = sorted(g for g in gids if a <= g <= b)
        if not want:
            continue
        doc = s[lo + o:lo + o + l]
        if a == b:
            entries.append((a, doc))
        else:
            entries += split_doc(doc, want)
    entries.sort()
    base = 2 + 12 * len(entries)
    docs, rows = b'', b''
    for g, doc in entries:
        rows += struct.pack('>HHII', g, g, base + len(docs), len(doc))
        docs += doc
    t[b'SVG '] = struct.pack('>HII', 0, 10, 0) + struct.pack('>H', len(entries)) + rows + docs
    keep = entries
    cnt = '%d (split)' % cnt
    # outlines (glyf) only for the kept glyphs: the others draw nothing anyway (no SVG document)
    long_loca = struct.unpack('>h', t[b'head'][50:52])[0] == 1
    loca = t[b'loca']
    ng = len(loca) // (4 if long_loca else 2) - 1
    offs = (struct.unpack('>%dI' % (ng + 1), loca) if long_loca
            else [2 * v for v in struct.unpack('>%dH' % (ng + 1), loca)])
    glyf, new_offs = b'', []
    for g in range(ng):
        new_offs.append(len(glyf))
        if g in gids or g == 0:
            part = t[b'glyf'][offs[g]:offs[g + 1]]
            glyf += part + b'\0' * (len(part) % 2)
    new_offs.append(len(glyf))
    t[b'glyf'] = glyf
    t[b'loca'] = struct.pack('>%dI' % (ng + 1), *new_offs)
    t[b'head'] = t[b'head'][:50] + struct.pack('>h', 1) + t[b'head'][52:]
    for tag in (b'COLR', b'CPAL'):   # COLRv1: Godot 4.4 does not draw it (the SVG table is used)
        t.pop(tag, None)
    out = sfnt(d[:4], t)
    open(OUT, 'wb').write(out)
    print('%d glyphs in colour (%d SVG documents of %s), %s: %d bytes' % (len(gids), len(keep), cnt, OUT, len(out)))


SVG_NS = 'http://www.w3.org/2000/svg'
XL_NS = 'http://www.w3.org/1999/xlink'
REF = re.compile(r'#([A-Za-z_][\w.\-]*)')


def split_doc(doc, want):
    """[(gid, svg)] for the glyphs `want` of a shared document: each keeps its <g id="glyphN"> and
    the <defs> entries it references (transitively)."""
    ET.register_namespace('', SVG_NS)
    ET.register_namespace('xlink', XL_NS)
    root = ET.fromstring(doc)
    defs = [c for c in root if c.tag == '{%s}defs' % SVG_NS]
    items = [e for d in defs for e in d]
    owner = {}   # any id inside a defs entry -> index of that entry
    for i, e in enumerate(items):
        for sub in e.iter():
            if sub.get('id'):
                owner[sub.get('id')] = i
    text = [ET.tostring(e, encoding='unicode') for e in items]
    glyphs = {c.get('id'): c for c in root if c.tag == '{%s}g' % SVG_NS}
    out = []
    for g in want:
        el = glyphs.get('glyph%d' % g)
        if el is None:
            continue
        body = ET.tostring(el, encoding='unicode')
        need, todo = set(), [body]
        while todo:
            for ref in REF.findall(todo.pop()):
                i = owner.get(ref)
                if i is not None and i not in need:
                    need.add(i)
                    todo.append(text[i])
        defs_xml = ''.join(text[i] for i in sorted(need))
        svg = ('<svg xmlns="%s" xmlns:xlink="%s" version="1.1"><defs>%s</defs>%s</svg>' % (SVG_NS, XL_NS, defs_xml, body))
        # ElementTree writes the namespace on every element it serialises on its own: drop the repeats
        svg = svg.replace(' xmlns="%s"' % SVG_NS, '').replace(' xmlns:xlink="%s"' % XL_NS, '')
        svg = svg.replace('<svg version="1.1">', '<svg xmlns="%s" xmlns:xlink="%s" version="1.1">' % (SVG_NS, XL_NS), 1)
        out.append((g, svg.encode('utf-8')))
    return out


if __name__ == '__main__':
    main()
