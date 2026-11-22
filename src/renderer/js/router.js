// Prosty router widoków z historią (wstecz / dalej).
import { emit } from './state.js';

const views = new Map();
const back = [];
const fwd = [];
export const route = { name: 'home', param: null };
let current = null; // { name, param, cleanup }
let scrollPos = new Map();

export function registerView(name, render) {
  views.set(name, render);
}

export function hasView(name) {
  return views.has(name);
}

function key(r) {
  return r.name + ':' + JSON.stringify(r.param ?? null);
}

// animacja wejścia widoku – tylko przy przejściu do innego widoku (nie przy odświeżeniu)
let animTimer = null;
function animateEnter(view, dir = 'fwd') {
  view.classList.remove('view-enter', 'view-back');
  void view.offsetWidth; // restart animacji
  view.classList.add('view-enter');
  if (dir === 'back') view.classList.add('view-back');
  clearTimeout(animTimer);
  animTimer = setTimeout(() => view.classList.remove('view-enter', 'view-back'), 900);
}

function render(r, anim = null) {
  const view = document.getElementById('view');
  if (current?.cleanup) {
    try { current.cleanup(); } catch (e) { console.error(e); }
  }
  scrollPos.set(key(route), view.scrollTop);
  route.name = r.name;
  route.param = r.param ?? null;
  view.replaceChildren();
  view.scrollTop = 0;
  const fn = views.get(r.name) || views.get('home');
  let cleanup = null;
  try {
    cleanup = fn(view, r.param ?? null) || null;
  } catch (e) {
    console.error('[view]', r.name, e);
    view.textContent = 'Błąd widoku: ' + e.message;
  }
  current = { ...r, cleanup };
  if (anim) animateEnter(view, anim);
  emit('route', route);
}

export function navigate(name, param = null, { replace = false } = {}) {
  const r = { name, param };
  if (!replace && current && key(current) === key(r)) return refresh();
  if (current && !replace) back.push({ name: current.name, param: current.param });
  if (back.length > 50) back.shift();
  fwd.length = 0;
  render(r, 'fwd');
}

export function refresh() {
  if (!current) return;
  const view = document.getElementById('view');
  const top = view.scrollTop;
  render({ name: current.name, param: current.param });
  view.scrollTop = top;
}

export function goBack() {
  const r = back.pop();
  if (!r) return;
  fwd.push({ name: current.name, param: current.param });
  render(r, 'back');
  const s = scrollPos.get(key(r));
  if (s) requestAnimationFrame(() => (document.getElementById('view').scrollTop = s));
}

export function goForward() {
  const r = fwd.pop();
  if (!r) return;
  back.push({ name: current.name, param: current.param });
  render(r, 'fwd');
}

export const canBack = () => back.length > 0;
export const canForward = () => fwd.length > 0;
