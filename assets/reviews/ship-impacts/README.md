# Ship impact marks

Shell hits leave persistent scars on the struck ship, scaled by caliber and selected from the shell type and penetration outcome. This extends the existing Fleet action presentation: the ship and sea carry the feedback, with no additional controls or instrument panels.

## Implemented behavior

- Penetrations show a dark puncture with exposed steel and torn paint. Stopped AP rounds show a bright, closed steel dent. Ricochets leave an elongated scrape aligned with the incoming direction.
- Larger calibers produce larger scars. The visual adapter supports a broader HE scorch profile; current playable guns fire AP, and this change adds no HE ammunition selection or blast simulation.
- Marks conform to nearby visible triangles and follow hull motion, sinking and turret articulation. They persist during pause, hide during inspection and clear on damage reset or return to port. Each ship retains its latest 96 marks.

The CPU records shell type, caliber, outcome and local impact position, normal and direction. Fixed hits use ship-local coordinates; moving gunhouse hits retain a stable `mountId` and yaw-local coordinates. Internal module damage and non-exterior physical plates do not create exterior scars. Projection searches both plate-normal directions for a matching rendered surface within 3 m; a proxy with no nearby visible face leaves no floating mark.

## Provenance and limits

[ImpactTexture.ts](../../../src/game/ImpactTexture.ts) authors the original procedural atlas for paint loss, exposed steel and soot, without reference textures. [ShipImpactMarks.ts](../../../src/game/ShipImpactMarks.ts) clips decals to the struck mesh and merges them into one batch per receiving mesh. Ships share the texture atlas.

These are surface decals: the apparent punctures do not cut holes or fracture the model. Their dimensions and material appearance are gameplay approximations, with no historical accuracy claim. CPU combat remains renderer-free and authoritative for hits, damage and flooding. No ship model, blueprint, Blender recipe or generated ship asset changed. The existing [design system](../../../DESIGN.md) remains the visual authority for this ordinary surface extension.

## Validation evidence

Final captures show the actual WebGPU `Game` ocean scene: [desktop](desktop.png), [narrow](narrow.png) and [articulated turret](turret.png). The narrow viewport used a 390 × 720 aspect ratio. [checks.json](checks.json) retains the measured results; [the diagnostic fixture](../../../scripts/diagnostics/ship-impacts.html) supports repeatable review.

- The surface fixture produced 9 hull marks in 1 batch, then 10 marks with an articulated turret hit. Recorded muzzle error was 0.0021605567 m. Inspection hid the marks without removing them, and returning to port left 0 marks.
- A live shell injected into the real simulation produced an impact event and 1 scar through `Game.frame`, exercising the simulation-to-renderer path.
- All 198 unique simulation/game tests were validated: 197 passed in the combined run; one fleet test timed out while a build ran concurrently. All 12 battle tests then passed in isolation in 3.15 seconds.
- `bun run build` passed with the existing large-chunk warning. The design detector returned no findings (`[]`). Ship asset rebuilds were unnecessary because this change only adds runtime surface rendering and impact event data.

Independent final reviewer disposition: **ship**.

### Smoke occlusion regression

Surface scars now draw before transparent effects, so firing smoke and spray blend over them. Opaque hull depth still clips volumes behind the ship. The explicit order also handles pooled smoke whose shared sort position differs from its individual plumes.

In the development fixture, run `await impactReview.checkSmokeOcclusion()` to compare scar pixels with no smoke, dense foreground smoke, and smoke behind the hull. Before the fix, foreground scar contrast was 2.61× the clear view; after the fix it was 0.087×, while rear smoke preserved 1.00× contrast (2,548 sampled pixels). The check requires visible clear-view scars, foreground contrast below 0.2×, and rear contrast above 0.8×. It leaves the foreground plume visible for inspection.

Validation: all 333 simulation/game tests passed, and `bun run build` passed with the existing large-chunk warning.

| Review finding | Final verdict |
| --- | --- |
| Stopped AP resembled penetration | Resolved: brighter, closed steel centers distinguish stopped rounds from dark punctures. |
| Narrow and turret captures showed stale frames | Resolved: captures wait two real frames for the Three.js `PassNode` cache to update, showing the correct aspect and articulated turret. |
