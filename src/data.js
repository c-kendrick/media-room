export async function loadMediaSnapshot({ fresh = false } = {}) {
  const relative = `${import.meta.env.BASE_URL}media-data.json`;
  const url = new URL(relative, window.location.href);
  if (fresh) url.searchParams.set('refresh', Date.now().toString());
  const response = await fetch(url, { cache: fresh ? 'no-store' : 'default' });
  if (!response.ok) throw new Error(`Could not load media-data.json (${response.status}).`);
  const data = await response.json();
  if (!Array.isArray(data.media) || !Array.isArray(data.mediaShelves)) {
    throw new Error('media-data.json does not contain a valid Media Room export.');
  }
  return data;
}
