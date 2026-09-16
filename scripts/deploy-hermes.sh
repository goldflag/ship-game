#!/bin/bash
# Deploy a PostgreSQL-compatible release with capacity evidence or an explicit risk acceptance.
set -euo pipefail
cd "$(dirname "$0")/.."
target="${SHIP_DEPLOY_HOST:-root@5.78.237.254}"
[[ "$target" =~ ^[a-zA-Z0-9_.@-]+$ ]] || { echo 'Invalid SHIP_DEPLOY_HOST' >&2; exit 1; }
if [ "${SHIP_ACCEPT_LARGE_FLEET_RISK:-0}" = 1 ]; then
  : "${SHIP_CAPACITY_WAIVER_REASON:?Describe the explicit authorization to deploy without large-fleet qualification}"
else
  : "${SHIP_QUALIFICATION:?Set the target-host approved.json from the ten-minute custom-fleet test}"
fi
SHIP_REVIEW_PAGES=0 BASE_PATH=/ bun run build
bun -e '
const {releaseDigest}=await import("./scripts/deployment-inputs");
const version=await Bun.file("src/generated/naval-version.json").json();
const digest=await releaseDigest();
if(process.env.SHIP_ACCEPT_LARGE_FLEET_RISK==="1") {
  const reason=process.env.SHIP_CAPACITY_WAIVER_REASON?.trim();
  if(!reason) throw new Error("Capacity waiver requires an explicit authorization reason");
  await Bun.write(".build/deployment/capacity-evidence.json",JSON.stringify({
    qualified:false,acceptedRisk:"Large custom fleets may abort from simulation lag",
    reason,recordedAt:new Date().toISOString(),releaseDigest:digest,version,
  },null,2)+"\n");
  console.warn("Deploying with recorded large-fleet risk acceptance; qualification has NOT passed.");
  process.exit(0);
}
const proof=await Bun.file(process.env.SHIP_QUALIFICATION).json();
if(proof.releaseDigest!==digest||!proof.ok||!proof.custom||proof.durationSeconds<600||proof.concurrentMatches!==2||proof.compileJobs<1||proof.clients.length!==4||proof.clients.some(c=>c.frames<15*proof.durationSeconds)||JSON.stringify(proof.version)!==JSON.stringify(version))throw new Error("Release has no matching host capacity qualification");
await Bun.write(".build/deployment/capacity-evidence.json",JSON.stringify(proof,null,2)+"\n");'
release="$(git rev-parse --short=12 HEAD)-$(date -u +%Y%m%dT%H%M%SZ)"
remote="/opt/ships/releases/$release"
ssh "$target" "mkdir -p '$remote'"
rsync -azR Cargo.toml Cargo.lock rust-toolchain.toml package.json bun.lock crates \
  assets/gameplay assets/parts/construction/hull_shapes.rs public/models/components/catalogs \
  .build/naval-content/manifest.json compose.yml .dockerignore deploy services dist \
  src/generated/naval-version.json "$target:$remote/"
rsync -az .build/deployment/capacity-evidence.json "$target:$remote/"
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
if [ ! -f /opt/ships/postgresql-cutover ]; then
  backup="/opt/ships/backups/sqlite-$release"
  mkdir -p "$backup"
  # Preserve database plus WAL from the stopped server, without modifying its volume.
  docker run --rm -v ships_matches:/source:ro -v "$backup:/backup" alpine:3.22 sh -c 'cp -a /source/. /backup/'
  test -f "$backup/matches.sqlite"
  docker compose run --rm -T --interactive=false -v "$backup:/backup:ro" migrate bun services/db/import-sqlite.ts /backup/matches.sqlite
fi
# A PostgreSQL backup is mandatory for every later release as well.
docker compose exec -T postgres pg_dump -U ships_admin -d ships -Fc > "/opt/ships/backups/postgres-$release.dump"
docker compose up -d --wait --wait-timeout 120 compiler api server web
touch /opt/ships/postgresql-cutover
# Once accounts/design writes begin, rollback must preserve PostgreSQL.
if [ -L /opt/ships/current ]; then ln -sfn "$(readlink /opt/ships/current)" /opt/ships/previous; fi
ln -sfn "/opt/ships/releases/$release" /opt/ships/current
docker compose ps
REMOTE
NAVAL_TEST_URL=https://ships.tomato.gg bun run multiplayer:smoke
printf 'Deployed %s to https://ships.tomato.gg\n' "$release"
