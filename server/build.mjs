// Bundles server/src/main.ts, the game's rules (src/core) and config/tuning.json into one file:
// server/dist/server.mjs. That single file is all the owner copies to the server.
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
// Same formula as vite.config.ts, so a run from this build's client carries exactly this string.
const hash = createHash('sha1').update(readFileSync(`${root}config/tuning.json`)).digest('hex').slice(0, 8);
const version = `${pkg.version}+${hash}`;

await build({
  entryPoints: [`${root}server/src/main.ts`],
  outfile: `${root}server/dist/server.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // node:sqlite and friends stay as imports; everything else is inlined.
  define: { __SERVER_VERSION__: JSON.stringify(version) },
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
});
console.log(`server version ${version}`);
