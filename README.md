# Kit’s Media Room — GitHub Pages Edition

This is the **GitHub Pages version** of Kit’s Media Room.

It is a separate project from the editable **Local Media Room**:

- **Local Media Room**: the editable app backed by `data/media.db`.
- **GitHub Pages version**: the public, read-only site backed by `public/media-data.json`.
- This folder is the local working copy of the GitHub Pages version, but it should still be called the **GitHub Pages version**, not “local”.

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

## Supabase foundation

The first Supabase pass is now included as a database-only migration. It does not change the current static site or add login/editing screens.

- Run [the Supabase foundation setup](docs/SUPABASE-FOUNDATION.md) when you are ready to create the Supabase project.
- The migration includes multi-user data modelling, pending/approved/rejected registrations, admin and ownership RLS policies, and a future-safe interest-marker table.
- Never put a Supabase service-role key in this repository or browser code.

## Supabase application setup

Apply every file in `supabase/migrations` in timestamp order before using editing or registration. The site keeps a static public snapshot only as an outage/import fallback; when Supabase is available, approved public collections, shelf membership, edits, ordering and interest markers are read from it.

For protected poster enrichment, deploy the included Edge Function and set its provider secret:

```powershell
supabase functions deploy enrich-poster
supabase secrets set TMDB_API_KEY=your_tmdb_key
```

The browser never receives this key. The function requires the signed-in collection owner and supports searching TMDB candidates, saving an owner-selected poster URL, and confidently enriching up to 50 Film & TV rows after a bulk import. Exact-title matches are applied automatically; ambiguous matches remain blank.

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
