import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
