export const OPTIMISTIC_APPEND_POSITION = Number.MAX_SAFE_INTEGER;

export function applyShelfMemberships(snapshot, databaseId, selectedShelfIds) {
  const lists = [...new Set(selectedShelfIds)];
  return {
    ...snapshot,
    media: snapshot.media.map((item) => {
      if (item.database_id !== databaseId) return item;
      return {
        ...item,
        lists,
        list_positions: Object.fromEntries(lists.map((shelfId) => [shelfId, item.list_positions?.[shelfId] ?? OPTIMISTIC_APPEND_POSITION])),
      };
    }),
  };
}
