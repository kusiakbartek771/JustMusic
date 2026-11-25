// Menu feedbacku: zgłaszanie błędów, pomysłów i opinii.
// Adres e-mail / URL zgłoszeń ustawia autor aplikacji w package.json → "justmusic".
import { S } from './state.js';
import { h, esc, btn, modal, toast } from './ui.js';
import { icon } from './icons.js';
import { P } from './player.js';
import { errorLog, errorLogText } from './crash.js';

const TYPES = [
  ['bug', 'bug', 'Błąd', 'Coś nie działa tak, jak powinno'],
  ['idea', 'lightbulb', 'Pomysł', 'Nowa funkcja lub ulepszenie'],
  ['ui', 'palette', 'Wygląd', 'Uwagi do interfejsu'],
  ['other', 'message', 'Inne', 'Cokolwiek innego'],
];
const MOODS = ['😞', '😕', '😐', '🙂', '🤩'];

export function openFeedback(preset = 'bug', pre = {}) {
  let type = preset;
  let mood = -1;
  const typeRow = h('div.fb-types');
  const drawTypes = () => {
    typeRow.replaceChildren(...TYPES.map(([k, ic, label, hint]) => h('button.fb-type' + (k === type ? '.on' : ''), {
      html: `${icon(ic)}<b>${esc(label)}</b><small>${esc(hint)}</small>`,
      on: { click: () => { type = k; drawTypes(); updatePlaceholder(); } },
    })));
  };
  drawTypes();
  const moodRow = h('div.fb-moods');
  const drawMoods = () => moodRow.replaceChildren(h('span.muted', { text: 'Jak oceniasz JustMusic?' }), ...MOODS.map((m, i) => h('button.fb-mood' + (i === mood ? '.on' : ''), { text: m, title: `${i + 1}/5`, on: { click: () => { mood = i; drawMoods(); } } })));
  drawMoods();
  const title = h('input.input', { placeholder: 'Krótki tytuł', maxlength: 120, value: pre.title || '' });
  const msg = h('textarea.input', { rows: 6, style: { fontFamily: 'inherit', fontSize: '14px' } });
  if (pre.msg) msg.value = pre.msg;
  const updatePlaceholder = () => {
    msg.placeholder = type === 'bug'
      ? 'Co się stało? Co robiłeś/aś wcześniej? Czego się spodziewałeś/aś?\n\n1. …\n2. …'
      : type === 'idea' ? 'Opisz swój pomysł – co chcesz osiągnąć i dlaczego?' : 'Napisz, co myślisz…';
  };
  updatePlaceholder();
  const contact = h('input.input', { placeholder: 'Kontakt (opcjonalnie) – jeśli chcesz odpowiedzi' });
  const sysBox = h('input', { type: 'checkbox', checked: true });
  const hasLog = errorLog.length > 0;
  const logBox = h('input', { type: 'checkbox', checked: !!pre.attachLog || (hasLog && preset === 'bug') });
  const sysInfo = () => [
    `JustMusic ${S.version} (${S.packaged ? 'instalacja' : 'dev'})`,
    `System: ${S.sys.os || S.platform}${S.sys.desktop ? ` · ${S.sys.desktop}` : ''}${S.sys.session ? ` (${S.sys.session})` : ''}`,
    `Electron ${S.sys.electron || '?'} · Chromium ${S.sys.chrome || '?'}`,
    `yt-dlp: ${S.ytStatus?.version || 'brak'} · ffmpeg: ${S.ytStatus?.ffmpeg ? 'tak' : 'nie'}`,
    `Pluginy: ${Object.entries(S.settings.plugins.enabled).filter(([, v]) => v).map(([k]) => k).join(', ') || 'brak'}`,
    `Motyw: ${S.settings.theme.preset} · Układ: menu ${S.settings.layout.sidebar}, odtwarzacz ${S.settings.layout.player}`,
    P.current ? `Utwór: ${P.current.source} ${P.current.ytId || P.current.spotifyId || ''}` : null,
  ].filter(Boolean).join('\n');

  const report = () => {
    const t = TYPES.find((x) => x[0] === type)[2];
    return [
      `[${t}] ${title.value.trim() || '(bez tytułu)'}`,
      '',
      msg.value.trim(),
      '',
      mood >= 0 ? `Ocena: ${MOODS[mood]} (${mood + 1}/5)` : null,
      contact.value.trim() ? `Kontakt: ${contact.value.trim()}` : null,
      sysBox.checked ? `\n--- Informacje o systemie ---\n${sysInfo()}` : null,
      hasLog && logBox.checked ? `\n--- Ostatnie błędy ---\n${errorLogText()}` : null,
    ].filter((x) => x !== null).join('\n');
  };
  const valid = () => {
    if (!msg.value.trim() && !title.value.trim()) { toast('Napisz kilka słów 🙂', { error: true }); msg.focus(); return false; }
    return true;
  };

  const cfg = S.config || {};
  const actions = h('div.modal-actions', { style: { flexWrap: 'wrap' } });
  // Wysyłka bezpośrednio do autora – bez konta na GitHubie
  if (cfg.feedbackDirect) {
    const sendBtn = btn('Wyślij', { icon: 'message', primary: true, onClick: async () => {
      if (!valid()) return;
      sendBtn.disabled = true;
      const t = TYPES.find((x) => x[0] === type);
      try {
        await window.jm.feedback.send({
          kind: type,
          title: `[${t[2]}] ${title.value.trim() || '(bez tytułu)'}`,
          text: msg.value.trim(),
          fields: [
            mood >= 0 ? { name: 'Ocena', value: `${MOODS[mood]} ${mood + 1}/5`, inline: true } : null,
            contact.value.trim() ? { name: 'Kontakt', value: contact.value.trim(), inline: true } : null,
            sysBox.checked ? { name: 'System', value: sysInfo() } : null,
            hasLog && logBox.checked ? { name: 'Ostatnie błędy', value: errorLogText(6).slice(-1000) } : null,
          ].filter(Boolean),
        });
        toast('Dziękujemy! Opinia wysłana 💜');
        m.close();
      } catch (e) {
        sendBtn.disabled = false;
        toast(e.message, { error: true });
      }
    } });
    actions.append(sendBtn);
  }
  actions.append(
    btn('Kopiuj', { icon: 'copy', cls: 'ghost', onClick: () => { if (!valid()) return; navigator.clipboard.writeText(report()); toast('Skopiowano zgłoszenie'); } }),
    btn('Zapisz do pliku', { icon: 'file', cls: 'ghost', onClick: async () => {
      if (!valid()) return;
      const f = await window.jm.feedback.save(report());
      toast('Zapisano zgłoszenie', { action: { label: 'Pokaż', onClick: () => window.jm.shell.show(f) } });
    } }),
  );
  if (cfg.feedbackUrl) {
    actions.append(btn(cfg.feedbackDirect ? 'Na GitHubie' : 'Wyślij zgłoszenie', { icon: 'external', cls: cfg.feedbackDirect ? 'ghost' : '', primary: !cfg.feedbackEmail && !cfg.feedbackDirect, onClick: () => {
      if (!valid()) return;
      const u = new URL(cfg.feedbackUrl);
      u.searchParams.set('title', title.value.trim() || TYPES.find((x) => x[0] === type)[2]);
      u.searchParams.set('body', report());
      window.jm.shell.external(u.toString());
      m.close();
    } }));
  }
  if (cfg.feedbackEmail) {
    actions.append(btn('Wyślij e-mailem', { icon: 'message', primary: true, onClick: () => {
      if (!valid()) return;
      const t = TYPES.find((x) => x[0] === type)[2];
      const url = `mailto:${cfg.feedbackEmail}?subject=${encodeURIComponent(`[JustMusic] [${t}] ${title.value.trim()}`)}&body=${encodeURIComponent(report())}`;
      window.jm.shell.external(url).catch(() => (location.href = url));
      m.close();
    } }));
  }

  const preview = h('details.fb-sys', null, h('summary', { text: 'Pokaż dołączane informacje o systemie' }), h('pre.code', { text: sysInfo() }));
  const m = modal([
    h('h3', { html: `${icon('message')} Wyślij opinię` }),
    h('p', { text: 'Zgłoś błąd, podziel się pomysłem albo po prostu napisz, co myślisz. Każda opinia pomaga ulepszyć JustMusic.' }),
    typeRow,
    h('div.fb-form', null, title, msg, contact,
      h('label.fb-check', null, sysBox, h('span', { text: 'Dołącz informacje o systemie i wersji (bez danych osobowych)' })),
      preview,
      hasLog ? h('label.fb-check', null, logBox, h('span', { text: `Dołącz dziennik ostatnich błędów (${errorLog.length})` })) : null,
      hasLog ? h('details.fb-sys', null, h('summary', { text: 'Pokaż dziennik błędów' }), h('pre.code', { text: errorLogText(), style: { maxHeight: '160px', overflow: 'auto' } })) : null,
      moodRow),
    cfg.feedbackDirect ? h('p.muted', { style: { fontSize: '12px', margin: '10px 0 0' }, text: 'Opinia trafi prosto do autora – nie potrzebujesz żadnego konta.' }) : null,
    !cfg.feedbackUrl && !cfg.feedbackEmail && !cfg.feedbackDirect ? h('p.muted', { style: { fontSize: '12px', margin: '10px 0 0' }, text: 'Skopiuj zgłoszenie lub zapisz je do pliku i wyślij autorowi aplikacji.' }) : null,
    actions,
  ], { wide: true });
  setTimeout(() => title.focus(), 50);
}
