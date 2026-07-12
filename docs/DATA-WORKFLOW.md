# Data workflow

## Project naming convention

- **Local** means the editable Local Media Room by default.
- **GitHub Pages version** means this public/read-only project, even when discussing the copy stored on Kit’s PC.

## Data flow

```text
Local Media Room
  data/media.db
        |
        | npm run import-local -- "...\media.db"
        v
GitHub Pages version
  public/media-data.json
        |
        | npm run build
        v
  dist/
        |
        v
GitHub Pages
```

The export uses a strict field whitelist. It never copies the SQLite database into the GitHub Pages project.

## Updating the public snapshot

From the GitHub Pages project folder:

```powershell
npm run import-local -- "C:\path\to\kits-media-site\data\media.db"
npm run inspect-data
npm run dev
```

Each export creates a timestamped backup beside `public/media-data.json`. These backups are ignored by Git.

## What is canonical for now

Until Supabase is introduced:

- The Local Media Room database is canonical.
- `public/media-data.json` is a published snapshot.
- Never edit `media-data.json` manually unless repairing an emergency problem.
- Do not make collection changes in the GitHub Pages version.
