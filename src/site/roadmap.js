import './site.css';
import './roadmap.css';
import data from './roadmap.json';

// Roadmap page (/roadmap): everything comes from roadmap.json, written with docs/roadmap.md.
// A road of release cards (colour per release), a theme filter, the concept art of the new brawlers.

const BASE = import.meta.env.BASE_URL;
const $ = s => document.querySelector(s);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const art = k => `${BASE}assets/site/roadmap/${k}.webp`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TAGS = { feel: 'Sensations', gameplay: 'Gameplay', content: 'Contenu', art: 'Graphismes', progression: 'Progression', social: 'Social', audio: 'Son', tech: 'Technique' };
const release = v => data.releases.find(r => r.version === v);
const brawler = name => data.brawlers.find(b => b.name === name);
const grad = r => r.color2 ? `linear-gradient(135deg, ${r.color}, ${r.color2})` : r.color;

/* ------------------------------ content ------------------------------ */

$('#vision').textContent = data.vision_fr;
$('#crowd').innerHTML = data.brawlers.map((b, i) =>
  `<img src="${art(b.image)}" alt="" style="--i:${i};animation-delay:${-i * 0.7}s" />`).join('');

$('#pillars').innerHTML = data.pillars.map(p => `
  <div class="pillar reveal"><span class="ico" aria-hidden="true">${esc(p.emoji)}</span><h3>${esc(p.title_fr)}</h3><p>${esc(p.text_fr)}</p></div>`).join('');

const used = [...new Set(data.releases.flatMap(r => r.highlights.map(h => h.tag)))].filter(t => TAGS[t]);
$('#filters').innerHTML = `<button class="on" data-tag="" aria-pressed="true">Tout</button>` +
  used.map(t => `<button data-tag="${t}" aria-pressed="false">${TAGS[t]}</button>`).join('');

$('#road').insertAdjacentHTML('beforeend', data.releases.map((r, i) => {
  const cast = r.new_brawlers.map(brawler).filter(Boolean);
  return `
  <li class="stop reveal" style="--c:${esc(r.color)};--g:${esc(grad(r))}">
    <span class="node" aria-hidden="true"><i>${esc(r.emoji)}</i></span>
    <article class="rel">
      <header>
        <span class="ver">${esc(r.version)}<small>version ${i + 1} / ${data.releases.length}</small></span>
        <h3>${esc(r.name)}</h3>
        <p class="teaser">« ${esc(r.teaser_fr)} »</p>
        <p class="promise">${esc(r.promise_fr)}</p>
        ${cast.length || r.new_maps.length ? `<div class="newbies">
          ${cast.map(b => `<a class="who" href="#b-${esc(b.image)}" style="--bc:${esc(b.color)}"><img src="${esc(art(b.image))}" alt="" loading="lazy" /><span><b>${esc(b.name)}</b>${esc(b.role_fr)}</span></a>`).join('')}
          ${r.new_maps.map(m => `<span class="map"><span aria-hidden="true">🗺️</span> <span><b>${esc(m)}</b>Nouvelle arène</span></span>`).join('')}
        </div>` : ''}
      </header>
      <ul class="hl">
        ${r.highlights.map(h => `<li data-tag="${esc(h.tag)}"><span class="e" aria-hidden="true">${esc(h.emoji)}</span><div><b>${esc(h.title_fr)}</b><p>${esc(h.text_fr)}</p><span class="tag">${esc(TAGS[h.tag] || h.tag)}</span></div></li>`).join('')}
      </ul>
    </article>
  </li>`;
}).join('') + `
  <li class="stop end reveal"><span class="node" aria-hidden="true"><i>🚀</i></span><a class="now-card" href="#apres"><span class="ver">ensuite</span><b>Et après ?</b><span>Élimination 3 contre 3, la Caldeira, les saisons...</span></a></li>`);

$('#newcards').innerHTML = data.brawlers.map(b => {
  const r = release(b.release);
  return `
  <article class="ncard reveal" id="b-${esc(b.image)}" style="--c:${esc(b.color)}">
    <div class="art"><img src="${esc(art(b.image))}" alt="${esc(b.name)}, concept" loading="lazy" /></div>
    <span class="when" style="--rc:${r ? esc(r.color) : 'rgba(255,255,255,0.25)'}">${r ? `<span aria-hidden="true">${esc(r.emoji)}</span> ${esc(r.version)} · ${esc(r.name)}` : '<span aria-hidden="true">⏳</span> Plus tard'}</span>
    <h3>${esc(b.name)}</h3><div class="role">${esc(b.role_fr)}</div>
    <p>${esc(b.pitch_fr)}</p>
  </article>`;
}).join('');

$('#later').innerHTML = data.later.map(l => `
  <div class="tile reveal"><span class="ico" aria-hidden="true">${esc(l.emoji)}</span><div><h3>${esc(l.title_fr)}</h3><p>${esc(l.text_fr)}</p></div></div>`).join('');
$('#moons').innerHTML = data.moonshots.map(m => `
  <div class="mcard reveal"><span class="ico" aria-hidden="true">${esc(m.emoji)}</span><h3>${esc(m.title_fr)}</h3><p>${esc(m.text_fr)}</p></div>`).join('');

/* ------------------------------ theme filter ------------------------------ */

// the rail takes the release colours, in order, from the current version (yellow) to the last one
const road = $('#road');
road.style.setProperty('--rail-g', `linear-gradient(#ffd23f, ${data.releases.flatMap(r => r.color2 ? [r.color, r.color2] : [r.color]).join(', ')})`);
$('#filters').addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  for (const b of $('#filters').children) { b.classList.toggle('on', b === btn); b.setAttribute('aria-pressed', b === btn); }
  const tag = btn.dataset.tag;
  road.classList.toggle('filtered', !!tag);
  for (const li of road.querySelectorAll('.hl li')) li.classList.toggle('match', li.dataset.tag === tag);
  for (const stop of road.querySelectorAll('.stop:not(.now):not(.end)')) stop.classList.toggle('empty', !!tag && !stop.querySelector('.hl li.match'));
});

/* ------------------------------ motion ------------------------------ */

const io = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const group = [...e.target.parentElement.children].filter(el => el.classList.contains('reveal'));
    e.target.style.transitionDelay = `${Math.min(4, Math.max(0, group.indexOf(e.target))) * 0.07}s`;
    e.target.classList.add('in');
    // once revealed, the delay would slow down every hover transition of the element
    e.target.addEventListener('transitionend', () => { e.target.style.transitionDelay = ''; }, { once: true });
    io.unobserve(e.target);
  }
}, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

// nav turns solid once scrolled; the road fills up as you scroll along it
const nav = $('.nav');
const onScroll = () => {
  nav.classList.toggle('solid', scrollY > 40);
  const r = road.getBoundingClientRect();
  const p = Math.min(1, Math.max(0, (innerHeight * 0.6 - r.top) / r.height));
  road.style.setProperty('--p', p.toFixed(4));
};
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll);
onScroll();

// concept cards: slight tilt
if (!reduced && matchMedia('(pointer: fine)').matches) {
  for (const card of document.querySelectorAll('.ncard')) {
    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      card.style.transition = 'box-shadow 0.4s';
      card.style.transform = `rotateY(${x * 7}deg) rotateX(${-y * 6}deg) translateY(-4px)`;
    });
    card.addEventListener('pointerleave', () => { card.style.transition = ''; card.style.transform = ''; });
  }
}
