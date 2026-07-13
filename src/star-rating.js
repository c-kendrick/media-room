export const STAR_RATING_STEPS = Array.from({ length: 10 }, (_, index) => (index + 1) / 2);

export function normalizeStarRating(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0.5 || number > 5 || !Number.isInteger(number * 2)) return null;
  return number;
}
