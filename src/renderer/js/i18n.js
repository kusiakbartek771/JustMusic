// Języki interfejsu. Kod aplikacji i pluginów pisze po polsku, a ten moduł podmienia teksty
// w dokumencie (węzły tekstowe oraz atrybuty title/placeholder/aria-label) według słownika
// i18n/<język>.json. Dzięki temu tłumaczą się też pluginy, bez zmian w ich kodzie.
// Klucze słownika to polskie teksty; „{0}”, „{1}”… to wstawiane wartości (np. liczby, nazwy).

export const LANGS = {
  pl: { name: 'Polski', icon: '🥟', hint: 'pierogi' },
  en: { name: 'English', icon: '🫖', hint: 'tea' },
  uk: { name: 'Українська', icon: '🌻', hint: 'соняшник' },
  de: { name: 'Deutsch', icon: '🥨', hint: 'Brezel' },
};

let lang = 'pl';
let exact = new Map();
let patterns = []; // { re, out, lit }
let prefixes = []; // [polski prefiks zakończony „:”, tłumaczenie]
const cache = new Map();
const ATTRS = ['title', 'placeholder', 'aria-label'];
const LETTER = /[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]/;

export const currentLang = () => lang;

/** język z ustawień albo – przy pierwszym uruchomieniu – z systemu */
export function pickLang(saved, onboarded) {
  if (saved && LANGS[saved]) return saved;
  if (onboarded) return 'pl';
  const sys = (navigator.language || 'pl').slice(0, 2).toLowerCase();
  return LANGS[sys] ? sys : 'pl';
}

const escRe = (s) => s.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');

function compile(dict) {
  exact = new Map();
  patterns = [];
  prefixes = [];
  cache.clear();
  for (const [k, v] of Object.entries(dict)) {
    if (!v) continue;
    if (/\{\d+\}/.test(k)) {
      const order = [];
      const src = k.split(/(\{\d+\})/).map((part) => {
        const m = /^\{(\d+)\}$/.exec(part);
        if (m) { order.push(m[1]); return '([\\s\\S]*?)'; }
        return escRe(part);
      }).join('');
      const lits = k.split(/\{\d+\}/).filter(Boolean).sort((a, b) => b.length - a.length);
      patterns.push({ re: new RegExp('^' + src + '$'), out: v, order, lit: lits[0] || '' });
    } else {
      exact.set(k, v);
      if (/:\s*$/.test(k) && k.length > 3) prefixes.push([k.trim(), v.trim()]);
    }
  }
  patterns.sort((a, b) => b.lit.length - a.lit.length);
  prefixes.sort((a, b) => b[0].length - a[0].length);
}

/** Tłumaczy pojedynczy tekst (bez białych znaków na brzegach). Zwraca null, gdy brak tłumaczenia. */
function lookup(s, depth = 0) {
  if (cache.has(s)) return cache.get(s);
  let r = exact.get(s) ?? null;
  if (r === null && depth < 3) {
    for (const p of patterns) {
      if (p.lit && !s.includes(p.lit)) continue;
      const m = p.re.exec(s);
      if (!m) continue;
      const vals = {};
      p.order.forEach((n, i) => { const v = m[i + 1]; vals[n] = lookup(v.trim(), depth + 1) ?? v; });
      r = p.out.replace(/\{(\d+)\}/g, (_, n) => vals[n] ?? '');
      break;
    }
    if (r === null) {
      for (const [k, v] of prefixes) {
        if (s.startsWith(k) && s.length > k.length) { r = v + s.slice(k.length); break; }
      }
    }
    // teksty sklejone z kilku części: „12 utworów · 1 godz. 5 min”
    if (r === null && s.includes(' · ')) {
      let changed = false;
      const parts = s.split(' · ').map((p) => {
        const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(p);
        const x = m[2] ? lookup(m[2], depth + 1) : null;
        if (x === null) return p;
        changed = true;
        return m[1] + x + m[3];
      });
      if (changed) r = parts.join(' · ');
    }
  }
  if (cache.size > 20000) cache.clear();
  cache.set(s, r);
  return r;
}

/** Tłumaczenie tekstu w kodzie (np. menu natywne, komunikaty) */
export function t(s) {
  if (lang === 'pl' || !s) return s;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(String(s));
  const r = lookup(m[2]);
  return r === null ? s : m[1] + r + m[3];
}

// ---- tłumaczenie dokumentu ----
const done = new WeakMap(); // węzeł tekstowy -> przetłumaczony tekst
function textNode(n) {
  const d = n.data;
  if (done.get(n) === d || !LETTER.test(d)) return;
  const p = n.parentNode;
  if (!p || p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE' || p.nodeName === 'TEXTAREA' || p.closest?.('[data-noi18n],[contenteditable]')) return;
  const out = t(d);
  done.set(n, out);
  if (out !== d) n.data = out;
}
const attrDone = new WeakMap(); // element -> { attr: wartość po tłumaczeniu }
function attrs(el) {
  if (el.closest?.('[data-noi18n]')) return;
  let rec = attrDone.get(el);
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v || !LETTER.test(v) || rec?.[a] === v) continue;
    const out = t(v);
    if (!rec) { rec = {}; attrDone.set(el, rec); }
    rec[a] = out;
    if (out !== v) el.setAttribute(a, out);
  }
}
function walk(root) {
  if (root.nodeType === 3) return textNode(root);
  if (root.nodeType !== 1 && root.nodeType !== 11) return;
  if (root.nodeType === 1) attrs(root);
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n;
  while ((n = tw.nextNode())) {
    if (n.nodeType === 3) textNode(n);
    else if (n.hasAttribute('title') || n.hasAttribute('placeholder') || n.hasAttribute('aria-label')) attrs(n);
  }
}

let observer = null;
function observe() {
  observer?.disconnect();
  observer = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(walk);
      else if (m.type === 'characterData') textNode(m.target);
      else if (m.type === 'attributes') attrs(m.target);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  walk(document.documentElement);
  // tytuł okna
  const ti = document.querySelector('title');
  if (ti) walk(ti);
}

/** Wczytuje słownik i zaczyna tłumaczyć dokument. Dla polskiego nic nie robi. */
export async function setupI18n(code) {
  lang = LANGS[code] ? code : 'pl';
  document.documentElement.lang = lang;
  if (lang === 'pl') return;
  try {
    const base = new URL('../i18n/', import.meta.url);
    const r = await fetch(new URL(`${lang}.json`, base));
    compile(await r.json());
    observe();
  } catch (e) {
    console.error('[i18n]', e);
    lang = 'pl';
  }
}
