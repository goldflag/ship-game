# Carrier branch integration

Integrated `origin/master` at `54bf4113` into PR #46. The merged sources retain
fleet batching, ship wakes and funnel smoke, battle conditions, AI levels,
spawn planning, continuous optics, shell selection, HUD scaling, aircraft
ordnance effects, wreck descent and folding wings.

Carrier squadrons still launch in about ten seconds. Folding types unfold
during their compressed deck run, reaching full span before liftoff. Recalled
aircraft clear their deck slot when parking completes. Static and moving target
AI remains passive under the shared mount-based AA system. AA tracers use the
new gunfire renderer with the actual ship muzzle, speed and endpoint; fighter
tracers retain lead, inherited velocity and seeded aim error.

Scaled HUD map clicks use screen coordinates; squadron tags use logical HUD
coordinates. Responsive carrier controls use the HUD container dimensions.
Leaving the map restores the selected weather's visibility. Endurance labels
use the same extended limit as the simulation.

The ID-aware catalog merge retains both Bismarck's AA parts and King George V's
parts. Compiled definitions and models passed without rebuilding geometry.
The ship checker identified stale comparison packs for Bismarck, Yamato,
Baltimore, Enterprise and Type VIIC; all five were regenerated through
`ship:compare`. Ignored review ZIPs remain local build outputs. Three squadron
thumbnails were rebaked with local Blender from the incoming aircraft models
and visually inspected.

Validation:

- Full suite: 673 tests pass across 95 files, zero failed files.
- Subsequent weather restoration and endurance-label integration: 12 targeted
  carrier UI/operations/commands tests pass.
- Integration workflow tests: 4 pass.
- Final `bun run build`: all ship and aircraft checks, TypeScript and Vite pass.
  The existing large-chunk warning remains.
- `git diff --check` passes; no unmerged paths remain.

The WebGPU AA/follow captures and fleet audit in `air-combat-fixes.md` predate
this merge and remain evidence for their recorded source/model versions. No new
live-game result is claimed here: Orca's temporary browser page did not retain
its loaded game state during this integration session. The merged camera,
aircraft visibility, gunfire, mount articulation and render-frame paths are
covered by the passing automated suite.
