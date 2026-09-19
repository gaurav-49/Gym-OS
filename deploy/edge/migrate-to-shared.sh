#!/usr/bin/env bash
# One-time migration: move InsightRAG and GYM OS off each running its own
# Caddy — only one of them can hold host ports 80/443 — onto one shared
# Caddy that fronts both by hostname.
#
# Run this ONCE on the server, as the user that already runs `docker compose`
# for both apps (root, if either was installed with the one-command installer).
#
#   curl -fsSL https://raw.githubusercontent.com/gaurav-49/Gym-OS/main/deploy/edge/migrate-to-shared.sh -o /tmp/migrate-to-shared.sh
#   sudo INSIGHTRAG_DOMAIN=insightrag.YOUR-IP.sslip.io \
#        GYMOS_DOMAIN=gym.YOUR-IP.sslip.io \
#        bash /tmp/migrate-to-shared.sh
#
# Optional: INSIGHTRAG_DIR (default /opt/insightrag), GYMOS_DIR (default
# /opt/gym-os), EDGE_DIR (default /opt/edge).
#
# What it does, in order:
#   1. Creates the shared_edge Docker network (safe to re-run).
#   2. Pulls each app to a commit that has docker-compose.shared-edge.yml.
#   3. Redeploys InsightRAG with that overlay instead of docker-compose.prod.yml
#      — --remove-orphans retires its old Caddy container, since the new
#      file set no longer defines one.
#   4. Deploys GYM OS the same way (schema first, then the app).
#   5. Brings up the one shared Caddy, fronting both.
#
# Idempotent: re-running it after either app updates just redeploys both.

set -euo pipefail

INSIGHTRAG_DIR="${INSIGHTRAG_DIR:-/opt/insightrag}"
GYMOS_DIR="${GYMOS_DIR:-/opt/gym-os}"
EDGE_DIR="${EDGE_DIR:-/opt/edge}"
INSIGHTRAG_DOMAIN="${INSIGHTRAG_DOMAIN:?set INSIGHTRAG_DOMAIN, e.g. insightrag.YOUR-IP.sslip.io}"
GYMOS_DOMAIN="${GYMOS_DOMAIN:?set GYMOS_DOMAIN, e.g. gym.YOUR-IP.sslip.io}"

say() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(id -u)" -eq 0 ]] || die "run as root"
command -v docker >/dev/null || die "Docker is not installed"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required"
[[ -d "$INSIGHTRAG_DIR/.git" ]] || die "$INSIGHTRAG_DIR is not an InsightRAG checkout (set INSIGHTRAG_DIR)"
[[ -d "$GYMOS_DIR/.git" ]]      || die "$GYMOS_DIR is not a GYM OS checkout (set GYMOS_DIR)"
[[ -f "$INSIGHTRAG_DIR/.env" ]] || die "$INSIGHTRAG_DIR/.env is missing — InsightRAG needs to already be deployed once (its JWT_SECRET lives there)"
[[ -f "$GYMOS_DIR/.env" ]]      || die "$GYMOS_DIR/.env is missing — deploy GYM OS standalone once first (deploy/install.sh), then re-run this"

say "Creating the shared_edge network (safe if it already exists)"
docker network inspect shared_edge >/dev/null 2>&1 || docker network create shared_edge

say "Updating InsightRAG"
git -C "$INSIGHTRAG_DIR" fetch -q origin main
git -C "$INSIGHTRAG_DIR" checkout -q main
git -C "$INSIGHTRAG_DIR" reset -q --hard origin/main
[[ -f "$INSIGHTRAG_DIR/docker-compose.shared-edge.yml" ]] \
  || die "$INSIGHTRAG_DIR is on a commit without docker-compose.shared-edge.yml"

say "Redeploying InsightRAG without its own Caddy (shared Caddy fronts it now)"
( cd "$INSIGHTRAG_DIR" && docker compose -p insightrag \
    -f docker-compose.yml -f docker-compose.shared-edge.yml \
    up -d --build --remove-orphans --wait --wait-timeout 300 )

say "Updating GYM OS"
git -C "$GYMOS_DIR" fetch -q origin main
git -C "$GYMOS_DIR" checkout -q main
git -C "$GYMOS_DIR" reset -q --hard origin/main
[[ -f "$GYMOS_DIR/docker-compose.shared-edge.yml" ]] \
  || die "$GYMOS_DIR is on a commit without docker-compose.shared-edge.yml"

say "Applying the GYM OS schema"
( cd "$GYMOS_DIR" && \
  docker compose -p gym-os -f docker-compose.yml -f docker-compose.shared-edge.yml \
    up -d postgres --wait --wait-timeout 180 && \
  docker compose -p gym-os -f docker-compose.yml -f docker-compose.shared-edge.yml \
    run --rm migrate )

say "Deploying GYM OS without its own Caddy"
( cd "$GYMOS_DIR" && docker compose -p gym-os \
    -f docker-compose.yml -f docker-compose.shared-edge.yml \
    up -d --build --remove-orphans --wait --wait-timeout 900 app )

say "Starting the shared Caddy"
mkdir -p "$EDGE_DIR"
cp "$GYMOS_DIR/deploy/edge/docker-compose.yml" "$EDGE_DIR/docker-compose.yml"
cp "$GYMOS_DIR/deploy/edge/Caddyfile" "$EDGE_DIR/Caddyfile"
cat > "$EDGE_DIR/.env" <<ENV
INSIGHTRAG_DOMAIN=$INSIGHTRAG_DOMAIN
GYMOS_DOMAIN=$GYMOS_DOMAIN
ENV
chmod 600 "$EDGE_DIR/.env"
( cd "$EDGE_DIR" && docker compose -p edge up -d --remove-orphans --wait --wait-timeout 120 )

cat <<EOF

────────────────────────────────────────────────────────────────────────
 Both apps are now behind one shared Caddy on 80/443.

   InsightRAG:        https://$INSIGHTRAG_DOMAIN/
   GYM OS staff:       https://$GYMOS_DOMAIN/
   GYM OS members:     https://$GYMOS_DOMAIN/#/member

 Certificates are issued on first visit to each hostname and can take a
 minute per domain.

 To update either app from now on, pull its repo and redeploy with the
 SAME shared-edge command this script used — not deploy/install.sh, which
 assumes it owns 80/443 alone.
────────────────────────────────────────────────────────────────────────
EOF
