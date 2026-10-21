import { defineConfig } from 'vitest/config';

// Relative base so the build works on GitHub Pages under /<repo>/ and from any static host.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: { include: ['tests/**/*.test.ts'] },
});
