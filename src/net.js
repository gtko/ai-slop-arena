// Thin WebSocket client for the Cloudflare room relay (worker/index.js).
// Same origin in production (wss://<site>/ws/CODE); in `npm run dev` Vite runs on 5173 while
// `npm run dev:server` (wrangler) runs the rooms on 8787.

export function serverBase() {
  const { protocol, hostname, port, host } = location;
  const ws = protocol === 'https:' ? 'wss:' : 'ws:';
  if (port === '5173') return `${ws}//${hostname}:8787`;
  return `${ws}//${host}`;
}

export function randomCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.id = null;
    this.code = null;
    this.players = [];
    this.inMatch = false;
    this.rtt = 0;
  }

  get isHost() { return !!this.players.find(p => p.id === this.id && p.host); }
  get connected() { return !!this.ws && this.ws.readyState === WebSocket.OPEN; }

  on(type, fn) { this.handlers.set(type, fn); return this; }
  emit(type, msg) { const h = this.handlers.get(type); if (h) h(msg); }

  connect(code, name, brawler) {
    this.close();
    return new Promise((resolve, reject) => {
      const url = `${serverBase()}/ws/${encodeURIComponent(code)}?name=${encodeURIComponent(name)}&b=${brawler}`;
      const ws = this.ws = new WebSocket(url);
      let welcomed = false;
      ws.onmessage = e => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.t === 'welcome') { this.id = msg.id; this.code = msg.code; welcomed = true; resolve(this); }
        if (msg.t === 'room') { this.players = msg.players; this.inMatch = msg.inMatch; this.map = msg.map; }
        if (msg.t === 'pong') this.rtt = performance.now() - msg.at;
        if (msg.t === 'error' && !welcomed) reject(new Error(msg.msg));
        this.emit(msg.t, msg);
      };
      ws.onclose = () => { if (!welcomed) reject(new Error('Could not reach the server')); this.emit('closed', {}); };
      ws.onerror = () => { if (!welcomed) reject(new Error('Could not reach the server')); };
      this.pingTimer = setInterval(() => this.send({ t: 'ping', at: performance.now() }), 2000);
    });
  }

  send(msg) { if (this.connected) this.ws.send(JSON.stringify(msg)); }

  close() {
    clearInterval(this.pingTimer);
    if (this.ws) { this.ws.onclose = null; this.ws.close(); }
    this.ws = null;
    this.players = [];
    this.id = null;
  }
}
