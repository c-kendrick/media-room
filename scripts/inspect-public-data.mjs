import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataPath = path.join(root, 'public', 'media-data.json');
if (!fs.existsSync(dataPath)) {
  console.error(`Missing ${dataPath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const byType = Object.groupBy(data.media || [], (item) => item.type || 'unknown');
console.log(`Generated: ${data.generatedAt}`);
console.log(`Media items: ${(data.media || []).length}`);
console.log(`Shelves: ${(data.mediaShelves || []).length}`);
for (const [type, items] of Object.entries(byType)) console.log(`${type}: ${items.length}`);
console.log(`Items with posters: ${(data.media || []).filter((item) => item.poster_url).length}`);
