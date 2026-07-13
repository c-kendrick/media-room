export const OWNERSHIP_FILTER_OPTIONS = Object.freeze([
  ['owned', 'Owned'],
  ['unowned', 'Unowned'],
]);

export function matchesOwnership(owned, selected = []) {
  if (!selected.length) return true;
  return selected.includes(owned ? 'owned' : 'unowned');
}
