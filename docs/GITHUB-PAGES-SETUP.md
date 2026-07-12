# GitHub Pages deployment preparation

The project already contains:

- A relative Vite base path suitable for a repository-hosted Pages site
- `.github/workflows/deploy.yml`
- A static media dataset
- No Node server or SQLite runtime requirement

When it is time to deploy:

1. Create an empty GitHub repository.
2. Put the contents of this project at the repository root.
3. Commit and push to the `main` branch.
4. In the repository, open **Settings → Pages**.
5. Set **Source** to **GitHub Actions**.
6. Open the **Actions** tab and allow the deployment workflow to finish.

The site will be built from `main` whenever changes are pushed.

Do not add API credentials to Vite environment variables. Anything bundled into a public frontend can be inspected. Poster enrichment will remain in the Local Media Room until a protected Supabase or edge-function backend is added.
