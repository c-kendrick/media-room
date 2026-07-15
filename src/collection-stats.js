const GAME_QUEUE_NAMES = new Set(['to play', 'backlog', 'wishlist']);

export function collectionSummaryStats(items = [], shelves = [], section = 'screen') {
  const queueShelfIds = new Set(shelves.filter((shelf) => {
    const name = String(shelf.name || '').trim().toLowerCase();
    if (section === 'screen') return shelf.required || name === 'watchlist';
    if (section === 'book') return shelf.readingList ?? ['reading list', 'currently reading'].includes(name);
    return GAME_QUEUE_NAMES.has(name);
  }).map((shelf) => shelf.shelf_id));
  return {
    queued: items.filter((item) => item.lists?.some((shelfId) => queueShelfIds.has(shelfId))).length,
    owned: items.filter((item) => item.owned).length,
  };
}
