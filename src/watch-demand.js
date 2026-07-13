export function watchIdentity(item) {
  return [item.type, String(item.title || '').trim().toLocaleLowerCase(), item.year ?? ''].join('|');
}

export function buildWatchDemand(mediaItems, collections, interests, profiles) {
  const collectionById = new Map(collections.map((collection) => [collection.id, collection]));
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const identityByMediaId = new Map(mediaItems.map((item) => [item.id, watchIdentity(item)]));
  const peopleByIdentity = new Map();
  const add = (identity, personId) => {
    if (!identity || !personId) return;
    const people = peopleByIdentity.get(identity) || new Set();
    people.add(personId);
    peopleByIdentity.set(identity, people);
  };

  for (const item of mediaItems) add(watchIdentity(item), collectionById.get(item.collection_id)?.owner_id);
  for (const interest of interests) add(identityByMediaId.get(interest.media_item_id), interest.user_id);

  return new Map(mediaItems.map((item) => {
    const people = [...(peopleByIdentity.get(watchIdentity(item)) || [])].map((id) => {
      const profile = profileById.get(id);
      const collection = collections.find((entry) => entry.owner_id === id);
      const fallbackName = collection?.title?.replace(/['\u2019]s Collection$/i, '') || 'Member';
      return profile || { id, username: `member-${String(id).slice(0, 8)}`, display_name: fallbackName };
    });
    return [item.id, people];
  }));
}
