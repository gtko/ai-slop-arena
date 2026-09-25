"""Prompt library for the brawler reference art: one shared figurine style, one description per character, two poses.
  apose  -> art-src/chibi/apose/<key>.png   (front A-pose, feeds make3d.py for the 3D figurine)
  action -> art-src/chibi/action/<key>.png  (3/4 action pose, feeds cutout.py -> make_portraits.py menu portrait)

Generated with openai/gpt-image-2.5-sunburst through the official OpenRouter MCP server (tool generate-image,
size 1024x1024). That tool shows the image instead of saving it: art-src/ai3d/grab_mcp_images.py writes the
images of a Claude Code session to disk.

Usage: python art-src/ai3d/char_images.py <apose|action> <key>   -> prints the full prompt to send

New character: add an entry to CHARS in the same spirit (material of the body, head/hair, face, outfit, weapon,
with concrete colours and shapes), generate the A-pose first, then copy into the ACTION text any detail the
model invented that you want to keep (the MCP tool takes no reference image, so the description is what keeps
both poses on model). Style notes that mattered:
  - matte vinyl/clay figurine render (Blender-like): the glossy, saturated "mobile ad" look does not match
    Volt and Frostbite
  - nothing glowing or flying (fire and energy are sculpted solid shapes): clean cutouts and clean 3D shapes
  - A-pose with gaps under the arms and between the legs, weapon held to the side: Hunyuan3D fuses what touches
"""
import sys

MODEL = 'openai/gpt-image-2.5-sunburst'
STYLE = ('Clean 3D render of a small collectible chibi figurine, like a Blender Cycles render of a designer toy: matte '
         'soft-touch vinyl and clay-like materials with very subtle sheen, soft diffuse studio lighting, gentle ambient '
         'occlusion in the creases, a faint soft contact shadow under the feet, plain seamless off-white background. Simple '
         'clean sculpted shapes with smooth bevelled edges and few small details, slightly muted but colourful palette, no '
         'glossy highlights, no glow bloom, no particles, no motion lines. Chibi proportions: very big head (about 40% of '
         'the height), short sturdy body, short legs. The figure fills about {fill}% of the image height with even margins. '
         'Original design, not resembling any existing game character. No text.')
FILL = {'apose': 75, 'action': 80}
# per character: (look, weapon, A-pose, action pose)
CHARS = {
    'blaster': (
        'a stocky little TREE-STUMP GOLEM guardian. Body of chunky warm brown bark plates, the shoulders are cut log ends '
        'showing light wood growth rings, big blocky wooden fists, short thick legs ending in rooty feet, a few patches of '
        'green moss on shoulders and feet. The face is a lighter carved wood mask with thick wooden eyebrows, amber eyes '
        'and a determined little frown. On top of the head a bushy crown of green leaves with a small two-leaf sapling '
        'sprout in the middle and two pink five-petal blossoms. A brown leather strap across the chest with a round gold '
        'leaf medallion and two round tan seed pouches with stitched X marks.',
        'a chunky SEED BLUNDERBUSS: a short hollow-log cannon with a wide flared bell-shaped wooden muzzle, wrapped in '
        'green vines, round green spiky seeds visible inside the muzzle.',
        'the blunderbuss in the right hand, held out to the side pointing down (not in front of the body)',
        'wide battle stance, holding the seed blunderbuss with both hands at hip level aimed forward, determined '
        'expression, nothing flying out of the weapon',
    ),
    'gunslinger': (
        'a cheeky PINK AXOLOTL STAR-RANGER. Big round smooth pink head with a few darker pink spots and rosy cheeks, three '
        'frilly magenta gill fronds on each side of the head, big dark plum eyes with a confident look and a small smirk, '
        'short pink tail. Wears a white retro space-ranger suit with violet panels, a violet chest plate with a gold star, '
        'a violet belt with a round gold buckle, violet gloves, chunky white boots with violet soles, and a short violet '
        'scarf knotted at the neck.',
        'one chunky retro RAY PISTOL in each hand: white body, violet grip, small gold star, cyan ring coils and a round '
        'cyan emitter tip.',
        'the pistols held out to the sides pointing down (not in front of the body)',
        'one leg forward, both ray pistols raised and aimed forward, confident grin, nothing flying out of the pistols',
    ),
    'bomber': (
        'a small mischievous MAGMA IMP. The body is made of dark charcoal-grey volcanic rock in chunky rounded plates, with '
        'bright orange lava lines painted between the plates (flat orange paint, not glowing). On top of the head a tall '
        'swept-back tuft of sculpted orange-and-yellow flames like a hairdo, two thick curved dark rock horns, small pointed '
        'ears. Big round eyes with orange-amber irises, a cheeky open grin with small white fangs. A brown leather belt with '
        'a brass buckle and a brown pouch on the hip. Chunky rock feet with orange toes.',
        'a round FIREBALL: a ball of dark rock plates wrapped in sculpted solid orange-and-yellow flame shapes (a solid '
        'sculpted object, not real fire).',
        'the fireball in the left hand, held out to the side at hip height (not in front of the body); the right hand is empty',
        'winding up to throw overhand, one arm raised high above the shoulder holding the fireball, the other arm pointing '
        'forward at the target, mischievous grin',
    ),
    # Roadmap brawlers (docs/roadmap.md): concept art for the /roadmap page, then 3D when each one ships.
    'pipchomp': (
        'a shy little MUSHROOM KID riding a big friendly CARNIVOROUS PLANT pet. The kid: a small droopy lavender-purple '
        'bell-shaped mushroom cap with tiny cream freckles and a frilly underside as a hat (not red, no big dots), cream skin, big dark round eyes with a shy smile, a knitted teal scarf, a leaf-green tunic, '
        'brown boots. The pet, which the kid sits on: a big round leaf-green venus-flytrap head as wide as the kid is tall, '
        'the jaws open in a happy grin with a magenta-red inside and rows of short rounded white teeth, two small leaf ears, '
        'short stubby root legs, a curly vine tail with a small leaf.',
        'no weapon: the pet\'s jaws are the weapon; the kid holds a small brown leather spore pouch tied with string.',
        'the kid seated on top of the plant, both arms held out to the sides away from the body, the spore pouch in the '
        'right hand; the plant\'s four root legs apart with gaps between them',
        'the plant lunging forward mid-bite with the jaws wide open, the kid leaning forward holding on to a leaf with one '
        'hand, the other arm up, an apologetic face',
    ),
    'glitch': (
        'a cheeky little GLITCH ROBOT made of off-white vinyl. A big cube-shaped head whose front is a black screen showing '
        'two simple white square pixel eyes and a pixel grin; above the head a chunky white computer-cursor arrow on a short '
        'thin stem attached to the top of the head. The body is small and boxy with stepped pixel-stair edges on the '
        'shoulders and feet, magenta and cyan offset paint stripes along the edges like a misprint, one arm painted as if '
        'melting with drips, and that hand has six stubby fingers. Small rectangular floating-window shaped panels are '
        'sculpted onto the chest and back like stickers.',
        'a chunky retro KEYBOARD-BLASTER: a short keyboard-shaped gun with big square keys, a thick cable coiled around the '
        'arm and a square nozzle.',
        'the keyboard-blaster in the right hand, held out to the side pointing down (not in front of the body)',
        'leaning back cockily with one leg raised, firing pose with the keyboard-blaster pointed forward, the other hand '
        'doing a peace sign with its six fingers, big pixel grin, nothing flying out of the weapon',
    ),
    'mochi': (
        'a big round gentle SUMO SEAL made of soft pastel pink strawberry mochi. Pear-shaped body much wider than tall, a '
        'matte powdery surface, a thick rose-red sumo belt tied around the belly with a big knot at the back, small flipper '
        'arms, short stubby feet, a tiny white chef hat on top of the head, closed happy curved eyes, rosy cheeks with a few '
        'brown sesame seed dots, small whiskers.',
        'no weapon: it fights with its belly; it holds a small wooden rice paddle.',
        'flipper arms held out to the sides away from the body, the wooden rice paddle in the right flipper pointing down, '
        'feet apart',
        'sumo stance with knees bent, one foot raised high to stomp, flippers spread wide, determined happy face',
    ),
    'kappa': (
        'a bossy little KAPPA NURSE, a Japanese river-imp creature with smooth lime-green skin, a short yellow duck-like beak '
        'with a confident smile, big round black eyes, a flat round dish of light-blue water sculpted as a solid resin disc '
        'sitting on top of the head surrounded by a ring of short green hair, a teal turtle shell on the back, webbed hands '
        'and feet. Wears a white nurse dress with a rounded coral-red plus sign on the chest, a small white nurse cap pinned '
        'next to the water dish, coral belt.',
        'a big chunky BUBBLE SYRINGE LAUNCHER: a toy-like oversized syringe with a clear light-blue tank filled with solid '
        'sculpted bubbles, a coral plunger and a round nozzle.',
        'the bubble syringe held in the right hand out to the side pointing down, the left arm out to the side, feet apart',
        'leaning forward on one foot, lobbing underarm with the bubble syringe, the other hand on the hip, a bossy wink',
    ),
    'hopper': (
        'a hyper little FROG COURIER on roller skates. Warm yellow-orange smooth frog skin, very big round bulging eyes on '
        'top of the head with a cheeky grin, a navy blue courier cap worn backwards, a navy messenger bag with a big buckle '
        'across the chest, a white t-shirt with a navy stripe, knee pads, chunky red quad roller skates with white wheels.',
        'a big wooden Y-shaped SLINGSHOT with a thick red rubber band and a leather pouch.',
        'the slingshot in the right hand held out to the side pointing down, the left arm out to the side, skates apart',
        'skating fast leaning forward on one skate, pulling the slingshot band back to aim forward, tongue out in '
        'concentration',
    ),
    'clawdia': (
        'a small feisty HERMIT CRAB whose shell is a tiny red-roofed Japanese tea-house with round paper lanterns sculpted '
        'on the corners, coral-orange crab body, one big claw and one small claw, eyes on short stalks with a sassy look, a '
        'little green headband, short pointed legs.',
        'her big coral claw with a small brass bubble nozzle built into it.',
        'both claws held out to the sides away from the body, legs apart with gaps between them',
        'crouched low and sideways in a scuttling pose, the big claw raised and aimed forward, the small claw up in a '
        'cheeky wave, sassy grin, nothing flying out of the claw',
    ),
    'nimbus': (
        'a sleepy fluffy CLOUD SHEEP: a round body of puffy white sculpted cloud wool, a small slate-grey face and legs, '
        'droopy half-closed eyes, a thin golden lightning-bolt shaped horn on top of the head, a tiny yellow raincoat hood.',
        'a long brass UMBRELLA-RIFLE: a closed yellow umbrella with a brass barrel at its tip.',
        'the umbrella-rifle in the right hoof held out to the side pointing down, the left arm out to the side, legs apart',
        'kneeling on one knee, aiming the umbrella-rifle forward like a sniper, one eye closed, sleepy but focused, nothing '
        'flying out of the weapon',
    ),
}


def prompt(pose, key):
    look, weapon, apose, action = CHARS[key]
    if pose == 'apose':
        p = ('strict front view, standing straight in a relaxed A-pose, both arms held clearly away from the body with a '
             'visible gap between arms and torso, legs slightly apart with a gap between them, ' + apose +
             ', whole figure fully visible and centered.')
    else:
        p = f'dynamic three-quarter view action pose, {action}, whole figure fully visible and centered.'
    return f'{STYLE.format(fill=FILL[pose])}\n\nSubject: {look} Weapon: {weapon}\n\nPose: {p}'


if __name__ == '__main__':
    pose, key = sys.argv[1], sys.argv[2]
    print(prompt(pose, key))
