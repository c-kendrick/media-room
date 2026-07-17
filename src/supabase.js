// The publishable key is intentionally safe to ship in a browser. Database
// access is constrained by Supabase Row Level Security; never use a service key here.
export const SUPABASE_URL = import.meta.env?.VITE_SUPABASE_URL || 'https://sswmltwdflqqspsokyrb.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_AWgsHEgRQDkwpafAKcaNOg_MUfg5xd0';

function endpoint(path) {
  return new URL(path, SUPABASE_URL).toString();
}

export async function supabaseRequest(path, { fresh = false, headers = {}, method = 'GET', body } = {}) {
  const response = await fetch(endpoint(path), {
    method,
    cache: fresh ? 'no-store' : 'default',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  if (!response.ok) {
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { /* Keep the HTTP fallback below. */ }
    const details = [payload?.error, payload?.message, payload?.details, payload?.hint].filter(Boolean);
    const error = new Error(details.length ? [...new Set(details)].join(' ') : 'Supabase request failed (' + response.status + ').');
    error.status = response.status;
    error.code = payload?.code || null;
    error.retryAfter = Number(payload?.retry_after || response.headers.get('Retry-After')) || 0;
    throw error;
  }

  return text ? JSON.parse(text) : null;
}

export function supabaseSelect(path, { fresh = false } = {}) {
  return supabaseRequest('/rest/v1/' + path, {
    fresh,
    headers: { Authorization: 'Bearer ' + SUPABASE_PUBLISHABLE_KEY },
  });
}
