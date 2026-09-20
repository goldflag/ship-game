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

`part:build all` builds registered reusable variants only. `part:check all` checks their freshness and exported joint/socket presence; run builds first in a fresh clone. `model:viewer:check` checks TypeScript and viewer/library tests.

Gun parts may specify `recoilM: 0` for stationary external barrels; retain their standard recoil joints and muzzle sockets. Catalog elevation may extend to +90°. Each part's researched limits still bound the CPU pose and review controls, and installed clearance must be reviewed separately.

All standalone generated GLBs, Blender scenes and logs stay under ignored `.build/parts/<part-id>/`. They are regenerated from original inputs, not committed. The viewer serves only current previews, using hashes of the selected part, builder and dependencies. Missing or stale previews show a build instruction and can still offer a clearly labeled installed preview. A failed build retains `.staging` for diagnosis; inspect its log and confirm no process owns it before removing it and retrying. `BLENDER_BIN` selects a local Blender executable.

## Production construction equipment

The curated construction collection adds real non-gun families through
`assets/parts/construction-library.json` and the shared `ConstructionEquipmentPart`
contract. `bun run part:publish` builds its registered originals and publishes
immutable models, manifests and exact catalog revisions under
`public/models/components/`. `bun run part:published:check` verifies this retained
publication without needing preview files or Blender. The production build runs
that check; runtime fetches use the existing base-path helper. See
[construction equipment](../assets/parts/construction/README.md) for package
estimates, original source registrations, attachment datums and retained joints.
Standalone viewer previews continue to live only in `.build/parts/`.

The builder also retires paravanes, signal lamps, gun tubs, ammunition lockers,
splinter shields, fixed-shape breakwaters and the German cruiser capstan/hatch
from older catalogs' palettes. Opening a saved design or restoring the custom
fleet removes their installed instances in a new saved revision. Recovery copies
receive the same cleanup, including undo history. Earlier source revisions,
immutable catalogs and original registrations remain available for source
recovery and historical ship builds.

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

### Shared materials and component paint

`assets/parts/materials.json` is the versioned palette for standalone guns,
non-gun equipment and procedural construction paths. `materials.py` supplies
the same Blender materials to both build entry points. Coatings reuse the
shared ship finishes; RGB swatches are linear, not sRGB. The palette also
defines protected canvas, wood, rope, bronze, optics and bright metal.

Recipes assign material roles deliberately. `naval`, `roof`, `hullgray` and
`painted-edge` follow the instance's selected paint. `edge` is the retained
dark-detail role, not a claim that every fitting using it is bare metal; it and
the other fixed roles keep their original appearance. Use `painted-edge` for
dark structural fittings that should follow paint. Split a material assignment
when coated structure and protected mechanisms currently share it. Do not infer
paintability from mesh names, brightness or nationality. Opaque optics are fixed
too; transparency is not the paint contract.

The exporter retains `componentMaterialVersion`, `componentMaterialRole` and
`componentPaint` in each material's glTF extras. New publications reject missing
or inconsistent roles. The editor, game and portable construction exports use
the same paint function, changing only coating color and preserving authored
roughness, metalness, textures and articulation. Old immutable component
revisions use the explicit `legacyRoles` mapping; unknown materials remain
unchanged. Retained catalogs and saved designs are not rewritten.

Procedural mooring routes also accept an explicit per-instance rope color from
the named palette. They keep the shared rope roughness and metalness; ship paint
and surface sheen do not recolor natural rope or rope details on other fittings.

Both component hash paths track the shared palette, factory and ship finishes.
After a material change run `part:publish`, `part:thumbnails`, `ship:check all`
and the relevant tests/build checks. Review published components before and
after recoloring, including mixed materials and articulated poses. Historical
ship recipes continue to supply their approved ship-specific palettes.

### Original component recipes

- Model a genuinely missing variant in an original reusable recipe under `assets/parts/`. Extract existing **source code or versioned original assets**, never a published ship GLB, generated `source.blend`, baseline or downloaded reference model.
- Keep gun mechanisms, mount enclosures and ship installation code separable where the real variants justify it. Use explicit builder registrations, not ship-name branches or a caliber-based fallback.
- Add or preserve the catalog part ID, add its discovery metadata, and register its builder function and transitive original Python inputs. The callable accepts `(mount, collection, helpers, materials)`. Build the standalone preview through that same callable; do not maintain a different preview model.
- Start with review `unreviewed` and precise limitations. Inspect before/after views and articulation against the approved references. Mark `accepted` only after the affected four visual checks pass; record concise basis and any accepted approximations in the component's source documentation. Never infer historical acceptance from an export pass.
- Migrate consumers to the builder and declare dependencies. Run `ship:check all`, rebuild every stale consumer it reports, and repeat affected ship reviews and runtime checks. Do not change hashes or automatically select binary outputs to bypass freshness checks.
- For a new non-gun family (directors, boats, launchers or deck fittings), extend the library contract with its real attachment/articulation needs. Do not pretend that a director or boat is a `GunPart` just to obtain a preview.

Do not create ship `reports/` or `references/` directories or a replacement tracked evidence archive. Temporary review captures stay in `.build/`; durable source, concise configuration and limitations belong with the original component.

For long-term fleet planning, see [WWII equipment reuse](wwii-equipment-reuse.md).

The September 2026 sub-12-inch main-battery refinement covers the nine published
Shipbuilder assemblies constrained by `scripts/parts/main-battery-budget.test.ts`.
Roles come from registered builders and actual consumers: the open Mk 21 is a
main battery on Enterprise and merchant presets, while Shōkaku's Type 89 AA mounts
remain AA despite their `main` control-group label. The Mk 21's registered Mk 24
comparison is a related variant; its pedestal and controls are approximations,
not a conversion to that variant. Secondary-only 15/15.5 cm guns and 5-inch twins
belong to the separate small-gun pass. The unpublished Fletcher Mk30, Flower
4-inch and Type VIIC 8.8 cm installed previews are outside this published scope.
`component-before.json` retains the immutable 13e3e07 published URLs for these
nine guns so the comparison page shows this pass's baseline, not older models.
