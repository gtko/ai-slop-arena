"""Store icons of the Godot client from godot/icon.png (the 1024 px app icon, same as the Capacitor app's).
  godot/assets/icons/android_main_192.png       legacy launcher icon
  godot/assets/icons/android_fg_432.png         adaptive foreground: the whole square icon in the 66 % safe
                                                zone, like the Capacitor app (16.7 % inset on each side)
  godot/assets/icons/android_bg_432.png         adaptive background: the brand's dark violet
  godot/assets/icons/icon.ico                   Windows exe icon (16..256)
Usage: python art-src/make_godot_icons.py   (re-run after changing godot/icon.png)"""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
out = root / 'godot/assets/icons'
out.mkdir(parents=True, exist_ok=True)
icon = Image.open(root / 'godot/icon.png').convert('RGBA')
BG = (22, 18, 31, 255)  # assets/icon-background.png, the Capacitor adaptive background

icon.resize((192, 192), Image.LANCZOS).save(out / 'android_main_192.png')
inner = round(432 * (1 - 2 * 0.167))
fg = Image.new('RGBA', (432, 432), (0, 0, 0, 0))
fg.alpha_composite(icon.resize((inner, inner), Image.LANCZOS), ((432 - inner) // 2, (432 - inner) // 2))
fg.save(out / 'android_fg_432.png')
Image.new('RGBA', (432, 432), BG).save(out / 'android_bg_432.png')
icon.save(out / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('icons ->', out)
