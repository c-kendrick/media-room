// The publishable key is intentionally safe to ship in a browser. Database
// access is constrained by Supabase Row Level Security; never use a service key here.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://sswmltwdflqqspsokyrb.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_AWgsHEgRQDkwpafAKcaNOg_MUfg5xd0';

function endpoint(path) {
  return new URL('/rest/v1/' + path, SUPABASE_URL).toString();
}

export async function supabaseSelect(path, { fresh = false } = {}) {
  const response = await fetch(endpoint(path), {
    cache: fresh ? 'no-store' : 'default',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: 'Bearer ' + SUPABASE_PUBLISHABLE_KEY,
    },
  });

  if (!response.ok) {
    throw new Error('Supabase read failed (' + response.status + ').');
  }

  return response.json();
}
