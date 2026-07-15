export function collectionSummaryStats(items = [], shelves = [], section = 'screen') {
  const queueShelfIds = new Set(shelves.filter((shelf) => shelf.queueList).map((shelf) => shelf.shelf_id));
  return {
    queued: items.filter((item) => item.lists?.some((shelfId) => queueShelfIds.has(shelfId))).length,
    owned: items.filter((item) => item.owned).length,
  };
}
