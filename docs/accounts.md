# Accounts, ship storage and multiplayer construction

The browser requires a Better Auth session before mounting the game or builder.
Signup asks for display name, email and a password of at least 8 characters and
signs in immediately. This release does not send verification or password-reset
mail. Passwords are managed by Better Auth, not by gameplay code.

Bun/Hono owns `/api/auth/*`, `/api/ships/*` and `/api/progress/*`. Rust owns matchmaking, WebSockets
and authoritative simulation. Caddy blocks `/internal/*`; Rust calls Bun over the
private network with a service secret. Each admission, cancellation, content
fetch and socket upgrade reads the database-backed session with cookie caching
and refresh disabled. Open sockets recheck every 30 seconds. Errors fail closed
and leave simulation running through the existing reconnect grace. Browser
Better Auth requests refresh sessions. Tickets belong to accounts, including
frozen final-result reconnection, and one account cannot queue or play twice.

## Source storage and recovery

PostgreSQL schemas `auth`, `ships`, `progress` and `results` separate the data. The migration
role owns schema changes. API credentials have access only to auth, ship and
research records; battle credentials have access only to results. PostgreSQL never
publishes a host port. `services/db/migrations` contains versioned, checksummed
migrations; do not edit applied migrations in later releases.

Saved design and revision IDs are server-issued UUIDs. A design also retains its
original authoring identity so undo, editor and source exports keep stable IDs.
Every save creates an immutable revision with compare-and-swap against the last
acknowledged revision. Save operation UUIDs make retries idempotent; deletion
keeps small operation tombstones to prevent a delayed request recreating a design.
Physical compilation errors do not block source saves. Imports create copies.

Defaults are 100 designs and 100 MiB of source/history per account, configurable
through `SHIP_MAX_DESIGNS` and `SHIP_MAX_BYTES`, with 16 MiB per source. Quota and
revision failures retain the draft and show retry/download/copy recovery actions.
No history is silently pruned. IndexedDB stores recovery drafts by account; it is
not the saved library. A browser adapter is bound to its original account and
sends an expected-account header checked against the actual session. Logging out
closes transports and clears account presentation state without deleting drafts. Reconnect tickets remain scoped to that account, so a short auth outage or re-login can still use the reconnect grace.
The account menu offers explicit import of the old same-origin IndexedDB library.
Other origins use JSON download/import. Recovery downloads can be imported as new
copies in the builder; they are never automatically uploaded to a different account.

Browser construction workers cache compiled output across reloads, keyed by the
compiler build and complete source/catalog bytes. The disposable cache retains up
to eight results of at most 32 MiB each; unavailable storage falls back to compilation.
Saved sources still come from the account store, and online admission still compiles server-side.

## Research progress

`progress.profiles` holds one JSON profile per account (unspent XP per nation, free XP,
unlocked nodes, lifetime XP). `progress.awards` is the append-only record of paid battles,
keyed by account and battle UUID. Both cascade when the account is deleted. The API role
reads, inserts and updates profiles, and only reads and inserts awards. The rules are the
pure shared modules `src/progression/techTree.ts`, `rules.ts` and `xp.ts`, which the API
image copies. Stored profiles are always read through `sanitizeProfile`.

| Route | Body | Response |
| --- | --- | --- |
| `GET /api/progress` | | `{profile}`; no row reads as the empty profile and writes nothing |
| `POST /api/progress/unlocks` | `{nodeId}` | `{profile, spent}` |
| `POST /api/progress/awards` | `{id, summary}` (`id` a UUID) | `{profile, award}` |

The routes share the ship routes' session, `x-account-id` binding and write-origin checks,
with a 64 KiB body limit. Errors are `{code, error}`: 400 `invalid` for a malformed body or
summary; 409 with the rule's code (`insufficient-xp`, `prerequisite`, `owned`, `placeholder`,
`unknown-node`) for a refused unlock; 409 `conflict` for a reused battle id. Each change runs in one transaction under a per-account advisory lock.

The API validates the summary with `validateSummary` and computes the award with `awardFor`;
an award sent by the client is ignored. A battle id pays once per account. The digest covers
the validated summary, so a retry with the same summary returns the recorded award and the
current profile without paying again, and the same id with a different summary is a 409.
Retries return the recorded award, not a recomputation under later tuning.

The summary is client-reported: custom and PvE battles run in the browser. The API bounds it
(30 ships a side, 34 minutes, 120,000 t a ship, 5,000 XP a battle) but cannot tell that the
battle happened, and does not limit how many battles an account reports. A modified client
can claim XP. Treat XP as progression only, never as a competitive or purchasable currency,
until results come from an authoritative simulation.

Vite proxies `/api/progress` and `/api/admin` with the other accounts routes, to production by
default; the client treats a 404 as progress unavailable and keeps every ship open.

## Administrators

Better Auth's `admin` plugin adds `role`, `banned`, `banReason` and `banExpires` to
`auth."user"` and `impersonatedBy` to `auth.session` (migration 004). New accounts get the role
`user`; accounts older than the migration have none, which also means not an administrator.
Promote an account on the host (`ssh root@64.176.223.30`, then `cd /opt/ships/current`):

```sh
docker compose exec -T postgres psql -U ships_admin -d ships \
  -c "UPDATE auth.\"user\" SET role='admin' WHERE email='<email>'"
```

An administrator can then promote or demote others on the admin page. The page is `/admin` on
the game's own origin (`src/admin/`), loaded without the game bundle. It uses Better Auth's
admin endpoints under `/api/auth/admin/*` to list and search accounts and set roles, and these
routes for research:

| Route | Body | Response |
| --- | --- | --- |
| `GET /api/admin/progress/:userId` | | `{profile}` |
| `POST /api/admin/progress/:userId` | `AdminProgressAction` | `{profile}` |

`AdminProgressAction` (`src/progression/rules.ts`) is one of `grant-xp` (`amount`, an integer
within ±1,000,000, may be negative to correct a balance that never drops below zero; `pool` a
nation, `free` or `all`), `unlock` or `lock` (`nodeId`; a gift spends no XP, starters cannot be
locked), `unlock-all` (`value`) and `reset` (keeps award records, so a reported battle never pays
twice). The routes need a session whose role includes `admin` (403 `forbidden` otherwise) and an
allowed Origin for writes; an unknown account is 404 `not-found`. Every change is appended to
`progress.admin_actions` with the administrator's id; the API role can only read and insert it.

## Online construction

Protocol 5 fleet references distinguish historical presets from owned saved
revisions. Rust asks Bun to resolve ownership and prepare the chosen sources.
The private worker uses retained catalogs and the native Rust compiler. Neither
derived combat values nor catalogs come from a browser. Online source identities
are normalized to the saved design/revision UUIDs before compilation.

The worker processes one job at a time, queues at most eight and permits one
outstanding job per account. Its container has 512 MiB memory (no swap), 0.5 CPU,
and 64 PIDs. A subprocess has a ten-second wall limit, 64 MiB stdout and 64 KiB
stderr limits; failure kills and reaps it. A bounded 96 MiB cache keys source bytes,
catalog digest and simulation/compiler build. Online designs use the same limits as the editor and
local battles: the native compiler enforces them, and the worker adds only the 64 MiB artifact bound
(a realistic battleship compiles to about 28 MB). There is no new custom-carrier authoring
or campaign support.

Rust applies the existing eight-ship, two-carrier, 200,000-tonne fleet rules to
server-derived definitions. Tickets and per-match catalogs retain artifacts, so
later edits/deletion cannot affect a battle. Participants fetch the immutable
match content through an authenticated POST carrying their ticket, verify its
SHA-256 and acknowledge that hash in Ready. Sources are not repeated in snapshots. Rust retains serialized buffers and shared
compiled definitions rather than expanded JSON copies. At most two fleets prepare
concurrently; a 320 MiB content-pin budget rejects new admissions without evicting
existing matches or their reconnect/final-result content.
Rendering and HUD definitions belong to the match session and never enter an
opponent's editable library. Historical manifest checks remain in force.

## Local development and checks

Install PostgreSQL 17, create the runtime/migration roles using
`services/db/init.sh`, and run `bun run accounts:migrate` with
`MIGRATION_DATABASE_URL`. `compose.yml` provisions these roles on a new database
volume. Use separate randomly generated credentials (URL-safe hex is convenient).
Set `API_DATABASE_URL`, `BATTLE_DATABASE_URL`, `BETTER_AUTH_SECRET`, `SERVICE_SECRET`,
`ACCOUNTS_URL` and `AUTH_ORIGIN`. Set `AUTH_ORIGIN=http://localhost:5173` for local
development. A loopback auth origin also trusts HTTP(S) origins on `localhost`,
`127.0.0.1` and `[::1]` at other ports, so the same API supports Vite worktrees.
Leave `NAVAL_ORIGIN` unset locally: Rust checks that Origin matches Host through
Vite's same-origin proxy. For deployment, set both origins to the exact public
origin; public auth origins never grant this loopback exception.
Start `bun run accounts:server`,
`bun run compiler:server`, `bun run multiplayer:server`, and Vite.
Build the worker with `cargo build --release -p naval-sim --example compile_construction`.

Run `bun run accounts:check` for service typechecks and subprocess/queue tests.
Set `TEST_API_DATABASE_URL` and `TEST_ADMIN_DATABASE_URL` to an isolated migrated
PostgreSQL database to include the real auth/storage integration tests. They are
explicitly skipped without those URLs. Run native server/protocol tests and
`bun run build`. `multiplayer:smoke` now creates authenticated test accounts;
`scripts/multiplayer/custom-smoke.ts` covers mixed fleets and account attacks.
The host qualification workflow is documented in [deployment](deployment.md).

`scripts/tests/accounts-browser.mts` exercises two authenticated Chrome contexts,
remote custom rendering and account-isolated recovery against the local stack.
`scripts/tests/compiler-oom.mts` is a Linux cgroup check: run it inside a disposable
Bun container with `--memory=512m --memory-swap=512m --cpus=0.5`, the repo mounted
at `/work`, and `/work` as its working directory. It requires a real child OOM
kill and then a successful subsequent compiler job. Never run that check without
the container memory limit.
