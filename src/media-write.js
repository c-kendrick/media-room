import { supabaseRequest } from './supabase.js';

const enrichmentCandidateCache = new Map();
const ENRICHMENT_CACHE_MS = 30 * 60 * 1000;

function cachedEnrichment(key) {
  const cached = enrichmentCandidateCache.get(key);
  if (!cached || cached.expiresAt <= Date.now()) {
    enrichmentCandidateCache.delete(key);
    return null;
  }
  return cached.value;
}

async function cachedEnrichmentRequest(key, request) {
  const cached = cachedEnrichment(key);
  if (cached) return cached;
  const value = await request();
  enrichmentCandidateCache.set(key, { value, expiresAt: Date.now() + ENRICHMENT_CACHE_MS });
  return value;
}

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

export async function setMediaStarRating(accessToken, databaseId, starRating) {
  if (!accessToken || !databaseId) throw new Error('You must be signed in to rate this item.');

  const updated = await supabaseRequest('/rest/v1/media_items?id=eq.' + encodeURIComponent(databaseId), {
    method: 'PATCH',
    fresh: true,
    body: { star_rating: starRating },
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
  });

  if (!updated?.[0]) throw new Error('The star rating was not updated.');
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

export function createMediaItem(accessToken, item) {
  return supabaseRequest('/rest/v1/media_items', { method: 'POST', fresh: true, body: item,
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', Prefer: 'return=representation' } });
}

export function permanentlyDeleteMedia(accessToken, databaseId) {
  return supabaseRequest('/rest/v1/media_items?id=eq.' + encodeURIComponent(databaseId), {
    method: 'DELETE', fresh: true,
    headers: { Authorization: 'Bearer ' + accessToken, Prefer: 'return=representation' },
  });
}

export function createShelf(accessToken, shelf) {
  return supabaseRequest('/rest/v1/shelves', { method: 'POST', fresh: true, body: shelf,
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', Prefer: 'return=representation' } });
}

export function updateShelf(accessToken, shelfId, changes) {
  return supabaseRequest('/rest/v1/shelves?id=eq.' + encodeURIComponent(shelfId), { method: 'PATCH', fresh: true, body: changes,
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', Prefer: 'return=representation' } });
}

export function updateCollection(accessToken, collectionId, changes) {
  return supabaseRequest('/rest/v1/collections?id=eq.' + encodeURIComponent(collectionId), { method: 'PATCH', fresh: true, body: changes,
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', Prefer: 'return=representation' } });
}

export function deleteShelf(accessToken, shelfId) {
  return supabaseRequest('/rest/v1/shelves?id=eq.' + encodeURIComponent(shelfId), { method: 'DELETE', fresh: true,
    headers: { Authorization: 'Bearer ' + accessToken, Prefer: 'return=representation' } });
}

export function completeShelfOrder(orderedMediaIds, membershipRows, activeMediaRows) {
  const activeIds = new Set(activeMediaRows.map((row) => row.id));
  const includedIds = new Set(orderedMediaIds);
  const serverOnlyIds = membershipRows
    .map((row) => row.media_item_id)
    .filter((id) => {
      if (!activeIds.has(id) || includedIds.has(id)) return false;
      includedIds.add(id);
      return true;
    });
  return [...orderedMediaIds, ...serverOnlyIds];
}

async function loadCompleteActiveShelfOrder(accessToken, shelfId, orderedMediaIds) {
  const authorization = { Authorization: 'Bearer ' + accessToken };
  const membershipQuery = new URLSearchParams({
    shelf_id: `eq.${shelfId}`,
    select: 'media_item_id,position,created_at',
    order: 'position.asc,created_at.asc,media_item_id.asc',
  });
  const memberships = await supabaseRequest('/rest/v1/shelf_media_items?' + membershipQuery, { fresh: true, headers: authorization });
  const membershipIds = [...new Set(memberships.map((row) => row.media_item_id))];
  if (!membershipIds.length) return orderedMediaIds;
  const mediaQuery = new URLSearchParams({
    select: 'id',
    id: `in.(${membershipIds.join(',')})`,
    deleted_at: 'is.null',
  });
  const activeMedia = await supabaseRequest('/rest/v1/media_items?' + mediaQuery, { fresh: true, headers: authorization });
  return completeShelfOrder(orderedMediaIds, memberships, activeMedia);
}

export async function reorderShelfMedia(accessToken, shelfId, orderedMediaIds) {
  let completeOrder = orderedMediaIds;
  try {
    completeOrder = await loadCompleteActiveShelfOrder(accessToken, shelfId, orderedMediaIds);
  } catch {
    // The resilient RPC can save the visible subset directly. This preflight
    // exists for databases that have not received that migration yet.
  }
  return supabaseRequest('/rest/v1/rpc/reorder_shelf_media', { method: 'POST', fresh: true, body: { target_shelf_id: shelfId, ordered_media_ids: completeOrder }, headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' } });
}

export async function reorderShelves(accessToken, collectionId, section, orderedShelfIds) {
  try {
    return await supabaseRequest('/rest/v1/rpc/reorder_shelves', { method: 'POST', fresh: true, body: { target_collection_id: collectionId, target_section: section, ordered_shelf_ids: orderedShelfIds }, headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' } });
  } catch {
    // Same ownership-safe fallback as media ordering.
    for (let index = 0; index < orderedShelfIds.length; index += 1) {
      await supabaseRequest('/rest/v1/shelves?id=eq.' + encodeURIComponent(orderedShelfIds[index]) + '&collection_id=eq.' + encodeURIComponent(collectionId) + '&section=eq.' + encodeURIComponent(section), {
        method: 'PATCH', fresh: true, body: { position: (index + 1) * 1000 },
        headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      });
    }
  }
}

export function reorderMainWatchlist(accessToken, orderedShelfIds) {
  return supabaseRequest('/rest/v1/rpc/reorder_main_watchlist', { method: 'POST', fresh: true, body: { ordered_shelf_ids: orderedShelfIds },
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' } });
}

export function reorderCollections(accessToken, orderedCollectionIds) {
  return supabaseRequest('/rest/v1/rpc/reorder_collections', { method: 'POST', fresh: true, body: { ordered_collection_ids: orderedCollectionIds },
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' } });
}

export function bulkImportMedia(accessToken, collectionId, shelfIds, section, items) {
  return supabaseRequest('/rest/v1/rpc/bulk_import_media_to_shelves', { method: 'POST', fresh: true,
    body: { target_collection_id: collectionId, target_shelf_ids: shelfIds, target_section: section, import_items: items },
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' } });
}

export function importCollectionBackup(accessToken, collectionId, backup) {
  return supabaseRequest('/rest/v1/rpc/import_collection_backup', { method: 'POST', fresh: true,
    body: { target_collection_id: collectionId, backup },
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' } });
}

export function enrichSectionPosters(accessToken, collectionId, section) {
  return supabaseRequest('/functions/v1/enrich-poster', { method: 'POST', fresh: true,
    body: { collection_id: collectionId, enrich_section: section },
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' } });
}

export function searchPosterCandidates(accessToken, mediaItemId) {
  return cachedEnrichmentRequest(`poster:${mediaItemId}`, () => supabaseRequest('/functions/v1/enrich-poster', { method: 'POST', fresh: true,
    body: { media_item_id: mediaItemId }, headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' } }));
}

export function choosePosterCandidate(accessToken, mediaItemId, posterUrl) {
  enrichmentCandidateCache.delete(`poster:${mediaItemId}`);
  return supabaseRequest('/functions/v1/enrich-poster', { method: 'POST', fresh: true,
    body: { media_item_id: mediaItemId, choose_url: posterUrl }, headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' } });
}

export function enrichSectionDetails(accessToken, collectionId, section) {
  return supabaseRequest('/functions/v1/enrich-details', { method: 'POST', fresh: true,
    body: { collection_id: collectionId, enrich_section: section },
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' } });
}

export function searchDetailCandidates(accessToken, mediaItemId) {
  return cachedEnrichmentRequest(`details:${mediaItemId}`, () => supabaseRequest('/functions/v1/enrich-details', { method: 'POST', fresh: true,
    body: { media_item_id: mediaItemId }, headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' } }));
}

export function chooseDetailCandidate(accessToken, mediaItemId, candidate) {
  enrichmentCandidateCache.delete(`details:${mediaItemId}`);
  return supabaseRequest('/functions/v1/enrich-details', { method: 'POST', fresh: true,
    body: { media_item_id: mediaItemId, candidate }, headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' } });
}

export function setInterest(accessToken, userId, mediaItemId, enabled) {
  if (!accessToken || !userId || !mediaItemId) throw new Error('An approved signed-in account is required.');
  const path = '/rest/v1/media_interest?media_item_id=eq.' + encodeURIComponent(mediaItemId)
    + '&user_id=eq.' + encodeURIComponent(userId);
  return enabled
    ? supabaseRequest('/rest/v1/media_interest', { method: 'POST', fresh: true, body: { media_item_id: mediaItemId, user_id: userId }, headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates' } })
    : supabaseRequest(path, { method: 'DELETE', fresh: true, headers: { Authorization: 'Bearer ' + accessToken } });
}
