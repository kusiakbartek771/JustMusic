// Krótka ankieta pokazywana po pewnym czasie korzystania z aplikacji.
// Można ją wypełnić, pominąć (przypomni się raz po tygodniu) albo wyłączyć na zawsze.
import { S, saveData } from './state.js';
import { h, esc, btn, modal, toast } from './ui.js';
import { icon } from './icons.js';
import { P } from './player.js';

const SURVEY_ID = 'v1';
const MIN_MINUTES = 90;      // łączny czas korzystania przed pierwszym pytaniem
const MIN_LAUNCHES = 3;      // liczba uruchomień
const REMIND_AFTER = 7 * 86400e3;

const FEATURES = ['Wyszukiwanie YouTube', 'Pobieranie', 'Playlisty', 'Import ze Spotify', 'Pliki lokalne', 'Motywy i wygląd', 'Pluginy', 'Discord', 'Zakładki', 'Brak reklam'];

function st() {
  S.data.survey ||= { launches: 0, minutes: 0, state: 'pending', skippedAt: 0, skips: 0 };
  return S.data.survey;
}

export function setupSurvey() {
  const s = st();
  s.launches++;
  saveData();
  // licz minuty aktywnego korzystania (okno widoczne lub muzyka gra)
  setInterval(() => {
    if (document.hidden && !P.playing) return;
    s.minutes++;
    if (s.minutes % 5 === 0) saveData();
    maybeShow();
  }, 60e3);
}

function due() {
  const s = st();
  if (!S.config?.feedbackDirect) return false;          // ankieta wymaga skonfigurowanej wysyłki
  if (s.state === 'done' || s.state === 'never' || s.id === SURVEY_ID && s.state !== 'pending') return false;
  if (s.minutes < MIN_MINUTES || s.launches < MIN_LAUNCHES) return false;
  if (s.skippedAt && Date.now() - s.skippedAt < REMIND_AFTER) return false;
  if (document.querySelector('.modal-bg')) return false;  // nie przeszkadzaj w innym oknie
  return true;
}

let shown = false;
function maybeShow() {
  if (shown || !due()) return;
  shown = true;
  openSurvey(true);
}

export function openSurvey(auto = false) {
  const s = st();
  let stars = 0;
  let nps = -1;
  const liked = new Set();

  const starRow = h('div.sv-stars');
  const drawStars = () => starRow.replaceChildren(...[1, 2, 3, 4, 5].map((n) => h('button.sv-star' + (n <= stars ? '.on' : ''), { text: '★', title: `${n}/5`, on: { click: () => { stars = n; drawStars(); } } })));
  drawStars();

  const chips = h('div.chips');
  for (const f of FEATURES) {
    const c = h('button.chip', { text: f, on: { click: () => { liked.has(f) ? liked.delete(f) : liked.add(f); c.classList.toggle('on', liked.has(f)); } } });
    chips.append(c);
  }

  const npsRow = h('div.sv-nps');
  const drawNps = () => npsRow.replaceChildren(...Array.from({ length: 11 }, (_, n) => h('button.sv-n' + (n === nps ? '.on' : ''), { text: String(n), on: { click: () => { nps = n; drawNps(); } } })));
  drawNps();

  const missing = h('textarea.input', { rows: 3, placeholder: 'Czego brakuje Ci w JustMusic? Co możemy poprawić?', style: { fontFamily: 'inherit', fontSize: '14px' } });

  const close = (newState) => {
    if (newState === 'skip') {
      s.skips = (s.skips || 0) + 1;
      s.skippedAt = Date.now();
      s.state = s.skips >= 2 ? 'never' : 'pending'; // przypomnij najwyżej raz
    } else s.state = newState;
    s.id = SURVEY_ID;
    saveData();
    m.close();
  };

  const sendBtn = btn('Wyślij', { primary: true, icon: 'message', onClick: async () => {
    if (!stars && nps < 0 && !liked.size && !missing.value.trim()) return toast('Odpowiedz chociaż na jedno pytanie 🙂', { error: true });
    sendBtn.disabled = true;
    try {
      await window.jm.feedback.send({
        kind: 'survey',
        title: `Ankieta ${SURVEY_ID}${stars ? ' · ' + '★'.repeat(stars) + '☆'.repeat(5 - stars) : ''}`,
        text: missing.value.trim() || '(brak uwag)',
        fields: [
          { name: 'Ocena', value: stars ? `${stars}/5` : '—', inline: true },
          { name: 'Polecenie (0–10)', value: nps >= 0 ? String(nps) : '—', inline: true },
          { name: 'Czas korzystania', value: `${Math.round(s.minutes / 6) / 10} h · ${s.launches} uruchomień`, inline: true },
          { name: 'Najbardziej lubi', value: liked.size ? [...liked].join(', ') : '—' },
          { name: 'System', value: `${S.sys?.os || S.platform} · JustMusic ${S.version}` },
        ],
      });
      toast('Dziękujemy za wypełnienie ankiety! 💜');
      close('done');
    } catch (e) {
      sendBtn.disabled = false;
      toast(e.message, { error: true });
    }
  } });

  const m = modal([
    h('div.sv-head', { html: `<div class="sv-ic">${icon('sparkles')}</div><div><h3>Jak Ci się podoba JustMusic?</h3><p>${auto ? 'Korzystasz z JustMusic już od jakiegoś czasu. ' : ''}Ankieta zajmie 30 sekund i pomoże zdecydować, co ulepszyć. Jest anonimowa.</p></div>` }),
    h('div.sv-q', null, h('b', { text: 'Twoja ocena aplikacji' }), starRow),
    h('div.sv-q', null, h('b', { text: 'Co lubisz najbardziej? (możesz wybrać kilka)' }), chips),
    h('div.sv-q', null, h('b', { text: 'Jak bardzo poleciłbyś JustMusic znajomemu?' }), npsRow, h('div.sv-scale', { html: '<span>wcale</span><span>na pewno</span>' })),
    h('div.sv-q', null, h('b', { text: 'Czego brakuje?' }), missing),
    h('div.modal-actions', null,
      auto ? h('button.link.sv-never', { text: 'Nie pytaj więcej', on: { click: () => close('never') } }) : null,
      h('div', { style: { flex: '1' } }),
      btn('Pomiń', { cls: 'ghost', onClick: () => close(auto ? 'skip' : s.state) }),
      sendBtn),
  ], { wide: true, onClose: () => { if (s.state === 'pending' && auto && !s.skippedAt) { s.skippedAt = Date.now(); saveData(); } } });
}
