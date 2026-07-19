import { SUPABASE_PUBLISHABLE_KEY, supabaseRequest } from './supabase.js';

const SESSION_KEY = 'kits-media-auth-session';
const DEFAULT_PUBLIC_SITE_URL = 'https://c-kendrick.github.io/media-room/';

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

export function appSiteUrl() {
  return new URL(import.meta.env?.VITE_PUBLIC_SITE_URL || DEFAULT_PUBLIC_SITE_URL).toString();
}

function appAuthUrl(mode) {
  const url = new URL(appSiteUrl());
  url.searchParams.set('auth', mode);
  return url.toString();
}

export function signupRateLimitDetails(error) {
  const message = String(error?.message || '');
  const limited = error?.status === 429 || error?.code === 'over_email_send_rate_limit' || /rate.?limit|too many requests|email.*limit/i.test(message);
  const suppliedRetry = Number(error?.retryAfter);
  return {
    limited,
    retryAfter: limited && Number.isFinite(suppliedRetry) && suppliedRetry > 0 ? Math.ceil(suppliedRetry) : 0,
  };
}

export function consumeRecoverySessionFromUrl() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  if (params.get('type') !== 'recovery' || !params.get('access_token')) return false;
  const expiresIn = Number(params.get('expires_in')) || 3600;
  storeSession({ access_token: params.get('access_token'), refresh_token: params.get('refresh_token'), token_type: params.get('token_type') || 'bearer', expires_in: expiresIn, expires_at: Math.floor(Date.now() / 1000) + expiresIn });
  window.history.replaceState({}, '', appAuthUrl('recovery'));
  return true;
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

const PROFILE_COLUMNS = 'id,username,display_name,role,approved_at,deactivated_at';

export function authenticatedProfilePath(userId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(userId || ''))) {
    throw new Error('Supabase Auth did not return a valid user identity.');
  }
  return `/rest/v1/profiles?select=${PROFILE_COLUMNS}&id=eq.${encodeURIComponent(userId)}&limit=1`;
}

export function selectAuthenticatedProfile(authUser, profiles) {
  const profile = profiles?.[0] || null;
  if (!authUser?.id || !profile || profile.id !== authUser.id) {
    throw new Error('The authenticated user profile could not be verified.');
  }
  return profile;
}

async function fetchProfile(accessToken) {
  const authUser = await authRequest('user', { method: 'GET', accessToken });
  const options = { fresh: true, headers: { Authorization: 'Bearer ' + accessToken } };
  const profiles = await supabaseRequest(authenticatedProfilePath(authUser?.id), options);
  return selectAuthenticatedProfile(authUser, profiles);
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
  try {
    const profile = await fetchProfile(session.access_token);
    storeSession(session);
    return { session, profile };
  } catch (error) {
    storeSession(null);
    throw error;
  }
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
  const result = await authRequest('signup?redirect_to=' + encodeURIComponent(appAuthUrl('signin')), {
    body: {
      email,
      password,
      data: { username, display_name: displayName },
    },
  });
  if (result.session) storeSession(result.session);
  return result;
}

export async function requestPasswordRecovery(email) {
  try {
    await authRequest('recover?redirect_to=' + encodeURIComponent(appAuthUrl('recovery')), { body: { email } });
  } catch { /* Always acknowledge generically so account existence is private. */ }
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
