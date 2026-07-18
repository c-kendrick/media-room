import { supabaseRequest } from './supabase.js';

function rpc(accessToken, name, body = {}) {
  return supabaseRequest('/rest/v1/rpc/' + name, {
    method: 'POST', fresh: true, body,
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const loadUserHub = (token) => rpc(token, 'list_user_hub');
export const requestFriend = (token, userId) => rpc(token, 'request_friend', { target_user_id: userId });
export const requestFriendFromShare = (token, shareToken) => rpc(token, 'request_friend_from_share', { share_token: shareToken });
export const respondFriendRequest = (token, requestId, accept) => rpc(token, 'respond_friend_request', { request_id: requestId, accept_request: accept });
export const cancelFriendRequest = (token, userId) => rpc(token, 'cancel_friend_request', { target_user_id: userId });
export const unfriend = (token, userId) => rpc(token, 'unfriend', { target_user_id: userId });
export const createMemberClub = (token, name) => rpc(token, 'create_member_club', { club_name: name });
export const inviteToClub = (token, clubId, userId) => rpc(token, 'invite_to_club', { target_club_id: clubId, target_user_id: userId });
export const respondClubInvitation = (token, invitationId, accept) => rpc(token, 'respond_club_invitation', { invitation_id: invitationId, accept_invitation: accept });
export const transferClubOwnership = (token, clubId, userId) => rpc(token, 'transfer_club_ownership', { target_club_id: clubId, target_user_id: userId });
export const leaveClub = (token, clubId) => rpc(token, 'leave_club', { target_club_id: clubId });
