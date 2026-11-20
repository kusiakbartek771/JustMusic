// Pomocnicze komponenty interfejsu: elementy DOM, menu, modale, toasty.
import { icon } from './icons.js';

export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className += ' ' + v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function iconBtn(name, title, onClick, cls = '') {
  return h('button.icon-btn' + (cls ? '.' + cls.split(' ').join('.') : ''), { title, 'aria-label': title, html: icon(name), on: { click: onClick } });
}

export function btn(label, { icon: ic, primary, cls = '', onClick, title } = {}) {
  return h('button.btn' + (primary ? '.primary' : '') + (cls ? '.' + cls.split(' ').join('.') : ''), {
    title, html: (ic ? icon(ic) : '') + `<span>${esc(label)}</span>`, on: { click: onClick },
  });
}

export function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const hh = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function fmtTotal(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} godz. ${m % 60} min`;
}

export function plural(n, one, few, many) {
  if (n === 1) return `${n} ${one}`;
  const d = n % 10, dd = n % 100;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}
export const songs = (n) => plural(n, 'utwór', 'utwory', 'utworów');

export function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  const u = ['KB', 'MB', 'GB'];
  let i = -1;
  do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
  return b.toFixed(b < 10 ? 1 : 0) + ' ' + u[i];
}

export function timeAgo(ts) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return 'przed chwilą';
  if (d < 3600) return `${Math.floor(d / 60)} min temu`;
  if (d < 86400) return `${Math.floor(d / 3600)} godz. temu`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)} dni temu`;
  return new Date(ts).toLocaleDateString('pl-PL');
}

// Okładka z leniwym ładowaniem i bezpiecznym fallbackiem
export function cover(src, cls = '', fallback = 'music') {
  const el = h('div.cover' + (cls ? '.' + cls.split(' ').join('.') : ''));
  if (src) {
    const img = new Image();
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    img.onerror = () => { img.remove(); el.innerHTML = icon(fallback); };
    img.src = src;
    el.append(img);
  } else {
    el.innerHTML = icon(fallback);
  }
  return el;
}

export function mosaic(thumbs, cls = '') {
  const list = [...new Set(thumbs.filter(Boolean))].slice(0, 4);
  if (list.length < 4) return cover(list[0], cls, 'listMusic');
  const el = h('div.cover.mosaic' + (cls ? '.' + cls.split(' ').join('.') : ''));
  for (const t of list) {
    const img = new Image();
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = t;
    img.onerror = () => (img.style.visibility = 'hidden');
    el.append(img);
  }
  return el;
}

export function rangeFill(input) {
  const min = Number(input.min || 0), max = Number(input.max || 100);
  input.style.setProperty('--p', ((Number(input.value) - min) / (max - min)) * 100 + '%');
}

// ---- toast ----
export function toast(msg, { error = false, action, duration = 3200 } = {}) {
  const root = document.getElementById('toasts');
  const el = h('div.toast' + (error ? '.error' : ''), null, h('span', { text: msg }));
  if (action) el.append(h('button', { text: action.label, on: { click: () => { action.onClick(); close(); } } }));
  root.append(el);
  while (root.children.length > 4) root.firstChild.remove();
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 220); };
  setTimeout(close, duration);
  return close;
}

// ---- menu kontekstowe ----
let openMenus = [];
export function closeMenus() {
  for (const m of openMenus) m.remove();
  openMenus = [];
}

function buildMenu(items, x, y, level = 0) {
  const menu = h('div.menu', { role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { menu.append(h('div.menu-sep')); continue; }
    if (it.title) { menu.append(h('div.menu-title', { text: it.title })); continue; }
    const el = h('div.menu-item' + (it.danger ? '.danger' : '') + (it.disabled ? '.disabled' : ''), {
      html: (it.icon ? icon(it.icon) : '') + `<span>${esc(it.label)}</span>` + (it.submenu ? icon('chevronRight', 'chev') : it.hint ? `<span class="hint">${esc(it.hint)}</span>` : ''),
    });
    if (it.submenu) {
      let sub = null;
      const openSub = () => {
        for (const m of openMenus.slice(level + 1)) m.remove();
        openMenus = openMenus.slice(0, level + 1);
        menu.querySelectorAll('.hl').forEach((n) => n.classList.remove('hl'));
        el.classList.add('hl');
        const r = el.getBoundingClientRect();
        const items2 = typeof it.submenu === 'function' ? it.submenu() : it.submenu;
        sub = buildMenu(items2, r.right + 2, r.top - 6, level + 1);
      };
      el.addEventListener('mouseenter', openSub);
      el.addEventListener('click', (e) => { e.stopPropagation(); openSub(); });
    } else {
      el.addEventListener('mouseenter', () => {
        for (const m of openMenus.slice(level + 1)) m.remove();
        openMenus = openMenus.slice(0, level + 1);
      });
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        closeMenus();
        it.onClick?.();
      });
    }
    menu.append(el);
  }
  document.getElementById('overlays').append(menu);
  openMenus.push(menu);
  const r = menu.getBoundingClientRect();
  const vw = innerWidth, vh = innerHeight;
  let left = x, top = y;
  if (left + r.width > vw - 8) {
    left = level ? (openMenus[level - 1]?.getBoundingClientRect().left ?? x) - r.width - 2 : vw - r.width - 8;
  }
  if (top + r.height > vh - 8) top = Math.max(8, vh - r.height - 8);
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top = Math.max(8, top) + 'px';
  return menu;
}

export function contextMenu(e, items) {
  e.preventDefault?.();
  e.stopPropagation?.();
  closeMenus();
  closePopover();
  const x = e.clientX ?? e.x, y = e.clientY ?? e.y;
  buildMenu(items, x, y, 0);
}

export function menuAt(anchor, items) {
  const r = anchor.getBoundingClientRect();
  contextMenu({ clientX: r.left, clientY: r.bottom + 6 }, items);
}

document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.menu')) closeMenus();
  if (currentPopover && !e.target.closest('.popover') && !currentPopover.anchor.contains(e.target)) closePopover();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeMenus(); closePopover(); }
});
window.addEventListener('blur', closeMenus);
window.addEventListener('resize', () => { closeMenus(); closePopover(); });

// ---- popover ----
let currentPopover = null;
export function closePopover() {
  if (currentPopover) {
    currentPopover.el.remove();
    currentPopover.onClose?.();
    currentPopover = null;
  }
}
export function popover(anchor, content, { onClose, align = 'center', place = 'auto' } = {}) {
  if (currentPopover?.anchor === anchor) { closePopover(); return null; }
  closePopover();
  const el = h('div.popover', null, content);
  document.getElementById('overlays').append(el);
  currentPopover = { el, anchor, onClose };
  const a = anchor.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  let left = align === 'right' ? a.right - r.width : a.left + a.width / 2 - r.width / 2;
  left = Math.min(Math.max(8, left), innerWidth - r.width - 8);
  let top = a.top - r.height - 10;
  if (place === 'below' || top < 8) top = a.bottom + 10;
  el.style.left = left + 'px';
  el.style.top = Math.min(top, innerHeight - r.height - 8) + 'px';
  return el;
}

// ---- modal ----
export function modal(content, { wide = false, onClose } = {}) {
  const box = h('div.modal' + (wide ? '.wide' : ''), { role: 'dialog' }, content);
  const bg = h('div.modal-bg', null, box);
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey, true); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  document.addEventListener('keydown', onKey, true);
  document.getElementById('overlays').append(bg);
  setTimeout(() => box.querySelector('input,textarea,select,button.primary')?.focus(), 30);
  return { close, box };
}

export function promptDialog({ title, text, value = '', placeholder = '', ok = 'Zapisz', multiline = false }) {
  return new Promise((resolve) => {
    let done = false;
    const input = multiline
      ? h('textarea.input', { rows: 4, placeholder })
      : h('input.input', { type: 'text', placeholder });
    input.value = value;
    const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !multiline) finish(input.value.trim());
    });
    const m = modal([
      h('h3', { text: title }),
      text ? h('p', { text }) : null,
      input,
      h('div.modal-actions', null,
        btn('Anuluj', { cls: 'ghost', onClick: () => finish(null) }),
        btn(ok, { primary: true, onClick: () => finish(input.value.trim()) })),
    ], { onClose: () => { if (!done) { done = true; resolve(null); } } });
    setTimeout(() => { input.focus(); input.select?.(); }, 40);
  });
}

export function confirmDialog({ title, text, ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    const okBtn = btn(ok, { primary: !danger, cls: danger ? 'danger' : '', onClick: () => finish(true) });
    const m = modal([
      h('h3', { text: title }),
      text ? h('p', { text }) : null,
      h('div.modal-actions', null, btn('Anuluj', { cls: 'ghost', onClick: () => finish(false) }), okBtn),
    ], { onClose: () => { if (!done) { done = true; resolve(false); } } });
    setTimeout(() => okBtn.focus(), 40);
  });
}

export function switchEl(checked, onChange) {
  const input = h('input', { type: 'checkbox' });
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label.switch', null, input, h('span'));
}

export function select(options, value, onChange, cls = '') {
  const s = h('select.input' + (cls ? '.' + cls : ''));
  for (const [v, label] of options) {
    const o = h('option', { value: v, text: label });
    if (String(v) === String(value)) o.selected = true;
    s.append(o);
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function throttle(fn, ms) {
  let last = 0, t;
  return (...a) => {
    const now = Date.now();
    clearTimeout(t);
    if (now - last >= ms) { last = now; fn(...a); }
    else t = setTimeout(() => { last = Date.now(); fn(...a); }, ms - (now - last));
  };
}

export function spinner() {
  return h('div.loading-spin');
}
