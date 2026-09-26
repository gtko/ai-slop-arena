import './site.css';
import { steam } from '../../package.json';

// Landing page: brawler cards, arena captures, feature rows, scroll reveals and a few subtle motions
// (trailer parallax, weather cross-fade). No 3D here: the trailer is recorded from the game itself.

const BASE = import.meta.env.BASE_URL;
const BRAWLERS = [
  { key: 'blaster', name: 'Blaster', role: 'Shotgun', color: '#5fb83a', hp: 4800, range: 9.5,
    desc: 'Golem-souche : son tromblon en bûche creuse crache 5 graines épineuses à courte portée. Super : une large salve qui repousse les ennemis et pulvérise les murs.' },
  { key: 'gunslinger', name: 'Gunslinger', role: 'Tireur d\'élite', color: '#f27aa8', hp: 3600, range: 16,
    desc: 'Axolotl star-ranger : ses deux pistolets à rayons tirent une rafale de 6 rayons à longue portée. Super : une volée de 12 rayons qui traverse les murs.' },
  { key: 'bomber', name: 'Bomber', role: 'Lanceur', color: '#ff7a1f', hp: 3400, range: 13,
    desc: 'Diablotin de magma : lance par-dessus les murs des boules de feu qui explosent en zone. Super : un météore qui s\'écrase et rase les abris.' },
  { key: 'frostbite', name: 'Frostbite', role: 'Mage de glace', color: '#5aa9e6', hp: 3300, range: 12,
    desc: 'Trois éclats de glace qui ralentissent. Super : une nova de givre qui gèle tout autour de lui.' },
  { key: 'volt', name: 'Volt', role: 'Robot électrique', color: '#3ec6e0', hp: 3100, range: 13,
    desc: 'Un orbe dont l\'éclair rebondit sur 2 ennemis. Super : un orage qui fait tomber la foudre.' },
  { key: 'kappa', name: 'Nurse Kappa', role: 'Soigneuse', color: '#94d82d', hp: 3600, range: 11,
    desc: 'Infirmière kappa : ses bulles passent par-dessus les murs, la soignent quand elles touchent et soignent son partenaire en Duo. Super : un raz-de-marée qui balaie les ennemis et écarte le gaz.' },
];
const MAPS = [
  { key: 'oasis', name: 'Oasis', tag: 'Grand soleil' },
  { key: 'dunes', name: 'Dune Storm', tag: 'Tempête de sable' },
  { key: 'grove', name: 'Rainy Grove', tag: 'Pluie & orage' },
  { key: 'frost', name: 'Frost Peak', tag: 'Neige · glace glissante' },
  { key: 'marsh', name: 'Misty Marsh', tag: 'Brouillard · vision réduite' },
];
const $ = s => document.querySelector(s);
const portrait = k => `${BASE}assets/ui/${k}.png`;
const still = n => `${BASE}assets/site/${n}.jpg`;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------ content ------------------------------ */

// Steam store page: package.json `steam.appId`. 480 is Valve's test app, so until the real app id
// is in, the buttons scroll to the Steam section and say "coming soon".
const STEAM_APP = steam && steam.appId !== 480 ? steam.appId : null;
if (STEAM_APP) {
  for (const a of document.querySelectorAll('[data-steam-link]')) {
    a.href = `https://store.steampowered.com/app/${STEAM_APP}/`;
    a.target = '_blank';
    a.rel = 'noopener';
  }
  for (const s of document.querySelectorAll('[data-steam-label]')) s.textContent = 'Disponible maintenant';
}

$('#cards').innerHTML = BRAWLERS.map(b => `
  <article class="card reveal" style="--c:${b.color}">
    <div class="art"><img src="${portrait(b.key)}" alt="${b.name}" loading="lazy" /></div>
    <h3>${b.name}</h3><div class="role">${b.role}</div>
    <p>${b.desc}</p>
    <div class="bar">Vie<i style="--w:${Math.round(b.hp / 5000 * 100)}%"></i></div>
    <div class="bar">Portée<i style="--w:${Math.round(b.range / 16 * 100)}%"></i></div>
  </article>`).join('');
$('#maps').innerHTML = MAPS.map(m => `
  <figure class="map reveal">
    <img src="${still('map_' + m.key)}" alt="${m.name}, capture en jeu" loading="lazy" />
    <figcaption class="label"><b>${m.name}</b><span>${m.tag}</span></figcaption>
  </figure>`).join('');
$('#crew').innerHTML = BRAWLERS.map((b, i) => `<img src="${portrait(b.key)}" alt="" style="animation-delay:${-i * 0.9}s" />`).join('');

/* ------------------------------ motion ------------------------------ */

// scroll reveals, lightly staggered inside each group
const io = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const group = [...e.target.parentElement.children].filter(el => el.classList.contains('reveal'));
    e.target.style.transitionDelay = `${Math.max(0, group.indexOf(e.target)) * 0.07}s`;
    e.target.classList.add('in');
    io.unobserve(e.target);
  }
}, { threshold: 0.18, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

// hero counters
for (const el of document.querySelectorAll('[data-count]')) {
  const end = +el.dataset.count, t0 = performance.now() + 600;
  const step = t => {
    const k = Math.min(1, Math.max(0, (t - t0) / 1200));
    el.textContent = Math.round(end * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// nav turns solid once scrolled
const nav = $('.nav');
const onScroll = () => nav.classList.toggle('solid', scrollY > 40);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// trailer frame: a few degrees of tilt toward the pointer, eased
const frame = $('#frame');
if (frame && !reduced && matchMedia('(pointer: fine)').matches) {
  let tx = 0, ty = 0, x = 0, y = 0;
  addEventListener('pointermove', e => { tx = (e.clientX / innerWidth - 0.5) * 2; ty = (e.clientY / innerHeight - 0.5) * 2; }, { passive: true });
  const tick = () => {
    x += (tx - x) * 0.05; y += (ty - y) * 0.05;
    frame.style.transform = `rotateY(${x * -3}deg) rotateX(${y * 2.2}deg)`;
    requestAnimationFrame(tick);
  };
  tick();
}
// pause the trailer when it is off screen
const video = $('#trailer');
if (video) new IntersectionObserver(([e]) => (e.isIntersecting ? video.play().catch(() => {}) : video.pause())).observe(video);

// brawler cards: slight tilt
for (const card of document.querySelectorAll('.card')) {
  card.addEventListener('pointermove', e => {
    const r = card.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = `rotateY(${x * 7}deg) rotateX(${-y * 6}deg) translateY(-4px)`;
  });
  card.addEventListener('pointerleave', () => { card.style.transform = ''; });
}

// screenshot cross-fades (weather, time of day); chips, when present, follow the current slide
function crossfade(slidesSel, chipsSel, period) {
  const slides = document.querySelectorAll(slidesSel), chips = chipsSel ? document.querySelectorAll(chipsSel) : [];
  if (slides.length < 2 || reduced) return;
  let k = 0;
  setInterval(() => {
    slides[k].classList.remove('on'); chips[k]?.classList.remove('on');
    k = (k + 1) % slides.length;
    slides[k].classList.add('on'); chips[k]?.classList.add('on');
  }, period);
}
crossfade('#weatherSlides img', null, 4200);
crossfade('#todSlides img', '#todChips span', 3000);

// the prompts list: a short peek that unfolds to its full height, and folds back
const prompts = $('#prompts');
if (prompts) {
  const body = prompts.querySelector('.prompts-body'), btn = prompts.querySelector('.prompts-toggle'), label = btn.textContent;
  btn.addEventListener('click', () => {
    const open = !prompts.classList.contains('open');
    body.style.maxHeight = `${body.scrollHeight}px`;
    if (!open) {
      body.offsetHeight; // commit the full height so the fold animates from it
      body.style.maxHeight = '';
      if (prompts.getBoundingClientRect().top < 0) prompts.scrollIntoView();
    }
    prompts.classList.toggle('open', open);
    btn.textContent = open ? 'Replier' : label;
    btn.setAttribute('aria-expanded', open);
  });
  body.addEventListener('transitionend', e => {
    if (e.target === body && e.propertyName === 'max-height' && prompts.classList.contains('open')) body.style.maxHeight = 'none';
  });
}
