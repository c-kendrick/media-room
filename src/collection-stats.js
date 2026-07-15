const WATCHING_SHELF_NAMES = new Set(['watchlist', 'currently reading', 'reading list', 'wishlist', 'to buy', 'to read']);

export function collectionSummaryStats(items = [], shelves = []) {
  const watchShelfIds = new Set(shelves.filter((shelf) => shelf.required || WATCHING_SHELF_NAMES.has(String(shelf.name || '').trim().toLowerCase())).map((shelf) => shelf.shelf_id));
  return {
    toWatchRead: items.filter((item) => item.lists?.some((shelfId) => watchShelfIds.has(shelfId))).length,
    owned: items.filter((item) => item.owned).length,
  };
}
