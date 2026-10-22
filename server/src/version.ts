import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

declare const __SERVER_VERSION__: string | undefined;

/**
 * `${package version}+${first 8 hex of sha1 of config/tuning.json's bytes}`: the stamp the client puts on a
 * run. The bundle gets it from build.mjs; under Vitest (no define) it is computed from the repo files.
 */
export function ownVersion(): string {
  if (typeof __SERVER_VERSION__ === 'string') return __SERVER_VERSION__;
  const root = new URL('../../', import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { version: string };
  const hash = createHash('sha1').update(readFileSync(new URL('config/tuning.json', root))).digest('hex').slice(0, 8);
  return `${pkg.version}+${hash}`;
}
