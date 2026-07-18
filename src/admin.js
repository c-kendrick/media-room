import { supabaseRequest } from './supabase.js';

function headers(accessToken) {
  return { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' };
}

export async function listProfiles(accessToken) {
  try {
    return await supabaseRequest('/rest/v1/profiles?select=id,username,display_name,approved_at,rejected_at,deactivated_at,role&order=created_at.asc', { fresh: true, headers: headers(accessToken) });
  } catch {
    return supabaseRequest('/rest/v1/profiles?select=id,username,display_name,approved_at,rejected_at,role&order=created_at.asc', { fresh: true, headers: headers(accessToken) });
  }
}

export function approveProfile(accessToken, id) {
  return supabaseRequest('/rest/v1/rpc/approve_profile', { method: 'POST', fresh: true, headers: headers(accessToken), body: { target_profile_id: id } });
}

export function rejectProfile(accessToken, id) {
  return supabaseRequest('/rest/v1/rpc/reject_profile', { method: 'POST', fresh: true, headers: headers(accessToken), body: { target_profile_id: id } });
}

export function deactivateProfile(accessToken, id) {
  return supabaseRequest('/rest/v1/rpc/deactivate_profile', { method: 'POST', fresh: true, headers: headers(accessToken), body: { target_profile_id: id } });
}

export function restoreProfile(accessToken, id) {
  return supabaseRequest('/rest/v1/rpc/restore_profile', { method: 'POST', fresh: true, headers: headers(accessToken), body: { target_profile_id: id } });
}

export function listClubs(accessToken) {
  return supabaseRequest('/rest/v1/rpc/admin_list_clubs', { method: 'POST', fresh: true, headers: headers(accessToken), body: {} });
}

export function createClub(accessToken, name) {
  return supabaseRequest('/rest/v1/rpc/admin_create_club', { method: 'POST', fresh: true, headers: headers(accessToken), body: { club_name: name } });
}

export function renameClub(accessToken, id, name) {
  return supabaseRequest('/rest/v1/rpc/admin_rename_club', { method: 'POST', fresh: true, headers: headers(accessToken), body: { target_club_id: id, club_name: name } });
}

export function deleteClub(accessToken, id) {
  return supabaseRequest('/rest/v1/rpc/admin_delete_club', { method: 'POST', fresh: true, headers: headers(accessToken), body: { target_club_id: id } });
}

export function setUserClubs(accessToken, userId, clubIds) {
  return supabaseRequest('/rest/v1/rpc/admin_set_user_clubs', { method: 'POST', fresh: true, headers: headers(accessToken), body: { target_user_id: userId, target_club_ids: clubIds } });
}
