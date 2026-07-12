// Deploy with: supabase functions deploy enrich-poster
// Set TMDB_API_KEY with: supabase secrets set TMDB_API_KEY=...
// Provider keys live only in the Edge Function environment, never in Vite.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization) return json({ error: 'Sign in is required.' }, 401);
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
    const { data: { user } } = await client.auth.getUser();
    if (!user) return json({ error: 'Session expired.' }, 401);
    const { media_item_id, query, choose_url } = await request.json();
    const { data: item, error } = await client.from('media_items').select('id,collection_id,type,title').eq('id', media_item_id).single();
    if (error || !item) return json({ error: 'Media item was not found.' }, 404);
    const { data: allowed } = await client.rpc('can_manage_collection', { target_collection_id: item.collection_id });
    if (!allowed) return json({ error: 'Only the collection owner can enrich this poster.' }, 403);
    if (choose_url) {
      const { error: updateError } = await client.from('media_items').update({ poster_url: choose_url }).eq('id', item.id);
      return updateError ? json({ error: updateError.message }, 400) : json({ poster_url: choose_url, source: 'chosen' });
    }
    if (!['film', 'television'].includes(item.type)) return json({ error: 'Book and game providers must be configured before automatic enrichment.' }, 422);
    const key = Deno.env.get('TMDB_API_KEY'); if (!key) return json({ error: 'TMDB poster enrichment is not configured.' }, 503);
    const endpoint = item.type === 'television' ? 'tv' : 'movie';
    const response = await fetch(`https://api.themoviedb.org/3/search/${endpoint}?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(query || item.title)}`);
    if (!response.ok) return json({ error: 'TMDB search failed.' }, 502);
    const results = (await response.json()).results || [];
    const candidates = results.slice(0, 8).filter((result: { poster_path?: string }) => result.poster_path).map((result: { id: number; title?: string; name?: string; poster_path: string }) => ({ id: result.id, title: result.title || result.name, poster_url: `https://image.tmdb.org/t/p/w780${result.poster_path}`, provider: 'tmdb' }));
    return json({ candidates });
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Poster enrichment failed.' }, 500); }
});

