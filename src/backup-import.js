const SECTIONS = new Set(['screen', 'book', 'game']);
const TYPES = new Set(['film', 'television', 'book', 'game']);

export const BACKUP_IMPORT_LIMITS = Object.freeze({
  bytes: 25 * 1024 * 1024,
  shelves: 500,
  media: 10000,
});

export function validateCollectionBackup(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) throw new Error('This is not a Media Room backup file.');
  if (backup.format !== 'media-room/v1') throw new Error('This backup uses an unsupported format.');
  if (!backup.collection || typeof backup.collection !== 'object') throw new Error('The backup is missing its collection details.');
  if (!Array.isArray(backup.shelves) || !Array.isArray(backup.media)) throw new Error('The backup is missing its shelves or media.');
  if (backup.shelves.length > BACKUP_IMPORT_LIMITS.shelves || backup.media.length > BACKUP_IMPORT_LIMITS.media) throw new Error('This backup is too large to import safely.');

  const shelfIds = new Set();
  for (const shelf of backup.shelves) {
    const shelfId = String(shelf?.shelf_id || '').trim();
    if (!shelfId || !SECTIONS.has(shelf?.section) || !String(shelf?.name || '').trim()) throw new Error('The backup contains an invalid shelf.');
    if (shelfIds.has(shelfId)) throw new Error('The backup contains a duplicate shelf.');
    shelfIds.add(shelfId);
  }

  const mediaIds = new Set();
  for (const item of backup.media) {
    const itemId = String(item?.item_id || item?.database_id || '').trim();
    if (!itemId || !TYPES.has(item?.type) || !String(item?.title || '').trim()) throw new Error('The backup contains an invalid media item.');
    if (mediaIds.has(itemId)) throw new Error('The backup contains a duplicate media item.');
    if (item.lists != null && !Array.isArray(item.lists)) throw new Error('The backup contains invalid shelf membership.');
    mediaIds.add(itemId);
  }

  return { backup, shelfCount: backup.shelves.length, mediaCount: backup.media.length };
}

export function parseCollectionBackup(text) {
  try {
    return validateCollectionBackup(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('That file does not contain valid JSON.');
    throw error;
  }
}
