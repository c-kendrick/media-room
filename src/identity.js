const AVATAR_TONE_COUNT = 10;

export function personDisplayName(person, fallback = 'Member') {
  return String(person?.display_name || person?.name || person?.username || fallback).trim() || fallback;
}

export function personInitial(person, fallback = '?') {
  return Array.from(personDisplayName(person, fallback))[0]?.toUpperCase() || fallback;
}

export function avatarToneClass(person) {
  const source = String(person?.id || person?.username || personDisplayName(person, 'member'));
  let hash = 0;
  for (const character of source) hash = ((hash << 5) - hash + character.codePointAt(0)) | 0;
  return `avatar-tone-${Math.abs(hash) % AVATAR_TONE_COUNT}`;
}

export function clubInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map((word) => Array.from(word).find((character) => /[a-z0-9]/i.test(character)) || '').join('');
  return initials.toUpperCase() || '?';
}

export function collectionOwnerIdentity(collection, users = [], currentUser = null) {
  const ownerId = collection?.owner_id;
  const knownUser = currentUser?.id === ownerId ? currentUser : users.find((user) => user.id === ownerId);
  if (knownUser) return knownUser;
  const fallbackName = String(collection?.title || '').replace(/[\u2019']s Collection$/i, '').trim() || 'Member';
  return { id: ownerId, display_name: fallbackName };
}
