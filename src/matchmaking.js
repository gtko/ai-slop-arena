import { serverBase, identityQuery } from './net.js';

// Quick play: joins the server's cross-platform queue (worker/index.js, Matchmaker). The server
// sends { t: 'queue', n, need, waited, botsIn, plats } every second, then { t: 'matched', code }
// with the room to join. After 5 minutes of waiting, bots fill the empty slots; bots() asks for a
// match with bots right away.
export class Matchmaking {
  constructor() { this.ws = null; this.handlers = new Map(); }

  on(type, fn) { this.handlers.set(type, fn); return this; }
  emit(type, msg) { const h = this.handlers.get(type); if (h) h(msg); }
  get searching() { return !!this.ws; }

  start(name, brawler) {
    this.cancel();
    const ws = this.ws = new WebSocket(`${serverBase()}/mm?${identityQuery(name, brawler)}`);
    ws.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === 'matched' || msg.t === 'error') { this.ws = null; ws.onclose = null; }
      this.emit(msg.t, msg);
    };
    ws.onclose = () => { if (this.ws === ws) { this.ws = null; this.emit('closed', {}); } };
    ws.onerror = () => { if (this.ws === ws) this.emit('error', { msg: '' }); };
  }

  bots() { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'bots' })); }

  cancel() {
    const ws = this.ws;
    this.ws = null;
    if (ws) { ws.onclose = null; ws.close(); }
  }
}
