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
