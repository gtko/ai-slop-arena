"""Checks every steam/store/<lang>.md against the rules of the store page and against the game itself.

For each language: six "## " sections in the expected order (preview.mjs parses them), short description
at most 300 characters, the three description GIFs, no em/en dash, typographic quotes, ellipsis or arrows
(the achievements table is exempt: it must match the game word for word), every achievement of
src/achievements.js exactly as the game has it (src/i18n/locales/<lang>.json, or src/i18n/en.js for
English) and the five arena names as the game spells them.
Also warns when a Steam language has no page. Exit code 1 on any error.
Usage: python steam/store/check.py
"""
import glob, json, os, re, sys

sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
STORE = os.path.join(ROOT, 'steam', 'store')
LOCALES = os.path.join(ROOT, 'src', 'i18n', 'locales')
ACH = re.findall(r'^  ([A-Z_]+): \{', open(os.path.join(ROOT, 'src', 'achievements.js'), encoding='utf-8').read(), re.M)
MAPS = ['oasis', 'dunes', 'grove', 'frost', 'marsh']
GIFS = ['battle.gif', 'weather.gif', 'daynight.gif']
BANNED = re.compile('[—–«»„“”‘’…→]')


def english_strings():
    src = open(os.path.join(ROOT, 'src', 'i18n', 'en.js'), encoding='utf-8').read()
    return {k: v.replace("\\'", "'") for k, v in re.findall(r"'([a-zA-Z0-9_.]+)':\s*'((?:[^'\\]|\\.)*)'", src)}


def game_strings(lang):
    if lang == 'en':
        return english_strings()
    path = os.path.join(LOCALES, f'{lang}.json')
    return json.load(open(path, encoding='utf-8')) if os.path.exists(path) else None


def check(path):
    lang = os.path.basename(path)[:-3]
    text = open(path, encoding='utf-8').read().replace('\r\n', '\n')  # git may check out CRLF on Windows
    errors = []
    sections = text.split('\n## ')[1:]
    if len(sections) != 6:
        return lang, [f'{len(sections)} "## " sections, expected 6'], None
    codes = [re.search(r'```\n(.*?)\n```', s, re.S) for s in sections[:4]]
    if not all(codes):
        errors.append('sections 1 to 4 must each hold a code block')
        return lang, errors, None
    name, short, about, _ = (c.group(1) for c in codes)
    if name != 'AI SLOP ARENA':
        errors.append(f'game name is {name!r}')
    if len(short) > 300:
        errors.append(f'short description is {len(short)} characters (max 300)')
    for gif in GIFS:
        if f'[img]{{STEAM_APP_IMAGE}}/extras/{gif}[/img]' not in about:
            errors.append(f'missing {gif} in About This Game')
    ach_start = text.index(sections[4])
    for m in BANNED.finditer(text):
        if ach_start <= m.start() < ach_start + len(sections[4]):
            continue
        line = text.count('\n', 0, m.start()) + 1
        errors.append(f'banned character {m.group()!r} on line {line}')
    rows = {r[0]: r for r in (
        [c.strip().strip('`') for c in line.strip().strip('|').split('|')]
        for line in sections[4].split('\n') if line.startswith('| `'))}
    game = game_strings(lang)
    if game is None:
        errors.append(f'no src/i18n/locales/{lang}.json to compare against')
    else:
        if len(rows) != len(ACH):
            errors.append(f'{len(rows)} achievements on the page, the game has {len(ACH)}')
        for a in ACH:
            want = (game.get(f'ach.{a}'), game.get(f'ach.{a}.desc'))
            got = tuple(rows.get(a, [None, None, None])[1:3])
            if got != want:
                errors.append(f'achievement {a}: page {got} != game {want}')
        for m in MAPS:
            if f'[b]{game.get("map." + m)}[/b]' not in about:
                errors.append(f'arena {m}: "{game.get("map." + m)}" not found in the arena list')
    return lang, errors, len(short)


if __name__ == '__main__':
    files = sorted(p for p in glob.glob(os.path.join(STORE, '*.md')) if not p.endswith('README.md'))
    failed = 0
    for path in files:
        lang, errors, n = check(path)
        print(f'{lang:6} {"OK " if not errors else "ERR"} short={n}')
        for e in errors:
            print('       -', e)
        failed += bool(errors)
    pages = {os.path.basename(p)[:-3] for p in files}
    locales = {os.path.basename(p)[:-5] for p in glob.glob(os.path.join(LOCALES, '*.json'))} | {'en'}
    for lang in sorted(locales - pages):
        print(f'{lang:6} WARN the game has this language but there is no steam/store/{lang}.md')
    print(f'{len(files)} pages, {failed} with errors')
    sys.exit(1 if failed else 0)
