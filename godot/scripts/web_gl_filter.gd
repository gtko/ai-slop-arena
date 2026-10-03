class_name WebGlFilter
extends RefCounted
# Web export only: a redundant-state filter between the engine and WebGL 2.
#
# The Compatibility renderer sets the whole state again for every batch: each 2D batch re-enables
# its 8 instance attributes with their divisors, re-binds its VAO (and unbinds it after the draw),
# re-binds the same textures on the same units and re-sends unchanged uniforms. Natively that is
# nearly free; in a browser every WebGL call is validated, serialised and replayed by the GPU
# process, and the home screen alone made ~14 500 calls a frame (about 40 per 2D batch): the GPU
# process could not keep up and the frame rate sat in the 30s even on a fast desktop. Measured with
# `?perf` and a call counter: 14 500 -> 5 400 calls a frame in the menu, 10 400 -> 6 500 in a match.
#
# The filter wraps WebGL2RenderingContext's methods and drops the calls that would set a state to
# the value it already has:
#   - vertex attribute enables / divisors / pointers and the element buffer, per VAO (VAO state),
#   - the VAO binding itself, deferred until a call needs it (Godot binds 0 after every draw),
#   - the active texture unit (deferred too) and the texture bound per (unit, target),
#   - the program, capabilities (enable / disable), blend / depth / stencil / scissor / viewport,
#   - buffer bindings, uniform values per location (a location belongs to one program).
# It also answers emscripten's per-frame getParameter(SCISSOR_TEST...) (the blit of the offscreen
# framebuffer) from the tracked state: that query was a synchronous round trip to the GPU process
# every frame, which kept the page from running the next frame while the GPU process drew this one.
#
# Any state it has not seen set yet is unknown and the call goes through, so it can be installed
# while the engine runs. `?noglfilter` (debug exports) turns it off for comparisons.

const JS := """
(() => {
  const P = WebGL2RenderingContext.prototype;
  if (P.__slopFilter) return 'already';
  const o = {};
  for (const k of Object.getOwnPropertyNames(P)) {
    const d = Object.getOwnPropertyDescriptor(P, k);
    if (d && typeof d.value === 'function') o[k] = d.value;
  }
  // a browser that keeps these on another prototype: leave WebGL untouched rather than break it
  if (!['enable', 'disable', 'isEnabled', 'getParameter', 'useProgram', 'bindBuffer', 'bindTexture',
        'activeTexture', 'bindVertexArray', 'drawArrays', 'drawElements'].every(k => o[k])) return 'missing';
  const NONE = {};
  const ELEMENT = 34963, ARRAY = 34962;
  let S = new WeakMap();
  let lastGl = null, lastS = null;
  const st = (gl) => {
    if (gl === lastGl) return lastS;
    let s = S.get(gl);
    if (!s) {
      s = { vao: o.getParameter.call(gl, 34229) || NONE, unit: o.getParameter.call(gl, 34016), va: new WeakMap(), tex: new Map(),
        buf: new Map(), ibuf: new Map(), caps: new Map(), prog: o.getParameter.call(gl, 35725) || NONE, fn: new Map(), uni: new WeakMap() };
      s.wantVao = s.vao; s.wantUnit = s.unit;
      S.set(gl, s);
    }
    lastGl = gl; lastS = s;
    return s;
  };
  const vstate = (s, v) => { let x = s.va.get(v); if (!x) { x = { en: [], div: [], ptr: [], elem: undefined }; s.va.set(v, x); } return x; };
  const flushVao = (gl, s) => { if (s.wantVao !== s.vao) { o.bindVertexArray.call(gl, s.wantVao === NONE ? null : s.wantVao); s.vao = s.wantVao; } };
  const flushUnit = (gl, s) => { if (s.wantUnit !== s.unit) { o.activeTexture.call(gl, s.wantUnit); s.unit = s.wantUnit; } };

  P.bindVertexArray = function (v) { st(this).wantVao = v || NONE; };
  P.deleteVertexArray = function (v) {
    const s = st(this);
    if (v) { s.va.delete(v); if (s.vao === v) s.vao = NONE; if (s.wantVao === v) s.wantVao = NONE; }
    return o.deleteVertexArray.call(this, v);
  };
  P.enableVertexAttribArray = function (i) {
    const s = st(this), x = vstate(s, s.wantVao);
    if (x.en[i] === true) return;
    flushVao(this, s); x.en[i] = true; o.enableVertexAttribArray.call(this, i);
  };
  P.disableVertexAttribArray = function (i) {
    const s = st(this), x = vstate(s, s.wantVao);
    if (x.en[i] === false) return;
    flushVao(this, s); x.en[i] = false; o.disableVertexAttribArray.call(this, i);
  };
  P.vertexAttribDivisor = function (i, d) {
    const s = st(this), x = vstate(s, s.wantVao);
    if (x.div[i] === d) return;
    flushVao(this, s); x.div[i] = d; o.vertexAttribDivisor.call(this, i, d);
  };
  const ptr = (name, int) => function (i, size, type, a, b, c) {
    const s = st(this), x = vstate(s, s.wantVao), buf = s.buf.get(ARRAY), p = x.ptr[i];
    const norm = int ? false : a, stride = int ? a : b, off = int ? b : c;
    if (p && buf !== undefined && p[0] === buf && p[1] === size && p[2] === type && p[3] === norm && p[4] === stride && p[5] === off && p[6] === int) return;
    flushVao(this, s);
    x.ptr[i] = buf === undefined ? undefined : [buf, size, type, norm, stride, off, int];
    return int ? o[name].call(this, i, size, type, a, b) : o[name].call(this, i, size, type, a, b, c);
  };
  P.vertexAttribPointer = ptr('vertexAttribPointer', false);
  P.vertexAttribIPointer = ptr('vertexAttribIPointer', true);
  for (const k of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements', 'getVertexAttrib',
    'getVertexAttribOffset', 'vertexAttrib1f', 'vertexAttrib2f', 'vertexAttrib3f', 'vertexAttrib4f', 'vertexAttribI4i', 'vertexAttribI4ui',
    'vertexAttrib1fv', 'vertexAttrib2fv', 'vertexAttrib3fv', 'vertexAttrib4fv', 'vertexAttribI4iv', 'vertexAttribI4uiv']) {
    const f = o[k];
    if (f) P[k] = function (...a) { flushVao(this, st(this)); return f.apply(this, a); };
  }

  P.bindBuffer = function (t, b) {
    const s = st(this), v = b || NONE;
    if (t === ELEMENT) {
      const x = vstate(s, s.wantVao);
      if (x.elem === v) return;
      flushVao(this, s); x.elem = v;
    } else {
      if (s.buf.get(t) === v) return;
      s.buf.set(t, v);
    }
    return o.bindBuffer.call(this, t, b);
  };
  for (const k of ['bufferData', 'bufferSubData', 'getBufferSubData', 'getBufferParameter', 'copyBufferSubData']) {
    const f = o[k];
    if (f) P[k] = function (t, ...a) {
      if (t === ELEMENT || (k === 'copyBufferSubData' && a[0] === ELEMENT)) flushVao(this, st(this));
      return f.call(this, t, ...a);
    };
  }
  P.deleteBuffer = function (b) {
    const s = st(this);
    if (b) {
      for (const [k, v] of s.buf) if (v === b) s.buf.delete(k);
      for (const [k, v] of s.ibuf) if (v[0] === b) s.ibuf.delete(k);
      for (const w of [s.vao, s.wantVao]) { const x = s.va.get(w); if (x && x.elem === b) x.elem = undefined; }
    }
    return o.deleteBuffer.call(this, b);
  };
  P.bindBufferBase = function (t, i, b) {
    const s = st(this), v = b || NONE, k = t * 256 + i, c = s.ibuf.get(k);
    if (c && c[0] === v && c[1] === -1 && s.buf.get(t) === v) return;
    s.ibuf.set(k, [v, -1, -1]); s.buf.set(t, v);
    return o.bindBufferBase.call(this, t, i, b);
  };
  P.bindBufferRange = function (t, i, b, off, size) {
    const s = st(this), v = b || NONE, k = t * 256 + i, c = s.ibuf.get(k);
    if (c && c[0] === v && c[1] === off && c[2] === size && s.buf.get(t) === v) return;
    s.ibuf.set(k, [v, off, size]); s.buf.set(t, v);
    return o.bindBufferRange.call(this, t, i, b, off, size);
  };

  P.activeTexture = function (u) { st(this).wantUnit = u; };
  P.bindTexture = function (t, tex) {
    const s = st(this), k = s.wantUnit * 65536 + t, v = tex || NONE;
    if (s.tex.get(k) === v) return;
    flushUnit(this, s); s.tex.set(k, v);
    return o.bindTexture.call(this, t, tex);
  };
  P.deleteTexture = function (tex) {
    const s = st(this);
    if (tex) for (const [k, v] of s.tex) if (v === tex) s.tex.delete(k);
    return o.deleteTexture.call(this, tex);
  };
  for (const k of ['texImage2D', 'texImage3D', 'texSubImage2D', 'texSubImage3D', 'texStorage2D', 'texStorage3D', 'texParameteri',
    'texParameterf', 'generateMipmap', 'copyTexImage2D', 'copyTexSubImage2D', 'copyTexSubImage3D', 'compressedTexImage2D',
    'compressedTexImage3D', 'compressedTexSubImage2D', 'compressedTexSubImage3D', 'getTexParameter']) {
    const f = o[k];
    if (f) P[k] = function (...a) { flushUnit(this, st(this)); return f.apply(this, a); };
  }

  P.useProgram = function (p) { const s = st(this), v = p || NONE; if (s.prog === v) return; s.prog = v; return o.useProgram.call(this, p); };
  P.deleteProgram = function (p) { const s = st(this); if (p && s.prog === p) s.prog = undefined; return o.deleteProgram.call(this, p); };
  P.enable = function (c) { const s = st(this); if (s.caps.get(c) === true) return; s.caps.set(c, true); return o.enable.call(this, c); };
  P.disable = function (c) { const s = st(this); if (s.caps.get(c) === false) return; s.caps.set(c, false); return o.disable.call(this, c); };
  P.isEnabled = function (c) {
    const s = st(this), v = s.caps.get(c);
    if (v !== undefined) return v;
    const r = o.isEnabled.call(this, c); s.caps.set(c, r); return r;
  };
  // calls that set the same piece of state share a group (blendFunc / blendFuncSeparate...)
  const GROUP = { blendFunc: 'bf', blendFuncSeparate: 'bf', blendEquation: 'be', blendEquationSeparate: 'be', depthMask: 'dm',
    depthFunc: 'df', colorMask: 'cm', cullFace: 'cf', frontFace: 'ff', scissor: 'sc', viewport: 'vp', blendColor: 'bc',
    stencilMask: 'sm', stencilMaskSeparate: 'sm', stencilFunc: 'sf', stencilFuncSeparate: 'sf', stencilOp: 'so', stencilOpSeparate: 'so',
    polygonOffset: 'po', lineWidth: 'lw' };
  for (const k of Object.keys(GROUP)) {
    const f = o[k], g = GROUP[k];
    if (f) P[k] = function (a, b, c, d) {
      const s = st(this), key = k + ':' + a + ',' + b + ',' + c + ',' + d;
      if (s.fn.get(g) === key) return;
      s.fn.set(g, key);
      return f.call(this, a, b, c, d);
    };
  }
  P.getParameter = function (p) {
    const s = st(this);
    if (p === 34016) return s.wantUnit;
    if (p === 34229) return s.wantVao === NONE ? null : s.wantVao;
    if (p === 3089 || p === 3042 || p === 2884 || p === 2929 || p === 2960) return this.isEnabled(p);
    flushVao(this, s); flushUnit(this, s);
    return o.getParameter.call(this, p);
  };

  const same = (c, a, off, n) => { if (!c || c.length !== n) return false; for (let i = 0; i < n; i++) if (c[i] !== a[off + i]) return false; return true; };
  for (const k of Object.keys(o)) {
    const m = /^uniform(Matrix)?([1-4])(x[234])?(f|i|ui)?(v)?$/.exec(k);
    if (!m) continue;
    const f = o[k], mat = !!m[1], vec = !!m[5] || mat;
    if (!vec) {
      P[k] = function (loc, a, b, c, d) {
        if (!loc) return f.call(this, loc, a, b, c, d);
        const s = st(this), q = s.uni.get(loc);
        if (q && q.length === 4 && q[0] === a && q[1] === b && q[2] === c && q[3] === d) return;
        s.uni.set(loc, [a, b, c, d]);
        return f.call(this, loc, a, b, c, d);
      };
    } else {
      P[k] = function (loc, ...args) {
        if (!loc) return f.call(this, loc, ...args);
        const s = st(this), di = mat ? 1 : 0, data = args[di], off = args[di + 1] || 0;
        const n = args[di + 2] || (data.length - off);
        if (n > 64) { s.uni.delete(loc); return f.call(this, loc, ...args); }
        const q = s.uni.get(loc), tr = mat ? args[0] : null;
        if (q && q.tr === tr && same(q, data, off, n)) return;
        const c = Array.prototype.slice.call(data, off, off + n);
        c.tr = tr;
        s.uni.set(loc, c);
        return f.call(this, loc, ...args);
      };
    }
  }
  const reset = () => { S = new WeakMap(); lastGl = null; lastS = null; };
  for (const c of document.querySelectorAll('canvas')) {
    c.addEventListener('webglcontextlost', reset);
    c.addEventListener('webglcontextrestored', reset);
  }
  P.__slopFilter = true;
  return 'on';
})()
"""

static var installed := false

static func install() -> void:
	if installed or not OS.has_feature("web") or DebugArgs.has("noglfilter"):
		return
	installed = true
	var r = JavaScriptBridge.eval(JS, true)
	if typeof(r) != TYPE_STRING or (r != "on" and r != "already"):
		push_warning("WebGL state filter not installed: %s" % str(r))
