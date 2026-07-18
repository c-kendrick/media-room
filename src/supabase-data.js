import { supabaseSelect } from './supabase.js';
import { buildWatchDemand, buildWatchGroupIdentities } from './watch-demand.js';
import { SECTION_NOTE_DEFAULTS } from './section-notes.js';

const MEDIA_SELECT = 'id,legacy_id,collection_id,type,title,year,status,priority,notes,poster_url,creator,director,description,format,platforms,genres,rating,star_rating,owned,runtime,deleted_at,created_at,updated_at';
const PRE_OWNED_MEDIA_SELECT = MEDIA_SELECT.replace(',owned', '');
const LEGACY_MEDIA_SELECT = PRE_OWNED_MEDIA_SELECT.replace(',star_rating', '');

function query(table, parameters) {
  return table + '?' + new URLSearchParams(parameters).toString();
}

async function selectMediaItems(parameters, options) {
  try {
    return await supabaseSelect(query('media_items', { ...parameters, select: MEDIA_SELECT }), options);
  } catch {
    try {
      return await supabaseSelect(query('media_items', { ...parameters, select: PRE_OWNED_MEDIA_SELECT }), options);
    } catch {
      return supabaseSelect(query('media_items', { ...parameters, select: LEGACY_MEDIA_SELECT }), options);
    }
  }
}

export function mapSnapshot(collection, shelves, mediaItems, memberships, interests = [], publicProfiles = []) {
  const membershipsByItem = new Map();

  for (const membership of memberships) {
    const current = membershipsByItem.get(membership.media_item_id) || [];
    current.push(membership);
    membershipsByItem.set(membership.media_item_id, current);
  }

  return {
    generatedAt: collection.updated_at,
    storage: 'supabase',
    schemaVersion: 2,
    collectionId: collection.id,
    ownerId: collection.owner_id,
    collectionTitle: collection.title,
    collectionDescription: collection.description || SECTION_NOTE_DEFAULTS.screen,
    collectionDescriptions: {
      screen: collection.description || SECTION_NOTE_DEFAULTS.screen,
      book: collection.book_description || SECTION_NOTE_DEFAULTS.book,
      game: collection.game_description || SECTION_NOTE_DEFAULTS.game,
    },
    mediaShelves: shelves.map((shelf) => ({
      shelf_id: shelf.id,
      name: shelf.name,
      subtitle: shelf.subtitle || '',
      queueList: Boolean(shelf.is_queue_list),
      readingList: Boolean(shelf.is_queue_list),
      section: shelf.section,
      position: shelf.position,
      deleted_at: shelf.deleted_at || null,
      required: shelf.is_required ?? (shelf.section === 'screen' && shelf.name.trim().toLowerCase() === 'watchlist'),
      showInMainWatchlist: shelf.show_in_main_watchlist ?? (shelf.section === 'screen' && shelf.name.trim().toLowerCase() === 'watchlist'),
      mainWatchlistPosition: shelf.main_watchlist_position ?? shelf.position,
      ownerName: shelf.owner_name || null,
      ownerNote: shelf.owner_note || '',
      sourceCollectionId: shelf.source_collection_id || null,
      sourceSection: shelf.source_section || shelf.section,
      virtual: Boolean(shelf.virtual),
    })),
    media: mediaItems.map((item) => {
      const membership = membershipsByItem.get(item.id) || [];
      return {
        item_id: item.legacy_id || item.id,
        database_id: item.id,
        title: item.title,
        type: item.type,
        year: item.year,
        status: item.status,
        priority: item.priority,
        notes: item.notes,
        poster_url: item.poster_url,
        creator: item.creator,
        director: item.director,
        description: item.description,
        format: item.format,
        platforms: item.platforms || [],
        genres: item.genres || [],
        rating: item.rating,
        star_rating: item.star_rating ?? null,
        owned: item.owned ?? false,
        runtime: item.runtime,
        added_at: item.created_at,
        updated_at: item.updated_at,
        deleted_at: item.deleted_at || null,
        lists: membership.map((entry) => entry.shelf_id),
        list_positions: Object.fromEntries(membership.map((entry) => [entry.shelf_id, entry.position])),
        external_ids: item.external_ids || {},
        interests: interests.filter((entry) => entry.media_item_id === item.id).map((entry) => publicProfiles.find((profile) => profile.id === entry.user_id)).filter(Boolean),
      };
    }),
  };
}

export async function loadPublicCollections({ fresh = false, accessToken } = {}) {
  try {
    return await supabaseSelect(query('collections', { select: 'id,owner_id,title,slug,description,position', order: 'position.asc,title.asc' }), { fresh, accessToken });
  } catch {
    try {
      return await supabaseSelect(query('collections', { select: 'id,owner_id,title,slug,description', order: 'title.asc' }), { fresh, accessToken });
    } catch {
      return supabaseSelect(query('collections', { select: 'id,owner_id,title,slug', order: 'title.asc' }), { fresh, accessToken });
    }
  }
}

export async function loadCollectionFromSupabase({ collectionId, fresh = false, accessToken } = {}) {
  const collectionFilter = {
    ...(collectionId ? { id: 'eq.' + collectionId } : { slug: 'eq.kits-collection' }),
    limit: '1',
  };
  let collections;
  try {
    collections = await supabaseSelect(query('collections', { ...collectionFilter, select: 'id,owner_id,title,description,book_description,game_description,updated_at' }), { fresh, accessToken });
  } catch {
    try {
      collections = await supabaseSelect(query('collections', { ...collectionFilter, select: 'id,owner_id,title,description,updated_at' }), { fresh, accessToken });
    } catch {
      collections = await supabaseSelect(query('collections', { ...collectionFilter, select: 'id,owner_id,title,updated_at' }), { fresh, accessToken });
    }
  }

  const collection = collections[0];
  if (!collection) return null;

  const shelvesPromise = supabaseSelect(query('shelves', {
    collection_id: 'eq.' + collection.id,
    select: 'id,section,name,subtitle,is_queue_list,is_reading_list,position,deleted_at,is_required,show_in_main_watchlist,main_watchlist_position',
    order: 'section.asc,position.asc',
  }), { fresh, accessToken }).catch(() => supabaseSelect(query('shelves', {
      collection_id: 'eq.' + collection.id,
      select: 'id,section,name,subtitle,position,deleted_at,is_required,show_in_main_watchlist,main_watchlist_position',
      order: 'section.asc,position.asc',
    }), { fresh, accessToken })).catch(() => supabaseSelect(query('shelves', {
      collection_id: 'eq.' + collection.id,
      select: 'id,section,name,position,deleted_at',
      order: 'section.asc,position.asc',
    }), { fresh, accessToken }));
  const [shelves, mediaItems] = await Promise.all([
    shelvesPromise,
    selectMediaItems({
      collection_id: 'eq.' + collection.id,
      order: 'created_at.asc',
    }, { fresh, accessToken }),
  ]);

  const memberships = shelves.length
    ? await supabaseSelect(query('shelf_media_items', {
      shelf_id: 'in.(' + shelves.map((shelf) => shelf.id).join(',') + ')',
      select: 'shelf_id,media_item_id,position',
      order: 'position.asc',
    }), { fresh, accessToken })
    : [];

  // Do not put every media UUID into an `in.(...)` URL parameter. A large
  // collection exceeds common URL limits and makes the whole snapshot fall
  // back to static data. Interest markers are a small public relation, so
  // retrieve them once and associate them in mapSnapshot instead.
  const interests = mediaItems.length ? await supabaseSelect(query('media_interest', {
    select: 'media_item_id,user_id',
  }), { fresh, accessToken }) : [];
  const publicProfiles = collections.length ? await supabaseSelect(query('public_profiles', { select: 'id,username,display_name' }), { fresh, accessToken }) : [];
  return mapSnapshot(collection, shelves, mediaItems, memberships, interests, publicProfiles);
}

export async function loadMainWatchlistFromSupabase({ fresh = false, accessToken, ownerIds } = {}) {
  const allowedOwnerIds = Array.isArray(ownerIds) ? new Set(ownerIds) : null;
  const collections = (await loadPublicCollections({ fresh, accessToken }))
    .filter((collection) => !allowedOwnerIds || allowedOwnerIds.has(collection.owner_id));
  if (!collections.length) return null;

  const collectionIds = collections.map((collection) => collection.id);
  const publicProfiles = await supabaseSelect(query('public_profiles', { select: 'id,username,display_name' }), { fresh, accessToken });
  const visibleProfileIds = new Set(publicProfiles.map((profile) => profile.id));
  const scopedProfileIds = allowedOwnerIds
    ? new Set(collections.map((collection) => collection.owner_id))
    : visibleProfileIds;
  let shelves;
  try {
    shelves = await supabaseSelect(query('shelves', {
      collection_id: 'in.(' + collectionIds.join(',') + ')',
      show_in_main_watchlist: 'eq.true',
      section: 'eq.screen',
      deleted_at: 'is.null',
      select: 'id,collection_id,section,name,subtitle,is_queue_list,is_reading_list,position,deleted_at,show_in_main_watchlist,main_watchlist_position,is_required',
      order: 'main_watchlist_position.asc',
    }), { fresh, accessToken });
  } catch {
    try {
      shelves = await supabaseSelect(query('shelves', {
        collection_id: 'in.(' + collectionIds.join(',') + ')',
        show_in_main_watchlist: 'eq.true', section: 'eq.screen', deleted_at: 'is.null',
        select: 'id,collection_id,section,name,subtitle,position,deleted_at,show_in_main_watchlist,main_watchlist_position,is_required',
        order: 'main_watchlist_position.asc',
      }), { fresh, accessToken });
    } catch {
      shelves = await supabaseSelect(query('shelves', {
        collection_id: 'in.(' + collectionIds.join(',') + ')', section: 'eq.screen', name: 'eq.Watchlist', deleted_at: 'is.null',
        select: 'id,collection_id,section,name,position,deleted_at',
      }), { fresh, accessToken });
    }
  }
  const interestRows = (await supabaseSelect(query('media_interest', { select: 'media_item_id,user_id' }), { fresh, accessToken }))
    .filter((interest) => scopedProfileIds.has(interest.user_id));
  const candidateShelfIds = shelves.map((shelf) => shelf.id);
  const candidateMemberships = candidateShelfIds.length ? await supabaseSelect(query('shelf_media_items', {
    shelf_id: 'in.(' + candidateShelfIds.join(',') + ')',
    select: 'shelf_id,media_item_id,position',
    order: 'position.asc',
  }), { fresh, accessToken }) : [];
  const candidateMediaIds = [...new Set([...candidateMemberships.map((membership) => membership.media_item_id), ...interestRows.map((interest) => interest.media_item_id)])];
  const candidateMediaItems = candidateMediaIds.length ? await selectMediaItems({
    id: 'in.(' + candidateMediaIds.join(',') + ')',
    collection_id: 'in.(' + collectionIds.join(',') + ')',
    deleted_at: 'is.null',
    order: 'created_at.asc',
  }, { fresh, accessToken }) : [];
  const shelfIds = shelves.map((shelf) => shelf.id);
  const memberships = shelfIds.length ? await supabaseSelect(query('shelf_media_items', {
    shelf_id: 'in.(' + shelfIds.join(',') + ')',
    select: 'shelf_id,media_item_id,position',
    order: 'position.asc',
  }), { fresh, accessToken }) : [];
  const mediaIds = memberships.map((membership) => membership.media_item_id);
  const mediaItems = mediaIds.length ? await selectMediaItems({
    id: 'in.(' + mediaIds.join(',') + ')',
    deleted_at: 'is.null',
    order: 'created_at.asc',
  }, { fresh, accessToken }) : [];
  const shelfById = new Map(shelves.map((shelf) => [shelf.id, shelf]));
  const mediaById = new Map(mediaItems.map((item) => [item.id, item]));
  const mirroredMemberships = memberships.filter((membership) => {
    const shelf = shelfById.get(membership.shelf_id);
    const item = mediaById.get(membership.media_item_id);
    if (!shelf || !item) return false;
    if (shelf.section === 'screen') return item.type === 'film' || item.type === 'television';
    return item.type === shelf.section;
  });
  const mirroredMediaIds = new Set(mirroredMemberships.map((membership) => membership.media_item_id));
  const mirroredMediaItems = mediaItems.filter((item) => mirroredMediaIds.has(item.id));
  const allMediaItems = [...new Map([...mirroredMediaItems, ...candidateMediaItems].map((item) => [item.id, item])).values()];
  const interests = interestRows.filter((interest) => allMediaItems.some((item) => item.id === interest.media_item_id));
  const collectionById = new Map(collections.map((collection) => [collection.id, collection]));
  const collectionOrder = new Map(collections.map((collection, index) => [collection.id, index]));
  const mainPosition = (shelf) => {
    const position = Number(shelf.main_watchlist_position ?? shelf.position);
    return Number.isFinite(position) ? position : Number.MAX_SAFE_INTEGER;
  };
  const collectionMainPosition = new Map();
  for (const shelf of shelves) {
    const current = collectionMainPosition.get(shelf.collection_id) ?? Number.MAX_SAFE_INTEGER;
    collectionMainPosition.set(shelf.collection_id, Math.min(current, mainPosition(shelf)));
  }
  const groupedShelves = [...shelves].sort((a, b) => {
    const collectionDifference = (collectionMainPosition.get(a.collection_id) ?? Number.MAX_SAFE_INTEGER)
      - (collectionMainPosition.get(b.collection_id) ?? Number.MAX_SAFE_INTEGER);
    if (collectionDifference) return collectionDifference;
    if (a.collection_id !== b.collection_id) return (collectionOrder.get(a.collection_id) ?? 0) - (collectionOrder.get(b.collection_id) ?? 0);
    return mainPosition(a) - mainPosition(b) || Number(a.position || 0) - Number(b.position || 0) || a.name.localeCompare(b.name);
  });
  const demandByMediaId = buildWatchDemand(allMediaItems, collections, interests, publicProfiles);
  const watchlistIdentityByMediaId = buildWatchGroupIdentities(allMediaItems);
  const interestedIdentities = new Set(interests.map((interest) => watchlistIdentityByMediaId.get(interest.media_item_id)).filter(Boolean));
  const representativeByIdentity = new Map();
  for (const item of allMediaItems) {
    const identity = watchlistIdentityByMediaId.get(item.id);
    const demand = demandByMediaId.get(item.id) || [];
    if (!interestedIdentities.has(identity) && demand.length < 2) continue;
    const current = representativeByIdentity.get(identity);
    if (!current || (mirroredMediaIds.has(item.id) && !mirroredMediaIds.has(current.id))) representativeByIdentity.set(identity, item);
  }
  const virtualMediaItems = [...representativeByIdentity.values()];
  const virtualShelf = {
    id: 'main-priority-watchlist', section: 'screen', name: 'Watchlist', subtitle: 'Priority picks and titles wanted by more than one person.',
    position: -1, deleted_at: null, virtual: true,
  };
  const virtualMemberships = virtualMediaItems.map((item, index) => ({ shelf_id: virtualShelf.id, media_item_id: item.id, position: (index + 1) * 1000 }));
  const snapshot = mapSnapshot(
    { id: 'main-watchlist', owner_id: null, title: 'Main Watchlist', description: 'Every selected shelf, mirrored live from its owner’s collection.', updated_at: new Date().toISOString() },
    [virtualShelf, ...groupedShelves.map((shelf) => {
      const collection = collectionById.get(shelf.collection_id);
      const ownerName = collection?.title?.replace(/[’']s Collection$/i, '') || 'Member';
      return { ...shelf, section: 'screen', source_section: shelf.section, source_collection_id: shelf.collection_id, owner_name: ownerName, owner_note: collection?.description || SECTION_NOTE_DEFAULTS.screen, position: shelf.main_watchlist_position ?? shelf.position };
    })],
    [...new Map([...mirroredMediaItems, ...virtualMediaItems].map((item) => [item.id, item])).values()],
    [...mirroredMemberships, ...virtualMemberships],
    interests,
    publicProfiles,
  );
  return { ...snapshot, mainWatchlist: true, media: snapshot.media.map((item) => {
    const watchDemand = demandByMediaId.get(item.database_id) || [];
    return { ...item, watchDemand, demandCount: watchDemand.length };
  }) };
}

export const loadKitCollectionFromSupabase = (options) => loadCollectionFromSupabase(options);
