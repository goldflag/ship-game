#!/bin/bash
# Build and deploy a PostgreSQL-compatible release to Hermes.
set -euo pipefail
cd "$(dirname "$0")/.."
target="${SHIP_DEPLOY_HOST:-root@5.78.237.254}"
[[ "$target" =~ ^[a-zA-Z0-9_.@-]+$ ]] || { echo 'Invalid SHIP_DEPLOY_HOST' >&2; exit 1; }
SHIP_REVIEW_PAGES=0 BASE_PATH=/ bun run build
release="$(git rev-parse --short=12 HEAD)-$(date -u +%Y%m%dT%H%M%SZ)"
remote="/opt/ships/releases/$release"
ssh "$target" "mkdir -p '$remote'"
rsync -azR Cargo.toml Cargo.lock rust-toolchain.toml package.json bun.lock crates \
  assets/gameplay assets/parts/construction/hull_shapes.rs public/models/components/catalogs \
  .build/naval-content/manifest.json compose.yml .dockerignore deploy services dist \
  src/generated/naval-version.json "$target:$remote/"
# Compose defaults to reading stdin. Execute a complete file so it cannot consume
# later deployment commands from the SSH script stream.
ssh "$target" "umask 077; cat > '$remote/deploy.sh' && bash '$remote/deploy.sh' '$release' </dev/null" <<'REMOTE'
set -euo pipefail
release="$1"
cd "/opt/ships/releases/$release"
umask 077
printf 'SHIP_RELEASE=%s\n' "$release" > .env
# Never generate replacement secrets on a database volume that already exists.
test -f /opt/ships/settings.env
cat /opt/ships/settings.env >> .env
docker compose config --quiet
COMPOSE_PARALLEL_LIMIT=1 docker compose build
# Drain first, then recreate the private network to reserve static proxy/server IPs.
# Volumes and the external edge network are retained.
docker compose stop server
docker compose down
docker compose up -d --wait postgres
docker compose run --rm -T --interactive=false migrate
mkdir -p /opt/ships/backups
# A PostgreSQL backup is mandatory for every release.
docker compose exec -T postgres pg_dump -U ships_admin -d ships -Fc > "/opt/ships/backups/postgres-$release.dump"
docker compose up -d --wait --wait-timeout 120 compiler api server web
# Once accounts/design writes begin, rollback must preserve PostgreSQL.
if [ -L /opt/ships/current ]; then ln -sfn "$(readlink /opt/ships/current)" /opt/ships/previous; fi
ln -sfn "/opt/ships/releases/$release" /opt/ships/current
docker compose ps
REMOTE
NAVAL_TEST_URL=https://ships.tomato.gg bun run multiplayer:smoke
printf 'Deployed %s to https://ships.tomato.gg\n' "$release"
