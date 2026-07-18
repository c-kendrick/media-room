// Deploy with: supabase functions deploy enrich-details
// Protected secrets: TMDB_API_KEY, RAWG_API_KEY; GOOGLE_BOOKS_API_KEY is optional.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { ...cors, 'Content-Type': 'application/json', ...headers } });
const normalized = (value: unknown) => String(value || '').trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const yearFrom = (value: unknown) => Number(String(value || '').slice(0, 4)) || null;

type MediaType = 'film' | 'television' | 'book' | 'game';
type Details = { year?: number | null; creator?: string | null; director?: string | null; description?: string | null; format?: string | null; platforms?: string[]; genres?: string[]; runtime?: number | null };
type MediaItem = Details & { id: string; collection_id: string; type: MediaType; title: string };
type Candidate = { id: string | number; title: string; year: number | null; provider: string; details: Details; year_fallback?: boolean };
type TmdbEndpoint = 'movie' | 'tv';
type TmdbMatch = { id: number; title?: string; name?: string; release_date?: string; first_air_date?: string };
const writableFields = ['year', 'creator', 'director', 'description', 'format', 'platforms', 'genres', 'runtime'] as const;
const isBlank = (value: unknown) => value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);

async function enforceRateLimit(client: ReturnType<typeof createClient>, action: string) {
  const { data, error } = await client.rpc('claim_enrichment_request', { target_action: action });
  if (error) return json({ error: 'Enrichment limits are not available. Apply the latest Supabase migration and try again.' }, 503);
  const retryAfter = Number(data?.retry_after) || 0;
  if (data?.allowed === false) return json({ error: `Please wait ${retryAfter} seconds before enriching again.`, retry_after: retryAfter }, 429, { 'Retry-After': String(retryAfter) });
  return null;
}

async function tmdbSearch(key: string, endpoint: TmdbEndpoint, title: string, year?: number | null): Promise<TmdbMatch[]> {
  const yearName = endpoint === 'tv' ? 'first_air_date_year' : 'primary_release_year';
  const yearQuery = year ? `&${yearName}=${year}` : '';
  const response = await fetch(`https://api.themoviedb.org/3/search/${endpoint}?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(title)}${yearQuery}`);
  if (!response.ok) throw new Error('TMDB search failed');
  return (await response.json()).results || [];
}

async function tmdbEndpointMatches(key: string, endpoint: TmdbEndpoint, item: MediaItem, manualReview: boolean) {
  const strict = await tmdbSearch(key, endpoint, item.title, item.year);
  if (!item.year) return strict.map((match) => ({ match, yearFallback: false }));
  if (manualReview) {
    const broad = await tmdbSearch(key, endpoint, item.title);
    const seen = new Set(strict.map((match: { id: number }) => match.id));
    return [
      ...strict.map((match) => ({ match, yearFallback: false })),
      ...broad.filter((match) => !seen.has(match.id)).map((match) => ({ match, yearFallback: true })),
    ];
  }
  if (strict.length) return strict.map((match) => ({ match, yearFallback: false }));
  return (await tmdbSearch(key, endpoint, item.title)).map((match) => ({ match, yearFallback: true }));
}

async function tmdbCandidates(item: MediaItem, manualReview = false): Promise<Candidate[]> {
  const key = Deno.env.get('TMDB_API_KEY');
  if (!key) throw new Error('TMDB_API_KEY is not configured');
  const preferred: TmdbEndpoint = item.type === 'television' ? 'tv' : 'movie';
  const endpoints: TmdbEndpoint[] = [preferred, preferred === 'tv' ? 'movie' : 'tv'];
  const matches = (await Promise.all(endpoints.map(async (endpoint) => ({ endpoint, matches: await tmdbEndpointMatches(key, endpoint, item, manualReview) })))).flatMap(({ endpoint, matches: endpointMatches }) => {
    const strictMatches = endpointMatches.filter(({ yearFallback }) => !yearFallback).slice(0, 2);
    const selected = manualReview && item.year
      ? [...strictMatches, ...endpointMatches.filter(({ yearFallback }) => yearFallback).slice(0, 4 - strictMatches.length)]
      : endpointMatches.slice(0, 4);
    return selected.map(({ match, yearFallback }) => ({ endpoint, match, yearFallback }));
  });
  return Promise.all(matches.map(async ({ endpoint, match, yearFallback }) => {
    const response = await fetch(`https://api.themoviedb.org/3/${endpoint}/${match.id}?api_key=${encodeURIComponent(key)}&append_to_response=credits`);
    if (!response.ok) throw new Error('TMDB details failed');
    const detail = await response.json();
    const directors = (detail.credits?.crew || []).filter((person: { job?: string }) => person.job === 'Director').map((person: { name?: string }) => person.name).filter(Boolean);
    const creators = (detail.created_by || []).map((person: { name?: string }) => person.name).filter(Boolean);
    return { id: `${endpoint}:${match.id}`, title: match.title || match.name || '', year: yearFrom(match.release_date || match.first_air_date), provider: endpoint === 'movie' ? 'TMDB Film' : 'TMDB Television', year_fallback: yearFallback, details: {
      year: yearFrom(match.release_date || match.first_air_date), director: directors.join(', ') || null, creator: creators.join(', ') || null,
      description: detail.overview || null, genres: (detail.genres || []).map((genre: { name?: string }) => genre.name).filter(Boolean),
      runtime: endpoint === 'tv' ? detail.episode_run_time?.[0] || null : detail.runtime || null,
    } };
  }));
}

async function googleBookCandidates(item: MediaItem): Promise<Candidate[]> {
  const key = Deno.env.get('GOOGLE_BOOKS_API_KEY');
  const keyPart = key ? `&key=${encodeURIComponent(key)}` : '';
  const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(`intitle:${item.title}`)}&maxResults=8&printType=books${keyPart}`);
  if (!response.ok) throw new Error('Google Books search failed');
  return ((await response.json()).items || []).map((result: { id: string; volumeInfo?: { title?: string; publishedDate?: string; authors?: string[]; description?: string; categories?: string[]; pageCount?: number } }) => {
    const book = result.volumeInfo || {};
    return { id: result.id, title: book.title || '', year: yearFrom(book.publishedDate), provider: 'Google Books', details: { year: yearFrom(book.publishedDate), creator: book.authors?.join(', ') || null, description: book.description || null, genres: book.categories || [] } };
  });
}

async function rawgCandidates(item: MediaItem): Promise<Candidate[]> {
  const key = Deno.env.get('RAWG_API_KEY');
  if (!key) throw new Error('RAWG_API_KEY is not configured');
  const search = await fetch(`https://api.rawg.io/api/games?key=${encodeURIComponent(key)}&search=${encodeURIComponent(item.title)}&page_size=8`);
  if (!search.ok) throw new Error('RAWG search failed');
  const matches = (await search.json()).results || [];
  return Promise.all(matches.map(async (match: { id: number; name?: string; released?: string; genres?: { name?: string }[]; platforms?: { platform?: { name?: string } }[] }) => {
    const response = await fetch(`https://api.rawg.io/api/games/${match.id}?key=${encodeURIComponent(key)}`);
    if (!response.ok) throw new Error('RAWG details failed');
    const detail = await response.json();
    const developers = (detail.developers || []).map((entry: { name?: string }) => entry.name).filter(Boolean);
    const publishers = (detail.publishers || []).map((entry: { name?: string }) => entry.name).filter(Boolean);
    return { id: match.id, title: match.name || '', year: yearFrom(match.released), provider: 'RAWG', details: {
      year: yearFrom(match.released), creator: [...developers, ...publishers].join(', ') || null,
      description: detail.description_raw || null, genres: (match.genres || []).map((entry) => entry.name).filter(Boolean),
      platforms: (match.platforms || []).map((entry) => entry.platform?.name).filter(Boolean),
    } };
  }));
}

function providerCandidates(item: MediaItem, manualReview = false) {
  if (item.type === 'book') return googleBookCandidates(item);
  if (item.type === 'game') return rawgCandidates(item);
  return tmdbCandidates(item, manualReview);
}

function blankOnly(item: MediaItem, candidate: Candidate) {
  const changes: Details = {};
  for (const field of writableFields) {
    const next = candidate.details?.[field];
    if (isBlank(item[field]) && !isBlank(next)) (changes as Record<string, unknown>)[field] = next;
  }
  return changes;
}

function confidentCandidate(item: MediaItem, candidates: Candidate[]) {
  const exact = candidates.filter((candidate) => normalized(candidate.title) === normalized(item.title)
    && (!item.year || !candidate.year || candidate.year === item.year)
    && !(candidate.year_fallback && item.year && candidate.year !== item.year));
  return exact.length === 1 ? exact[0] : null;
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
    const { data: profile } = await client.from('profiles').select('role').eq('id', user.id).single();
    const isAdmin = profile?.role === 'admin';

    if (body.enrich_section) {
      if (!body.collection_id || !['screen', 'book', 'game'].includes(body.enrich_section)) return json({ error: 'Choose a valid collection section.' }, 400);
      const { data: collection } = await client.from('collections').select('id,owner_id').eq('id', body.collection_id).single();
      if (!collection || (collection.owner_id !== user.id && !isAdmin)) return json({ error: 'Only the collection owner or an administrator can enrich details.' }, 403);
      const { data: rows, error } = await client.from('media_items').select('id,collection_id,type,title,year,creator,director,description,format,platforms,genres,runtime').eq('collection_id', collection.id).is('deleted_at', null);
      if (error) return json({ error: error.message }, 400);
      const types = body.enrich_section === 'screen' ? ['film', 'television'] : [body.enrich_section];
      const targets = (rows || []).filter((item: MediaItem) => types.includes(item.type) && writableFields.some((field) => isBlank(item[field]))).slice(0, 50);
      if (targets.length) {
        const limited = await enforceRateLimit(client, 'details-batch');
        if (limited) return limited;
      }
      const warnings = new Set<string>(); let enriched = 0;
      for (let index = 0; index < targets.length; index += 4) {
        const results = await Promise.all(targets.slice(index, index + 4).map(async (item: MediaItem) => {
          try { return { item, candidate: confidentCandidate(item, await providerCandidates(item)) }; }
          catch (providerError) { warnings.add(providerError instanceof Error ? providerError.message : 'Provider search failed'); return { item, candidate: null }; }
        }));
        for (const { item, candidate } of results) {
          if (!candidate) continue;
          const changes = blankOnly(item, candidate);
          if (!Object.keys(changes).length) continue;
          const { error: updateError } = await client.from('media_items').update(changes).eq('id', item.id);
          if (!updateError) enriched += 1;
        }
      }
      return json({ enriched, reviewed: targets.length, unmatched: targets.length - enriched, warnings: [...warnings] });
    }

    const { data: item, error } = await client.from('media_items').select('id,collection_id,type,title,year,creator,director,description,format,platforms,genres,runtime').eq('id', body.media_item_id).single();
    if (error || !item) return json({ error: 'Media item was not found.' }, 404);
    const { data: collection } = await client.from('collections').select('owner_id').eq('id', item.collection_id).single();
    if (!collection || (collection.owner_id !== user.id && !isAdmin)) return json({ error: 'Only the collection owner or an administrator can enrich these details.' }, 403);
    if (body.candidate) {
      const applied = blankOnly(item, body.candidate);
      if (Object.keys(applied).length) {
        const { error: updateError } = await client.from('media_items').update(applied).eq('id', item.id);
        if (updateError) return json({ error: updateError.message }, 400);
      }
      return json({ applied });
    }
    const limited = await enforceRateLimit(client, 'details-search');
    if (limited) return limited;
    return json({ candidates: (await providerCandidates(item, true)).map((candidate) => ({ ...candidate, details: blankOnly(item, candidate) })).filter((candidate) => Object.keys(candidate.details).length).slice(0, 8) });
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Detail enrichment failed.' }, 500); }
});
