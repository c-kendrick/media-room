# Kit’s Media Room — GitHub Pages Edition

This is the GitHub Pages frontend for Kit’s Media Room. Supabase now provides authentication, multi-user collections, editing, shelf membership, Main Watchlist mirrors, priority stamps, reversible account deactivation, bulk import and protected poster enrichment. `public/media-data.json` remains an outage/import fallback for Kit’s original collection.

No Second Brain notes, projects, university records, fitness data, database file, API keys, or server code are included in the public dataset.

## What works

- Film & TV, Books, and Video Games sections
- Dynamic shelves and saved shelf ordering from the Local Media Room
- Two-row shelves with smooth horizontal scrolling
- Search and multi-select filters
- Random picker based on the current section and filters
- Large media drawer with poster, description, genres, format/platform, year, and shelf membership
- GitHub Pages-compatible Vite build
- Included GitHub Actions deployment workflow

## Supabase application

- Run [the Supabase foundation setup](docs/SUPABASE-FOUNDATION.md) when you are ready to create the Supabase project.
- Apply every migration in `supabase/migrations` in timestamp order.
- Deploy `supabase/functions/enrich-poster` and `supabase/functions/enrich-details` after provider changes.
- Keep provider keys in Supabase Edge Function secrets, never Vite or GitHub.
- Never put a Supabase service-role key in this repository or browser code.

## Supabase application setup

Apply every file in `supabase/migrations` in timestamp order before using editing or registration. The site keeps a static public snapshot only as an outage/import fallback; when Supabase is available, approved public collections, shelf membership, edits, ordering and interest markers are read from it.

For protected poster enrichment, deploy the included Edge Function and set the provider secrets you use:

```powershell
supabase functions deploy enrich-poster
supabase functions deploy enrich-details
supabase secrets set TMDB_API_KEY=your_tmdb_key
supabase secrets set GOOGLE_BOOKS_API_KEY=your_google_books_key
supabase secrets set STEAMGRIDDB_API_KEY=your_steamgriddb_key
supabase secrets set RAWG_API_KEY=your_rawg_key
```

The browser never receives these keys. Poster enrichment is a separate collection tool from Bulk Import and can process up to 50 blank posters in the current section. Collection owners and administrators can run it; automatic enrichment never replaces existing artwork. It supports TMDB for Film & TV, Google Books with an Open Library fallback for books, and SteamGridDB for games. Exact matches are applied automatically; ambiguous matches remain blank.

Detail enrichment also processes at most 50 items in the current section and fills blank fields only. TMDB provides Film & TV details, Google Books provides book details (its key is optional for lower-volume use), and RAWG provides video-game details. Individual item results remain reviewable before saving.

## 1. Set up the GitHub Pages version on your PC

Extract this project somewhere separate from the Local Media Room, for example:

```text
C:\Users\Christopher\Desktop\kits-media-github-pages
```

Open PowerShell in that folder and run:

```powershell
npm install
npm run dev
```

Open:

```text
http://localhost:4175
```

This package already includes a media snapshot so the site can be tested immediately.

## 2. Copy the latest media from the Local Media Room

Make all edits in the **Local Media Room** first. When it looks correct, stop the Local Media Room server and run this command from the GitHub Pages project:

```powershell
npm run import-local -- "C:\Users\Christopher\Desktop\kits-media-site\data\media.db"
```

Change the path if your Local Media Room is stored elsewhere.

This command does not copy the SQLite database. It reads the database and writes only safe Media display data to:

```text
public\media-data.json
```

It exports:

- Media titles and types
- Years
- Posters
- Descriptions and notes
- Creators and directors
- Formats and platforms
- Genres
- Shelves, shelf order, memberships, and item order
- Ratings and runtimes where present

It does not export any other Second Brain tables.

Check the result with:

```powershell
npm run inspect-data
```

Then run or refresh the GitHub Pages version:

```powershell
npm run dev
```

## 3. Test the production build

```powershell
npm run build
npm run preview
```

Open:

```text
http://localhost:4176
```

The production files are generated in `dist`.

## Ongoing workflow before Supabase

1. Edit Media in the Local Media Room.
2. Run `npm run import-local -- "...\media.db"` in this GitHub Pages project.
3. Test with `npm run dev`.
4. Commit and push the changed `public/media-data.json` and any site code to GitHub.
5. GitHub Actions rebuilds and publishes the site.

## Important privacy rule

Never copy `media.db`, `second-brain.db`, `.env`, TMDB keys, SteamGridDB keys, or other secrets into this repository. The included `.gitignore` excludes common local build files, but always review the files before publishing.

See `docs/DATA-WORKFLOW.md` for the data flow and `docs/GITHUB-PAGES-SETUP.md` for the later deployment process.
