#!/usr/bin/env bash
# GYM OS 2.0 one-command deploy for a fresh Ubuntu server (e.g. Oracle Cloud
# Always Free).
#
#   curl -fsSL https://raw.githubusercontent.com/gaurav-49/Gym-OS/main/deploy/install.sh | sudo bash
#
# What it does:
#   1. installs Docker (if missing) and adds swap on small machines
#   2. opens ports 80/443 in the server firewall
#   3. downloads (or updates) GYM OS into /opt/gym-os
#   4. creates .env with generated secrets on first run; keeps it on later runs
#   5. applies db/migrate.js, then builds and starts the stack (HTTPS via Caddy)
#   6. prints the staff and member portal URLs
#
# Re-running it updates to the latest code and keeps data and secrets.
#
# Optional settings (pass as environment variables, e.g. `... | sudo DOMAIN=my.duckdns.org bash`):
#   DOMAIN         public hostname (default: <public-ip>.sslip.io)
#   SEED_DEMO=1    also load the demo gym (120 members, 4 trainers, every module)
#   ADMIN_USERNAME the first staff account's username (default: admin)
#   ADMIN_PASSWORD its password (default: generated, printed once during the run)
#   TZ             local time for reports and schedules (default: Asia/Kolkata)
#   REPO_URL       git repository (default: https://github.com/gaurav-49/Gym-OS.git)
#   BRANCH         default: main
#   INSTALL_DIR    default: /opt/gym-os
#   SKIP_SYSTEM=1  skip Docker install, swap and firewall (machines already set up)
#   PROJECT        Docker Compose project name (default: gym-os)

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/gaurav-49/Gym-OS.git}"
BRANCH="${BRANCH:-main}"
INSTALL_DIR="${INSTALL_DIR:-/opt/gym-os}"
PROJECT="${PROJECT:-gym-os}"
COMPOSE=(docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.prod.yml)

say() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------- system setup

if [[ "${SKIP_SYSTEM:-0}" != "1" ]]; then
  [[ "$(id -u)" -eq 0 ]] || die "run as root: curl -fsSL <url> | sudo bash"
  command -v apt-get >/dev/null || die "this installer supports Ubuntu/Debian servers"

  say "Installing prerequisites"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git curl openssl python3 ca-certificates >/dev/null

  if ! command -v docker >/dev/null; then
    say "Installing Docker"
    curl -fsSL https://get.docker.com | sh >/dev/null
  fi
  systemctl enable --now docker >/dev/null 2>&1 || true
  if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
    usermod -aG docker "$SUDO_USER" || true
  fi

  # Building the WAR (Maven + a Vite bundle) needs memory; add swap on
  # machines with less than 4 GB RAM, such as the Oracle micro shape.
  mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
  if (( mem_kb < 4000000 )) && ! swapon --show | grep -q .; then
    say "Adding 4 GB swap (this machine has $((mem_kb / 1024)) MB RAM)"
    fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi

  say "Opening ports 80 and 443 in the server firewall"
  if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
    ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null
  fi
  # Oracle Cloud Ubuntu images ship iptables rules that reject everything except SSH.
  if command -v iptables >/dev/null; then
    for port in 80 443; do
      iptables -C INPUT -p tcp --dport "$port" -m state --state NEW -j ACCEPT 2>/dev/null \
        || iptables -I INPUT 1 -p tcp --dport "$port" -m state --state NEW -j ACCEPT
    done
    command -v netfilter-persistent >/dev/null && netfilter-persistent save >/dev/null 2>&1 || true
  fi
fi

command -v docker >/dev/null || die "Docker is not installed"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required"

# ---------------------------------------------------------------------------- code

if [[ -d "$INSTALL_DIR/.git" ]]; then
  say "Updating GYM OS in $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch -q origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout -q "$BRANCH"
  git -C "$INSTALL_DIR" reset -q --hard "origin/$BRANCH"
else
  say "Downloading GYM OS into $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone -q --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# ---------------------------------------------------------------------------- configuration

env_get() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true; }
env_set() {
  if grep -qE "^$1=" .env; then
    python3 - "$1" "$2" <<'PY'
import sys
key, value = sys.argv[1], sys.argv[2]
lines = open(".env").read().splitlines()
open(".env", "w").write("\n".join(f"{key}={value}" if l.startswith(key + "=") else l for l in lines) + "\n")
PY
  else
    echo "$1=$2" >> .env
  fi
}

if [[ ! -f .env ]]; then
  say "Creating .env with generated secrets"
  cp deploy/.env.production.example .env
  env_set JWT_SECRET "$(openssl rand -hex 32)"
  env_set DB_PASSWORD "$(openssl rand -hex 24)"
  chmod 600 .env
else
  say "Keeping existing .env (secrets unchanged)"
fi

if [[ -n "${DOMAIN:-}" ]]; then
  env_set DOMAIN "$DOMAIN"
elif [[ -z "$(env_get DOMAIN)" || "$(env_get DOMAIN)" == CHANGE_ME* ]]; then
  ip=$(curl -4 -fsS --max-time 10 https://api.ipify.org || curl -4 -fsS --max-time 10 https://ifconfig.me || true)
  [[ -n "$ip" ]] || die "could not detect the public IP; re-run with DOMAIN=your.domain"
  env_set DOMAIN "${ip//./-}.sslip.io"
fi
[[ -n "${TZ:-}" ]] && env_set TZ "$TZ"
DOMAIN="$(env_get DOMAIN)"

# ---------------------------------------------------------------------------- start

# The schema first: the app will not start until migrate exits 0, so a failure
# here should stop the deploy with the migration's own error rather than a
# container that restarts forever.
say "Applying the database schema"
"${COMPOSE[@]}" up -d postgres --wait --wait-timeout 180
# -T (no pseudo-tty) and < /dev/null: this script is itself usually run via
# `curl ... | sudo bash` or piped over SSH, so its own stdin is the rest of
# THIS script, not a terminal. `docker compose run` attaches to stdin by
# default, and without these it will consume everything after this line as
# its own input -- the script then exits 0 having silently skipped the app
# build and startup below. (Found the hard way: a "successful" deploy that
# never actually started the app.)
"${COMPOSE[@]}" run --rm -T migrate < /dev/null

# migrate.js creates the schema but no staff account, and seed-demo.js only
# looks one up — so without this the app comes up perfectly and nobody can
# sign in. Idempotent: leaves an existing admin (and its password) alone.
say "Making sure a staff account exists"
"${COMPOSE[@]}" run --rm -T -e ADMIN_USERNAME -e ADMIN_PASSWORD \
  migrate sh -c "node ensure-admin.js" < /dev/null

if [[ "${SEED_DEMO:-0}" == "1" ]]; then
  say "Loading the demo gym"
  "${COMPOSE[@]}" run --rm -T migrate sh -c "node seed-demo.js" < /dev/null
fi

say "Building and starting GYM OS (first run takes 5-10 minutes)"
# Named explicitly so --wait watches the long-running services: migrate is a
# one-shot that exits, and waiting for it to become "healthy" never succeeds.
# It still runs, as app's service_completed_successfully dependency.
"${COMPOSE[@]}" up -d --build --remove-orphans --wait --wait-timeout 900 app caddy

say "Checking the app"
status=$("${COMPOSE[@]}" exec -T app curl -fsS localhost:8080/actuator/health 2>/dev/null \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])' 2>/dev/null || echo "not responding")

# A local nightly dump does not survive the machine going away, but it does
# cover the things that actually happen: a bad migration, a mistaken delete,
# a container rebuild.
say "Installing the nightly database backup"
chmod +x deploy/backup.sh
cat > /etc/cron.d/gym-os-backup <<CRON
# GYM OS nightly database backup — installed by deploy/install.sh
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
17 3 * * * root GYMOS_DIR=$INSTALL_DIR $INSTALL_DIR/deploy/backup.sh >> /var/log/gym-os-backup.log 2>&1
CRON
chmod 644 /etc/cron.d/gym-os-backup

# Runs before opening hours, after the backup, so a bad run still has
# yesterday's state to restore from.
say "Installing the daily onboarding + attendance job"
cat > /etc/cron.d/gym-os-daily <<CRON
# GYM OS daily onboarding (20-30 members) + attendance (450-600 check-ins)
# — installed by deploy/install.sh
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
5 4 * * * root cd $INSTALL_DIR && docker compose -p $PROJECT -f docker-compose.yml -f docker-compose.prod.yml run --rm -T migrate sh -c "node seed-daily.js" < /dev/null >> /var/log/gym-os-daily.log 2>&1
CRON
chmod 644 /etc/cron.d/gym-os-daily

cat <<EOF

────────────────────────────────────────────────────────────────────────
 GYM OS 2.0 is running.        health: $status

   Staff portal:    https://$DOMAIN/
   Member portal:   https://$DOMAIN/#/member

 Both portals are the same deployment — one app, one origin. Members do
 not need a separate address beyond the #/member link.

 First sign-in:  the staff account printed by the "Making sure a staff
 account exists" step above. On a first deploy its password is generated
 and shown there once; set ADMIN_PASSWORD to choose your own instead.
   ↳ Change it after signing in: Staff portal → Users → that account.

 Members sign in with their Member ID and the password
 '$(env_get MEMBER_DEFAULT_PASSWORD)' (MEMBER_DEFAULT_PASSWORD in .env).

 Update to the latest code: re-run this installer.
 Logs:    cd $INSTALL_DIR && docker compose -p $PROJECT logs -f app
 Stop:    cd $INSTALL_DIR && docker compose -p $PROJECT -f docker-compose.yml -f docker-compose.prod.yml down

 If the site does not open from your browser:
   * Oracle Cloud: allow TCP 80 and 443 in the subnet's Security List
     (Networking > Virtual Cloud Networks > Subnet > Security List > Add Ingress Rules)
   * the HTTPS certificate is issued on first visit and can take a minute
────────────────────────────────────────────────────────────────────────
EOF
