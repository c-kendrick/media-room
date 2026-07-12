import { supabaseRequest } from './supabase.js';

export async function updateMediaItem(accessToken, databaseId, changes) {
  if (!accessToken || !databaseId) throw new Error('You must be signed in to edit this item.');

  const updated = await supabaseRequest('/rest/v1/media_items?id=eq.' + encodeURIComponent(databaseId), {
    method: 'PATCH',
    fresh: true,
    body: changes,
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
  });

  if (!updated?.[0]) throw new Error('The item was not updated.');
  return updated[0];
}
