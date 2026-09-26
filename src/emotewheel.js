// Emote wheel (v0.13, S03): the emotes you own around a circle. Opens with the emote key (B), the
// right stick click (R3) or the 😀 touch button; pick with the mouse, a tap, the number keys, or
// the right stick + A. Sending one is the game's business (game.js localEmote).

import { EMOTES, EMOTE_ICONS } from './cosmetics.js';
import { owns } from './profile.js';
import { PAD } from './input.js';
import { settings } from './settings.js';
import { t } from './i18n/index.js';

export class EmoteWheel {
  constructor(input, onPick) {
    this.input = input;
    this.onPick = onPick;
    this.el = document.createElement('div');
    this.el.id = 'emoteWheel';
    this.el.className = 'hidden';
    document.querySelector('#hud').appendChild(this.el);
    this.el.addEventListener('pointerdown', e => {
      const b = e.target.closest('[data-i]');
      e.preventDefault(); e.stopPropagation();
      if (b) this.pick(+b.dataset.i); else this.close();
    });
    this.sel = -1;
    // touch: a small 😀 button next to the gadget
    const tb = document.querySelector('#touch');
    if (tb) {
      const btn = document.createElement('button');
      btn.className = 't-emote';
      btn.textContent = '😀';
      btn.setAttribute('aria-label', t('opt.act.emote'));
      btn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); this.toggle(); });
      tb.appendChild(btn);
    }
  }

  get open() { return !this.el.classList.contains('hidden'); }
  list() { return EMOTES.map((id, i) => i).filter(i => owns('emote:' + EMOTES[i])); }

  toggle() { if (this.open) this.close(); else this.show(); }
  show() {
    const L = this.list(), n = L.length;
    this.items = L;
    this.el.innerHTML = L.map((i, k) => {
      const a = k / n * Math.PI * 2 - Math.PI / 2, r = n > 8 ? 118 : 100;
      return `<button data-i="${i}" style="transform:translate(${(Math.cos(a) * r).toFixed(0)}px,${(Math.sin(a) * r).toFixed(0)}px)">${EMOTE_ICONS[i]}<small>${k < 9 ? k + 1 : ''}</small></button>`;
    }).join('') + `<span class="ew-hint">${t('opt.act.emote')}</span>`;
    this.el.classList.remove('hidden');
    this.sel = -1;
  }
  close() { this.el.classList.add('hidden'); this.sel = -1; }
  pick(i) { this.close(); this.onPick(i); }

  // Every frame (main loop): keys and gamepad.
  update() {
    const I = this.input;
    if (I.hit(settings.binds.emote || 'KeyB') || I.padHit(PAD.R3)) { if (this.open && this.sel >= 0) this.pick(this.items[this.sel]); else this.toggle(); return; }
    if (!this.open) return;
    for (let k = 0; k < Math.min(9, this.items.length); k++) if (I.hit('Digit' + (k + 1))) return this.pick(this.items[k]);
    if (I.hit('Escape') || I.padHit(PAD.B)) return this.close();
    // right stick: the emote it points at
    const s = I.stickR;
    if (s.length() > 0.6) {
      const a = Math.atan2(s.y, s.x) + Math.PI / 2, n = this.items.length;
      this.sel = ((Math.round(a / (Math.PI * 2) * n) % n) + n) % n;
      this.el.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === this.sel));
    }
    if (this.sel >= 0 && I.padHit(PAD.A)) this.pick(this.items[this.sel]);
  }
}
