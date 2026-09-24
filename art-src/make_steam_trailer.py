"""Steam trailer: the recorded gameplay frames (.ai3d/capture/trailer/f*.jpg, 1920x1080, 30 fps, from src/trailer.js)
with the battle theme, the logo slamming in word by word on the music's drop, and the logo again at the end.
  -> steam/store/trailer.mp4 (H.264 1080p30 + AAC, the format Steam recommends)
Usage: python art-src/make_steam_trailer.py
"""
import math, os, subprocess
from PIL import Image, ImageChops, ImageEnhance, ImageFilter

ROOT = os.path.join(os.path.dirname(__file__), '..')
FRAMES = os.path.join(ROOT, '.ai3d', 'capture', 'trailer')
OUT = os.path.join(ROOT, 'steam', 'store', 'trailer.mp4')
MUSIC = os.path.join(ROOT, 'public', 'assets', 'music', 'battle.mp3')
SFX = os.path.join(ROOT, 'public', 'assets', 'sfx')
W, H, FPS = 1920, 1080, 30
N = len([f for f in os.listdir(FRAMES) if f.endswith('.jpg')])
T = N / FPS

MUSIC_DROP = 11.15            # where battle.mp3 kicks in (seconds into the track)
WORDS = [                     # logo.png column range, impact time in the video (on the music's accents)
    ((0, 292), 0.55),         # AI
    ((292, 848), 1.05),       # SLOP
    ((848, 1627), 1.40),      # ARENA
]
MUSIC_START = MUSIC_DROP - WORDS[0][1]
INTRO_OUT = 2.8               # the intro logo leaves
END_HIT = T - 2.2             # the logo comes back
LOGO_W = 1400                 # final logo width on screen


def ease_out(p):
    return 1 - (1 - p) ** 3


def clamp(v, a=0.0, b=1.0):
    return max(a, min(b, v))


def with_shadow(img):
    """Soft drop shadow under a word, so it stays readable on any arena."""
    pad = 40
    out = Image.new('RGBA', (img.width + pad * 2, img.height + pad * 2))
    sh = Image.new('RGBA', img.size, (0, 0, 0, 0))
    sh.putalpha(img.getchannel('A').point(lambda v: v * 0.7))
    out.alpha_composite(sh, (pad + 6, pad + 12))
    out = out.filter(ImageFilter.GaussianBlur(10))
    out.alpha_composite(img, (pad, pad))
    return out, pad


logo = Image.open(os.path.join(ROOT, 'docs', 'readme', 'logo.png')).convert('RGBA')
k = LOGO_W / logo.width
logo = logo.resize((LOGO_W, round(logo.height * k)), Image.LANCZOS)
LX, LY = (W - LOGO_W) // 2, (H - logo.height) // 2 - 40
words = []
for (x0, x1), hit in WORDS:
    a, b = round(x0 * k), round(x1 * k)
    img, pad = with_shadow(logo.crop((a, 0, b, logo.height)))
    words.append((img, pad, LX + a, hit))
full, full_pad = with_shadow(logo)


def paste_scaled(frame, img, pad, x, y, scale, alpha):
    """Composite img (anchored at its unpadded top-left x, y) scaled around its centre."""
    if alpha <= 0.01:
        return
    w, h = max(1, round(img.width * scale)), max(1, round(img.height * scale))
    im = img.resize((w, h), Image.BILINEAR) if scale != 1 else img
    if alpha < 1:
        im = im.copy()
        im.putalpha(im.getchannel('A').point(lambda v: v * alpha))
    cx, cy = x - pad + img.width / 2, y - pad + img.height / 2
    frame.alpha_composite(im, (round(cx - w / 2), round(cy - h / 2)))


def slam(t, hit, lead=0.22, start_scale=2.6):
    """Scale and opacity of a word falling onto the screen and bouncing at t = hit."""
    if t < hit - lead:
        return None
    if t < hit:
        p = (t - (hit - lead)) / lead
        return 1 + (start_scale - 1) * (1 - p) ** 2, p
    d = t - hit
    return 1 + 0.07 * math.exp(-d * 9) * math.cos(d * 28), 1.0


def frame_at(i):
    t = i / FPS
    frame = Image.open(os.path.join(FRAMES, f'f{i:05d}.jpg')).convert('RGB')

    # darken the game behind the logo
    dim = 0.0
    if t < INTRO_OUT + 0.5:
        dim = 0.5 * clamp(t / 0.5) * (1 - clamp((t - INTRO_OUT) / 0.5))
    if t > END_HIT - 0.4:
        dim = max(dim, 0.55 * clamp((t - (END_HIT - 0.4)) / 0.4))
    if dim:
        frame = ImageEnhance.Brightness(frame).enhance(1 - dim)
    frame = frame.convert('RGBA')

    # shake + flash on every impact
    shake_x = shake_y = flash = 0.0
    hits = [(h, 0.25 if n < 2 else 0.45) for n, (_, _, _, h) in enumerate(words)] + [(END_HIT, 0.4)]
    for h, strength in hits:
        d = t - h
        if 0 <= d < 0.5:
            e = math.exp(-d * 10)
            shake_x += 16 * strength * 4 * e * math.sin(d * 90)
            shake_y += 10 * strength * 4 * e * math.cos(d * 70)
            flash = max(flash, strength * math.exp(-d * 14))

    if t < INTRO_OUT + 0.4:
        out = clamp((t - INTRO_OUT) / 0.4)
        for img, pad, x, hit in words:
            s = slam(t, hit)
            if s:
                scale, alpha = s
                paste_scaled(frame, img, pad, x + shake_x, LY + shake_y, scale * (1 + 0.12 * out), alpha * (1 - out))
    if t >= END_HIT - 0.25:
        scale, alpha = slam(t, END_HIT, lead=0.25, start_scale=1.9)
        paste_scaled(frame, full, full_pad, LX + shake_x, LY + shake_y, scale, alpha)

    if flash > 0.01:
        frame = Image.blend(frame, Image.new('RGBA', frame.size, (255, 255, 255, 255)), flash)
    if t > T - 0.6:  # fade to black
        frame = Image.blend(frame, Image.new('RGBA', frame.size, (0, 0, 0, 255)), clamp((t - (T - 0.6)) / 0.6))
    return frame.convert('RGB').tobytes()


# audio: music from just before the drop, a hit per word, a big boom on ARENA and on the end logo
sfx = [('hit.mp3', WORDS[0][1], 0.8), ('hit.mp3', WORDS[1][1], 0.8), ('boom_big.mp3', WORDS[2][1], 0.7),
       ('boom_big.mp3', END_HIT, 0.6)]
cmd = ['ffmpeg', '-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
       '-ss', f'{MUSIC_START:.3f}', '-t', f'{T:.3f}', '-i', MUSIC]
for name, _, _ in sfx:
    cmd += ['-i', os.path.join(SFX, name)]
chains = [f'[1:a]volume=0.9,afade=t=out:st={T - 1.6:.2f}:d=1.6[m]']
for n, (_, at, vol) in enumerate(sfx):
    ms = round(at * 1000)
    chains.append(f'[{n + 2}:a]volume={vol},adelay={ms}|{ms}[s{n}]')
chains.append('[m]' + ''.join(f'[s{n}]' for n in range(len(sfx))) +
              f'amix=inputs={len(sfx) + 1}:normalize=0:duration=first,alimiter=limit=0.95[a]')
cmd += ['-filter_complex', ';'.join(chains), '-map', '0:v', '-map', '[a]',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', OUT]

proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
for i in range(N):
    proc.stdin.write(frame_at(i))
proc.stdin.close()
proc.wait()
print(OUT, f'{os.path.getsize(OUT) / 1e6:.1f} MB', f'{T:.1f} s')
