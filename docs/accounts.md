# Accounts, ship storage and multiplayer construction

The browser requires a Better Auth session before mounting the game or builder.
Signup asks for display name, email and a password of at least 12 characters and
signs in immediately. This release does not send verification or password-reset
mail. Passwords are managed by Better Auth, not by gameplay code.

Bun/Hono owns `/api/auth/*` and `/api/ships/*`. Rust owns matchmaking, WebSockets
and authoritative simulation. Caddy blocks `/internal/*`; Rust calls Bun over the
private network with a service secret. Each admission, cancellation, content
fetch and socket upgrade reads the database-backed session with cookie caching
and refresh disabled. Open sockets recheck every 30 seconds. Errors fail closed
and leave simulation running through the existing reconnect grace. Browser
Better Auth requests refresh sessions. Tickets belong to accounts, including
frozen final-result reconnection, and one account cannot queue or play twice.

## Source storage and recovery

PostgreSQL schemas `auth`, `ships` and `results` separate the data. The migration
role owns schema changes. API credentials have access only to auth and ship
records; battle credentials have access only to results. PostgreSQL never
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

## Online construction

Protocol 5 fleet references distinguish historical presets from owned saved
revisions. Rust asks Bun to resolve ownership and prepare the chosen sources.
The private worker uses retained catalogs and the native Rust compiler. Neither
derived combat values nor catalogs come from a browser. Online source identities
are normalized to the saved design/revision UUIDs before compilation.

The worker processes one job at a time, queues at most eight and permits one
outstanding job per account. Its container has 512 MiB memory (no swap), 0.5 CPU,
and 64 PIDs. A subprocess has a ten-second wall limit, 8 MiB stdout and 64 KiB
stderr limits; failure kills and reaps it. A bounded cache keys source bytes,
catalog digest and simulation/compiler build. Online limits are 512 primitives,
32 equipment instances, 2,048 derived hull/compartment cells and 4,096 surface patches. These do not
change editor or local battle limits. There is no new custom-carrier authoring
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
`ACCOUNTS_URL`, `AUTH_ORIGIN` and `NAVAL_ORIGIN`. Both origins must equal the Vite
origin, including its worktree port. Start `bun run accounts:server`,
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
