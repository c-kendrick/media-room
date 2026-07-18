import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWatchDemand } from '../src/watch-demand.js';
import { matchesStarRatings, normalizeStarRating, STAR_RATING_STEPS } from '../src/star-rating.js';
import { applyShelfMemberships } from '../src/shelf-membership.js';
import { SECTION_NOTE_COLUMNS, SECTION_NOTE_DEFAULTS } from '../src/section-notes.js';
import { matchesOwnership, OWNERSHIP_FILTER_OPTIONS } from '../src/ownership-filter.js';
import { parseCollectionBackup, validateCollectionBackup } from '../src/backup-import.js';
import { supabaseRequest } from '../src/supabase.js';
import { collectionSummaryStats } from '../src/collection-stats.js';
import { appSiteUrl, signupRateLimitDetails } from '../src/auth.js';

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

test('Main Main Watchlist matches title variants and missing years without merging known remakes', () => {
  const collections = [
    { id: 'collection-a', owner_id: 'person-a', title: 'Alex’s Collection' },
    { id: 'collection-b', owner_id: 'person-b', title: 'Blair’s Collection' },
  ];
  const shared = [
    { id: 'godfather-a', collection_id: 'collection-a', type: 'film', title: 'The Godfather', year: 1972 },
    { id: 'godfather-b', collection_id: 'collection-b', type: 'movie', title: 'Godfather!', year: null },
  ];
  const sharedDemand = buildWatchDemand(shared, collections, [], []);
  assert.deepEqual(sharedDemand.get('godfather-a').map((person) => person.id).sort(), ['person-a', 'person-b']);
  assert.deepEqual(sharedDemand.get('godfather-b').map((person) => person.id).sort(), ['person-a', 'person-b']);

  const remakes = [
    { id: 'film-old', collection_id: 'collection-a', type: 'film', title: 'Same Title', year: 1954 },
    { id: 'film-new', collection_id: 'collection-b', type: 'film', title: 'Same Title', year: 2024 },
  ];
  const remakeDemand = buildWatchDemand(remakes, collections, [], []);
  assert.deepEqual(remakeDemand.get('film-old').map((person) => person.id), ['person-a']);
  assert.deepEqual(remakeDemand.get('film-new').map((person) => person.id), ['person-b']);
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

test('shelf membership toggles directly in the drawer and updates all visible state optimistically', async () => {
  const snapshot = {
    collectionId: 'collection-a',
    media: [{ database_id: 'media-a', lists: ['shelf-a'], list_positions: { 'shelf-a': 4 } }],
  };
  const updated = applyShelfMemberships(snapshot, 'media-a', ['shelf-a', 'shelf-b']);
  assert.deepEqual(updated.media[0].lists, ['shelf-a', 'shelf-b']);
  assert.deepEqual(updated.media[0].list_positions, { 'shelf-a': 4, 'shelf-b': 1000 });
  assert.notEqual(updated, snapshot);

  const app = await read('src/App.jsx');
  assert.match(app, /const toggleShelf = \(shelfId\) =>[\s\S]*setOptimisticShelves\(nextShelves\)[\s\S]*onUpdateShelves\(previousShelves, nextShelves\)\.catch/);
  assert.match(app, /aria-pressed=\{optimisticShelves\.includes\(shelf\.shelf_id\)\}/);
  assert.doesNotMatch(app, /disabled=\{shelfBusy\}/);
  assert.doesNotMatch(app, /Edit shelves|SHELF MEMBERSHIP|Save shelves/);
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

test('opening Main Watchlist has no redundant All Watchlists tab', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /<MediaView key=\{data\.collectionId\}/);
  assert.match(app, /useState\('screen'\)/);
  assert.doesNotMatch(app, />All Watchlists</);
  assert.match(app, /!data\.mainWatchlist && <div className="media-tabs">/);
});

test('collection summary counts use live shelf UUIDs and owned flags', async () => {
  const shelves = [{ shelf_id: 'watch-uuid', name: 'Anything', queueList: true }, { shelf_id: 'owned-uuid', name: 'Watchlist', queueList: false }];
  const items = [
    { lists: ['watch-uuid'], owned: false },
    { lists: ['owned-uuid'], owned: true },
    { lists: ['watch-uuid', 'owned-uuid'], owned: true },
  ];
  assert.deepEqual(collectionSummaryStats(items, shelves, 'screen'), { queued: 2, owned: 2 });
  const app = await read('src/App.jsx');
  assert.match(app, /collectionSummaryStats\(items, shelves, section\)/);
  assert.doesNotMatch(app, /\['watchlist', 'reading_list'\]/);
});

test('personal queue totals use section wording and explicit queue shelves without name inference', async () => {
  const books = [
    { lists: ['reading'], owned: false },
    { lists: ['wishlist'], owned: false },
    { lists: ['current'], owned: false },
  ];
  const shelves = [
    { shelf_id: 'reading', name: 'Anything', queueList: true },
    { shelf_id: 'wishlist', name: 'Reading List', queueList: false },
    { shelf_id: 'current', name: 'Anything Else', queueList: true },
  ];
  assert.deepEqual(collectionSummaryStats(books, shelves, 'book'), { queued: 2, owned: 0 });
  const app = await read('src/App.jsx');
  assert.match(app, /section === 'book' \? 'to read' : section === 'game' \? 'to play' : 'to watch'/);
  assert.match(app, /is_queue_list: queueList/);
  assert.match(app, /Items on this shelf count toward “to read”/);
  assert.doesNotMatch(await read('src/collection-stats.js'), /watchlist|reading list|backlog|wishlist/i);
});

test('shelves have optional subtitles and branded edit and confirmation dialogs', async () => {
  const app = await read('src/App.jsx');
  const data = await read('src/supabase-data.js');
  const migration = await read('supabase/migrations/20260715010000_shelf_subtitles_and_profile_settings.sql');
  assert.match(app, /function ShelfEditDialog/);
  assert.match(app, /shelf\.subtitle && <p className="shelf-subtitle">/);
  assert.match(app, /function ConfirmDialog/);
  assert.doesNotMatch(app, /window\.prompt/);
  assert.match(data, /subtitle: shelf\.subtitle \|\| ''/);
  assert.match(migration, /add column if not exists subtitle text/);
});

test('shelf title and subtitle saves close immediately and update optimistically', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /onSave\(\{[\s\S]*subtitle: cleanedSubtitle \|\| null[\s\S]*\}\); onClose\(\);/);
  assert.match(app, /setOptimisticShelfDetails[\s\S]*updateShelf\(accessToken, shelfId, changes\)\.then/);
  assert.match(app, /Previous details restored/);
});

test('Main Watchlist includes one virtual priority and shared-demand shelf', async () => {
  const data = await read('src/supabase-data.js');
  assert.match(data, /id: 'main-priority-watchlist'/);
  assert.match(data, /demand\.length < 2/);
  assert.match(data, /interestedIdentities\.has\(identity\)/);
  assert.match(data, /const candidateShelfIds = shelves\.map\(\(shelf\) => shelf\.id\)/);
  assert.doesNotMatch(data, /canonicalWatchlistShelves/);
  assert.doesNotMatch(data, /mirroredShelfCount/);
  assert.match(data, /representativeByIdentity/);
  assert.match(data, /virtual: true/);
});

test('account settings support display name, password, and admin member preview', async () => {
  const app = await read('src/App.jsx');
  const auth = await read('src/auth.js');
  const migration = await read('supabase/migrations/20260715010000_shelf_subtitles_and_profile_settings.sql');
  assert.match(app, /View as non-Admin/);
  assert.match(app, /const isAdmin = isAdminAccount && !viewAsMember/);
  assert.match(app, /Save Account Settings/);
  assert.match(auth, /rpc\/update_own_display_name/);
  assert.match(auth, /method: 'PUT'[\s\S]*body: \{ password \}/);
  assert.match(migration, /update_own_display_name/);
});

test('display-name updates rename the collection and refresh navigation and stamps', async () => {
  const app = await read('src/App.jsx');
  const migration = await read('supabase/migrations/20260715020000_reading_lists_and_display_names.sql');
  assert.match(migration, /set title = cleaned_name \|\| '’s Collection'/);
  assert.match(app, /const nextCollections = await loadPublicCollections\(\{ fresh: true, accessToken \}\)/);
  assert.match(app, /snapshotCache\.current\.clear\(\)/);
  assert.match(app, /await refresh\(\{ fresh: true, targetCollectionId: data\.collectionId \}\)/);
});

test('search includes descriptions notes and item details everywhere', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /function mediaSearchText\(item\)/);
  for (const field of ['item.description', 'item.notes', 'item.format', 'item.runtime']) assert.match(app, new RegExp(field.replace('.', '\\.')));
  assert.match(app, /const searchable = mediaSearchText\(item\)/);
  assert.match(app, /active\(data\.media\)\.filter\(\(item\) => mediaSearchText\(item\)\.includes\(normalizedQuery\)\)/);
});

test('reading-list migration marks defaults and future approved accounts', async () => {
  const migration = await read('supabase/migrations/20260715020000_reading_lists_and_display_names.sql');
  assert.match(migration, /add column if not exists is_reading_list boolean/);
  assert.match(migration, /lower\(trim\(name\)\) in \('reading list', 'currently reading'\)/);
  assert.match(migration, /\('book','Reading List',1000,false,true\)/);
  assert.match(migration, /\('book','Currently Reading',2000,false,true\)/);
});

test('navigation and metadata refinements remain present', async () => {
  const app = await read('src/App.jsx');
  const styles = await read('src/public.css');
  const mediaStyles = await read('src/media-layout.css');
  assert.doesNotMatch(app, /A LIVING LIBRARY|>Refresh</);
  assert.match(app, /<kbd>Ctrl K<\/kbd>/);
  assert.match(app, /navCollapsed/);
  assert.match(styles, /\.nav-collapsed \.workspace\{margin-left:0\}/);
  assert.match(mediaStyles, /\.media-card-meta,[\s\S]*font-size: 10px/);
  assert.match(app, /Save Changes/);
});

test('owned status is owner-controlled, optimistic, and displayed as a muted card tag', async () => {
  const app = await read('src/App.jsx');
  const data = await read('src/supabase-data.js');
  const styles = await read('src/media-layout.css');
  const migration = await read('supabase/migrations/20260713090000_owned_media.sql');

  assert.match(data, /star_rating,owned,runtime/);
  assert.match(data, /owned: item\.owned \?\? false/);
  assert.match(app, /setOptimisticOwned\(next\)[\s\S]*onUpdate\(\{ owned: next \}/);
  assert.match(app, /item\.owned && <span className="media-owned-tag">Owned<\/span>/);
  assert.match(styles, /\.media-card-meta \.media-owned-tag[\s\S]*color: #81786c/);
  assert.match(migration, /c\.owner_id = auth\.uid\(\)/);
  assert.match(migration, /before update of owned/);
});

test('book cards show the author while drawer and filters retain format', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /function mediaCardDisplayTags\(item\)[\s\S]*item\.type === 'book'[\s\S]*item\.creator\?\.trim\(\)/);
  assert.match(app, /function MediaCard[\s\S]*mediaCardDisplayTags\(item\)/);
  assert.match(app, /function MediaDrawer[\s\S]*mediaDisplayTags\(item\)/);
  assert.match(app, /const formats = unique\(items\.flatMap\(mediaDisplayTags\)\)/);
});

test('ownership filtering is available everywhere and matches Owned and Unowned explicitly', async () => {
  const app = await read('src/App.jsx');
  const styles = await read('src/media-layout.css');

  assert.deepEqual(OWNERSHIP_FILTER_OPTIONS, [['owned', 'Owned'], ['unowned', 'Unowned']]);
  assert.equal(matchesOwnership(true, []), true);
  assert.equal(matchesOwnership(false, []), true);
  assert.equal(matchesOwnership(true, ['owned']), true);
  assert.equal(matchesOwnership(false, ['owned']), false);
  assert.equal(matchesOwnership(false, ['unowned']), true);
  assert.equal(matchesOwnership(true, ['unowned']), false);
  assert.equal(matchesOwnership(true, ['owned', 'unowned']), true);
  assert.equal(matchesOwnership(false, ['owned', 'unowned']), true);
  assert.match(app, /matchesOwnership\(item\.owned, ownershipFilters\)/);
  assert.match(app, /MultiSelect label="Ownership"[\s\S]*OWNERSHIP_FILTER_OPTIONS/);
  assert.doesNotMatch(app, /data\.mainWatchlist && <MultiSelect label="Ownership"/);
  assert.match(styles, /repeat\(6, minmax\(128px, auto\)\)/);
});

test('exported backups can be validated and imported through the owner-only merge workflow', async () => {
  const backup = {
    format: 'media-room/v1',
    collection: { id: 'collection-a', title: 'A Collection', descriptions: { screen: 'Hello' } },
    shelves: [{ shelf_id: 'shelf-a', section: 'screen', name: 'Watchlist' }],
    media: [{ item_id: 'media-a', type: 'film', title: 'Arrival', lists: ['shelf-a'] }],
  };
  assert.deepEqual(validateCollectionBackup(backup), { backup, shelfCount: 1, mediaCount: 1 });
  assert.deepEqual(parseCollectionBackup(JSON.stringify(backup)), { backup, shelfCount: 1, mediaCount: 1 });
  assert.throws(() => parseCollectionBackup('{'), /valid JSON/);
  assert.throws(() => validateCollectionBackup({ ...backup, format: 'unknown' }), /unsupported format/);

  const app = await read('src/App.jsx');
  const writes = await read('src/media-write.js');
  const migration = await read('supabase/migrations/20260713100000_import_collection_backups.sql');
  assert.match(app, /type="file"[\s\S]*Import backup/);
  assert.match(app, /Matching records will be updated[\s\S]*remain untouched/);
  assert.match(writes, /rpc\/import_collection_backup/);
  assert.match(migration, /format' is distinct from 'media-room\/v1'/);
  assert.match(migration, /c\.owner_id = auth\.uid\(\)/);
  assert.match(migration, /on conflict \(collection_id, legacy_id\) do update/);
  assert.doesNotMatch(migration, /delete from public\.(media_items|shelves)/);
});

test('poster enrichment is labelled Find posters', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /Finding posters…'[\s\S]{0,140}: 'Find posters'/);
  assert.doesNotMatch(app, />Enrich posters</);
});

test('backup import execution is hardened and database errors reach the UI', async () => {
  const app = await read('src/App.jsx');
  const migration = await read('supabase/migrations/20260713110000_fix_backup_import_execution.sql');
  assert.match(migration, /insert into public\.shelves as current_shelf/);
  assert.match(migration, /current_shelf\.is_required or excluded\.is_required/);
  assert.match(migration, /insert into public\.media_items as current_media/);
  assert.match(migration, /exception when others[\s\S]*'error', sqlerrm/);
  assert.match(migration, /notify pgrst, 'reload schema'/);
  assert.match(app, /result\?\.ok === false/);
  assert.match(app, /Backup import failed: \$\{error\.message\}/);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Database rejected the import.', details: 'Specific reason.' }), { status: 400 });
  try {
    await assert.rejects(() => supabaseRequest('/rest/v1/rpc/test'), /Database rejected the import\. Specific reason\./);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('backup import repairs older schemas missing provider metadata', async () => {
  const migration = await read('supabase/migrations/20260713120000_ensure_backup_external_ids.sql');
  assert.match(migration, /add column if not exists external_ids jsonb not null default '\{\}'::jsonb/);
  assert.match(migration, /notify pgrst, 'reload schema'/);
});

test('owners can open a collection Bin and restore media or shelves', async () => {
  const app = await read('src/App.jsx');
  const styles = await read('src/public.css');
  assert.match(app, /Bin\{binCount \? ` \(\$\{binCount\}\)` : ''\}/);
  assert.match(app, /function CollectionBinDrawer/);
  assert.match(app, /onRestoreMedia[\s\S]*setMediaDeleted\(accessToken, item\.database_id, false\)/);
  assert.match(app, /onRestoreShelf[\s\S]*updateShelf\(accessToken, shelf\.shelf_id, \{ deleted_at: null \}\)/);
  assert.match(app, /CollectionBinDrawer[\s\S]*Delete forever/);
  assert.match(app, /onDeleteMedia[\s\S]*permanentlyDeleteMedia/);
  assert.match(app, /onDeleteShelf[\s\S]*deleteShelf/);
  assert.match(app, /onDeleteMedia[\s\S]*optimistic: true[\s\S]*media: data\.media\.filter/);
  assert.match(app, /onDeleteShelf[\s\S]*optimistic: true[\s\S]*mediaShelves: data\.mediaShelves\.filter/);
  assert.match(app, /It has been restored to the Bin/);
  assert.doesNotMatch(app, /drawer-danger-zone[\s\S]{0,400}Delete permanently/);
  assert.match(styles, /\.collection-bin-drawer/);
  assert.match(styles, /\.bin-row-actions/);
});

test('add and edit share contextual media details and keep all non-name fields optional', async () => {
  const app = await read('src/App.jsx');
  const styles = await read('src/public.css');
  assert.match(app, /function MediaDetailFields/);
  assert.match(app, /Only the name is required/);
  assert.match(app, />OPTIONAL</);
  for (const label of ['Director', 'Format', 'Platforms', 'Genres', 'Runtime', 'Poster URL', 'Description', 'Notes']) assert.match(app, new RegExp(`>${label}`));
  assert.match(app, /section === 'book' && <label>Author<input value=\{form\.creator\}/);
  assert.match(app, /section === 'game' && <label>Developer and\/or Publisher<input value=\{form\.creator\}/);
  assert.doesNotMatch(app, /<label>Creator<input/);
  assert.match(app, /Mark as Owned/);
  assert.match(app, /section === 'screen'[\s\S]*Mark Priority Watch/);
  assert.match(app, /if \(priorityWatch && currentUserId\) await setInterest/);
  assert.match(app, /<legend>Also add to<\/legend>/);
  assert.match(app, /section === 'game'[\s\S]*Platforms \(comma separated\)[\s\S]*: <label>Format/);
  assert.match(app, /section === 'screen' && <label>Runtime \(minutes\)/);
  assert.doesNotMatch(app, /!compact && <label>Runtime/);
  assert.match(app, /Name of film or show[\s\S]*Name of book[\s\S]*Name of video game/);
  assert.doesNotMatch(app, /Add the muted Owned tag|Add your priority stamp/);
  assert.match(styles, /\.optional-media-section/);
  assert.match(styles, /\.add-status-options/);
  assert.match(styles, /\.editor-layer \{ z-index: 140; \}/);
  assert.match(styles, /\.add-media-layer\{[^}]*align-items:flex-start[^}]*overflow-y:auto/);
});

test('shelf controls use consistent spacing and headline-style labels', async () => {
  const app = await read('src/App.jsx');
  const styles = await read('src/public.css');
  assert.match(app, />Arrange Shelf</);
  assert.match(app, />Add Item</);
  assert.match(styles, /\.shelf-content-actions\{[^}]*gap:7px/);
});

test('queue shelf settings are explicit in every section and independent from Main Watchlist', async () => {
  const app = await read('src/App.jsx');
  const data = await read('src/supabase-data.js');
  const migration = await read('supabase/migrations/20260715030000_queue_shelves.sql');
  assert.match(app, /Backlog \/ To Play shelf/);
  assert.match(app, /Watchlist \/ To Watch shelf/);
  assert.match(app, /is_queue_list: queueList/);
  assert.match(app, /show_in_main_watchlist: mainWatchlist/);
  assert.match(data, /queueList: Boolean\(shelf\.is_queue_list\)/);
  assert.match(migration, /add column if not exists is_queue_list boolean not null default false/);
  assert.match(migration, /\('screen','Watchlist',1000,true,false,true\)/);
  assert.match(migration, /\('book','Reading List',1000,false,true,true\)/);
});

test('Add Item and Move to Bin use immediate optimistic state with rollback', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /temporaryId = `optimistic-/);
  assert.match(app, /setOptimisticMediaItems\(\(rows\) => \[\.\.\.rows, temporaryItem\]\)/);
  assert.match(app, /optimistic: true, onConfirm: async \(\) => \{ const previousData = data/);
  assert.match(app, /setSelectedMediaId\(null\); try \{ await setMediaDeleted/);
  assert.match(app, /if \(optimistic\) \{ onClose\(\); Promise\.resolve\(onConfirm\(\)\)/);
});

test('detail enrichment is section-scoped, reviewable, and blank-only', async () => {
  const app = await read('src/App.jsx');
  const writes = await read('src/media-write.js');
  const edge = await read('supabase/functions/enrich-details/index.ts');
  assert.match(app, /enrichDetailsInCurrentSection/);
  assert.match(app, /function DetailEnrichmentDialog/);
  assert.match(app, /Save New Details/);
  assert.doesNotMatch(app, /poster-review-panel/);
  assert.match(writes, /\/functions\/v1\/enrich-details/);
  assert.match(edge, /slice\(0, 50\)/);
  assert.match(edge, /isBlank\(item\[field\]\) && !isBlank\(next\)/);
  assert.match(edge, /RAWG_API_KEY/);
});

test('poster selection is optimistic and closes its chooser immediately', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /const optimisticData = \{[\s\S]*poster_url: posterUrl[\s\S]*setData\(optimisticData\)/);
  assert.match(app, /setPosterReviewOpen\(false\); setPosterReviewBusy\(false\); setPosterReviewError\(''\); onChoosePoster/);
  assert.match(app, /Previous artwork restored/);
});

test('branding and collection hero polish remain stable', async () => {
  const app = await read('src/App.jsx');
  const styles = await read('src/public.css');
  assert.doesNotMatch(app, /Screen, shelf & story|SCREEN, SHELF & STORY|EVERYONE’S NEXT WATCH/i);
  assert.match(styles, /\.sidebar \.brand\{[^}]*border-bottom:0/);
  assert.match(styles, /\.page-hero \.collection-note-preview\{min-height:59px\}/);
});

test('active searches render one temporary deduplicated result grid above real shelves', async () => {
  const app = await read('src/App.jsx');
  const styles = await read('src/public.css');
  assert.match(app, /const searchResults = queryLower[\s\S]*new Map\(randomPool\.map/);
  assert.match(app, /queryLower && <SearchResultsSection[\s\S]*<div className=\{cls\('dynamic-shelves'/);
  assert.match(app, /function SearchResultsSection/);
  assert.doesNotMatch(app, /Each matching title appears once\. Your shelves remain below\./);
  assert.doesNotMatch(app, /createShelf[\s\S]{0,120}Search Results/);
  assert.match(styles, /\.search-results-grid\{display:grid;grid-template-columns:repeat\(auto-fill,var\(--media-card-width\)\)/);
});

test('private clubs restrict collection visibility and stay admin-only', async () => {
  const app = await read('src/App.jsx');
  const admin = await read('src/admin.js');
  const data = await read('src/data.js');
  const supabaseData = await read('src/supabase-data.js');
  const client = await read('src/supabase.js');
  const migration = await read('supabase/migrations/20260718010000_private_clubs.sql');
  const styles = await read('src/public.css');

  assert.match(migration, /create table if not exists public\.clubs/);
  assert.match(migration, /create table if not exists public\.club_memberships/);
  assert.match(migration, /alter table public\.club_memberships enable row level security/);
  assert.match(migration, /revoke all on public\.clubs from anon, authenticated/);
  assert.match(migration, /revoke all on public\.club_memberships from anon, authenticated/);
  assert.match(migration, /create or replace function public\.shares_club_with/);
  assert.match(migration, /c\.slug = 'kits-collection'/);
  assert.match(migration, /create or replace function public\.can_view_collection/);
  assert.match(migration, /create or replace function public\.can_view_interest/);
  assert.match(migration, /using \(public\.can_view_interest\(media_item_id, user_id\)\)/);
  for (const policy of [
    'Club members can read collections',
    'Club members can read shelves',
    'Club members can read media',
    'Club members can read shelf membership',
    'Club members can read interest markers',
  ]) assert.match(migration, new RegExp(`create policy \\\"${policy}\\\"`));
  assert.match(migration, /create or replace function public\.admin_set_user_clubs/);
  assert.match(migration, /if not public\.is_admin\(\) then raise exception 'Admin access required'/);

  assert.match(client, /Authorization: 'Bearer ' \+ \(accessToken \|\| SUPABASE_PUBLISHABLE_KEY\)/);
  assert.match(data, /loadMediaSnapshot\(\{ fresh = false, collectionId, accessToken, mainWatchlistOwnerIds \}/);
  assert.match(supabaseData, /loadMainWatchlistFromSupabase\(\{ fresh = false, accessToken, ownerIds \}/);
  assert.match(supabaseData, /\.filter\(\(interest\) => scopedProfileIds\.has\(interest\.user_id\)\)/);
  assert.match(supabaseData, /collection_id: 'in\.\(' \+ collectionIds\.join\(','\) \+ '\)'/);
  assert.match(admin, /rpc\/admin_list_clubs/);
  assert.match(admin, /rpc\/admin_set_user_clubs/);
  assert.match(app, /const ADMIN_MAIN_CLUB_KEY = 'kits-media-admin-main-club'/);
  assert.match(app, /window\.localStorage\.setItem\(ADMIN_MAIN_CLUB_KEY, clubId\)/);
  assert.match(app, /const displayedCollections = account\?\.profile\?\.role === 'admin' && viewAsMember/);
  assert.match(app, /function ClubMembershipDialog/);
  assert.match(app, /function ClubEditorDialog/);
  assert.match(styles, /\.admin-club-panel/);
});

test('collection share links preserve Club isolation and expose one sanitized anonymous snapshot', async () => {
  const migration = await read('supabase/migrations/20260719020000_revocable_collection_share_links.sql');

  assert.match(migration, /create table public\.collection_share_links/);
  assert.match(migration, /collection_id uuid primary key/);
  assert.match(migration, /encode\(gen_random_bytes\(32\), 'hex'\)/);
  assert.match(migration, /alter table public\.collection_share_links enable row level security/);
  assert.match(migration, /revoke all on public\.collection_share_links from public, anon, authenticated/);
  assert.match(migration, /create or replace function public\.get_shared_collection\(share_token text\)/);
  assert.match(migration, /link\.token = share_token[\s\S]*link\.enabled/);
  assert.match(migration, /p\.approved_at is not null[\s\S]*p\.rejected_at is null[\s\S]*p\.deactivated_at is null/);
  assert.match(migration, /s\.collection_id = c\.id and s\.deleted_at is null/);
  assert.match(migration, /m\.collection_id = c\.id and m\.deleted_at is null/);
  assert.match(migration, /join public\.shelves s[\s\S]*join public\.media_items m/);
  assert.match(migration, /grant execute on function public\.get_shared_collection\(text\) to anon, authenticated/);
  assert.doesNotMatch(migration, /create (?:or replace )?policy/i);
  assert.doesNotMatch(migration, /create or replace function public\.can_view_collection/);
  assert.doesNotMatch(migration, /media_interest|public_profiles/);
});

test('share management supports stable disablement, rotation, deletion, and optimistic rollback', async () => {
  const migration = await read('supabase/migrations/20260719020000_revocable_collection_share_links.sql');
  const app = await read('src/App.jsx');
  const share = await read('src/collection-share.js');

  assert.match(migration, /create_collection_share\(target_collection_id uuid, rotate_token boolean default false\)/);
  assert.match(migration, /case when rotate_token then encode\(gen_random_bytes\(32\), 'hex'\) else collection_share_links\.token end/);
  assert.match(migration, /set_collection_share_enabled\(target_collection_id uuid, share_enabled boolean\)/);
  assert.match(migration, /delete_collection_share\(target_collection_id uuid\)/);
  assert.match(migration, /c\.owner_id = auth\.uid\(\)/);
  assert.match(share, /fresh: true/);
  assert.match(share, /'Cache-Control': 'no-store'/);
  assert.match(app, /const optimistic = \{ \.\.\.share, enabled: !share\.enabled \}/);
  assert.match(app, /setShare\(previous\)[\s\S]*Previous setting restored/);
  assert.match(app, /setShare\(null\)[\s\S]*setShare\(previous\)/);
});

test('shared collection routing is read-only and completely isolated from Main Watchlist state', async () => {
  const app = await read('src/App.jsx');
  const data = await read('src/data.js');
  const share = await read('src/collection-share.js');

  assert.match(app, /const sharedMode = Boolean\(shareToken\)/);
  assert.match(app, /sharedMode[\s\S]*await loadSharedCollection\(shareToken\)[\s\S]*await loadMediaSnapshot/);
  assert.match(app, /if \(!sharedMode\) \{[\s\S]*cacheSnapshot/);
  assert.match(app, /!sharedMode[\s\S]*account\?\.profile\?\.approved_at/);
  assert.match(app, /const isAdmin = isAdminAccount && !viewAsMember && !sharedMode/);
  assert.match(app, /canInterest=\{Boolean\(!sharedMode/);
  assert.match(app, /data\.shared \? 'SHARED COLLECTION · READ ONLY'/);
  assert.match(app, /sharedMode \? 'Read-only link'/);
  assert.match(share, /share link is unavailable or has been revoked/i);
  assert.doesNotMatch(data, /loadSharedCollection|get_shared_collection/);
  assert.match(share, /mapSnapshot\(payload\.collection, payload\.shelves \|\| \[\], payload\.media \|\| \[\], payload\.memberships \|\| \[\]\)/);
  assert.match(share, /shared: true/);
});

test('share URLs use a validated 256-bit token query route', async () => {
  const { buildCollectionShareUrl, readShareToken, SHARE_TOKEN_PATTERN } = await import('../src/collection-share.js');
  const token = 'ab'.repeat(32);
  assert.equal(SHARE_TOKEN_PATTERN.test(token), true);
  assert.equal(readShareToken({ search: `?share=${token.toUpperCase()}` }), token);
  assert.equal(readShareToken({ search: '?share=short' }), 'short');
  assert.equal(readShareToken({ search: '' }), '');
  assert.equal(buildCollectionShareUrl(token, { href: 'https://example.test/media-room/?old=1#section' }), `https://example.test/media-room/?share=${token}`);
});

test('deactivated collections stay out of admin navigation and Main Watchlist reads', async () => {
  const migration = await read('supabase/migrations/20260718020000_hide_deactivated_collections.sql');
  const clubs = await read('supabase/migrations/20260718010000_private_clubs.sql');

  assert.match(clubs, /public\.profile_is_active\(c\.owner_id\)/);
  assert.match(migration, /using \(public\.can_view_collection\(id\)\)/);
  assert.doesNotMatch(migration, /can_view_collection\(id\) or public\.can_manage_collection\(id\)/);
  assert.match(migration, /public\.can_view_collection\(collection_id\)[\s\S]*deleted_at is null or public\.can_manage_collection\(collection_id\)/);
  assert.match(migration, /public\.can_view_collection\(s\.collection_id\)[\s\S]*s\.deleted_at is null or public\.can_manage_collection\(s\.collection_id\)/);
  assert.match(migration, /public\.can_view_collection\(m\.collection_id\)[\s\S]*m\.deleted_at is null or public\.can_manage_collection\(m\.collection_id\)/);
});

test('collection titles use a plain apostrophe for current and future members', async () => {
  const migration = await read('supabase/migrations/20260718030000_fix_collection_apostrophes.sql');

  assert.match(migration, /update public\.collections c[\s\S]*p\.display_name \|\| '''s Collection'/);
  assert.match(migration, /c\.slug <> 'kits-collection'/);
  assert.match(migration, /create or replace function public\.update_own_display_name/);
  assert.match(migration, /create or replace function public\.approve_profile/);
  assert.equal((migration.match(/'''s Collection'/g) || []).length, 3);
  assert.doesNotMatch(migration, /â|€™|’s Collection/);
});

test('enrichment requests are cached, server-rate-limited, and return retry timing to the UI', async () => {
  const app = await read('src/App.jsx');
  const writes = await read('src/media-write.js');
  const client = await read('src/supabase.js');
  const poster = await read('supabase/functions/enrich-poster/index.ts');
  const details = await read('supabase/functions/enrich-details/index.ts');
  const migration = await read('supabase/migrations/20260717010000_enrichment_rate_limits.sql');

  assert.match(writes, /ENRICHMENT_CACHE_MS = 30 \* 60 \* 1000/);
  assert.match(writes, /cachedEnrichmentRequest\(`poster:/);
  assert.match(writes, /cachedEnrichmentRequest\(`details:/);
  assert.match(client, /error\.retryAfter = Number\(payload\?\.retry_after/);
  assert.match(app, /Find posters in \$\{retryLabel\(posterRetryAfter\)\}/);
  assert.match(app, /Enrich details in \$\{retryLabel\(detailsRetryAfter\)\}/);
  for (const edge of [poster, details]) {
    assert.match(edge, /claim_enrichment_request/);
    assert.match(edge, /'Retry-After'/);
    assert.match(edge, /status, headers/);
  }
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /\('poster-batch', 120, 10\)/);
  assert.match(migration, /\('details-search', 6, 60\)/);
  assert.match(migration, /grant execute on function public\.claim_enrichment_request\(text\) to authenticated/);
  assert.match(migration, /alter table public\.enrichment_requests enable row level security/);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Please wait 42 seconds before enriching again.', retry_after: 42 }), { status: 429, headers: { 'Retry-After': '42' } });
  try {
    await assert.rejects(
      () => supabaseRequest('/functions/v1/enrich-poster'),
      (error) => error.status === 429 && error.retryAfter === 42 && /Please wait 42 seconds/.test(error.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('bulk imports are contextual, title-only, multi-shelf, and optimistic', async () => {
  const app = await read('src/App.jsx');
  const writes = await read('src/media-write.js');
  const styles = await read('src/public.css');
  const migration = await read('supabase/migrations/20260719010000_multi_shelf_bulk_import.sql');
  const dialog = app.slice(app.indexOf('function BulkImportDialog'), app.indexOf('function EditMediaDialog'));

  assert.match(app, />Bulk Import Film</);
  assert.match(app, />Bulk Import Television</);
  assert.match(app, />Bulk Import Books</);
  assert.match(app, />Bulk Import Video Games</);
  assert.doesNotMatch(dialog, /OWNER-ONLY IMPORT|Destination shelf|year optional|Film \||TV \|/i);
  assert.match(dialog, /className="shelf-picker"/);
  assert.match(dialog, /shelfIds\.includes\(shelf\.shelf_id\)/);
  assert.match(app, /setBulkImportType\(null\);[\s\S]*bulkImportMedia\(/);
  assert.match(app, /database_id: `bulk-\$\{temporaryBatch\}-\$\{index\}`/);
  assert.match(writes, /rpc\/bulk_import_media_to_shelves/);
  assert.match(writes, /target_shelf_ids: shelfIds/);
  assert.match(styles, /\.bulk-import-dialog \.shelf-picker/);
  assert.match(migration, /target_shelf_ids uuid\[\]/);
  assert.match(migration, /foreach target_shelf_id in array target_shelf_ids/);
  assert.match(migration, /m\.type = item_type[\s\S]*lower\(trim\(m\.title\)\) = lower\(item_title\)/);
  assert.doesNotMatch(migration, /item_year|entry->>'year'/);
});

test('TMDB safely searches Film and Television with review-only year fallbacks', async () => {
  const details = await read('supabase/functions/enrich-details/index.ts');
  const poster = await read('supabase/functions/enrich-poster/index.ts');

  for (const edge of [details, poster]) {
    assert.match(edge, /type TmdbEndpoint = 'movie' \| 'tv'/);
    assert.match(edge, /const endpoints: TmdbEndpoint\[\] = \[preferred, preferred === 'tv' \? 'movie' : 'tv'\]/);
    assert.match(edge, /await tmdbSearch\(key, endpoint, [^)]+, item\.year\)/);
    assert.match(edge, /endpoint === 'tv' \? 'first_air_date_year' : 'primary_release_year'/);
    assert.match(edge, /year_fallback/);
    assert.match(edge, /candidate\.year_fallback && item\.year && candidate\.year !== item\.year/);
  }
  assert.match(details, /if \(manualReview\) \{[\s\S]*await tmdbSearch\(key, endpoint, item\.title\)/);
  assert.match(details, /providerCandidates\(item, true\)/);
  assert.match(details, /TMDB Film/);
  assert.match(details, /TMDB Television/);
  assert.match(poster, /if \(strict\.length \|\| !item\.year\)/);
});

test('password recovery has a dedicated callback, private acknowledgement, and website signup redirect', async () => {
  const auth = await read('src/auth.js');
  const app = await read('src/App.jsx');

  assert.match(auth, /signup\?redirect_to=' \+ encodeURIComponent\(appAuthUrl\('signin'\)\)/);
  assert.match(auth, /recover\?redirect_to=' \+ encodeURIComponent\(appAuthUrl\('recovery'\)\)/);
  assert.equal(appSiteUrl(), 'https://c-kendrick.github.io/media-room/');
  assert.match(auth, /DEFAULT_PUBLIC_SITE_URL = 'https:\/\/c-kendrick\.github\.io\/media-room\/'/);
  assert.doesNotMatch(auth, /new URL\(import\.meta\.env\.BASE_URL, window\.location\.origin\)/);
  assert.match(auth, /params\.get\('type'\) !== 'recovery'/);
  assert.match(auth, /storeSession\(\{ access_token:/);
  assert.match(auth, /window\.history\.replaceState\(\{\}, '', appAuthUrl\('recovery'\)\)/);
  assert.match(app, />Forgot your password\?</);
  assert.match(app, /function RecoveryPasswordDialog/);
  assert.match(app, /updatePassword\(account\.session\.access_token,password\)/);
  assert.match(app, /If an account exists for that email, a recovery link has been sent\./);
  assert.doesNotMatch(app, /No account exists|email is not registered/i);
});

test('Main Watchlist selection lives in the sidebar title without an extra content box', async () => {
  const app = await read('src/App.jsx');
  const styles = await read('src/public.css');
  assert.match(app, /`\$\{selectedMainWatchlistClub\.name\} Watchlist`/);
  assert.match(app, /className=\{cls\('main-watchlist-nav', data\.mainWatchlist && 'active'\)\}/);
  assert.match(app, /<span>\{mainWatchlistTitle\}<\/span><ChevronDown/);
  assert.match(app, /chooseMainWatchlist\(club\.id\)/);
  assert.match(app, /const defaultClubId = memberClubs\[0\]\.id/);
  assert.doesNotMatch(app, /My Watchlist/);
  assert.doesNotMatch(app, /className="main-watchlist-scope"/);
  assert.doesNotMatch(styles, /\.main-watchlist-scope/);
});

test('Share Collection always manages the signed-in owner collection and no duplicate Friends button remains', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /const \[ownCollection, setOwnCollection\] = useState\(null\)/);
  assert.match(app, /setOwnCollection\(visibleCollections\.find\(\(collection\) => collection\.owner_id === account\.profile\.id\) \|\| null\)/);
  assert.match(app, /const canShareCollection = Boolean\(account\?\.profile\?\.approved_at[\s\S]*&& ownCollection\)/);
  assert.doesNotMatch(app, /canShareCollection = Boolean\([^\n]*!sharedMode/);
  assert.match(app, /collectionId=\{ownCollection\.id\} collectionTitle=\{ownCollection\.title\}/);
  assert.doesNotMatch(app, /canAddFriend|addFriendFromCollection|friendTarget/);
  assert.doesNotMatch(app, />Friends<\/Button>/);
});

test('signup email rate limits are friendly and only count down reliable server timing', async () => {
  const app = await read('src/App.jsx');
  assert.deepEqual(signupRateLimitDetails({ status: 429, retryAfter: 12.1 }), { limited: true, retryAfter: 13 });
  assert.deepEqual(signupRateLimitDetails({ code: 'over_email_send_rate_limit' }), { limited: true, retryAfter: 0 });
  assert.deepEqual(signupRateLimitDetails({ message: 'Email rate limit exceeded', retryAfter: -5 }), { limited: true, retryAfter: 0 });
  assert.deepEqual(signupRateLimitDetails({ status: 400, message: 'Username already exists' }), { limited: false, retryAfter: 0 });
  assert.match(app, /Signups are temporarily unavailable because the authentication email limit has been reached/);
  assert.match(app, /disabled=\{submitting \|\| \(registering && signupRetrySeconds > 0\)\}/);
  assert.match(app, /Try again in \$\{signupRetrySeconds\}s/);
  assert.doesNotMatch(app, /setSignupRetryUntil\(Date\.now\(\) \+ (?!retryAfter)/);
});

test('friend and Club access remains private, active-only, and RPC-managed', async () => {
  const migration = await read('supabase/migrations/20260719030000_friends_and_member_clubs.sql');
  const social = await read('src/social.js');
  assert.match(migration, /create table public\.friend_requests/);
  assert.match(migration, /create table public\.friendships/);
  assert.match(migration, /revoke all on public\.friend_requests from public, anon, authenticated/);
  assert.match(migration, /create or replace function public\.can_view_collection[\s\S]*public\.shares_club_with\(c\.owner_id\) or public\.are_friends\(c\.owner_id\)/);
  assert.match(migration, /p\.approved_at is not null and p\.rejected_at is null and p\.deactivated_at is null/);
  assert.match(migration, /mp\.approved_at is not null and mp\.rejected_at is null and mp\.deactivated_at is null/);
  assert.match(migration, /create or replace function public\.request_friend_from_share/);
  assert.match(migration, /l\.token=share_token and l\.enabled and public\.profile_is_active\(c\.owner_id\)/);
  assert.match(migration, /grant execute on function public\.list_user_hub\(\)[\s\S]*to authenticated/);
  assert.match(social, /rpc\(token, 'request_friend'/);
  assert.match(social, /rpc\(token, 'respond_friend_request'/);
  assert.match(social, /rpc\(token, 'unfriend'/);
});

test('each Club has an isolated Main Watchlist with personal fallback and distinct-person demand', async () => {
  const app = await read('src/App.jsx');
  const data = await read('src/supabase-data.js');
  const migration = await read('supabase/migrations/20260719030000_friends_and_member_clubs.sql');
  assert.match(app, /selectedMainWatchlistClub\?\.member_ids \|\| \[account\.profile\.id\]/);
  assert.match(app, /loadMediaSnapshot\(\{ fresh, collectionId: targetCollectionId, accessToken, mainWatchlistOwnerIds \}\)/);
  assert.match(app, /const defaultClubId = memberClubs\[0\]\.id/);
  assert.match(app, /memberClubs\.map\(\(club\) => <button/);
  assert.doesNotMatch(app, /My Watchlist/);
  assert.match(data, /allowedOwnerIds = Array\.isArray\(ownerIds\) \? new Set\(ownerIds\) : null/);
  assert.match(data, /show_in_main_watchlist: 'eq\.true'/);
  assert.match(data, /if \(!interestedIdentities\.has\(identity\) && demand\.length < 2\) continue/);
  assert.doesNotMatch(data, /mirroredShelfCount/);
  assert.match(migration, /create or replace function public\.transfer_club_ownership/);
  assert.match(migration, /Transfer Club ownership before leaving/);
  assert.match(migration, /lower\(p\.username\) = 'christopher'/);
});
