const DATABASE_NAME = 'media-room-cache';
const STORE_NAME = 'sections';
export const SECTION_CACHE_VERSION = 4;
export const SECTION_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

const SECTION_TYPES = {
  screen: new Set(['film', 'television']),
  book: new Set(['book']),
  game: new Set(['game']),
};

export function sectionCacheKey({ accountScope = 'public', collectionId, section, scope = 'collection' }) {
  return `media-room:v${SECTION_CACHE_VERSION}:${accountScope}:${scope}:${collectionId}:${section}`;
}

export function libraryCacheKey({ accountScope = 'public', collectionId, libraryId, scope = 'collection' }) {
  return `media-room:v${SECTION_CACHE_VERSION}:${accountScope}:${scope}:${collectionId}:library:${libraryId}`;
}

function cacheKey(options) {
  return options.libraryId ? libraryCacheKey(options) : sectionCacheKey(options);
}

export function canPersistSnapshot(snapshot) {
  return Boolean(snapshot?.storage === 'supabase' && snapshot.collectionId && !snapshot.shared);
}

export function sectionSnapshot(snapshot, section) {
  if (!canPersistSnapshot(snapshot) || !SECTION_TYPES[section]) return null;
  const shelfIds = new Set((snapshot.mediaShelves || []).filter((shelf) => shelf.section === section).map((shelf) => shelf.shelf_id));
  return {
    ...snapshot,
    loadedSections: [section],
    detailedSections: [],
    mediaShelves: (snapshot.mediaShelves || []).filter((shelf) => shelf.section === section),
    media: (snapshot.media || []).filter((item) => SECTION_TYPES[section].has(item.type)).map((item) => {
      const { notes, director, description, genres, runtime, details_loaded, ...card } = item;
      return {
        ...card,
        details_loaded: false,
        lists: (card.lists || []).filter((shelfId) => shelfIds.has(shelfId)),
        list_positions: Object.fromEntries(Object.entries(card.list_positions || {}).filter(([shelfId]) => shelfIds.has(shelfId))),
      };
    }),
  };
}

export function librarySnapshot(snapshot, libraryId) {
  if (!canPersistSnapshot(snapshot) || !libraryId) return null;
  const shelfIds = new Set((snapshot.mediaShelves || []).filter((shelf) => shelf.library_id === libraryId).map((shelf) => shelf.shelf_id));
  return {
    ...snapshot,
    selectedLibrary: (snapshot.libraries || []).find((library) => library.id === libraryId) || snapshot.selectedLibrary,
    loadedLibraries: [libraryId],
    detailedSections: [],
    mediaShelves: (snapshot.mediaShelves || []).filter((shelf) => shelf.library_id === libraryId),
    media: (snapshot.media || []).filter((item) => item.library_id === libraryId).map((item) => {
      const { notes, director, description, genres, runtime, details_loaded, ...card } = item;
      return {
        ...card,
        details_loaded: false,
        lists: (card.lists || []).filter((shelfId) => shelfIds.has(shelfId)),
        list_positions: Object.fromEntries(Object.entries(card.list_positions || {}).filter(([shelfId]) => shelfIds.has(shelfId))),
      };
    }),
  };
}

function openDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, SECTION_CACHE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(STORE_NAME)
        ? request.transaction.objectStore(STORE_NAME)
        : database.createObjectStore(STORE_NAME, { keyPath: 'key' });
      if (!store.indexNames.contains('accountScope')) store.createIndex('accountScope', 'accountScope');
      if (!store.indexNames.contains('collectionId')) store.createIndex('collectionId', 'collectionId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, operation) {
  const database = await openDatabase();
  if (!database) return null;
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const store = transaction.objectStore(STORE_NAME);
      let result;
      try { result = operation(store); } catch (error) { reject(error); return; }
      transaction.oncomplete = () => resolve(result?.result ?? result ?? null);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function readCachedSection(options) {
  const key = cacheKey(options);
  const entry = await withStore('readonly', (store) => store.get(key)).catch(() => null);
  if (!entry || entry.version !== SECTION_CACHE_VERSION) return null;
  const age = Date.now() - Number(entry.cachedAt || 0);
  if (age > SECTION_CACHE_MAX_AGE) {
    void deleteCachedSection(options);
    return null;
  }
  return { snapshot: entry.snapshot, cachedAt: entry.cachedAt, stale: age > 5 * 60 * 1000 };
}

export async function writeCachedSection(options, snapshot) {
  const compact = options.libraryId ? librarySnapshot(snapshot, options.libraryId) : sectionSnapshot(snapshot, options.section);
  if (!compact) return false;
  const entry = {
    key: cacheKey(options),
    version: SECTION_CACHE_VERSION,
    accountScope: options.accountScope || 'public',
    collectionId: options.collectionId,
    section: options.section,
    libraryId: options.libraryId || null,
    scope: options.scope || 'collection',
    cachedAt: Date.now(),
    snapshot: compact,
  };
  await withStore('readwrite', (store) => store.put(entry)).catch(() => null);
  return true;
}

export async function writeCachedSnapshot({ accountScope = 'public', scope = 'collection' } = {}, snapshot) {
  if (!canPersistSnapshot(snapshot)) return false;
  const libraryWrites = (snapshot.loadedLibraries || []).map((libraryId) => writeCachedSection({
    accountScope,
    collectionId: snapshot.collectionId,
    libraryId,
    scope,
  }, snapshot));
  const sectionWrites = (snapshot.loadedSections || []).map((section) => writeCachedSection({
    accountScope,
    collectionId: snapshot.collectionId,
    section,
    scope,
  }, snapshot));
  await Promise.all([...libraryWrites, ...sectionWrites]);
  return true;
}

export async function deleteCachedSection(options) {
  await withStore('readwrite', (store) => store.delete(cacheKey(options))).catch(() => null);
}

export async function clearCachedAccount(accountScope) {
  await withStore('readwrite', (store) => {
    const request = store.index('accountScope').openCursor(IDBKeyRange.only(accountScope));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    return request;
  }).catch(() => null);
}
