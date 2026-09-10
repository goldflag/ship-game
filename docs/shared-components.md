# Shared ship components

Use this library before authoring equipment for a ship. The first collection is naval gun mounts; it exposes original recipes already used by the fleet. Reuse is by exact mount variant, not caliber, nationality, or visual similarity.

## Sources of truth

- `assets/parts/guns.json`: the existing versioned component catalog. Guns retain their stable IDs, geometry parameters and simulation data.
- `assets/parts/library.json`: discovery metadata and explicit original builder registrations. Every catalog gun has a nation, family, review status and limitations. This is not a second weapon definition or ship roster.
- `assets/parts/library.py`: reusable Blender entry point. It refuses equipment without a registered builder; it never substitutes a generic turret.
- Ship `blueprint.json`: the existing mount instances, positions, bearings, magazine connections and installed travel limits. Historical presets and future player designs continue to use the same versioned blueprint/definition format.
- `src/ships/presets.ts`: the authoritative roster. The viewer derives component usage from these compiled ships, not a manually maintained list.

A **reusable source** has a registered original builder. An **installed preview** isolates an assembly from a published ship for inspection; its generated GLB is never an authoring input. A reusable builder can still be **unreviewed**. Build/export checks do not mean that geometry or historical fidelity has been accepted.

The initial collection registers the existing open naval and Japanese AA recipes. Bespoke turrets remain available as installed previews until their original ship-specific code is extracted. Do not merge the different Type 96, Iowa/Baltimore, or shield variants merely to reduce the number of IDs. In particular, the legacy Iowa secondary ID/name says Mk 32; historical identification needs resolution against its approved source configuration before promotion.

## Find, build and inspect

```sh
bun run part:list
bun run part:build type96-25-triple
bun run part:check type96-25-triple
bun run model:viewer
```

Open `http://127.0.0.1:5180/?part=type96-25-triple`. Choose a component from the bottom thumbnail carousel. Filter by nation and caliber, or search by family, name or stable part ID. Thumbnails are rendered from the same actual standalone or installed geometry as the viewer. Select **Standalone shared component** or a specific installed mount as the preview source. Inspect original materials, fixed views, dimensions, wireframe and traverse/elevation/recoil. **Overlay** and **Side by side** retain the existing local GLB and GameModels3D comparison workflow. Standalone previews use a neutral palette; ship instances can supply their own materials.

`part:build all` builds registered reusable variants only. `part:check all` checks their freshness and exported joint/socket presence; run builds first in a fresh clone. `model:viewer:check` checks TypeScript and viewer/library tests. `ship:overlay` and `ship:overlay:check` remain compatible aliases.

All standalone generated GLBs, Blender scenes and logs stay under ignored `.build/parts/<part-id>/`. They are regenerated from original inputs, not committed. The viewer serves only current previews, using hashes of the selected part, builder and dependencies. Missing or stale previews show a build instruction and can still offer a clearly labeled installed preview. A failed build retains `.staging` for diagnosis; inspect its log and confirm no process owns it before removing it and retrying. `BLENDER_BIN` selects a local Blender executable.

## Install in a ship

1. Confirm the exact variant matches the approved ship fit. Check its limitations and review status in the viewer. Reuse existing reference approvals; this library does not authorize a different historical fit.
2. Reference its stable `partId` in the ship blueprint's normal `mounts` array. Keep the installed mount, joint and socket IDs stable.
3. In the original ship recipe, use the library entry point with the **compiled** mount. The interface matches the existing primitive/material contract:

   ```python
   sys.path.insert(0, str(ROOT / 'assets/parts'))
   from library import create_mount

   create_mount(mount, armament_collection,
                dict(mesh=mesh, cyl=cyl, rod=rod, box=box), materials)
   ```

   `mount` carries `id`, `partId`, `weapon`, `position` and `bearingDeg` from the compiled definition. Primitive helpers accept parent-local Blender metres; materials provide `naval`, `dark` and `edge`. See `scripts/parts/build.py` for a complete executable example. The original builder owns the attachment foot, yaw/elevation/recoil nodes and muzzle sockets. The ship owns supporting platforms, deck reinforcement and neighboring fittings.

4. Run `bun run part:inputs <part-id>` and merge its `files` into the ship's `recipe-inputs.json` without deleting existing dependencies. The ship pipeline already hashes `scripts/ships/*.py`; the command lists the additional `assets/` dependencies it needs. Declaring the registry also tracks builder selection changes.
5. Follow normal `ship:compile`, `ship:build`, `ship:check` and `ship:review`, all affected visual checks and in-game articulation. Validate intermediate poses and independently moving neighbors on the exact published ship. Component acceptance cannot certify its installation.

Authoring axes remain +X bow, +Y port, +Z up in Blender. Blueprint/runtime axes remain +X starboard, +Y up, −Z bow, in metres. Use the common exporter exactly once. Standalone mount position and bearing are zero. The viewer normalizes an installed preview to its yaw datum; any extra pedestal height is part of that installation, not a universal mounting specification.

## Extend or migrate a component

- Model a genuinely missing variant in an original reusable recipe under `assets/parts/`. Extract existing **source code or versioned original assets**, never a published ship GLB, generated `source.blend`, baseline or downloaded reference model.
- Keep gun mechanisms, mount enclosures and ship installation code separable where the real variants justify it. Use explicit builder registrations, not ship-name branches or a caliber-based fallback.
- Add or preserve the catalog part ID, add its discovery metadata, and register its builder function and transitive original Python inputs. The callable accepts `(mount, collection, helpers, materials)`. Build the standalone preview through that same callable; do not maintain a different preview model.
- Start with review `unreviewed` and precise limitations. Inspect before/after views and articulation against the approved references. Mark `accepted` only after the affected four visual checks pass; record concise basis and any accepted approximations in the component's source documentation. Never infer historical acceptance from an export pass.
- Migrate consumers to the builder and declare dependencies. Run `ship:check all`, rebuild every stale consumer it reports, and repeat affected ship reviews and runtime checks. Do not change hashes or automatically select binary outputs to bypass freshness checks.
- For a new non-gun family (directors, boats, launchers or deck fittings), extend the library contract with its real attachment/articulation needs. Do not pretend that a director or boat is a `GunPart` just to obtain a preview.

Do not create ship `reports/` or `references/` directories or a replacement tracked evidence archive. Temporary review captures stay in `.build/`; durable source, concise configuration and limitations belong with the original component.

For long-term fleet planning, see [WWII equipment reuse](wwii-equipment-reuse.md).
