import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// The version a finished run is stamped with: package version plus a short hash of config/tuning.json,
// so evenings played under different rules never look alike.
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
const tuningHash = createHash('sha1').update(readFileSync('config/tuning.json')).digest('hex').slice(0, 8);

// Relative base so the build works on GitHub Pages under /<repo>/ and from any static host.
export default defineConfig({
  base: './',
  define: { __BLOOM_VERSION__: JSON.stringify(`${pkg.version}+${tuningHash}`) },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: { include: ['tests/**/*.test.ts'] },
});
