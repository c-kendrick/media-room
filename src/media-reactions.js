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

export function qualifyingInterestCount(interestCount, priorityCount) {
  return priorityCount > 0 || interestCount > 1 ? interestCount : 0;
}

export function applyMainWatchlistInterest(snapshot, mainWatchlist) {
  if (!snapshot?.media?.length || snapshot.mainWatchlist || !mainWatchlist?.media?.length) return snapshot;
  const includedShelfIds = new Set(
    (snapshot.mediaShelves || [])
      .filter((shelf) => !shelf.deleted_at && shelf.showInMainWatchlist)
      .map((shelf) => shelf.shelf_id),
  );
  if (!includedShelfIds.size) return snapshot;

  const mainItemByIdentity = new Map(
    mainWatchlist.media.map((item) => [mediaReactionIdentity(item), item]),
  );
  let changed = false;
  const media = snapshot.media.map((item) => {
    if (!(item.lists || []).some((shelfId) => includedShelfIds.has(shelfId))) return item;
    const mainItem = mainItemByIdentity.get(mediaReactionIdentity(item));
    if (!mainItem?.watchDemand) return item;
    changed = true;
    return {
      ...item,
      watchDemand: mainItem.watchDemand,
      watchlistedBy: mainItem.watchlistedBy || [],
      interestPriorities: mainItem.priorities || [],
      demandCount: mainItem.demandCount,
    };
  });
  return changed ? { ...snapshot, media } : snapshot;
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
  const priorityIds = new Set(priorityPeople.map((person) => person.id).filter(Boolean));
  const priorityCount = priorityPeople.length;
  const count = qualifyingInterestCount(interestPeople.length, priorityCount);
  const interestQualifies = count > 0;
  const watchlistedNames = namedPeople(watchlistedPeople)
    .map((person) => ({
      ...person,
      muted: priorityIds.has(person.id) || !interestQualifies,
    }))
    .sort((left, right) => Number(left.muted) - Number(right.muted));
  const countedWatchlisted = watchlistedNames.filter((person) => !person.muted);

  return {
    count,
    detailed: true,
    priorityCount,
    priorityNames,
    watchlistedNames,
    watchlistedCount: countedWatchlisted.length,
    tooltip: [
      `Interest: ${count}`,
      `Priority Stamps: ${priorityCount}`,
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
