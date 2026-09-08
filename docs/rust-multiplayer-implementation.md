# Rust fleet multiplayer implementation

Implemented on `goldflag/rust-fleet-multiplayer`, integrated with remote master `8495e905`. The reviewed proposal and Fable critique remain preserved separately. Local functional validation is complete; public deployment and capacity qualification on the intended host remain separate launch work. See the [retained validation evidence](../assets/reviews/rust-multiplayer/README.md).

## Implemented

The native server and the custom-battle WASM worker share the complete renderer-free Rust battle simulation and addressed command handler. This includes articulated gunnery, AP/HE contacts and bursts, torpedoes, depth charges, local structural damage, compartment flooding, machinery, damage-control crews, submarine ballast, seeded bots, ship/land collisions, carrier operations, aircraft flight and automatic AA. Immutable compiled geometry is shared between matches. Historical ships retain the existing versioned blueprint and compiled-definition pipeline; the runtime roster remains `src/ships/presets.ts`.

Rules come from `assets/gameplay/battle-rules.v1.json`: 1v1 fleets have at most 200,000 metric tonnes, eight vessels and two carriers. Trusted initial displacement is frozen in integer kilograms. Physical loss ends a side; disarmed or immobile ships still count. Battles end at 30 minutes with the greater tonnage afloat winning; equal totals and mutual destruction draw. Custom battles use the same finish/scoring rules, retain 30 ships per side and explicit deployment/conditions. Multiplayer rolls a registered map and weather, with morning/noon weighted 35 each, dawn/dusk/night 10 each.

Axum/Tokio handles HTTP and WebSockets; a bounded admission layer starts dedicated match threads. Public queue and invite codes freeze selected fleets before matching. Pairing requires two live socket leases; unopened/disconnected lobby tickets expire after ten seconds and queued sockets answer server heartbeats. The client checks protocol, simulation build, content manifest and rules versions. Both clients finish loading before the countdown and simulation clock start. Loading expires after 120 seconds, reconnection has a 90-second grace, and held input expires after 500 ms. The initial state uses a compressed, non-droppable protocol-3 metadata frame with a 15-second write deadline; steady-state writes retain the two-second slow-consumer limit. Replacing a connection increments its epoch and invalidates older sockets and commands. A simulation that exceeds its lag budget aborts without awarding a winner.

SQLite uses a bounded writer queue, WAL and synchronous FULL. The first final result is immutable, incomplete matches become infrastructure aborts after restart, and graceful shutdown waits for committed writes. SIGINT/SIGTERM disables admission and drains matches; a second signal requests explicit infrastructure termination. Storage failure prevents further admission.

The browser consumes snapshots through a shared session interface. Ship/motion/damage objects retain their identities for renderer bindings. Worker failures appear in the HUD and game error callback. A worker owns custom simulation ticks; online ticks belong exclusively to the server. Fleet commands include taking the helm, move/hold/autonomous orders, target focus and owned carrier orders. Waypoints can be placed on the navigation chart or entered as coordinates. Engine or rudder changes restore manual steering while gun input alone preserves a waypoint. Online menus do not pause the battle; leaving for port explicitly forfeits an active online match. Per-tab session storage supports reconnecting after reload. The 90-second reconnect grace includes asset loading until Ready; repeatedly reconnecting without becoming ready does not extend it. After held input expires, selected-ship gunfire stops and standing fleet movement resumes, including autonomous steering; menus and blur do not stop server time.

Transport uses compressed updates against an immutable match baseline supplied on connection. Every update can reconstruct the latest state independently, so bounded latest-frame delivery can discard intermediate frames. Public damage inspection remains available, matching the existing game; there is no new fog-of-war rule. Bot tracking/RNG, projectile collision ledgers and blast budgets stay private. Water surfaces are reconstructed for inspection from authoritative compartment volumes and hull poses rather than transmitting redundant cached planes.

## Running locally

Use Bun 1.3.3, the pinned Rust toolchain, its `wasm32-unknown-unknown` target and `wasm-bindgen-cli` matching Cargo.lock (0.2.128).

```sh
# With rustup installed, this checkout's rust-toolchain.toml selects the compiler and target.
rustup show
cargo install wasm-bindgen-cli --version 0.2.128 --locked
bun install --frozen-lockfile
bun run multiplayer:prepare
bun run multiplayer:server
```

In another terminal:

```sh
bun run dev
```

Vite proxies `/api` (including WebSockets) to `http://127.0.0.1:8787`; set `NAVAL_SERVER` to change the development target. Open **1V1 MULTIPLAYER** in port, choose a fleet, then find an opponent or create/join an invite. A second tab/browser can join the invite. Custom battles use the Rust worker without requiring a running server.

Server settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NAVAL_BIND` | `127.0.0.1:8787` | HTTP/WebSocket listener |
| `NAVAL_MANIFEST` | `.build/naval-content/manifest.json` | Trusted deployment content |
| `NAVAL_DATABASE` | `.naval-data/matches.sqlite` | Durable results |
| `NAVAL_MAX_MATCHES` | `2` | Admission cap, 1–32; two simultaneous matches exercised locally, qualify on the deployment host before increasing |
| `NAVAL_ORIGIN` | request host | Optional exact allowed browser origin |
| `NAVAL_TRUSTED_PROXIES` | empty | Comma-separated proxy IP addresses allowed to supply X-Forwarded-For; all other headers are ignored |

For deployment, build the browser and server from the same checkout/lockfile and deploy the matching manifest. Serve `dist/` and reverse-proxy its `api/` path on the same HTTPS origin, with WebSocket upgrade support. For `BASE_PATH=/naval/`, route `/naval/api/*` to the Rust server’s `/api/*`; the client preserves the deployment prefix. Configure `NAVAL_TRUSTED_PROXIES` with the reverse proxy’s actual socket address (for example `127.0.0.1,::1` for a local proxy; dual-stack listeners may report an IPv4-mapped address such as `::ffff:127.0.0.1`, which must be listed explicitly). Per-client join limits use the first untrusted address walking the forwarding chain from right to left, with a separate global admission budget. Keep the SQLite directory on persistent storage and allow a full battle's drain time during rolling shutdown. Infrastructure is not provisioned or deployed by this implementation.

## Validation

```sh
bun run multiplayer:check
bun run test
bun run build
bun run multiplayer:smoke       # requires the local server
bun run multiplayer:capacity-smoke # dedicated server, cap 2, no other players
bun run multiplayer:benchmark 1800
```

`multiplayer:check` generates content, runs native tests and Clippy, builds WASM and checks frozen migration fixtures. Standalone Cargo tests require the generated manifest. Wire types are exported with `TS_RS_EXPORT_DIR=src/multiplayer/generated cargo run -p naval-protocol --bin export`. Frozen fixtures are refreshed deliberately with `bun run multiplayer:fixtures`, never as part of routine tests.

Validation passed native tests and Clippy, complete native/WASM battle comparisons covering 28,800 simulated ticks, all registered weapon-group IDs, damage records and shell histories, 133 TypeScript test files, and the production build with all ship/aircraft checks. GitHub Actions runs the native/WASM checks, TypeScript suite, production build and release-server HTTP/WebSocket smoke. See the PR checks for remote execution status. The [implementation review disposition](reviews/rust-multiplayer-review-disposition.md) records Fable’s findings and their fixes.

Real TCP checks cover load barrier, ownership, movement, reconnect epochs, old socket replacement, forfeit, frozen final-result retrieval, HTTP queue cancellation, four players in two simultaneous maximum-size legal fleets and refusal of a third match. SQLite tests verify committed writes after flush, immutable results and restart aborts. Both custom battle launch and two-client online play ran in the actual GPU browser, including ship switching, a 150 ms network-latency setting, a three-second game-socket outage, reconnection with a new epoch and the opponent's victory display. The isolated browser required `--use-angle=metal`; its default software graphics path stalled during harbor warmup.

Numerical corrections affect both the TypeScript migration reference and Rust: segment/box contacts tolerate 1e-9 endpoint roundoff after world/local rotations, without physically expanding a box or admitting a real 0.1 mm miss. Dedicated regression tests and deliberately refreshed fixtures cover this. Linux CI additionally exposed side/normal selection from sub-nanometre lateral roundoff at centered hull contacts. Contact damage now canonicalizes lateral coordinates within 1e-9 m of the centerline before choosing a region and breach normal; genuine 0.1 mm off-center hits remain distinct. The separating-axis solver also keeps its first axis for penetration depths tied within 1e-9 m, so symmetric rams do not reverse their impulse across math-library rounding. Dedicated Rust/TypeScript regressions and intentionally refreshed collision/grounding fixtures cover both corrections. Exact triangular structural seams retain dedicated duplicate-layer checks; these comparisons do not claim bitwise cross-platform lockstep.

Before the final master integration, six historical comparison records were rebuilt through `ship:compare` using local Blender because the endpoint correction changed a declared comparison input. Blender MCP tools were unavailable; all output hashes stayed identical and no model geometry changed. Master subsequently retired those archives and the comparison command; integration preserves that removal. Current ship/aircraft checks still pass. This does not supply new historical model acceptance.

## Measured limits and public launch work

On an Apple M5 Pro with 18 logical CPUs and 48 GiB RAM, two release runs each simulated 1,800 aggregate active seconds with eight ships per side, two carriers per side and 72 aircraft airborne. Battles restarted when their outcome completed, so these are sustained active-combat soaks, not single battles reaching the 30-minute deadline. North Atlantic/overcast and Pacific Islands/storm seeds produced mean simulation ticks of 1.35/1.27 ms, p99 ticks of 11.09/10.56 ms, mean update encoding of 13.06/12.04 ms and peak RSS of about 118 MiB per benchmark process. The host was also running other development work.

Compressed update payloads averaged 184/181 kB at 20 Hz: approximately **3.7/3.6 MB/s per player** in these carrier-heavy battles. Immutable-baseline updates preserve bounded recovery and complete damage inspection but become expensive as damage/history accumulates. This transport needs further bandwidth work before targeting ordinary low-bandwidth Internet connections. A 30-second real-server concurrency check sustained about 20 Hz to four clients across two 16-vessel matches; it is not a long-duration concurrency qualification.

All 20 map/weather combinations ran 300 ticks each. A native maximum custom fleet ran 60 active seconds with 60 ships and 288 airborne aircraft, peaking at about 280 MiB RSS. That stress run's p99 simulation tick was 54 ms, and its benchmark also includes online encoding that custom workers do not use. It does not establish 60 Hz for maximum custom fleets on every browser.

The proposal's p99 complete-tick target below 8 ms is **not met** by these worst-case local measurements. Qualify CPU headroom, full-duration concurrent matches, extended jitter/loss and stalled-write scenarios on the intended server before public launch or increasing admission. Native/WASM correctness comparisons do not promise bitwise cross-platform lockstep. The production build also retains a warning about its 7.9 MB shared JavaScript chunk. No public server or infrastructure was deployed.
