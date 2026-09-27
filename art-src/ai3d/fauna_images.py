"""Prompt library for the ambient fauna reference art (art-src/fauna/<key>.png): the brawlers' figurine style,
one description per animal, one pose per body plan. They feed make3d.py (Hunyuan3D) and then the fauna rig
(art-src/fauna/README.md).

Generated with openai/gpt-image-2.5-sunburst through the official OpenRouter MCP server (tool generate-image,
size 1024x1024), saved with art-src/ai3d/grab_mcp_images.py, then renamed to art-src/fauna/<key>.png.

Usage: python art-src/ai3d/fauna_images.py <key>        -> prints the full prompt to send
       python art-src/ai3d/fauna_images.py --list       -> keys and body plans

Pose rules (Hunyuan3D fuses what touches, and the rig needs clean limbs):
  - every animal is seen in a three-quarter view from the front-left (about 45 degrees), so the four legs,
    the head and the tail all show; flyers are seen from the front with the wings spread flat
  - legs straight and apart with clear gaps, tail held out from the body, mouth closed, eyes open
"""
import sys

MODEL = 'openai/gpt-image-2.5-sunburst'
STYLE = ('Clean 3D render of a small collectible figurine of a cute cartoon animal, like a Blender Cycles render of a '
         'designer toy: matte soft-touch vinyl and clay-like materials with very subtle sheen, soft diffuse studio '
         'lighting, gentle ambient occlusion in the creases, a faint soft contact shadow under the feet, plain seamless '
         'off-white background. Simple clean sculpted shapes with smooth bevelled edges and few small details (no fur '
         'strands, fur is sculpted as a few soft smooth tufts), slightly muted but colourful palette, no glossy highlights, '
         'no glow, no particles, no motion lines. Cute chibi proportions: big head, big friendly eyes, short sturdy body. '
         'The figure fills about 75% of the image with even margins. Original design. No text.')
POSES = {
    'quad': 'standing on all four legs in a calm neutral stance, seen in a three-quarter view from the front-left (about '
            '45 degrees), the four legs straight, vertical and clearly apart with visible gaps between them, the tail '
            'held out behind, head looking forward',
    'hopper': 'sitting upright on its haunches ready to hop, seen in a three-quarter view from the front-left (about 45 '
              'degrees), the front legs and the back feet clearly apart, head looking forward',
    'bird': 'standing on its two legs, seen in a three-quarter view from the front-left (about 45 degrees), wings folded '
            'against the body, the two legs straight and apart with a gap between them, tail feathers held out, head '
            'looking forward',
    'flyer': 'flying, seen straight from the front, the two wings spread wide and flat to the left and right like a '
             'letter T, legs tucked under the body, head looking at the viewer',
    'lizard': 'standing low on its four sprawled legs, seen in a three-quarter view from the front-left (about 45 '
              'degrees), the legs clearly apart from the body, the long tail held straight out behind, head up',
}
# key: (body plan, look)
FAUNA = {
    'lizard': ('lizard', 'a desert GECKO LIZARD: teal-turquoise body with a band of orange spots along the back, a cream '
               'belly, a long tapering tail, round toe pads, big round golden eyes'),
    'vulture': ('flyer', 'a friendly DESERT VULTURE: dark chocolate-brown wings with lighter tan wing tips, a fluffy white '
                'neck collar, a bald rosy-pink head, a big hooked cream beak'),
    'fennec': ('quad', 'a FENNEC FOX: pale sandy-cream fur, enormous upright ears with pink insides, a bushy tail with a '
               'dark brown tip, a small black nose, white chest'),
    'arctic_fox': ('quad', 'an ARCTIC FOX: thick fluffy white fur with light blue-grey shading, short rounded ears, a very '
                   'bushy white tail, a small black nose, dark eyes'),
    'cat': ('quad', 'a round ORANGE TABBY CAT: ginger fur with a few darker orange stripes, a white muzzle, white chest '
            'and white paws, pink nose, a long tail curling up at the tip'),
    'hedgehog': ('quad', 'a round HEDGEHOG: a dome of chunky sculpted brown spines with cream tips on the back, a tan '
                 'pointed face, a small black nose, tiny round ears, short little legs'),
    'squirrel': ('hopper', 'a RED SQUIRREL: rusty orange fur, a cream belly, tufted ears, a huge bushy S-shaped tail '
                 'curling up behind its back'),
    'frog': ('hopper', 'a bright green TREE FROG: lime-green smooth skin, a pale yellow belly, big round bulging eyes on '
             'top of the head, round orange toe pads, a wide gentle smile'),
    'hare': ('hopper', 'a SNOW HARE: white fur with soft grey shading, long upright ears with black tips, pink nose, a '
             'round white cotton tail, big back feet'),
    'penguin': ('bird', 'a chubby little PENGUIN: dark navy-blue back and head, a white belly and face patch, yellow '
                'cheek patches, a short orange beak, orange feet, short flipper wings held slightly out from the body'),
    'duck': ('bird', 'a MALLARD DUCK: an emerald-green head, a white neck ring, a chestnut breast, grey-brown body and '
             'wings with a small blue wing patch, a yellow bill, orange webbed feet'),
    'hen': ('bird', 'a plump farm HEN: creamy white feathers, a red comb and wattles, a short yellow-orange beak, a '
            'fluffy tail, orange legs'),
    'sparrow': ('bird', 'a round little SPARROW: warm brown back with darker stripes on the wings, a grey crown, a '
                'cream belly, a short yellow beak, thin orange legs'),
    'raven': ('flyer', 'a cheeky RAVEN: glossy blue-black feathers (matte in this render), a thick dark grey beak, a '
              'fanned tail, bright little eyes'),
}


def prompt(key):
    plan, look = FAUNA[key]
    return f'{STYLE}\n\nThe animal: {look}.\n\nPose: {POSES[plan]}.'


if __name__ == '__main__':
    if sys.argv[1:] == ['--list']:
        for k, (plan, _) in FAUNA.items():
            print(k, plan)
    else:
        print(prompt(sys.argv[1]))
