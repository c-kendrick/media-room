import { mapSnapshot } from './supabase-data.js';
import { SUPABASE_PUBLISHABLE_KEY, supabaseRequest } from './supabase.js';

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

export async function loadSharedCollection(token) {
  if (!SHARE_TOKEN_PATTERN.test(token)) throw new Error('This share link is unavailable.');
  const payload = await rpc('get_shared_collection', { share_token: token });
  if (!payload?.collection) throw new Error('This share link is unavailable or has been revoked.');
  return {
    ...mapSnapshot(payload.collection, payload.shelves || [], payload.media || [], payload.memberships || []),
    shared: true,
  };
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
