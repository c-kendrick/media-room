// Deploy with: supabase functions deploy enrich-poster
// Set TMDB_API_KEY with: supabase secrets set TMDB_API_KEY=...
// Provider keys live only in the Edge Function environment, never in Vite.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const normalized = (value: unknown) => String(value || '').trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

type MediaItem = { id: string; collection_id: string; type: 'film' | 'television' | 'book' | 'game'; title: string; year: number | null; poster_url?: string | null };
type TmdbResult = { id: number; title?: string; name?: string; poster_path?: string; release_date?: string; first_air_date?: string };

async function tmdbCandidates(item: MediaItem, key: string, query?: string) {
  const endpoint = item.type === 'television' ? 'tv' : 'movie';
  const yearName = item.type === 'television' ? 'first_air_date_year' : 'year';
  const year = item.year ? `&${yearName}=${item.year}` : '';
  const response = await fetch(`https://api.themoviedb.org/3/search/${endpoint}?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(query || item.title)}${year}`);
  if (!response.ok) throw new Error('TMDB search failed.');
  const results: TmdbResult[] = (await response.json()).results || [];
  return results.filter((result) => result.poster_path).map((result) => ({
    id: result.id,
    title: result.title || result.name || '',
    year: Number((result.release_date || result.first_air_date || '').slice(0, 4)) || null,
    poster_url: `https://image.tmdb.org/t/p/w780${result.poster_path}`,
    provider: 'tmdb',
  }));
}

async function confidentPoster(item: MediaItem, key: string) {
  const candidates = await tmdbCandidates(item, key);
  const matches = candidates.filter((candidate) => normalized(candidate.title) === normalized(item.title)
    && (!item.year || candidate.year === item.year));
  return matches.length === 1 ? matches[0] : null;
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
    const key = Deno.env.get('TMDB_API_KEY');

    if (Array.isArray(body.bulk_items)) {
      if (!key) return json({ error: 'TMDB poster enrichment is not configured.' }, 503);
      if (!body.collection_id || body.bulk_items.length > 50) return json({ error: 'Poster enrichment is limited to 50 imported items at once.' }, 400);
      const { data: collection } = await client.from('collections').select('id,owner_id').eq('id', body.collection_id).single();
      if (!collection || collection.owner_id !== user.id) return json({ error: 'Only the collection owner can enrich imported posters.' }, 403);
      const { data: collectionItems, error: itemsError } = await client.from('media_items').select('id,collection_id,type,title,year,poster_url').eq('collection_id', collection.id).is('deleted_at', null);
      if (itemsError) return json({ error: itemsError.message }, 400);
      const requested = new Set(body.bulk_items.map((item: { title?: string; year?: number | null }) => `${normalized(item.title)}:${item.year ?? ''}`));
      const targets = (collectionItems || []).filter((item: MediaItem) => !item.poster_url && ['film', 'television'].includes(item.type)
        && requested.has(`${normalized(item.title)}:${item.year ?? ''}`)).slice(0, 50);
      let enriched = 0;
      for (let index = 0; index < targets.length; index += 5) {
        const batch = targets.slice(index, index + 5);
        const matches = await Promise.all(batch.map(async (item: MediaItem) => ({ item, candidate: await confidentPoster(item, key) })));
        for (const { item, candidate } of matches) {
          if (!candidate) continue;
          const { error: updateError } = await client.from('media_items').update({ poster_url: candidate.poster_url }).eq('id', item.id);
          if (!updateError) enriched += 1;
        }
      }
      return json({ enriched, reviewed: targets.length, unmatched: targets.length - enriched });
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
    if (!['film', 'television'].includes(item.type)) return json({ error: 'Book and game providers must be configured before automatic enrichment.' }, 422);
    if (!key) return json({ error: 'TMDB poster enrichment is not configured.' }, 503);
    return json({ candidates: (await tmdbCandidates(item, key, query)).slice(0, 8) });
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Poster enrichment failed.' }, 500); }
});
