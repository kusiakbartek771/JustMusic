// Nakładka „teraz gra” – działa w OBS / Streamlabs / TikTok LIVE Studio (źródło przeglądarki,
// dane przez /onair/events) albo w oknie JustMusic do przechwycenia (most window.jmw).
(function () {
  var q = new URLSearchParams(location.search);
  var inWindow = !!window.jmw;
  var root = document.getElementById('o');
  var $ = function (s) { return root.querySelector(s); };
  var el = { img: $('.art img'), title: $('.title span'), titleBox: $('.title'), artist: $('.artist'), req: $('.req'), fill: $('.bar i'), lbl: $('.lbl-t') };
  var st = { track: null, playing: false, time: 0, duration: 0, at: Date.now(), cfg: {} };
  var lastKey = '';
  var lastThumb = null;
  root.classList.add('noimg');

  if (q.get('bg')) document.body.style.background = '#' + q.get('bg').replace(/[^0-9a-f]/gi, '').slice(0, 8);
  if (inWindow) document.body.classList.add('win');

  function css(k, v) { document.documentElement.style.setProperty(k, v); }

  function applyCfg(c) {
    c = c || {};
    css('--accent', c.accent || '#a78bfa');
    css('--bg', c.bg || '#0d0f14');
    css('--fg', c.text || '#ffffff');
    css('--bga', (c.opacity == null ? 80 : c.opacity) + '%');
    css('--radius', (c.radius == null ? 18 : c.radius) + 'px');
    css('--scale', String((c.scale || 100) / 100));
    css('--font', c.font || '"Segoe UI", Inter, system-ui, sans-serif');
    root.className = ['o', 'l-' + (c.layout || 'card'), 'a-' + (c.align || 'left'), 'anim-' + (c.anim || 'slide'),
      c.showArt === false ? 'no-art' : '', c.showProgress === false ? 'no-bar' : '', c.showLabel === false ? 'no-lbl' : '',
      c.shadow === false ? '' : 'shadow', root.classList.contains('hidden') ? 'hidden' : '', root.classList.contains('playing') ? 'playing' : '', root.classList.contains('noimg') ? 'noimg' : ''].filter(Boolean).join(' ');
    el.lbl.textContent = c.label || 'Teraz gra';
    // okno do przechwycenia: jednolite tło (np. zielone do kluczowania) albo przezroczyste
    if (inWindow) document.body.style.background = c.windowBg || 'transparent';
  }

  function visible() {
    var c = st.cfg || {};
    if (!st.track) return false;
    if (c.hidePaused && !st.playing) return false;
    return true;
  }

  function render() {
    var t = st.track;
    applyCfg(st.cfg);
    var key = t ? t.title + '|' + t.artist : '';
    if (key !== lastKey) {
      lastKey = key;
      // zmiana utworu: chowamy, podmieniamy treść, pokazujemy z animacją
      root.classList.add('hidden');
      setTimeout(function () {
        el.title.textContent = t ? t.title : '';
        el.artist.textContent = t ? t.artist || '' : '';
        if (t && t.thumb !== lastThumb) {
          lastThumb = t.thumb;
          root.classList.toggle('noimg', !t.thumb);
          if (t.thumb) el.img.src = t.thumb; else el.img.removeAttribute('src');
        }
        marquee();
        root.classList.toggle('hidden', !visible());
      }, root.classList.contains('hidden') ? 0 : 450);
    } else {
      root.classList.toggle('hidden', !visible());
    }
    var showReq = st.req && (st.cfg || {}).showReq !== false;
    el.req.textContent = showReq ? 'Prośba od: ' + st.req : '';
    el.req.style.display = showReq ? '' : 'none';
    root.classList.toggle('playing', !!st.playing);
    tick();
  }

  function marquee() {
    var box = el.titleBox, span = el.title;
    box.classList.remove('scroll');
    var over = span.scrollWidth - box.clientWidth;
    if (over > 4) {
      span.style.setProperty('--d', (-over - 16) + 'px');
      span.style.setProperty('--dur', Math.max(6, over / 25 + 5) + 's');
      box.classList.add('scroll');
    }
  }

  function tick() {
    var p = st.playing ? st.time + (Date.now() - st.at) / 1000 : st.time;
    el.fill.style.width = st.duration ? Math.min(100, (p / st.duration) * 100) + '%' : '0%';
  }
  setInterval(tick, 500);

  el.img.addEventListener('error', function () { root.classList.add('noimg'); });

  function onData(d) {
    if (!d || typeof d !== 'object') return;
    st = Object.assign({}, st, d, { at: Date.now() });
    render();
  }

  if (inWindow) {
    window.jmw.onMessage(onData);
    window.jmw.post({ cmd: 'ready' });
    new ResizeObserver(function () {
      var r = document.body.getBoundingClientRect();
      window.jmw.resize(Math.ceil(r.width), Math.ceil(r.height));
    }).observe(document.body);
  } else {
    var es;
    var connect = function () {
      es = new EventSource('events');
      es.onmessage = function (e) { try { onData(JSON.parse(e.data)); } catch (_) {} };
      es.onerror = function () { /* EventSource sam ponawia; gdy JustMusic jest zamknięty – nakładka znika */ root.classList.add('hidden'); };
    };
    connect();
  }
  applyCfg({});
})();
