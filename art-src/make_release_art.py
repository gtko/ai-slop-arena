"""Release-note graphics (banners + infographics) for the GitHub releases, in the game's style.

Output: docs/releases/img/*.png, referenced by docs/releases/v*.md (the release notes).
Usage: .ai3d/venv/Scripts/python.exe art-src/make_release_art.py   (needs Pillow, numpy, ffmpeg)
"""
import os, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'docs', 'releases', 'img')
UI = os.path.join(ROOT, 'public', 'assets', 'ui')
SITE = os.path.join(ROOT, 'public', 'assets', 'site')
MUSIC = os.path.join(ROOT, 'public', 'assets', 'music')
FONTS = os.path.join(ROOT, 'art-src', 'fonts')
EMOJI = 'C:/Windows/Fonts/seguiemj.ttf'
SYMBOL = 'C:/Windows/Fonts/seguisym.ttf'  # arrows and ticks Nunito does not have

INK = (22, 18, 31)
NIGHT = (15, 11, 30)
VIOLET = (58, 42, 110)
YELLOW = (255, 210, 63)
ORANGE = (255, 179, 0)
TEXT = (246, 243, 255)
MUTED = (189, 181, 220)
BRAWLERS = ['blaster', 'gunslinger', 'bomber', 'frostbite', 'volt']


def display(size):
    return ImageFont.truetype(os.path.join(FONTS, 'LilitaOne-Regular.ttf'), size)


def body(size, weight='ExtraBold'):
    f = ImageFont.truetype(os.path.join(FONTS, 'Nunito.ttf'), size)
    f.set_variation_by_name(weight)
    return f


def emoji(size):
    return ImageFont.truetype(EMOJI, size)


def sym(size):
    return ImageFont.truetype(SYMBOL, size)


def wrap(draw, text, font, width):
    lines, cur = [], ''
    for w in text.split():
        t = (cur + ' ' + w).strip()
        if draw.textlength(t, font=font) <= width: cur = t
        else: lines.append(cur); cur = w
    return lines + [cur]


def background(w, h, glow=(0.72, 0.45)):
    """Violet radial glow over the night colour, with soft light rays like the website hero."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = glow[0] * w, glow[1] * h
    d = np.sqrt(((x - cx) / (0.9 * w)) ** 2 + ((y - cy) / (1.1 * h)) ** 2)
    t = np.clip(d, 0, 1)[..., None]
    inner, outer = np.array((84, 57, 158), np.float32), np.array(NIGHT, np.float32)
    img = inner * (1 - t) ** 1.4 + outer * (1 - (1 - t) ** 1.4)
    ang = np.arctan2(y - cy, x - cx)
    rays = (np.sin(ang * 14) * 0.5 + 0.5) ** 6 * np.clip(1 - d, 0, 1) * 18
    img += rays[..., None]
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), 'RGB').convert('RGBA')


def outlined(draw, xy, text, font, fill, stroke=6, shadow=True, anchor='la'):
    x, y = xy
    if shadow:
        draw.text((x, y + 6), text, font=font, fill=(0, 0, 0, 90), stroke_width=stroke, stroke_fill=(0, 0, 0, 90), anchor=anchor)
    draw.text((x, y), text, font=font, fill=fill, stroke_width=stroke, stroke_fill=INK, anchor=anchor)


def pill(img, xy, text, font, fill, color=INK, icon=None, pad=(18, 9), radius=None):
    """Rounded label; returns its width. icon: an emoji drawn before the text."""
    d = ImageDraw.Draw(img)
    tw = d.textlength(text, font=font)
    iw = 0
    if icon:
        ef = emoji(int(font.size * 0.95))
        iw = ef.size + 10
    h = font.size + pad[1] * 2
    w = int(tw + iw + pad[0] * 2)
    x, y = xy
    d.rounded_rectangle((x, y, x + w, y + h), radius or h // 2, fill=fill, outline=INK, width=3)
    if icon:
        d.text((x + pad[0], y + h / 2), icon, font=ef, embedded_color=True, anchor='lm')
    d.text((x + pad[0] + iw, y + h / 2 + 1), text, font=font, fill=color, anchor='lm')
    return w


def crew(img, x0, bottom, height, names=BRAWLERS, gap=-40):
    """Brawler portraits side by side, bottom-aligned, with a drop shadow."""
    x = x0
    for n in names:
        p = Image.open(os.path.join(UI, f'{n}.png')).convert('RGBA')
        w = int(p.width * height / p.height)
        p = p.resize((w, height), Image.LANCZOS)
        sh = Image.new('RGBA', p.size, (0, 0, 0, 0))
        sh.putalpha(p.getchannel('A').point(lambda a: a * 0.45))
        sh = sh.filter(ImageFilter.GaussianBlur(8))
        img.alpha_composite(sh, (x + 8, bottom - height + 14))
        img.alpha_composite(p, (x, bottom - height))
        x += w + gap


def banner(version, title, subtitle, chips, name, crew_names=('blaster', 'gunslinger', 'bomber')):
    W, H = 1600, 560
    img = background(W, H)
    # the crew first (right-aligned, nobody cut off), so the text and chips always sit on top
    widths = [int(Image.open(os.path.join(UI, f'{n}.png')).width * 400 / 512) for n in crew_names]
    crew(img, W - 30 - (sum(widths) - 80 * (len(widths) - 1)), H + 20, 400, crew_names, gap=-80)
    d = ImageDraw.Draw(img)
    logo = Image.open(os.path.join(ROOT, 'docs', 'readme', 'logo.png')).convert('RGBA')
    lw = 470
    logo = logo.resize((lw, int(logo.height * lw / logo.width)), Image.LANCZOS)
    img.alpha_composite(logo, (70, 58))
    y = 58 + logo.height + 30
    vw = pill(img, (74, y), version, display(34), YELLOW, pad=(20, 8))
    pill(img, (74 + vw + 14, y + 4), 'RELEASE', body(20, 'Black'), (70, 52, 130, 255), color=TEXT, pad=(14, 7))
    outlined(d, (72, y + 70), title, display(82), TEXT, stroke=7)
    d.text((76, y + 170), subtitle, font=body(27, 'Bold'), fill=MUTED)
    x, cy = 74, H - 84
    for icon, text in chips:
        x += pill(img, (x, cy), text, body(22, 'Black'), (40, 30, 78, 255), color=TEXT, icon=icon, pad=(16, 10)) + 12
    img.convert('RGB').save(os.path.join(OUT, name), optimize=True)
    return img


def card(img, box, fill=(34, 26, 64, 235), outline=(110, 90, 180), radius=26):
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(box, radius, fill=fill, outline=outline, width=2)


# ------------------------------ v0.2.0: every platform ------------------------------

def v020():
    banner('v0.2.0', 'NOW EVERYWHERE', 'Steam, Epic, Android, iOS and the web, all playing together.',
           [('🏆', 'Steam achievements'), ('🔀', 'Cross-play'), ('📱', 'Touch controls'), ('🌍', '30 languages')],
           'v0.2.0-banner.png', ('volt', 'blaster', 'frostbite'))

    W, H = 1600, 720
    img = background(W, H, glow=(0.5, 0.2))
    d = ImageDraw.Draw(img)
    outlined(d, (W // 2, 50), 'ONE GAME, FIVE PLATFORMS', display(58), YELLOW, anchor='ma')
    cols = [
        ('🌐', 'Web', (123, 77, 255), ['No install', 'Rooms by code', 'Any browser']),
        ('🎮', 'Steam', (42, 95, 138), ['Achievements', 'Friend invites', 'P2P lobbies', 'Overlay']),
        ('🛒', 'Epic', (60, 60, 70), ['Your Epic name', 'Web rooms', 'No Steam needed']),
        ('🤖', 'Android', (61, 170, 90), ['Touch controls', 'Fullscreen', 'APK download']),
        ('🍏', 'iOS', (140, 140, 160), ['Touch controls', 'iPhone + iPad', 'Xcode project']),
    ]
    cw, gap, top = 272, 22, 150
    x0 = (W - (cw * 5 + gap * 4)) // 2
    for i, (ic, name, col, feats) in enumerate(cols):
        x = x0 + i * (cw + gap)
        card(img, (x, top, x + cw, top + 340))
        d.rounded_rectangle((x, top, x + cw, top + 96), 26, fill=col + (255,), outline=(110, 90, 180), width=2)
        d.rectangle((x + 2, top + 60, x + cw - 2, top + 96), fill=col + (255,))
        d.text((x + 26, top + 48), ic, font=emoji(44), embedded_color=True, anchor='lm')
        outlined(d, (x + 86, top + 26), name, display(42), TEXT, stroke=5, shadow=False)
        for k, f in enumerate(feats):
            fy = top + 130 + k * 56
            d.text((x + 26, fy + 2), '✔', font=sym(26), fill=YELLOW)
            d.text((x + 60, fy + 1), f, font=body(24, 'Bold'), fill=TEXT)
    # cross-play band
    by = top + 370
    card(img, (x0, by, W - x0, by + 150), fill=(255, 210, 63, 255), outline=INK, radius=30)
    d.text((x0 + 40, by + 75), '🔀', font=emoji(64), embedded_color=True, anchor='lm')
    d.text((x0 + 130, by + 30), 'Cross-play rooms', font=display(46), fill=INK)
    d.text((x0 + 132, by + 90), 'Every version meets in a room made on the web relay: share the code, play together.',
           font=body(25, 'Bold'), fill=INK)
    img.convert('RGB').save(os.path.join(OUT, 'v0.2.0-platforms.png'), optimize=True)

    # phone mock-up with the new touch controls over a real in-game capture
    W, H = 1600, 820
    img = background(W, H, glow=(0.3, 0.5))
    d = ImageDraw.Draw(img)
    pw, ph = 1000, 500
    px, py = 90, 200
    shot = Image.open(os.path.join(SITE, 'feat_battle.jpg')).convert('RGBA')
    s = max(pw / shot.width, ph / shot.height)
    shot = shot.resize((int(shot.width * s), int(shot.height * s)), Image.LANCZOS)
    shot = shot.crop(((shot.width - pw) // 2, (shot.height - ph) // 2, (shot.width + pw) // 2, (shot.height + ph) // 2))
    d.rounded_rectangle((px - 30, py - 30, px + pw + 30, py + ph + 30), 60, fill=(12, 10, 20), outline=(70, 60, 110), width=4)
    mask = Image.new('L', (pw, ph), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, pw, ph), 34, fill=255)
    img.paste(shot, (px, py), mask)
    ov = Image.new('RGBA', img.size, (0, 0, 0, 0))
    o = ImageDraw.Draw(ov)
    jx, jy = px + 190, py + ph - 150
    o.ellipse((jx - 90, jy - 90, jx + 90, jy + 90), fill=(255, 255, 255, 40), outline=(255, 255, 255, 150), width=5)
    o.ellipse((jx - 5, jy - 70, jx + 75, jy + 10), fill=(255, 255, 255, 220))
    ax, ay = px + pw - 140, py + ph - 140
    o.ellipse((ax - 85, ay - 85, ax + 85, ay + 85), fill=YELLOW + (255,), outline=INK, width=6)
    o.ellipse((ax - 38, ay - 38, ax + 38, ay + 38), fill=(22, 18, 31, 140))
    sx, sy = px + pw - 330, py + ph - 230
    o.ellipse((sx - 62, sy - 62, sx + 62, sy + 62), fill=ORANGE + (255,), outline=INK, width=6)
    o.ellipse((sx - 26, sy - 26, sx + 26, sy + 26), fill=(22, 18, 31, 150))
    o.rounded_rectangle((px + pw - 90, py + 24, px + pw - 24, py + 90), 18, fill=(40, 32, 60, 220), outline=INK, width=4)
    o.rectangle((px + pw - 68, py + 40, px + pw - 60, py + 74), fill=TEXT)
    o.rectangle((px + pw - 54, py + 40, px + pw - 46, py + 74), fill=TEXT)
    img.alpha_composite(ov)
    # numbered markers on the controls + a legend on the right
    notes = [((jx + 80, jy - 100), 'Move', 'the stick appears wherever your thumb lands'),
             ((ax + 70, ay - 95), 'Attack', 'tap: nearest enemy · drag: aim · release: fire'),
             ((sx - 72, sy - 72), 'Super', 'lights up when charged, drag to aim it'),
             ((px + pw - 120, py + 40), 'Pause', 'the Esc of touch screens')]
    outlined(d, (80, 40), 'TOUCH CONTROLS', display(58), YELLOW)
    d.text((82, 104), 'Android and iOS, Brawl Stars style. Phones play in landscape, full screen.',
           font=body(25, 'Bold'), fill=MUTED)
    lx = px + pw + 70
    for k, (pt, title, text) in enumerate(notes):
        n = str(k + 1)
        d.ellipse((pt[0] - 26, pt[1] - 26, pt[0] + 26, pt[1] + 26), fill=YELLOW, outline=INK, width=4)
        d.text(pt, n, font=display(32), fill=INK, anchor='mm')
        ly = py - 10 + k * 136
        card(img, (lx, ly, W - 50, ly + 120), radius=20)
        d.ellipse((lx + 18, ly + 18, lx + 62, ly + 62), fill=YELLOW, outline=INK, width=3)
        d.text((lx + 40, ly + 40), n, font=display(26), fill=INK, anchor='mm')
        d.text((lx + 78, ly + 16), title, font=display(32), fill=TEXT)
        for li, line in enumerate(wrap(d, text, body(21, 'Bold'), W - 50 - lx - 40)[:2]):
            d.text((lx + 22, ly + 66 + li * 26), line, font=body(21, 'Bold'), fill=MUTED)
    img.convert('RGB').save(os.path.join(OUT, 'v0.2.0-touch.png'), optimize=True)


# ------------------------------ v0.3.0: the soundtrack ------------------------------

def waveform(path, bars=90):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', '4000', '-f', 's16le', '-'],
                         capture_output=True, check=True).stdout
    a = np.abs(np.frombuffer(raw, np.int16).astype(np.float32))
    chunks = np.array_split(a, bars)
    v = np.array([np.sqrt(np.mean(c ** 2)) for c in chunks])
    return v / (v.max() or 1)


def duration(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                         capture_output=True, text=True).stdout
    s = float(out.strip())
    return f'{int(s // 60)}:{int(s % 60):02d}'


def v030():
    banner('v0.3.0', 'THE SOUNDTRACK', '10 new full-length songs, a playlist for every moment of the game.',
           [('🎸', '10 songs'), ('⚔️', 'Final showdown theme'), ('🌙', 'Night theme'), ('🔉', 'Quieter start (50%)')],
           'v0.3.0-banner.png', ('gunslinger', 'bomber', 'volt'))
    tracks = [
        ('Maps', [('m_oasis', 'Oasis', '🏝️'), ('m_dunes', 'Dune Storm', '🌪️'), ('m_grove', 'Rainy Grove', '🌧️'),
                  ('m_frost', 'Frost Peak', '❄️'), ('m_marsh', 'Misty Marsh', '🌫️')]),
        ('Moments', [('battle2', 'Battle II', '⚡'), ('final', 'Final Showdown', '⚔️'), ('night', 'Night Arena', '🌙'),
                     ('menu2', 'Lobby II', '🌴'), ('lobby', 'Online Room', '🎧')]),
    ]
    W, H = 1600, 900
    img = background(W, H, glow=(0.5, 0.15))
    d = ImageDraw.Draw(img)
    outlined(d, (W // 2, 44), 'TRACKLIST', display(62), YELLOW, anchor='ma')
    d.text((W // 2, 124), 'Google Lyria 3 Pro · instrumental · 2 to 3 minutes each · $0.88 for all ten',
           font=body(24, 'Bold'), fill=MUTED, anchor='ma')
    cw, top = 700, 180
    for c, (group, items) in enumerate(tracks):
        x = 70 + c * (cw + 60)
        d.text((x + 4, top), group.upper(), font=body(22, 'Black'), fill=YELLOW)
        for k, (fn, title, ic) in enumerate(items):
            y = top + 44 + k * 128
            card(img, (x, y, x + cw, y + 112), radius=22)
            d.text((x + 24, y + 56), ic, font=emoji(40), embedded_color=True, anchor='lm')
            d.text((x + 86, y + 18), title, font=display(34), fill=TEXT)
            path = os.path.join(MUSIC, f'{fn}.mp3')
            d.text((x + cw - 24, y + 22), duration(path), font=body(24, 'Black'), fill=MUTED, anchor='ra')
            wv = waveform(path, 80)
            bx, by, bw = x + 88, y + 90, (cw - 120) / len(wv)
            for i, v in enumerate(wv):
                hh = 4 + v * 30
                col = YELLOW if i < len(wv) * 0.35 else (150, 130, 220)
                d.rounded_rectangle((bx + i * bw, by - hh / 2 - 6, bx + i * bw + bw * 0.6, by + hh / 2 - 6), 2, fill=col)
    img.convert('RGB').save(os.path.join(OUT, 'v0.3.0-tracklist.png'), optimize=True)

    # playlists: what plays when
    W, H = 1240, 560
    img = background(W, H, glow=(0.5, 0.3))
    d = ImageDraw.Draw(img)
    outlined(d, (70, 40), 'A PLAYLIST FOR EVERY MOMENT', display(54), YELLOW)
    rows = [('🏠', 'Menu', ['Lobby', 'Lobby II']),
            ('🌐', 'Online room', ['Online Room', 'Lobby II', 'Lobby']),
            ('🗺️', 'Match', ['Map theme', 'Battle', 'Battle II']),
            ('🌙', 'Match at night', ['Night Arena', 'Map theme', 'Battle II']),
            ('⚔️', 'Last 3 brawlers', ['Final Showdown'])]
    for k, (ic, label, songs) in enumerate(rows):
        y = 130 + k * 82
        d.text((80, y + 30), ic, font=emoji(38), embedded_color=True, anchor='lm')
        d.text((140, y + 30), label, font=display(32), fill=TEXT, anchor='lm')
        x = 470
        for i, s in enumerate(songs):
            w = pill(img, (x, y + 6), s, body(22, 'Black'), YELLOW if i == 0 else (48, 38, 90, 255),
                     color=INK if i == 0 else TEXT, pad=(18, 9))
            x += w
            if i < len(songs) - 1:
                d.text((x + 22, y + 28), '→', font=sym(30), fill=MUTED, anchor='mm')
                x += 44
    img.convert('RGB').save(os.path.join(OUT, 'v0.3.0-playlists.png'), optimize=True)


# ------------------------------ v0.4.0: automatic graphics ------------------------------

def v040():
    banner('v0.4.0', 'AUTO GRAPHICS', 'The game picks its own settings, then keeps the frame rate smooth.',
           [('🧠', 'GPU detection'), ('📈', 'Adapts to FPS'), ('⚙️', 'New General tab'), ('🖥️', 'Fullscreen toggle')],
           'v0.4.0-banner.png', ('frostbite', 'volt', 'blaster'))
    W, H = 1600, 800
    img = background(W, H, glow=(0.5, 0.25))
    d = ImageDraw.Draw(img)
    outlined(d, (W // 2, 40), 'HOW "AUTO" WORKS', display(58), YELLOW, anchor='ma')
    steps = [('ULTRA', '125% res · 4K shadows', (255, 120, 70)), ('HIGH', '100% res · AO + bloom', (255, 180, 60)),
             ('MEDIUM', 'MSAA 2x · no AO', (120, 200, 110)), ('LOW', '75% res · light shadows', (90, 170, 230)),
             ('LOW 60%', 'render scale 0.6', (120, 120, 200)), ('LOW 50%', 'render scale 0.5', (110, 100, 160))]
    n, sw, gap, top = len(steps), 218, 24, 150
    x0 = (W - (n * sw + (n - 1) * gap)) // 2
    for i, (name, detail, col) in enumerate(steps):
        x = x0 + i * (sw + gap)
        hh = 250 - i * 26
        y = top + (250 - hh)
        card(img, (x, y, x + sw, top + 250), fill=col + (255,), outline=INK, radius=22)
        outlined(d, (x + sw // 2, y + 24), name, display(34), TEXT, stroke=5, shadow=False, anchor='ma')
        d.text((x + sw // 2, top + 270), detail, font=body(20, 'Bold'), fill=MUTED, anchor='ma')
        if i < n - 1:
            d.text((x + sw + gap / 2, top + 200), '›', font=display(44), fill=TEXT, anchor='mm')
    # arrows: down / up rules
    ay = top + 330
    card(img, (x0, ay, W // 2 - 12, ay + 120), fill=(120, 40, 60, 235), outline=(200, 90, 110))
    d.text((x0 + 30, ay + 60), '⬇️', font=emoji(46), embedded_color=True, anchor='lm')
    d.text((x0 + 100, ay + 24), 'Under 45 FPS', font=display(34), fill=TEXT)
    d.text((x0 + 100, ay + 70), 'one step down after a 4-second measure', font=body(22, 'Bold'), fill=TEXT)
    card(img, (W // 2 + 12, ay, W - x0, ay + 120), fill=(40, 110, 70, 235), outline=(90, 190, 120))
    d.text((W // 2 + 42, ay + 60), '⬆️', font=emoji(46), embedded_color=True, anchor='lm')
    d.text((W // 2 + 112, ay + 24), 'Smooth for ~20 s', font=display(34), fill=TEXT)
    d.text((W // 2 + 112, ay + 70), 'one step back up, never above the detected tier', font=body(22, 'Bold'), fill=TEXT)
    # starting tier by GPU
    gy = ay + 160
    d.text((x0, gy), 'STARTING TIER FROM YOUR GRAPHICS CARD', font=body(22, 'Black'), fill=YELLOW)
    gpus = [('Ultra', 'RTX · Radeon RX 5000+ · Apple M2+'), ('High', 'GTX · other Radeon · Apple M1'),
            ('Medium', 'Intel / integrated · flagship phones'), ('Low', 'phones · software rendering')]
    for k, (tier, ex) in enumerate(gpus):
        x = x0 + (k % 2) * (W - 2 * x0 + 24) // 2
        yy = gy + 44 + (k // 2) * 58
        pill(img, (x, yy), f'{tier}: {ex}', body(21, 'Bold'), (48, 38, 90, 255), color=TEXT, pad=(18, 10))
    img.convert('RGB').save(os.path.join(OUT, 'v0.4.0-auto.png'), optimize=True)

    # the new General tab + FPS counter (drawn from the game's menu style)
    W, H = 1600, 640
    img = background(W, H, glow=(0.4, 0.4))
    d = ImageDraw.Draw(img)
    ox, oy, ow, oh = 90, 60, 900, 520
    card(img, (ox, oy, ox + ow, oy + oh), fill=(28, 22, 44, 250), outline=(80, 70, 120), radius=28)
    outlined(d, (ox + 40, oy + 30), 'OPTIONS', display(52), YELLOW, stroke=5, shadow=False)
    tx = ox + 330
    for i, tab in enumerate(['General', 'Graphics', 'Audio', 'Controls']):
        w = pill(img, (tx, oy + 40), tab, body(20, 'Black'), YELLOW if i == 0 else (48, 38, 90, 255),
                 color=INK if i == 0 else TEXT, pad=(16, 8), radius=12)
        tx += w + 10
    rows = [('Language', 'Automatic'), ('Fullscreen', 'On'), ('FPS counter', 'On'), ('Camera shake', 'On'),
            ('Quality preset', 'Auto · Ultra')]
    for k, (lab, val) in enumerate(rows):
        y = oy + 130 + k * 72
        if k == 4:
            d.rounded_rectangle((ox + 24, y - 10, ox + ow - 24, y + 52), 12, outline=YELLOW, width=3, fill=(60, 48, 30, 255))
        d.text((ox + 50, y + 20), lab, font=body(26, 'ExtraBold'), fill=TEXT, anchor='lm')
        d.text((ox + ow - 300, y + 20), '◀', font=sym(22), fill=MUTED, anchor='mm')
        d.text((ox + ow - 180, y + 20), val, font=display(28), fill=TEXT, anchor='mm')
        d.text((ox + ow - 60, y + 20), '▶', font=sym(22), fill=MUTED, anchor='mm')
    bx = 1080
    pill(img, (bx, 120), '60 FPS · Auto Ultra', display(34), (0, 0, 0, 170), color=(120, 255, 150), pad=(22, 12), radius=14)
    d.text((bx, 210), 'The FPS counter now shows', font=body(26, 'Bold'), fill=TEXT)
    d.text((bx, 246), 'the tier Auto picked.', font=body(26, 'Bold'), fill=TEXT)
    d.text((bx, 330), 'Graphics tab: your detected', font=body(26, 'Bold'), fill=MUTED)
    d.text((bx, 366), 'card + "Detect" to re-run it.', font=body(26, 'Bold'), fill=MUTED)
    pill(img, (bx, 430), 'AMD Radeon RX 7800 XT', body(24, 'Black'), (48, 38, 90, 255), color=TEXT, icon='🖥️', pad=(18, 10))
    img.convert('RGB').save(os.path.join(OUT, 'v0.4.0-general.png'), optimize=True)


# ------------------------------ v0.5.0: online, for real ------------------------------

def v050():
    banner('v0.5.0', 'FIND A MATCH', 'One queue for every platform, server-run matches, fair bans.',
           [('🔎', 'Cross-platform queue'), ('🤖', 'Bots after 5 min'), ('🛡️', 'Anti-cheat'), ('⚖️', 'Fair reports')],
           'v0.5.0-banner.png', ('bomber', 'volt', 'gunslinger'))

    # matchmaking: the queue screen + its three rules
    W, H = 1600, 720
    img = background(W, H, glow=(0.3, 0.4))
    d = ImageDraw.Draw(img)
    outlined(d, (70, 40), 'ONE QUEUE, EVERY PLATFORM', display(56), YELLOW)
    qx, qy, qw, qh = 70, 150, 700, 500
    card(img, (qx, qy, qx + qw, qy + qh), fill=(28, 22, 44, 250), outline=(80, 70, 120), radius=28)
    for k in range(3):
        cx = qx + qw // 2 - 36 + k * 36
        d.ellipse((cx - 10, qy + 50 - (10 if k == 1 else 0) - 10, cx + 10, qy + 50 - (10 if k == 1 else 0) + 10), fill=YELLOW)
    d.text((qx + qw // 2, qy + 90), 'Searching for players…', font=display(40), fill=TEXT, anchor='ma')
    d.text((qx + qw // 2, qy + 160), '5 / 8 players in the queue', font=body(28, 'Black'), fill=TEXT, anchor='ma')
    bx0, bx1, by = qx + 120, qx + qw - 120, qy + 215
    d.rounded_rectangle((bx0, by, bx1, by + 22), 11, fill=(34, 29, 51), outline=INK, width=3)
    d.rounded_rectangle((bx0 + 3, by + 3, bx0 + 3 + (bx1 - bx0 - 6) * 5 // 8, by + 19), 8, fill=YELLOW)
    d.text((qx + qw // 2, qy + 265), 'Waiting for 0:42 · bots fill the match in 4:18', font=body(24, 'Bold'), fill=MUTED, anchor='ma')
    x = qx + 150
    for ic, n in [('🌐', 2), ('🎮', 1), ('🛒', 1), ('🤖', 1)]:
        d.text((x, qy + 330), ic, font=emoji(34), embedded_color=True, anchor='lm')
        d.text((x + 46, qy + 330), str(n), font=body(28, 'Black'), fill=TEXT, anchor='lm')
        x += 110
    pw = pill(img, (qx + 110, qy + 395), 'PLAY NOW WITH BOTS', display(28), YELLOW, pad=(24, 12), radius=16)
    pill(img, (qx + 110 + pw + 16, qy + 395), 'CANCEL', display(28), (48, 38, 90, 255), color=TEXT, pad=(24, 12), radius=16)
    rules = [('🎉', '8 players', 'the match starts right away'),
             ('⏱️', '5 minutes', 'whoever is queued plays, bots fill the empty slots'),
             ('⚡', 'Play now', 'skip the wait: a match with bots, instantly')]
    rx = qx + qw + 60
    for k, (ic, title, text) in enumerate(rules):
        ry = qy + k * 170
        card(img, (rx, ry, W - 70, ry + 150), radius=24)
        d.text((rx + 34, ry + 75), ic, font=emoji(52), embedded_color=True, anchor='lm')
        d.text((rx + 120, ry + 26), title, font=display(40), fill=YELLOW)
        for li, line in enumerate(wrap(d, text, body(24, 'Bold'), W - 70 - rx - 150)[:2]):
            d.text((rx + 122, ry + 80 + li * 30), line, font=body(24, 'Bold'), fill=TEXT)
    img.convert('RGB').save(os.path.join(OUT, 'v0.5.0-matchmaking.png'), optimize=True)

    # the server runs the match + moderation
    W, H = 1600, 780
    img = background(W, H, glow=(0.5, 0.35))
    d = ImageDraw.Draw(img)
    outlined(d, (W // 2, 36), 'THE SERVER RUNS THE MATCH', display(56), YELLOW, anchor='ma')
    plats = [('🌐', 'Web'), ('🎮', 'Steam'), ('🛒', 'Epic'), ('🤖', 'Android'), ('🍏', 'iOS')]
    for k, (ic, name) in enumerate(plats):
        y = 140 + k * 82
        card(img, (70, y, 330, y + 64), radius=18)
        d.text((100, y + 32), ic, font=emoji(34), embedded_color=True, anchor='lm')
        d.text((150, y + 32), name, font=display(30), fill=TEXT, anchor='lm')
    d.text((395, 300), '→', font=sym(70), fill=YELLOW, anchor='mm')
    d.text((395, 360), 'inputs', font=body(22, 'Black'), fill=MUTED, anchor='mm')
    d.text((395, 385), 'only', font=body(22, 'Black'), fill=MUTED, anchor='mm')
    sx0, sx1 = 460, 1140
    card(img, (sx0, 130, sx1, 540), fill=(40, 30, 78, 250), outline=YELLOW, radius=30)
    d.text((sx0 + 36, 158), '☁️', font=emoji(46), embedded_color=True)
    d.text((sx0 + 104, 160), 'Our server', font=display(42), fill=TEXT)
    checks = ['Every move is checked: speed, walls, frozen', 'You only receive what you can see',
              'Hits, KOs and cubes follow the rules', 'Impossible moves: kicked automatically',
              'Old versions are asked to update']
    for k, c in enumerate(checks):
        y = 250 + k * 56
        d.text((sx0 + 40, y), '✔', font=sym(28), fill=YELLOW)
        d.text((sx0 + 84, y), c, font=body(26, 'Bold'), fill=TEXT)
    d.text((1205, 300), '→', font=sym(70), fill=YELLOW, anchor='mm')
    d.text((1205, 360), 'your', font=body(22, 'Black'), fill=MUTED, anchor='mm')
    d.text((1205, 385), 'view', font=body(22, 'Black'), fill=MUTED, anchor='mm')
    card(img, (1270, 200, 1530, 470), radius=24)
    d.text((1400, 250), '🌫️', font=emoji(64), embedded_color=True, anchor='mm')
    for li, line in enumerate(['Hidden in a bush', 'or in the fog?', 'Not sent at all.']):
        d.text((1400, 320 + li * 40), line, font=body(24, 'ExtraBold'), fill=TEXT, anchor='mm')
    # moderation band
    by = 580
    card(img, (70, by, W - 70, by + 160), fill=(255, 210, 63, 255), outline=INK, radius=30)
    d.text((110, by + 80), '⚖️', font=emoji(64), embedded_color=True, anchor='lm')
    d.text((210, by + 26), 'Report · Remove · Fair bans', font=display(44), fill=INK)
    d.text((212, by + 92), 'Banned only if reported in at least 30% of 10+ matches, by 4+ different players.',
           font=body(26, 'Bold'), fill=INK)
    img.convert('RGB').save(os.path.join(OUT, 'v0.5.0-server.png'), optimize=True)


# ------------------------------ v0.6.0: ranked & fair ------------------------------

def v060():
    banner('v0.6.0', 'RANKED & FAIR', 'A rank to climb, fair starts, bots at your level.',
           [('🏅', 'Visible rank'), ('⏳', 'Loading screen'), ('🛡️', 'Spawn shield'), ('📱', 'Phone-ready')],
           'v0.6.0-banner.png', ('volt', 'frostbite', 'blaster'))

    # the rank ladder
    W, H = 1600, 700
    img = background(W, H, glow=(0.5, 0.3))
    d = ImageDraw.Draw(img)
    outlined(d, (W // 2, 36), 'CLIMB THE RANKS', display(58), YELLOW, anchor='ma')
    tiers = [('🥉', 'Bronze', '0', (176, 110, 60)), ('🥈', 'Silver', '200', (150, 160, 185)), ('🥇', 'Gold', '500', (230, 180, 40)),
             ('💎', 'Diamond', '900', (70, 170, 230)), ('🔮', 'Mythic', '1400', (160, 90, 220)), ('👑', 'Legend', '2000', (240, 90, 80))]
    n, cw, gap = len(tiers), 220, 18
    x0 = (W - (n * cw + (n - 1) * gap)) // 2
    for i, (ic, name, rp, col) in enumerate(tiers):
        x = x0 + i * (cw + gap)
        top = 330 - i * 34
        card(img, (x, top, x + cw, 470), fill=col + (255,), outline=INK, radius=22)
        d.text((x + cw // 2, top + 48), ic, font=emoji(56), embedded_color=True, anchor='mm')
        outlined(d, (x + cw // 2, top + 86), name, display(32), TEXT, stroke=4, shadow=False, anchor='ma')
        d.text((x + cw // 2, 480), f'{rp} RP', font=body(24, 'Black'), fill=MUTED, anchor='ma')
    by = 540
    card(img, (x0, by, W // 2 - 10, by + 120), radius=24)
    d.text((x0 + 26, by + 18), 'Visible rank (RP)', font=display(30), fill=YELLOW)
    d.text((x0 + 26, by + 64), '1st +30 … 8th −12 · matchmaking with 2+ humans', font=body(22, 'Bold'), fill=TEXT)
    card(img, (W // 2 + 10, by, W - x0, by + 120), radius=24)
    d.text((W // 2 + 36, by + 18), 'Hidden MMR', font=display(30), fill=YELLOW)
    d.text((W // 2 + 36, by + 64), 'pairs close players and sets the bots’ skill', font=body(22, 'Bold'), fill=TEXT)
    img.convert('RGB').save(os.path.join(OUT, 'v0.6.0-rank.png'), optimize=True)

    # fair start: loading screen -> 3-2-1 -> spawn shield -> bots wake up
    W, H = 1600, 640
    img = background(W, H, glow=(0.5, 0.35))
    d = ImageDraw.Draw(img)
    outlined(d, (W // 2, 36), 'A FAIR START FOR EVERYONE', display(56), YELLOW, anchor='ma')
    steps = [('⏳', 'Loading screen', 'Everyone loads the match. Nobody plays before all 8 are in (25 s max).'),
             ('🏁', '3 · 2 · 1 · FIGHT!', 'The match starts on every screen at the same moment.'),
             ('🛡️', 'Spawn shield', 'Nobody can hurt anybody during the first 5 seconds.'),
             ('😴', 'Calm bots', 'Bots loot for 7–11 s before they start hunting.')]
    sw, gap = 340, 26
    x0 = (W - (4 * sw + 3 * gap)) // 2
    for i, (ic, title, text) in enumerate(steps):
        x = x0 + i * (sw + gap)
        card(img, (x, 150, x + sw, 470), radius=26)
        d.text((x + sw // 2, 215), ic, font=emoji(70), embedded_color=True, anchor='mm')
        d.text((x + sw // 2, 290), title, font=display(32), fill=YELLOW, anchor='ma')
        for li, line in enumerate(wrap(d, text, body(22, 'Bold'), sw - 50)[:4]):
            d.text((x + sw // 2, 345 + li * 30), line, font=body(22, 'Bold'), fill=TEXT, anchor='ma')
        if i < 3:
            d.text((x + sw + gap // 2, 310), '→', font=sym(40), fill=YELLOW, anchor='mm')
    card(img, (x0, 510, W - x0, 590), fill=(255, 210, 63, 255), outline=INK, radius=24)
    d.text((W // 2, 550), 'Late? A bot plays your brawler until you finish loading, then it is yours again.', font=body(26, 'Bold'), fill=INK, anchor='mm')
    img.convert('RGB').save(os.path.join(OUT, 'v0.6.0-fair.png'), optimize=True)


def v061():
    banner('v0.6.1', 'NEW ONLINE MENU', 'Your rank up front, one tap to a match, then again.',
           [('🏅', 'Your rank'), ('🔎', 'Find a match'), ('🤝', 'Friends'), ('🔁', 'Play again')],
           'v0.6.1-banner.png', ('gunslinger', 'bomber', 'volt'))

    # the new online menu, three blocks + what happens after a ranked match
    W, H = 1600, 700
    img = background(W, H, glow=(0.5, 0.3))
    d = ImageDraw.Draw(img)
    outlined(d, (W // 2, 36), 'THE ONLINE MENU, REBUILT', display(56), YELLOW, anchor='ma')
    cols = [('🏅', 'You', ['Your brawler and name', 'Rank emblem and RP', 'Progress to the next tier'], None),
            ('🔎', 'Find a match', ['Ranked, cross-platform', 'One big button', 'Web · Steam · Epic · Android · iOS'], (255, 210, 63)),
            ('🤝', 'Friends', ['Create a room', 'Join with a code', 'Private, unranked'], None)]
    cw, gap = 440, 30
    x0 = (W - (3 * cw + 2 * gap)) // 2
    for i, (ic, title, lines, hi) in enumerate(cols):
        x = x0 + i * (cw + gap)
        card(img, (x, 140, x + cw, 450), outline=hi or (110, 90, 180), radius=26)
        d.text((x + cw // 2, 200), ic, font=emoji(64), embedded_color=True, anchor='mm')
        d.text((x + cw // 2, 250), title, font=display(38), fill=YELLOW, anchor='ma')
        for li, line in enumerate(lines):
            d.text((x + cw // 2, 318 + li * 36), line, font=body(24, 'Bold'), fill=TEXT, anchor='ma')
    card(img, (x0, 500, W - x0, 640), fill=(255, 210, 63, 255), outline=INK, radius=24)
    d.text((W // 2, 540), 'After a ranked match', font=display(34), fill=INK, anchor='mm')
    d.text((W // 2, 595), 'RP won or lost, then PLAY AGAIN (straight back in the queue) or MENU', font=body(26, 'Bold'), fill=INK, anchor='mm')
    img.convert('RGB').save(os.path.join(OUT, 'v0.6.1-lobby.png'), optimize=True)


def v062():
    banner('v0.6.2', '15 ACHIEVEMENTS', 'Five new ones, and Google Play Games on Android.',
           [('🏆', '5 new'), ('🌙', 'Night Owl'), ('📦', 'Crate Crusher'), ('🤖', 'Play Games')],
           'v0.6.2-banner.png', ('frostbite', 'blaster', 'gunslinger'))

    # every achievement icon, the five new ones highlighted
    ach = os.path.join(ROOT, 'play', 'achievements')
    old = [('FIRST_KO', 'First Blood'), ('FIRST_WIN', 'Last One Standing'), ('RAMPAGE', 'Rampage'), ('POWER_HUNGRY', 'Power Hungry'),
           ('ONLINE_WIN', 'Crowd Pleaser'), ('SQUAD_UP', 'Squad Up'), ('WORLD_TOUR', 'World Tour'), ('JACK_OF_ALL', 'Jack of All Slops'),
           ('VETERAN', 'Veteran'), ('CENTURION', 'Centurion')]
    new = [('PODIUM', 'Podium Finish', 'Top 3'), ('SUPER_KO', 'Super Finish', 'KO with a super'), ('NIGHT_OWL', 'Night Owl', 'Win at night'),
           ('CRATE_CRUSHER', 'Crate Crusher', '50 crates'), ('CHAMPION', 'Champion', '10 wins')]
    W, H = 1600, 820
    img = background(W, H, glow=(0.5, 0.35))
    d = ImageDraw.Draw(img)
    outlined(d, (W // 2, 36), '5 NEW ACHIEVEMENTS', display(58), YELLOW, anchor='ma')
    s, gap = 220, 40
    x0 = (W - (5 * s + 4 * gap)) // 2
    for i, (key, name, how) in enumerate(new):
        x, y = x0 + i * (s + gap), 130
        card(img, (x - 12, y - 12, x + s + 12, y + s + 110), fill=(255, 210, 63, 255), outline=INK, radius=26)
        icon = Image.open(os.path.join(ach, key + '.png')).convert('RGBA').resize((s, s), Image.LANCZOS)
        mask = Image.new('L', (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, s, s), 20, fill=255)
        img.paste(icon, (x, y), mask)
        d.text((x + s // 2, y + s + 30), name, font=display(30), fill=INK, anchor='mm')
        d.text((x + s // 2, y + s + 72), how, font=body(24, 'Bold'), fill=INK, anchor='mm')
    outlined(d, (W // 2, 520), 'PLUS THE TEN YOU KNOW', display(36), TEXT, stroke=5, anchor='ma')
    s2, gap2 = 110, 26
    x0 = (W - (10 * s2 + 9 * gap2)) // 2
    for i, (key, name) in enumerate(old):
        x, y = x0 + i * (s2 + gap2), 590
        icon = Image.open(os.path.join(ach, key + '.png')).convert('RGBA').resize((s2, s2), Image.LANCZOS)
        mask = Image.new('L', (s2, s2), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, s2, s2), 14, fill=255)
        img.paste(icon, (x, y), mask)
        d.rounded_rectangle((x, y, x + s2, y + s2), 14, outline=INK, width=3)
    d.text((W // 2, 755), 'On Steam and on Google Play Games (Android) · progress earned offline is sent later',
           font=body(26, 'Bold'), fill=MUTED, anchor='mm')
    img.convert('RGB').save(os.path.join(OUT, 'v0.6.2-achievements.png'), optimize=True)


def v070():
    banner('v0.7.0', 'MADE WITH YOU', 'Crash reports, a quick "Having fun?" and smoother games.',
           [('🐞', 'Crash reports'), ('😍', 'Having fun?'), ('📈', 'Frame rate'), ('🔒', 'Your choice')],
           'v0.7.0-banner.png', ('volt', 'gunslinger', 'frostbite'))

    # what the game now tells us, and how to turn it off
    W, H = 1600, 760
    img = background(W, H, glow=(0.5, 0.3))
    d = ImageDraw.Draw(img)
    outlined(d, (W // 2, 36), 'HELP US MAKE IT BETTER', display(58), YELLOW, anchor='ma')
    cols = [('🐞', 'Crash reports', ['The error and where it broke', 'Version, platform, graphics chip', 'Fixed before you even report it'], None),
            ('📊', 'Game statistics', ['Brawlers, maps, queue times', 'Frame rate during matches', 'Balance and speed on every device'], None),
            ('😍', 'Having fun?', ['Five faces after some matches', 'An optional comment', 'At most once a month'], (255, 210, 63))]
    cw, gap = 440, 30
    x0 = (W - (3 * cw + 2 * gap)) // 2
    for i, (ic, title, lines, hi) in enumerate(cols):
        x = x0 + i * (cw + gap)
        card(img, (x, 140, x + cw, 470), outline=hi or (110, 90, 180), radius=26)
        d.text((x + cw // 2, 200), ic, font=emoji(64), embedded_color=True, anchor='mm')
        d.text((x + cw // 2, 250), title, font=display(38), fill=YELLOW, anchor='ma')
        for li, line in enumerate(lines):
            d.text((x + cw // 2, 318 + li * 40), line, font=body(24, 'Bold'), fill=TEXT, anchor='ma')
    by = 520
    card(img, (x0, by, W - x0, by + 170), fill=(255, 210, 63, 255), outline=INK, radius=26)
    d.text((x0 + 44, by + 85), '🛡️', font=emoji(64), embedded_color=True, anchor='lm')
    d.text((x0 + 140, by + 30), 'No account · no name · no IP · no ads', font=display(40), fill=INK)
    d.text((x0 + 142, by + 100), 'Turn each one off in Options > General. Details in the privacy policy.',
           font=body(26, 'Bold'), fill=INK)
    img.convert('RGB').save(os.path.join(OUT, 'v0.7.0-feedback.png'), optimize=True)


def v080():
    banner('v0.8.0', 'NEW LOOKS', 'Same moves, all-new characters.',
           [('🌳', 'Stump golem'), ('🦎', 'Axolotl ranger'), ('🔥', 'Magma imp'), ('☄️', 'Meteor super')],
           'v0.8.0-banner.png', ('blaster', 'gunslinger', 'bomber'))

    # one card per redesigned brawler: portrait, who they are now, what they shoot (numbers from combat.js)
    cols = [('blaster', 'Blaster', 'Tree-stump golem', (95, 184, 58),
             ['Hollow-log blunderbuss', '5 thorny seeds per shot', 'Super: 9 seeds, knockback']),
            ('gunslinger', 'Gunslinger', 'Axolotl star-ranger', (242, 122, 168),
             ['Twin ray pistols', 'Bursts of 6 ray bolts', 'Super: 12 bolts through walls']),
            ('bomber', 'Bomber', 'Magma imp', (255, 122, 31),
             ['Fireballs over walls', '800 damage, 2 m blast', 'Super: a 1800-damage meteor'])]
    W, H = 1600, 900
    img = background(W, H, glow=(0.5, 0.3))
    d = ImageDraw.Draw(img)
    outlined(d, (W // 2, 36), 'THREE NEW CHARACTERS', display(58), YELLOW, anchor='ma')
    cw, gap = 460, 30
    x0 = (W - (3 * cw + 2 * gap)) // 2
    for i, (key, name, who, col, lines) in enumerate(cols):
        x = x0 + i * (cw + gap)
        card(img, (x, 130, x + cw, 720), outline=col, radius=26)
        p = Image.open(os.path.join(UI, f'{key}.png')).convert('RGBA')
        ph = 290
        p = p.resize((int(p.width * ph / p.height), ph), Image.LANCZOS)
        if p.width > cw - 40:
            p = p.resize((cw - 40, int(p.height * (cw - 40) / p.width)), Image.LANCZOS)
        img.alpha_composite(p, (x + (cw - p.width) // 2, 150 + ph - p.height))
        d.text((x + cw // 2, 470), name, font=display(44), fill=YELLOW, anchor='ma')
        pill_w = d.textlength(who, font=body(24, 'Black')) + 36
        pill(img, (int(x + (cw - pill_w) // 2), 528), who, body(24, 'Black'), col + (255,), color=INK, pad=(18, 8))
        for li, line in enumerate(lines):
            d.text((x + cw // 2, 598 + li * 38), line, font=body(25, 'Bold'), fill=TEXT, anchor='ma')
    by = 750
    card(img, (x0, by, W - x0, by + 120), fill=(255, 210, 63, 255), outline=INK, radius=26)
    d.text((W // 2, by + 38), 'Same stats, same controls, same range', font=display(38), fill=INK, anchor='mm')
    d.text((W // 2, by + 88), 'Only the looks changed: models, portraits, projectiles, colours and texts in 30 languages',
           font=body(25, 'Bold'), fill=INK, anchor='mm')
    img.convert('RGB').save(os.path.join(OUT, 'v0.8.0-brawlers.png'), optimize=True)


# ------------------------------ v0.9.0: alive ------------------------------

def v090():
    banner('v0.9.0', 'ALIVE!', 'Real skeletons, 16 animations each, wind in their hair.',
           [('🦴', '16 animations'), ('🍃', 'Wind & sway'), ('👀', 'Blinks'), ('👋', 'Waves hello')],
           'v0.9.0-banner.png', ('frostbite', 'blaster', 'volt'))

    # the animation grid: real frames rendered by Blender from the rigged files (art-src/rig)
    anim = os.path.join(ROOT, 'art-src', 'rig', 'work', 'anim')
    clips = [('Run', 0.45), ('Aim', 0.5), ('Victory', 0.5), ('Wave', 0.45), ('BushIdle', 0.3), ('Death', 1.0)]
    W, H = 1600, 1085
    img = background(W, H, glow=(0.5, 0.25))
    d = ImageDraw.Draw(img)
    outlined(d, (W // 2, 30), '16 ANIMATIONS PER BRAWLER', display(58), YELLOW, anchor='ma')
    d.text((W // 2, 112), 'A standard humanoid skeleton in every model: 6 of the 16 clips, straight from the files',
           font=body(25, 'Bold'), fill=MUTED, anchor='ma')
    x0, y0, cw, ch = 190, 170, 230, 165
    for ci, (clip, _) in enumerate(clips):
        d.text((x0 + ci * cw + cw // 2, y0), clip, font=display(30), fill=TEXT, anchor='ma')
    for ri, key in enumerate(BRAWLERS):
        y = y0 + 50 + ri * ch
        d.text((x0 - 20, y + ch // 2), key.capitalize(), font=body(26, 'Black'), fill=YELLOW, anchor='rm')
        for ci, (clip, at) in enumerate(clips):
            x = x0 + ci * cw
            card(img, (x + 8, y + 4, x + cw - 8, y + ch - 4), radius=20)
            frames = sorted(f for f in os.listdir(os.path.join(anim, key, clip)) if f.endswith('.png'))
            f = Image.open(os.path.join(anim, key, clip, frames[min(len(frames) - 1, int(at * (len(frames) - 1)))])).convert('RGBA')
            f = f.resize((ch - 6, ch - 6), Image.LANCZOS)
            img.alpha_composite(f, (x + (cw - f.width) // 2, y + 3))
    img.convert('RGB').save(os.path.join(OUT, 'v0.9.0-animations.png'), optimize=True)

    # what makes them feel alive, in the game
    feats = [('🦴', 'Real skeletons', ['22 bones, Mixamo names', '.glb, .fbx and .blend files', 'open them in any 3D tool']),
             ('🍃', 'Wind & motion', ['leaves, flames, gills, capes', 'sway in the wind, trail behind', 'and bounce when they stop']),
             ('👀', 'They blink', ['every 2 to 5 seconds', 'sometimes twice in a row', 'eyes shut when knocked out']),
             ('🔫', 'Weapons in hand', ['their own 3D objects', 'on a bone of the hand', 'holstered to wave hello']),
             ('🌿', 'Bush sneaking', ['crouch and tiptoe in the grass', 'peek left and right', 'cough in the poison gas']),
             ('💀', 'Big moments', ['a real fall when knocked out', 'a fist pump after a KO', 'a victory dance for the winner'])]
    W, H = 1600, 900
    img = background(W, H, glow=(0.5, 0.3))
    d = ImageDraw.Draw(img)
    outlined(d, (W // 2, 36), 'ALIVE IN THE ARENA', display(58), YELLOW, anchor='ma')
    cw, chh, gx, gy = 470, 330, 30, 30
    x0 = (W - (3 * cw + 2 * gx)) // 2
    for i, (icon, title, lines) in enumerate(feats):
        x, y = x0 + (i % 3) * (cw + gx), 140 + (i // 3) * (chh + gy)
        card(img, (x, y, x + cw, y + chh), outline=(150, 120, 230), radius=26)
        d.text((x + cw // 2, y + 26), icon, font=emoji(64), embedded_color=True, anchor='ma')
        d.text((x + cw // 2, y + 120), title, font=display(38), fill=YELLOW, anchor='ma')
        for li, line in enumerate(lines):
            d.text((x + cw // 2, y + 185 + li * 40), line, font=body(25, 'Bold'), fill=TEXT, anchor='ma')
    img.convert('RGB').save(os.path.join(OUT, 'v0.9.0-alive.png'), optimize=True)


# ------------------------------ v0.10.0: line of sight ------------------------------

def sight_fan(grid, ox, oz, rays=720, into=0.7):
    """Same grid DDA as src/sight.js: visibility polygon (tile units) from (ox, oz)."""
    import math
    H, W = len(grid), len(grid[0])
    block = lambda i, j: i < 0 or j < 0 or i >= W or j >= H or grid[j][i] in '#TC'
    pts = []
    for k in range(rays):
        a = k / rays * math.tau
        dx, dz = math.cos(a) or 1e-6, math.sin(a) or 1e-6
        i, j = int(ox), int(oz)
        si, sj = (1 if dx > 0 else -1), (1 if dz > 0 else -1)
        tdx, tdz = abs(1 / dx), abs(1 / dz)
        tx = ((i + 1 - ox) if dx > 0 else (ox - i)) * tdx
        tz = ((j + 1 - oz) if dz > 0 else (oz - j)) * tdz
        t, hit = 0, None
        while t < 60:
            if tx < tz: t = tx; tx += tdx; i += si
            else: t = tz; tz += tdz; j += sj
            b = block(i, j)
            if hit is None:
                if b: hit = t
            elif not b or t - hit >= into:
                t = min(t, hit + into); break
        pts.append((ox + dx * t, oz + dz * t))
    return pts


def v0100():
    banner('v0.10.0', 'LINE OF SIGHT', 'Walls hide you. The camera shows faces.',
           [('🧱', 'Walls block sight'), ('👁️', '14 m vision'), ('🎥', 'New camera'), ('🌪️', 'Clearer storms')],
           'v0.10.0-banner.png', ('gunslinger', 'frostbite', 'bomber'))

    # top-down diagram: the real ray fan over a small patch of arena, a range circle, three enemies
    grid = ['................',
            '..###......BB...',
            '..#........BB...',
            '..#...C.........',
            '..........T.....',
            '....###.........',
            '................',
            '.......P........',
            '................',
            '...T......###...',
            '..........#.....',
            '................']
    TS = 52
    GW, GH = len(grid[0]) * TS, len(grid) * TS
    W, H = 1600, 900
    img = background(W, H, glow=(0.35, 0.4))
    d = ImageDraw.Draw(img)
    outlined(d, (W // 2, 30), 'WHAT YOU SEE IS WHAT YOU GET', display(56), YELLOW, anchor='ma')
    gx, gy = 70, 140
    px, pz = 7.5, 7.5
    # ground, then the dimmed "hidden" layer, then the lit fan clipped to the sight range
    board = Image.new('RGBA', (GW, GH), (214, 170, 110, 255))
    bd = ImageDraw.Draw(board)
    for j in range(len(grid)):
        for i in range(len(grid[0])):
            if (i + j) % 2: bd.rectangle((i * TS, j * TS, i * TS + TS - 1, j * TS + TS - 1), fill=(204, 160, 100, 255))
    hidden = Image.new('RGBA', (GW, GH), (40, 34, 70, 170))
    mask = Image.new('L', (GW, GH), 0)
    ImageDraw.Draw(mask).polygon([(x * TS, z * TS) for x, z in sight_fan(grid, px, pz)], fill=255)
    rng = Image.new('L', (GW, GH), 0)
    R = 7 * TS  # 14 m = 7 tiles
    ImageDraw.Draw(rng).ellipse((px * TS - R, pz * TS - R, px * TS + R, pz * TS + R), fill=255)
    lit = Image.fromarray(np.minimum(np.array(mask), np.array(rng)))
    board.alpha_composite(hidden)
    base = Image.new('RGBA', (GW, GH), (214, 170, 110, 255))
    bd2 = ImageDraw.Draw(base)
    for j in range(len(grid)):
        for i in range(len(grid[0])):
            if (i + j) % 2: bd2.rectangle((i * TS, j * TS, i * TS + TS - 1, j * TS + TS - 1), fill=(204, 160, 100, 255))
    board.paste(base, (0, 0), lit.filter(ImageFilter.GaussianBlur(3)))
    bd = ImageDraw.Draw(board)
    bd.ellipse((px * TS - R, pz * TS - R, px * TS + R, pz * TS + R), outline=(255, 255, 255, 150), width=3)
    for j, row in enumerate(grid):
        for i, ch in enumerate(row):
            box = (i * TS + 3, j * TS + 3, i * TS + TS - 3, j * TS + TS - 3)
            if ch == '#': bd.rounded_rectangle(box, 8, fill=(170, 84, 60, 255), outline=INK, width=3)
            elif ch == 'C': bd.rounded_rectangle(box, 8, fill=(150, 104, 58, 255), outline=INK, width=3)
            elif ch == 'T': bd.ellipse(box, fill=(70, 150, 70, 255), outline=INK, width=3)
            elif ch == 'B': bd.rounded_rectangle((i * TS, j * TS, i * TS + TS, j * TS + TS), 14, fill=(120, 180, 60, 200))
    def dot(x, z, col, label, ghost=False):
        c = (int(x * TS), int(z * TS)); r = 17
        bd.ellipse((c[0] - r, c[1] - r, c[0] + r, c[1] + r), fill=col + ((110,) if ghost else (255,)),
                   outline=INK + ((110,) if ghost else (255,)), width=4)
        bd.text((c[0], c[1] - 28), label, font=body(20, 'Black'), fill=(255, 255, 255, 140 if ghost else 255),
                anchor='md', stroke_width=4, stroke_fill=INK)
    dot(px, pz, (80, 200, 255), 'YOU')
    dot(11.5, 6.5, (255, 90, 90), 'SEEN')
    dot(4.5, 3.5, (255, 90, 90), 'BEHIND A WALL', ghost=True)
    dot(12.0, 1.5, (255, 90, 90), 'IN A BUSH', ghost=True)
    dot(14.5, 10.5, (255, 90, 90), 'TOO FAR', ghost=True)
    frame = Image.new('RGBA', (GW + 12, GH + 12), (0, 0, 0, 0))
    ImageDraw.Draw(frame).rounded_rectangle((0, 0, GW + 11, GH + 11), 18, fill=INK)
    img.alpha_composite(frame, (gx - 6, gy - 6))
    img.alpha_composite(board, (gx, gy))
    # the rules, on the right
    x = gx + GW + 50
    rules = [('🧱', 'Walls, trees, crates', 'stop the eye like they stop bullets'),
             ('👁️', '14 m of vision', '11 m inside the sandstorm'),
             ('🌿', 'Bushes still hide', 'unless you are close or they shoot'),
             ('🤖', 'Bots play fair', 'same rules, short memory: 2.5 s'),
             ('🌐', 'No wallhacks online', 'the server only sends what you see')]
    for k, (icon, title, sub) in enumerate(rules):
        y = gy + 8 + k * 125
        d.text((x, y + 4), icon, font=emoji(46), embedded_color=True)
        d.text((x + 70, y), title, font=display(34), fill=YELLOW)
        for li, line in enumerate(wrap(d, sub, body(23, 'Bold'), W - x - 110)):
            d.text((x + 70, y + 46 + li * 28), line, font=body(23, 'Bold'), fill=TEXT)
    img.convert('RGB').save(os.path.join(OUT, 'v0.10.0-sight.png'), optimize=True)

    # camera and weather, in numbers (src/game.js camOffset, lighting.fogShift)
    feats = [('🎥', 'Lower camera', ['57° down to 47°', 'you see faces, not hats', 'hack\'n\'slash framing']),
             ('🔭', 'Wider view', ['camera 25 m to 37 m away', 'about twice the arena on screen', 'shadows follow the view']),
             ('🌪️', 'Clear storms', ['rain & sand fog now start', 'past you, not on top of you', 'dust closes in beyond 11 m'])]
    W, H = 1600, 520
    img = background(W, H, glow=(0.5, 0.3))
    d = ImageDraw.Draw(img)
    outlined(d, (W // 2, 30), 'A NEW VIEW OF THE ARENA', display(56), YELLOW, anchor='ma')
    cw, chh, gxx = 470, 330, 30
    x0 = (W - (3 * cw + 2 * gxx)) // 2
    for i, (icon, title, lines) in enumerate(feats):
        x, y = x0 + i * (cw + gxx), 140
        card(img, (x, y, x + cw, y + chh), outline=(150, 120, 230), radius=26)
        d.text((x + cw // 2, y + 26), icon, font=emoji(64), embedded_color=True, anchor='ma')
        d.text((x + cw // 2, y + 120), title, font=display(38), fill=YELLOW, anchor='ma')
        for li, line in enumerate(lines):
            d.text((x + cw // 2, y + 185 + li * 40), line, font=body(25, 'Bold'), fill=TEXT, anchor='ma')
    img.convert('RGB').save(os.path.join(OUT, 'v0.10.0-camera.png'), optimize=True)


def v0101():
    banner('v0.10.1', 'FAIR HITS', 'Every human hits as hard, everywhere.',
           [('⚖️', 'Same damage'), ('🎺', 'Fanfare fixed'), ('🗺️', 'Roadmap page')],
           'v0.10.1-banner.png', ('volt', 'blaster', 'gunslinger'))

    # human damage multiplier before / after (src/brawler.js setHuman: 1 for humans, 0.85 for bots)
    rows = [('Solo', 100, 100), ('Steam lobby: host', 100, 100), ('Steam lobby: friends', 85, 100),
            ('Online (server)', 85, 100), ('Bots', 85, 85)]
    W, H = 1600, 760
    img = background(W, H, glow=(0.3, 0.35))
    d = ImageDraw.Draw(img)
    outlined(d, (W // 2, 30), 'EVERY HUMAN HITS AT 100%', display(56), YELLOW, anchor='ma')
    lw, bw = 380, 420
    x0, y0 = (W - (lw + 2 * bw + 40)) // 2, 150
    d.text((x0 + lw + bw // 2, y0 - 44), 'BEFORE', font=display(30), fill=TEXT, anchor='ma')
    d.text((x0 + lw + bw + 40 + bw // 2, y0 - 44), 'NOW', font=display(30), fill=YELLOW, anchor='ma')
    for k, (label, before, after) in enumerate(rows):
        y = y0 + k * 92
        d.text((x0, y + 12), label, font=body(28, 'Black'), fill=TEXT)
        for col, v in ((0, before), (1, after)):
            bx = x0 + lw + col * (bw + 40)
            d.rounded_rectangle((bx, y, bx + bw, y + 52), 14, fill=(40, 32, 76))
            good = v == 100 or label == 'Bots'
            fill = (90, 200, 110) if good else (240, 90, 90)
            d.rounded_rectangle((bx, y, bx + int(bw * v / 100), y + 52), 14, fill=fill, outline=INK, width=3)
            d.text((bx + int(bw * v / 100) - 16, y + 26), f'{v}%', font=display(30), fill=INK, anchor='rm')
    d.text((W // 2, H - 60), 'Bots keep 85%: they aim with lead prediction. Power cubes still add +10% each.',
           font=body(24, 'Bold'), fill=TEXT, anchor='ma')
    img.convert('RGB').save(os.path.join(OUT, 'v0.10.1-damage.png'), optimize=True)


def v0110():
    banner('v0.11.0', 'IMPACT', 'Every hit lands. You feel it.',
           [('💥', 'Hit freeze'), ('🎥', 'Living camera'), ('🔊', '24 new sounds'), ('⏱️', '1-min queue')],
           'v0.11.0-banner.png', ('bomber', 'blaster', 'gunslinger'))

    def grid(title, feats, name, cols=3):
        rows = (len(feats) + cols - 1) // cols
        cw, chh, gx, gy = 470, 300, 30, 30
        W, H = 1600, 150 + rows * chh + (rows - 1) * gy + 60
        img = background(W, H, glow=(0.5, 0.3))
        d = ImageDraw.Draw(img)
        outlined(d, (W // 2, 30), title, display(56), YELLOW, anchor='ma')
        x0 = (W - (cols * cw + (cols - 1) * gx)) // 2
        for i, (icon, head, lines) in enumerate(feats):
            x, y = x0 + (i % cols) * (cw + gx), 140 + (i // cols) * (chh + gy)
            card(img, (x, y, x + cw, y + chh), outline=(150, 120, 230), radius=26)
            d.text((x + cw // 2, y + 22), icon, font=emoji(58), embedded_color=True, anchor='ma')
            d.text((x + cw // 2, y + 108), head, font=display(34), fill=YELLOW, anchor='ma')
            for li, line in enumerate(lines):
                d.text((x + cw // 2, y + 164 + li * 36), line, font=body(23, 'Bold'), fill=TEXT, anchor='ma')
        img.convert('RGB').save(os.path.join(OUT, name), optimize=True)

    # src/feel.js (per-weapon freeze 20-120 ms, trauma camera), hud.js, figurines.js
    grid('EVERY HIT LANDS', [
        ('🥊', 'Hit freeze', ['each weapon freezes the victim', '20 to 120 ms, then a jelly squash', 'one counting damage number']),
        ('🎥', 'Living camera', ['smooth shake, looks where you aim', 'zooms out for the final duel', 'punches in on your KOs']),
        ('💀', 'KO beat', ['K.O. stamp, bodies fly off', 'kill feed, 3 LEFT, FINAL DUEL', 'final KO in slow motion']),
        ('❤️', 'Big health bar', ['bottom centre, with your ammo', 'heartbeat and red edges', 'under 30% health']),
        ('👀', 'Readable chaos', ['blue outline for you, red for them', 'colour-blind option', 'bigger weapons, eye expressions']),
        ('🧊', 'Fairer fights', ['1.5 s immune after a freeze', 'bots fill the queue after 1 min', 'hide and seek stays intact']),
    ], 'v0.11.0-impact.png')
    grid('HEAR EVERY HIT', [
        ('🔫', 'Own weapon sounds', ['ray pew, ice shards, electric zap', 'a hit sound that rises', 'with every hit you chain']),
        ('📣', 'Brawler voices', ['a battle cry on every super', 'a cheer after each KO', 'gibberish, in every language']),
        ('🥾', 'Footsteps', ['sand, grass, snow and mud', 'yours, and the brawlers', 'you can see close by']),
        ('🎺', 'Match stings', ['3 LEFT, FINAL DUEL, final KO', 'the music ducks on your super', 'and goes muffled at low health']),
    ], 'v0.11.0-sound.png', cols=2)


def v0120():
    banner('v0.12.0', 'GADGETS', 'Pick your trick. Time it. Outplay.',
           [('🧰', '10 gadgets'), ('⭐', '10 star powers'), ('🪂', 'Supply drops'), ('🥋', 'Training')],
           'v0.12.0-banner.png', ('frostbite', 'volt', 'bomber'))

    # the 10 gadgets (src/gadgets.js): per brawler, A (mobility) and B (utility)
    rows = [('blaster', '🐏', 'Root Charge', 'dash, root the first foe', '🪵', 'Bark Skin', '-35% damage for 2.5 s'),
            ('gunslinger', '🌀', 'Tail Roll', 'roll, untouchable, +1 ammo', '🎆', 'Star Flare', 'reveals bushes for 3 s'),
            ('bomber', '🦘', 'Lava Hop', 'jump over a wall, burn', '🧨', 'Fuse Cut', 'next fireball 40% faster'),
            ('frostbite', '⛸️', 'Ice Slide', '5 m slide', '🧊', 'Ice Wall', '3 ice blocks for 3 s'),
            ('volt', '⚡', 'Blink', 'teleport, leave a zap trap', '🔋', 'Overclock', 'full reload, faster reload')]
    W, H = 1600, 900
    img = background(W, H, glow=(0.5, 0.3))
    d = ImageDraw.Draw(img)
    outlined(d, (W // 2, 30), 'PICK YOUR TRICK', display(56), YELLOW, anchor='ma')
    d.text((560, 118), 'A · MOBILITY', font=display(28), fill=(125, 227, 255), anchor='ma')
    d.text((1180, 118), 'B · UTILITY', font=display(28), fill=YELLOW, anchor='ma')
    for k, (key, ia, na, da, ib, nb, db) in enumerate(rows):
        y = 160 + k * 142
        p = Image.open(os.path.join(ROOT, 'public', 'assets', 'ui', key + '.png')).convert('RGBA')
        p = p.resize((int(p.width * 124 / p.height), 124), Image.LANCZOS)
        img.alpha_composite(p, (70 + (130 - p.width) // 2, y))
        for x0, icon, name, desc, col in ((260, ia, na, da, (125, 227, 255)), (880, ib, nb, db, YELLOW)):
            card(img, (x0, y + 8, x0 + 600, y + 124), outline=col, radius=22)
            d.text((x0 + 22, y + 36), icon, font=emoji(52), embedded_color=True)
            d.text((x0 + 104, y + 26), name, font=display(34), fill=col)
            d.text((x0 + 104, y + 74), desc, font=body(24, 'Bold'), fill=TEXT)
    img.convert('RGB').save(os.path.join(OUT, 'v0.12.0-gadgets.png'), optimize=True)

    feats = [('⭐', 'Star powers', ['one passive of two', 'per brawler, picked', 'before the match']),
             ('🎖️', 'Mastery', ['level 2 unlocks gadget B', 'level 4 star power 2', 'up to level 10']),
             ('🪂', 'Supply drops', ['a gold crate falls twice', 'per match, 3 cubes inside', 'a beacon warns you']),
             ('👑', 'Bounty crown', ['the cube leader wears it', 'KO them: 2 extra cubes', 'cubes now +300 HP']),
             ('🤖', 'Smarter bots', ['they dodge, hide to heal,', 'use gadgets and time', 'their supers']),
             ('🥋', 'Training dojo', ['dummies, no gas,', 'unlimited gadgets,', 'damage per second'])]
    W, H = 1600, 840
    img = background(W, H, glow=(0.5, 0.3))
    d = ImageDraw.Draw(img)
    outlined(d, (W // 2, 30), 'MORE WAYS TO WIN', display(56), YELLOW, anchor='ma')
    cw, chh, gx, gy = 470, 300, 30, 30
    x0 = (W - (3 * cw + 2 * gx)) // 2
    for i, (icon, head, lines) in enumerate(feats):
        x, y = x0 + (i % 3) * (cw + gx), 140 + (i // 3) * (chh + gy)
        card(img, (x, y, x + cw, y + chh), outline=(150, 120, 230), radius=26)
        d.text((x + cw // 2, y + 22), icon, font=emoji(58), embedded_color=True, anchor='ma')
        d.text((x + cw // 2, y + 108), head, font=display(34), fill=YELLOW, anchor='ma')
        for li, line in enumerate(lines):
            d.text((x + cw // 2, y + 164 + li * 36), line, font=body(23, 'Bold'), fill=TEXT, anchor='ma')
    img.convert('RGB').save(os.path.join(OUT, 'v0.12.0-more.png'), optimize=True)


def v0130():
    banner('v0.13.0', 'LEVEL UP', 'Every match earns something. Everyone sees it.',
           [('⭐', 'Account levels'), ('📜', 'Quests'), ('🏆', 'Bot League'), ('🎨', 'Cosmetics')],
           'v0.13.0-banner.png', ('volt', 'gunslinger', 'blaster'))

    # what a match pays (src/profile.js, src/quests.js): real numbers
    feats = [('⭐', 'Account level', ['~55 XP a match', 'coins every level,', 'cosmetics at 16 levels']),
             ('📜', 'Quests', ['3 daily + 1 weekly', 'stamped when done,', 'one reroll a day']),
             ('🏆', 'Bot League', ['trophies per brawler', 'in solo, 20 rewards', 'on the Trophy Road']),
             ('🪙', 'Slop Coins', ['earned only by playing,', 'a new shop every day,', 'looks only']),
             ('🎨', 'Cosmetics', ['recolours, golden', 'figurines, trails,', 'K.O. effects, frames']),
             ('🏅', 'Podium', ['the top 3 on steps,', 'MVP and 6 more', 'match awards'])]
    W, H = 1600, 840
    img = background(W, H, glow=(0.5, 0.3))
    d = ImageDraw.Draw(img)
    outlined(d, (W // 2, 30), 'EVERY MATCH EARNS SOMETHING', display(56), YELLOW, anchor='ma')
    cw, chh, gx, gy = 470, 300, 30, 30
    x0 = (W - (3 * cw + 2 * gx)) // 2
    for i, (icon, head, lines) in enumerate(feats):
        x, y = x0 + (i % 3) * (cw + gx), 140 + (i // 3) * (chh + gy)
        card(img, (x, y, x + cw, y + chh), outline=(150, 120, 230), radius=26)
        d.text((x + cw // 2, y + 22), icon, font=emoji(58), embedded_color=True, anchor='ma')
        d.text((x + cw // 2, y + 108), head, font=display(34), fill=YELLOW, anchor='ma')
        for li, line in enumerate(lines):
            d.text((x + cw // 2, y + 164 + li * 36), line, font=body(23, 'Bold'), fill=TEXT, anchor='ma')
    img.convert('RGB').save(os.path.join(OUT, 'v0.13.0-progress.png'), optimize=True)

    # the arena events (src/events.js) and the Weekly Chaos (src/mutators.js)
    events = [('oasis', '⛲', 'Geysers', 'erupt under your feet'), ('dunes', '☄️', 'Meteor shower', 'smashes walls and crates'),
              ('grove', '⚡', 'Lightning rod', 'strikes the closest brawler'), ('frost', '🌨️', 'Blizzard', 'sight 7 m, slower steps'),
              ('marsh', '🍄', 'Fog bank', 'fog closes in, healing mushrooms')]
    muts = [('💎', 'Cube Rain'), ('🌙', 'Night Hunt'), ('☠️', 'Gas Breath'), ('🌟', 'Super Rush'), ('🧰', 'Gadget Frenzy')]
    W, H = 1600, 900
    img = background(W, H, glow=(0.5, 0.3))
    d = ImageDraw.Draw(img)
    outlined(d, (W // 2, 30), 'THE ARENAS FIGHT BACK', display(56), YELLOW, anchor='ma')
    for k, (key, icon, name, desc) in enumerate(events):
        x, y = 60 + k * 300, 130
        card(img, (x, y, x + 280, y + 380), outline=(125, 227, 255), radius=24)
        m = Image.open(os.path.join(ROOT, 'public', 'assets', 'ui', 'map_' + key + '.jpg')).convert('RGBA')
        z = 248 * 1.35 / m.width  # zoomed in on the middle: some previews have white margins
        m = m.resize((int(m.width * z), int(m.height * z)), Image.LANCZOS)
        m = m.crop(((m.width - 248) // 2, (m.height - 140) // 2, (m.width - 248) // 2 + 248, (m.height - 140) // 2 + 140))
        img.alpha_composite(m, (x + 16, y + 16))
        d.text((x + 140, y + 170), icon, font=emoji(52), embedded_color=True, anchor='ma')
        d.text((x + 140, y + 240), name, font=display(30), fill=(125, 227, 255), anchor='ma')
        for li, line in enumerate(wrap(d, desc, body(21, 'Bold'), 240)):
            d.text((x + 140, y + 290 + li * 30), line, font=body(21, 'Bold'), fill=TEXT, anchor='ma')
    d.text((W // 2, 548), 'Every hit is telegraphed on the ground first', font=body(26, 'Bold'), fill=TEXT, anchor='ma')
    outlined(d, (W // 2, 610), 'WEEKLY CHAOS', display(46), (255, 107, 216), anchor='ma')
    for k, (icon, name) in enumerate(muts):
        x, y = 60 + k * 300, 690
        card(img, (x, y, x + 280, y + 150), outline=(255, 107, 216), radius=24)
        d.text((x + 140, y + 18), icon, font=emoji(50), embedded_color=True, anchor='ma')
        d.text((x + 140, y + 94), name, font=display(28), fill=TEXT, anchor='ma')
    img.convert('RGB').save(os.path.join(OUT, 'v0.13.0-arenas.png'), optimize=True)


def v0131():
    banner('v0.13.1', 'NEW HOME', 'A game client worthy of the name.',
           [('🏠', 'New menu'), ('🎬', 'Live showcase'), ('🛒', 'Shop tabs'), ('💎', 'Two currencies')],
           'v0.13.1-banner.png', ('frostbite', 'volt', 'gunslinger'))

    feats = [('🧭', 'Top navigation', ['Play, Collection, Shop,', 'Quests, Trophy Road,', 'your wallet and profile']),
             ('🎬', 'Live showcase', ['your brawler fights', 'behind the menu, on', 'the map you picked']),
             ('🎨', 'Skins carousel', ['every skin of your', 'brawler, one click', 'to wear it']),
             ('🛒', 'Shop with tabs', ['featured, brawlers,', 'skins, effects, emotes,', 'profile, gems']),
             ('🪙', 'Slop Coins', ['earned by playing,', 'unlock brawlers', '(1500 each)']),
             ('💎', 'Gems', ['for brawlers and looks,', 'payment coming soon,', 'no power for sale'])]
    W, H = 1600, 840
    img = background(W, H, glow=(0.5, 0.3))
    d = ImageDraw.Draw(img)
    outlined(d, (W // 2, 30), 'A NEW HOME', display(56), YELLOW, anchor='ma')
    cw, chh, gx, gy = 470, 300, 30, 30
    x0 = (W - (3 * cw + 2 * gx)) // 2
    for i, (icon, head, lines) in enumerate(feats):
        x, y = x0 + (i % 3) * (cw + gx), 140 + (i // 3) * (chh + gy)
        card(img, (x, y, x + cw, y + chh), outline=(150, 120, 230), radius=26)
        d.text((x + cw // 2, y + 22), icon, font=emoji(58), embedded_color=True, anchor='ma')
        d.text((x + cw // 2, y + 108), head, font=display(34), fill=YELLOW, anchor='ma')
        for li, line in enumerate(lines):
            d.text((x + cw // 2, y + 164 + li * 36), line, font=body(23, 'Bold'), fill=TEXT, anchor='ma')
    img.convert('RGB').save(os.path.join(OUT, 'v0.13.1-home.png'), optimize=True)


def v0140():
    banner('v0.14.0', 'BETTER TOGETHER', 'Bring a friend. Bring them back.',
           [('🤝', 'Duo Showdown'), ('💚', 'Buddy Revive'), ('📍', 'Pings'), ('🐢', 'Nurse Kappa')],
           'v0.14.0-banner.png', ('kappa', 'volt', 'gunslinger'))

    # Duo Showdown (src/game.js, worker/index.js): real numbers
    feats = [('🤝', 'Duo Showdown', ['4 teams of 2,', 'no friendly fire,', 'the last team wins']),
             ('👻', 'Buddy Revive', ['a ghost waits 15 s,', '3 s next to it: back', 'at 40% health']),
             ('💚', '2 hearts a team', ['two revives a match,', 'being hit pauses it,', 'the gas ends a ghost']),
             ('👯', 'Queue together', ['a room queues as one', 'ticket: in Duo', 'you are one team']),
             ('📍', 'Pings', ['go, attack, loot,', 'danger: your partner', 'only, never the rest']),
             ('🤖', 'Bot partners', ['they follow you,', 'run to revive you,', 'hit your target'])]
    W, H = 1600, 840
    img = background(W, H, glow=(0.5, 0.3))
    d = ImageDraw.Draw(img)
    outlined(d, (W // 2, 30), 'TWO IS BETTER THAN ONE', display(56), YELLOW, anchor='ma')
    cw, chh, gx, gy = 470, 300, 30, 30
    x0 = (W - (3 * cw + 2 * gx)) // 2
    for i, (icon, head, lines) in enumerate(feats):
        x, y = x0 + (i % 3) * (cw + gx), 140 + (i // 3) * (chh + gy)
        card(img, (x, y, x + cw, y + chh), outline=(21, 170, 191), radius=26)
        d.text((x + cw // 2, y + 22), icon, font=emoji(58), embedded_color=True, anchor='ma')
        d.text((x + cw // 2, y + 108), head, font=display(34), fill=YELLOW, anchor='ma')
        for li, line in enumerate(lines):
            d.text((x + cw // 2, y + 164 + li * 36), line, font=body(23, 'Bold'), fill=TEXT, anchor='ma')
    img.convert('RGB').save(os.path.join(OUT, 'v0.14.0-duo.png'), optimize=True)

    # Nurse Kappa (src/brawler.js, src/combat.js, src/gadgets.js)
    W, H = 1600, 760
    img = background(W, H, glow=(0.3, 0.4))
    d = ImageDraw.Draw(img)
    k = Image.open(os.path.join(UI, 'kappa.png')).convert('RGBA')
    k = k.resize((int(k.width * 540 / k.height), 540), Image.LANCZOS)
    img.alpha_composite(k, (40, H - 600))
    outlined(d, (620, 40), 'NURSE KAPPA', display(64), YELLOW)
    d.text((624, 128), 'Healer · 3600 HP · unlock: 1500 coins or 240 gems', font=body(26, 'Bold'), fill=MUTED)
    rows = [('🫧', 'Soap bubble', 'lobbed over walls, 700 splash; a hit heals her 350, her Duo partner 500'),
            ('🌊', 'Super: Tidal Wave', 'a 10 x 5 m wave: 900 and a push, the gas parted for 1.5 s'),
            ('🤿', 'River Dive', '5 m dive (8 m from water), untouchable for 0.3 s'),
            ('🥣', 'Bowl Splash', 'a puddle heals her and her partner 400/s for 3 s'),
            ('⭐', 'Star powers', 'Hydrotherapy: heals +30%  ·  Undertow: the wave pulls')]
    for i, (icon, head, line) in enumerate(rows):
        y = 190 + i * 108
        card(img, (620, y, W - 60, y + 92), outline=(148, 216, 45), radius=20)
        d.text((650, y + 18), icon, font=emoji(46), embedded_color=True)
        d.text((725, y + 12), head, font=display(30), fill=YELLOW)
        d.text((725, y + 54), line, font=body(22, 'Bold'), fill=TEXT)
    img.convert('RGB').save(os.path.join(OUT, 'v0.14.0-kappa.png'), optimize=True)


if __name__ == '__main__':
    import sys
    os.makedirs(OUT, exist_ok=True)
    if len(sys.argv) > 1:  # e.g. `make_release_art.py v0100`: only that release
        for name in sys.argv[1:]: globals()[name]()
        sys.exit()
    v020()
    v030()
    v040()
    v050()
    v060()
    v061()
    v062()
    v070()
    v080()
    v090()
    v0100()
    v0101()
    v0110()
    v0120()
    v0130()
    v0131()
    v0140()
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')
