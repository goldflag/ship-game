#!/bin/bash
# Build and deploy a PostgreSQL-compatible release to the ships host.
set -euo pipefail
cd "$(dirname "$0")/.."
# Shells without rustup on PATH still build the WASM through scripts/multiplayer/toolchain.ts; match its fallback.
command -v cargo >/dev/null || PATH="$HOME/.cargo/bin:$PATH"
target="${SHIP_DEPLOY_HOST:-root@64.176.223.30}"
[[ "$target" =~ ^[a-zA-Z0-9_.@-]+$ ]] || { echo 'Invalid SHIP_DEPLOY_HOST' >&2; exit 1; }
SHIP_REVIEW_PAGES=0 BASE_PATH=/ bun run build
# Test here rather than in the server image build, which is slow on the host.
cargo test --release --locked -p naval-server -p naval-protocol
release="$(git rev-parse --short=12 HEAD)-$(date -u +%Y%m%dT%H%M%SZ)"
remote="/opt/ships/releases/$release"
ssh "$target" "mkdir -p '$remote'"
rsync -azR Cargo.toml Cargo.lock rust-toolchain.toml package.json bun.lock crates \
  assets/gameplay assets/parts/construction/hull_shapes.rs public/models/components/catalogs \
  .build/naval-content/manifest.json compose.yml .dockerignore deploy services dist \
  src/generated/naval-version.json src/progression/techTree.ts src/progression/rules.ts src/progression/xp.ts \
  "$target:$remote/"
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
# The public edge is its own project so deploys never restart it or lose its certificates.
# Rewrite the Caddyfile in place: its single-file bind mount keeps the original inode.
mkdir -p /opt/ships-edge
cp deploy/edge/compose.yml /opt/ships-edge/compose.yml
edge_changed=
if ! cmp -s deploy/edge/Caddyfile /opt/ships-edge/Caddyfile; then
  cat deploy/edge/Caddyfile > /opt/ships-edge/Caddyfile
  edge_changed=1
fi
(cd /opt/ships-edge && docker compose up -d && { [ -z "$edge_changed" ] || docker compose restart caddy; })
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
if ! docker compose up -d --wait --wait-timeout 120 compiler api server web; then
  docker compose logs --tail=40 server api compiler || true
  # Restore the previous release when this one added no migrations; its schema is then unchanged.
  if [ -L /opt/ships/current ] && diff -rq services/db/migrations "$(readlink /opt/ships/current)/services/db/migrations" >/dev/null; then
    echo "Release $release did not become healthy; restoring $(basename "$(readlink /opt/ships/current)")" >&2
    docker compose rm -sf compiler api server web
    (cd /opt/ships/current && docker compose up -d --wait --wait-timeout 120 compiler api server web)
  else
    echo "Release $release did not become healthy after new migrations; not restoring automatically" >&2
  fi
  exit 1
fi
# Once accounts/design writes begin, rollback must preserve PostgreSQL.
if [ -L /opt/ships/current ]; then ln -sfn "$(readlink /opt/ships/current)" /opt/ships/previous; fi
ln -sfn "/opt/ships/releases/$release" /opt/ships/current
docker compose ps
# Keep the current and previous releases; each one holds about 2.5 GB of images and a copy of dist.
keep=" $release $(basename "$(readlink /opt/ships/previous 2>/dev/null || true)") "
for dir in /opt/ships/releases/*/; do
  old="$(basename "$dir")"
  [[ "$keep" == *" $old "* ]] || rm -rf "$dir"
done
docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^ships-(web|server|api|compiler):' | while read -r image; do
  [[ "$keep" == *" ${image#*:} "* ]] || docker image rm "$image" >/dev/null
done
# Week-old layers only, so the cargo cache mounts of recent builds survive.
docker builder prune -f --filter until=168h >/dev/null
REMOTE
NAVAL_TEST_URL=https://ships.tomato.gg bun run multiplayer:smoke
printf 'Deployed %s to https://ships.tomato.gg\n' "$release"
