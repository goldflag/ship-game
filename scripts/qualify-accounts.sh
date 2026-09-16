#!/bin/bash
# Run on the target host, in the staged release, using an isolated Compose project.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${NAVAL_TEST_CUSTOM_SOURCE:?Set a reviewed stress source path}"
project=ships-qualification
compose=(docker compose -p "$project" -f compose.yml -f deploy/compose.qualification.yml)
mkdir -p .build/qualification
rm -f .build/qualification/approved.json
cleanup() { "${compose[@]}" stop server api compiler web postgres; }
trap cleanup EXIT
"${compose[@]}" up -d --wait --wait-timeout 120
# Pass the secret through the environment, never a command argument or log.
set -a
source .env
set +a
# Test clients stay on-host; large snapshots never traverse the public Internet.
docker run --rm --network ships-qualification_simulation --memory=768m -v "$PWD:/work" -w /work \
  --add-host qualification.test:172.30.79.2 -e NAVAL_TEST_URL=http://qualification.test:8080 -e NAVAL_TEST_SECONDS=600 \
  -e "NAVAL_TEST_CUSTOM_SOURCE=$NAVAL_TEST_CUSTOM_SOURCE" \
  -e NAVAL_TEST_COMPILER_URL=http://compiler:8790 -e SERVICE_SECRET \
  -e NAVAL_QUALIFICATION_OUTPUT=.build/qualification/capacity.json \
  oven/bun:1.3.3 bun scripts/multiplayer/capacity-smoke.ts
for service in server api compiler postgres; do
  id=$("${compose[@]}" ps -q "$service")
  docker inspect "$id" --format '{"state":{{json .State}},"restarts":{{.RestartCount}}}' > ".build/qualification/$service.json"
done
python3 - <<'PY'
import json
from pathlib import Path
p=Path('.build/qualification')
r=json.loads((p/'capacity.json').read_text())
assert r['ok'] and r['custom'] and r['durationSeconds']>=600 and r['compileJobs']>0
assert all(c['frames']>=r['durationSeconds']*15 for c in r['clients'])
for service in ['server','api','compiler','postgres']:
 status=json.loads((p/(service+'.json')).read_text())
 assert status['restarts']==0, service
 s=status['state']
 assert s['Running'] and not s['OOMKilled'] and s.get('Health',{}).get('Status')=='healthy', service
(p/'approved.json').write_text(json.dumps(r))
PY
