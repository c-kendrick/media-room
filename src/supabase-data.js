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
    mediaShelves: shelves.map((shelf) => ({
      shelf_id: shelf.id,
      name: shelf.name,
      section: shelf.section,
      position: shelf.position,
      deleted_at: shelf.deleted_at || null,
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
  return supabaseSelect(query('collections', { select: 'id,owner_id,title,slug', order: 'title.asc' }), { fresh });
}

export async function loadCollectionFromSupabase({ collectionId, fresh = false } = {}) {
  const collections = await supabaseSelect(query('collections', {
    ...(collectionId ? { id: 'eq.' + collectionId } : { slug: 'eq.kits-collection' }),
    select: 'id,owner_id,title,updated_at',
    limit: '1',
  }), { fresh });

  const collection = collections[0];
  if (!collection) return null;

  const [shelves, mediaItems] = await Promise.all([
    supabaseSelect(query('shelves', {
      collection_id: 'eq.' + collection.id,
      select: 'id,section,name,position,deleted_at',
      order: 'section.asc,position.asc',
    }), { fresh }),
    supabaseSelect(query('media_items', {
      collection_id: 'eq.' + collection.id,
      select: 'id,legacy_id,type,title,year,status,priority,notes,poster_url,creator,director,description,format,platforms,genres,rating,runtime,external_ids,deleted_at,created_at,updated_at',
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

  const interests = mediaItems.length ? await supabaseSelect(query('media_interest', {
    media_item_id: 'in.(' + mediaItems.map((item) => item.id).join(',') + ')',
    select: 'media_item_id,user_id',
  }), { fresh }) : [];
  const publicProfiles = interests.length ? await supabaseSelect(query('public_profiles', { select: 'id,username,display_name' }), { fresh }) : [];
  return mapSnapshot(collection, shelves, mediaItems, memberships, interests, publicProfiles);
}

export const loadKitCollectionFromSupabase = (options) => loadCollectionFromSupabase(options);

