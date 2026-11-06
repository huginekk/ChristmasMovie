const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 7000;

// === KLÍČE ===
const TMDB_KEY = 'bcd898f31f5a923f94ccedb7d9c2b1a7';
const RD_TOKEN = 'O4J2OEAEIRF6IVVLJHXVUFMCKIGBDGHHOYW6INH5HIKUVWUXBZZQ';
const DEFAULT_POSTER = 'https://images.unsplash.com/photo-1543589077-47d51996477a?q=80&w=500';

app.use(cors());

// Vyhledání streamů přes Torrentio s upřednostněním českého dabingu
async function getXmasStreams(imdbId) {
  const streams = [];
  try {
    const torrentioUrl = `https://torrentio.strem.fun/stream/movie/${imdbId}.json`;
    const res = await axios.get(torrentioUrl, { timeout: 8000 });

    if (res.data && res.data.streams) {
      for (const s of res.data.streams) {
        const titleUpper = (s.title || '').toUpperCase();
        const isCzech = titleUpper.includes('CZ') || titleUpper.includes('CZECH') || titleUpper.includes('DABING') || titleUpper.includes('CS') || titleUpper.includes('MULTI');
        
        let streamTitle = isCzech ? `🇨🇿 CZ Dabing [${s.title.split('\n')[0]}]` : `🎬 ${s.title.split('\n')[0]}`;
        let streamUrl = s.url;

        if (s.infoHash && RD_TOKEN) {
          streamUrl = `https://torrentio.strem.fun/realdebrid/${RD_TOKEN}/${s.infoHash}/${s.fileIdx || 0}`;
        }

        if (streamUrl) {
          const streamObj = { title: streamTitle, url: streamUrl };
          if (isCzech) streams.unshift(streamObj);
          else streams.push(streamObj);
        }
      }
    }
  } catch (err) {
    console.warn('[Stream Fetch Warning]:', err.message);
  }
  return streams;
}

const manifest = {
  id: "org.xmas.cz.nuvio",
  version: "1.3.0",
  name: "Vánoční Filmy & Pohádky",
  description: "České i zahraniční vánoční filmy a pohádky s českým dabingem a Real-Debrid",
  logo: "https://upload.wikimedia.org/wikipedia/commons/e/ea/Christmas_tree_icon.svg",
  background: "https://images.unsplash.com/photo-1543589077-47d51996477a?q=80&w=1920",
  resources: ["catalog", "meta", "stream"],
  types: ["movie"],
  idPrefixes: ["tmdb:"],
  catalogs: [
    {
      type: "movie",
      id: "xmas_cz",
      name: "🎄 Vánoční - České pohádky & klasiky",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    },
    {
      type: "movie",
      id: "xmas_world",
      name: "🎄 Vánoční - Zahraniční trháky (CZ dabing)",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    }
  ],
  behaviorHints: { adult: false }
};

app.get('/manifest.json', (req, res) => res.json(manifest));

function parseExtra(extraStr) {
  if (!extraStr) return {};
  const cleaned = extraStr.replace(/\.json$/, '');
  const params = new URLSearchParams(cleaned);
  const res = {};
  for (const [k, v] of params.entries()) res[k] = v;
  return res;
}

// 1. CATALOG ENDPOINT
app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], async (req, res) => {
  const { id: catalogId, extra: extraStr } = req.params;
  const extra = parseExtra(extraStr);
  const { search, skip } = extra;
  const page = skip ? Math.floor(parseInt(skip) / 20) + 1 : 1;

  try {
    let url = '';

    if (search) {
      url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=${encodeURIComponent(search)}&language=cs-CZ&page=${page}`;
    } else if (catalogId === 'xmas_cz') {
      url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&with_original_language=cs&with_genres=10751,14,35&sort_by=popularity.desc&language=cs-CZ&page=${page}`;
    } else {
      url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_KEY}&with_keywords=207317&sort_by=popularity.desc&language=cs-CZ&page=${page}`;
    }

    const response = await axios.get(url, { timeout: 8000 });
    const metas = [];

    if (response.data && response.data.results) {
      response.data.results.forEach(item => {
        if (!item.title) return;
        const poster = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : DEFAULT_POSTER;

        metas.push({
          id: `tmdb:${item.id}`,
          type: "movie",
          name: item.title,
          poster: poster,
          description: item.overview || `Hodnocení: ${item.vote_average}/10 | Rok: ${(item.release_date || '').split('-')[0]}`
        });
      });
    }

    console.log(`[Catalog Success] Odesláno ${metas.length} filmů.`);
    res.json({ metas });
  } catch (err) {
    console.error('[Catalog Error]:', err.message);
    res.json({ metas: [] });
  }
});

// 2. META ENDPOINT
app.get(['/meta/:type/:id.json', '/meta/:type/:id'], async (req, res) => {
  const cleanId = req.params.id.replace(/\.json$/, '');
  const tmdbId = cleanId.replace('tmdb:', '');

  try {
    const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_KEY}&language=cs-CZ&append_to_response=external_ids`;
    const response = await axios.get(url, { timeout: 8000 });
    const data = response.data;

    if (data) {
      const poster = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : DEFAULT_POSTER;
      const background = data.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : poster;

      return res.json({
        meta: {
          id: cleanId,
          type: "movie",
          name: data.title || data.original_title,
          poster: poster,
          background: background,
          description: data.overview || 'Bez popisu.',
          genres: data.genres ? data.genres.map(g => g.name) : ['Vánoční'],
          releaseInfo: (data.release_date || '').split('-')[0]
        }
      });
    }
  } catch (err) {
    console.error('[Meta Error]:', err.message);
  }

  res.json({
    meta: {
      id: cleanId,
      type: "movie",
      name: "Detail filmu",
      poster: DEFAULT_POSTER,
      background: DEFAULT_POSTER,
      description: "Přehrávání streamu."
    }
  });
});

// 3. STREAM ENDPOINT
app.get(['/stream/:type/:id.json', '/stream/:type/:id'], async (req, res) => {
  const cleanId = req.params.id.replace(/\.json$/, '');
  const tmdbId = cleanId.replace('tmdb:', '');

  try {
    const tmdbRes = await axios.get(`https://api.themoviedb.org/3/movie/${tmdbId}/external_ids?api_key=${TMDB_KEY}`, { timeout: 8000 });
    const imdbId = tmdbRes.data?.imdb_id;

    if (!imdbId) {
      return res.json({ streams: [] });
    }

    const streams = await getXmasStreams(imdbId);
    console.log(`[Stream Success] Načteno ${streams.length} streamů pro IMDb ${imdbId}`);
    res.json({ streams });
  } catch (err) {
    console.error('[Stream Error]:', err.message);
    res.json({ streams: [] });
  }
});

app.listen(PORT, () => console.log(`Vánoční Addon v1.3.0 spuštěn na portu ${PORT}`));
