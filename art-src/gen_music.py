"""Music generation with Google Lyria 3 through OpenRouter (streamed audio).

Uses the genere-assets skill key (env OPENROUTER_API_KEY or its embedded key).
Usage: python art-src/gen_music.py [name ...]   (no names = every track; sting_* names = the short match stings)
"""
import base64, json, os, sys, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.expanduser(
    '~/AppData/Roaming/Claude/local-agent-mode-sessions/skills-plugin/b89bbb8f-eeef-49b6-9979-270022f10b08/'
    '686c3b84-1bc8-435b-b613-12dbc87299e9/skills/genere-assets/scripts'))
from generate_asset import api_key  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'music')
STYLE = 'instrumental only, no vocals, seamless loopable, video game soundtrack, cartoon mobile brawler game'
TRACKS = {  # name: (model, prompt)
    'menu': ('google/lyria-3-pro-preview', 'Relaxed groovy lobby theme, funky bass, marimba, light claps, warm and friendly, ' + STYLE),
    'battle': ('google/lyria-3-pro-preview', 'High-energy arena battle theme, punchy drums, brass stabs, playful synth lead, heroic and fun, ' + STYLE),
    # map themes: full-length songs (they were 30 s clips looping, which got repetitive)
    'm_oasis': ('google/lyria-3-pro-preview', 'Sunny desert oasis battle music, hand drums, plucked oud and bright flute, upbeat, with a calmer bridge and a big final chorus, ' + STYLE),
    'm_dunes': ('google/lyria-3-pro-preview', 'Spaghetti western showdown in a sandstorm, twangy guitar, whistling, galloping drums, tense and fun, builds up in sections, ' + STYLE),
    'm_grove': ('google/lyria-3-pro-preview', 'Rainy forest adventure battle music, pizzicato strings, woodblocks, soft thunder-like timpani, curious then heroic, ' + STYLE),
    'm_frost': ('google/lyria-3-pro-preview', 'Snowy mountain battle music, sparkling celesta and glockenspiel, sleigh bells, bouncy bass, playful and brisk, ' + STYLE),
    'm_marsh': ('google/lyria-3-pro-preview', 'Spooky foggy swamp battle music, playful bassoon, muted trumpets, creepy-cute organ, sneaky groove, ' + STYLE),
    # variety and game moments (audio.js picks them)
    'battle2': ('google/lyria-3-pro-preview', 'Second arena battle theme, bouncy electro-funk, slap bass, retro synth arpeggios, handclaps, cheeky and energetic, ' + STYLE),
    'final': ('google/lyria-3-pro-preview', 'Final showdown theme for the last 3 fighters, fast tempo, pounding taiko and drums, urgent strings, heroic brass, rising tension and climax, ' + STYLE),
    'menu2': ('google/lyria-3-pro-preview', 'Second lobby theme, chill tropical house groove, steel drums, soft plucks, sunny and relaxed, ' + STYLE),
    'lobby': ('google/lyria-3-pro-preview', 'Online waiting room music, lo-fi hip hop groove with a cartoon twist, warm keys, vinyl texture, head-nodding and patient, ' + STYLE),
    'night': ('google/lyria-3-pro-preview', 'Night-time arena battle music, mysterious and stealthy, muted plucks, soft synth pads, ticking percussion, owls-and-lanterns mood, playful tension, ' + STYLE),
    'victory': ('google/lyria-3-clip-preview', 'Short triumphant victory fanfare jingle, brass and drums, joyful, instrumental, video game win sting'),
}
# Match stings (v0.11): a Lyria clip, cut to its first seconds with a fade by ffmpeg, saved as a sound
# effect (public/assets/sfx/<name>.mp3). name: (seconds kept, prompt)
STINGS = {
    'sting_three': (2.4, 'Very short tense musical sting, three fighters left: a snare roll into a rising brass stab and a cymbal hit, '
                         'cartoon brawler game, instrumental, starts immediately with no intro'),
    'sting_duel': (3.2, 'Very short dramatic final duel sting: a twangy western guitar note, a whistle and two heavy taiko hits, '
                        'showdown tension, cartoon brawler game, instrumental, starts immediately with no intro'),
    'sting_finalko': (3.0, 'Very short triumphant knockout sting: a big orchestral hit with a gong and a bright brass fanfare flourish, '
                           'slow-motion climax, cartoon brawler game, instrumental, starts immediately with no intro'),
}
SFX_OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'sfx')


def sting(name):
    import subprocess, tempfile
    keep, prompt = STINGS[name]
    try:
        data, fmt = generate('google/lyria-3-clip-preview', prompt)
        raw = os.path.join(tempfile.gettempdir(), f'{name}_raw.{"wav" if data[:4] == b"RIFF" else "mp3"}')
        with open(raw, 'wb') as f:
            f.write(data)
        out = os.path.join(SFX_OUT, f'{name}.mp3')
        # skip leading silence, keep `keep` seconds, fade the tail, mono 96 kbps, peaks at -2 dB
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-i', raw, '-af',
                        f'silenceremove=start_periods=1:start_threshold=-45dB,atrim=0:{keep},afade=t=out:st={keep - 0.6}:d=0.6,'
                        'loudnorm=I=-16:TP=-2', '-ac', '1', '-b:a', '96k', out], check=True)
        return f'{name}: OK {os.path.getsize(out)} bytes'
    except Exception as e:
        return f'{name}: FAILED {e}'


def generate(model, prompt, timeout=600):
    body = {'model': model, 'modalities': ['text', 'audio'], 'stream': True,
            'messages': [{'role': 'user', 'content': prompt}]}
    req = urllib.request.Request('https://openrouter.ai/api/v1/chat/completions', data=json.dumps(body).encode(),
                                 headers={'Authorization': 'Bearer ' + api_key(), 'Content-Type': 'application/json'})
    chunks, fmt = [], None
    with urllib.request.urlopen(req, timeout=timeout) as r:
        for raw in r:
            line = raw.decode('utf-8', 'replace').strip()
            if not line.startswith('data:'):
                continue
            data = line[5:].strip()
            if data == '[DONE]':
                break
            try:
                ev = json.loads(data)
            except json.JSONDecodeError:
                continue
            if 'error' in ev:
                raise RuntimeError(ev['error'])
            for ch in ev.get('choices', []):
                audio = (ch.get('delta') or {}).get('audio') or (ch.get('message') or {}).get('audio') or {}
                if audio.get('data'):
                    chunks.append(audio['data'])
                fmt = audio.get('format', fmt)
    if not chunks:
        raise RuntimeError('no audio in stream')
    return base64.b64decode(''.join(chunks)), fmt


def job(name):
    model, prompt = TRACKS[name]
    try:
        data, fmt = generate(model, prompt)
        ext = 'wav' if (fmt or '').lower() in ('wav', 'pcm16') or data[:4] == b'RIFF' else 'mp3'
        path = os.path.join(OUT, f'{name}.{ext}')
        with open(path, 'wb') as f:
            f.write(data)
        return f'{name}: OK {len(data)} bytes ({ext}, format={fmt})'
    except Exception as e:  # keep going with the others
        return f'{name}: FAILED {e}'


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    names = sys.argv[1:] or list(TRACKS)
    with ThreadPoolExecutor(max_workers=4) as ex:
        for res in ex.map(lambda n: sting(n) if n in STINGS else job(n), names):
            print(res, flush=True)
