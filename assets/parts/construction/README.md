# Construction equipment

## Deck fittings and connected paths

The first deck fittings collection adds bitts, fairleads, a capstan and anchor
windlass, a stowed anchor, a lifeboat with cradles and paired davits, two vent
styles, a watertight door, deck hatch, vertical ladder, inclined stairs, compact
optical rangefinder and static searchlight. `deck_fittings.py` is their original
generic naval recipe. They do not represent a researched vessel or exact service
variant. Dimensions, dry masses and optical fire-control capability are declared
game estimates. Doors and hatches are closed fittings; they do not cut hull
openings. Boats and davits are stowed assemblies. The searchlight has no beam,
light source, power demand, detection effect or runtime articulation.

The compact rangefinder uses the existing director family. Other fixed fittings
contribute their catalog mass without adding buoyancy or a combat bonus. The
sole or rear mounting brackets define each attachment datum. Explicit rigging
sockets identify real rope/chain attachment locations on supported fittings.

Railing, rope and chain catalog entries describe connected paths. Their original
four-metre standalone samples are in `path_fittings.py`; the editor and runtime
render routes procedurally from the versioned local points and catalog profile.
Bearing and translation act on the complete route. Rope/chain slack is the
downward midpoint sag of each span: `4 * slackM * t * (1 - t)`, sampled at sixteen
equal intervals. Railing posts divide each span into equal intervals no longer
than the declared spacing, with shared corner posts counted once. Native
construction owns support, hull clearance, length, mass, CG and inertia.

The 45 mm rope is estimated at 1.2 kg/m; the 35 mm chain wire profile at 22 kg/m.
The 1.1 m three-rail profile uses 40 mm rails, at most 1.5 m post spacing,
8.4 kg/m of rail and 7 kg per post. Fixed end hardware allowances remain separate
catalog values. These are loading approximations, not rated working loads or
certified scantlings. Paths are limited to 64 points and 500 m overall; slack is
bounded by half the shortest span and 20 m. Preview samples are not independent
authoring inputs for player routes.

The component viewer lists these non-gun families with the same immutable asset
identity checks as construction. Temporary renders and diagnostic evidence stay
in `.build/deck-fittings/`.

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

For guns with an intrinsic working well, the native compiler derives a fixed
steel support and deck collar inside that space, meeting the original roller
sole at the canonical barbette radius. These use the authored construction
thickness and contribute structural mass and protection without additional
buoyancy. The original gun, its reserved space and its pivots remain unchanged.

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
package estimates: torpedo bank 18 t **including its five ready torpedoes** (no
reserve torpedoes or additional torpedo-ammunition mass), funnel 8.5 t/12,000 kW exhaust capacity,
screw 2.5 t/0.65 efficiency, rudder 2.6 t/7 m², mast 0.45 t, director 6.5 t.
These values are fixed by catalog revision. They do not claim historical
engineering certification. Funnel capacity consumes engine exhaust demand and
does not create propulsion power. Director connection is typed fire control;
mast geometry itself carries no invented combat bonus.

The generic diesel's 35 t dry package and occupied envelope include its auxiliary
generator, fixed bilge pump and portable maintenance equipment. Its existing 5 t
service allowance covers crew, spares and fuel at this abstraction. The native
compiler reserves 2% of the rated engine power for auxiliary service (60 kW of
the 3,000 kW package), leaving 2,940 kW for propulsion before propeller efficiency.
It assigns 0.02 m³/s fixed pumping to this package's actual machinery compartment;
smaller dry packages scale down and larger ones remain capped at that capacity.
A package with at least 400 kg of declared service allowance contributes one
automatic four-person work party, capped at eight per ship.
These capacities are explicit gameplay assumptions, not researched engineering
ratings or additional free machinery mass. Auxiliary fittings and their routes
are represented within the package rather than separately modeled or placed.

Auxiliary electricity and fixed pumping depend on the actual engine condition,
immersion and linked exhaust availability. Destroying a propeller does not by
itself remove electricity; missing or unavailable machinery/exhaust does.
Portable pumping on a constructed ship also needs available auxiliary power.
The native compiler emits the package assumptions in its diagnostic/basis;
runtime behavior and capacities remain owned by native simulation, not by the
asset manifest or a second set of equipment statistics. The exact finite repair,
patching and portable-pump rules live in
[construction services](../../../docs/construction-services.md).

All registry review states remain `unreviewed`. Inspected standalone geometry,
retained articulation and source fidelity are different checks from clearance
on a constructed ship. Every installation still needs physical attachment,
intermediate traverse/elevation/recoil and independently posed neighbor checks.
No component publication alone certifies S5 in-game acceptance.

The generic small-boat appendages are separately authored fixed variants:
`generic-propeller-1200` is a 1.2 m four-blade screw (110 kg, 0.60 efficiency),
and `generic-rudder-1000` is a 1 m-deep balanced foil (85 kg, 0.72 m²). Their
package values and pitches are provisional engineering estimates. They retain
`.spin` / `.yaw` and attachment sockets at the forward shaft seat / upper stock.
They are built at their own metre dimensions; neither the catalog nor renderer
rescales a Fletcher component to obtain these variants.

Attachment metadata follows the actual sole, stock or shaft seat. Fixed envelopes
meet that support plane within 1 mm; rounding does not add invisible material
below a mast foot or beyond a shaft socket. For guns and funnels, intrinsic
occupancy may cross the support plane as a sealed installation well; the shared
compiler decides fit and damage behavior without shrinking the package.

`generic-magazine-2000` is a separate fixed 3 × 2.5 × 8 m original rack package
with 3.6 t dry mass and 2,000-round capacity. It uses the same registered magazine
recipe, authored at twice the original length, and can hold the curated
Oerlikon’s canonical 1,800-round load. Capacity and dry mass are provisional
engineering estimates; ammunition mass still comes from the canonical weapon
and native compiler. The fixed 1,000-round variant and previous publications
remain available.

## Generic capital-ship plant and funnel

`generic-steam-plant-36000kw` is an original 10 × 6 × 22 m boiler/geared-turbine
package with a deck sole at Y=0. Its four boiler casings, paired turbines,
reduction gears, supported steam lines and service walks are illustrative original
geometry in `capital_machinery.py`. The declared 36,000 kW rating, 1,800 t dry
mass and separate 200 t fuel/service allowance are provisional game engineering
values. Machinery mass includes boilers, condensers, gears and auxiliary services;
the normal native auxiliary reservation and service caps still apply.

`generic-capital-funnel` is its separate fixed oval uptake: 6 × 11.1 × 10.5 m
conservative envelope, 75 t dry mass and 36,000 kW exhaust capacity. Its open hood,
grille, reinforcing bands, steam pipes and access ladder are original geometry;
the supporting deck is external. It retains a Y=0 attachment sole and an
`exhaust-out` socket. It is neither a resized Fletcher asset nor a historical
funnel reconstruction. These estimates do not certify thermodynamic performance,
shaft routing or any named battleship's engineering.

## Japanese destroyer torpedo banks

`../ijn-destroyer-equipment/geometry.py` adapts the original Fubuki triple and
Yukikaze quadruple shielded 610 mm banks into one standalone recipe. The shield
stations follow the owning ship recipe for that tube count and the tubes sit on
the catalog's `tubeOffsets`, which are the ships' own tube datums relative to
the launcher pivot. The 11 t and 18 t package masses are gameplay estimates, and
the torpedoes are the ships' provisional game variants (Type 8 and Type 93).

## National funnels, masts and directors

Four recipe files adapt superstructure from the original ship recipes into
standalone deck fittings: `../us-superstructure/` (Iowa funnel and Mk 38
director, Baltimore funnel and pole mast), `../german-capital-superstructure/`
(Bismarck funnel, 10.5 m rangefinder cupola and mainmast), `../ijn-superstructure/`
(Yamato funnel and Type 98 director, Mogami trunked funnel and Type 95 director
tower, Fubuki funnel, Yukikaze tripod foremast) and `../rn-superstructure/`
(King George V funnel, tripod foremast and HACS director, Flower-class funnel).
Each stands on the deck at its origin; parts that sat on superstructure aboard
ship are extended to the deck, so some read taller than they do on the ship.
Jacket outlines and heights come from the ship recipes and blueprints; small
fittings (ladders, walkways, whistles, lookouts, radar aerials the source ship
did not carry, including the FuMO mattress on the German cupola) are plausible
additions. Masses and exhaust ratings are gameplay estimates. Directors train on
a `yaw` joint; mast radar arrays are fixed.

## Capital and cruiser turrets

Eleven turrets that the ships draw inline (or through the generic ship mount)
now have standalone articulated builders: `../ijn-main-guns/` (46 cm Type 94
triple, 15.5 cm Type 3 triple, 20.3 cm Type 3 twins with and without the
rangefinder), `../us-main-guns/` (16-inch/50 Mk 7 and 8-inch/55 Mk 12 triples),
`../rn-main-guns/` (14-inch Mk VII quadruple and twin, 5.25-inch QF Mk I twin)
and `../german-battleship-guns/sk_c28.py`, `flak_105.py` (15 cm SK C/28 twin,
10.5 cm twin heavy AA). Each follows the Cleveland builder: a yawing gunhouse
and one elevation, recoil and muzzle joint per barrel from `aa_articulation`,
with trunnion, muzzle, spacing, bore and base ring taken from `guns.json`.
Gunhouse outlines are the ships' own envelopes. Gun ports are opened where the
ship pushes barrels through closed plate, and blast bags are rigid and ride
with their barrel, so a bag lifts off its port at high elevation. The 46 cm
turret carries a 2.15 m rotating stalk below the gunhouse, because its mount
datum sits that far under the floor aboard Yamato. The ships themselves are
unchanged: they do not read the mount registry and keep their inline turrets.

## Deck gear, boats and aviation fittings

`../deck-gear/forecastle.py` (paravane, breakwater, hawse pipe with stopper,
cable reel, deck winch, stowed accommodation ladder) and `../deck-gear/topside.py`
(ready-use locker, signal lamp, ensign staff, 3 m and 5 m gun tubs, splinter
shield section, Carley float) are original nation-neutral recipes in the style
of the first deck fittings. `../ship-boats/geometry.py` adds a US 26 ft motor
whaleboat, a Japanese 11 m motor launch, a British motor pinnace and a generic
boat crane; `../ship-aviation/geometry.py` adds US and Japanese aircraft cranes
and catapults, adapted from the Cleveland, Baltimore, Iowa, Mogami and Yamato
recipes. All are static, stowed and loading-only: jibs are fixed, catapults do
not train or launch, and boats do not lower. Their dimensions and masses are
game estimates. Gun tubs, the breakwater, the cranes and the catapults declare
`fitting` boxes that follow their real solid, so a mount fits inside a tub, the
deck behind a breakwater stays usable and small gear fits under a crane jib.


## Flush doors and windows

`windows.py` authors the plain door, round porthole, rectangular window and
rounded-rectangle window as single flat silhouettes, without frames, fasteners,
hinges or solid thickness. The attachment is local runtime Z=0, facing +Z into
the wall. The door keeps its original bottom datum and stable part ID; its older
watertight-door recipe and published revisions remain retained for legacy uses.
`wallMount` identifies these parts. Installation dimensions scale the original
silhouette and provisional mass. The renderer clips its original front triangles
onto native hull panels, using only a 0.5 mm rendering bias to avoid flicker.
Catalog bounds use a 1 mm picking/mass envelope; this is not visible extrusion.
These generic surface details do not cut holes or claim historical fidelity.
