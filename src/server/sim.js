import './polyfill.js'; // first: the game modules touch `document` while they load
import * as THREE from 'three';
import { Game, makeRoster, randomMap } from '../game.js';
import { TYPES } from '../brawler.js';
import { MAPS } from '../maps.js';

// Authoritative match for the Cloudflare room (worker/index.js): the same Game the players run,
// headless, in the "host" role. Clients are ordinary network clients of it.

const noop = () => {};
const stub = () => new Proxy({}, { get: (_, k) => (k === 'weather' ? null : noop) });

export const BRAWLER_KEYS = Object.keys(TYPES);
export const MAP_KEYS = Object.keys(MAPS);
export { makeRoster, randomMap };
export { validBrawler } from '../gadgets.js';

export class ServerMatch {
  // send(msg): to every player; sendTo(id, msg): one player; onEnd(): match over; onCheat(id, kind)
  constructor({ map, roster, send, sendTo, onEnd, onCheat }) {
    const input = { rumble: noop, endFrame: noop, usingPad: false, usingTouch: false, touch: null };
    const g = this.game = new Game({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), lighting: {}, lights: stub(), hud: stub(), input });
    g.weatherDensity = 0; // no particles to simulate
    g.newMatch({ mapKey: map, roster, localId: null, headless: true, net: { role: 'host', send, sendTo } });
    g.onMatchEnd = onEnd;
    g.onCheat = (b, kind) => onCheat && onCheat(b.id, kind, b.guard ? b.guard.strikes : 0);
    this.acc = 0;
  }

  // Advance by real elapsed time in fixed 1/60 s steps (fast projectiles need small steps).
  advance(seconds) {
    this.acc = Math.min(this.acc + seconds, 0.25);
    while (this.acc >= 1 / 60) { this.game.serverStep(1 / 60); this.acc -= 1 / 60; }
  }

  input(msg) { this.game.onInput(msg); }
  left(id) { this.game.onLeft(id); }
  rejoin(id) { this.game.onRejoin(id); }
  get ended() { return this.game.ended; }
}
