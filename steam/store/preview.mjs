// Builds preview.html: a local mock-up of the Steam store page from en/fr/de/es.md, to proofread the
// texts, BBCode and GIFs before pasting them into Steamworks. Layout and sizes follow the Steam page
// (616 px description column, 600x338 media, 324 px right column); capsule art is a stand-in.
//   node steam/store/preview.mjs   then open steam/store/preview.html
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
// Every Steam language, in the order of src/i18n; only those with a <code>.md file are shown.
const LANGS = Object.fromEntries(Object.entries({
  en: 'English', fr: 'Français', de: 'Deutsch', es: 'Español', 'es-419': 'Español (LatAm)', it: 'Italiano', pt: 'Português',
  'pt-BR': 'Português (BR)', nl: 'Nederlands', sv: 'Svenska', da: 'Dansk', no: 'Norsk', fi: 'Suomi', pl: 'Polski',
  cs: 'Čeština', hu: 'Magyar', ro: 'Română', bg: 'Български', el: 'Ελληνικά', tr: 'Türkçe', ru: 'Русский',
  uk: 'Українська', ar: 'العربية', th: 'ไทย', vi: 'Tiếng Việt', id: 'Bahasa Indonesia', ja: '日本語', ko: '한국어',
  'zh-CN': '简体中文', 'zh-TW': '繁體中文',
}).filter(([code]) => existsSync(join(dir, `${code}.md`))));
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Minimal Steam BBCode: headings, lists, bold/italic, images uploaded as "extras".
function bbcode(src) {
  return esc(src)
    .replace(/\[img\]\{STEAM_APP_IMAGE\}\/extras\/([^[]+)\[\/img\]/g, '<img class="bb_img" src="extras/$1">')
    .replace(/\[h2\](.*?)\[\/h2\]/g, '<h2 class="bb_tag">$1</h2>')
    .replace(/\[b\](.*?)\[\/b\]/g, '<b>$1</b>')
    .replace(/\[i\](.*?)\[\/i\]/g, '<i>$1</i>')
    .replace(/\[list\]\n?/g, '<ul class="bb_ul">').replace(/\n?\[\/list\]/g, '</ul>')
    .replace(/\[\*\](.*)/g, '<li>$1</li>')
    .replace(/<\/li>\n/g, '</li>').replace(/<\/h2>\n/g, '</h2>').replace(/<\/ul>\n/g, '</ul>')
    .replace(/\n/g, '<br>');
}

function parse(lang) {
  const md = readFileSync(join(dir, `${lang}.md`), 'utf8').replace(/\r\n/g, '\n');
  const sections = md.split(/\n## /).slice(1).map(s => {
    const [title, ...rest] = s.split('\n');
    const body = rest.join('\n');
    const code = body.match(/```\n([\s\S]*?)\n```/);
    const rows = body.split('\n').filter(l => l.startsWith('|') && !/^\|\s*-/.test(l))
      .map(l => l.slice(1, -1).split('|').map(c => c.trim().replace(/`/g, '')));
    return { title, code: code && code[1], rows };
  });
  const [name, short, about, ai, ach, req] = sections;
  return {
    name: name.code, short: short.code, about: bbcode(about.code), ai: esc(ai.code),
    aiTitle: ai.title.replace(/\s*\(.*\)/, ''), achTitle: ach.title,
    ach: ach.rows.slice(1), reqTitle: req.title, req: req.rows,
  };
}

// Interface labels of the Steam page itself, per language.
const UI = {
  en: { about: 'About This Game', release: 'Release date', dev: 'Developer', pub: 'Publisher', tags: 'Popular user-defined tags for this product:', play: 'Play Game', free: 'Free', soon: 'Coming soon', lang: 'Languages', iface: 'Interface', audio: 'Full Audio', subs: 'Subtitles', feats: ['Single-player', 'Online PvP', 'Steam Achievements', 'Steam Stats', 'Partial Controller Support'], reviews: 'All Reviews', noReviews: 'No user reviews', sysreq: 'System Requirements', wish: 'Add to your wishlist' },
  fr: { about: 'À propos du jeu', release: 'Date de parution', dev: 'Développeur', pub: 'Éditeur', tags: 'Tags populaires pour ce produit :', play: 'Jouer', free: 'Gratuit', soon: 'Prochainement', lang: 'Langues', iface: 'Interface', audio: 'Audio complet', subs: 'Sous-titres', feats: ['Solo', 'JcJ en ligne', 'Succès Steam', 'Statistiques Steam', 'Compatibilité partielle avec les manettes'], reviews: 'Toutes les évaluations', noReviews: 'Aucune évaluation', sysreq: 'Configuration requise', wish: 'Ajouter à votre liste de souhaits' },
  de: { about: 'Über dieses Spiel', release: 'Erscheinungsdatum', dev: 'Entwickler', pub: 'Publisher', tags: 'Beliebte benutzerdefinierte Tags für dieses Produkt:', play: 'Spielen', free: 'Kostenlos', soon: 'Demnächst', lang: 'Sprachen', iface: 'Oberfläche', audio: 'Vollst. Audio', subs: 'Untertitel', feats: ['Einzelspieler', 'Online-PvP', 'Steam-Errungenschaften', 'Steam-Statistiken', 'Teilweise Controllerunterstützung'], reviews: 'Alle Rezensionen', noReviews: 'Keine Rezensionen', sysreq: 'Systemanforderungen', wish: 'Zur Wunschliste hinzufügen' },
  es: { about: 'Acerca de este juego', release: 'Fecha de lanzamiento', dev: 'Desarrollador', pub: 'Editor', tags: 'Etiquetas populares para este producto:', play: 'Jugar', free: 'Gratis', soon: 'Próximamente', lang: 'Idiomas', iface: 'Interfaz', audio: 'Voces', subs: 'Subtítulos', feats: ['Un jugador', 'JcJ en línea', 'Logros de Steam', 'Estadísticas de Steam', 'Compatibilidad parcial con mando'], reviews: 'Todas las reseñas', noReviews: 'Sin reseñas de usuarios', sysreq: 'Requisitos del sistema', wish: 'Añadir a tu lista de deseados' },
};
const TAGS = ['Battle Royale', 'Top-Down Shooter', 'PvP', 'Online PvP', 'Arena Shooter', 'Multiplayer', 'Cute', 'Colorful', 'Cartoony', 'Action', 'Casual', 'Hero Shooter', 'Twin Stick Shooter', 'Free to Play', 'Top-Down', 'Stylized', '3D', 'Fast-Paced', 'Funny', 'Singleplayer'];
const SHOTS = ['feat_battle', 'feat_light', 'feat_storm', 'feat_fog', 'feat_weather', 'feat_figurines', 'map_oasis', 'map_frost', 'tod_3']
  .map(s => `../../public/assets/site/${s}.jpg`);

// Steam's own labels are only translated for a few languages here; the others show them in English.
const data = Object.fromEntries(Object.keys(LANGS).map(l => [l, { ...parse(l), ui: UI[l] || UI.en }]));

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Store Page Preview</title>
<style>
  :root { --bg:#1b2838; --text:#acb2b8; --blue:#66c0f4; --dim:#556772; --panel:rgba(0,0,0,.2); }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 Arial, Helvetica, sans-serif; }
  .bar { position:sticky; top:0; z-index:5; background:#171a21; padding:8px 16px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; font-size:12px; }
  .bar button { background:#2a475e; color:#c7d5e0; border:0; padding:5px 12px; border-radius:2px; cursor:pointer; }
  .bar button.on { background:var(--blue); color:#0e1c29; font-weight:bold; }
  .bar span { color:#8f98a0; margin-left:auto; }
  .page { max-width:940px; margin:0 auto; padding:24px 16px 80px;
    background:radial-gradient(ellipse at top, rgba(102,192,244,.12), transparent 60%); }
  .crumbs { font-size:12px; color:#8f98a0; }
  h1.name { color:#fff; font-size:26px; font-weight:normal; margin:4px 0 12px; letter-spacing:.5px; }
  .top { display:flex; gap:14px; background:var(--panel); padding:0; }
  .media { width:600px; flex:none; }
  .media .big { width:600px; height:338px; background:#000; display:block; object-fit:cover; }
  .thumbs { display:flex; gap:4px; overflow-x:auto; padding:6px 0; }
  .thumbs img, .thumbs .vid { width:116px; height:65px; object-fit:cover; opacity:.6; cursor:pointer; border:2px solid transparent; flex:none; }
  .thumbs .vid { background:#000 url(../../public/assets/site/trailer.jpg) center/cover; position:relative; }
  .thumbs .vid::after { content:"▶"; position:absolute; inset:0; display:grid; place-items:center; color:#fff; font-size:22px; }
  .thumbs .on { opacity:1; border-color:#fff; }
  .side { width:324px; flex:none; padding-right:0; }
  .capsule { width:324px; height:151px; position:relative; background:url(../../public/assets/site/feat_light.jpg) center/cover; display:grid; place-items:center; }
  .capsule img { width:88%; filter:drop-shadow(0 3px 6px rgba(0,0,0,.7)); }
  .capsule small { position:absolute; bottom:3px; right:6px; font-size:9px; color:#fff; opacity:.7; }
  .short { font-size:13px; color:#c6d4df; padding:10px 0; line-height:1.4; }
  .meta { font-size:11px; display:grid; grid-template-columns:auto 1fr; gap:3px 10px; text-transform:uppercase; color:var(--dim); }
  .meta b { font-weight:normal; color:var(--blue); text-transform:none; }
  .meta .v { color:#8f98a0; text-transform:none; }
  .tags { margin-top:10px; font-size:11px; color:var(--dim); }
  .tags a { display:inline-block; background:rgba(103,193,245,.2); color:#67c1f5; padding:0 7px; margin:2px 2px 0 0; border-radius:2px; line-height:19px; }
  .cols { display:flex; gap:14px; margin-top:24px; }
  .main { width:616px; flex:none; }
  .aside { flex:1; min-width:0; }
  .buy { background:linear-gradient(-60deg, rgba(226,244,255,.3) 5%, rgba(84,107,115,.3) 95%); padding:16px 16px 26px; position:relative; margin-bottom:26px; }
  .buy h3 { margin:0; color:#fff; font-size:21px; font-weight:normal; }
  .buy .btn { position:absolute; right:16px; bottom:-14px; display:flex; background:#000; padding:2px; border-radius:2px; }
  .buy .btn i { font-style:normal; padding:0 12px; line-height:32px; color:#fff; font-size:13px; }
  .buy .btn a { background:linear-gradient(to right, #75b022 5%, #588a1b 95%); color:#d2efa9; padding:0 15px; line-height:32px; border-radius:2px; font-size:15px; }
  .wish { display:inline-block; background:rgba(103,193,245,.2); color:#67c1f5; padding:6px 12px; font-size:13px; border-radius:2px; margin-bottom:22px; }
  h2.sec { font-size:14px; color:#fff; text-transform:uppercase; letter-spacing:2px; font-weight:normal; margin:0 0 10px; padding-bottom:2px; border-bottom:1px solid; border-image:linear-gradient(to right, #3b6e8c 5%, transparent 70%) 1; }
  .desc { font-size:14px; line-height:1.55; }
  .desc h2.bb_tag { color:#fff; font-size:15px; text-transform:uppercase; letter-spacing:1px; font-weight:normal; margin:22px 0 6px; }
  .desc img.bb_img { max-width:100%; display:block; margin:10px 0; }
  .desc ul.bb_ul { margin:4px 0 4px; padding-left:20px; }
  .box { background:var(--panel); padding:12px 14px; font-size:12px; margin-bottom:14px; }
  .box li { list-style:none; padding:4px 0 4px 26px; position:relative; color:#67c1f5; }
  .box li::before { content:"■"; position:absolute; left:4px; color:#4c6b22; }
  .box ul { margin:0; padding:0; }
  table { border-collapse:collapse; width:100%; font-size:12px; }
  .langs td, .langs th { padding:3px 4px; text-align:center; }
  .langs th { color:#8f98a0; font-weight:normal; font-size:11px; }
  .langs td:first-child { text-align:left; color:#c6d4df; }
  .langs td.ok { color:#67c1f5; }
  .ai { font-size:13px; margin-top:26px; }
  .req { display:grid; grid-template-columns:1fr 1fr; gap:16px; font-size:12px; margin-top:26px; }
  .req h4 { color:#c6d4df; text-transform:uppercase; font-size:11px; margin:0 0 6px; }
  .req p { margin:2px 0; }
  .req strong { color:#8f98a0; font-weight:normal; }
  .ach { display:flex; flex-wrap:wrap; gap:6px; }
  .ach div { width:64px; height:64px; background:#2a475e center/cover; position:relative; }
  .ach div[title]:hover::after { content:attr(title); position:absolute; left:0; top:68px; width:220px; background:#c2c2c2; color:#3d3d3f; padding:6px; font-size:11px; z-index:3; }
  .note { font-size:11px; color:#8f98a0; margin-top:6px; }
  @media (max-width: 960px) { .top, .cols { flex-direction:column; } .media, .media .big, .side, .capsule, .main { width:100%; } .media .big { height:auto; aspect-ratio:16/9; } }
</style></head>
<body>
<div class="bar">Language:
  ${Object.entries(LANGS).map(([k, v]) => `<button data-l="${k}">${v}</button>`).join('')}
  <span>Local mock-up · capsule art is a placeholder</span>
</div>
<div class="page" id="page"></div>
<script>
const DATA = ${JSON.stringify(data)};
const TAGS = ${JSON.stringify(TAGS)};
const SHOTS = ${JSON.stringify(SHOTS)};
const TRAILER = ${JSON.stringify(existsSync(join(dir, 'trailer.mp4')) ? 'trailer.mp4' : '../../public/assets/site/trailer.mp4')};
function render(l) {
  const d = DATA[l], u = d.ui;
  document.documentElement.lang = l;
  document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('.bar button').forEach(b => b.classList.toggle('on', b.dataset.l === l));
  const [head, ...rows] = d.req;
  const col = i => rows.filter(r => r[i]).map(r => '<p><strong>' + r[0] + ':</strong> ' + r[i] + '</p>').join('');
  document.getElementById('page').innerHTML = \`
  <div class="crumbs">All Games &gt; Action Games &gt; \${d.name}</div>
  <h1 class="name">\${d.name}</h1>
  <div class="top">
    <div class="media">
      <video class="big" id="big" src="\${TRAILER}" autoplay muted loop playsinline controls></video>
      <div class="thumbs"><div class="vid on" data-v="1"></div>\${SHOTS.map(s => '<img src="' + s + '">').join('')}</div>
    </div>
    <div class="side">
      <div class="capsule"><img src="../../docs/readme/logo.png" alt=""><small>placeholder</small></div>
      <div class="short">\${d.short}</div>
      <div class="meta">
        <span>\${u.reviews}:</span><span class="v">\${u.noReviews}</span>
        <span>\${u.release}:</span><span class="v">\${u.soon}</span>
        <span>\${u.dev}:</span><b>gtko</b>
        <span>\${u.pub}:</span><b>gtko</b>
      </div>
      <div class="tags">\${u.tags}<br>\${TAGS.slice(0, 7).map(t => '<a>' + t + '</a>').join('')}<a>+</a></div>
    </div>
  </div>
  <div class="cols">
    <div class="main">
      <span class="wish">\${u.wish}</span>
      <div class="buy"><h3>\${u.play} \${d.name}</h3><div class="btn"><i>\${u.free}</i><a>\${u.play}</a></div></div>
      <h2 class="sec">\${u.about}</h2>
      <div class="desc">\${d.about}</div>
      <div class="ai"><h2 class="sec">\${d.aiTitle}</h2>\${d.ai}</div>
      <div><h2 class="sec" style="margin-top:26px">\${u.sysreq}</h2>
        <div class="req"><div><h4>\${head[1]}:</h4>\${col(1)}</div><div><h4>\${head[2]}:</h4>\${col(2)}</div></div></div>
    </div>
    <div class="aside">
      <div class="box"><ul>\${u.feats.map(f => '<li>' + f + '</li>').join('')}</ul></div>
      <div class="box"><b style="color:#fff;font-weight:normal">\${u.lang}:</b>
        <table class="langs"><tr><th></th><th>\${u.iface}</th><th>\${u.audio}</th><th>\${u.subs}</th></tr>
        \${Object.values(${JSON.stringify(LANGS)}).map(n => '<tr><td>' + n + '</td><td class="ok">x</td><td></td><td></td></tr>').join('')}</table></div>
      <div class="box"><b style="color:#fff;font-weight:normal">\${d.achTitle} (\${d.ach.length})</b>
        <div class="ach" style="margin-top:8px">\${d.ach.map(a => '<div style="background-image:url(../achievements/' + a[0] + '.jpg)" title="' + a[1] + ': ' + a[2] + '"></div>').join('')}</div>
        <div class="note">hover an icon</div></div>
      <div class="box">\${TAGS.map(t => '<a style="display:inline-block;background:rgba(103,193,245,.2);color:#67c1f5;padding:0 7px;margin:2px;border-radius:2px">' + t + '</a>').join('')}</div>
    </div>
  </div>\`;
  const big = document.getElementById('big');
  document.querySelectorAll('.thumbs > *').forEach(t => t.onclick = () => {
    document.querySelectorAll('.thumbs > *').forEach(x => x.classList.remove('on')); t.classList.add('on');
    if (t.dataset.v) { const v = document.createElement('video'); Object.assign(v, { className: 'big', id: 'big', src: TRAILER, autoplay: true, muted: true, loop: true, controls: true }); document.getElementById('big').replaceWith(v); }
    else { const i = document.createElement('img'); Object.assign(i, { className: 'big', id: 'big', src: t.src }); document.getElementById('big').replaceWith(i); }
  });
  try { localStorage.setItem('steam-preview-lang', l); } catch {}
}
document.querySelectorAll('.bar button').forEach(b => b.onclick = () => render(b.dataset.l));
let start = 'en'; try { start = localStorage.getItem('steam-preview-lang') || 'en'; } catch {}
render(DATA[start] ? start : 'en');
</script>
</body></html>`;

writeFileSync(join(dir, 'preview.html'), html);
console.log('steam/store/preview.html written');
