import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages serves a project site under /<repo>/, so the base must match the
// repository name. Change this if the repo is renamed or served from a custom domain.
export default defineConfig({
  base: '/LogIngestionPortal/',
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
