# Ships host deployment

Fleet Command runs at **https://ships.tomato.gg** on the ships host (`64.176.223.30`, Vultr, 4 vCPU,
8 GB RAM, 8 GB swap, Ubuntu 26.04 with Ubuntu's `docker.io`, `docker-compose-v2` and `docker-buildx`).
It has its own Docker Compose project, `ships`, defined in [`compose.yml`](../compose.yml). Cloudflare proxies
the domain to the host; UFW allows only SSH, HTTP and HTTPS. The game moved here from Hermes on 2026-09-26
because the release Rust build (about 2.3 GB per rustc) no longer fitted beside Hermes's other services.
The older static `/naval/` deployment on tanks-na is independent.

## Runtime and compatibility

Caddy routes `/api/auth/*`, `/api/ships/*` and `/api/progress/*` to Bun/Hono, and
multiplayer routes to Rust. `/internal/*` is never proxied. PostgreSQL 17 has a dedicated persistent
`ships_postgres` volume and no host port. The compiler is a private, isolated
container with 512 MiB memory, 0.5 CPU, one subprocess and bounded admission.
See [accounts](accounts.md) for storage, ownership and protocol contracts.

The public edge is a separate Compose project, `ships-edge` ([`deploy/edge`](../deploy/edge), installed at
`/opt/ships-edge`), a Caddy that holds the Let's Encrypt certificate and proxies to the web container over the
`ships-edge` network (`172.30.79.0/24`, the default `EDGE_PROXY_CIDR`). Deploys copy its files and restart it only
when its Caddyfile changed, so certificates survive game releases. The web container alone joins that network. Rust trusts only its fixed
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
bun run deploy:ships
```

The script builds one compatible release, drains Rust with its 35-minute shutdown grace, recreates the private
network while preserving volumes, then starts PostgreSQL and migrations. It takes a PostgreSQL `pg_dump -Fc` before starting the new services.
After activation, verify signup/login, ship saving, research progress, multiplayer smoke tests and
account/design/progress/result survival through a restart. After activation it keeps only the current and
previous releases (directories and `ships-*` images) and prunes build cache older than a week. Each
release holds about 2.5 GB of images plus a copy of `dist`. Change [`deploy/edge/Caddyfile`](../deploy/edge/Caddyfile) only when
adding a domain.

## Recovery and rollback

Never run `docker compose down -v`. Select a PostgreSQL-compatible release with compatible migrations
and protocol/content. Drain the current battle service before replacing images.
Restore a database only as an explicit disaster-recovery operation.

Inspect services with `docker compose ps`, `docker compose logs --tail=100 api
server compiler`, and `curl --fail https://ships.tomato.gg/api/health`. Use
PostgreSQL dumps for consistent backups. Startup aborts interrupted battles;
match simulation is not reconstructed after host/process loss. There is no
rolling multi-host failover.

## Moving to a new host

The 2026-09-26 move from Hermes took about ten minutes of downtime and changed no data:

1. Install `docker.io docker-compose-v2 docker-buildx`, and open 80 and 443 in UFW.
2. Copy `/opt/ships/settings.env` unchanged; new secrets would sign every user out. Copy the running
   release's `ships-*` images (`docker save | zstd` piped into `docker load`) and its release directory,
   so the first start needs no build.
3. Create the `ships-edge` project and seed its `data` volume with the old edge's
   `caddy/certificates/acme-v02.api.letsencrypt.org-directory/ships.tomato.gg/`, so TLS works before
   Let's Encrypt can reach the new host.
4. Start `postgres` alone (its init creates only roles), `pg_restore` a fresh `pg_dump -Fc` of the old
   database, then run `migrate` and start the rest. Compare per-table row counts on both hosts.
5. Point DNS at the host and stop the old stack. Cloudflare-proxied records change within seconds.

## Initial Hermes verification (historical)

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
