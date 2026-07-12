import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative paths allow the same build to work at username.github.io/repository-name/
  // without hard-coding the repository name.
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 4175,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4176,
    strictPort: true,
  },
  build: { outDir: 'dist' },
});
