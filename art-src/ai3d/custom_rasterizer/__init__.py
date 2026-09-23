"""Drop-in replacement for Hunyuan3D-2's CUDA-only `custom_rasterizer`, built on OpenGL (moderngl)
so the texture pipeline runs on any GPU (here an AMD card through ROCm + the OpenGL driver).

Same contract as custom_rasterizer_kernel.rasterize_image:
  pos  [1, N, 4] clip-space vertices, tri [F, 3] int faces, resolution (H, W)
  -> findices [H, W] int32 (face index + 1, 0 = empty), barycentric [H, W, 3] float32
Row 0 is the bottom of the image, pixel centres sit at ((ndc * 0.5 + 0.5) * (W - 1)), barycentrics
are perspective-correct, nearest depth wins, no culling.
"""
import numpy as np
import torch

_ctx = None
_prog = None

VERT = """
#version 330
uniform vec2 res;
in vec4 in_pos;
in vec3 in_bary;
in float in_fid;
out vec3 v_bary;
flat out float v_fid;
void main() {
    vec2 ndc = in_pos.xy / in_pos.w;
    // match the CUDA kernel's pixel grid: ndc -1..1 spans pixel centres 0..res-1
    vec2 win = (ndc * 0.5 + 0.5) * (res - 1.0) + 0.5;
    vec2 ndc2 = win / res * 2.0 - 1.0;
    gl_Position = vec4(ndc2 * in_pos.w, in_pos.z, in_pos.w);
    v_bary = in_bary;
    v_fid = in_fid;
}
"""
FRAG = """
#version 330
in vec3 v_bary;
flat in float v_fid;
out vec4 color;
void main() { color = vec4(v_bary, v_fid); }
"""


def _context():
    global _ctx, _prog
    if _ctx is None:
        import moderngl
        _ctx = moderngl.create_standalone_context()
        _prog = _ctx.program(vertex_shader=VERT, fragment_shader=FRAG)
    return _ctx, _prog


def rasterize(pos, tri, resolution, clamp_depth=None, use_depth_prior=0):
    ctx, prog = _context()
    H, W = int(resolution[0]), int(resolution[1])
    p = pos[0].detach().float().cpu().numpy()
    f = tri.detach().long().cpu().numpy()
    nf = f.shape[0]
    verts = p[f.reshape(-1)]                                   # [F*3, 4]
    bary = np.tile(np.eye(3, dtype=np.float32), (nf, 1))       # [F*3, 3]
    fid = np.repeat(np.arange(1, nf + 1, dtype=np.float32), 3)[:, None]
    data = np.hstack([verts, bary, fid]).astype(np.float32)
    vbo = ctx.buffer(data.tobytes())
    vao = ctx.vertex_array(prog, [(vbo, '4f 3f 1f', 'in_pos', 'in_bary', 'in_fid')])
    color = ctx.texture((W, H), 4, dtype='f4')
    depth = ctx.depth_texture((W, H))
    fbo = ctx.framebuffer(color_attachments=[color], depth_attachment=depth)
    fbo.use()
    ctx.viewport = (0, 0, W, H)
    ctx.enable(ctx.DEPTH_TEST)
    ctx.disable(ctx.CULL_FACE)
    fbo.clear(0.0, 0.0, 0.0, 0.0, depth=1.0)
    prog['res'].value = (float(W), float(H))
    vao.render()
    out = np.frombuffer(fbo.read(components=4, dtype='f4'), dtype=np.float32).reshape(H, W, 4)
    for o in (vao, vbo, fbo, color, depth):
        o.release()
    dev = pos.device
    findices = torch.from_numpy(np.rint(out[..., 3]).astype(np.int32)).to(dev)
    barycentric = torch.from_numpy(out[..., :3].copy()).to(dev)
    barycentric[findices == 0] = 0
    return findices, barycentric


def interpolate(col, findices, barycentric, tri):
    f = findices - 1 + (findices == 0)
    vcol = col[0, tri.long()[f.long()]]
    result = barycentric.view(*barycentric.shape, 1) * vcol
    result = torch.sum(result, axis=-2)
    return result.view(1, *result.shape)
