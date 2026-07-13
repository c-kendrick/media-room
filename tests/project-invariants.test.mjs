import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWatchDemand } from '../src/watch-demand.js';
import { matchesStarRatings, normalizeStarRating, STAR_RATING_STEPS } from '../src/star-rating.js';
import { applyShelfMemberships } from '../src/shelf-membership.js';
import { SECTION_NOTE_COLUMNS, SECTION_NOTE_DEFAULTS } from '../src/section-notes.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Main Watchlist remains Film & TV only', async () => {
  const source = await read('src/supabase-data.js');
  const migration = await read('supabase/migrations/20260713060000_screen_only_main_watchlist.sql');
  assert.match(source, /show_in_main_watchlist: 'eq\.true',[\s\S]*section: 'eq\.screen'/);
  assert.match(migration, /check \(not show_in_main_watchlist or section = 'screen'\)/);
});

test('automatic poster enrichment cannot replace existing artwork', async () => {
  const source = await read('supabase/functions/enrich-poster/index.ts');
  assert.match(source, /!item\.poster_url/);
  assert.match(source, /poster_url\.is\.null,poster_url\.eq\./);
  assert.match(source, /collection\.owner_id !== user\.id && !isAdmin/);
});

test('bulk imports remain owner-only and section constrained', async () => {
  const migration = await read('supabase/migrations/20260713050000_owner_section_bulk_import.sql');
  assert.match(migration, /c\.owner_id = auth\.uid\(\)/);
  assert.match(migration, /Destination shelf does not belong to this collection section/);
});

test('responsive media controls use shrink-safe grids', async () => {
  const styles = await read('src/public.css');
  assert.match(styles, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.public-media-command,\.media-filters,\.media-search,\.multi-select\{min-width:0/);
});

test('Main Watchlist demand counts each person once across shelves, copies, and stamps', () => {
  const collections = [
    { id: 'collection-a', owner_id: 'person-a', title: "Alex’s Collection" },
    { id: 'collection-b', owner_id: 'person-b', title: "Blair’s Collection" },
  ];
  const media = [
    { id: 'copy-a-1', collection_id: 'collection-a', type: 'movie', title: 'Same Film', year: 2024 },
    { id: 'copy-a-2', collection_id: 'collection-a', type: 'movie', title: ' Same Film ', year: 2024 },
    { id: 'copy-b', collection_id: 'collection-b', type: 'movie', title: 'same film', year: 2024 },
  ];
  const stamps = [
    { media_item_id: 'copy-a-1', user_id: 'person-a' },
    { media_item_id: 'copy-a-2', user_id: 'person-c' },
    { media_item_id: 'copy-b', user_id: 'person-c' },
  ];
  const profiles = ['a', 'b', 'c'].map((suffix) => ({
    id: `person-${suffix}`,
    username: `person-${suffix}`,
    display_name: `Person ${suffix.toUpperCase()}`,
  }));

  const demand = buildWatchDemand(media, collections, stamps, profiles);
  for (const item of media) {
    assert.deepEqual(demand.get(item.id).map((person) => person.id).sort(), ['person-a', 'person-b', 'person-c']);
  }
});

test('the first Main Watchlist interest filter remains a genuine single-stamp filter', async () => {
  const source = await read('src/App.jsx');
  assert.match(source, /count === '1'[\s\S]*\(item\.interests\?\.length \|\| 0\) === 1/);
  assert.match(source, /count === '1' \? '1 Stamp'/);
});

test('star ratings use owner-only half-star values from 0.5 through 5', async () => {
  const migration = await read('supabase/migrations/20260713070000_owner_star_ratings.sql');
  const app = await read('src/App.jsx');
  assert.deepEqual(STAR_RATING_STEPS, [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
  assert.equal(normalizeStarRating(4.5), 4.5);
  assert.equal(normalizeStarRating(4.4), null);
  assert.equal(normalizeStarRating(0), null);
  assert.match(migration, /c\.owner_id = auth\.uid\(\)/);
  assert.match(migration, /before update of star_rating/);
  assert.doesNotMatch(app, /Rating \(0–10\)/);
});

test('the KM browser icon is included in the Vite document', async () => {
  const document = await read('index.html');
  const icon = await read('public/favicon.svg');
  assert.match(document, /%BASE_URL%favicon\.svg/);
  assert.match(icon, />KM<\/text>/);
});

test('rating filters match only explicitly selected half-star values', async () => {
  const app = await read('src/App.jsx');
  assert.equal(matchesStarRatings(3.5, ['3', '4']), false);
  assert.equal(matchesStarRatings(4, ['3', '4']), true);
  assert.equal(matchesStarRatings(null, ['3']), false);
  assert.equal(matchesStarRatings(null, []), true);
  assert.match(app, /MultiSelect label="Rating"[\s\S]*STAR_RATING_STEPS/);
  assert.match(app, /label="Film & TV"[\s\S]*label="Rating"[\s\S]*All platforms/);
});

test('shelf membership closes immediately and updates all visible state optimistically', async () => {
  const snapshot = {
    collectionId: 'collection-a',
    media: [{ database_id: 'media-a', lists: ['shelf-a'], list_positions: { 'shelf-a': 4 } }],
  };
  const updated = applyShelfMemberships(snapshot, 'media-a', ['shelf-a', 'shelf-b']);
  assert.deepEqual(updated.media[0].lists, ['shelf-a', 'shelf-b']);
  assert.deepEqual(updated.media[0].list_positions, { 'shelf-a': 4, 'shelf-b': 1000 });
  assert.notEqual(updated, snapshot);

  const app = await read('src/App.jsx');
  assert.match(app, /setEditingShelves\(false\);[\s\S]*onUpdateShelves\(previousShelves, nextShelves\)/);
  assert.match(app, /const optimisticData = applyShelfMemberships[\s\S]*setData\(optimisticData\)[\s\S]*replaceMediaShelfMemberships/);
  assert.match(app, /Previous shelves restored/);
});

test('collection notes are section-specific while Main Watchlist mirrors Film & TV only', async () => {
  const app = await read('src/App.jsx');
  const data = await read('src/supabase-data.js');
  const migration = await read('supabase/migrations/20260713080000_section_specific_collection_notes.sql');

  assert.deepEqual(SECTION_NOTE_COLUMNS, {
    screen: 'description',
    book: 'book_description',
    game: 'game_description',
  });
  assert.equal(SECTION_NOTE_DEFAULTS.book, 'Books! (You can edit this)');
  assert.equal(SECTION_NOTE_DEFAULTS.game, 'Video Games goes brrr. (You can edit this)');
  assert.match(SECTION_NOTE_DEFAULTS.screen, /It will also be put in the Main Watchlist/);
  assert.match(app, /onDescriptionChange\(section, description\)/);
  assert.match(app, /SECTION_NOTE_COLUMNS\[section\]/);
  assert.match(data, /owner_note: collection\?\.description \|\| SECTION_NOTE_DEFAULTS\.screen/);
  assert.match(migration, /add column if not exists book_description/);
  assert.match(migration, /add column if not exists game_description/);
});

test('opening Main Watchlist always starts on All Watchlists', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /<MediaView key=\{data\.collectionId\}/);
  assert.match(app, /useState\('screen'\)/);
  assert.match(app, /data\.mainWatchlist \? 'All Watchlists'/);
});
