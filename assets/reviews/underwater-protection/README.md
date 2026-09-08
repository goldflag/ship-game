# Torpedo damage and underwater protection

This is a gameplay balance pass, with no geometry or articulation changes.

All armed torpedoes now use 0.625 of their authored damage and 7/11 of their authored
breach area. Aircraft torpedoes therefore have a 10,500 HP direct hull ceiling and
a 0.35 m² breach before protection and local saturation (previously 16,800 HP and
0.55 m²). Catalog damage units remain unchanged; bombs and depth charges retain
their own damage paths.

Bismarck, Yamato and King George V author separate port/starboard underwater defense
zones. Contacts inside a zone reduce damage and breach area by 50%: the aircraft
torpedo ceiling becomes 5,250 HP with a 0.175 m² opening. Local saturation can reduce
actual hull loss further. Uncovered ends, keel and opposite-side contacts receive
no reduction. Overlaps never stack. Protection stays constant across repeated hits;
existing structural saturation, breach merging and flooding still operate.

Coverage is an estimated central side envelope, not reconstructed underwater
engineering. The zone lengths are 150 m, 160 m and 140 m respectively, with vertical
coverage from the waterline to 7 m, 8 m and 7 m below it. Each side zone extends
6 m inward from maximum beam. All use the same provisional reduction; this does
not rank their historical defenses. Exact historical limits, effectiveness and
progressive structural failure remain unresolved. No historical accuracy claim is
made for these gameplay values.

The shared blueprint contract validates the version, finite dimensions, coverage,
stable IDs and bounded reduction fractions. Future custom ships use the same
extension. Port Armor exposes the coverage, reductions and estimated basis.
Protected hit messages name the defense zone.

## Reproduction

Run `bun test src/simulation/underwaterProtection.test.ts src/simulation/torpedoes.test.ts`.
The protection tests use original blueprints, including real hull intersections
with rotated/rolled ships, matched unprotected controls, no overlap stacking,
invalid schema rejection and inspection coverage.

Open `/scripts/diagnostics/underwater-protection.html?target=bismarck` in development
(or `yamato` / `king-george-v`). After `window.reviewReady`, call
`protectionReview.strike(0, 1)` for starboard midships and
`protectionReview.strike(-100, 1)` for the bow. Each call resets the battle, injects
an armed aircraft torpedo into the real collision/score/flooding loop and advances
two seconds. The return value includes the exact compiled model hash, actual hull
loss, breach area and hit message. `strike(0, -1)` checks port coverage.

## Retained runtime results

The Orca embedded WebGPU browser exercised the published assets for all three
ships. `*-runtime.json` records each exact hash and the port, starboard and bow
contacts. Every midships contact removed 5,250 HP and opened 0.175 m²; every bow
contact removed 10,500 HP and opened 0.35 m². Protected hit messages named the
correct side. `bismarck-runtime.png` shows the matching hull-loss label and score.
The original and rebuilt export reports match for hull bounds, mount transforms,
tube transforms, triangle count and mesh count on all three protected ships.

Port UI validation selected Armor, filtered for underwater defense, selected the
starboard zone, inspected its dimensions and estimated basis, cleared selection,
returned to Statistics and launched a battle. `port-inspection.json` retains the
selected-row accessibility snapshot; `port-state.json` identifies its WebGPU model
hash. Coverage volumes now appear only when selected, preserving ordinary armor
visibility and picking. The transformed-ray regression verifies both belt picking
and explicit defense-zone picking. A port screenshot and the final return-to-port
interaction were interrupted by Orca screenshot/focus/runtime timeouts; those are
not recorded as passing browser checks. Automated port-reset coverage passed.

## Validation

- `bun run ship:build all`: passed using local Blender 5.2. No Blender MCP tools
  were available. Every asset invalidated by the shared compiler was rebuilt.
- Relevant simulation, blueprint, inspection and hit-feedback tests: 113 cases.
  The final first pass had 111 successes, an armor-picking failure and a five-second
  submarine timeout. Selection-only defense rendering fixed the picking failure;
  the 21 inspection/submarine cases then passed with `--timeout 30000` (the long
  submarine case took about seven seconds). No test assertions were relaxed to
  permit changed armor picking.
- `bun run build`: passed after the inspection fix, including ship/aircraft checks,
  TypeScript and production bundling. Vite retains its large-chunk advisory.
- `git diff --check`: passed.
