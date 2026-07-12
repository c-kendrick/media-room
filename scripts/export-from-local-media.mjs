import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceArg = process.argv[2];
const outputPath = path.join(root, 'public', 'media-data.json');

if (!sourceArg) {
  console.error('Usage: npm run import-local -- "C:\\path\\to\\kits-media-site\\data\\media.db"');
  process.exit(1);
}

const sourcePath = path.resolve(sourceArg);
if (!fs.existsSync(sourcePath)) {
  console.error(`Local Media Room database not found: ${sourcePath}`);
  process.exit(1);
}

const db = new DatabaseSync(sourcePath, { readOnly: true });
const requiredTables = ['media_items', 'media_shelves', 'media_lists', 'media_genres', 'media_platforms'];
const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
for (const table of requiredTables) {
  if (!tables.has(table)) {
    db.close();
    console.error(`The selected database is missing the required table: ${table}`);
    console.error('Choose data\\media.db from the Local Media Room project, not the original Second Brain database.');
    process.exit(1);
  }
}

const mediaRows = db.prepare(`
  SELECT item_id, title, type, year, status, priority, notes, poster_url,
         creator, format, rating, added_at, updated_at, description, director, runtime
  FROM media_items
  WHERE deleted_at IS NULL
  ORDER BY rowid
`).all();

const shelfRows = db.prepare(`
  SELECT shelf_id, section, name, position, built_in, created_at, updated_at
  FROM media_shelves
  WHERE deleted_at IS NULL
  ORDER BY section, position, created_at
`).all();

const listRows = db.prepare(`
  SELECT ml.item_id, ml.list_id, ml.position
  FROM media_lists ml
  JOIN media_items mi ON mi.item_id = ml.item_id
  WHERE mi.deleted_at IS NULL
  ORDER BY ml.item_id, ml.position, ml.list_id
`).all();

const genreRows = db.prepare(`
  SELECT mg.item_id, mg.genre
  FROM media_genres mg
  JOIN media_items mi ON mi.item_id = mg.item_id
  WHERE mi.deleted_at IS NULL
  ORDER BY mg.item_id, mg.genre
`).all();

const platformRows = db.prepare(`
  SELECT mp.item_id, mp.platform
  FROM media_platforms mp
  JOIN media_items mi ON mi.item_id = mp.item_id
  WHERE mi.deleted_at IS NULL
  ORDER BY mp.item_id, mp.platform
`).all();

db.close();

const lists = new Map();
const positions = new Map();
const genres = new Map();
const platforms = new Map();

for (const row of listRows) {
  if (!lists.has(row.item_id)) lists.set(row.item_id, []);
  if (!positions.has(row.item_id)) positions.set(row.item_id, {});
  lists.get(row.item_id).push(row.list_id);
  positions.get(row.item_id)[row.list_id] = Number(row.position || 0);
}
for (const row of genreRows) {
  if (!genres.has(row.item_id)) genres.set(row.item_id, []);
  genres.get(row.item_id).push(row.genre);
}
for (const row of platformRows) {
  if (!platforms.has(row.item_id)) platforms.set(row.item_id, []);
  platforms.get(row.item_id).push(row.platform);
}

const media = mediaRows.map((item) => ({
  ...item,
  lists: lists.get(item.item_id) || (item.status ? [item.status] : []),
  list_positions: positions.get(item.item_id) || {},
  genres: genres.get(item.item_id) || [],
  platforms: platforms.get(item.item_id) || [],
}));

const mediaShelves = shelfRows.map((shelf) => ({
  ...shelf,
  built_in: Boolean(shelf.built_in),
}));

const snapshot = {
  generatedAt: new Date().toISOString(),
  storage: 'static-json',
  schemaVersion: 1,
  media,
  mediaShelves,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
if (fs.existsSync(outputPath)) {
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  fs.copyFileSync(outputPath, `${outputPath}.backup-${stamp}`);
}
fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

const memberships = listRows.length;
const posters = media.filter((item) => item.poster_url).length;
console.log('GitHub Pages media export complete.');
console.log(`Source: ${sourcePath}`);
console.log(`Output: ${outputPath}`);
console.log(`Media items: ${media.length}`);
console.log(`Shelves: ${mediaShelves.length}`);
console.log(`Shelf memberships: ${memberships}`);
console.log(`Items with posters: ${posters}`);
console.log('Only media-specific, public-display fields were exported.');
