"""Image -> textured 3D model (GLB) with the public TRELLIS Space on Hugging Face.
Usage: python art-src/gen_3d.py blaster gunslinger ...   (inputs: art-src/chibi/<name>.png)
Anonymous GPU quota is tiny: log in once with `python -c "from huggingface_hub import login; login()"`
and the saved token is picked up here."""
import shutil, sys, time
from gradio_client import Client, handle_file
from huggingface_hub import get_token

client = Client("trellis-community/TRELLIS", token=get_token(), verbose=False)
try:
    client.predict(api_name="/start_session")
except Exception:
    pass
for name in sys.argv[1:]:
    t0 = time.time()
    try:
        img = client.predict(image=handle_file(f"art-src/chibi/{name}.png"), api_name="/preprocess_image")
        res = client.predict(
            image=handle_file(img if isinstance(img, str) else img["path"]), multiimages=[], seed=7,
            ss_guidance_strength=7.5, ss_sampling_steps=12, slat_guidance_strength=3, slat_sampling_steps=12,
            multiimage_algo="stochastic", mesh_simplify=0.95, texture_size=1024, api_name="/generate_and_extract_glb")
        shutil.copy(res[1], f"art-src/glb/{name}.glb")
        print(f"{name}: OK in {time.time() - t0:.0f}s", flush=True)
    except Exception as e:
        print(f"{name}: FAILED {repr(e)[:300]}", flush=True)
