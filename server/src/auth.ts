import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEYLEN, { N: n, r, p, maxmem: 128 * n * r * 2 }, (e, key) => (e ? reject(e) : resolve(key))),
  );
}

/** `scrypt$N$r$p$salt$hash`: the parameters travel with the hash so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function checkPassword(password: string, stored: string | null): Promise<boolean> {
  // Unknown name: still spend the same time, so response time does not reveal which names exist.
  const parts = (stored ?? '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    await derive(password, Buffer.alloc(16), N, R, P);
    return false;
  }
  const [, n, r, p, salt, hash] = parts;
  const want = Buffer.from(hash, 'base64');
  const got = await derive(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
  return got.length === want.length && timingSafeEqual(got, want);
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Only this digest is stored, so a copy of the database cannot be used to sign in. */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
