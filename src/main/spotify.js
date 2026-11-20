// Import metadanych ze Spotify (utwory, albumy, playlisty, wykonawcy).
// Audio NIE jest pobierane ze Spotify – utwory są dopasowywane do YouTube.
// Tryb 1: oficjalne Web API (własne, darmowe Client ID/Secret – opcjonalnie).
// Tryb 2: bez kluczy – publiczna strona "embed" (do ~50 utworów).
const { net } = require('electron');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

function parse(input) {
  const s = (input || '').trim();
  let m = s.match(/^spotify:(track|album|playlist|artist):([A-Za-z0-9]+)/);
  if (m) return { type: m[1], id: m[2] };
  m = s.match(/open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|album|playlist|artist)\/([A-Za-z0-9]+)/);
  if (m) return { type: m[1], id: m[2] };
  return null;
}

let token = null;
async function getToken(creds) {
  if (token && token.expires > Date.now() && token.key === creds.clientId) return token.value;
  const res = await net.fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error('Spotify: nieprawidłowe Client ID / Secret');
  const j = await res.json();
  token = { value: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000, key: creds.clientId };
  return token.value;
}

async function api(path, tok) {
  const res = await net.fetch(path.startsWith('http') ? path : `https://api.spotify.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${tok}` },
  });
  if (!res.ok) throw new Error(`Spotify API HTTP ${res.status}`);
  return res.json();
}

function mapApiTrack(t, album) {
  if (!t || !t.id) return null;
  const al = t.album || album || {};
  return {
    id: 'sp:' + t.id,
    source: 'spotify',
    spotifyId: t.id,
    title: t.name,
    artist: (t.artists || []).map((a) => a.name).join(', '),
    album: al.name || '',
    duration: Math.round((t.duration_ms || 0) / 1000),
    thumb: pickImage(al.images),
  };
}

function pickImage(images) {
  if (!images || !images.length) return null;
  const sorted = [...images].sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find((i) => (i.width || 0) >= 200) || sorted[sorted.length - 1]).url;
}

async function paged(url, tok, pick) {
  const out = [];
  let next = url;
  let guard = 0;
  while (next && guard++ < 100) {
    const j = await api(next, tok);
    for (const it of j.items || []) {
      const t = pick(it);
      if (t) out.push(t);
    }
    next = j.next;
  }
  return out;
}

async function viaApi(ref, creds) {
  const tok = await getToken(creds);
  switch (ref.type) {
    case 'track': {
      const t = await api(`tracks/${ref.id}`, tok);
      const tr = mapApiTrack(t);
      return { kind: 'track', name: tr.title, author: tr.artist, cover: tr.thumb, tracks: [tr] };
    }
    case 'album': {
      const a = await api(`albums/${ref.id}`, tok);
      const tracks = await paged(`albums/${ref.id}/tracks?limit=50`, tok, (t) => mapApiTrack(t, a));
      return { kind: 'album', name: a.name, author: (a.artists || []).map((x) => x.name).join(', '), cover: pickImage(a.images), tracks };
    }
    case 'playlist': {
      const p = await api(`playlists/${ref.id}?fields=name,owner(display_name),images`, tok);
      let tracks;
      try {
        tracks = await paged(`playlists/${ref.id}/tracks?limit=100`, tok, (it) => mapApiTrack(it.track || it.item));
      } catch {
        tracks = await paged(`playlists/${ref.id}/items?limit=100`, tok, (it) => mapApiTrack(it.item || it.track));
      }
      return { kind: 'playlist', name: p.name, author: p.owner?.display_name || '', cover: pickImage(p.images), tracks };
    }
    case 'artist': {
      const a = await api(`artists/${ref.id}`, tok);
      const top = await api(`artists/${ref.id}/top-tracks?market=US`, tok);
      return { kind: 'artist', name: a.name, author: 'Najpopularniejsze utwory', cover: pickImage(a.images), tracks: (top.tracks || []).map((t) => mapApiTrack(t)).filter(Boolean) };
    }
  }
  throw new Error('Nieobsługiwany typ linku');
}

function findKey(obj, key, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 12) return undefined;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const r = findKey(v, key, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

function embedImage(entity) {
  const srcs = entity?.coverArt?.sources || entity?.visualIdentity?.image || entity?.images || [];
  if (!srcs.length) return null;
  const sorted = [...srcs].sort((a, b) => (a.maxWidth || a.width || 0) - (b.maxWidth || b.width || 0));
  return (sorted.find((i) => (i.maxWidth || i.width || 0) >= 200) || sorted[sorted.length - 1]).url;
}

async function viaEmbed(ref) {
  const res = await net.fetch(`https://open.spotify.com/embed/${ref.type}/${ref.id}`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
  });
  if (!res.ok) throw new Error(`Spotify: HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Spotify: nie udało się odczytać danych strony');
  const data = JSON.parse(m[1]);
  const entity = data?.props?.pageProps?.state?.data?.entity || findKey(data, 'entity');
  if (!entity) throw new Error('Spotify: brak danych (prywatna playlista?)');
  const cover = embedImage(entity);
  const name = entity.name || entity.title || 'Spotify';
  const author = entity.subtitle || (entity.artists || []).map((a) => a.name).join(', ') || '';

  if (ref.type === 'track') {
    const id = (entity.uri || '').split(':').pop() || ref.id;
    return {
      kind: 'track', name, author, cover,
      tracks: [{ id: 'sp:' + id, source: 'spotify', spotifyId: id, title: name, artist: author, album: '', duration: Math.round((entity.duration || 0) / 1000), thumb: cover }],
    };
  }
  const list = entity.trackList || findKey(entity, 'trackList') || [];
  const tracks = list
    .map((t) => {
      const id = (t.uri || '').split(':').pop();
      if (!id) return null;
      return {
        id: 'sp:' + id,
        source: 'spotify',
        spotifyId: id,
        title: t.title || t.name || '',
        artist: t.subtitle || (t.artists || []).map((a) => a.name).join(', ') || '',
        album: ref.type === 'album' ? name : '',
        duration: Math.round((t.duration || 0) / 1000),
        thumb: ref.type === 'album' ? cover : t.coverArt?.sources?.[0]?.url || cover,
      };
    })
    .filter(Boolean);
  return { kind: ref.type, name, author, cover, tracks, limited: tracks.length >= 50 };
}

async function fetchSpotify(url, creds = {}) {
  const ref = parse(url);
  if (!ref) throw new Error('To nie wygląda na link Spotify');
  if (creds.clientId && creds.clientSecret) {
    try {
      return await viaApi(ref, creds);
    } catch (e) {
      console.warn('[spotify] API failed, using embed', e.message);
    }
  }
  return viaEmbed(ref);
}

module.exports = { parse, fetchSpotify };
