import { supabaseRequest } from './supabase.js';

function rpc(accessToken, name, body = {}) {
  if (!accessToken) throw new Error('You must be signed in to manage watchlist requests.');
  return supabaseRequest(`/rest/v1/rpc/${name}`, {
    method: 'POST',
    fresh: true,
    body,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export const loadWatchlistRequests = (accessToken) => rpc(accessToken, 'list_watchlist_requests');

export const loadWatchlistRequestActions = (accessToken, mediaItemId, clubId = null) => (
  rpc(accessToken, 'watchlist_request_actions', {
    target_media_item_id: mediaItemId,
    target_club_id: clubId || null,
  })
);

export const requestPriorityStampRemoval = (accessToken, mediaItemId, clubId = null) => (
  rpc(accessToken, 'request_priority_stamp_removal', {
    target_media_item_id: mediaItemId,
    target_club_id: clubId || null,
  })
);

export const requestWatchedItemMove = (accessToken, clubId, mediaItemId, sourceShelfId) => (
  rpc(accessToken, 'request_watched_item_move', {
    target_club_id: clubId,
    target_media_item_id: mediaItemId,
    target_source_shelf_id: sourceShelfId,
  })
);

export const respondWatchlistRequest = (accessToken, requestId, response, destinationShelfId = null) => (
  rpc(accessToken, 'respond_watchlist_request', {
    target_request_id: requestId,
    response,
    destination_shelf_id: destinationShelfId || null,
  })
);

export function watchlistRequestMessage(request) {
  if (request?.request_type === 'priority_stamp_removal') {
    return `${request.requester_name} has asked you to remove your priority stamp from ${request.media_title}.`;
  }
  return `${request?.requester_name} has marked ${request?.media_title} as watched and asked you to move it out of your watchlist.`;
}

export function stampRequestProgress(actions) {
  const cleared = Number(actions?.cleared) || 0;
  const awaiting = Number(actions?.awaiting) || 0;
  if (!cleared && !awaiting) return '';
  return `${cleared} cleared · ${awaiting} awaiting response`;
}
