# Full-size aircraft with folding wings

The preceding 0.8 size experiment is superseded. Runtime scale is 1.0. Wildcat and Devastator parked wings now fold; Dauntless stays fixed-wing. See the aircraft wing-fold source register and discrepancy register for historical evidence and limits.

All thirteen aircraft were rebuilt using local Blender after the shared-input change; fixed top, side, front, rear, quarter and articulated views of the two folding types were inspected. The final Wildcat hinge moves forward of the initial trial pivot, which dipped through the deck during folding. The checker now samples 21 fold poses at every LOD against the tyre floor (2 cm tolerance). This is a sampled ground check, not certification of continuous swept-volume, fuselage or neighboring-aircraft clearance.

`deck.png` uses the actual published Enterprise model and combat AircraftView renderer in the dedicated deck diagnostic scene, without ocean rendering. `runtime.json` records all nine model/LOD hashes, no GPU error, three fighters outbound with wings extended and all three recovered ready with wings folded. `wildcat-inspector.png` verifies the new Fold wings checkbox and full-size folded model in the standalone inspector.

Validation: 44 simulation, renderer, follow-camera and GLB checker tests passed; all 13 aircraft built and passed export checks; registered drawing comparisons refreshed; `bun run build` passed including ship checks, aircraft checks, TypeScript and Vite. Existing large-bundle warning remains. Folded full widths are about 4.15 m (Wildcat) and 5.42 m (Devastator), limited by their fixed tailplanes. Exact hinge mechanics, actuation time and deck spotting remain approximations.
