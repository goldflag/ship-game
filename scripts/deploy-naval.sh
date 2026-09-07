#!/bin/bash
# Build Fleet Command for https://game.tomato.gg/naval/ and sync it to the tanks-na host.
# Caddy on that host serves /root/tank-game/naval under /naval (Tomato-gg/tank-game Caddyfile, `@naval`).
# Review pages are left out: they carry third-party comparison renders meant for local authoring review.
set -euo pipefail
cd "$(dirname "$0")/.."
target="${NAVAL_DEPLOY_TARGET:-root@178.156.208.199:/root/tank-game/naval/}"
SHIP_REVIEW_PAGES=0 BASE_PATH=/naval/ bun run build
rsync -az --delete --stats dist/ "$target" | grep -E '^(Number of (regular files transferred|deleted)|Total transferred)'
curl -s -o /dev/null -w 'https://game.tomato.gg/naval/ -> HTTP %{http_code}\n' https://game.tomato.gg/naval/
