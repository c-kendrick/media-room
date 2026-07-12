import { readFile } from 'node:fs/promises';

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  throw new Error('Missing environment variable(s): ' + missing.join(', '));
}

const replace = process.argv.includes('--replace');
const baseUrl = process.env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
const headers = {
  apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
  'Content-Type': 'application/json',
};

function path(table, query = {}) {
  const search = new URLSearchParams(query);
  return baseUrl + '/' + table + (search.size ? '?' + search : '');
}

async function request(method, table, { query, body, prefer } = {}) {
  const response = await fetch(path(table, query), {
    method,
    headers: {
      ...headers,
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    throw new Error(method + ' ' + table + ' failed (' + response.status + '): ' + await response.text());
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function chunk(values, size = 100) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size));
}

function shelfKey(shelf) {
  return shelf.section + ':' + shelf.name;
}

const snapshot = JSON.parse(await readFile(new URL('../public/media-data.json', import.meta.url), 'utf8'));

const profiles = await request('GET', 'profiles', {
  query: { username: 'eq.christopher', select: 'id,role,approved_at', limit: '1' },
});
const owner = profiles[0];
if (!owner || owner.role !== 'admin' || !owner.approved_at) {
  throw new Error('Could not find an approved Christopher admin profile.');
}

const existingCollections = await request('GET', 'collections', {
  query: { slug: 'eq.kits-collection', select: 'id', limit: '1' },
});

if (existingCollections[0]) {
  if (!replace) {
    throw new Error('Kit’s Collection already exists. Re-run with --replace only if you deliberately want to replace it from public/media-data.json.');
  }
  await request('DELETE', 'collections', {
    query: { id: 'eq.' + existingCollections[0].id },
  });
}

const createdCollections = await request('POST', 'collections', {
  body: {
    owner_id: owner.id,
    title: 'Kit’s Collection',
    slug: 'kits-collection',
  },
  prefer: 'return=representation',
});
const collection = createdCollections[0];

const shelfRows = snapshot.mediaShelves
  .filter((shelf) => !shelf.deleted_at)
  .map((shelf) => ({
    collection_id: collection.id,
    section: shelf.section,
    name: shelf.name,
    position: Number(shelf.position || 0),
  }));

for (const rows of chunk(shelfRows)) {
  await request('POST', 'shelves', {
    body: rows,
    prefer: 'return=minimal',
  });
}

const shelves = await request('GET', 'shelves', {
  query: {
    collection_id: 'eq.' + collection.id,
    select: 'id,section,name',
  },
});
const shelfIds = new Map(shelves.map((shelf) => [shelfKey(shelf), shelf.id]));
const sourceShelfIds = new Map(snapshot.mediaShelves.map((shelf) => [shelf.shelf_id, shelf]));

const mediaRows = snapshot.media
  .filter((item) => !item.deleted_at)
  .map((item) => ({
    collection_id: collection.id,
    legacy_id: item.item_id,
    type: item.type,
    title: item.title,
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
  }));

for (const rows of chunk(mediaRows)) {
  await request('POST', 'media_items', {
    query: { on_conflict: 'collection_id,legacy_id' },
    body: rows,
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

const mediaItems = await request('GET', 'media_items', {
  query: {
    collection_id: 'eq.' + collection.id,
    select: 'id,legacy_id',
  },
});
const mediaIds = new Map(mediaItems.map((item) => [item.legacy_id, item.id]));
const membershipRows = [];

for (const item of snapshot.media.filter((entry) => !entry.deleted_at)) {
  for (const sourceShelfId of item.lists || []) {
    const sourceShelf = sourceShelfIds.get(sourceShelfId);
    const shelfId = sourceShelf && shelfIds.get(shelfKey(sourceShelf));
    const mediaItemId = mediaIds.get(item.item_id);
    if (!shelfId || !mediaItemId) continue;

    membershipRows.push({
      shelf_id: shelfId,
      media_item_id: mediaItemId,
      position: Number(item.list_positions?.[sourceShelfId] || 0),
    });
  }
}

for (const rows of chunk(membershipRows)) {
  await request('POST', 'shelf_media_items', {
    query: { on_conflict: 'shelf_id,media_item_id' },
    body: rows,
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

console.log('Imported Kit’s Collection:', {
  shelves: shelfRows.length,
  mediaItems: mediaRows.length,
  shelfMemberships: membershipRows.length,
});
