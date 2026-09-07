# Fleet AA integration review

The [current master integration review](merge-3fe185cb/README.md) records rebuilt
Yamato/Baltimore models, attachment checks and updated validation. The captures
and validation counts below describe the original PR models before that merge;
they remain evidence for their recorded hashes.

Every current runtime preset has working registered AA. Yamato gains twelve twin
127 mm mounts, Baltimore gains twelve quad 40 mm Bofors mounts alongside its six
twin 5-inch DP mounts, and King George V's eight twin 5.25-inch mounts are admitted
by the shared 140 mm / 70° eligibility rule. Port air-defense scores use that same
rule. Damage, finite ammunition, aiming, obstruction and muzzle effects remain
owned by the shared combat simulation.

Yamato and Baltimore preserve their original AA assembly IDs and fittings, with
blueprint-owned stations and independent yaw/elevation/recoil/muzzle joints.
`assets/parts/aa_articulation.py` is a registered recipe input for these two ships.
Both were rebuilt with local Blender 5.2 LTS through `ship:build`; Blender MCP was
unavailable. Profile, plan, quarter, bow and stern views from `ship:review` were
visually inspected for both ships. Their platforms/tubs remain fixed while the
guns aim; primary batteries and hull geometry retain their previous layout.

## Combat and renderer evidence

`fleet-aa-audit.json` records four independent ten-second CPU engagements for each
preset, with a hostile plane held at 700 m horizontal distance / 250 m altitude.
Its HP is reset each tick so every mount can be exercised. All 152 eligible mounts
fired in at least one cardinal sector. The regression in
`src/simulation/antiAircraft.test.ts` repeats this scenario and checks finite ammo,
target damage, muzzle-origin events and complete mount coverage.

The reproducible in-game harness is
`/scripts/diagnostics/fleet-aa.html?ship=yamato` (also `baltimore` and
`king-george-v`) on the development server. It loads the real `Game`, renders nine
train/elevation combinations with 75% recoil, then runs ten seconds of AA combat
against six held hostile planes on the starboard side. This is an instrumented
engagement using the real renderer and simulation, not autonomous carrier AI.
The paired runtime JSON and PNG files retain the exact model hashes.

| Ship | Registered AA mounts | Starboard-probe rounds fired | Maximum rendered muzzle error over nine poses |
| --- | ---: | ---: | ---: |
| Yamato | 12 | 24 | 0.002747 m |
| Baltimore | 18 | 496 | 0.001318 m |
| King George V | 8 | 16 | 0.001739 m |

All three rendered with WebGPU. `ShipView.test.ts` also verifies the actual GLB
hierarchies through ship motion, traverse, elevation up to 85° and recoil (39
Yamato / 69 Baltimore muzzle chains). Surface-broadside regressions retain checks
on the original 155 mm and 5-inch batteries separately from the new AA guns.

Validation passed: `bun run test` (700 tests in 95 files), `bun run build`, and
`git diff --check`. After the final Yamato platform ownership correction, its
build, fixed views, runtime capture, fleet probe, 37 affected tests and production
build were repeated successfully.

## Scope and approximations

Some visible fittings remain decorative: Yamato's 25 mm guns, Baltimore's single 20 mm guns and King
George V's pom-poms/UP projectors remain visual. Existing passive target AI modes
still do not attack. New AA rates, arcs, spread, damage and supply routing are
gameplay settings; shield apertures and high-elevation clearances are simplified.
Per-ship discrepancy registers record these limits. Successful exports and combat
checks do not certify historical accuracy.

Comparison packs for Enterprise and Type VIIC were refreshed because historical
packs include the shared catalog. Their models and gameplay definitions did not
change. Earlier runtime reports remain evidence for their original hashes.
