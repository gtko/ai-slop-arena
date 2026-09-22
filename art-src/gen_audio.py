"""Batch audio generation for Brawl Arena (ElevenLabs), max 3 requests in flight.

Reuses the key handling of the genere-sons skill script (env ELEVENLABS_API_KEY or its embedded key).
Skips files that already exist, so it can be re-run safely.
"""
import json, os, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.expanduser('~/.claude/skills/genere-sons/scripts'))
from generate_sound import api_key  # noqa: E402

ROOT = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets')
NO = ', arcade mobile game sound effect, no music'

SFX = {
    'hit': ('short snappy cartoon impact hit on a character, soft punch thwack' + NO, 0.5),
    'hurt': ('short comic grunt of pain from a cartoon hero' + NO, 0.6),
    'break': ('sandstone brick wall smashed and crumbling, rocks tumbling' + NO, 1.2),
    'crate': ('wooden crate smashed open, planks cracking and splintering' + NO, 1.0),
    'pickup': ('magical power-up pickup, bright rising sparkle chime with a crystal ding' + NO, 0.8),
    'super': ('powerful charged super attack activation, rising energy whoosh and heavy impact' + NO, 1.2),
    'ready': ('short bright two-note sparkle chime, ability fully charged notification' + NO, 0.8),
    'death': ('cartoon character knocked out, comic boing and puff of smoke poof' + NO, 1.0),
    'gas': ('toxic green poison gas hissing and bubbling, short burst' + NO, 1.0),
    'boom_big': ('huge cartoon barrel explosion, massive deep boom with rumble and falling rubble' + NO, 2.2),
    'click': ('short soft bubbly UI button click pop' + NO, 0.5),
    'thunder': ('loud close thunder crack followed by a deep rolling rumble, no music', 5.0),
    'thunder2': ('distant rolling thunder rumble, long and deep, no music', 4.5),
    'join': ('short cheerful two-tone notification chime, a player joined the lobby' + NO, 0.8),
    'victory': ('short triumphant victory fanfare, brass and drums, upbeat cartoon mobile game win jingle', 3.5),
    'defeat': ('short sad defeat jingle, descending trombone wah wah, comic cartoon mobile game lose sting', 2.5),
}
AMBIENCE = {  # seamless loops through the sound-generation endpoint
    'amb_rain': 'steady heavy rain falling on leaves and ground, soft distant rumble, cozy, no music',
    'amb_storm': 'howling desert sandstorm wind, gusts and blowing sand hiss, no music',
    'amb_snow': 'quiet snowy mountain wind, soft cold breeze, faint snow hiss, peaceful, no music',
    'amb_marsh': 'misty swamp at dusk, frogs croaking, bubbling water, distant birds, eerie calm, no music',
    'amb_day': 'calm sunny desert outdoor ambience, soft warm wind, distant birds chirping, peaceful, no music',
    'amb_night': 'peaceful night outdoor ambience, crickets chirping, soft breeze, a distant owl, crackling torch fire, no music',
}
MUSIC = {
    'battle': ('Upbeat energetic cartoon battle arena music for a mobile brawler game, playful western-flavoured '
               'guitar riffs, punchy drums, brass stabs, fun and adventurous, instrumental, seamless loop', 60000),
    'menu': ('Relaxed groovy lobby music for a cartoon mobile brawler game, laid-back funky bass, marimba, '
             'light percussion, warm and friendly, instrumental, seamless loop', 45000),
}


def post(url, payload, timeout=300):
    for attempt in range(6):
        req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                     headers={'xi-api-key': api_key(), 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors='replace')[:400]
            if e.code == 429 and 'concurrent' in body:
                time.sleep(3 + attempt * 2)
                continue
            raise RuntimeError('HTTP %s: %s' % (e.code, body))
    raise RuntimeError('still rate limited')


def job(kind, name, spec):
    sub = 'sfx' if kind == 'sfx' else 'music'  # ambience and music loops both live in music/
    path = os.path.join(ROOT, sub, name + '.mp3')
    if os.path.exists(path):
        return name + ': exists'
    try:
        if kind == 'sfx':
            prompt, dur = spec
            data = post('https://api.elevenlabs.io/v1/sound-generation',
                        {'text': prompt, 'duration_seconds': dur, 'prompt_influence': 0.5})
        elif kind == 'amb':
            path = os.path.join(ROOT, 'music', name + '.mp3')
            data = post('https://api.elevenlabs.io/v1/sound-generation',
                        {'text': spec, 'duration_seconds': 22, 'prompt_influence': 0.4, 'loop': True,
                         'model_id': 'eleven_text_to_sound_v2'})
        else:
            prompt, ms = spec
            try:
                data = post('https://api.elevenlabs.io/v1/music', {'prompt': prompt, 'music_length_ms': ms})
            except RuntimeError as e:  # music API not on this plan -> 22 s looping bed instead
                print(name, 'music API unavailable (%s), falling back to a looped sound bed' % str(e)[:120])
                data = post('https://api.elevenlabs.io/v1/sound-generation',
                            {'text': prompt, 'duration_seconds': 22, 'prompt_influence': 0.5, 'loop': True,
                             'model_id': 'eleven_text_to_sound_v2'})
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(data)
        return '%s: OK %d bytes' % (name, len(data))
    except Exception as e:  # report and keep going
        return '%s: FAILED %s' % (name, e)


jobs = [('music', k, v) for k, v in MUSIC.items()] + [('amb', k, v) for k, v in AMBIENCE.items()] + \
       [('sfx', k, v) for k, v in SFX.items()]
with ThreadPoolExecutor(max_workers=3) as ex:
    for res in ex.map(lambda j: job(*j), jobs):
        print(res, flush=True)
