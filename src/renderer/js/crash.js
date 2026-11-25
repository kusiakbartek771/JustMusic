// Raporty o błędach: dziennik ostatnich błędów interfejsu, propozycja zgłoszenia po nieoczekiwanym
// błędzie i po awarii z poprzedniego uruchomienia. Zgłoszenie idzie przez zwykły formularz opinii.
import { S } from './state.js';
import { toast } from './ui.js';

const MAX = 30;
export const errorLog = []; // { at, kind, msg, stack }
let lastToast = 0;

// błędy bez znaczenia dla użytkownika – nie proponujemy zgłoszenia
const NOISE = /ResizeObserver loop|AbortError|The play\(\) request was interrupted|NotAllowedError|Failed to fetch|NetworkError|net::ERR_|Load failed|The user aborted/i;

function push(kind, msg, stack) {
  errorLog.push({ at: new Date().toISOString().slice(11, 19), kind, msg: String(msg || '').slice(0, 400), stack: String(stack || '').split('\n').slice(0, 6).join('\n') });
  if (errorLog.length > MAX) errorLog.shift();
}

/** dziennik błędów jako tekst do zgłoszenia */
export function errorLogText(limit = 10) {
  return errorLog.slice(-limit).map((e) => `[${e.at}] ${e.kind}: ${e.msg}${e.stack ? '\n' + e.stack.replace(/^/gm, '    ') : ''}`).join('\n');
}

export function reportProblem(title, details) {
  import('./feedback.js').then((m) => m.openFeedback('bug', { title, msg: details ? `\n\n---\n${details}` : '', attachLog: true }));
}

function offer(msg) {
  const now = Date.now();
  if (now - lastToast < 10 * 60e3) return; // nie zasypujemy powiadomieniami
  lastToast = now;
  toast('Coś poszło nie tak: ' + msg.slice(0, 90), { error: true, duration: 9000, action: { label: 'Zgłoś', onClick: () => reportProblem('Błąd: ' + msg.slice(0, 80)) } });
}

export function setupCrashReports() {
  addEventListener('error', (e) => {
    const msg = e.message || e.error?.message || 'Nieznany błąd';
    push('błąd', msg, e.error?.stack || `${e.filename || ''}:${e.lineno || ''}`);
    if (!NOISE.test(msg) && !/\/plugins\//.test(e.filename || '')) offer(msg);
  });
  addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    push('obietnica', r?.message || String(r), r?.stack);
  });
  // przechwytujemy też console.error – pluginy i moduły zgłaszają tak problemy
  const orig = console.error.bind(console);
  console.error = (...a) => {
    try { push('konsola', a.map((x) => (x instanceof Error ? x.message : typeof x === 'string' ? x : JSON.stringify(x))).join(' '), a.find((x) => x instanceof Error)?.stack); } catch {}
    orig(...a);
  };

  // awaria z poprzedniego uruchomienia (zapisana przez proces główny)
  const c = S.lastCrash;
  if (c) {
    const what = `${c.kind}: ${c.reason}${c.message ? ' – ' + c.message : ''}`;
    push('awaria', what, c.stack);
    setTimeout(() => toast('JustMusic poprzednio zamknął się przez błąd. Chcesz wysłać raport?', {
      error: true, duration: 15000,
      action: { label: 'Wyślij raport', onClick: () => reportProblem(`Awaria (${c.kind})`, `Awaria ${c.at} · wersja ${c.version}\n${what}${c.stack ? '\n' + c.stack : ''}`) },
    }), 2500);
  }
}
