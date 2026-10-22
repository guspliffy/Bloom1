/** Server settings, all from the environment so the owner never edits code. */
export interface Config {
  port: number;
  host: string;
  dbPath: string;
  allowedOrigins: string[];
  trustProxy: boolean;
}

export function readConfig(env: Record<string, string | undefined> = process.env): Config {
  const port = Number(env.PORT ?? 8787);
  return {
    port: Number.isInteger(port) && port >= 0 && port < 65536 ? port : 8787,
    // Loopback by default: the reverse proxy is the only thing that talks to us.
    host: env.HOST?.trim() || '127.0.0.1',
    dbPath: env.DB_PATH?.trim() || './data/bloom.sqlite',
    allowedOrigins: (env.ALLOWED_ORIGINS ?? 'https://guspliffy.github.io')
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean),
    trustProxy: env.TRUST_PROXY === '1',
  };
}
