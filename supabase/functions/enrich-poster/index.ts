// Deploy with: supabase functions deploy enrich-poster
// Protected secrets: TMDB_API_KEY, GOOGLE_BOOKS_API_KEY, STEAMGRIDDB_API_KEY
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const normalized = (value: unknown) => String(value || '').trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const yearFrom = (value: unknown) => Number(String(value || '').slice(0, 4)) || null;

type MediaItem = { id: string; collection_id: string; type: 'film' | 'television' | 'book' | 'game'; title: string; year: number | null; poster_url?: string | null };
type Candidate = { id: string | number; title: string; year: number | null; poster_url: string; provider: string };

async function tmdbCandidates(item: MediaItem, query?: string): Promise<Candidate[]> {
  const key = Deno.env.get('TMDB_API_KEY');
  if (!key) throw new Error('TMDB_API_KEY is not configured');
  const endpoint = item.type === 'television' ? 'tv' : 'movie';
  const yearName = item.type === 'television' ? 'first_air_date_year' : 'year';
  const year = item.year ? `&${yearName}=${item.year}` : '';
  const response = await fetch(`https://api.themoviedb.org/3/search/${endpoint}?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(query || item.title)}${year}`);
  if (!response.ok) throw new Error('TMDB search failed');
  const results = (await response.json()).results || [];
  return results.filter((result: { poster_path?: string }) => result.poster_path).map((result: { id: number; title?: string; name?: string; poster_path: string; release_date?: string; first_air_date?: string }) => ({
    id: result.id, title: result.title || result.name || '', year: yearFrom(result.release_date || result.first_air_date),
    poster_url: `https://image.tmdb.org/t/p/w780${result.poster_path}`, provider: 'tmdb',
  }));
}

async function googleBookCandidates(item: MediaItem, query?: string): Promise<Candidate[]> {
  const key = Deno.env.get('GOOGLE_BOOKS_API_KEY');
  if (!key) return [];
  const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(`intitle:${query || item.title}`)}&maxResults=20&printType=books&key=${encodeURIComponent(key)}`);
  if (!response.ok) throw new Error('Google Books search failed');
  return ((await response.json()).items || []).flatMap((result: { id: string; volumeInfo?: { title?: string; publishedDate?: string; imageLinks?: { thumbnail?: string } } }) => {
    const cover = result.volumeInfo?.imageLinks?.thumbnail;
    return cover ? [{ id: result.id, title: result.volumeInfo?.title || '', year: yearFrom(result.volumeInfo?.publishedDate), poster_url: cover.replace(/^http:/, 'https:'), provider: 'google-books' }] : [];
  });
}

async function openLibraryCandidates(item: MediaItem, query?: string): Promise<Candidate[]> {
  const response = await fetch(`https://openlibrary.org/search.json?title=${encodeURIComponent(query || item.title)}&limit=20&fields=key,title,first_publish_year,cover_i`, {
    headers: { 'User-Agent': "Kit's Media Room/1.0 (https://github.com/c-kendrick/media-room)" },
  });
  if (!response.ok) throw new Error('Open Library search failed');
  return ((await response.json()).docs || []).flatMap((result: { key?: string; title?: string; first_publish_year?: number; cover_i?: number }) => result.cover_i ? [{
    id: result.key || result.cover_i, title: result.title || '', year: result.first_publish_year || null,
    poster_url: `https://covers.openlibrary.org/b/id/${result.cover_i}-L.jpg`, provider: 'open-library',
  }] : []);
}

async function bookCandidates(item: MediaItem, query?: string): Promise<Candidate[]> {
  const google = await googleBookCandidates(item, query);
  if (google.length) return google;
  return openLibraryCandidates(item, query);
}

async function steamGridCandidates(item: MediaItem, query?: string): Promise<Candidate[]> {
  const key = Deno.env.get('STEAMGRIDDB_API_KEY');
  if (!key) throw new Error('STEAMGRIDDB_API_KEY is not configured');
  const headers = { Authorization: `Bearer ${key}` };
  const search = await fetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(query || item.title)}`, { headers });
  if (!search.ok) throw new Error('SteamGridDB search failed');
  const games = ((await search.json()).data || []).filter((game: { name?: string }) => normalized(game.name) === normalized(query || item.title));
  if (games.length !== 1) return [];
  const grids = await fetch(`https://www.steamgriddb.com/api/v2/grids/game/${games[0].id}?dimensions=600x900,342x482,660x930&types=static&nsfw=false&humor=false&epilepsy=false`, { headers });
  if (!grids.ok) throw new Error('SteamGridDB artwork search failed');
  return ((await grids.json()).data || []).sort((a: { score?: number }, b: { score?: number }) => (b.score || 0) - (a.score || 0)).slice(0, 8).map((grid: { id: number; url: string }) => ({
    id: grid.id, title: games[0].name, year: null, poster_url: grid.url, provider: 'steamgriddb',
  }));
}

function providerCandidates(item: MediaItem, query?: string) {
  if (item.type === 'book') return bookCandidates(item, query);
  if (item.type === 'game') return steamGridCandidates(item, query);
  return tmdbCandidates(item, query);
}

async function confidentPoster(item: MediaItem) {
  const candidates = await providerCandidates(item);
  if (item.type === 'game') return candidates[0] || null;
  const exact = candidates.filter((candidate) => normalized(candidate.title) === normalized(item.title)
    && (!item.year || candidate.year === null || candidate.year === item.year));
  const uniqueUrls = [...new Map(exact.map((candidate) => [candidate.poster_url, candidate])).values()];
  return uniqueUrls.length === 1 ? uniqueUrls[0] : null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization) return json({ error: 'Sign in is required.' }, 401);
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
    const { data: { user } } = await client.auth.getUser();
    if (!user) return json({ error: 'Session expired.' }, 401);
    const body = await request.json();

    if (Array.isArray(body.bulk_items)) {
      if (!body.collection_id || body.bulk_items.length > 50) return json({ error: 'Poster enrichment is limited to 50 imported items at once.' }, 400);
      const { data: collection } = await client.from('collections').select('id,owner_id').eq('id', body.collection_id).single();
      if (!collection || collection.owner_id !== user.id) return json({ error: 'Only the collection owner can enrich imported posters.' }, 403);
      const { data: collectionItems, error: itemsError } = await client.from('media_items').select('id,collection_id,type,title,year,poster_url').eq('collection_id', collection.id).is('deleted_at', null);
      if (itemsError) return json({ error: itemsError.message }, 400);
      const requested = new Set(body.bulk_items.map((item: { title?: string; year?: number | null }) => `${normalized(item.title)}:${item.year ?? ''}`));
      const targets = (collectionItems || []).filter((item: MediaItem) => !item.poster_url && requested.has(`${normalized(item.title)}:${item.year ?? ''}`)).slice(0, 50);
      const warnings = new Set<string>();
      if (targets.some((item: MediaItem) => ['film', 'television'].includes(item.type)) && !Deno.env.get('TMDB_API_KEY')) warnings.add('TMDB key missing');
      if (targets.some((item: MediaItem) => item.type === 'game') && !Deno.env.get('STEAMGRIDDB_API_KEY')) warnings.add('SteamGridDB key missing');
      let enriched = 0;
      for (let index = 0; index < targets.length; index += 5) {
        const matches = await Promise.all(targets.slice(index, index + 5).map(async (item: MediaItem) => {
          try { return { item, candidate: await confidentPoster(item) }; }
          catch (error) { warnings.add(error instanceof Error ? error.message : 'Provider search failed'); return { item, candidate: null }; }
        }));
        for (const { item, candidate } of matches) {
          if (!candidate) continue;
          const { data: updated, error: updateError } = await client.from('media_items').update({ poster_url: candidate.poster_url }).eq('id', item.id).or('poster_url.is.null,poster_url.eq.').select('id');
          if (!updateError && updated?.length) enriched += 1;
        }
      }
      return json({ enriched, reviewed: targets.length, unmatched: targets.length - enriched, warnings: [...warnings] });
    }

    const { media_item_id, query, choose_url } = body;
    const { data: item, error } = await client.from('media_items').select('id,collection_id,type,title,year').eq('id', media_item_id).single();
    if (error || !item) return json({ error: 'Media item was not found.' }, 404);
    const { data: collection } = await client.from('collections').select('owner_id').eq('id', item.collection_id).single();
    if (!collection || collection.owner_id !== user.id) return json({ error: 'Only the collection owner can enrich this poster.' }, 403);
    if (choose_url) {
      const { error: updateError } = await client.from('media_items').update({ poster_url: choose_url }).eq('id', item.id);
      return updateError ? json({ error: updateError.message }, 400) : json({ poster_url: choose_url, source: 'chosen' });
    }
    return json({ candidates: (await providerCandidates(item, query)).slice(0, 8) });
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Poster enrichment failed.' }, 500); }
});
