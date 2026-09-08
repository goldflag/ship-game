# IJN Shōkaku — December 1941

Playable original Shōkaku-class carrier for the shared version-1 ship pipeline. Launch, recovery, Japanese weapon release, surface fire, AA, damage, flooding and port reset have been verified in the actual game. See the [model and runtime review](reports/acceptance.md), [discrepancy register](reports/discrepancies.md) and [sources](references/sources.json). Historical reconstruction remains qualified where evidence is incomplete.

The [window/island/stern correction](reports/correction-02/README.md) adds recessed bridge glazing, reference-aligned deck levels, two-level stern boat stowage, a rounded afterbody and distinct tandem rudders.

The [deck correction](reports/correction-03/README.md) removes five overlapping superstructure walking surfaces by seating room roofs under their plates and joining the signal gallery to the flight-deck cutout. Both the Blender source and exported GLB pass the new deck regression.

The blueprint fits eight twin 127 mm Type 89 mounts, twelve triple 25 mm Type 96 mounts, and a 72-aircraft wing of A6M2 Zeros, D3A1 Vals and B5N2 Kates. Three elevator assemblies, two downturned funnels, a tiered island, four screws, tandem rudders, gallery supports and an IJN ensign retain separate assembly ownership. Gun yaw, elevation, recoil and muzzle sockets use the existing combat contract.

Open `/?ship=shokaku`, or select Shōkaku in the harbor and Custom battle. At sea, **M** opens the existing air operations controls. Aircraft are hidden in the hangar until ordered to launch. Select **HE** with **E** to fire the carrier's guns manually; this fit carries no AP stock. The original aircraft assets are reused; flight tuning, service timing and damage remain gameplay approximations. The Japanese aircraft currently keep their wings in flight position because their published rigs do not contain folding hinges.

The export contains 339,244 triangles and occupies 11,920,892 bytes (11.37 MiB), within the per-model guardrails. The [GLB](../../../public/models/shokaku.glb), [compiled definition](../../../public/models/shokaku.json) and [generated Blender scene](generated/source.blend) share content hash `9417b0cbd8b1316f706388d8dd3ee67f8fe1f6653aad3e5203245ec7a809096e`.

Authoring uses `blueprint.json`, `build.py` and the declared original gun recipe under `assets/parts/ijn-carrier-guns/`. Generated `.blend` and `.glb` files are build outputs. Historical reference images are research evidence only and never enter the production recipe as meshes or textures.

```sh
bun run ship:compile shokaku
bun run ship:build shokaku
bun run ship:check shokaku
bun run ship:review shokaku
```

`authoring/generate_blueprint.py` replaces the blueprint from the original arrangement recipe; run it only for deliberate regeneration. Follow with `bun assets/ships/author-stability.ts shokaku` to calibrate the modeled load and residual flood spaces, then `bun -e 'import { writeLocalDamage } from "./assets/ships/author-local-damage"; await writeLocalDamage(["shokaku"]);'` to restore the local damage profiles. Builds consume the resulting blueprint directly.

The reference condition uses 257.5 m overall length, 26 m waterline beam and 8.87 m mean draft. Hidden hull sections and exact bridge/gunhood dimensions remain qualified reconstruction. Attachment, mechanism and movement reviews pass at the hash above; the priority-proportion review retains its explicit source uncertainties. Passing export checks does not certify historical accuracy. Reproduce the reviews with the [authoring instructions](authoring/README.md).

Blender MCP was not exposed in this session. The tool actually used was local Blender 5.2.0 LTS, launched by `ship:build` and `ship:review`.
