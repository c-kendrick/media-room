import { SUPABASE_PUBLISHABLE_KEY, supabaseRequest } from './supabase.js';

const SESSION_KEY = 'kits-media-auth-session';

function readStoredSession() {
  try {
    return JSON.parse(window.localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function storeSession(session) {
  if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else window.localStorage.removeItem(SESSION_KEY);
}

async function authRequest(path, { method = 'POST', body, accessToken } = {}) {
  return supabaseRequest('/auth/v1/' + path, {
    method,
    fresh: true,
    body,
    headers: {
      Authorization: 'Bearer ' + (accessToken || SUPABASE_PUBLISHABLE_KEY),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
  });
}

async function refreshSession(session) {
  if (!session?.refresh_token) return null;
  const refreshed = await authRequest('token?grant_type=refresh_token', {
    body: { refresh_token: session.refresh_token },
  });
  return refreshed;
}

async function fetchProfile(accessToken) {
  const options = { fresh: true, headers: { Authorization: 'Bearer ' + accessToken } };
  let profiles;
  try {
    profiles = await supabaseRequest('/rest/v1/profiles?select=id,username,display_name,role,approved_at,deactivated_at&limit=1', options);
  } catch {
    profiles = await supabaseRequest('/rest/v1/profiles?select=id,username,display_name,role,approved_at&limit=1', options);
  }
  return profiles?.[0] || null;
}

export async function loadAuthenticatedAccount() {
  let session = readStoredSession();
  if (!session?.access_token) return null;

  const expiresSoon = !session.expires_at || session.expires_at * 1000 < Date.now() + 60_000;
  if (expiresSoon) {
    try {
      session = await refreshSession(session);
      storeSession(session);
    } catch {
      storeSession(null);
      return null;
    }
  }

  try {
    return { session, profile: await fetchProfile(session.access_token) };
  } catch {
    storeSession(null);
    return null;
  }
}

export async function signInWithPassword(email, password) {
  const session = await authRequest('token?grant_type=password', {
    body: { email, password },
  });
  storeSession(session);
  return { session, profile: await fetchProfile(session.access_token) };
}

export async function signOut() {
  const session = readStoredSession();
  try {
    if (session?.access_token) {
      await authRequest('logout', { accessToken: session.access_token });
    }
  } finally {
    storeSession(null);
  }
}

export async function registerWithPassword({ email, password, username, displayName }) {
  const result = await authRequest('signup', {
    body: {
      email,
      password,
      data: { username, display_name: displayName },
    },
  });
  if (result.session) storeSession(result.session);
  return result;
}

export async function updateDisplayName(accessToken, displayName) {
  await supabaseRequest('/rest/v1/rpc/update_own_display_name', {
    method: 'POST',
    fresh: true,
    body: { new_display_name: displayName },
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
  });
  return fetchProfile(accessToken);
}

export async function updatePassword(accessToken, password) {
  return authRequest('user', {
    method: 'PUT',
    accessToken,
    body: { password },
  });
}
