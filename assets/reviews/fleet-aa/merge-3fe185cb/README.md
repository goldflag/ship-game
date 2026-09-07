# Fleet AA merge review

Integrated master `3fe185cb41ff2dd904c314753f4a3cd5df7cbeea` into PR #56.
The resolved Yamato and Baltimore blueprints retain master's local damage,
compartments and fire profiles, plus the PR's twelve registered AA mounts each.
New mounts receive the same fire profile as the existing secondary batteries.

Recipes retain master's attachment repairs, including stationary AA foundations,
Bofors seat brackets and the Yamato open-mount trunnion axle. Moving mechanisms
use the blueprint joints; platforms and foundations remain stationary. Yamato's
support surface is sampled after galleries exist and before adding the guns,
so a gun cannot mistake its own platform for its supporting deck.

## Exact model evidence

| Ship | Content hash | Maximum muzzle error across 12 poses | Starboard-probe rounds / ammunition spent |
| --- | --- | ---: | ---: |
| Yamato | `ccaa53fcd25da2a4ecee0e65191703644e6dc73a92a083b21d4f4290ec683e54` | 0.002747 m | 24 / 24 |
| Baltimore | `d51b9a257be75c99ac6cfd835255d4c4de2f78fa51421b8c6a1ffae635c0dffc` | 0.001318 m | 496 / 496 |

Both models were rebuilt with local Blender 5.2 LTS through `ship:build`; Blender
MCP was unavailable. All five generated fixed views per ship were inspected.
The runtime JSON and `aa`, `side`, `quarter` and `rear` PNGs in this directory
were captured from the real WebGPU Game using isolated headless Chrome / Metal
after Orca's browser repeatedly closed during review.

`scripts/diagnostics/fleet-aa.html` renders nine train/elevation combinations with
recoil and three poses with neighboring mounts aimed independently. It then runs
ten seconds of real combat simulation against six held hostile planes. These are
instrumented engagements, not autonomous carrier AI. Muzzle checks establish
transform alignment; they do not prove continuous collision clearance.

The [new contact scans](../../../ships/attachment-audit/reports/fleet-aa-merge-3fe185cb/)
use master's triangle-contact scanner at its 25 mm tolerance. Baltimore has no
detached islands. Yamato has the same 59 reported islands and object-name set as
master's prior report, comprising previously documented chains, coatings and
vision slits; the integration adds none. AA mechanisms remain connected.

## Validation and limits

`bun run test` passed 722 tests in 99 files with zero failures; `bun run build`
passed all ship/aircraft checks, TypeScript and Vite. The fleet regression checks
all 152 registered AA mounts across the current 11 presets. The build retains
Vite's existing large-chunk advisory. Enterprise and Type VIIC comparison records
were regenerated for changed shared inputs without rebuilding their models.

This review checks the AA integration and preservation of master's attachments
and geometry. It does not certify historical proportions or exhaustive clearance.
Existing dated-fit uncertainties, simplified shield apertures and high-elevation
clearances remain documented in the ship discrepancy registers. Original PR
captures remain in the parent directory under their original hashes.

## Final follow-up integration

Master `54b0be10` (carrier-map navigation, transitions and overlay tracking)
landed during publication and merged cleanly. Its new camera interface required
updating `GameFrame.test.ts`: the fixture now uses the real `BattlefieldCamera`
and initializes camera-frame listeners. The 15 frame tests passed, followed by
all 727 tests in 100 files and another successful `bun run build`. Ship recipes
and model hashes are unchanged, so the retained model evidence above still
applies.
