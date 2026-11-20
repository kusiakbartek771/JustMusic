// Plugin: teksty piosenek (LRCLIB – darmowe API, bez kluczy).
export default function activate(api) {
  const { h, esc } = api;
  const cache = new Map();

  function parseLrc(lrc) {
    const out = [];
    for (const line of lrc.split(/\r?\n/)) {
      const tags = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
      if (!tags.length) continue;
      const text = line.replace(/\[[^\]]*\]/g, '').trim();
      for (const t of tags) out.push({ t: Number(t[1]) * 60 + Number(t[2]), text });
    }
    return out.sort((a, b) => a.t - b.t);
  }

  async function fetchLyrics(track) {
    const key = track.id;
    if (cache.has(key)) return cache.get(key);
    const artist = (track.artist || '').split(',')[0].trim();
    const title = (track.title || '').replace(/\s*[([].*?[)\]]\s*/g, ' ').trim();
    let res = null;
    try {
      const q = new URLSearchParams({ artist_name: artist, track_name: title });
      if (track.duration) q.set('duration', String(Math.round(track.duration)));
      res = await api.http.json(`https://lrclib.net/api/get?${q}`);
    } catch {}
    if (!res || (!res.syncedLyrics && !res.plainLyrics)) {
      try {
        const list = await api.http.json(`https://lrclib.net/api/search?q=${encodeURIComponent(`${artist} ${title}`)}`);
        res = (list || []).find((x) => x.syncedLyrics) || (list || [])[0] || null;
      } catch {}
    }
    const out = res ? { synced: res.syncedLyrics ? parseLrc(res.syncedLyrics) : null, plain: res.plainLyrics || null, instrumental: res.instrumental } : null;
    cache.set(key, out);
    if (cache.size > 100) cache.delete(cache.keys().next().value);
    return out;
  }

  api.ui.addView({
    id: 'view',
    title: 'Tekst',
    icon: 'mic',
    render(el) {
      const root = h('div.lyrics-view');
      el.append(root);
      let lines = [];
      let lineEls = [];
      let active = -1;
      let token = 0;
      const scroller = document.getElementById('view');

      const draw = async () => {
        const t = api.player.current;
        const my = ++token;
        lines = [];
        lineEls = [];
        active = -1;
        root.replaceChildren();
        if (!t) {
          root.append(h('div.empty', { html: `${api.icon('mic')}<h3>Nic nie gra</h3><p>Włącz utwór, aby zobaczyć tekst.</p>` }));
          return;
        }
        const head = h('div.ly-head');
        const c = h('div.cover');
        if (t.thumb) c.append(Object.assign(new Image(), { src: t.thumb }));
        head.append(c, h('div', { html: `<h2>${esc(t.title)}</h2><div class="muted">${esc(t.artist || '')}</div>` }));
        root.append(head, h('div.spinner-row', null, h('div.loading-spin'), 'Szukam tekstu…'));
        const ly = await fetchLyrics(t);
        if (my !== token) return;
        root.lastChild.remove();
        if (!ly || (!ly.synced?.length && !ly.plain)) {
          root.append(h('div.empty', { html: `${api.icon('mic')}<h3>${ly?.instrumental ? 'Utwór instrumentalny' : 'Nie znaleziono tekstu'}</h3><p>Baza LRCLIB nie ma tego utworu.</p>` }));
          return;
        }
        if (ly.synced?.length) {
          lines = ly.synced;
          for (const [i, l] of lines.entries()) {
            const e = h('div.ly-line' + (l.text ? '' : '.gap'), { text: l.text || '♪' });
            e.addEventListener('click', () => api.player.seek(l.t));
            lineEls[i] = e;
            root.append(e);
          }
          sync();
        } else {
          root.append(h('div.ly-plain', { text: ly.plain }));
        }
        root.append(h('div.ly-src', { text: 'Źródło: LRCLIB.net' }));
      };

      const sync = () => {
        if (!lines.length) return;
        const time = api.player.time + 0.25;
        let i = lines.findIndex((l) => l.t > time) - 1;
        if (i === -2) i = lines.length - 1;
        if (i === active) return;
        lineEls[active]?.classList.remove('active');
        active = i;
        lineEls.forEach((e, k) => e.classList.toggle('past', k < i));
        const e = lineEls[i];
        if (e) {
          e.classList.add('active');
          const top = e.offsetTop - scroller.clientHeight * 0.38;
          scroller.scrollTo({ top, behavior: 'smooth' });
        }
      };

      const offs = [api.player.on('track', draw), api.player.on('time', sync)];
      draw();
      return () => offs.forEach((f) => f());
    },
  });

  api.ui.addPlayerButton({ id: 'btn', icon: 'mic', title: 'Tekst piosenki', onClick: () => api.ui.openView('view') });
}
