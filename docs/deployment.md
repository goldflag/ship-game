# Hermes deployment

Fleet Command runs at **https://ships.tomato.gg** on Hermes (`5.78.237.254`).
It has its own Docker Compose project, `ships`, defined in [`compose.yml`](../compose.yml).
The older static `/naval/` deployment on tanks-na is independent.

## Runtime and compatibility

Caddy routes `/api/auth/*`, `/api/ships/*` and `/api/progress/*` to Bun/Hono, and
multiplayer routes to Rust. `/internal/*` is never proxied. PostgreSQL 17 has a dedicated persistent
`ships_postgres` volume and no host port. The compiler is a private, isolated
container with 512 MiB memory, 0.5 CPU, one subprocess and bounded admission.
See [accounts](accounts.md) for storage, ownership and protocol contracts.

The web container alone joins `matcha-watch_private`. Rust trusts only its fixed
private proxy address. Keep both edge and web Caddy Cloudflare trust lists in
sync. Health checks remain public; auth, ship, research and match content responses are
not cacheable. Two simultaneous matches remain the maximum admission cap.

All web, Bun, compiler and Rust images must use the same release and retained
catalogs. Migrations run as `ships_migration`; neither runtime role can modify
schemas. The API role cannot read results and the battle role cannot read auth,
private ship libraries or research progress. The API image copies `services/` and the three
shared research rule files in `src/progression/` (`techTree.ts`, `rules.ts`, `xp.ts`); keep
`.dockerignore` and the deploy script's file list in step with its imports. Auth and service secrets must remain stable across
container replacements.

## Deployment settings

`/opt/ships/settings.env` must provide `POSTGRES_PASSWORD`, `API_DB_PASSWORD`,
`BATTLE_DB_PASSWORD`, `MIGRATION_DB_PASSWORD`, `BETTER_AUTH_SECRET` and
`SERVICE_SECRET`. Generate independent URL-safe random secrets (at least 32
characters); never commit them. Optional settings include `SHIP_DOMAIN`, storage
quotas, edge network and trusted edge proxy CIDR. Administrators are a database role, not a setting:
see [accounts](accounts.md#administrators). Database role creation happens
only on a new volume; changing an environment password does not rotate an
existing database role.

Deploy with:

```sh
bun run deploy:hermes
```

The script builds one compatible release, drains Rust with its 35-minute shutdown grace, recreates the private
network while preserving volumes, then starts PostgreSQL and migrations. It takes a PostgreSQL `pg_dump -Fc` before starting the new services.
After activation, verify signup/login, ship saving, research progress, multiplayer smoke tests and
account/design/progress/result survival through a restart. Update the external edge
Caddy configuration only when installing a new domain, preserving existing sites.

## Recovery and rollback

Never run `docker compose down -v`. Select a PostgreSQL-compatible release with compatible migrations
and protocol/content. Drain the current battle service before replacing images.
Restore a database only as an explicit disaster-recovery operation.

Inspect services with `docker compose ps`, `docker compose logs --tail=100 api
server compiler`, and `curl --fail https://ships.tomato.gg/api/health`. Use
PostgreSQL dumps for consistent backups. Startup aborts interrupted battles;
match simulation is not reconstructed after host/process loss. There is no
rolling multi-host failover.

## Initial Hermes verification

The initial deployment used source commit `37013a11` with matching browser and
native simulation identities. The production build, six browser transport tests,
and 23 native server/protocol tests passed (one existing native test is ignored).
Installed Chrome rendered the harbor and opened multiplayer setup without page,
console, or network errors. The public HTTPS/WebSocket smoke passed through
Cloudflare, including reconnect and frozen-result retrieval.

A five-minute public-endpoint test from clients running on Hermes sustained two
simultaneous 16-vessel matches at about 19.4 updates/second per player and rejected
a third match. The backend used about 150 MiB RAM and roughly 1.4 CPU cores in
sampled readings; the test clients consumed additional host CPU. Each client
received about 812–816 MB over the run, so the documented bandwidth limitation
still applies. This is a five-minute capacity check, not a full-duration or
cross-region qualification. All six validation match records survived a backend
restart unchanged, and SQLite's integrity check passed. A consistent online
backup is retained at `/opt/ships/backups/verified-matches.sqlite`.
Raw deployment diagnostics remain in ignored `.build/`
locally and `/opt/ships/backups/` on Hermes.
