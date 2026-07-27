import { supabaseRequest } from './supabase.js';

function normalizedReactionType(value) {
  const type = String(value || '').trim().toLocaleLowerCase();
  if (['movie', 'movies', 'film', 'films'].includes(type)) return 'film';
  if (['tv', 'television', 'series', 'show'].includes(type)) return 'television';
  return type;
}

function normalizedReactionTitle(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(the|a|an)\s+/, '');
}

export function mediaReactionIdentity(item) {
  return [normalizedReactionType(item?.type), normalizedReactionTitle(item?.title), item?.year ?? ''].join('|');
}

export function priorityInterestPresentation({
  interestPeople,
  priorityPeople = [],
  watchlistedPeople = [],
}) {
  if (!Array.isArray(interestPeople)) {
    const names = priorityPeople.map((person) => person.display_name || person.username).filter(Boolean);
    return {
      count: priorityPeople.length,
      detailed: false,
      tooltip: ['Priority Watch Stamp', ...names].join('\n'),
    };
  }

  const namedPeople = (people) => people
    .map((person) => ({
      id: person.id,
      name: person.display_name || person.username,
    }))
    .filter((person) => person.name);
  const priorityNames = namedPeople(priorityPeople);
  const priorityIds = new Set(priorityNames.map((person) => person.id));
  const watchlistedNames = namedPeople(watchlistedPeople)
    .map((person) => ({ ...person, muted: priorityIds.has(person.id) }))
    .sort((left, right) => Number(left.muted) - Number(right.muted));
  const countedWatchlisted = watchlistedNames.filter((person) => !person.muted);

  return {
    count: interestPeople.length,
    detailed: true,
    priorityNames,
    watchlistedNames,
    watchlistedCount: countedWatchlisted.length,
    tooltip: [
      `Interest: ${interestPeople.length}`,
      `Priority Stamps: ${priorityPeople.length}`,
      ...priorityNames.map((person) => person.name),
      '',
      `Watchlisted: ${countedWatchlisted.length}`,
      ...watchlistedNames.map((person) => person.name),
    ].join('\n'),
  };
}

export function setMediaReaction(accessToken, mediaItemId, kind, enabled) {
  if (!accessToken || !mediaItemId || !['like', 'priority'].includes(kind)) {
    throw new Error('An approved signed-in account and valid reaction are required.');
  }
  return supabaseRequest('/rest/v1/rpc/set_media_reaction', {
    method: 'POST',
    fresh: true,
    body: { target_media_item_id: mediaItemId, reaction_kind: kind, reaction_enabled: enabled },
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
  });
}

export function setMediaLoveBatch(accessToken, changes) {
  const reactions = (changes || [])
    .filter((change) => change?.mediaItemId)
    .map((change) => ({ media_item_id: change.mediaItemId, enabled: Boolean(change.enabled) }));
  if (!accessToken || !reactions.length) {
    throw new Error('An approved signed-in account and at least one love are required.');
  }
  return supabaseRequest('/rest/v1/rpc/set_media_love_batch', {
    method: 'POST',
    fresh: true,
    body: { reaction_changes: reactions },
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
  });
}

export function applyReactionToSnapshot(snapshot, targetItem, kind, enabled, person) {
  const field = kind === 'like' ? 'likes' : 'priorities';
  const targetIdentity = mediaReactionIdentity(targetItem);
  return {
    ...snapshot,
    media: snapshot.media.map((item) => {
      if (mediaReactionIdentity(item) !== targetIdentity) return item;
      const people = (item[field] || []).filter((entry) => entry.id !== person.id);
      return { ...item, [field]: enabled ? [...people, person] : people };
    }),
  };
}
