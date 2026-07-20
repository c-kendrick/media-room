import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildWatchDemand } from '../src/watch-demand.js';
import { matchesStarRatings, normalizeStarRating, STAR_RATING_STEPS } from '../src/star-rating.js';
import { applyShelfMemberships, OPTIMISTIC_APPEND_POSITION } from '../src/shelf-membership.js';
import { SECTION_NOTE_COLUMNS, SECTION_NOTE_DEFAULTS } from '../src/section-notes.js';
import { matchesOwnership, OWNERSHIP_FILTER_OPTIONS } from '../src/ownership-filter.js';
import { parseCollectionBackup, validateCollectionBackup } from '../src/backup-import.js';
import { supabaseRequest } from '../src/supabase.js';
import { collectionSummaryStats } from '../src/collection-stats.js';
import { appSiteUrl, authenticatedProfilePath, selectAuthenticatedProfile, signupRateLimitDetails } from '../src/auth.js';
import { applyReactionToSnapshot, mediaReactionIdentity } from '../src/media-reactions.js';
import { avatarToneClass, clubInitials, collectionOwnerIdentity, personDisplayName, personInitial } from '../src/identity.js';
import { mapSnapshot, mergeSectionSnapshot } from '../src/supabase-data.js';
import { completeShelfOrder } from '../src/media-write.js';
import { canPersistSnapshot, sectionSnapshot } from '../src/section-cache.js';
import { createShelfDraft, dropIntoSlot, insertBeside, legacyVisualOrderToCanonical, moveToOverflow, moveToPosition, pairedShelfSegments, removeEmptyShelfSet, serializeShelfDraft, validateShelfDraft } from '../src/shelf-order.js';

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
  assert.match(source, /count === '1'[\s\S]*\(item\.priorities\?\.length \|\| 0\) === 1/);
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
  assert.deepEqual(updated.media[0].list_positions, { 'shelf-a': 4, 'shelf-b': OPTIMISTIC_APPEND_POSITION });
  assert.notEqual(updated, snapshot);

  const app = await read('src/App.jsx');
  assert.match(app, /const toggleShelf = \(shelfId\) =>[\s\S]*setOptimisticShelves\(nextShelves\)[\s\S]*onUpdateShelves\(previousShelves, nextShelves\)\.catch/);
  assert.match(app, /aria-pressed=\{optimisticShelves\.includes\(shelf\.shelf_id\)\}/);
  assert.doesNotMatch(app, /disabled=\{shelfBusy\}/);
  assert.doesNotMatch(app, /Edit shelves|SHELF MEMBERSHIP|Save shelves/);
  assert.match(app, /const optimisticData = applyShelfMemberships[\s\S]*setData\(optimisticData\)[\s\S]*replaceMediaShelfMemberships/);
  assert.match(app, /Previous shelves restored/);
});

test('new shelf memberships append optimistically and atomically at the bottom', async () => {
  const app = await read('src/App.jsx');
  const writes = await read('src/media-write.js');
  const migration = await read('supabase/migrations/20260721010000_append_new_shelf_memberships.sql');
  assert.match(app, /list_positions: Object\.fromEntries\(shelfIds\.map\(\(id\) => \[id, OPTIMISTIC_APPEND_POSITION\]\)\)/);
  assert.match(app, /OPTIMISTIC_APPEND_POSITION - rows\.length \+ index/);
  assert.match(writes, /rpc\/append_media_shelf_memberships[\s\S]*target_media_item_id: databaseId, target_shelf_ids: additions/);
  assert.match(writes, /error\?\.code !== 'PGRST202'[\s\S]*Math\.max[\s\S]*\+ 1000/);
  assert.match(migration, /order by s\.id\s+for update/);
  assert.match(migration, /coalesce\(max\(existing\.position\), 0\) \+ 1000/);
  assert.match(migration, /on conflict \(shelf_id, media_item_id\) do nothing/);
  assert.match(migration, /public\.can_manage_collection\(media_row\.collection_id\)/);
});

test('numbered shelf ranks reserve the ownership row for every card', async () => {
  const app = await read('src/App.jsx');
  const layout = await read('src/media-layout.css');
  assert.match(app, /media-owned-tag', !item\.owned && 'is-placeholder'[\s\S]*item\.owned \? 'Owned' : '\\u00a0'/);
  assert.match(layout, /\.media-card-meta \.media-owned-tag\.is-placeholder \{\s*visibility: hidden/);
  assert.match(app, /media-owned-tag[\s\S]*shelfRank !== null[\s\S]*className="shelf-rank"/);
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
  assert.match(app, /useState\(\(\) => MEDIA_SECTIONS\.has\(initialSection\) \? initialSection : 'screen'\)/);
  assert.doesNotMatch(app, />All Watchlists</);
  assert.match(app, /!data\.mainWatchlist && <div className="media-tabs" aria-busy=\{sectionLoading\}>/);
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
  assert.match(data, /const shelfIds = shelves\.map\(\(shelf\) => shelf\.id\)/);
  assert.match(data, /\.\.\.memberships\.map[\s\S]*\.\.\.interestRows\.map/);
  assert.doesNotMatch(data, /canonicalWatchlistShelves/);
  assert.doesNotMatch(data, /mirroredShelfCount/);
  assert.match(data, /representativeByIdentity/);
  assert.match(data, /virtual: true/);
});

test('account settings support display name, password, and opt-in admin view', async () => {
  const app = await read('src/App.jsx');
  const auth = await read('src/auth.js');
  const migration = await read('supabase/migrations/20260715010000_shelf_subtitles_and_profile_settings.sql');
  assert.match(app, /View as Admin/);
  assert.match(app, /const isAdmin = isAdminAccount && viewAsAdmin/);
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

test('the public sidebar footer is removed and collection tools remain horizontal when space allows', async () => {
  const app = await read('src/App.jsx');
  const styles = await read('src/public.css');
  assert.doesNotMatch(app, /Public collection|Published \$\{generatedAt/);
  assert.match(app, /\{sharedMode && <div className="sidebar-bottom">/);
  assert.match(app, /collection-tools-intro[\s\S]*collection-tool-actions[\s\S]*create-shelf-button/);
  assert.match(styles, /\.collection-tools\{[^}]*display:flex[^}]*align-items:center/);
  assert.match(styles, /\.collection-tool-actions\{[^}]*flex-wrap:nowrap/);
  assert.match(styles, /@media\(max-width:1100px\) and \(min-width:761px\)\{\.collection-tools\{[^}]*flex-direction:column/);
});

test('owned status is owner-controlled, optimistic, and displayed as a muted card tag', async () => {
  const app = await read('src/App.jsx');
  const data = await read('src/supabase-data.js');
  const styles = await read('src/media-layout.css');
  const migration = await read('supabase/migrations/20260713090000_owned_media.sql');

  assert.match(data, /star_rating,owned,runtime/);
  assert.match(data, /owned: item\.owned \?\? false/);
  assert.match(app, /setOptimisticOwned\(next\)[\s\S]*onUpdate\(\{ owned: next \}/);
  assert.match(app, /media-owned-tag', !item\.owned && 'is-placeholder'[\s\S]*item\.owned \? 'Owned'/);
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
  const writes = await read('src/media-write.js');
  const styles = await read('src/public.css');
  assert.match(app, /Bin\{binCount \? ` \(\$\{binCount\}\)` : ''\}/);
  assert.match(app, /function CollectionBinDrawer/);
  assert.match(app, /onRestoreMedia[\s\S]*setMediaDeleted\(accessToken, item\.database_id, false\)/);
  assert.match(app, /onRestoreShelf[\s\S]*updateShelf\(accessToken, shelf\.shelf_id, \{ deleted_at: null \}\)/);
  assert.match(app, /CollectionBinDrawer[\s\S]*Delete forever/);
  assert.match(app, /onDeleteMedia[\s\S]*permanentlyDeleteMedia/);
  assert.match(app, /onDeleteShelf[\s\S]*deleteShelf/);
  assert.match(app, /onDeleteMedia[\s\S]*optimistic: true[\s\S]*media: data\.media\.filter[\s\S]*onDataChange\(optimisticData\)/);
  assert.match(app, /onDeleteShelf[\s\S]*optimistic: true[\s\S]*mediaShelves: data\.mediaShelves\.filter[\s\S]*onDataChange\(optimisticData\)/);
  assert.match(app, /if \(!deleted\?\.length\) throw new Error\('Supabase did not delete the media item\.'/);
  assert.match(app, /catch \(error\) \{ onDataChange\(previousData\); notify\(`\$\{item\.title\} could not be deleted/);
  assert.match(writes, /permanentlyDeleteMedia[\s\S]*Prefer: 'return=representation'/);
  assert.match(writes, /deleteShelf[\s\S]*Prefer: 'return=representation'/);
  assert.match(app, /It has been restored to the Bin/);
  assert.doesNotMatch(app, /drawer-danger-zone[\s\S]{0,400}Delete permanently/);
  assert.match(styles, /\.collection-bin-drawer/);
  assert.match(styles, /\.bin-row-actions/);
});

test('add and edit share contextual media details while only shelf placement is additionally required', async () => {
  const app = await read('src/App.jsx');
  const styles = await read('src/public.css');
  assert.match(app, /function MediaDetailFields/);
  assert.match(app, /Add as much or as little detail as you like, then choose at least one shelf/);
  assert.match(app, />OPTIONAL</);
  for (const label of ['Director', 'Format', 'Platforms', 'Genres', 'Runtime', 'Poster URL', 'Description', 'Notes']) assert.match(app, new RegExp(`>${label}`));
  assert.match(app, /section === 'book' && <label>Author<input value=\{form\.creator\}/);
  assert.match(app, /section === 'game' && <label>Developer and\/or Publisher<input value=\{form\.creator\}/);
  assert.doesNotMatch(app, /<label>Creator<input/);
  assert.match(app, /Mark as Owned/);
  assert.match(app, /section === 'screen'[\s\S]*Mark Priority Watch/);
  assert.match(app, /if \(priorityWatch && currentUserId\) await setMediaReaction\(accessToken, created\[0\]\.id, 'priority', true\)/);
  assert.match(app, /<legend>Choose at least one shelf <span>Required<\/span><\/legend>/);
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

test('the shelf arranger is a viewport modal and shelf moves preserve the viewport instantly', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /function ArrangeShelfDialog[\s\S]*return createPortal\([\s\S]*document\.body\)/);
  assert.match(app, /arrange-dialog fixed-set-arranger" role="dialog" aria-modal="true"/);
  assert.match(app, /const moveShelfWithViewport = \(direction\) =>[\s\S]*previousTop[\s\S]*onMoveShelf\(direction\)[\s\S]*window\.scrollBy\(\{ top: nextTop - previousTop, behavior: 'auto' \}\)/);
  assert.match(app, /Move shelf down[\s\S]*moveShelfWithViewport\(1\)/);
});

test('shelf arranging has undo redo, generous drag targets, and button-only debounced shelf ordering', async () => {
  const app = await read('src/App.jsx');
  const styles = await read('src/public.css');
  assert.match(app, /className="arrange-history"[\s\S]*<Undo2[\s\S]*Undo[\s\S]*<Redo2[\s\S]*Redo/);
  assert.doesNotMatch(app, /Move items only where you choose|Drag to reorder shelf|shelfDragging=|onShelfDragStart=/);
  assert.match(app, /window\.setTimeout\(\(\) => \{ void persistShelfOrder\(\); \}, 650\)/);
  assert.match(app, /Shelf order could not be saved\. The previous order was restored\./);
  assert.match(styles, /\.insert-target\{[^}]*left:0;right:0;height:50%;pointer-events:none/);
  assert.match(styles, /\.insert-target\.enabled\{pointer-events:auto\}/);
});

test('shelf arranging saves every active item independently of filters and treats refresh as best effort', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /const arrangeItems = sortShelfItems\(\s*items\.filter\(\(item\) => !item\.optimistic && item\.lists\?\.includes\(shelf\.shelf_id\)\)/);
  assert.match(app, /<MediaShelf[^>]*items=\{shelfItems\} arrangeItems=\{arrangeItems\}/);
  assert.match(app, /function MediaShelf\(\{ shelf, items, arrangeItems = items,/);
  assert.match(app, /<ArrangeShelfDialog shelf=\{shelf\} items=\{arrangeItems\}/);
  assert.match(app, /await reorderShelfMedia\([^)]+\); notify\('Item order saved\.'\); void refresh\(\{ fresh: true \}\)\.catch/);
  assert.match(app, /Item order could not be saved: \$\{error\.message\}/);
  assert.match(app, /The shelf order could not be saved: \$\{error\.message\}/);
});

test('shelf reordering completes the visible order with active server-only memberships', async () => {
  const completed = completeShelfOrder(
    ['visible-b', 'visible-a'],
    [
      { media_item_id: 'visible-a' },
      { media_item_id: 'hidden-active' },
      { media_item_id: 'hidden-deleted' },
      { media_item_id: 'visible-b' },
    ],
    [{ id: 'visible-a' }, { id: 'visible-b' }, { id: 'hidden-active' }],
  );
  assert.deepEqual(completed, ['visible-b', 'visible-a', 'hidden-active']);
  const writes = await read('src/media-write.js');
  assert.match(writes, /loadCompleteActiveShelfOrder[\s\S]*shelf_media_items[\s\S]*deleted_at: 'is\.null'[\s\S]*ordered_media_ids: completeOrder/);
});

test('shelf reordering preserves server-only memberships instead of rejecting a valid visible order', async () => {
  const migration = await read('supabase/migrations/20260720050000_resilient_shelf_reordering.sql');
  assert.doesNotMatch(migration, /Order must include every active shelf item|active_count <>/);
  assert.match(migration, /if exists \([\s\S]*Media item is not active on this shelf/);
  assert.match(migration, /preserved as \([\s\S]*not \(smi\.media_item_id = any/);
  assert.match(migration, /requested_count \+ row_number\(\)/);
  assert.match(migration, /public\.can_manage_collection\(collection_id\)/);
});

test('empty shelf sets can be deleted without removing occupied sets', async () => {
  const draft = createShelfDraft(shelfItems(7));
  const withoutFirstEmpty = removeEmptyShelfSet(draft, 1);
  assert.equal(withoutFirstEmpty.sets.length, draft.sets.length - 1);
  assert.equal(removeEmptyShelfSet(draft, 0), draft);
  const app = await read('src/App.jsx');
  assert.match(app, /itemCount === 0[\s\S]*Delete empty Set \$\{setIndex \+ 1\}[\s\S]*removeEmptyShelfSet\(current, setIndex\)/);
});

test('mobile shelf controls and arranger keep a clear compact reading order', async () => {
  const app = await read('src/App.jsx');
  const styles = await read('src/public.css');
  assert.match(app, /className="arrange-lane-headings"><h3>ROW 1 SETS<\/h3><h3>ROW 2 SETS<\/h3><\/div>/);
  assert.match(app, /Math\.ceil\(draft\.sets\.length \/ 2\)[\s\S]*className="arrange-set-pair"[\s\S]*draft\.sets\.slice\(pairIndex \* 2, pairIndex \* 2 \+ 2\)/);
  assert.doesNotMatch(app, /setIndex % 2 === lane/);
  assert.match(styles, /\.arrange-lanes\{display:flex;flex-direction:column;gap:14px/);
  assert.match(styles, /\.arrange-lane-headings,\.arrange-set-pair\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);align-items:start/);
  assert.match(styles, /@media\(max-width:760px\)\{\.arrange-lane-headings\{display:none\}\.arrange-set-pair\{grid-template-columns:1fr\}/);
  assert.match(styles, /\.shelf-add-button\{[^}]*box-sizing:border-box!important;[^}]*width:40px!important;[^}]*height:40px!important;[^}]*padding:0!important;[^}]*display:grid!important;place-items:center!important/);
});

test('the collection navigation auto-collapses at medium viewport widths without locking the toggle', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /const AUTO_COLLAPSE_NAV_QUERY = '\(max-width: 1280px\)'/);
  assert.match(app, /useState\(\(\) => window\.matchMedia\?\.\(AUTO_COLLAPSE_NAV_QUERY\)\.matches \?\? false\)/);
  assert.match(app, /const collapseAtMediumWidth = \(event\) => \{ if \(event\.matches\) setNavCollapsed\(true\); \}/);
  assert.match(app, /viewport\.addEventListener\?\.\('change', collapseAtMediumWidth\)/);
  assert.match(app, /onClick=\{\(\) => setNavCollapsed\(\(current\) => !current\)\}/);
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
  assert.match(data, /loadMediaSnapshot\(\{ fresh = false, collectionId, section = 'screen', accessToken, mainWatchlistOwnerIds \}/);
  assert.match(supabaseData, /loadMainWatchlistFromSupabase\(\{ fresh = false, accessToken, ownerIds \}/);
  assert.match(supabaseData, /\.filter\(\(interest\) => scopedProfileIds\.has\(interest\.user_id\)\)/);
  assert.match(supabaseData, /collection_id: 'in\.\(' \+ collectionIds\.join\(','\) \+ '\)'/);
  assert.match(admin, /rpc\/admin_list_clubs/);
  assert.match(admin, /rpc\/admin_set_user_clubs/);
  assert.match(app, /const ADMIN_MAIN_CLUB_KEY = 'kits-media-admin-main-club'/);
  assert.match(app, /window\.localStorage\.setItem\(ADMIN_MAIN_CLUB_KEY, clubId\)/);
  assert.match(app, /const displayedCollections = account\?\.profile\?\.role === 'admin' && !viewAsAdmin/);
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

  assert.match(app, /const sharedMode = Boolean\(shareToken \|\| publicUsername\)/);
  assert.match(app, /sharedMode[\s\S]*await loadPublicCollection\(publicUsername\)[\s\S]*await loadSharedCollection\(shareToken\)[\s\S]*await loadMediaSnapshot/);
  assert.match(app, /if \(!sharedMode\) \{[\s\S]*cacheSnapshot/);
  assert.match(app, /!sharedMode[\s\S]*account\?\.profile\?\.approved_at/);
  assert.match(app, /const isAdmin = isAdminAccount && viewAsAdmin && !sharedMode/);
  assert.match(app, /const canReact = Boolean\(!sharedMode/);
  assert.match(app, /data\.shared \? 'SHARED COLLECTION · READ ONLY'/);
  assert.match(app, /\{sharedMode && <div className="sidebar-bottom">[\s\S]*<small>Read-only link<\/small>/);
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

test('Open accounts have stable username links that fail closed without affecting secure links', async () => {
  const app = await read('src/App.jsx');
  const share = await read('src/collection-share.js');
  const migration = await read('supabase/migrations/20260719050000_open_public_collections.sql');
  const fallback = await read('public/404.html');
  assert.match(app, />Secure link<\/strong>/);
  assert.match(app, />Short link<\/strong>/);
  assert.match(app, /const optimistic = \{ \.\.\.publicStatus, enabled: !publicStatus\.enabled \}/);
  assert.match(app, /setPublicStatus\(previous\)[\s\S]*Previous setting restored/);
  assert.match(app, /Switch to Closed/);
  assert.match(app, /Secure links are unchanged/);
  assert.match(app, /This collection address is invalid, unavailable, Closed, disabled, deleted, or has been replaced/);
  assert.doesNotMatch(app, /sharedMode \?[^\n]*: \{error\}/);
  assert.match(share, /new URL\(`u\/\$\{encodeURIComponent\(username\)\}`, appSiteUrl\(\)\)/);
  assert.match(share, /get_public_collection_by_username/);
  assert.match(share, /Cache-Control': 'no-store'/);
  assert.match(migration, /public_collection_enabled boolean not null default false/);
  assert.match(migration, /p\.public_collection_enabled/);
  assert.match(migration, /p\.approved_at is not null[\s\S]*p\.rejected_at is null[\s\S]*p\.deactivated_at is null/);
  assert.match(migration, /s\.deleted_at is null/);
  assert.match(migration, /m\.deleted_at is null/);
  assert.doesNotMatch(migration, /club_memberships|media_interests|friendships/);
  assert.match(fallback, /media-room-public-route/);
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

test('authenticated sessions can only attach the profile matching the Supabase Auth user', async () => {
  const auth = await read('src/auth.js');
  const kitId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const eddieId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  assert.equal(authenticatedProfilePath(kitId), `/rest/v1/profiles?select=id,username,display_name,role,approved_at,deactivated_at&id=eq.${kitId}&limit=1`);
  assert.deepEqual(selectAuthenticatedProfile({ id: kitId }, [{ id: kitId, username: 'kit' }]), { id: kitId, username: 'kit' });
  assert.throws(() => selectAuthenticatedProfile({ id: kitId }, [{ id: eddieId, username: 'eddie' }]), /could not be verified/);
  assert.throws(() => selectAuthenticatedProfile({ id: kitId }, []), /could not be verified/);
  assert.throws(() => authenticatedProfilePath('not-a-user-id'), /valid user identity/);
  assert.match(auth, /authRequest\('user', \{ method: 'GET', accessToken \}\)/);
  assert.doesNotMatch(auth, /profiles\?select=id,username,display_name,role,approved_at,deactivated_at&limit=1/);
  assert.match(auth, /const profile = await fetchProfile\(session\.access_token\);[\s\S]*storeSession\(session\)/);
  assert.match(auth, /catch \(error\) \{[\s\S]*storeSession\(null\);[\s\S]*throw error/);
});

test('Main Watchlist selection lives in the hero title without an extra content box', async () => {
  const app = await read('src/App.jsx');
  const styles = await read('src/public.css');
  assert.match(app, /`\$\{selectedMainWatchlistClub\.name\} Watchlist`/);
  assert.match(app, /function WatchlistTitle/);
  assert.match(app, /if \(clubs\.length <= 1\) return <h1>\{title\}<\/h1>/);
  assert.match(app, /titleControl=\{data\.mainWatchlist \? <WatchlistTitle/);
  assert.match(app, /<ListOrdered size=\{17\} \/>Main Watchlist<\/button>/);
  assert.match(app, /const defaultClubId = memberClubs\[0\]\.id/);
  assert.doesNotMatch(app, /My Watchlist/);
  assert.doesNotMatch(app, /className="main-watchlist-scope"/);
  assert.doesNotMatch(styles, /\.main-watchlist-scope/);
  assert.doesNotMatch(styles, /\.main-watchlist-nav/);
  assert.match(styles, /\.watchlist-title-selector/);
});

test('Share Collection always manages the signed-in owner collection and no duplicate Friends button remains', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /const \[ownCollection, setOwnCollection\] = useState\(null\)/);
  assert.match(app, /setOwnCollection\(collections\.find\(\(collection\) => collection\.owner_id === account\.profile\.id\) \|\| null\)/);
  assert.match(app, /const canShareCollection = Boolean\(account\?\.profile\?\.approved_at[\s\S]*&& ownCollection\)/);
  assert.doesNotMatch(app, /canShareCollection = Boolean\([^\n]*!sharedMode/);
  assert.match(app, /collectionId=\{ownCollection\.id\} collectionTitle=\{ownCollection\.title\}/);
  assert.doesNotMatch(app, /canAddFriend|addFriendFromCollection|friendTarget/);
  assert.doesNotMatch(app, />Friends<\/Button>/);
});

test('member identities use real names, stable themed avatars, and word-based Club initials', async () => {
  const app = await read('src/App.jsx');
  const styles = await read('src/public.css');
  const christopher = { id: 'user-christopher', display_name: 'Christopher', username: 'c-kendrick' };
  assert.equal(personDisplayName(christopher), 'Christopher');
  assert.equal(personInitial(christopher), 'C');
  assert.equal(clubInitials('The Boys'), 'TB');
  assert.equal(clubInitials('Henchmen'), 'H');
  assert.equal(clubInitials('A Very Long Club Name'), 'AV');
  assert.equal(avatarToneClass(christopher), avatarToneClass({ ...christopher, display_name: 'Chris' }));
  assert.match(avatarToneClass(christopher), /^avatar-tone-[0-9]$/);
  assert.deepEqual(collectionOwnerIdentity({ owner_id: christopher.id, title: "Christopher's Collection" }, [], christopher), christopher);
  assert.equal(collectionOwnerIdentity({ owner_id: 'kit', title: "Kit’s Collection" }).display_name, 'Kit');
  assert.doesNotMatch(app, /display_name: 'You'/);
  assert.match(app, /className="current-user-label"> — You/);
  assert.match(app, /<ClubMonogram name=\{club\.name\}/);
  assert.match(app, /collectionOwnerIdentity\(collection, userHub\?\.users, account\?\.profile\)/);
  assert.match(app, /className=\{cls\('account-button', account && 'signed-in-account'\)\}/);
  assert.match(app, /<UserAvatar person=\{account\.profile\} size="account"/);
  assert.match(app, /className="account-identity"><UserAvatar person=\{account\.profile\} size="large"/);
  assert.match(styles, /@media\(max-width:760px\)\{[\s\S]*?\.share-collection-button,\.topbar-action-button,\.account-button\{width:40px!important;padding:0!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:0!important\}/);
  assert.match(styles, /\.account-desktop-label\{display:none\}/);
  assert.match(styles, /\.avatar-tone-9 \{ background: #d6cec9; color: #514b47; \}/);
  assert.match(styles, /\.account-button \.user-avatar-account \{ width: 28px/);
});

test('all single-item additions require a shelf and foreign imports open and save optimistically', async () => {
  const app = await read('src/App.jsx');
  const data = await read('src/supabase-data.js');
  const styles = await read('src/public.css');
  const importFlow = app.slice(app.indexOf('{importDraft &&'), app.indexOf('{searchOpen &&'));
  assert.match(data, /collection_id: item\.collection_id/);
  assert.match(app, /selectedMediaCollectionId !== ownCollection\.id/);
  assert.match(app, /loadMediaSnapshot\(\{ fresh: true, collectionId: destinationCollectionId, section: destinationSection, accessToken \}\)/);
  assert.match(app, /sourceCollectionTitle=\{selectedSourceCollectionTitle\}/);
  assert.match(app, />Import to Your Collection<\/Button>/);
  assert.match(app, /setImportDraft\(\{[\s\S]*destination: cachedDestination[\s\S]*shelvesLoading: !destinationReady/);
  assert.match(app, /setSelectedMediaId\(null\);[\s\S]*if \(!destinationReady\) loadImportDestination\(draftKey, ownCollection\.id, destinationSection, cachedDestination\)/);
  assert.match(app, /initialItem=\{importDraft\.item\}/);
  assert.match(app, /mediaForm\(initialItem \|\| \{\}, section === 'screen' \? 'film' : section\)/);
  assert.match(app, /if \(!shelfIds\.length\) \{ setError\('Choose at least one shelf\.'/);
  assert.match(app, /disabled=\{saving \|\| shelvesLoading \|\| Boolean\(shelvesError\) \|\| !shelfIds\.length\}/);
  assert.match(app, /Choose at least one shelf <span>Required<\/span>/);
  assert.match(app, /createMediaItem\(accessToken, \{ \.\.\.item, collection_id: draft\.destination\.collectionId \}\)/);
  assert.match(app, /createdId = created\[0\]\.id;[\s\S]*replaceMediaShelfMemberships\(accessToken, createdId, \[\], shelfIds\)/);
  assert.match(app, /cacheSnapshot\(optimisticDestination, draft\.destination\.collectionId\)/);
  assert.match(app, /added to your collection\.`\);[\s\S]*createMediaItem/);
  assert.match(app, /The item could not be imported\. Your collection was restored/);
  assert.match(app, /permanentlyDeleteMedia\(accessToken, createdId\)/);
  assert.match(app, /currentDestination\.media\.filter\(\(entry\) => entry\.database_id !== temporaryId\)/);
  assert.match(app, /\{sourceCollectionTitle\} - SHELVES/);
  assert.match(styles, /\.drawer-import-button\{[^}]*min-height:32px[^}]*background:transparent/);
  assert.doesNotMatch(styles, /\.drawer-import-button\{[^}]*background:#6f302d/);
  assert.doesNotMatch(importFlow, /setMediaReaction|media_interest|MAIN_WATCHLIST_ID.*createMediaItem/);
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
  assert.match(app, /loadMediaSnapshot\(\{ fresh, collectionId: MAIN_WATCHLIST_ID, section: 'screen', accessToken, mainWatchlistOwnerIds \}\)/);
  assert.match(app, /const defaultClubId = memberClubs\[0\]\.id/);
  assert.match(app, /clubs\.map\(\(club\) => <button/);
  assert.match(app, /if \(clubs\.length <= 1\) return <h1>\{title\}<\/h1>/);
  assert.doesNotMatch(app, /My Watchlist/);
  assert.match(data, /allowedOwnerIds = Array\.isArray\(ownerIds\) \? new Set\(ownerIds\) : null/);
  assert.match(data, /show_in_main_watchlist: 'eq\.true'/);
  assert.match(data, /if \(!interestedIdentities\.has\(identity\) && demand\.length < 2\) continue/);
  assert.doesNotMatch(data, /mirroredShelfCount/);
  assert.match(migration, /create or replace function public\.transfer_club_ownership/);
  assert.match(migration, /Transfer Club ownership before leaving/);
  assert.match(migration, /lower\(p\.username\) = 'christopher'/);
});

test('Users & Clubs uses accessible focused tabs, request states, search, and polished empty states', async () => {
  const app = await read('src/App.jsx');
  const styles = await read('src/public.css');
  assert.match(app, /className="people-tabs" role="tablist"/);
  assert.match(app, /role="tab" aria-selected=\{activeTab === 'friends'\}/);
  assert.match(app, /role="tabpanel" className="people-panel"/);
  assert.match(app, /placeholder="Search approved users"/);
  assert.match(app, /Request sent<\/span><button className="secondary-button"/);
  assert.match(app, /function UserAvatar/);
  assert.match(app, /function ClubMonogram/);
  assert.match(app, /function HubEmpty/);
  assert.match(app, /dialog\.addEventListener\('keydown', trap\)/);
  assert.match(styles, /\.users-dialog\{width:min\(940px/);
  assert.match(styles, /@media\(max-width:760px\)[\s\S]*\.users-dialog\{width:100%!important;height:100dvh/);
  assert.doesNotMatch(app, /Invite approved user|Requested · Cancel/);
});

test('Club cards hide management until requested and owner actions confirm with optimistic rollback', async () => {
  const app = await read('src/App.jsx');
  const social = await read('src/social.js');
  const migration = await read('supabase/migrations/20260719040000_people_clubs_redesign.sql');
  assert.match(app, /expandedClubId === club\.id/);
  assert.match(app, /aria-expanded=\{expanded\}/);
  assert.match(app, /eligibleFriends = users\.filter\(\(user\) => user\.friend/);
  assert.match(app, /title: `Remove \$\{user\.display_name\} from \$\{club\.name\}\?`/);
  assert.match(app, /Previous membership restored/);
  assert.match(app, /title: `Transfer \$\{club\.name\} to \$\{target\?\.display_name\}\?`/);
  assert.match(app, /Ownership must be transferred before leaving/);
  assert.match(social, /rpc\(token, 'remove_club_member'/);
  assert.match(migration, /create or replace function public\.remove_club_member/);
  assert.match(migration, /Club owner access required/);
  assert.match(migration, /target_user_id=auth\.uid\(\).*Transfer ownership before leaving/);
  assert.match(migration, /not public\.are_friends\(target_user_id\)/);
  assert.match(migration, /pending_invitee_ids/);
});

test('media reactions share one identity across matching copies without joining remakes', () => {
  const original = { type: 'film', title: 'The Thing', year: 1982 };
  assert.equal(mediaReactionIdentity(original), mediaReactionIdentity({ type: 'movie', title: 'Thing!', year: 1982 }));
  assert.notEqual(mediaReactionIdentity(original), mediaReactionIdentity({ type: 'film', title: 'The Thing', year: 1951 }));
  assert.notEqual(mediaReactionIdentity(original), mediaReactionIdentity({ type: 'book', title: 'The Thing', year: 1982 }));

  const person = { id: 'person-a', username: 'alex', display_name: 'Alex' };
  const snapshot = { collectionId: 'visible', media: [
    { database_id: 'copy-a', type: 'film', title: 'The Thing', year: 1982, likes: [], priorities: [] },
    { database_id: 'copy-b', type: 'movie', title: 'Thing!', year: 1982, likes: [], priorities: [] },
    { database_id: 'remake', type: 'film', title: 'The Thing', year: 1951, likes: [], priorities: [] },
  ] };
  const liked = applyReactionToSnapshot(snapshot, snapshot.media[0], 'like', true, person);
  assert.deepEqual(liked.media.map((item) => item.likes.map((entry) => entry.id)), [['person-a'], ['person-a'], []]);
  assert.deepEqual(liked.media.map((item) => item.priorities), [[], [], []]);
  const rolledBack = applyReactionToSnapshot(liked, snapshot.media[0], 'like', false, person);
  assert.deepEqual(rolledBack.media.map((item) => item.likes), [[], [], []]);
});

test('likes and Priority Stamps are secure, private from share links, and preserve Watchlist maths', async () => {
  const app = await read('src/App.jsx');
  const data = await read('src/supabase-data.js');
  const styles = `${await read('src/media-layout.css')}\n${await read('src/public.css')}`;
  const migration = await read('supabase/migrations/20260719060000_media_reactions.sql');
  const loveBatchMigration = await read('supabase/migrations/20260719070000_batched_media_loves.sql');
  const secureShare = await read('supabase/migrations/20260719020000_revocable_collection_share_links.sql');
  const openShare = await read('supabase/migrations/20260719050000_open_public_collections.sql');

  assert.match(migration, /create table if not exists public\.media_reactions/);
  assert.match(migration, /drop trigger if exists media_reactions_set_updated_at/);
  assert.match(migration, /drop policy if exists "Signed-in viewers can read visible media reactions"/);
  assert.equal((migration.match(/m\.year::integer/g) || []).length, 2);
  assert.match(migration, /target\.year::integer/);
  assert.equal((migration.match(/media_reaction_work_key\(m\.type::text, m\.title, m\.year::integer\)/g) || []).length, 2);
  assert.match(migration, /media_reaction_work_key\(target\.type::text, target\.title, target\.year::integer\)/);
  assert.match(migration, /target_key, target\.type::text, target\.title, target\.year/);
  assert.match(migration, /primary key \(user_id, kind, work_key\)/);
  assert.match(migration, /reaction_kind not in \('like', 'priority'\)/);
  assert.match(migration, /not public\.profile_is_active\(auth\.uid\(\)\)/);
  assert.match(migration, /not public\.can_view_media_item\(target_media_item_id\)/);
  assert.match(migration, /reaction_kind = 'priority' and target\.type not in \('film', 'television'\)/);
  assert.match(migration, /if reaction_kind = 'priority'[\s\S]*public\.media_interest/);
  assert.match(migration, /grant select on public\.media_reactions to authenticated/);
  assert.doesNotMatch(migration, /grant select on public\.media_reactions to anon/);
  assert.doesNotMatch(migration, /create or replace function public\.can_view_collection/);
  assert.doesNotMatch(migration, /on public\.(collections|shelves|media_items|club_memberships) for/);
  assert.doesNotMatch(secureShare, /media_reactions/);
  assert.doesNotMatch(openShare, /media_reactions/);
  assert.match(loveBatchMigration, /create or replace function public\.set_media_love_batch\(reaction_changes jsonb\)/);
  assert.match(loveBatchMigration, /perform public\.set_media_reaction\([\s\S]*'like'/);
  assert.match(loveBatchMigration, /grant execute on function public\.set_media_love_batch\(jsonb\) to authenticated/);
  assert.match(loveBatchMigration, /revoke all on function public\.set_media_love_batch\(jsonb\) from public, anon/);

  assert.match(data, /reactions\.filter\(\(reaction\) => scopedProfileIds\.has\(reaction\.user_id\)\)/);
  assert.match(app, /function ReactionButton/);
  assert.match(app, /const Icon = isLike \? Heart : Stamp/);
  assert.match(app, /const tooltip = isLike \? summary : \['Priority Watch Stamp', \.\.\.names\]\.join\('\\n'\)/);
  assert.match(app, /`\$\{isLike \? 'Loved' : 'Priority Watch'\} by/);
  assert.doesNotMatch(app, /\bLiked\b|No likes yet|Added to your likes/);
  assert.match(app, /item\.priorities\?\.map\(\(person\) => <span className="card-interest"/);
  assert.match(app, /item\.priorities\?\.map\(\(person\) => <span className="interest-initial"/);
  assert.match(app, /applyReactionToSnapshot\(data, item, kind, enabled, person\)/);
  assert.match(app, /Previous state restored/);
  assert.match(styles, /\.media-card-rating-row/);
  assert.match(styles, /\.reaction-button\.like-reaction\.active/);
  assert.match(app, /people\.length > 0 && 'has-count'/);
  assert.match(styles, /\.media-card-rating-row \{[\s\S]*flex-wrap: wrap;[\s\S]*width: 100%;[\s\S]*max-width: 100%;/);
  assert.match(styles, /\.reaction-controls \{[\s\S]*flex: 0 0 auto;[\s\S]*flex-wrap: nowrap;[\s\S]*max-width: 100%;[\s\S]*margin-left: 0;/);
  assert.match(app, /const REACTION_WRAP_RELEASE_PX = 4/);
  assert.match(app, /function shelfNeedsUniformReactionWrap\(shelfElement, currentlyWrapped = false\)[\s\S]*getPropertyValue\('--reaction-inline-gap'\)[\s\S]*currentlyWrapped \? REACTION_WRAP_RELEASE_PX : -0\.5/);
  assert.match(app, /setUniformReactionWrap\(\(currentlyWrapped\) => shelfNeedsUniformReactionWrap\(shelfElement, currentlyWrapped\)\)/);
  assert.match(styles, /--reaction-inline-gap: 7px;[\s\S]*column-gap: var\(--reaction-inline-gap\)/);
  assert.match(app, /new ResizeObserver\(synchronizeReactionRows\)[\s\S]*querySelectorAll\('\.reaction-controls'\)/);
  assert.match(app, /uniformReactionWrap && 'uniform-reaction-wrap'/);
  assert.match(styles, /\.fixed-set-shelf\.uniform-reaction-wrap \.media-card-rating-row \{[\s\S]*flex-direction: column;/);
  assert.match(styles, /\.reaction-button\.has-count:not\(\.labelled\) \{[\s\S]*width: auto;[\s\S]*gap: 2px;/);
  const cardReactionCount = styles.slice(styles.indexOf('.reaction-button:not(.labelled) small'), styles.indexOf('.reaction-button[data-tooltip]'));
  assert.match(cardReactionCount, /position: static;[\s\S]*background: transparent;[\s\S]*color: #c43c3c;[\s\S]*font-size: 9px;/);
  assert.doesNotMatch(cardReactionCount, /position: absolute|top:|right:|border-radius: 6px/);
  assert.match(styles, /content: attr\(data-tooltip\)/);
  assert.match(styles, /white-space: pre-line;/);
  assert.match(styles, /\.drawer-status-actions \.reaction-controls\.labelled\{[^}]*justify-content:flex-start;[^}]*margin-left:0;/);
  assert.match(styles, /\.drawer-status-actions \.reaction-button\.labelled small\{[^}]*position:static;[^}]*height:auto;[^}]*border-radius:0;[^}]*background:transparent;[^}]*font-size:inherit;/);
});

test('Love changes debounce into an atomic last-state-wins batch with scoped rollback', async () => {
  const app = await read('src/App.jsx');
  const reactions = await read('src/media-reactions.js');
  assert.match(app, /const pendingLoves = useRef\(new Map\(\)\)/);
  assert.match(app, /pendingLoves\.current\.set\(identity/);
  assert.match(app, /const delay = Math\.min\(700 \+ \(loveActivityCount\.current \* 180\), 2_200\)/);
  assert.match(app, /window\.setTimeout\(\(\) => flushPendingLovesRef\.current\(\), delay\)/);
  assert.match(app, /setMediaLoveBatch\(accessToken, batch\)/);
  assert.match(app, /loveFlushChain\.current = loveFlushChain\.current[\s\S]*\.then\(\(\) => setMediaLoveBatch\(accessToken, batch\)\)/);
  assert.match(app, /loveVersions\.current\.get\(change\.identity\) !== change\.version/);
  assert.match(app, /updateLoveSnapshots\(change\.item, change\.initialEnabled, person\)/);
  assert.match(app, /document\.visibilityState === 'hidden'/);
  assert.match(reactions, /body: \{ reaction_changes: reactions \}/);
});

test('the user directory leads the Friends tab and admins opt in to Admin view', async () => {
  const app = await read('src/App.jsx');
  const friendsPanel = app.slice(app.indexOf('id="friends-panel"'), app.indexOf('id="clubs-panel"'));
  assert.ok(friendsPanel.indexOf('DIRECTORY') < friendsPanel.indexOf('REQUESTS'));
  assert.match(app, /const \[viewAsAdmin, setViewAsAdmin\] = useState\(false\)/);
  assert.match(app, /onSignedIn=\{\(nextAccount\) => \{[\s\S]*setViewAsAdmin\(false\)/);
  assert.match(app, /View as Admin/);
  assert.match(app, /personDisplayName\(account\.profile\)\}\{viewAsAdmin \? ' - Admin view' : ''\}/);
  assert.match(app, /account\.profile\?\.role === 'admin' && viewAsAdmin && <Button onClick=\{onManageUsers\}>User Management<\/Button>/);
  assert.match(app, /account\.profile\?\.role === 'admin' && viewAsAdmin \? 'Administrator account'/);
  assert.doesNotMatch(app, /Member view/);
});

test('mobile page width is constrained while poster shelves keep their own horizontal scrolling', async () => {
  const globalStyles = await read('src/styles.css');
  const publicStyles = await read('src/public.css');
  const mediaStyles = await read('src/media-layout.css');

  assert.match(globalStyles, /html\{max-width:100%;overflow-x:clip/);
  assert.match(globalStyles, /body,#root\{width:100%;max-width:100%;overflow-x:clip\}/);
  assert.match(globalStyles, /\.app-shell\{width:100%;max-width:100%;[\s\S]*overflow-x:clip/);
  assert.match(publicStyles, /\.collection-tools\{min-width:0;align-items:stretch;flex-direction:column\}/);
  assert.match(publicStyles, /\.modal-layer\{padding:12px;overflow-y:auto\}/);
  assert.match(publicStyles, /\.modal-layer>\.media-edit-dialog,[\s\S]*width:100%!important;max-width:100%!important;max-height:calc\(100dvh - 24px\)/);
  assert.match(publicStyles, /\.users-dialog\{width:100%!important;height:100dvh/);
  assert.match(mediaStyles, /\.poster-track \{[\s\S]*overflow-x: auto;/);
  assert.match(mediaStyles, /@media \(max-width: 760px\)[\s\S]*\.media-drawer \{[\s\S]*width: 100%;/);
  assert.doesNotMatch(mediaStyles, /@media \(max-width: 760px\)[\s\S]*\.media-drawer \{[\s\S]*width: 100vw;/);
});

test('reaction identities are visible only to self, Friends, and shared Club members', async () => {
  const migration = await read('supabase/migrations/20260720010000_restrict_media_reaction_visibility.sql');
  assert.match(migration, /create or replace function public\.can_view_media_reaction\(target_user_id uuid\)/);
  assert.match(migration, /target_user_id = auth\.uid\(\)/);
  assert.match(migration, /public\.are_friends\(target_user_id\)/);
  assert.match(migration, /public\.shares_club_with\(target_user_id\)/);
  assert.doesNotMatch(migration, /can_view_collection|is_kit_profile|is_admin/);
  assert.match(migration, /revoke all on function public\.can_view_media_reaction\(uuid\) from public, anon/);
  assert.match(migration, /grant execute on function public\.can_view_media_reaction\(uuid\) to authenticated/);
});

test('media filters live in an Advanced Search dialog and mobile top-bar icons are centred', async () => {
  const app = await read('src/App.jsx');
  const styles = await read('src/public.css');
  assert.match(app, /function AdvancedSearchDialog/);
  assert.match(app, /aria-labelledby="advanced-search-title"/);
  assert.match(app, /<div className="media-search-row">[\s\S]*Advanced Search/);
  assert.doesNotMatch(app, /<div className=\{cls\('media-filters'/);
  assert.match(app, /advancedSearchOpen && <AdvancedSearchDialog[\s\S]*<MultiSelect label="All lists"/);
  assert.match(styles, /\.advanced-filter-grid\{display:grid/);
  assert.match(styles, /@media\(max-width:760px\)[\s\S]*?\.media-search-row\{grid-template-columns:minmax\(0,1fr\) 40px\}/);
  assert.match(styles, /\.media-filters \.media-search\{grid-column:1\/-1!important\}/);
  assert.match(styles, /\.share-collection-button,\.topbar-action-button,\.account-button\{[^}]*display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:0!important/);
});

test('signed-in navigation is remembered safely without persisting shared-link destinations', async () => {
  const app = await read('src/App.jsx');
  assert.match(app, /const LAST_PAGE_KEY_PREFIX = 'media-room:last-page:'/);
  assert.match(app, /readLastPage\(account\.profile\.id\)/);
  assert.match(app, /const \[collectionsReadyFor, setCollectionsReadyFor\] = useState\(null\)/);
  assert.match(app, /const requestedAccountScope = accountScope/);
  assert.match(app, /setCollectionsReadyFor\(requestedAccountScope\)/);
  assert.match(app, /const collectionsPending = collectionsReadyFor !== accountScope/);
  assert.match(app, /displayedCollections\.some\(\(collection\) => collection\.id === remembered\?\.collectionId\)/);
  assert.match(app, /if \(!sharedMode\) writeLastPage\(account\?\.profile\?\.id, nextCollectionId, 'screen'\)/);
  assert.match(app, /initialSection=\{rememberedSection\.current\}/);
  assert.match(app, /onSectionChange=\{\(section\) => \{ rememberedSection\.current = section; if \(!sharedMode\) writeLastPage/);
});

test('initial opening progresses from branding to a responsive skeleton without affecting page navigation', async () => {
  const app = await read('src/App.jsx');
  const styles = await read('src/public.css');
  assert.match(app, /function InitialLoadingScreen\(\{ stage \}\)/);
  assert.match(app, /Opening Kit’s Media Room…/);
  assert.match(app, /setInitialLoadStage\('skeleton'\),\s*1200/);
  assert.match(app, /setInitialLoadStage\('detailed'\),\s*1600/);
  assert.match(app, /const initialLoading = loading \|\| authLoading \|\| collectionsLoading/);
  assert.match(app, /if \(initialLoading\)/);
  assert.match(app, /<main className=\{cls\(collectionLoading && 'collection-loading'\)\}/);
  assert.match(styles, /\.initial-skeleton\{[^}]*grid-template-columns:186px minmax\(0,1fr\)[^}]*overflow:hidden/);
  assert.match(styles, /\.initial-skeleton\.is-detailed \.skeleton-detail\{opacity:1;transform:none\}/);
  assert.match(styles, /@media\(max-width:760px\)\{[\s\S]*?\.initial-skeleton\{grid-template-columns:1fr\}/);
  assert.match(styles, /@media\(prefers-reduced-motion:reduce\)/);
});

test('collection loading is section-scoped, persistent, and selectively prefetched', async () => {
  const app = await read('src/App.jsx');
  const data = await read('src/supabase-data.js');
  const cache = await read('src/section-cache.js');
  const migration = await read('supabase/migrations/20260720030000_responsive_section_rpc.sql');

  assert.match(app, /section: rememberedSection\.current/);
  assert.match(app, /memory\?\.loadedSections\?\.includes\(section\)/);
  assert.match(app, /sectionRequests\.current\.get\(requestKey\)/);
  assert.match(app, /scheduleIdle/);
  assert.match(app, /onMouseOver=\{warmCollectionFromNav\} onFocusCapture=\{warmCollectionFromNav\} onPointerDown=\{warmCollectionFromNav\}/);
  assert.doesNotMatch(app, /for \(const collection of displayedCollections\)/);
  assert.match(app, /setOwnCollection\(collections\.find/);
  assert.match(cache, /indexedDB\.open\(DATABASE_NAME, SECTION_CACHE_VERSION\)/);
  assert.match(cache, /accountScope/);
  assert.match(cache, /snapshot\?\.storage === 'supabase' && snapshot\.collectionId && !snapshot\.shared/);
  assert.match(data, /target_section: section/);
  assert.match(data, /section: 'eq\.' \+ section/);
  assert.match(migration, /create or replace function public\.load_collection_section/);
  assert.match(migration, /where case target_section/);
  assert.match(migration, /if payload is null or auth\.uid\(\) is null/);
  assert.doesNotMatch(migration, /grant select on public\.media_reactions to anon/);
  assert.match(data, /Never turn a failed reaction read into an empty successful snapshot/);
});

test('Main Watchlist uses an account-and-club-scoped stale cache with a progressive loading state', async () => {
  const app = await read('src/App.jsx');
  const data = await read('src/supabase-data.js');
  const layout = await read('src/media-layout.css');
  const snapshot = {
    storage: 'supabase', collectionId: 'main-watchlist', mainWatchlist: true,
    loadedSections: ['screen'], mediaShelves: [], media: [],
  };

  assert.equal(canPersistSnapshot(snapshot), true);
  assert.equal(sectionSnapshot(snapshot, 'screen')?.mainWatchlist, true);
  assert.match(app, /const mainWatchlistCacheScope = `main-watchlist:\$\{mainWatchlistScopeKey\}`/);
  assert.match(app, /mainWatchlistMemoryScope\.current === mainWatchlistScopeKey/);
  assert.match(app, /scope: targetCollectionId === MAIN_WATCHLIST_ID \? mainWatchlistCacheScope : 'collection'/);
  assert.match(app, /setCollectionLoading\(!cached\)/);
  assert.match(app, /const fetchMainWatchlist = \(\{ fresh = false \} = \{\}\) =>/);
  assert.match(app, /scheduleIdle\(async \(\) => \{[\s\S]*collectionId: MAIN_WATCHLIST_ID[\s\S]*await fetchMainWatchlist\(\)/);
  assert.match(app, /<SectionLoadingState branded=\{data\.mainWatchlist\} \/>/);
  assert.match(app, /Opening Main Watchlist…/);
  assert.match(layout, /\.watchlist-loading-brand/);
  assert.match(layout, /\.watchlist-loading-skeleton\.is-detailed/);
  assert.match(data, /const \[publicProfiles, reactions, shelves, allInterestRows\] = await Promise\.all/);
  assert.doesNotMatch(data, /candidateMemberships|candidateMediaItems/);
});

test('section snapshot merging keeps visited tabs and cached drawer details', () => {
  const current = {
    collectionId: 'collection-a', loadedSections: ['screen'], detailedSections: [],
    collectionDescriptions: { screen: 'Screen' },
    mediaShelves: [{ shelf_id: 'screen-shelf', section: 'screen' }],
    media: [{ database_id: 'screen-item', type: 'film', description: 'Cached', details_loaded: true }],
  };
  const books = {
    collectionId: 'collection-a', loadedSections: ['book'],
    collectionDescriptions: { book: 'Books' },
    mediaShelves: [{ shelf_id: 'book-shelf', section: 'book' }],
    media: [{ database_id: 'book-item', type: 'book', details_loaded: false }],
  };
  const merged = mergeSectionSnapshot(current, books);
  assert.deepEqual(merged.loadedSections, ['screen', 'book']);
  assert.deepEqual(merged.mediaShelves.map((row) => row.shelf_id), ['screen-shelf', 'book-shelf']);
  assert.equal(merged.media.find((row) => row.database_id === 'screen-item').description, 'Cached');
});

test('section snapshot merging is idempotent and heals cache-network duplicates', async () => {
  const app = await read('src/App.jsx');
  const screen = {
    collectionId: 'collection-a', loadedSections: ['screen'], detailedSections: [],
    collectionDescriptions: { screen: 'Screen' },
    mediaShelves: [{ shelf_id: 'screen-shelf', section: 'screen' }],
    media: [{ database_id: 'screen-item', item_id: 'screen-item', type: 'film' }],
  };
  const books = {
    collectionId: 'collection-a', loadedSections: ['book'], detailedSections: [],
    collectionDescriptions: { book: 'Books' },
    mediaShelves: [{ shelf_id: 'book-shelf', section: 'book' }],
    media: [{ database_id: 'book-item', item_id: 'book-item', type: 'book' }],
  };
  const combined = mergeSectionSnapshot(screen, books);
  const repeated = mergeSectionSnapshot(combined, combined);
  const corrupted = {
    ...repeated,
    mediaShelves: [...repeated.mediaShelves, ...repeated.mediaShelves],
    media: [...repeated.media, ...repeated.media],
  };
  const healed = mergeSectionSnapshot(corrupted, books);

  assert.deepEqual(repeated.mediaShelves.map((row) => row.shelf_id), ['screen-shelf', 'book-shelf']);
  assert.deepEqual(repeated.media.map((row) => row.database_id), ['screen-item', 'book-item']);
  assert.deepEqual(healed.mediaShelves.map((row) => row.shelf_id), ['screen-shelf', 'book-shelf']);
  assert.deepEqual(healed.media.map((row) => row.database_id), ['screen-item', 'book-item']);
  assert.match(app, /mergeLoadedSection\(targetCollectionId, loaded\);\s*return loaded;/);
});

test('drawer details load once while posters use tiered viewport prioritisation', async () => {
  const app = await read('src/App.jsx');
  const layout = await read('src/media-layout.css');
  assert.match(app, /detailRequests\.current\.get\(mediaItemId\)/);
  assert.match(app, /loadMediaDetails\(\{ mediaItemId, accessToken \}\)/);
  assert.match(app, /details_loaded: true/);
  assert.match(app, /function ProgressivePoster/);
  assert.match(app, /IntersectionObserver/);
  assert.match(app, /rootMargin: '1400px 500px'/);
  assert.match(app, /loading=\{eager \? 'eager' : 'lazy'\}/);
  assert.match(app, /fetchPriority=\{eager \? 'high' : 'auto'\}/);
  assert.match(app, /function cardPosterUrl/);
  assert.match(app, /\/t\/p\/w342\//);
  assert.match(layout, /content-visibility: auto/);
  assert.match(layout, /contain-intrinsic-size: auto 720px/);
});

test('shelf removal uses the same muted control styling as the edit icon', async () => {
  const app = await read('src/App.jsx');
  const publicStyles = await read('src/public.css');
  const layoutStyles = await read('src/media-layout.css');
  assert.match(app, /className="delete-shelf" aria-label=\{`Move \$\{shelf\.name\} to Bin`\}[\s\S]*?<Trash2 size=\{15\} \/>/);
  assert.doesNotMatch(app, /className="delete-shelf"[\s\S]{0,180}<X size=\{15\}/);
  assert.doesNotMatch(publicStyles, /\.delete-shelf\{[^}]*opacity:/);
  assert.doesNotMatch(layoutStyles, /\.shelf-head \.delete-shelf\s*\{[^}]*color:/);
});

test('the Media Room ships an installable standalone web app shell without caching shared data', async () => {
  const html = await read('index.html');
  const main = await read('src/main.jsx');
  const worker = await read('public/sw.js');
  const manifest = JSON.parse(await read('public/manifest.webmanifest'));
  const icon192 = await readFile(new URL('../public/icons/media-room-192.png', import.meta.url));
  const icon512 = await readFile(new URL('../public/icons/media-room-512.png', import.meta.url));
  const maskable512 = await readFile(new URL('../public/icons/media-room-maskable-512.png', import.meta.url));

  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'any'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable'));
  assert.ok(icon192.length > 1000 && icon512.length > 1000 && maskable512.length > 1000);
  assert.match(html, /rel="manifest" href="%BASE_URL%manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon"/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(main, /navigator\.serviceWorker\.register\(workerUrl, \{ scope \}\)/);
  assert.match(worker, /request\.method !== 'GET' \|\| url\.origin !== self\.location\.origin/);
  assert.match(worker, /if \(url\.href === APP_ROOT\)/);
  assert.doesNotMatch(worker, /supabase|collection_share|media_reactions/);
});

const shelfItems = (count, title = (index) => `Item ${index + 1}`) => Array.from({ length: count }, (_, index) => ({ database_id: `media-${index + 1}`, title: title(index) }));

test('legacy shelf groups convert to the alternating canonical set order', () => {
  const items = shelfItems(30);
  assert.deepEqual(legacyVisualOrderToCanonical(items).map((item) => item.database_id), [
    ...shelfItems(7).map((item) => item.database_id),
    ...Array.from({ length: 7 }, (_, index) => `media-${index + 16}`),
    ...Array.from({ length: 7 }, (_, index) => `media-${index + 8}`),
    ...Array.from({ length: 7 }, (_, index) => `media-${index + 23}`),
    'media-15', 'media-30',
  ]);
  assert.deepEqual(legacyVisualOrderToCanonical(shelfItems(7)).map((item) => item.database_id), shelfItems(7).map((item) => item.database_id));
});

test('canonical shelf boundaries place 8, 15, 22 and later sets in paired rows', () => {
  const segments = pairedShelfSegments(shelfItems(43));
  assert.equal(segments[0][0][0].database_id, 'media-1');
  assert.equal(segments[0][1][0].database_id, 'media-8');
  assert.equal(segments[1][0][0].database_id, 'media-15');
  assert.equal(segments[1][1][0].database_id, 'media-22');
  assert.equal(segments[2][0][0].database_id, 'media-29');
  assert.equal(segments[2][1][0].database_id, 'media-36');
  assert.equal(segments[3][0][0].database_id, 'media-43');
});

test('empty-slot drops preserve the original gap without compacting another set', () => {
  const initial = createShelfDraft(shelfItems(14));
  const movedToOverflow = moveToOverflow(initial, 'media-3', 1);
  assert.equal(movedToOverflow.sets[0].slots[2], null);
  assert.equal(movedToOverflow.sets[1].overflow[0].database_id, 'media-3');
  const restored = dropIntoSlot(movedToOverflow, 'media-3', 0, 2);
  assert.equal(restored.sets[0].slots[2].database_id, 'media-3');
  assert.equal(restored.sets[1].overflow.length, 0);
});

test('before and after insertion stays local and creates explicit overflow', () => {
  const after = insertBeside(createShelfDraft(shelfItems(14)), 'media-3', 'media-10', 'after');
  assert.equal(after.sets[0].slots[2], null);
  assert.deepEqual(after.sets[1].slots.map((item) => item.database_id), ['media-8', 'media-9', 'media-10', 'media-3', 'media-11', 'media-12', 'media-13']);
  assert.equal(after.sets[1].overflow[0].database_id, 'media-14');
  assert.equal(after.sets[2].slots.every((item) => item === null), true);
  const before = insertBeside(createShelfDraft(shelfItems(14)), 'media-3', 'media-10', 'before');
  assert.deepEqual(before.sets[1].slots.slice(0, 4).map((item) => item.database_id), ['media-8', 'media-9', 'media-3', 'media-10']);
});

test('direct position editing shifts items within a set without creating overflow', () => {
  const reordered = moveToPosition(createShelfDraft(shelfItems(7)), 'media-2', 6);
  assert.deepEqual(reordered.sets[0].slots.map((item) => item.database_id), ['media-1', 'media-3', 'media-4', 'media-5', 'media-6', 'media-2', 'media-7']);
  assert.equal(reordered.sets[0].overflow.length, 0);
  assert.deepEqual(validateShelfDraft(reordered), []);
});

test('direct position editing across sets uses local insertion rules and accepts a valid partial final set', () => {
  const moved = moveToPosition(createShelfDraft(shelfItems(14)), 'media-3', 8);
  assert.equal(moved.sets[0].slots[2], null);
  assert.equal(moved.sets[1].slots[0].database_id, 'media-3');
  assert.equal(moved.sets[1].overflow[0].database_id, 'media-14');
  const repaired = dropIntoSlot(moved, 'media-14', 0, 2);
  assert.deepEqual(validateShelfDraft(repaired), []);
  assert.equal(serializeShelfDraft(repaired).length, 14);
  assert.deepEqual(validateShelfDraft(createShelfDraft(shelfItems(10))), []);
});

test('save validation reports overflow, gaps and incomplete earlier sets', () => {
  const overflow = insertBeside(createShelfDraft(shelfItems(14)), 'media-3', 'media-10', 'after');
  assert.ok(validateShelfDraft(overflow).some((error) => /Set 2 contains 8 items/.test(error)));
  assert.ok(validateShelfDraft(overflow).some((error) => /Set 1 has an empty position/.test(error)));
  const gappedFinal = createShelfDraft(shelfItems(8));
  gappedFinal.sets[1].slots[1] = gappedFinal.sets[1].slots[0];
  gappedFinal.sets[1].slots[0] = null;
  assert.ok(validateShelfDraft(gappedFinal).some((error) => /filled continuously/.test(error)));
});

test('matching titles remain distinct while membership cloning or loss is rejected', () => {
  const duplicates = shelfItems(2, () => 'Killing Gunther');
  assert.deepEqual(validateShelfDraft(createShelfDraft(duplicates)), []);
  const corrupted = createShelfDraft(duplicates);
  corrupted.sets[0].slots[1] = corrupted.sets[0].slots[0];
  assert.ok(validateShelfDraft(corrupted).some((error) => /membership unexpectedly/.test(error)));
});

test('numbered shelves and fixed segments are shelf-scoped, responsive and migration-backed', async () => {
  const app = await read('src/App.jsx');
  const data = await read('src/supabase-data.js');
  const layout = await read('src/media-layout.css');
  const migration = await read('supabase/migrations/20260720040000_fixed_seven_item_shelf_sets.sql');
  const writes = await read('src/media-write.js');
  assert.match(app, /Numbered shelf/);
  assert.match(app, /shelfRank=\{shelf\.numbered \?/);
  assert.match(app, /segmentIndex \* 14 \+ rowIndex \* 7 \+ itemIndex \+ 1/);
  assert.match(app, /setDisplayItems\(nextItems\.filter\([\s\S]*try \{ await onReorder[\s\S]*setDisplayItems\(previous\); throw error/);
  assert.match(app, /Your draft is still here; try again or cancel to restore the last saved order/);
  assert.match(data, /numbered: Boolean\(shelf\.is_numbered\)/);
  assert.match(layout, /grid-template-columns: repeat\(7, minmax\(var\(--shelf-card-min\), 1fr\)\)/);
  assert.match(layout, /--shelf-card-min: 68px/);
  assert.match(layout, /@container shelf-card \(max-width: 120px\)/);
  assert.match(layout, /@media \(max-width: 580px\)[\s\S]*--shelf-card-min: 120px/);
  assert.match(layout, /poster-segment\.has-divider::after[\s\S]*top: 3px;[\s\S]*bottom: 3px;/);
  assert.match(migration, /add column if not exists is_numbered boolean not null default false/);
  assert.match(migration, /row_number\(\) over \(partition by shelf_id order by segment_index, lane_index, lane_offset/);
  assert.match(migration, /public\.can_manage_collection\(collection_id\)/);
  assert.doesNotMatch(writes.match(/export async function reorderShelfMedia[\s\S]*?\n\}/)?.[0] || '', /for \(let index/);
});

test('numbered ranks stay on memberships and can differ between source shelves', () => {
  const mapped = mapSnapshot(
    { id: 'collection', owner_id: 'owner', title: 'Collection' },
    [
      { id: 'shelf-a', section: 'screen', name: 'A', is_numbered: true, position: 1000 },
      { id: 'shelf-b', section: 'screen', name: 'B', is_numbered: true, position: 2000 },
    ],
    [{ id: 'media-a', type: 'film', title: 'Same record', platforms: [], genres: [] }],
    [
      { shelf_id: 'shelf-a', media_item_id: 'media-a', position: 2000 },
      { shelf_id: 'shelf-b', media_item_id: 'media-a', position: 5000 },
    ],
  );
  assert.equal(mapped.mediaShelves.every((shelf) => shelf.numbered), true);
  assert.deepEqual(mapped.media[0].list_positions, { 'shelf-a': 2000, 'shelf-b': 5000 });
});
