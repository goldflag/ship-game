# Local damage, support systems and fires — 2026-09-06

Ships now retain structural damage by location. Every registered blueprint has eight longitudinal sections, separate port/starboard regions and underwater/upper-hull/upperworks bands, plus independent gunhouse regions. The original authoring recipe is `assets/ships/author-local-damage.ts`; it uses existing hull spaces for generator and fire-control proxies and records the approximations in every ship's discrepancy register. Existing assembly, joint, module and socket IDs are retained.

## Combat behavior

- The first half of a region's structural capacity takes full damage. The remaining half tapers exponentially. Capacity is finite and does not recover through equipment repairs. Overall hull HP, flooding, capsize and permanent weapons loss retain their roles.
- A projectile keeps separate nominal regional ceilings and actual hull damage. Saturating its entry point does not consume its opportunity to damage intact structure farther along its path. Repeated layers, ticks and bursts still share one hull-damage ceiling per victim. Direct equipment bonuses scale with the actual cumulative equipment HP removed.
- Breaches subtract overlapping area on the same face using 128 deterministic aperture samples. Identical hits add no new area; larger or displaced openings do. Aperture height and local submersion are retained. The existing 64-cluster/four-square-metre per-room limit remains a cost bound; geometric coverage after clustering and after partial shoring is approximate. Pressure-hull failure explicitly grows a breach and does not use projectile-overlap semantics.
- Underwater blasts distribute their single damage budget across nearby hull regions, with a calibrated radius. They remain dangerous without pouring a torpedo's full blast into one small shell-hit region.
- Generators share electrical load. Supply loss reduces fixed pumping and slows gun training, elevation and loading to a 25% manual fallback. Portable pumping remains independent. Fire-control station loss increases seeded shot dispersion for players and bots. Fire-control availability also depends on electrical supply. These are aggregate game systems, not a cable-by-cable network.
- Bots reconsider aim during their existing observations. Depleted empty areas lose priority; intact machinery behind a damaged side remains a useful target. Original targeting delays, errors and deterministic seeds remain in use.

## Fires and feedback

Compartment and mount fire profiles define finite fuel, ignition thresholds and heat sensitivity. Machinery, magazines, cargo and inhabited equipment spaces have distinct estimated loads; empty flood voids have none. Protected explosive rays can heat combustible spaces even without a module. Wrecked equipment may still have fuel, while burned-out fuel never regenerates from another hit. Fires damage local equipment rather than applying a universal hull-HP drain.

Intact closed boundaries block heat transfer. Crews can now close open boundaries to contain fire as well as flooding, and firefighting competes with pumping and repairs. The readout distinguishes growing, contained, fought and cooling fires, names threatened equipment and exposes one-click crew focus. Existing suppression, immersion, magazine protection and finite repair supplies remain.

The battle inspector outlines damaged structural regions separately from equipment and floodwater. Hit labels explain reduced damage and equipment reached through wreckage; new openings are labeled as openings rather than claiming every above-water hole is already flooding. Room fires produce smoke at authored outlets; gunhouse fires retain flames and smoke. The effects remain bounded and consume CPU simulation state without feeding back into it.

## Evidence

`bun scripts/diagnostics/local-damage.ts` writes [calibration.json](calibration.json). Sixteen identical 45.5-point hull consequences remove **145 HP** from one Bismarck upper-hull region, versus **728 HP** spread across sixteen fresh regions. An unchanged 0.1 m² opening adds **0 m²** on the next identical hit; widening it to 0.2 m² adds **0.1 m²**. An unattended 90-second gunhouse fuel load consumes itself and leaves 28 equipment HP in the isolated fixture. These measurements isolate the local rules; they are not ballistic duel durations or historical hit tolerances.

Regression cases cover saturation, independent sides/depths, through-wreckage hits, proportional equipment damage, projectile ceilings, blast distribution, overlapping holes, reset/repair behavior, finite fire fuel, armor-blocked heat, support systems, crew feedback and bot aim. See the [validation record](validation.md) for 611 passing tests, asset hashes, loaded articulation checks and in-game captures.
