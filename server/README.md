# Bloom leaderboard server

A small server for Bloom's accounts and "Gardeners" boards. One file to run, no database to set up, nothing to `npm install` on the server. It listens on `127.0.0.1` only, so it never competes with other sites: your web server passes `/api/` requests to it.

## The easy way: one command (Hostinger VPS, Ubuntu or Debian)

Log in to the VPS over SSH as root and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/guspliffy/Bloom1/main/server/install.sh | sudo bash
```

It does everything and says in plain words what it is doing:

1. Installs git, curl and Node 22 if they are missing (Node comes from NodeSource). If an older Node is already there, for another game, it is left alone and a private Node 22 goes into `/opt/bloom/node`.
2. Downloads the game from GitHub into `/opt/bloom/src`, builds it, builds the server.
3. Puts the game in `/opt/bloom/www` and the server in `/opt/bloom/server`. Accounts and scores live in `/opt/bloom/data` and are never deleted.
4. Creates a `bloom` system user and a service, `bloom-leaderboard`, that starts at boot (port 8787, or the next free port).
5. Picks the address `bloom.<your-ip-with-dashes>.sslip.io` (a free name that points at your IP), or the one you set: `BLOOM_DOMAIN=bloom.example.com curl ... | sudo -E bash`.
6. Adds its own site to the web server already running there: **nginx**, or **Apache**, or installs **Caddy** if nothing uses ports 80/443. It only adds new files (`sites-available/bloom`, `bloom.conf`, `bloom.caddy`); it never edits your other site's config. The new config is tested first and removed again if the web server rejects it. HTTPS comes from Let's Encrypt (certbot, or Caddy itself).
7. If something else holds ports 80/443 (Docker, Traefik, a Node app), it changes nothing on the web side, tells you what holds them and stops with a message to send back.
8. Opens ports 80 and 443 in `ufw` only if `ufw` is switched on.

At the end it prints a box with the game address, the health address and "Send this URL to Claude".

**To update**, run the same command again. It fetches the latest game, rebuilds, restarts the service and re-checks stored scores. `BLOOM_DRY_RUN=1` in front shows what it would do without changing anything.

To see the service: `systemctl status bloom-leaderboard`, logs: `journalctl -u bloom-leaderboard -f`.

---

## The manual way

Everything below is what the installer automates. Use it if you prefer to do it by hand or have another layout.

### What you need

- Linux with **Node 22.13 or newer** (`node -v`). On Ubuntu:
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
  sudo apt-get install -y nodejs
  ```
- A sub-domain such as `bloom-api.example.com` pointing at the server, for HTTPS.

### Build the single file (on any computer with the repo)

```bash
npm ci
npm run server:build
```

This writes `server/dist/server.mjs`, which already contains the game's rules and the name rules. Copy that one file to the server, for example to `/opt/bloom/server/server.mjs`.

### Start it

```bash
sudo useradd --system --home-dir /opt/bloom --shell /usr/sbin/nologin bloom
sudo mkdir -p /opt/bloom/data && sudo chown bloom:bloom /opt/bloom/data
sudo cp bloom-leaderboard.service /etc/systemd/system/    # from this folder; check paths and ALLOWED_ORIGINS
sudo systemctl daemon-reload
sudo systemctl enable --now bloom-leaderboard
curl http://127.0.0.1:8787/api/health        # {"ok":true,"version":"..."}
```

### Settings (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8787` | Port to listen on |
| `HOST` | `127.0.0.1` | Address to listen on. Keep it: only your reverse proxy should reach the server |
| `DB_PATH` | `./data/bloom.sqlite` | The database file (created on first start) |
| `ALLOWED_ORIGINS` | `https://guspliffy.github.io` | Web pages allowed to call the API, comma separated. Add the game's own address if you host the game yourself |
| `TRUST_PROXY` | off | Set to `1` behind nginx/Apache/Caddy so rate limits count the visitor's real address |

### nginx (subdomain `bloom-api.example.com`)

Put this in `/etc/nginx/sites-available/bloom-api`, link it into `sites-enabled`, then `sudo nginx -t && sudo systemctl reload nginx`:

```nginx
server {
    listen 80;
    server_name bloom-api.example.com;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 128k;
    }
}
```

Then HTTPS: `sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d bloom-api.example.com`.

### Apache

```bash
sudo a2enmod proxy proxy_http headers
```

`/etc/apache2/sites-available/bloom-api.conf`:

```apache
<VirtualHost *:80>
    ServerName bloom-api.example.com
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:8787/
    ProxyPassReverse / http://127.0.0.1:8787/
</VirtualHost>
```

Then `sudo a2ensite bloom-api && sudo apache2ctl configtest && sudo systemctl reload apache2`, and HTTPS: `sudo apt-get install -y certbot python3-certbot-apache && sudo certbot --apache -d bloom-api.example.com`.

### Docker instead

From the repository root:

```bash
docker build -f server/Dockerfile -t bloom-leaderboard .
docker run -d --name bloom-leaderboard --restart unless-stopped \
  -p 127.0.0.1:8787:8787 -v bloom-data:/data \
  -e ALLOWED_ORIGINS=https://guspliffy.github.io -e TRUST_PROXY=1 bloom-leaderboard
```

The port is published on `127.0.0.1` only. Use the same nginx/Apache snippets. The data lives in the `bloom-data` volume.

## Back up

Everything is in one SQLite file (`/opt/bloom/data/bloom.sqlite`), plus two helper files next to it while the server runs (`-wal`, `-shm`). A safe copy while running:

```bash
sudo -u bloom sqlite3 /opt/bloom/data/bloom.sqlite ".backup '/opt/bloom/data/backup.sqlite'"
```

(If `sqlite3` is not installed: `sudo apt-get install sqlite3`.) Or stop the service, copy the file, start it again. Copy the backup off the machine now and then.

## Updating

Easy way: run the install command again. Manual way: copy the new `server.mjs` over the old one, then

```bash
sudo systemctl restart bloom-leaderboard
sudo -u bloom env DB_PATH=/opt/bloom/data/bloom.sqlite node /opt/bloom/server/server.mjs --reverify
```

Why `--reverify`: every finished game is replayed by the server to check the score is real. A game played with a different version of the rules than the server's can't be checked, so it is stored but kept off the boards. After you update the server, `--reverify` re-checks stored games that carry the server's own version and puts the genuine ones on the boards. Games from other versions stay hidden.

## How it behaves

- **Names** follow the game's rules (3 to 16 letters, digits and single spaces, a short blocklist, unique ignoring case). **Passwords** are 6 to 72 characters and stored only as a salted scrypt hash.
- **Sign-in tokens** last 180 days; only a hash of each token is stored.
- **Limits per visitor address**: 5 new accounts per hour, 20 sign-in attempts per 10 minutes, 120 uploaded runs per hour (`429 {"error":"slow"}`).
- **Boards** rank by gardens lit, then stars, then pollen, then whoever got there first. Only verified games appear. The daily board counts each player's first game of the day.
- Requests are JSON only, at most 64 KB.

## Troubleshooting

- `curl http://127.0.0.1:8787/api/health` fails: `journalctl -u bloom-leaderboard -n 50`.
- "ExperimentalWarning: SQLite" in the log is normal on Node 22.
- The game says the board is out of reach: check that `ALLOWED_ORIGINS` contains the exact address of the page (scheme and host, no slash) and that HTTPS is working.
