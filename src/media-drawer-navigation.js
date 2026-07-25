function adjacentShelfItem(shelves, shelfIndex, direction) {
  for (let index = shelfIndex + direction; index >= 0 && index < shelves.length; index += direction) {
    const itemIds = shelves[index].itemIds || [];
    if (!itemIds.length) continue;
    return {
      itemId: direction < 0 ? itemIds.at(-1) : itemIds[0],
      shelfId: shelves[index].shelfId,
    };
  }
  return null;
}

export function getDrawerNavigationTargets(navigation, itemId) {
  const shelves = navigation?.shelves || [];
  const shelfIndex = shelves.findIndex((shelf) => shelf.shelfId === navigation?.shelfId);
  if (shelfIndex < 0) return { previous: null, next: null };

  const itemIds = shelves[shelfIndex].itemIds || [];
  const itemIndex = itemIds.indexOf(itemId);
  if (itemIndex < 0) return { previous: null, next: null };

  return {
    previous: itemIndex > 0
      ? { itemId: itemIds[itemIndex - 1], shelfId: shelves[shelfIndex].shelfId }
      : adjacentShelfItem(shelves, shelfIndex, -1),
    next: itemIndex < itemIds.length - 1
      ? { itemId: itemIds[itemIndex + 1], shelfId: shelves[shelfIndex].shelfId }
      : adjacentShelfItem(shelves, shelfIndex, 1),
  };
}
