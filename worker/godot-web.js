// The Godot client's web export, served from R2 (its index.pck and index.wasm are far over the 25 MiB
// limit of Workers static assets).
//
// Bucket layout (scripts/deploy-godot-web.mjs uploads it):
//   godot/<version>/index.html, index.js, index.wasm, index.pck, *.png, *.worklet.js ...
// Big text/binary files are stored gzipped (R2 httpMetadata.contentEncoding = "gzip") and sent as they
// are to clients that accept gzip (every browser); the rare client that does not gets them inflated here.
//
// Routes:
//   /godot, /godot/          302 to /godot/<current>/ (not cached), query string kept (?server=, ?lang=)
//   /godot/<version>/<file>  the file; versioned paths never change, so they are cached for a year.
// <current> is env.GODOT_WEB_VERSION when set (to roll the Godot client back alone), else the version
// of this deploy: the Godot client then always speaks the protocol of the rooms server it lands on.

const IMMUTABLE = 'public, max-age=31536000, immutable';
const TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  wasm: 'application/wasm',            // required by WebAssembly.instantiateStreaming
  pck: 'application/octet-stream',
  png: 'image/png',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  json: 'application/json',
  webmanifest: 'application/manifest+json',
};
const FILE = /^\/godot\/(\d+\.\d+\.\d+(?:-[\w.]+)?)\/([\w.-]*)$/;

export function isGodotPath(pathname) {
  return pathname === '/godot' || pathname.startsWith('/godot/');
}

export async function serveGodot(request, env, url, deployVersion) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
  }
  if (!env.GODOT_WEB) return new Response('Godot web build not configured', { status: 503 });
  if (url.pathname === '/godot' || url.pathname === '/godot/') {
    const v = env.GODOT_WEB_VERSION || deployVersion;
    return new Response(null, {
      status: 302,
      headers: { location: `/godot/${v}/${url.search}`, 'cache-control': 'no-store' },
    });
  }
  const m = url.pathname.match(FILE);
  if (!m) return notFound();
  const [, v, name] = m;
  const file = name || 'index.html';
  const key = `godot/${v}/${file}`;
  const ext = file.split('.').pop().toLowerCase();

  // HEAD first is not needed: R2 get() with onlyIf answers conditional requests (304) and range ones.
  // Ranges only make sense on objects stored as they are; a gzipped object is always sent whole.
  const ranged = request.headers.has('range');
  let obj;
  try {
    obj = await env.GODOT_WEB.get(key, { onlyIf: request.headers, range: request.headers });
  } catch {
    // an unsatisfiable or multi-part Range makes R2 throw: answer it instead of a 500
    if (ranged) return new Response('Range not satisfiable', { status: 416 });
    return new Response('Storage unavailable', { status: 503 });
  }
  if (!obj) return notFound();
  const stored = obj.httpMetadata?.contentEncoding || '';
  if (stored && obj.range && 'body' in obj && (obj.range.offset || obj.range.length !== obj.size)) {
    await obj.body.cancel();
    obj = await env.GODOT_WEB.get(key, { onlyIf: request.headers });
    if (!obj) return notFound();
  }

  const headers = new Headers();
  headers.set('content-type', TYPES[ext] || obj.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('cache-control', IMMUTABLE);
  headers.set('etag', obj.httpEtag);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('vary', 'accept-encoding');
  if (!stored) headers.set('accept-ranges', 'bytes');

  if (!('body' in obj)) { // a precondition failed: 304 for the cache revalidation ones, 412 otherwise
    const revalidate = request.headers.has('if-none-match') || request.headers.has('if-modified-since');
    return new Response(null, { status: revalidate ? 304 : 412, headers });
  }

  const head = request.method === 'HEAD';
  if (head) await obj.body.cancel();
  if (stored) {
    const accepts = (request.headers.get('accept-encoding') || '').toLowerCase().split(',').map(s => s.trim().split(';')[0]);
    if (accepts.includes(stored)) {
      headers.set('content-encoding', stored);
      headers.set('content-length', String(obj.size));
      // encodeBody "manual": the body is already compressed, the runtime must not compress it again.
      return new Response(head ? null : obj.body, { status: 200, headers, encodeBody: 'manual' });
    }
    if (stored !== 'gzip') return new Response('Not acceptable', { status: 406 });
    // A client without gzip: inflate on the fly (length unknown, so no content-length).
    return new Response(head ? null : obj.body.pipeThrough(new DecompressionStream('gzip')), { status: 200, headers });
  }

  let status = 200;
  if (obj.range && (obj.range.offset || obj.range.length !== obj.size) && request.headers.has('range')) {
    const start = obj.range.offset ?? obj.size - obj.range.suffix;
    const length = obj.range.length ?? obj.size - start;
    headers.set('content-range', `bytes ${start}-${start + length - 1}/${obj.size}`);
    headers.set('content-length', String(length));
    status = 206;
  } else {
    headers.set('content-length', String(obj.size));
  }
  return new Response(head ? null : obj.body, { status, headers });
}

function notFound() {
  return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
}
