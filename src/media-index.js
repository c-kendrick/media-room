function shelfPosition(item, shelfId, fallback = Number.MAX_SAFE_INTEGER) {
  const value = item.list_positions?.[shelfId];
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function sourceOrderIndex(sourceOrder) {
  return new Map(sourceOrder.map((item, index) => [item.item_id, index]));
}

function compareShelfItems(shelfId, sourceIndex) {
  return (firstItem, secondItem) => {
    const first = shelfPosition(firstItem, shelfId);
    const second = shelfPosition(secondItem, shelfId);
    if (first !== second) return first - second;
    return (sourceIndex.get(firstItem.item_id) ?? 0) - (sourceIndex.get(secondItem.item_id) ?? 0);
  };
}

export function sortShelfItems(items, shelfId, sourceOrder = []) {
  return [...items].sort(compareShelfItems(shelfId, sourceOrderIndex(sourceOrder)));
}

export function indexShelfItems(items, sourceOrder = []) {
  const indexed = new Map();
  const sourceIndex = sourceOrderIndex(sourceOrder);
  for (const item of items) {
    for (const shelfId of item.lists || []) {
      const shelfItems = indexed.get(shelfId);
      if (shelfItems) shelfItems.push(item);
      else indexed.set(shelfId, [item]);
    }
  }
  for (const [shelfId, shelfItems] of indexed) {
    shelfItems.sort(compareShelfItems(shelfId, sourceIndex));
  }
  return indexed;
}
