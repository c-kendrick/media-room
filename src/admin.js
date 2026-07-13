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
