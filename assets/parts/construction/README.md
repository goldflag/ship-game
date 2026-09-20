# Construction equipment

## Generic running gear

The current builder offers four fixed sizes of four-blade screw and four sizes
of balanced rudder. The Fletcher and German cruiser running gear is omitted
from the current catalog. No migration or replacement aliases are provided.

| Part | Nominal diameter / blade depth (m) | Dry mass (kg) | Efficiency / rudder area (m²) |
| --- | ---: | ---: | ---: |
| Four-blade screw | 1.2 | 110 | 0.60 |
| Four-blade screw | 2.4 | 880 | 0.60 |
| Four-blade screw | 4.2 | 4,720 | 0.60 |
| Four-blade screw | 6 | 13,750 | 0.60 |
| Balanced rudder | 1 | 85 | 0.72 |
| Balanced rudder | 2 | 680 | 2.88 |
| Balanced rudder | 4 | 5,440 | 11.52 |
| Balanced rudder | 6 | 18,360 | 25.92 |

`running_gear.py` reuses the original `small_appendages.py` recipes, baking each
larger variant into metre coordinates during authoring. Dimensions, attachment
sockets and CG scale linearly; the provisional dry masses scale by volume and
rudder areas by area. All screws share the original right-hand pitch shape and
efficiency. These are generic game estimates, not researched vessel fittings or
engineering ratings. The renderer does not resize equipment instances.

Propellers retain the forward shaft seat, fixed bearing and independent `.spin`
joint. Rudders retain the upper support/steering sockets, fixed bearing and
independent `.yaw` joint. The native compiler continues to own shaft supports,
engine assignments, immersion and steering behavior. Per-design hull and
neighbor clearance still require installation review.

## Wall-mounted lifesaving gear

`life_saving.py` supplies a life ring, oval life raft and rectangular life raft
in **Fittings → Deck gear**. Click a hull side or superstructure wall to install;
the existing wall tools support linked mirroring and resizing. The ring scales
uniformly to keep its circular shape. All three retain shallow 3D relief on
sloped surfaces, with rear mounting rails, lower saddles and retaining clips or
straps. The wall attachment socket is at the rear datum (runtime Z=0); the
assembly projects outward toward runtime -Z.

These are original generic stowed props, with nominal package dimensions of
0.84 × 0.84 × 0.24 m, 1.25 × 1.90 × 0.36 m and 1.57 × 2.25 × 0.36 m, and
estimated dry masses of 5, 45 and 65 kg. They add loading mass only. No rescue,
deployment, buoyancy or historical variant is implied. Canvas, rope and wood
retain their shared material roles; bands and brackets follow component paint.

The existing deck-mounted Carley float remains its own registered variant.
These lightweight wall originals reuse the simple fitting mesh/batching helper,
with 16–24 perimeter stations, eight-sided float sections, four-sided grab lines,
material-only bands and plain slats. Each complete exported assembly must stay
below 1,000 triangles, without textures or subdivisions. Per-installation
support and clearance still require review.

## Deck fittings and connected paths

The current Deck gear selection is general ship hardware. Drawable rope, chain,
railings and surface ladders lead the shelf. Paravanes, signal lamps, gun tubs,
ammunition lockers, splinter shields, fixed-shape breakwaters and the German
cruiser capstan/hatch are omitted from new catalogs. Retained immutable catalogs
and their original registrations preserve older saved designs and ship sources.

`utility_fittings.py` supplies plain replacements for the older generic mooring,
anchor, ventilation, access and flagstaff fittings. They retain stable IDs,
attachment/rigging datums and conservative package envelopes. Small fasteners,
cable windings, ornamental profiles and service-specific mechanisms are omitted;
12-sided castings and six-sided thin rods follow the lightweight boxes and racks.
These are static visual fittings; no new operating mechanisms are implied.

`bollards.py` adds three original mooring silhouettes beside the existing twin
bitts: **Single-post bollard** (0.66 × 0.64 × 0.66 m, 65 kg), **T-head bollard**
(1.10 × 0.76 × 0.68 m, 95 kg), and **Paired inclined bollards**
(1.72 × 0.90 × 0.82 m, 220 kg), listed as width × height × length.
They reuse the plain 12-sided fitting primitives and shared instance paint,
with a flat deck sole at Y=0, a downward support socket and two rope sockets.
Find them under **Fittings → Deck gear**, or search for “bollard”. These are
static generic game fittings with estimated envelopes and dry masses; no
historical fidelity or working-load rating is claimed. Their fidelity status
remains `unreviewed`; each installation still needs deck support and clearance.

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

Two-rail and three-rail railings, rope and chain catalog entries describe connected paths. Their original
four-metre standalone samples are in `path_fittings.py`; the editor and runtime
render routes procedurally from the versioned local points and catalog profile.
Bearing and translation act on the complete route. Rope/chain slack is the
downward midpoint sag of each span: `4 * slackM * t * (1 - t)`, sampled at sixteen
equal intervals. Railing posts divide each span into equal intervals no longer
than the declared spacing, with shared corner posts counted once. Native
construction owns support, hull clearance, length, mass, CG and inertia.

The 45 mm rope is estimated at 1.2 kg/m; the 35 mm chain wire profile at 22 kg/m.
Both 1.1 m railing profiles use the balcony’s plain 40 mm square bars, at most
2 m post spacing, and no footplates or bolts. The three-rail profile declares
8.4 kg/m of route rails; the separate two-rail profile declares 5.6 kg/m. Both
use 7 kg per post. Saved per-route rail-count overrides remain supported. Fixed end hardware allowances remain separate
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

The quintuple bank, legacy starboard screw and rudder, aftermast and Mk37
director adapt original source in `assets/ships/fletcher/build.py`, with the
original source dimensions preserved. The torpedo bank references canonical
`us-mk15-fast` ammunition and retains its five muzzle offsets. The screw is the
4.2 m three-blade starboard hand; its pitch/chord distribution is the existing
original approximation. The director retains its supported optical bar and
mattress antenna. Ship-wide mast stays belong to
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
reserve torpedoes or additional torpedo-ammunition mass), screw 2.5 t/0.65 efficiency, rudder 2.6 t/7 m², mast 0.45 t, director 6.5 t.
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

## Modular machinery

The current catalog has three machinery families. Each placed engine is a
complete fixed package including auxiliaries, foundation and service space.
Multiple packages add power through the existing native shaft assignments and
shared exhaust capacity. Package ratings are before the 2% auxiliary reserve
and propeller efficiency. No fuel economy, purchase cost or steam-cycle behavior
is invented for these families.

| Package | Rated kW | Envelope W × H × L (m) | Dry mass (t) | Service allowance (t) |
| --- | ---: | --- | ---: | ---: |
| Small diesel | 500 | 1.4 × 1.6 × 3 | 4 | 1 |
| Medium diesel | 3,000 | 3 × 3 × 6 | 35 | 5 |
| Large diesel | 10,000 | 5.5 × 4 × 10 | 130 | 20 |
| Small triple-expansion steam | 2,000 | 5 × 5 × 12 | 180 | 30 |
| Large triple-expansion steam | 6,000 | 7 × 7 × 18 | 480 | 80 |
| Small geared steam turbine | 5,000 | 5 × 4 × 10 | 150 | 25 |
| Medium geared steam turbine | 22,000 | 8 × 5 × 16 | 600 | 100 |
| Large geared steam turbine | 40,000 | 10 × 6 × 22 | 1,200 | 200 |

All values are provisional game engineering estimates, not certified historical
machinery ratings or dimensions. The large diesel represents paired engines in
one package. The steam packages include boilers and either three expansion
cylinders or one geared HP/LP turbine set. Their machinery is illustrative,
original geometry; no external model or historical vessel is reconstructed.
`machinery.py` uses the shared `Model` primitives; the medium diesel reuses
`geometry.py:create_engine`. The installation owns the floor, external shaft
route and funnel. All packages have a Y=0 sole and explicit attachment, drive
and exhaust sockets. Engines remain static; propellers retain their spin joints.

The former 36 MW and 82 MW options are removed from the current catalog. Retained
immutable catalog snapshots remain build artifacts for exact published content.

## Japanese destroyer torpedo banks

`../ijn-destroyer-equipment/geometry.py` adapts the original Fubuki triple and
Yukikaze quadruple shielded 610 mm banks into one standalone recipe. The shield
stations follow the owning ship recipe for that tube count and the tubes sit on
the catalog's `tubeOffsets`, which are the ships' own tube datums relative to
the launcher pivot. The 11 t and 18 t package masses are gameplay estimates, and
the torpedoes are the ships' provisional game variants (Type 8 and Type 93).

## Destroyer and escort guns

Nineteen 100 to 155 mm destroyer, escort and cruiser-secondary mounts stand on the Main battery shelf beside
`type3-127-typec-twin` and the US 5-inch/38 family. Each is authored against exactly one approved GameModels3D
gun visual: visuals that are the same mesh are one part (the recipe READMEs list the ships that share it),
visuals that differ visibly are separate parts, and a source with no faithful buildable geometry is left out.

| Navy | Parts | Recipes |
| --- | --- | --- |
| Britain | `qf-47-mkxii-twin`, `qf-47-mkix-single`, `qf-47-mkxi-twin`, `qf-45-mkiv-twin`, `qf-45-mkv-twin`, `qf-45-mkiv-single`, `qf-4-mkxix-twin`, `qf-4-mkxix-twin-enclosed` | [`../rn-destroyer-guns/`](../rn-destroyer-guns/README.md) |
| Germany | `sk-c36-150-single`, `sk-c34-127-single` | [`../german-destroyer-guns/`](../german-destroyer-guns/README.md) |
| Japan | `type98-100-twin`, `type3-127-typea-twin`, `type3-127-typeb-twin`, `type3-127-type5-twin`, `type3-127-typeb-single` | [`../ijn-destroyer-guns/`](../ijn-destroyer-guns/README.md) (`type_98.py`, `destroyer_mountings.py`) |
| United States | `us-4in50-mk9-single`, `us-4in50-mk9-shielded-single`, `us-5in51-mk7-open-single`, `us-5in51-mk7-single` | [`../us-destroyer-guns/`](../us-destroyer-guns/README.md) |

Every one stands on the deck: one `attachment` support socket on the model's own bottom plane (the sole, the
turntable, or the pedestal's deck ring), no ammunition socket and no occupancy box, so nothing below the deck is
reserved and the Shipbuilder owns the barbette or trunk under the sole. Where a mount has a shield or gunhouse, the
catalog's `gunhouseMesh` is both the armor and the visible shell. It is a closed envelope, except where the shell stays
open at the back, the floor, the crown slots or the gun port (the German singles, the US shielded singles, the 4-inch
HA hoods and the Type 98): those are single-skin shells whose open boundary loops are declared `apertures`. The two open
US pedestal mounts have no `gunhouseMesh`. `size` and `boundsCenter` are measured from each built GLB.

Weapon and armor values are provisional game calibration scaled from the nearest sibling in `guns.json`, kept physical
(muzzle speed, projectile mass, reload, plate thickness) so the simulation applies the world pace itself. Elevation
limits are commonly published figures for each mounting, not measurements from the reference visuals, which carry none.
Where a source shield would foul the gun at the published elevation (the closed crowns of the 4-inch HA hoods, the slot
sills of the 4.5-inch and 4.7-inch shields, the US pedestal shields, the smaller mantlets of the Type 98) the authored
shield opens or cuts that port instead, and each recipe README says so. The recipe READMEs also give the neighbour
spacing each mount was swept against; the widest are the Type 98 (7.9 m between yaw axes for two identical mounts to
train past one another), the 4.7-inch Mk XII twin and Mk IX single (9.5 m and 8.5 m) and the 4.7-inch/50 Mk XI twin
(11.1 m). These figures cover the mounts alone: a ship's own platforms and neighbours still need installation review,
and the library keeps every part `unreviewed` until that passes.

## National masts and directors

Four recipe files adapt superstructure from the original ship recipes into
standalone deck fittings: `../us-superstructure/` (Iowa Mk 38 director and
Baltimore pole mast), `../german-capital-superstructure/` (10.5 m rangefinder
cupola and mainmast), `../ijn-superstructure/` (Yamato Type 98 director, Mogami
Type 95 director tower, Yukikaze tripod foremast) and `../rn-superstructure/`
(King George V tripod foremast and HACS director).
Each stands on the deck at its origin; parts that sat on superstructure aboard
ship are extended to the deck, so some read taller than they do on the ship.
Jacket outlines and heights come from the ship recipes and blueprints; small
fittings (ladders, walkways, whistles, lookouts, radar aerials the source ship
did not carry, including the FuMO mattress on the German cupola) are plausible
additions. Masses are gameplay estimates. Directors train on
a `yaw` joint; mast radar arrays are fixed.

The funnels adapted the same way (Iowa, Baltimore, Bismarck, Yamato, Mogami, Fubuki,
King George V and Flower), the Fletcher forward funnel, the German cruiser funnel cap and
`generic-capital-funnel` are retired. None had a same-variant source model, so the current
catalog offers only the historically sourced funnels in `../historic-funnels/`. A
retired funnel is hidden from every catalog's palette, and opening a saved design removes
its instances in a new revision, as for the other retired fittings. The registrations,
recipes and published models remain for exact retained catalogs and ships built on them.

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

The 28 cm SK C/34 triple (`sk-c34-283-triple`,
`../german-battleship-guns/sk_c34_triple.py`) is the Scharnhorst main turret,
authored against the GameModels3D pgsb507 A artillery. Its visible gunhouse is
the catalog's closed armor shell, its canvas seals are the shared flexible
`gun_bloomers` covers, and its support attachment is the turntable sole at
Y = 0. The approved model fits the same gunhouse, without turret rangefinder
arms, at all three positions, so the collection has one variant.

Seventeen cruiser main guns of 150 to 203 mm follow the same pattern, one original recipe per
genuinely different GameModels3D gun visual, each registered in
[`component-references.json`](../../../tools/ship-overlay/component-references.json) as a same-variant
source and described in its family README: British
([`rn-cruiser-guns`](../rn-cruiser-guns/README.md): `bl-6in50-mk23-triple`, `bl-6in50-mk21-twin`,
`bl-8in50-mk8-twin`), German
([`german-light-cruiser-guns`](../german-light-cruiser-guns/README.md): `sk-c25-150-triple` and
`sk-c25-150-triple-nurnberg`, whose two visuals share an armor shell but differ in fittings, and
`german-sk-l45-150-single`), American ([`us-cruiser-guns`](../us-cruiser-guns/README.md):
`us-8in55-mk16-triple`, `us-8in55-ca32-triple`, `us-8in55-mk14-mod1-triple`, `us-8in55-mk14-mod2-twin`)
and Japanese ([`ijn-light-cruiser-guns`](../ijn-light-cruiser-guns/README.md): `type3-140-3year-single`,
`type41-152-agano-twin` and its `-rf`; [`ijn-heavy-cruiser-guns`](../ijn-heavy-cruiser-guns/README.md):
`type3-203-aoba-twin` and `type3-203-furutaka-twin`, each with an `-rf`). A rangefinder variant exists only
where its reference visual visibly differs; two WoWS visuals that are the same mesh share one part. The
visible gunhouse is the catalog's closed armor shell (a thin closed slab for the open-backed shields of the
14 cm and 15 cm singles). All barrels of a mount share one trunnion and muzzle datum, so a reference's
stagger between guns, such as the British triple's set-back centre gun, is not reproduced. Weapon and armor
values are provisional game calibration scaled from the nearest sibling; plate families follow commonly
published figures with estimated facet boundaries.

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


## Flush windows

`windows.py` authors round portholes, rectangular windows and rounded-rectangle
windows as single flat silhouettes, without frames, fasteners or solid thickness.
Its plain door builder remains available for retained recipes. The attachment is
local runtime Z=0, facing +Z into the wall. `wallMount` identifies these parts;
installation dimensions scale the original silhouette and provisional mass.
The renderer clips original front triangles onto native hull panels, using a
0.5 mm rendering bias and depth-buffer offset to avoid flicker. Window
catalog bounds use a 1 mm picking/mass envelope, without visible extrusion.
These generic surface details do not cut holes or claim historical fidelity.

## Simple superstructure boxes and racks

`superstructure_fittings.py` supplies inexpensive original props based on the
user's ship model screenshots. The current collection has single/paired wall
cabinets, a four-cylinder rack, a hose rack, wide double-door and tall narrow deck
lockers, a small storage box, a long low chest, a sloped-lid box and an open-front
bin. Existing detailed ammunition lockers remain separate exact variants.

The silhouettes use plain solids, block hinges/handles and low-sided curves;
there are no bevel loops, individual bolts or dense hose coils. Each original
batches its static geometry by shared material role. Painted metal follows the
instance coating; hose canvas and nozzle metal keep their protected materials.

These parts appear under **Fittings → Deck gear**. Wall cabinets/racks use
`wallMount: "hardware"` and the existing versioned wall placement, resize and
mirror contract. Their datum is the rear mounting plane (original Blender X=0;
runtime Z=0, outward toward −Z). Root `wallRelief` preserves their depth through
installation and portable export. Resizing retains the existing area-based mass
estimate. The cabinet backs and rack supports physically reach the wall.

Deck boxes have a flat plinth at original Blender Z=0 / runtime Y=0 and a
standard downward-facing support socket. They use normal deck placement at their
declared metre dimensions. Put them on a supported deck beside the superstructure;
they do not need a wall-placement record. Lids, doors and stored equipment are
static, and all props add only estimated loading mass, with no storage, repair
or damage-control capability. Cylinder contents are unspecified.

Dimensions and masses are game estimates; these props do not claim researched
historical fidelity. Ship-specific support and neighboring gun clearance still
need review. Registrations retain `unreviewed` fidelity status.

## Surface hardware and rung ladders

`doors.py` authors three generic closed ship doors based on the owner's supplied
rounded watertight-door illustration and porthole-door photograph. All have a
rounded welded coaming, inset pressed leaf, narrow gasket reveal and supported
strap hinges. Utility uses a lever; watertight uses a four-spoke wheel; windowed
uses an opaque round scuttle and six separate dog levers. Corner arcs have six
segments; wheel and scuttle rims are continuous low-poly bands. The exported
variants stay below 1,200 triangles each, without textures or working hinges.
These are original generic interpretations, not researched service variants.

The root's `wallRelief` mark keeps the shallow frame and hardware seated when
projected onto the hull. `surface_fittings.py` retains the earlier door recipe
and authors vents and the ladder sample. Louvered and round grille vents use a
closed dark backing and raised louvers/grille bars. These are visible fittings;
they do not cut openings or add ventilation simulation.

`generic-surface-ladder` replaces `generic-vertical-ladder` in the editor
palette. The old catalog entry, original builder and immutable publications remain for
existing designs and historical recipes. Click the first and last rung
on a closed hull side. The versioned `ladder` path profile declares width,
standoff, rod diameter and maximum rung spacing. The original
`ladder_geometry.ts` recipe makes independent U-shaped rungs with no side rails;
each end projects to a closed hull panel. Rust mirrors that member layout for
support, interference, mass and inertia checks. The standalone Blender sample
is three metres tall. Ladder mass per metre describes rod length, not route
length; the current values are provisional engineering estimates.

## Rimmed porthole

`generic-rimmed-porthole` is an original interpretation of the owner-supplied
porthole image: twelve-sided opaque glazing, a shallow bevelled painted rim,
and a faceted rain eyebrow attached to the wall. The original recipe is
`rimmed_porthole.py`; its standalone export has 150 triangles and no textures.
It appears in **Doors & windows** with one **Scale** control. The versioned
wall width and height remain equal; `wallSizing: "uniform"` scales the rim
and eyebrow depth too, with cubic mass scaling. Arrow keys, rows, mirrors and
saved designs use the existing wall-fitting workflow. Existing flat portholes
retain their diameter control and surface-only sizing.

The nominal 0.6 m square envelope, 36 mm maximum relief and 14 kg mass are
game estimates. This closed fitting adds no hull opening, interior or
articulation; installation must pass the native wall-support checks.

## Adjustable stairs and framed ladders

`generic-inclined-ladder` and `generic-framed-ladder` add two-point access
fittings. The old fixed stairs, bulkhead ladder and saved publications remain
available. Both new types use the versioned equipment path plus `access` settings:
`widthM`, `standOffM`, `handrails` (`both`, `left`, `right`, `none`) and
`grabHeightM`. Defaults are a 0.75 m stair width or 0.5 m ladder width, 0.2 m
standoff, both handrails and 0.9 m grab extensions. Width is 0.35–1.5 m; rise
is 0.5–12 m. Stair endpoints are lower/upper deck contacts; framed-ladder
endpoints are wall contacts. Reversing the clicks preserves the upward layout.

Stairs accept 30–75 degrees, keep treads horizontal and calculate their count
at a maximum 0.24 m rise. Deck shoes and upper knees physically join the
stringers to the supporting decks. Framed ladders use continuous side rails,
rungs at no more than 0.3 m spacing and brackets at no more than 1.5 m spacing.
Standoff is 0.12–0.4 m and grab extension is 0–1.2 m. These are generic
engineering interpretations, not researched historical variants or access-code
certification. They remain unreviewed for vessel-specific historical use.

`access_geometry.ts` is the original metric geometry recipe used by the editor,
portable ship export. `access_fittings.py` builds standalone
Blender samples through that same recipe, via `access_sample.ts`. Both TypeScript
inputs are declared in the registry. Rust's `construction_access.rs` mirrors
member geometry for support, clearance, mass and inertia. Steel loading uses
provisional material fractions for folded treads, channel stringers and tubes;
these fittings add no buoyancy or crew pathfinding. Mounting ends may seat within
18 cm of their supported attachment; other hull and equipment intersections fail.
Framed ladders currently require a straight wall run, without a horizontal bend.

The original [historical mast packages](../historical-masts/README.md) add
GameModels3D-based pole, tripod, cage, lattice and tubular-tower variants. Their
source/variant table, attachment contract, budgets and remaining simplifications
are documented beside the recipes; they add no active radar or weapon capability.

## Secondary and AA recipe scope

The September 2026 fidelity pass uses the registered GameModels3D resources in
[`component-references.json`](../../../tools/ship-overlay/component-references.json).
Its baseline is the complete published assembly at `13e3e07`, retained in
[`component-before.json`](../../../tools/ship-overlay/component-before.json).
Each assembly has its own triangle ceiling; hidden mechanisms, sights, seats,
shields, barrels and bases count together. Reference geometry/textures are
viewing-only. Original recipes retain the existing independent joint/socket
transforms, recoil, weapon statistics and intrinsic installation occupancy.

The non-overlapping secondary/AA set is:

| Family | Registered component IDs |
| --- | --- |
| US light AA | `us-20mm-oerlikon-mk4-hsienyang`, `us-20mm-oerlikon-mk24-hsienyang`, `us-40mm-bofors-mk1-iowa`, `us-11in75-quad`, `us-3in50-single` |
| US secondary | `us-5in38-mk32-mod12` |
| German light AA | `flak-37-bismarck-1941`, `flak38-m43u-20-twin`, `flak38-20-single`, `flak28-40-single` |
| German secondary/dual-purpose | `skc33-105-c31-twin`, `flak-105-bismarck-1941`, `sk-c28-150-twin` |
| Japanese machine guns | `type93-13-twin`, `type93-13-single` |
| Japanese 25 mm | `type96-25-triple`, `type96-25-triple-shielded`, `type96-25-mogami-2`, `type96-25-kongo-3`, `type96-25-kongo-2`, `type96-25-kongo-single` |
| Japanese secondary/AA | `type3-155-triple`, `type41-152-kongo-casemate`, `type89-127-a1-twin`, `type89-127-a1-mod2-twin` |
| British secondary/AA | `qf-525-mki-twin`, `qf-2pdr-mkvi-octuple` |

Roles follow the catalog and actual consumers. Yamato's 155 mm remains secondary.
Shokaku's Type 89 A1/A1-mod2 are AA despite the ship's main-control battery label.
The published Mk21 is excluded because Enterprise/merchant consumers use it as
main armament. Mk30 Mod0, Cleveland Mk16, Baltimore Mk12, Type C, Mogami E/E3 and
both Hipper 203 mm mounts likewise belong to the separate main-battery pass.
Legacy Fletcher Mk30, corvette 4-inch and U-boat 88 mm are not published
Shipbuilder equipment and are outside this set.

The reference register's `close` and `family` qualifications still apply. In
particular, Ranger's quad resource does not certify the 1.1-inch designation;
the Liberty 3-inch reference specifies Mk22 Mod2 while this catalog entry does
not; the pom-pom resource/mount marks differ; Kongo's single/triple 25 mm matches
are family-only, and its low twin pedestal is retained. The Hsienyang twin's
Mk20 visual-resource/Mk24 equipment designation discrepancy is unresolved.
Type 41's resource says 150 mm while the catalog says 152 mm. These are not
silently promoted to exact matches or historical-fit certifications.

The shielded Type 89 A1-mod2 reference has a much lower bore relative to its
hood than the fixed catalog elevation datum permits. Its enclosure silhouette
is closer, but that proportion mismatch remains. Some loading/aiming fittings
remain simplified, especially the quad 1.1-inch and octuple pom-pom. Geometry
review does not override the existing `unreviewed` acceptance state.

Historical recipes that inline an older mount are not automatically migrated by
a catalog publication. Rebuilt reusable-recipe consumers and a Shipbuilder
installation review must be distinguished from those legacy inline models.
