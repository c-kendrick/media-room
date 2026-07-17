function normalizedWatchType(value) {
  const type = String(value || '').trim().toLocaleLowerCase();
  if (['movie', 'movies', 'film', 'films'].includes(type)) return 'film';
  if (['tv', 'television', 'series', 'show'].includes(type)) return 'television';
  return type;
}

function normalizedWatchTitle(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^(the|a|an)\s+/, '');
}

function watchBaseIdentity(item) {
  return [normalizedWatchType(item.type), normalizedWatchTitle(item.title)].join('|');
}

export function watchIdentity(item) {
  return [watchBaseIdentity(item), item.year ?? ''].join('|');
}

export function buildWatchGroupIdentities(mediaItems) {
  const itemsByBase = new Map();
  for (const item of mediaItems) {
    const base = watchBaseIdentity(item);
    const items = itemsByBase.get(base) || [];
    items.push(item);
    itemsByBase.set(base, items);
  }

  const identityByMediaId = new Map();
  for (const [base, items] of itemsByBase) {
    const knownYears = [...new Set(items.map((item) => Number(item.year) || null).filter(Boolean))];
    for (const item of items) {
      const year = Number(item.year) || null;
      const yearGroup = knownYears.length <= 1 ? (knownYears[0] || '') : (year || 'unknown');
      identityByMediaId.set(item.id, `${base}|${yearGroup}`);
    }
  }
  return identityByMediaId;
}

export function buildWatchDemand(mediaItems, collections, interests, profiles) {
  const collectionById = new Map(collections.map((collection) => [collection.id, collection]));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const identityByMediaId = buildWatchGroupIdentities(mediaItems);
  const peopleByIdentity = new Map();
  const add = (identity, personId) => {
    if (!identity || !personId) return;
    const people = peopleByIdentity.get(identity) || new Set();
    people.add(personId);
    peopleByIdentity.set(identity, people);
  };

  for (const item of mediaItems) add(identityByMediaId.get(item.id), collectionById.get(item.collection_id)?.owner_id);
  for (const interest of interests) add(identityByMediaId.get(interest.media_item_id), interest.user_id);

  return new Map(mediaItems.map((item) => {
    const people = [...(peopleByIdentity.get(identityByMediaId.get(item.id)) || [])].map((id) => {
      const profile = profileById.get(id);
      const collection = collections.find((entry) => entry.owner_id === id);
      const fallbackName = collection?.title?.replace(/['\u2019]s Collection$/i, '') || 'Member';
      return profile || { id, username: `member-${String(id).slice(0, 8)}`, display_name: fallbackName };
    });
    return [item.id, people];
  }));
}
