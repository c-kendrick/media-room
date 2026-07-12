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

export async function replaceMediaShelfMemberships(accessToken, databaseId, currentShelfIds, selectedShelfIds) {
  const headers = { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' };
  const selected = new Set(selectedShelfIds);
  const current = new Set(currentShelfIds);
  const additions = selectedShelfIds.filter((shelfId) => !current.has(shelfId));
  const removals = currentShelfIds.filter((shelfId) => !selected.has(shelfId));

  // Add first: a failed request leaves existing memberships untouched.
  if (additions.length) {
    await supabaseRequest('/rest/v1/shelf_media_items', {
      method: 'POST',
      fresh: true,
      body: additions.map((shelfId) => ({
        shelf_id: shelfId,
        media_item_id: databaseId,
        position: 1000,
      })),
      headers: { ...headers, Prefer: 'return=minimal' },
    });
  }

  // Remove only memberships that were explicitly deselected. If a removal
  // fails, undo newly-created memberships so the visible state stays truthful.
  try {
    for (const shelfId of removals) {
      await supabaseRequest('/rest/v1/shelf_media_items?media_item_id=eq.' + encodeURIComponent(databaseId) + '&shelf_id=eq.' + encodeURIComponent(shelfId), {
        method: 'DELETE',
        fresh: true,
        headers,
      });
    }
  } catch (error) {
    await Promise.all(additions.map((shelfId) => supabaseRequest('/rest/v1/shelf_media_items?media_item_id=eq.' + encodeURIComponent(databaseId) + '&shelf_id=eq.' + encodeURIComponent(shelfId), {
      method: 'DELETE',
      fresh: true,
      headers,
    }).catch(() => null)));
    throw error;
  }
}

export function setMediaDeleted(accessToken, databaseId, deleted) {
  return supabaseRequest('/rest/v1/media_items?id=eq.' + encodeURIComponent(databaseId), {
    method: 'PATCH', fresh: true,
    body: { deleted_at: deleted ? new Date().toISOString() : null },
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
  });
}

export function permanentlyDeleteMedia(accessToken, databaseId) {
  return supabaseRequest('/rest/v1/media_items?id=eq.' + encodeURIComponent(databaseId), {
    method: 'DELETE', fresh: true,
    headers: { Authorization: 'Bearer ' + accessToken },
  });
}
