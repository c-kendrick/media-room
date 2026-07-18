import { mapSnapshot } from './supabase-data.js';
import { SUPABASE_PUBLISHABLE_KEY, supabaseRequest } from './supabase.js';
import { appSiteUrl } from './auth.js';

export const SHARE_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

function rpc(name, body, accessToken) {
  return supabaseRequest('/rest/v1/rpc/' + name, {
    method: 'POST',
    fresh: true,
    body,
    headers: {
      Authorization: 'Bearer ' + (accessToken || SUPABASE_PUBLISHABLE_KEY),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export function readShareToken(locationLike = window.location) {
  const parameters = new URLSearchParams(locationLike.search || '');
  if (!parameters.has('share')) return '';
  return parameters.get('share')?.trim().toLowerCase() || 'invalid';
}

export function buildCollectionShareUrl(token, locationLike = window.location) {
  const url = new URL(locationLike.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('share', token);
  return url.toString();
}

export function readPublicCollectionUsername(locationLike = window.location) {
  try {
    const match = decodeURI(locationLike.pathname || '').match(/\/u\/([^/]+)\/?$/i);
    return match ? decodeURIComponent(match[1]).trim().toLowerCase() : '';
  } catch {
    return 'invalid';
  }
}

export function restorePublicCollectionRoute() {
  const route = window.sessionStorage.getItem('media-room-public-route');
  if (!route) return;
  window.sessionStorage.removeItem('media-room-public-route');
  if (/\/u\/[^/?#]+\/?(?:[?#].*)?$/i.test(route)) window.history.replaceState({}, '', route);
}

export function buildPublicCollectionUrl(username) {
  return new URL(`u/${encodeURIComponent(username)}`, appSiteUrl()).toString();
}

export async function loadSharedCollection(token) {
  if (!SHARE_TOKEN_PATTERN.test(token)) throw new Error('This share link is unavailable.');
  const payload = await rpc('get_shared_collection', { share_token: token });
  if (!payload?.collection) throw new Error('This share link is unavailable or has been revoked.');
  return {
    ...mapSnapshot(payload.collection, payload.shelves || [], payload.media || [], payload.memberships || []),
    shared: true,
  };
}

export async function loadPublicCollection(username) {
  if (!/^[a-z0-9_.-]{1,60}$/i.test(username)) throw new Error('This public collection is unavailable.');
  const payload = await rpc('get_public_collection_by_username', { public_username: username });
  if (!payload?.collection) throw new Error('This public collection is unavailable or the account is Closed.');
  return {
    ...mapSnapshot(payload.collection, payload.shelves || [], payload.media || [], payload.memberships || []),
    shared: true,
  };
}

export function getPublicCollectionStatus(accessToken) {
  return rpc('get_public_collection_status', {}, accessToken);
}

export function setPublicCollectionOpen(accessToken, enabled) {
  return rpc('set_public_collection_enabled', { public_enabled: enabled }, accessToken);
}

export function getCollectionShare(accessToken, collectionId) {
  return rpc('get_collection_share', { target_collection_id: collectionId }, accessToken);
}

export function createCollectionShare(accessToken, collectionId, rotateToken = false) {
  return rpc('create_collection_share', { target_collection_id: collectionId, rotate_token: rotateToken }, accessToken);
}

export function setCollectionShareEnabled(accessToken, collectionId, enabled) {
  return rpc('set_collection_share_enabled', { target_collection_id: collectionId, share_enabled: enabled }, accessToken);
}

export async function deleteCollectionShare(accessToken, collectionId) {
  await rpc('delete_collection_share', { target_collection_id: collectionId }, accessToken);
  return null;
}
