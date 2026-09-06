# U-570 / Type VIIC: primary-plan fidelity pass

Configuration: U-570 as captured in August–September 1941, using British survey hull datums and the 1941 German deck fit. Original independently authored geometry. Sources and comparison images are under `../../references/`; uncertainty is tracked in `../discrepancies.md`.

## What changed

The original broad V-shaped envelope is replaced by 170 authored stations with a circular midbody, outboard saddle shoulders, a narrow trapezoidal casing deck, raised stern and curved bow, and a flat ballast keel. The tower is an open teardrop with a single early C/30 basket, correctly separated periscopes and a lower bridge lip. Gun axes, external torpedo covers, loading hatches, wood lining, rails and aerials follow the captured arrangement and photographs. Twin screws, shaft brackets, rudders, plane guards and a keel spur are independently rebuilt from the stern views.

The six stable game spaces now use disjoint cells conservatively inside the round pressure-body envelope. Major tower walls use the same blueprint triangles in the renderer and CPU plating. All existing gun, plane, rudder, screw and tube socket IDs remain. The raised periscope camera follows the new physical eye datum.

## Evidence and calibration

The retained U.S. Navy / David Taylor Model Basin redraw is 6238 × 2750 pixels. Overall endpoints x350/x4944 are registered to 67.10045 m, giving one uniform 68.4645 px/m scale. Midpoint is x2647; interpreted profile waterline is y1054, deck-plan centreline y1692. Profile and top are not independently stretched. Local scan/drawing disagreement is visible and remains approximately 0.15–0.3 m.

British docking Plate 4 supplies 220 ft 1¾ in overall, 20 ft 2¼ in beam, 15 ft 7½ in surfaced draft, and 19 ft 7½ in keel-to-casing depth. Its 15 ft 6 in circular pressure section, saddle-tank section and stern details guide the original interpolation. The captured notebook maximum 14.612 m scope height above keel becomes a 9.8495 m eye above the selected waterline.

ONI explicitly states that the net cutters drawn on the enclosed class plan were not fitted to U-570. They are omitted. Later British fittings, snorkels and late-war enlarged AA platforms are not mixed into the 1941 boat. Blade diameter/pitch use the legible 1940 class manual; the U-570 docking-plan propeller lettering remains an open discrepancy.

## Iteration and inspection

`before/` preserves the original blueprint, recipe, compiled definition, five standard views and twelve comparison cameras. `iterations/01/` preserves the first corrected hull. Comparing its aft weapon with the profile prompted a 0.65 m pedestal correction. The final pass also splits the real hull at the paint waterline and welds tiny cap intersections before export, avoiding a stepped paint edge and degenerate triangles.

The final five standard views and all twelve matched cameras were inspected, including bridge interior, plan, bow, circular bilges, stern brackets and moving appendages. The comparison page exposes original/current/historical layers; tolerance success is not a claim of complete historical accuracy. No complete original yard table of offsets has been recovered. Small fittings, paint, exact shutters, pressure boundaries, buoyancy and capacities remain as documented approximations.

## Reproduce

```sh
python3 assets/ships/type-viic/authoring/generate_blueprint.py
bun run ship:compile type-viic
bun run ship:build type-viic
bun run ship:review type-viic
bun test --timeout 60000
bun run build
```

No Blender MCP tools were available; the build and review used local Blender through the shared pipeline. `authoring-reads.json` records the production reads; retained scans are not texture/mesh inputs. `modeling-spec.json` measures the actual exported hull, stable landmarks, compound room clearances and CPU structural probes. Runtime captures are direct WebGPU canvases; the HTML HUD is not included.

See `validation.json`, `runtime/` and `tests.txt` for the final checks. The port's historical review link opens `/ship-reference/type-viic/index.html`; its ZIP contains the matched views, source register, evidence, probes and GLB.
