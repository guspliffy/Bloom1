import { createApp } from './app';
import { readConfig } from './config';
import { openDb } from './db';
import { Store } from './store';
import { replayMatches } from './verify';
import { ownVersion } from './version';

const config = readConfig();

if (process.argv.includes('--reverify')) {
  // Runs stored from another game version stay hidden. Ones stamped with this version get replayed now:
  // a match goes on the boards, a miss is marked rejected (kept in the file, never shown).
  const db = openDb(config.dbPath);
  const store = new Store(db);
  const version = ownVersion();
  let verified = 0;
  let rejected = 0;
  let other = 0;
  for (const r of store.unverifiedRuns()) {
    if (r.gameVersion !== version) {
      other++;
      continue;
    }
    if (replayMatches(r)) {
      store.setVerified(r.id, 1);
      verified++;
    } else {
      store.setVerified(r.id, -1);
      rejected++;
    }
  }
  console.log(`reverify (server version ${version}): ${verified} verified, ${rejected} rejected, ${other} left hidden (other game version)`);
  db.close();
} else if (process.argv.includes('--version')) {
  console.log(ownVersion());
} else {
  const app = createApp({ config });
  app.server.listen(config.port, config.host, () => {
    console.log(`bloom leaderboard ${app.version} listening on http://${config.host}:${config.port} (db ${config.dbPath})`);
  });
  const stop = () => {
    void app.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
