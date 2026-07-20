export const SHELF_SET_SIZE = 7;

export function membershipIdentity(item) {
  return item.membership_id || item.database_id || item.item_id;
}

export function legacyVisualOrderToCanonical(items) {
  const midpoint = Math.ceil(items.length / 2);
  const lanes = [items.slice(0, midpoint), items.slice(midpoint)];
  const ordered = [];
  const segmentCount = Math.ceil(Math.max(...lanes.map((lane) => lane.length), 0) / SHELF_SET_SIZE);
  for (let segment = 0; segment < segmentCount; segment += 1) {
    for (const lane of lanes) ordered.push(...lane.slice(segment * SHELF_SET_SIZE, (segment + 1) * SHELF_SET_SIZE));
  }
  return ordered;
}

function emptySet() {
  return { slots: Array(SHELF_SET_SIZE).fill(null), overflow: [] };
}

export function createShelfDraft(items, extraSets = 2) {
  const used = Math.max(1, Math.ceil(items.length / SHELF_SET_SIZE));
  const sets = Array.from({ length: used + extraSets }, emptySet);
  items.forEach((item, index) => { sets[Math.floor(index / SHELF_SET_SIZE)].slots[index % SHELF_SET_SIZE] = item; });
  return { sets, originalIdentities: items.map(membershipIdentity) };
}

export function appendShelfSet(draft) {
  return { ...draft, sets: [...draft.sets, emptySet()] };
}

function cloneDraft(draft) {
  return { ...draft, sets: draft.sets.map((set) => ({ slots: [...set.slots], overflow: [...set.overflow] })) };
}

function removeIdentity(draft, identity) {
  for (const set of draft.sets) {
    const slotIndex = set.slots.findIndex((item) => item && membershipIdentity(item) === identity);
    if (slotIndex >= 0) {
      const item = set.slots[slotIndex];
      set.slots[slotIndex] = null;
      return item;
    }
    const overflowIndex = set.overflow.findIndex((item) => membershipIdentity(item) === identity);
    if (overflowIndex >= 0) return set.overflow.splice(overflowIndex, 1)[0];
  }
  return null;
}

export function dropIntoSlot(draft, identity, setIndex, slotIndex) {
  if (!draft.sets[setIndex] || slotIndex < 0 || slotIndex >= SHELF_SET_SIZE || draft.sets[setIndex].slots[slotIndex]) return draft;
  const next = cloneDraft(draft);
  const item = removeIdentity(next, identity);
  if (!item) return draft;
  next.sets[setIndex].slots[slotIndex] = item;
  return next;
}

export function insertBeside(draft, identity, targetIdentity, side = 'before') {
  if (identity === targetIdentity) return draft;
  const next = cloneDraft(draft);
  const item = removeIdentity(next, identity);
  if (!item) return draft;
  for (const set of next.sets) {
    const combined = [...set.slots, ...set.overflow];
    const targetIndex = combined.findIndex((entry) => entry && membershipIdentity(entry) === targetIdentity);
    if (targetIndex < 0) continue;
    combined.splice(targetIndex + (side === 'after' ? 1 : 0), 0, item);
    set.slots = combined.slice(0, SHELF_SET_SIZE);
    set.overflow = combined.slice(SHELF_SET_SIZE).filter(Boolean);
    return next;
  }
  return draft;
}

export function moveToOverflow(draft, identity, setIndex) {
  if (!draft.sets[setIndex]) return draft;
  const next = cloneDraft(draft);
  const item = removeIdentity(next, identity);
  if (!item) return draft;
  next.sets[setIndex].overflow.push(item);
  return next;
}

export function moveToPosition(draft, identity, position) {
  if (!Number.isInteger(position) || position < 1 || position > draft.sets.length * SHELF_SET_SIZE) return draft;
  const setIndex = Math.floor((position - 1) / SHELF_SET_SIZE);
  const slotIndex = (position - 1) % SHELF_SET_SIZE;
  const sourceSetIndex = draft.sets.findIndex((set) => set.slots.some((item) => item && membershipIdentity(item) === identity));
  const sourceSlotIndex = sourceSetIndex < 0
    ? -1
    : draft.sets[sourceSetIndex].slots.findIndex((item) => item && membershipIdentity(item) === identity);

  // Moving a numbered item inside its current set is a true reorder. Removing
  // it closes the gap, the intervening items shift, and no item is displaced
  // into overflow (for example, 2 -> 6 produces 1,3,4,5,6,2,7).
  if (sourceSetIndex === setIndex && sourceSlotIndex >= 0) {
    if (sourceSlotIndex === slotIndex) return draft;
    const next = cloneDraft(draft);
    const slots = next.sets[setIndex].slots;
    const [item] = slots.splice(sourceSlotIndex, 1);
    slots.splice(slotIndex, 0, item);
    next.sets[setIndex].slots = slots.slice(0, SHELF_SET_SIZE);
    return next;
  }
  const target = draft.sets[setIndex].slots[slotIndex];
  return target
    ? insertBeside(draft, identity, membershipIdentity(target), 'before')
    : dropIntoSlot(draft, identity, setIndex, slotIndex);
}

export function draftItems(draft) {
  return draft.sets.flatMap((set) => [...set.slots.filter(Boolean), ...set.overflow]);
}

export function validateShelfDraft(draft) {
  const errors = [];
  const actual = draftItems(draft).map(membershipIdentity);
  const expected = draft.originalIdentities || [];
  const counts = (values) => values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map());
  const actualCounts = counts(actual);
  const expectedCounts = counts(expected);
  if (actual.length !== expected.length || [...expectedCounts].some(([id, count]) => actualCounts.get(id) !== count)) {
    errors.push('The draft changed a shelf membership unexpectedly. Cancel and reopen the arranger.');
  }
  draft.sets.forEach((set, index) => {
    if (!set.overflow.length) return;
    const itemCount = set.slots.filter(Boolean).length + set.overflow.length;
    if (itemCount > SHELF_SET_SIZE) errors.push(`Set ${index + 1} contains ${itemCount} items. Move ${set.overflow.length === 1 ? 'one item' : `${set.overflow.length} items`} before saving.`);
    errors.push(`Move all overflow items into numbered positions before saving. Set ${index + 1} has ${set.overflow.length} in temporary overflow.`);
  });
  let finalUsed = -1;
  draft.sets.forEach((set, index) => { if (set.slots.some(Boolean) || set.overflow.length) finalUsed = index; });
  for (let index = 0; index < finalUsed; index += 1) {
    const set = draft.sets[index];
    if (set.slots.some((item) => !item)) errors.push(`Set ${index + 1} has an empty position.`);
  }
  if (finalUsed >= 0) {
    const finalSlots = draft.sets[finalUsed].slots;
    const firstEmpty = finalSlots.findIndex((item) => !item);
    if (firstEmpty >= 0 && finalSlots.slice(firstEmpty + 1).some(Boolean)) errors.push(`Set ${finalUsed + 1} must be filled continuously from its first position.`);
  }
  for (let index = 1; index <= finalUsed; index += 1) {
    if (draft.sets[index].slots.some(Boolean) && draft.sets[index - 1].slots.some((item) => !item)) {
      errors.push(`Set ${index} must be completed before Set ${index + 1} can contain items.`);
    }
  }
  return [...new Set(errors)];
}

export function serializeShelfDraft(draft) {
  const errors = validateShelfDraft(draft);
  if (errors.length) throw new Error(errors[0]);
  return draft.sets.flatMap((set) => set.slots.filter(Boolean));
}

export function canonicalSets(items) {
  return Array.from({ length: Math.ceil(items.length / SHELF_SET_SIZE) }, (_, index) => items.slice(index * SHELF_SET_SIZE, (index + 1) * SHELF_SET_SIZE));
}

export function pairedShelfSegments(items) {
  const sets = canonicalSets(items);
  return Array.from({ length: Math.ceil(sets.length / 2) }, (_, index) => [sets[index * 2] || [], sets[index * 2 + 1] || []]);
}
