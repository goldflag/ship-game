# Shell tracers and projectile detail — September 7, 2026

The owner's [World of Warships screenshot](user-reference.png) supplies the visual target: compact white-gold heads above long, thin pale trails. It is comparison evidence only. Geometry and trail shading are authored independently.

- [Main salvo](salvo.png): eight live CPU-fired rounds, 0.65 seconds after firing toward a 12 km aim point.
- [Secondary salvo](secondary.png): six live rounds using the same caliber-scaled effect.
- [Projectile close-up](shell-closeup.png): actual in-game material and geometry, viewed roughly 4.5 m from a live 38 cm round.

Each capture has matching JSON diagnostics. [Source hashes](source-hashes.json) identify the exact rendering inputs. Captures use the existing Game, Bismarck model, ocean, sky, CPU firing and WebGPU renderer in Orca's embedded browser, at 1920×1080 backing resolution and medium quality.

## Durable inputs and behavior

`assets/effects/naval/shellGeometry.ts` is the original procedural recipe: curved ogive, cap joint, bourrelet, beveled heel, two engraved copper driving bands and recessed base cup. The model is 4.4 calibers long, with fittings integrated into the profile and +Y pointing along flight. Metal shading responds to scene lights. It is an illustrative shared projectile, not a historically verified ammunition variant. No ship blueprint, catalog, compiled definition or GLB changes are involved; this recipe runs in Three.js, without Blender.

`ShellTrails` records up to 1.25 seconds of observed CPU positions at roughly 20 Hz, retaining additional observed ricochet corners. Width follows projection and caliber; opacity fades down the trail and after impacts. Bombs, lodged rounds and underwater flight do not emit these trails. Pause preserves history; reset clears every GPU page. The visibility effect recedes from 150 to 65 m camera distance so shell-follow reveals the physical projectile. Histories keep recording while hidden.

The detailed model has 5,376 triangles and uses expanding 16-instance pages only when caliber exceeds 0.2% of view height. Other rounds use a 312-triangle silhouette. Trails expand in 1,024-segment pages; active projectile counts remain unrestricted. Trail interpolation, dimensions, machining, materials and luminosity are visual approximations and never feed combat decisions.

## Validation

46 focused tests passed (3,223 assertions), covering combat effects, shell trails, aircraft gunfire, AP behavior and shell travel. Checks include launch bounds, recorded curvature, observed ricochets, pause, impact fading, underwater/lodged suppression, reuse/reset, 1,100 simultaneous histories, shell-follow visibility, projected model detail, and range/zoom readability. `bun run build` passed all registered ship and aircraft checks, TypeScript and Vite, with the existing large-bundle advisory. No browser console errors were reported during the WebGPU captures. WebGL2 and worst-case GPU frame time were not measured.

The design detector's advisory findings concern intentional physical-effect colors outside the HUD palette, including pre-existing torpedo colors. No interface styling was changed.

To reproduce, run `bun run dev --port 5179`, open `/scripts/diagnostics/combat-effects.html`, and call `review.still('tracers', .65)`, `review.still('tracers', .65, true)` or `review.shellCloseup()`. `review.capture()` returns the actual rendered canvas. The existing `scripts/diagnostics/capture-combat.py` accepts `tracers` as a scene.
