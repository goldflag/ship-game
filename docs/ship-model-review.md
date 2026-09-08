# Ship model review

Required for every new ship and every affected assembly after a geometry or shared-component change. Follow the [ship pipeline](ship-pipeline.md) to build first; inspect the generated Blender scene and the actual exported model in-game.

These are authoring and visual acceptance checks. Existing export validation verifies hashes, dimensions and joint geometry; it does not automatically certify attachment, historical proportions, detail or collision-free movement.

## 1. No floating geometry

- Every fitted mesh needs a modeled physical support leading through its owning assembly to the hull: deck, pedestal, bracket, bearing, strut or another appropriate connection. Scene parenting alone does not establish physical attachment.
- Inspect above, below and behind shields, platforms, rangefinders and small fittings. Isolate or section hidden supports.
- Preserve separate meshes and pivot empties for moving parts. Model their mechanical connections without welding independent joints together.
- Articulate the assembly and verify that attachments remain seated throughout movement.

## 2. Turret, bridge and bow proportions first

Target **100% historically accurate shapes and proportions** for the selected dated configuration. Resolve these recognition features before decorative work.

| Feature | Check against historical evidence |
| --- | --- |
| Turrets | Width, length, height, roof/face slopes, barrel spacing and mounting height |
| Bridge | Tier widths and heights, setbacks and silhouette |
| Bow in side profile | Stem rake/curvature, overhang, sheer and waterline entry |

- Compare orthographic side, front and top views with dated plans and documented dimensions at a common scale. Use photographs to resolve or corroborate details; unmatched perspective views are qualitative evidence.
- Use measurements and matched overlays at the stated waterline/loading condition while reviewing; temporary files belong in `.build/`.
- Correct known mismatches before declaring completion. Summarize missing or conflicting evidence and provisional reconstruction in the ship README. The 100% target does not justify an unsupported accuracy claim.

## 3. Especially intricate exposed guns

- Model the actual variant's visible mechanisms on open deck and AA guns: applicable breech, cradle, trunnions, recoil cylinders/springs, pedestal, shield thickness/brackets, sights, handwheels, seats and ammunition feed/loading fittings.
- Use supported details. Generic cylinders on blocks remain placeholders; invented machinery is not a substitute for research.
- Preserve separate moving mechanisms and correct joint ownership. Check that all detail is physically attached.
- Inspect close-up side, rear and quarter views at the game's closest inspection distance. Temporary captures belong in `.build/`. Keep detail within the [model performance guardrails](ship-runtime-contract.md#coordinate-and-component-contract).

## 4. No turret clipping

- Check the whole moving assembly: gunhouse, barrels, rangefinder and attached fittings. Test against decks, barbettes, bridge, boats, railings, equipment and other turrets.
- Sweep full permitted traverse and elevation with recoil from rest to maximum. Inspect intermediate angles, combined extremes and narrow-clearance positions.
- Test neighboring mounts in different allowed poses. All guns pointing together, neutral poses and endpoint screenshots are insufficient.
- Keep intended bearing interfaces seated; moving exterior surfaces must not penetrate surrounding geometry.
- Fix geometry, placement, pivots or supported mechanical limits in durable authoring inputs while preserving researched dimensions/positions. Arbitrary shrinking, moving or restricting guns to conceal a clash is not a historical correction.
- Repeat the sweep on the exported GLB in-game. A blocked firing path does not prevent mesh clipping and is not a clearance pass.

For the development port articulation hook and exact-hash diagnostics, see [runtime diagnostics](ship-runtime-contract.md#renderer-bindings-diagnostics-and-inspection). The shared hook does not replace checking independent neighboring-mount poses.

## Completion

Inspect the exact published model/hash, affected assembly IDs and reference configuration. Summarize checks performed, tested poses, failures and unresolved issues in the task response. No tracked review report or reference archive is required. Keep the current five fixed views in `generated/review/`; all additional captures and diagnostic output belong in ignored `.build/`.

Floating parts, known priority-proportion mismatches, placeholder exposed guns and turret clashes **block visual acceptance**. Fix durable inputs, rebuild and repeat affected reviews before reporting completion. Retest every affected ship after shared-component changes. Keep only lasting limitations and source links in the ship README.
