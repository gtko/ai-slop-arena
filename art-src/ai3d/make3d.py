"""Local image -> textured 3D model, on this PC's GPU (AMD RX 7800 XT through ROCm PyTorch).

  shape : Hunyuan3D-2 DiT turbo + FlashVDM decoder (tencent/Hunyuan3D-2)
  paint : Hunyuan3D-Paint turbo (multiview diffusion from the mesh normals/positions + the image),
          baked with our OpenGL rasterizer (art-src/ai3d/custom_rasterizer) instead of the CUDA one

Setup (once): see art-src/ai3d/README.md — Python 3.11 venv in .ai3d/venv, Hunyuan3D-2 repo in
.ai3d/Hunyuan3D-2. Weights download from Hugging Face on first run (no account needed).

Usage:
  .ai3d/venv/Scripts/python art-src/ai3d/make3d.py decor tree_round crate ...   (art-src/decor/*.png)
  .ai3d/venv/Scripts/python art-src/ai3d/make3d.py chibi/apose gunslinger ...   (A-pose character art)
Output: art-src/glb/<set>/<name>.glb (characters -> art-src/glb/hy/<name>.glb)
"""
import os, sys, time
# memory-efficient attention kernels on AMD (still flagged experimental): without them the multiview
# texture model builds an 11 GB attention matrix and runs out of VRAM
os.environ.setdefault('TORCH_ROCM_AOTRITON_ENABLE_EXPERIMENTAL', '1')
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'art-src', 'ai3d'))          # custom_rasterizer shim
sys.path.insert(0, os.path.join(ROOT, '.ai3d', 'Hunyuan3D-2'))
import torch
from PIL import Image
from hy3dgen.rembg import BackgroundRemover
from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline, FloaterRemover, DegenerateFaceRemover, FaceReducer

FACES = {'decor': 30000, 'chibi': 40000}


def patch_hunyuan():
    """Small compatibility fixes applied to the cloned Hunyuan3D-2 repo (idempotent)."""
    p = os.path.join(ROOT, '.ai3d', 'Hunyuan3D-2', 'hy3dgen', 'texgen', 'hunyuanpaint', 'pipeline.py')
    s = open(p, encoding='utf-8').read()
    old = """            index = torch.range(29, 0, -bsz, device='cuda').long()
            timesteps = self.solver.ddim_timesteps[index]
            self.scheduler.set_timesteps(timesteps=timesteps.cpu(), device='cuda')"""
    new = """            index = torch.arange(29, -1, -bsz).long()  # patched: CPU + plain list for recent diffusers
            timesteps = self.solver.ddim_timesteps.cpu()[index]
            print('turbo timesteps', timesteps.tolist(), flush=True)
            self.scheduler.set_timesteps(timesteps=timesteps.tolist(), device='cuda')
            timesteps = timesteps.to('cuda')"""
    if old in s:
        open(p, 'w', encoding='utf-8').write(s.replace(old, new))
    # the delight model (removes baked light from the reference image) overflows to NaN in fp16 on
    # this GPU -> black textures; it is small enough to run in fp32
    p = os.path.join(ROOT, '.ai3d', 'Hunyuan3D-2', 'hy3dgen', 'texgen', 'utils', 'dehighlight_utils.py')
    s = open(p, encoding='utf-8').read()
    fixed = s.replace('torch_dtype=torch.float16,', 'torch_dtype=torch.float32,  # patched: fp16 -> NaN on ROCm') \
             .replace('self.pipeline = pipeline.to(self.device, torch.float16)', 'self.pipeline = pipeline.to(self.device, torch.float32)')
    if fixed != s:
        open(p, 'w', encoding='utf-8').write(fixed)


def main():
    patch_hunyuan()
    import warnings
    # a NaN in the texture models shows up as this warning: treat it as a failure, not a black texture
    warnings.filterwarnings('error', message='invalid value encountered in cast')
    # MIOpen (AMD's convolution library) re-tunes every conv on Windows: 5x slower here, and its
    # picks are suspected of the NaNs. PyTorch's own convolution kernels are used instead.
    torch.backends.cudnn.enabled = False
    force = '--force' in sys.argv
    # --hq: full (non-distilled) shape and paint models, 50 sculpting steps, finer grid: slower,
    # more faithful to the reference art (used for the characters)
    hq = '--hq' in sys.argv
    args = [a for a in sys.argv[1:] if a not in ('--force', '--hq')]
    group, names = args[0], args[1:]
    src_dir = os.path.join(ROOT, 'art-src', group)
    chars = group.startswith('chibi')
    out_dir = os.path.join(ROOT, 'art-src', 'glb', ('hq' if hq else 'hy') if chars else group)  # characters: compare before replacing
    tmp_dir = os.path.join(ROOT, '.ai3d', 'shapes', group.replace('/', '_') + ('_hq' if hq else ''))
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(tmp_dir, exist_ok=True)
    names = names or sorted(f[:-4] for f in os.listdir(src_dir) if f.endswith('.png'))
    todo = [n for n in names if force or not os.path.exists(os.path.join(out_dir, f'{n}.glb'))]
    for n in names:
        if n not in todo:
            print(f'{n}: exists (use --force to redo)', flush=True)
    if not todo:
        return

    # The three models don't fit together in 16 GB (the card spills into system RAM and slows down
    # 5x), so two phases: every shape first, then every texture.
    fails = 0

    def failed(name, e):
        nonlocal fails
        import traceback
        traceback.print_exc()
        print(f'{name}: FAILED {e!r}', flush=True)
        fails += 1
        if fails >= 2:
            print('ABORT: 2 failures in a row, stopping the batch', flush=True)
            sys.exit(1)

    # phase 1: shapes (untextured meshes + background-free images cached in .ai3d/shapes)
    t0 = time.time()
    shape = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained('tencent/Hunyuan3D-2', subfolder='hunyuan3d-dit-v2-0' if hq else 'hunyuan3d-dit-v2-0-turbo',
                                                             use_safetensors=True, device='cuda')
    if not hq:
        shape.enable_flashvdm()
    rembg = BackgroundRemover()
    print(f'shape model ready in {time.time() - t0:.0f}s', flush=True)
    for name in todo:
        mesh_path, img_path = os.path.join(tmp_dir, f'{name}.glb'), os.path.join(tmp_dir, f'{name}.png')
        if not force and os.path.exists(mesh_path) and os.path.exists(img_path):
            continue
        t = time.time()
        try:
            image = Image.open(os.path.join(src_dir, f'{name}.png'))
            image = rembg(image.convert('RGB')) if image.mode != 'RGBA' else image
            mesh = shape(image=image, num_inference_steps=50 if hq else 5, octree_resolution=512 if hq else 380, num_chunks=200000,
                         generator=torch.manual_seed(1234), output_type='trimesh')[0]
            mesh = FloaterRemover()(mesh)
            mesh = DegenerateFaceRemover()(mesh)
            mesh = FaceReducer()(mesh, max_facenum=60000 if hq else FACES['chibi' if chars else 'decor'])
            ext = sorted(mesh.extents)
            if ext[0] < ext[2] * 0.08:  # a garbage latent decodes to a flat slab across the grid
                raise RuntimeError(f'flat shape {ext}')
            mesh.export(mesh_path)
            image.save(img_path)
            fails = 0
            print(f'{name}: shape OK {time.time() - t:.0f}s', flush=True)
        except Exception as e:
            failed(name, e)
    del shape
    import gc
    gc.collect()
    torch.cuda.empty_cache()

    # phase 2: textures
    t0 = time.time()
    # recent diffusers refuse local custom pipeline code (hunyuanpaint/pipeline.py, from the
    # Hunyuan3D-2 repo cloned in .ai3d) unless explicitly trusted
    import diffusers
    import trimesh
    _load = diffusers.DiffusionPipeline.from_pretrained.__func__
    diffusers.DiffusionPipeline.from_pretrained = classmethod(lambda cls, *a, **k: _load(cls, *a, **{'trust_remote_code': True, **k}))
    from hy3dgen.texgen import Hunyuan3DPaintPipeline
    paint = Hunyuan3DPaintPipeline.from_pretrained('tencent/Hunyuan3D-2', subfolder='hunyuan3d-paint-v2-0' if hq else 'hunyuan3d-paint-v2-0-turbo')
    print(f'texture models ready in {time.time() - t0:.0f}s', flush=True)
    for name in todo:
        mesh_path, img_path = os.path.join(tmp_dir, f'{name}.glb'), os.path.join(tmp_dir, f'{name}.png')
        if not os.path.exists(mesh_path):
            continue
        t = time.time()
        try:
            mesh = trimesh.load(mesh_path, force='mesh')
            mesh = paint(mesh, image=Image.open(img_path))
            mesh.export(os.path.join(out_dir, f'{name}.glb'))
            fails = 0
            print(f'{name}: OK texture {time.time() - t:.0f}s', flush=True)
        except Exception as e:
            failed(name, e)
    print('batch done', flush=True)


if __name__ == '__main__':
    main()
