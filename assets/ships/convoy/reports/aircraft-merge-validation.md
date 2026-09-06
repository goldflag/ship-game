# Convoy and aircraft rebase validation — 6 September 2026

Resolved README and garage text conflicts by retaining the nine-ship roster, regional-map documentation, submerged-operation descriptions, and definition-derived merchant machinery/armor text. The three convoy/nametag commits were rebased onto `0a567e0`.

Rebuilt all four convoy ships with local Blender through `ship:build` for the combined aircraft compiler. Refreshed Yamato, Baltimore, Enterprise and Type VIIC comparison packs through `ship:compare`; their broad evidence dependency hashes include the changed shared catalog/pipeline. No blueprints, geometry recipes or preserved baselines were changed for this resolution.

`verify-merge-continuity.ts f75ac3c` passed for all four convoy exports. [Continuity evidence](aircraft-merge-continuity.json) confirms unchanged simulation definitions, scene geometry, materials and joint/socket hierarchies, allowing only the verifier's documented UV float-rounding tolerance. Earlier fixed review sheets were inspected; earlier runtime screenshots retain their original hashes. This is an integration rebuild, not a fresh live-browser or historical-accuracy approval.

Validation: 48 convoy/aircraft/land/nametag tests passed; 19 nametag/frame tests passed (overlapping nametag coverage); 18 ship-view/fleet-loading tests passed. TypeScript passed. `bun run build` passed all nine ship checks, thirteen aircraft checks, TypeScript and Vite. The existing large-bundle warning remains.
