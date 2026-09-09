# USS Cleveland

## Approved brief

User approved the inspected reference proposal in this task: USS Cleveland,
GameModels3D World of Warships vehicle [`pasc208`](https://gamemodels3d.com/games/worldofwarships/vehicles/pasc208),
Hull A (`PAUH705_CLEVELAND_A`), default shown paint. Follow the source's gray-blue
exterior, dark decks and weathered red lower hull. Use GameModels3D only as the
external visual reference; geometry and textures are authored independently.
The exact historical year/refit is unverified and no historical-year claim is made.

The selected equipment is four triple 152 mm/47 Mk.16 turrets, six twin
127 mm/38 Mk.12 on Mk.32 mounts, ten twin 40 mm Bofors Mk.1 mounts and
23 single 20 mm Oerlikon Mk.4 mounts. Keep the selected A directors and radars.
Reference scale and loading/waterline require comparison checks. Gameplay internals
and performance use provisional game conventions where the visual source is silent.

## Model and simulation basis

The playable preset uses the shared versioned blueprint and component catalog.
The original 183.9 m hull, stepped bridge/deckhouses, gun positions and paint follow
the selected reference at 15 m/source-unit and source Y=0 waterline. Main turrets
use the original Cleveland Mk.16 builder; Mk.32 Mod.12 has a separate original
AGS010 enclosure and shared joint/barrel builder. The unresolved legacy Iowa
5-inch enclosure is not substituted. Bofors Mk.1 and Oerlikon Mk.4 reuse registered
original Iowa recipes. All 43 weapon stations retain independent articulation.

The original fittings include Mk.34/Mk.37/Mk.51 directors, SK/SG/SM antennas,
TDY aerial, tripod masts, rails, anchors, liferafts, catapults and the stern crane.
Fine fittings, rigging and weathering are simplified original constructions;
no external mesh or texture is an authoring input. No aircraft is carried aboard.
Model fidelity and export validation do not establish a historical year, loading
condition or historical accuracy.

Installation travel follows the source's `AB_ATBA` horizontal sectors: centerline
5-inch mounts ±140°, forward port/starboard −142°..0° / 0°..142°, and after
port/starboard 0°..160° / −160°..0°, relative to their neutral bearings. Main travel
is ±155° with −2°..60° elevation from `AB1_Artillery`. Firing obstructions handle
the additional dead zones. CPU motion interlocks in both TypeScript and Rust/WASM
prevent wing barrels entering the modeled platforms and independent main turrets
crossing. They use provisional clearance envelopes, including the full recoil
stroke; they are game constraints, not verified historical mechanical stops.

Machinery, magazines, four shaft drives, steering, armor, flood cells, stability,
weapon performance and damage values are game estimates. The visual source does
not establish internal plans or protection. Blueprint funnel surfaces also own
shell collision and exhaust placement. Exposed Mk34/Mk37 directors provide
redundant battery coverage; each Mk51 serves one adjacent Bofors mount. Director
coverage, 3–6 mm protection and equipment HP are provisional; Oerlikons use local
control. The 132 flood cells model game compartmentation, not historical rooms.

Build: `bun run ship:build cleveland`

Review: `bun run ship:review cleveland`

Temporary comparisons and diagnostic captures belong in ignored `.build/cleveland/`.
