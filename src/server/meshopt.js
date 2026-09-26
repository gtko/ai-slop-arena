// Server build of 'meshoptimizer': the figurine level of detail is client-only, and Workers may not
// compile WebAssembly at run time (the real module does it as soon as it is imported).
export const MeshoptSimplifier = { supported: false, ready: Promise.resolve(), simplifyWithAttributes: () => [new Uint32Array(0), 0] };
