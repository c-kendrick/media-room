export const LIBRARY_TYPES = ['screen', 'book', 'game', 'other'];

export const LIBRARY_TYPE_DETAILS = {
  screen: { label: 'Film & TV', singular: 'Title', plural: 'Titles', creator: 'Director', mediaTypes: ['film', 'television'] },
  book: { label: 'Books', singular: 'Book', plural: 'Books', creator: 'Author', mediaTypes: ['book'] },
  game: { label: 'Video Games', singular: 'Game', plural: 'Games', creator: 'Developer', mediaTypes: ['game'] },
  other: { label: 'Other', singular: 'Item', plural: 'Items', creator: 'Creator', mediaTypes: ['other'] },
};

export function libraryDefaults(type) {
  return LIBRARY_TYPE_DETAILS[type] || LIBRARY_TYPE_DETAILS.other;
}

export function libraryTypeForMedia(mediaType) {
  if (mediaType === 'book') return 'book';
  if (mediaType === 'game') return 'game';
  if (mediaType === 'other') return 'other';
  return 'screen';
}

export function defaultMediaTypeForLibrary(type) {
  return type === 'screen' ? 'film' : type === 'book' ? 'book' : type === 'game' ? 'game' : 'other';
}

export function bulkImportTerminology(mediaType, library) {
  const type = library?.type || libraryTypeForMedia(mediaType);
  const defaults = libraryDefaults(type);
  const singular = String(library?.singular || defaults.singular).trim();
  const plural = String(library?.plural || defaults.plural).trim();
  const usesCustomTerms = singular !== defaults.singular || plural !== defaults.plural;
  const technical = {
    film: { heading: 'Film', singular: 'Film', plural: 'Films' },
    television: { heading: 'Television', singular: 'TV Show', plural: 'TV Shows' },
    book: { heading: 'Books', singular: 'Book', plural: 'Books' },
    game: { heading: 'Video Games', singular: 'Video Game', plural: 'Video Games' },
  }[mediaType] || { heading: plural, singular, plural };

  if (!usesCustomTerms) return technical;
  return {
    heading: type === 'screen' ? `${plural} (${technical.heading})` : plural,
    singular,
    plural,
  };
}

export function normalizeLibrary(row) {
  if (!row) return null;
  return {
    id: row.id,
    collectionId: row.collection_id || row.collectionId,
    name: row.name,
    type: row.type,
    protected: Boolean(row.is_protected ?? row.protected),
    position: Number(row.position || 0),
    singular: row.item_term_singular || row.singular,
    plural: row.item_term_plural || row.plural,
    creator: row.creator_term || row.creator,
    deleted_at: row.deleted_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function sortLibraries(libraries) {
  return [...(libraries || [])].sort((left, right) => (
    Number(right.protected) - Number(left.protected)
    || left.position - right.position
    || String(left.created_at || '').localeCompare(String(right.created_at || ''))
    || left.id.localeCompare(right.id)
  ));
}

export function filmLibrary(libraries) {
  return sortLibraries(libraries).find((library) => library.protected && library.type === 'screen')
    || sortLibraries(libraries).find((library) => library.type === 'screen')
    || sortLibraries(libraries)[0]
    || null;
}

export function chooseLibrary(libraries, requestedId, rememberedId) {
  const active = sortLibraries(libraries).filter((library) => !library.deleted_at);
  return active.find((library) => library.id === requestedId)
    || active.find((library) => library.id === rememberedId)
    || filmLibrary(active);
}

export function validateLibraryDraft(draft, libraries = [], currentId = null) {
  const errors = {};
  const name = String(draft?.name || '').trim();
  const singular = String(draft?.singular || '').trim();
  const plural = String(draft?.plural || '').trim();
  const creator = String(draft?.creator || '').trim();
  if (!name) errors.name = 'Enter a library name.';
  else if (name.length > 50) errors.name = 'Use 50 characters or fewer.';
  else if (libraries.some((library) => library.id !== currentId && !library.deleted_at && library.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
    errors.name = 'Library names must be unique within this collection.';
  }
  if (!LIBRARY_TYPES.includes(draft?.type)) errors.type = 'Choose a library type.';
  if (!singular) errors.singular = 'Enter the singular item term.';
  if (!plural) errors.plural = 'Enter the plural item term.';
  if (!creator) errors.creator = 'Enter the creator term.';
  return { valid: Object.keys(errors).length === 0, errors, values: { name, type: draft?.type, singular, plural, creator } };
}

export function copiedShelfName(name, destinationShelfNames = []) {
  const used = new Set(destinationShelfNames.map((value) => value.trim().toLocaleLowerCase()));
  let candidate = `${String(name || '').trim()} (Copy)`;
  let number = 2;
  while (used.has(candidate.toLocaleLowerCase())) {
    candidate = `${String(name || '').trim()} (Copy ${number})`;
    number += 1;
  }
  return candidate;
}

export function libraryMemoryKey(collectionId) {
  return `media-room:last-library:${collectionId}`;
}
