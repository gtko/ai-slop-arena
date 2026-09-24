import en from './en.js';
import { settings } from '../settings.js';
import { steamInfo, epic } from '../platform.js';

// Every language Steam supports. [code, native name, Steam API language name]
export const LANGS = [
  ['en', 'English', 'english'],
  ['fr', 'Français', 'french'],
  ['de', 'Deutsch', 'german'],
  ['es', 'Español (España)', 'spanish'],
  ['es-419', 'Español (Latinoamérica)', 'latam'],
  ['it', 'Italiano', 'italian'],
  ['pt', 'Português', 'portuguese'],
  ['pt-BR', 'Português (Brasil)', 'brazilian'],
  ['nl', 'Nederlands', 'dutch'],
  ['sv', 'Svenska', 'swedish'],
  ['da', 'Dansk', 'danish'],
  ['no', 'Norsk', 'norwegian'],
  ['fi', 'Suomi', 'finnish'],
  ['pl', 'Polski', 'polish'],
  ['cs', 'Čeština', 'czech'],
  ['hu', 'Magyar', 'hungarian'],
  ['ro', 'Română', 'romanian'],
  ['bg', 'Български', 'bulgarian'],
  ['el', 'Ελληνικά', 'greek'],
  ['tr', 'Türkçe', 'turkish'],
  ['ru', 'Русский', 'russian'],
  ['uk', 'Українська', 'ukrainian'],
  ['ar', 'العربية', 'arabic'],
  ['th', 'ไทย', 'thai'],
  ['vi', 'Tiếng Việt', 'vietnamese'],
  ['id', 'Bahasa Indonesia', 'indonesian'],
  ['ja', '日本語', 'japanese'],
  ['ko', '한국어', 'koreana'],
  ['zh-CN', '简体中文', 'schinese'],
  ['zh-TW', '繁體中文', 'tchinese'],
];
const CODES = new Set(LANGS.map(l => l[0]));
const RTL = new Set(['ar']);

// Steam's game language wins (the player picked it in the game's Steam properties), then the Epic
// launcher's, then the browser / OS languages, then English.
function fromBrowser(tag) {
  const t = tag.toLowerCase();
  const [base, region] = t.split('-');
  if (base === 'zh') return /tw|hk|mo|hant/.test(t) ? 'zh-TW' : 'zh-CN';
  if (base === 'pt') return region === 'br' ? 'pt-BR' : 'pt';
  if (base === 'es') return !region || region === 'es' ? 'es' : 'es-419';
  if (base === 'nb' || base === 'nn') return 'no';
  return CODES.has(base) ? base : null;
}
function detect() {
  if (CODES.has(settings.lang)) return settings.lang;
  if (steamInfo.available && steamInfo.language) {
    const hit = LANGS.find(l => l[2] === steamInfo.language);
    if (hit) return hit[0];
  }
  if (epic && epic.locale) { // Epic launcher language, e.g. "fr" or "pt-BR"
    const code = fromBrowser(epic.locale);
    if (code) return code;
  }
  for (const tag of navigator.languages || [navigator.language || 'en']) {
    const code = fromBrowser(tag);
    if (code) return code;
  }
  return 'en';
}

export const lang = detect();
export const steamLang = LANGS.find(l => l[0] === lang)[2];

const files = import.meta.glob('./locales/*.json', { import: 'default' });
let dict = en;
if (lang !== 'en' && files[`./locales/${lang}.json`]) {
  try { dict = { ...en, ...(await files[`./locales/${lang}.json`]()) }; } catch (e) { console.warn('[i18n]', lang, e); }
}
const plural = new Intl.PluralRules(lang);

// t('lobby.you', { name }) -> "Bob (you)"; plural entries pick their form from vars.n.
export function t(key, vars) {
  let s = dict[key] ?? en[key] ?? key;
  if (typeof s === 'object') s = s[plural.select(vars?.n ?? 0)] ?? s.other;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s;
}

// Static markup: data-i18n (text), data-i18n-html, data-i18n-placeholder / -title / -aria.
export function translateDom(root = document) {
  document.documentElement.lang = lang;
  document.documentElement.dir = RTL.has(lang) ? 'rtl' : 'ltr';
  for (const e of root.querySelectorAll('[data-i18n]')) e.textContent = t(e.dataset.i18n);
  for (const e of root.querySelectorAll('[data-i18n-html]')) e.innerHTML = t(e.dataset.i18nHtml);
  for (const e of root.querySelectorAll('[data-i18n-placeholder]')) e.placeholder = t(e.dataset.i18nPlaceholder);
  for (const e of root.querySelectorAll('[data-i18n-title]')) e.title = t(e.dataset.i18nTitle);
  for (const e of root.querySelectorAll('[data-i18n-aria]')) e.setAttribute('aria-label', t(e.dataset.i18nAria));
}
