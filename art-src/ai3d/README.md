# Local image → 3D pipeline

Runs on this PC's AMD GPU (RX 7800 XT, gfx1101) through AMD's ROCm build of PyTorch for Windows.
Nothing here ships with the game: it produces the GLBs in `art-src/glb/`, which
`art-src/optimize_models.py` turns into the game files under `public/assets/models/`.

| Step | Tool |
|---|---|
| reference art | `decor_images.py` (OpenRouter, one shared style prompt) → `art-src/decor/*.png` |
| character art | `char_images.py` (prompt library: figurine style + one sheet per brawler) sent to `openai/gpt-image-2.5-sunburst` through the OpenRouter MCP, saved with `grab_mcp_images.py` → `art-src/chibi/apose|action/*.png` |
| shape | Hunyuan3D-2 DiT turbo + FlashVDM (`tencent/Hunyuan3D-2`) |
| texture | Hunyuan3D-Paint turbo, baked with `custom_rasterizer/` (OpenGL via moderngl, replaces the CUDA-only kernel) |
| game files | `python art-src/optimize_models.py --decor` (triangle budget per prop, webp, meshopt) |

## Setup (once)

```bash
py -3.11 -m venv .ai3d/venv
.ai3d/venv/Scripts/python -m pip install --index-url https://rocm.nightlies.amd.com/v2/gfx110X-dgpu/ torch torchvision
.ai3d/venv/Scripts/python -m pip install diffusers transformers einops omegaconf trimesh pymeshlab pygltflib xatlas opencv-python scikit-image "rembg[cpu]" accelerate huggingface_hub moderngl tqdm safetensors
git clone --depth 1 https://github.com/Tencent-Hunyuan/Hunyuan3D-2.git .ai3d/Hunyuan3D-2
```

`.ai3d/` is git-ignored. Model weights (~15 GB) download to the Hugging Face cache on first run.

## Run

```bash
python art-src/ai3d/decor_images.py                      # reference images
.ai3d/venv/Scripts/python art-src/ai3d/make3d.py decor   # every art-src/decor/*.png
.ai3d/venv/Scripts/python art-src/ai3d/make3d.py chibi gunslinger bomber
python art-src/optimize_models.py --decor
```

Hunyuan3D-2 weights are under the Tencent Hunyuan Community License.
