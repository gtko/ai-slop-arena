"""Builds godot/web_shell/shell.html, the custom HTML shell of the Godot web export (export preset
"Web" -> html/custom_html_shell), from src/shell.template.html with the loader's font and sprites
inlined as data URIs (the loader must show up with the page, before the engine downloads).

    python godot/web_shell/build_shell.py           # rebuild shell.html
    python godot/web_shell/build_shell.py --assets  # also regenerate the sprites + font subset (needs Pillow, fonttools, brotli)

The folder has a .gdignore: Godot does not import it, the exporter only reads shell.html.
"""
import base64
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'src')
GODOT = os.path.dirname(HERE)


def make_assets():
    from PIL import Image
    for key in ('blaster', 'gunslinger'):
        im = Image.open(os.path.join(GODOT, 'assets', 'ui', key + '.png')).convert('RGBA')
        im = im.crop(im.getbbox())
        h = 300
        im = im.resize((round(im.width * h / im.height), h), Image.LANCZOS)
        im.save(os.path.join(SRC, key + '.webp'), 'WEBP', quality=82, method=6)
    subprocess.check_call([sys.executable, '-m', 'fontTools.subset', os.path.join(GODOT, 'assets', 'fonts', 'LilitaOne-Regular.ttf'),
                           '--text=ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789%!?.,:/-+ ',
                           '--flavor=woff2', '--output-file=' + os.path.join(SRC, 'lilita.woff2')])


def b64(name):
    with open(os.path.join(SRC, name), 'rb') as f:
        return base64.b64encode(f.read()).decode('ascii')


def main():
    if '--assets' in sys.argv:
        make_assets()
    with open(os.path.join(SRC, 'shell.template.html'), encoding='utf-8') as f:
        html = f.read()
    html = (html.replace('@@FONT@@', b64('lilita.woff2'))
                .replace('@@BLASTER@@', b64('blaster.webp'))
                .replace('@@GUNSLINGER@@', b64('gunslinger.webp')))
    assert '@@' not in html, 'unreplaced placeholder'
    out = os.path.join(HERE, 'shell.html')
    with open(out, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)
    print('%s: %d bytes' % (out, os.path.getsize(out)))


if __name__ == '__main__':
    main()
