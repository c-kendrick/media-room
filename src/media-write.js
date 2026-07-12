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

export function createMediaItem(accessToken, item) {
  return supabaseRequest('/rest/v1/media_items', { method: 'POST', fresh: true, body: item,
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', Prefer: 'return=representation' } });
}

export function createShelf(accessToken, shelf) {
  return supabaseRequest('/rest/v1/shelves', { method: 'POST', fresh: true, body: shelf,
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', Prefer: 'return=representation' } });
}

export function updateShelf(accessToken, shelfId, changes) {
  return supabaseRequest('/rest/v1/shelves?id=eq.' + encodeURIComponent(shelfId), { method: 'PATCH', fresh: true, body: changes,
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', Prefer: 'return=representation' } });
}

export function deleteShelf(accessToken, shelfId) {
  return supabaseRequest('/rest/v1/shelves?id=eq.' + encodeURIComponent(shelfId), { method: 'DELETE', fresh: true,
    headers: { Authorization: 'Bearer ' + accessToken } });
}

export function reorderShelfMedia(accessToken, shelfId, orderedMediaIds) {
  return supabaseRequest('/rest/v1/rpc/reorder_shelf_media', { method: 'POST', fresh: true, body: { target_shelf_id: shelfId, ordered_media_ids: orderedMediaIds }, headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' } });
}

export function reorderShelves(accessToken, collectionId, section, orderedShelfIds) {
  return supabaseRequest('/rest/v1/rpc/reorder_shelves', { method: 'POST', fresh: true, body: { target_collection_id: collectionId, target_section: section, ordered_shelf_ids: orderedShelfIds }, headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' } });
}

export function setInterest(accessToken, userId, mediaItemId, enabled) {
  if (!accessToken || !userId || !mediaItemId) throw new Error('An approved signed-in account is required.');
  const path = '/rest/v1/media_interest?media_item_id=eq.' + encodeURIComponent(mediaItemId);
  return enabled
    ? supabaseRequest('/rest/v1/media_interest', { method: 'POST', fresh: true, body: { media_item_id: mediaItemId, user_id: userId }, headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates' } })
    : supabaseRequest(path, { method: 'DELETE', fresh: true, headers: { Authorization: 'Bearer ' + accessToken } });
}
