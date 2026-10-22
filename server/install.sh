#!/usr/bin/env bash
# Bloom: one-command install and update for a Debian/Ubuntu VPS (run as root).
#
#   curl -fsSL https://raw.githubusercontent.com/guspliffy/Bloom1/main/server/install.sh | sudo bash
#
# Installs the game and its leaderboard server from the GitHub repo, runs the server as a systemd service
# on 127.0.0.1 and puts the existing web server (nginx, Apache) or a new Caddy in front of it with HTTPS.
# Run it again at any time to update. It never edits another site's config: it only adds its own files.
#
# Optional environment:
#   BLOOM_DOMAIN=bloom.example.com   host name to serve (default: bloom.<ip-with-dashes>.sslip.io)
#   BLOOM_DRY_RUN=1                  print the plan, change nothing
#   BLOOM_REPO / BLOOM_BRANCH        where to fetch the game from
set -euo pipefail

main() {
  # `curl | bash` feeds this script through stdin; stop every command below from swallowing the rest of it.
  exec </dev/null
  export DEBIAN_FRONTEND=noninteractive

  local REPO="${BLOOM_REPO:-https://github.com/guspliffy/Bloom1}"
  local BRANCH="${BLOOM_BRANCH:-main}"
  local DRY="${BLOOM_DRY_RUN:-0}"
  local ROOT=/opt/bloom
  local SRC="$ROOT/src" WWW="$ROOT/www" SRV="$ROOT/server" DATA="$ROOT/data"
  local ENV_FILE="$ROOT/bloom.env" CONF="$ROOT/install.conf"
  local UNIT=/etc/systemd/system/bloom-leaderboard.service
  local MARK="managed by Bloom install.sh"
  local NODE_DIR="" PORT="" HOST="" WEB="" CERT_OK=0 STEP=0

  say()  { STEP=$((STEP + 1)); printf '\n[%s] %s\n' "$STEP" "$*"; }
  info() { printf '    %s\n' "$*"; }
  warn() { printf '    WARNING: %s\n' "$*" >&2; }
  die()  { printf '\nStopped: %s\n' "$*" >&2; exit 1; }
  # run CMD...: execute it, or in a dry run just say what would happen
  run()  { if [ "$DRY" = 1 ]; then printf '    [dry run] %s\n' "$*"; else "$@"; fi; }
  # put FILE: write stdin to FILE (or just say so in a dry run)
  put()  { if [ "$DRY" = 1 ]; then printf '    [dry run] would write %s\n' "$1"; cat >/dev/null; else cat >"$1"; fi; }
  have() { command -v "$1" >/dev/null 2>&1; }
  listening() { [ -n "$(ss -ltnH "sport = :$1" 2>/dev/null || true)" ]; }
  node_new_enough() { "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null; }
  # fill_template: replace the @NAME@ placeholders in stdin
  fill_template() { sed -e "s|@HOST@|$HOST|g" -e "s|@PORT@|$PORT|g" -e "s|@WWW@|$WWW|g" -e "s|@MARK@|$MARK|g"; }
  # Refuse to overwrite a file of the same name that is not ours.
  ours_or_absent() { [ ! -e "$1" ] || grep -q "$MARK" "$1"; }

  # ---------------------------------------------------------------- 0. checks
  if [ "$DRY" = 1 ]; then
    printf 'Dry run: nothing will be changed. This is what the installer would do.\n'
  else
    [ "$(id -u)" -eq 0 ] || die "please run as root: curl -fsSL <url> | sudo bash"
  fi
  have apt-get || die "this installer needs Debian or Ubuntu (apt-get not found). See server/README.md for the manual steps."
  have systemctl || die "systemd is required (systemctl not found)."

  # ---------------------------------------------------------------- 1. tools
  say "Making sure git, curl and Node 22.13 or newer are installed"
  local missing=()
  for t in git curl ss; do have "$t" || missing+=("$t"); done
  if [ "${#missing[@]}" -gt 0 ]; then
    info "installing: ${missing[*]}"
    run apt-get update -qq
    run apt-get install -y -qq git curl ca-certificates iproute2
  fi

  if have node && node_new_enough node; then
    NODE_DIR="$(dirname "$(command -v node)")"
    info "using Node $(node -v) from $NODE_DIR"
  elif ! have node; then
    info "Node is not installed: adding Node 22 from NodeSource"
    run apt-get install -y -qq ca-certificates curl gnupg
    run bash -c 'curl -fsSL https://deb.nodesource.com/setup_22.x | bash -'
    run apt-get install -y -qq nodejs
    NODE_DIR=/usr/bin
  else
    # Another program on this machine may depend on the Node that is installed, so leave it alone and
    # keep our own copy inside /opt/bloom.
    info "Node $(node -v) is too old for the server. It is left untouched; a private Node 22 goes in $ROOT/node"
    NODE_DIR="$ROOT/node/bin"
    if [ -x "$NODE_DIR/node" ] && node_new_enough "$NODE_DIR/node"; then
      info "private Node already there ($("$NODE_DIR/node" -v))"
    else
      local arch tmp base file
      case "$(uname -m)" in x86_64) arch=x64 ;; aarch64|arm64) arch=arm64 ;; *) die "unsupported CPU: $(uname -m)" ;; esac
      run apt-get install -y -qq xz-utils
      if [ "$DRY" = 1 ]; then
        info "[dry run] would download the official Node 22 tarball from nodejs.org, check its sha256 and unpack it"
      else
        tmp="$(mktemp -d)"
        base="https://nodejs.org/dist/latest-v22.x"
        curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
        file="$(grep -o "node-v22[0-9.]*-linux-$arch.tar.xz" "$tmp/SHASUMS256.txt" | head -1)"
        [ -n "$file" ] || die "could not find a Node 22 download for $arch"
        curl -fsSL "$base/$file" -o "$tmp/$file"
        (cd "$tmp" && grep " $file\$" SHASUMS256.txt | sha256sum -c - >/dev/null) || die "the Node download failed its checksum"
        rm -rf "$ROOT/node"
        mkdir -p "$ROOT/node"
        tar -xJf "$tmp/$file" -C "$ROOT/node" --strip-components=1
        rm -rf "$tmp"
      fi
    fi
  fi
  export PATH="$NODE_DIR:$PATH"

  # ---------------------------------------------------------------- 2. host name
  say "Choosing the web address"
  if [ -n "${BLOOM_DOMAIN:-}" ]; then
    HOST="$BLOOM_DOMAIN"
  elif [ -f "$CONF" ] && grep -q '^DOMAIN=' "$CONF"; then
    HOST="$(sed -n 's/^DOMAIN=//p' "$CONF" | head -1)"
    info "keeping the address from the last install"
  else
    local ip=""
    ip="$(curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
    if ! [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      ip="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' | grep -Ev '^(10\.|127\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' | head -1 || true)"
    fi
    [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "could not work out this server's public IPv4 address. Run again with BLOOM_DOMAIN=your.host.name"
    HOST="bloom.${ip//./-}.sslip.io"
  fi
  [[ "$HOST" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || die "'$HOST' is not a usable host name"
  info "address: $HOST"
  if [ -n "${BLOOM_DOMAIN:-}" ] && [ -z "$(getent hosts "$HOST" 2>/dev/null || true)" ]; then
    warn "$HOST does not resolve yet. Point its DNS A record at this server, otherwise HTTPS cannot be set up."
  fi

  # ---------------------------------------------------------------- 3. fetch + build
  say "Fetching the game ($REPO, branch $BRANCH)"
  run mkdir -p "$ROOT"
  if [ -d "$SRC/.git" ]; then
    run git -C "$SRC" fetch --depth 1 origin "$BRANCH"
    run git -C "$SRC" reset --hard FETCH_HEAD
  else
    run rm -rf "$SRC"
    run git clone --depth 1 --branch "$BRANCH" "$REPO" "$SRC"
  fi

  say "Building the game and the server (this takes a minute or two)"
  if [ "$DRY" = 1 ]; then
    info "[dry run] would run in $SRC: npm ci; VITE_BLOOM_API=/ npm run build; npm run server:build"
  else
    cd "$SRC"
    npm ci --no-audit --no-fund
    # '/' makes the game call the API on its own address, so no cross-site settings are involved.
    VITE_BLOOM_API=/ npm run build
    npm run server:build
  fi

  # ---------------------------------------------------------------- 4. install files + service
  say "Installing files into $ROOT (your data in $DATA is never touched)"
  if ! id -u bloom >/dev/null 2>&1; then
    run useradd --system --home-dir "$ROOT" --shell /usr/sbin/nologin bloom
  fi
  run mkdir -p "$SRV" "$DATA"
  run chown bloom:bloom "$DATA"
  run chmod 750 "$DATA"
  if [ "$DRY" = 1 ]; then
    info "[dry run] would copy $SRC/dist to $WWW and server.mjs to $SRV/server.mjs"
  else
    rm -rf "$WWW.new" "$WWW.old"
    cp -r "$SRC/dist" "$WWW.new"
    if [ -d "$WWW" ]; then mv "$WWW" "$WWW.old"; fi
    mv "$WWW.new" "$WWW"
    rm -rf "$WWW.old"
    install -m 644 "$SRC/server/dist/server.mjs" "$SRV/server.mjs"
    chmod -R a+rX "$WWW"
    chmod 755 "$ROOT"
  fi

  # Keep the port from the last install; otherwise take the first free one from 8787.
  if [ -f "$ENV_FILE" ] && grep -q '^PORT=' "$ENV_FILE"; then
    PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" | head -1)"
  else
    PORT=8787
    while listening "$PORT"; do PORT=$((PORT + 1)); done
  fi
  info "the server will listen on 127.0.0.1:$PORT (not reachable from outside)"

  say "Starting the leaderboard service"
  put "$ENV_FILE" <<ENVFILE
PORT=$PORT
HOST=127.0.0.1
DB_PATH=$DATA/bloom.sqlite
ALLOWED_ORIGINS=https://guspliffy.github.io,https://$HOST,http://$HOST
TRUST_PROXY=1
ENVFILE
  put "$CONF" <<CONFFILE
DOMAIN=$HOST
CONFFILE
  put "$UNIT" <<UNITFILE
# $MARK
[Unit]
Description=Bloom leaderboard
After=network.target

[Service]
User=bloom
Group=bloom
WorkingDirectory=$DATA
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_DIR/node $SRV/server.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
UNITFILE
  run systemctl daemon-reload
  run systemctl enable bloom-leaderboard
  run systemctl restart bloom-leaderboard
  if [ "$DRY" != 1 ]; then
    local ok=0
    for _ in $(seq 1 30); do
      if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
      sleep 1
    done
    if [ "$ok" != 1 ]; then
      journalctl -u bloom-leaderboard -n 30 --no-pager >&2 || true
      die "the leaderboard service did not come up. The log above says why; send it to Claude."
    fi
    info "service is up: $(curl -fsS "http://127.0.0.1:$PORT/api/health")"
    # Runs sent while an older server was running are stored hidden; this shows the ones that now check out.
    runuser -u bloom -- bash -c 'set -a; . "$0"; exec "$1" "$2" --reverify' "$ENV_FILE" "$NODE_DIR/node" "$SRV/server.mjs" 2>/dev/null \
      || warn "the re-check of older runs did not run (harmless)"
  fi

  # ---------------------------------------------------------------- 5. web server
  say "Putting the web server in front"

  # Gets the HTTPS certificate through the web server's own certbot plugin. A failure leaves plain http working.
  want_cert() { # $1 = nginx | apache
    have certbot || run apt-get install -y -qq certbot
    dpkg -s "python3-certbot-$1" >/dev/null 2>&1 || run apt-get install -y -qq "python3-certbot-$1"
    if run certbot "--$1" -d "$HOST" --non-interactive --agree-tos --register-unsafely-without-email --redirect; then
      CERT_OK=1
    else
      warn "HTTPS could not be set up (certbot failed; see its message above). The game works over plain http for now. Run this installer again later to retry."
    fi
  }

  if have nginx && systemctl is-active --quiet nginx; then
    WEB=nginx
    info "nginx is running: adding a separate site for $HOST"
    local avail=/etc/nginx/sites-available/bloom link=/etc/nginx/sites-enabled/bloom
    if [ ! -d /etc/nginx/sites-available ]; then avail=/etc/nginx/conf.d/bloom.conf; link=""; fi
    ours_or_absent "$avail" || die "$avail already exists and was not made by this installer; not touching it."
    # certbot adds the https lines to our own file; keep them on a re-run unless the port or name changed.
    if [ -e "$avail" ] && grep -q "127.0.0.1:$PORT" "$avail" && grep -q "server_name $HOST;" "$avail"; then
      info "site file already in place"
    else
      fill_template <<'NGINX' | put "$avail"
# @MARK@
server {
    listen 80;
    listen [::]:80;
    server_name @HOST@;
    root @WWW@;
    index index.html;

    gzip on;
    gzip_min_length 1024;
    gzip_types text/css application/javascript application/json image/svg+xml text/plain;

    location /api/ {
        proxy_pass http://127.0.0.1:@PORT@;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
        client_max_body_size 128k;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    location / {
        add_header Cache-Control "no-cache";
        try_files $uri $uri/ /index.html;
    }
}
NGINX
      if [ -n "$link" ]; then run ln -sfn "$avail" "$link"; fi
    fi
    if [ "$DRY" = 1 ]; then
      info "[dry run] would check with 'nginx -t' and reload nginx, then run certbot --nginx"
    else
      if ! nginx -t >/dev/null 2>&1; then
        nginx -t >&2 || true
        rm -f "$avail" "$link"
        die "nginx rejected the new site, so it was removed again and nothing changed. Send the message above to Claude."
      fi
      systemctl reload nginx
    fi
    want_cert nginx

  elif have apache2ctl && systemctl is-active --quiet apache2; then
    WEB=apache
    info "Apache is running: adding a separate virtual host for $HOST"
    local conf=/etc/apache2/sites-available/bloom.conf
    ours_or_absent "$conf" || die "$conf already exists and was not made by this installer; not touching it."
    if [ -e "$conf" ] && grep -q "127.0.0.1:$PORT/" "$conf" && grep -q "ServerName $HOST\$" "$conf"; then
      info "virtual host file already in place"
    else
      fill_template <<'APACHE' | put "$conf"
# @MARK@
<VirtualHost *:80>
    ServerName @HOST@
    DocumentRoot @WWW@

    <Directory @WWW@>
        Options -Indexes
        AllowOverride None
        Require all granted
    </Directory>

    ProxyPreserveHost On
    ProxyPass /api/ http://127.0.0.1:@PORT@/api/
    ProxyPassReverse /api/ http://127.0.0.1:@PORT@/api/

    AddOutputFilterByType DEFLATE text/html text/css application/javascript application/json image/svg+xml

    <Location /assets/>
        ExpiresActive On
        ExpiresDefault "access plus 1 year"
        Header append Cache-Control "public, immutable"
    </Location>
</VirtualHost>
APACHE
    fi
    run a2enmod -q proxy proxy_http headers rewrite expires deflate
    run a2ensite -q bloom
    if [ "$DRY" = 1 ]; then
      info "[dry run] would run 'apache2ctl configtest' and reload apache2, then run certbot --apache"
    else
      if ! apache2ctl configtest >/dev/null 2>&1; then
        apache2ctl configtest >&2 || true
        a2dissite -q bloom || true
        rm -f "$conf"
        die "Apache rejected the new site, so it was removed again and nothing changed. Send the message above to Claude."
      fi
      systemctl reload apache2
    fi
    want_cert apache

  elif { have caddy && systemctl is-active --quiet caddy; } || { ! listening 80 && ! listening 443; }; then
    WEB=caddy
    local fresh=0
    if have caddy && systemctl is-active --quiet caddy; then
      info "Caddy is already running: adding a separate site for $HOST next to the existing ones"
      # Only a Caddy run by its stock service from /etc/caddy/Caddyfile can be extended safely by an import line.
      [ -f /etc/caddy/Caddyfile ] && systemctl cat caddy 2>/dev/null | grep -q -- '--config /etc/caddy/Caddyfile' \
        || die "Caddy is running, but not from /etc/caddy/Caddyfile, so this installer cannot add a site to it. Nothing on the web side was changed. Send this message to Claude."
    else
      info "ports 80 and 443 are free: installing Caddy, which gets the HTTPS certificate by itself"
    fi
    if ! have caddy; then
      fresh=1
      run apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gpg
      run bash -c "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg"
      run bash -c "curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list"
      run apt-get update -qq
      run apt-get install -y -qq caddy
    fi
    run mkdir -p /etc/caddy
    fill_template <<'CADDY' | put /etc/caddy/bloom.caddy
# @MARK@
@HOST@ {
    encode gzip zstd
    handle /api/* {
        reverse_proxy 127.0.0.1:@PORT@
    }
    handle {
        root * @WWW@
        header /assets/* Cache-Control "public, max-age=31536000, immutable"
        file_server
    }
}
CADDY
    if [ "$DRY" = 1 ]; then
      info "[dry run] would make /etc/caddy/Caddyfile import /etc/caddy/bloom.caddy, validate and start Caddy"
    else
      local backup=/etc/caddy/Caddyfile.before-bloom appended=0
      if [ "$fresh" = 1 ] && [ -f /etc/caddy/Caddyfile ]; then
        # Caddy was just installed by us, so the Caddyfile is only the package's sample.
        cp -n /etc/caddy/Caddyfile /etc/caddy/Caddyfile.original || true
        echo "import /etc/caddy/bloom.caddy" >/etc/caddy/Caddyfile
      elif ! grep -qs 'import /etc/caddy/bloom.caddy' /etc/caddy/Caddyfile; then
        # The one change to a file that is not ours: a single import line at the end, with a copy kept first.
        cp /etc/caddy/Caddyfile "$backup"
        appended=1
        info "added one line to /etc/caddy/Caddyfile (the original is kept as $backup)"
        printf '\n# %s\nimport /etc/caddy/bloom.caddy\n' "$MARK" >>/etc/caddy/Caddyfile
      fi
      if ! caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
        caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile >&2 || true
        rm -f /etc/caddy/bloom.caddy
        # Undo only the line added in this run, so later edits of the owner's are never rolled back.
        if [ "$appended" = 1 ]; then cp "$backup" /etc/caddy/Caddyfile; fi
        die "Caddy rejected the config, so the Bloom site was removed again and your Caddyfile restored. Send the message above to Claude."
      fi
      systemctl enable caddy >/dev/null 2>&1 || true
      if [ "$fresh" = 1 ]; then
        systemctl restart caddy
      else
        # A reload keeps the sites that are already running online.
        systemctl reload caddy
      fi
    fi
    CERT_OK=1   # Caddy requests the certificate by itself; the check at the end confirms it.

  else
    printf '\nThe game and its API are installed, but ports 80/443 are already used by something this\n'
    printf 'installer does not know how to share. Nothing on the web side was changed.\n\n'
    printf 'What holds the ports:\n'
    ss -ltnp 'sport = :80 or sport = :443' 2>/dev/null | sed 's/^/    /' || true
    printf '\nThe API is running on http://127.0.0.1:%s (health: /api/health) and the game files are in %s.\n' "$PORT" "$WWW"
    printf 'Send this whole message to Claude so the right proxy rule can be written.\n'
    exit 2
  fi

  if have ufw && ufw status 2>/dev/null | grep -q '^Status: active'; then
    info "firewall (ufw) is on: allowing web traffic on ports 80 and 443"
    run ufw allow 80/tcp
    run ufw allow 443/tcp
  fi

  # ---------------------------------------------------------------- 6. result
  say "Checking the result"
  local URL="http://$HOST" health=""
  if [ "$DRY" = 1 ]; then
    URL="https://$HOST"
    info "[dry run] would test $URL/api/health"
  else
    for _ in $(seq 1 12); do
      if health="$(curl -fsS --max-time 10 "https://$HOST/api/health" 2>/dev/null)"; then URL="https://$HOST"; break; fi
      sleep 3
    done
    if [ "$URL" = "http://$HOST" ]; then
      health="$(curl -fsS --max-time 10 "http://$HOST/api/health" 2>/dev/null || true)"
    fi
    [ -n "$health" ] || warn "$URL/api/health did not answer. The service itself is fine on 127.0.0.1:$PORT; check DNS and the firewall."
  fi

  local l0="Bloom is installed (web server: $WEB)" l1="Game:   $URL/" l2="Health: $URL/api/health" l3="Send this URL to Claude: $URL"
  local w=0 l bar
  for l in "$l0" "$l1" "$l2" "$l3"; do if [ "${#l}" -gt "$w" ]; then w=${#l}; fi; done
  bar="$(printf '%*s' "$((w + 2))" '' | tr ' ' '-')"
  printf '\n+%s+\n' "$bar"
  for l in "$l0" "$l1" "$l2" "$l3"; do printf '| %-*s |\n' "$w" "$l"; done
  printf '+%s+\n' "$bar"
  if [ "$URL" = "http://$HOST" ] && [ "$CERT_OK" != 1 ]; then
    printf '\nHTTPS is not set up yet (see the warning above). Run the same command again to retry.\n'
  fi
  printf '\nTo update later, run the same command again. Back up %s/bloom.sqlite to keep the accounts.\n' "$DATA"
}

main "$@"
