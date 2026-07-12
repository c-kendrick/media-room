import { loadCollectionFromSupabase } from './supabase-data.js';

async function loadStaticSnapshot({ fresh = false } = {}) {
  const relative = `${import.meta.env.BASE_URL}media-data.json`;
  const url = new URL(relative, window.location.href);
  if (fresh) url.searchParams.set('refresh', Date.now().toString());

  const response = await fetch(url, { cache: fresh ? 'no-store' : 'default' });
  if (!response.ok) throw new Error(`Could not load media-data.json (${response.status}).`);

  return response.json();
}

function assertSnapshot(data) {
  if (!Array.isArray(data.media) || !Array.isArray(data.mediaShelves)) {
    throw new Error('The media collection does not contain valid shelf data.');
  }
  return data;
}

export async function loadMediaSnapshot({ fresh = false, collectionId } = {}) {
  try {
    const supabaseSnapshot = await loadCollectionFromSupabase({ fresh, collectionId });
    if (supabaseSnapshot) return assertSnapshot(supabaseSnapshot);
  } catch (error) {
    // The static export keeps the public site available until the one-time
    // Supabase import has run, and during any temporary Supabase outage.
    console.warn('Falling back to the static Media Room export.', error);
  }

  if (collectionId) throw new Error('That collection is temporarily unavailable. Please try again.');
  return assertSnapshot(await loadStaticSnapshot({ fresh }));
}

