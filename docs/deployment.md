# Hermes deployment

Fleet Command runs at **https://ships.tomato.gg** on Hermes (`5.78.237.254`).
It has its own Docker Compose project, `ships`, defined in [`compose.yml`](../compose.yml).
The older static `/naval/` deployment on tanks-na is independent.

## Runtime and compatibility

Caddy routes `/api/auth/*` and `/api/ships/*` to Bun/Hono, and multiplayer routes
to Rust. `/internal/*` is never proxied. PostgreSQL 17 has a dedicated persistent
`ships_postgres` volume and no host port. The compiler is a private, isolated
container with 512 MiB memory, 0.5 CPU, one subprocess and bounded admission.
See [accounts](accounts.md) for storage, ownership and protocol contracts.

The web container alone joins `matcha-watch_private`. Rust trusts only its fixed
private proxy address. Keep both edge and web Caddy Cloudflare trust lists in
sync. Health checks remain public; auth, ship and match content responses are
not cacheable. Two simultaneous matches remain the maximum admission cap.

All web, Bun, compiler and Rust images must use the same release and retained
catalogs. Migrations run as `ships_migration`; neither runtime role can modify
schemas. The API role cannot read results and the battle role cannot read auth
or private ship libraries. Auth and service secrets must remain stable across
container replacements.

## Qualification before release

Build and test locally, then stage the complete release on Hermes. Run
`scripts/qualify-accounts.sh` there with `NAVAL_TEST_CUSTOM_SOURCE` pointing to a
reviewed stress source. Its separate `ships-qualification` project has its own
database/network and listens only at `127.0.0.1:18780`. It never joins the public
edge network. Build it with `COMPOSE_PARALLEL_LIMIT=1 docker compose -p
ships-qualification -f compose.yml -f deploy/compose.qualification.yml build`.
Use separate generated credentials in the staging directory's `.env`. The test
client uses `http://qualification.test:8080` inside that private network and sends
load directly to the private compiler; no internal endpoint becomes public.

The test must sustain two matches for ten minutes, with eight worst-permitted
custom ships per participant and concurrent compilation. Each client must receive
at least 15 updates/second, persistence must remain healthy, and no service may
OOM or abort from overload. The script checks these gates and produces
`.build/qualification/approved.json` only on success. An easy starter hull or
historical-only capacity run does not qualify the custom-ship release. Inspect
source complexity and compiled geometry/output limits before selecting the stress
fixture. Keep the reviewed fixture and raw measurements in ignored `.build/`.
Do not deploy a failed or incomplete qualification.

## Current release gate

The accounts/custom-ship release is **not qualified for public deployment**.
On 2026-09-16, isolated Hermes testing with eight distinct custom ships per
participant (512 primitives, 32 equipment instances, 712 hull cells plus 1,189
compartment cells per ship) produced simulation-lag infrastructure aborts at
ticks 31 and 181. This fixture fits the online limits and fails before weapon
combat. The ten-minute/two-match requirement therefore remains unmet. No
`approved.json` was issued and the public SQLite deployment was left unchanged.

An earlier admission-memory failure was addressed by retaining serialized
artifacts, sharing compiled definitions and bounding content pins. The remaining
release blocker is custom-volume simulation cost; optimize and requalify that
path before running the PostgreSQL cutover. Do not increase lag tolerances or
silently reduce advertised source limits to bypass the gate. Temporary fixtures,
container logs and measurements remain under ignored `.build/`.

## PostgreSQL cutover

`/opt/ships/settings.env` must provide `POSTGRES_PASSWORD`, `API_DB_PASSWORD`,
`BATTLE_DB_PASSWORD`, `MIGRATION_DB_PASSWORD`, `BETTER_AUTH_SECRET` and
`SERVICE_SECRET`. Generate independent URL-safe random secrets (at least 32
characters); never commit them. Optional settings include `SHIP_DOMAIN`, storage
quotas, edge network and trusted edge proxy CIDR. Database role creation happens
only on a new volume; changing an environment password does not rotate an
existing database role.

Pass the successful host qualification file to the deployment command:

```sh
SHIP_QUALIFICATION=.build/qualification/approved.json bun run deploy:hermes
```

The script checks the protocol/simulation/content identity and a digest of all
shipped runtime inputs (including auth/server code and web assets), builds one compatible
release, drains Rust with its 35-minute shutdown grace, recreates the private
network while preserving volumes, then starts PostgreSQL and migrations. It copies the stopped SQLite volume, including WAL, to a retained
backup. `services/db/import-sqlite.ts` imports all records in one transaction and
verifies IDs, terminal flags and JSON equivalence before commit. Legacy anonymous
rows retain null account ownership. The first PostgreSQL startup records any
remaining incomplete match as a server-restart abort.

The script retains the SQLite volume/backups and records the PostgreSQL cutover
marker. It takes a PostgreSQL `pg_dump -Fc` before starting the new services.
After activation, verify signup/login, ship saving, multiplayer smoke tests and
account/design/result survival through a restart. Update the external edge
Caddy configuration only when installing a new domain, preserving existing sites.

## Recovery and rollback

Never run `docker compose down -v`. Keep SQLite backups for forensic recovery,
but after any new account/design writes, the old SQLite deployment is **not** a
safe rollback. Select a PostgreSQL-compatible release with compatible migrations
and protocol/content. Drain the current battle service before replacing images.
Do not restore a pre-cutover dump over new account or design writes as a routine
rollback. Restore a database only as an explicit disaster-recovery operation.

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
