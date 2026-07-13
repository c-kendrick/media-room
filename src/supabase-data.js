import { supabaseSelect } from './supabase.js';

function query(table, parameters) {
  return table + '?' + new URLSearchParams(parameters).toString();
}

function mapSnapshot(collection, shelves, mediaItems, memberships, interests = [], publicProfiles = []) {
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
    collectionDescription: collection.description || '',
    mediaShelves: shelves.map((shelf) => ({
      shelf_id: shelf.id,
      name: shelf.name,
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

export async function loadPublicCollections({ fresh = false } = {}) {
  try {
    return await supabaseSelect(query('collections', { select: 'id,owner_id,title,slug,description,position', order: 'position.asc,title.asc' }), { fresh });
  } catch {
    try {
      return await supabaseSelect(query('collections', { select: 'id,owner_id,title,slug,description', order: 'title.asc' }), { fresh });
    } catch {
      return supabaseSelect(query('collections', { select: 'id,owner_id,title,slug', order: 'title.asc' }), { fresh });
    }
  }
}

export async function loadCollectionFromSupabase({ collectionId, fresh = false } = {}) {
  const collectionFilter = {
    ...(collectionId ? { id: 'eq.' + collectionId } : { slug: 'eq.kits-collection' }),
    limit: '1',
  };
  let collections;
  try {
    collections = await supabaseSelect(query('collections', { ...collectionFilter, select: 'id,owner_id,title,description,updated_at' }), { fresh });
  } catch {
    collections = await supabaseSelect(query('collections', { ...collectionFilter, select: 'id,owner_id,title,updated_at' }), { fresh });
  }

  const collection = collections[0];
  if (!collection) return null;

  const shelvesPromise = supabaseSelect(query('shelves', {
    collection_id: 'eq.' + collection.id,
    select: 'id,section,name,position,deleted_at,is_required,show_in_main_watchlist,main_watchlist_position',
    order: 'section.asc,position.asc',
  }), { fresh }).catch(() => supabaseSelect(query('shelves', {
      collection_id: 'eq.' + collection.id,
      select: 'id,section,name,position,deleted_at',
      order: 'section.asc,position.asc',
    }), { fresh }));
  const [shelves, mediaItems] = await Promise.all([
    shelvesPromise,
    supabaseSelect(query('media_items', {
      collection_id: 'eq.' + collection.id,
      select: 'id,legacy_id,type,title,year,status,priority,notes,poster_url,creator,director,description,format,platforms,genres,rating,runtime,deleted_at,created_at,updated_at',
      order: 'created_at.asc',
    }), { fresh }),
  ]);

  const memberships = shelves.length
    ? await supabaseSelect(query('shelf_media_items', {
      shelf_id: 'in.(' + shelves.map((shelf) => shelf.id).join(',') + ')',
      select: 'shelf_id,media_item_id,position',
      order: 'position.asc',
    }), { fresh })
    : [];

  // Do not put every media UUID into an `in.(...)` URL parameter. A large
  // collection exceeds common URL limits and makes the whole snapshot fall
  // back to static data. Interest markers are a small public relation, so
  // retrieve them once and associate them in mapSnapshot instead.
  const interests = mediaItems.length ? await supabaseSelect(query('media_interest', {
    select: 'media_item_id,user_id',
  }), { fresh }) : [];
  const publicProfiles = interests.length ? await supabaseSelect(query('public_profiles', { select: 'id,username,display_name' }), { fresh }) : [];
  return mapSnapshot(collection, shelves, mediaItems, memberships, interests, publicProfiles);
}

export async function loadMainWatchlistFromSupabase({ fresh = false } = {}) {
  const collections = await loadPublicCollections({ fresh });
  if (!collections.length) return null;

  const collectionIds = collections.map((collection) => collection.id);
  let shelves;
  try {
    shelves = await supabaseSelect(query('shelves', {
      collection_id: 'in.(' + collectionIds.join(',') + ')',
      show_in_main_watchlist: 'eq.true',
      deleted_at: 'is.null',
      select: 'id,collection_id,section,name,position,deleted_at,show_in_main_watchlist,main_watchlist_position',
      order: 'main_watchlist_position.asc',
    }), { fresh });
  } catch {
    shelves = await supabaseSelect(query('shelves', {
      collection_id: 'in.(' + collectionIds.join(',') + ')',
      section: 'eq.screen',
      name: 'eq.Watchlist',
      deleted_at: 'is.null',
      select: 'id,collection_id,section,name,position,deleted_at',
    }), { fresh });
  }
  const shelfIds = shelves.map((shelf) => shelf.id);
  const memberships = shelfIds.length ? await supabaseSelect(query('shelf_media_items', {
    shelf_id: 'in.(' + shelfIds.join(',') + ')',
    select: 'shelf_id,media_item_id,position',
    order: 'position.asc',
  }), { fresh }) : [];
  const mediaIds = memberships.map((membership) => membership.media_item_id);
  const mediaItems = mediaIds.length ? await supabaseSelect(query('media_items', {
    id: 'in.(' + mediaIds.join(',') + ')',
    deleted_at: 'is.null',
    select: 'id,legacy_id,collection_id,type,title,year,status,priority,notes,poster_url,creator,director,description,format,platforms,genres,rating,runtime,deleted_at,created_at,updated_at',
    order: 'created_at.asc',
  }), { fresh }) : [];
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
  const interests = mirroredMediaItems.length ? await supabaseSelect(query('media_interest', {
    select: 'media_item_id,user_id',
  }), { fresh }) : [];
  const publicProfiles = interests.length ? await supabaseSelect(query('public_profiles', { select: 'id,username,display_name' }), { fresh }) : [];
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
  const snapshot = mapSnapshot(
    { id: 'main-watchlist', owner_id: null, title: 'Main Watchlist', description: 'Every selected shelf, mirrored live from its owner’s collection.', updated_at: new Date().toISOString() },
    groupedShelves.map((shelf) => {
      const collection = collectionById.get(shelf.collection_id);
      const ownerName = collection?.title?.replace(/[’']s Collection$/i, '') || 'Member';
      return { ...shelf, section: 'screen', source_section: shelf.section, source_collection_id: shelf.collection_id, owner_name: ownerName, owner_note: collection?.description || '', position: shelf.main_watchlist_position ?? shelf.position };
    }),
    mirroredMediaItems,
    mirroredMemberships,
    interests,
    publicProfiles,
  );
  return { ...snapshot, mainWatchlist: true };
}

export const loadKitCollectionFromSupabase = (options) => loadCollectionFromSupabase(options);
