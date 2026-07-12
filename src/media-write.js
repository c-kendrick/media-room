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

export async function replaceMediaShelfMemberships(accessToken, databaseId, shelves, selectedShelfIds) {
  const headers = { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' };
  const currentShelfIds = shelves.map((shelf) => shelf.id);
  if (currentShelfIds.length) {
    await supabaseRequest('/rest/v1/shelf_media_items?media_item_id=eq.' + encodeURIComponent(databaseId) + '&shelf_id=in.(' + currentShelfIds.join(',') + ')', {
      method: 'DELETE', fresh: true, headers,
    });
  }
  const rows = selectedShelfIds.map((shelfId, index) => ({
    shelf_id: shelfId, media_item_id: databaseId, position: (index + 1) * 1000,
  }));
  if (rows.length) {
    await supabaseRequest('/rest/v1/shelf_media_items', {
      method: 'POST', fresh: true, body: rows,
      headers: { ...headers, Prefer: 'return=minimal' },
    });
  }
}
