# Construction equipment

The curated source catalog is `../construction.json`. Its fields use the shared
`ConstructionEquipmentPart` contract, omitting the generated `modelUrl` and
`contentHash` until publication. Guns reference `guns.json`; no gun mass, armor,
ammunition or ballistic statistics are duplicated here. The published catalog
embeds that canonical weapon catalog once for the native compiler.

`bun run part:publish` builds missing/stale original components and publishes
immutable GLBs and manifests under `public/models/components/<id>/<revision>/`.
`bun run part:publish --rebuild` cleanly rebuilds every curated recipe.
`bun run part:published:check` checks source freshness, retained transforms,
measured mesh bounds, asset digests and immutable catalogs. A full catalog is
retained under `catalogs/<revision>/catalog.json`; `catalog.json` selects the
current revision. Publication never replaces an existing immutable asset.
No Blender scene, preview endpoint or `.build` file is needed by the game.
Materials are embedded in each GLB; these recipes use plain supported PBR paints
and need no separate image textures. Texture-bearing originals must likewise
embed their textures before publication.

Gun originals are built through `assets/parts/library.py`. Explicit non-gun
registrations live in `construction-library.json`, dispatched through
`construction/library.py`. This extension does not reinterpret fittings as guns
or invalidate existing historical recipe inputs. `part:list`, `part:inputs`,
`part:build` and `part:check` also recognize these non-gun registrations.

## Geometry and installation

All dimensions are metres. Published models already use +X starboard, +Y up,
−Z bow. The original recipe frame is forward/port/up and passes through the
common exporter exactly once. The origin is the original attachment or joint
datum, never an automatically recentered mesh. `size`/`boundsCenter` describe a
fixed conservative package envelope. `occupancy` describes intrinsic internal
space, such as the below-deck barbette/handling envelope; it is not a second mass
contribution. Deck support and access around the package remain installation
responsibilities. Machinery envelopes include service clearance within the
fixed package; a smaller visible casing does not release that space.

Manifests preserve `component.*` node IDs, local/world matrices and parent IDs.
At placement the renderer replaces `component` with the stable instance ID in
node/assembly properties and flexible-gun-cover references. Guns retain their
individual elevation/recoil/muzzle chains. Non-gun roots are `component.root`;
torpedo banks and directors use `.yaw`, propellers `.spin`, rudders `.yaw`, and
torpedo muzzles `.tube-1.muzzle` through `.tube-5.muzzle`. Socket positions are
relative to the original datum; their direction is metadata, not a second model
rotation. Static gun attachment sockets are catalog-only, preserving original
assets unchanged. Non-gun socket empties are also retained in the GLB.

## Sources and limitations

The curated Mk30 mod.0, Cleveland Mk16, Bismarck SK C/34 covered-blister and
Hsienyang Mk4 Oerlikon retain the exact registered original variants and their
existing review qualifications. See their library metadata and original source
documentation. Bismarck projecting rangefinder wings are a separate installation
option and are not silently enabled in this collection. Gun handling-space
estimates are construction allowances, not researched magazine drawings; gun
mass already includes the catalog mounting/protection and must not receive a
second charge for those plates.

The quintuple bank, forward funnel, starboard screw, rudder, aftermast and Mk37
director adapt original source in `assets/ships/fletcher/build.py`, with the
original source dimensions preserved. The torpedo bank references canonical
`us-mk15-fast` ammunition and retains its five muzzle offsets. The screw is the
4.2 m three-blade starboard hand; its pitch/chord distribution is the existing
original approximation. The director retains its supported optical bar and
mattress antenna. Funnel external guy wires and ship-wide mast stays belong to
the installation and are excluded; integral feet/bearings/stock supports remain.
The source basis is the [Fletcher README](../../ships/fletcher/README.md),
including its approved visual sources. No published ship GLB, generated Blender
scene, downloaded geometry or textures are authoring inputs.

Machinery and magazines are original generic engineering packages. The 3,000 kW
diesel package has a 3 × 3 × 6 m envelope, 35 t dry mass and a separate fixed 5 t
service/fuel allowance; this is a declared gameplay estimate, not a historical
engine rating. The 3 × 2.5 × 4 m magazine has 1.8 t dry mass and capacity for
1,000 rounds; loaded ammunition mass belongs to the authoritative compiler.
Fletcher-derived fitting masses and functional capacities are also provisional
package estimates: torpedo bank 18 t, funnel 8.5 t/12,000 kW exhaust capacity,
screw 2.5 t/0.65 efficiency, rudder 2.6 t/7 m², mast 0.45 t, director 6.5 t.
These values are fixed by catalog revision. They do not claim historical
engineering certification. Funnel capacity consumes engine exhaust demand and
does not create propulsion power. Director connection is typed fire control;
mast geometry itself carries no invented combat bonus.

All registry review states remain `unreviewed`. Inspected standalone geometry,
retained articulation and source fidelity are different checks from clearance
on a constructed ship. Every installation still needs physical attachment,
intermediate traverse/elevation/recoil and independently posed neighbor checks.
No component publication alone certifies S5 in-game acceptance.
