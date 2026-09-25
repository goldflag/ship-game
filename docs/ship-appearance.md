# Ship appearance

The fleet shares a standard of material quality. Each ship keeps the colors,
camouflage, markings and deck coverings in its approved configuration. Start with
the [ship pipeline](ship-pipeline.md) and the ship's approved brief.

## Rules

- **Shared finish:** opaque paint uses a matte, nonmetallic surface. Exposed metal,
  canvas, wood and deck coverings have their own reusable finishes. A fitting uses
  the same paint as its supporting structure unless the reference shows otherwise.
  Player-built designs may explicitly choose a whole-ship Matte, Satin, Semi-gloss
  or Gloss coating in the Paint layer. This optional `construction.finish` setting
  changes painted-surface roughness without changing colors or historical defaults.
- **One wear standard:** premade and player-built ships wear their paint the same way,
  and the game draws it at runtime for both. Every ship, fresh ones included, shows its
  plating: a line along each welded seam, each plate's own shade, and the roller strips
  and marks of the paint, on hull sides, deckhouses, roofs, painted-steel decks and
  painted fittings at least 2 m across. A wear preset (Fresh, In commission, Long
  deployment, Battle-worn; In commission when absent) sets paint mottling, runoff
  streaks hanging from deck edges and wall tops, shorter streaks and a grime band below
  each strake seam, rust bleeding from the seams, the tide stain at the waterline and
  funnel soot. A player-built ship names it in `construction.wear`, a premade ship in
  its `appearance.json` `wear`. Painted steel weathers (the `painted-steel`,
  `painted-deck` and `underwater-coating` finishes and the plated component roles);
  glass, timber, linoleum, canvas, metal and fitting paints (`-edge`, `-fittings`,
  `-canvas`, `-raft`, `-light`) do not. `constructionWear.ts` measures each vertex's
  edge, funnel and waterline distances once, while a design is assembled or when a
  premade model loads (13 to 38 ms a class); `ShipSurfaceDetail.ts` draws them. Blender
  bakes none of this. The editor viewport draws clean paint.
- **Glazing is glass:** windows, portholes and the lenses of directors, rangefinders,
  searchlights and lamps use a glass material: a premade material named `… glass` or
  `… glazing` (`Iowa glass`, `Bridge glazing`), or the catalog's `glass` role, which
  player-built windows and portholes install. Author it opaque; its tint is the dim room
  behind the pane. The game draws every such material as glass, whatever finish the
  recipe gave it (see below), so do not paint windows with a dark-grey paint instead.
  A recipe's `dark` paint is for openings, not panes: vision slits, sight apertures,
  bores, grilles and recesses stay matte; a scuttle, window or rangefinder window is glass.
- **Deliberate colors:** reuse a named paint when the intended paint is the same.
  Nationality alone does not force identical gray. Identify reference-specific
  interpretations explicitly; do not label estimated RGB values as measured
  historical paint. Review color under the same lighting before changing a swatch.
- **Preserve the scheme:** hull/upperworks boundaries, camouflage, recognition
  markings and underwater colors belong to the approved vessel/configuration.
  Material refinement does not authorize replacing them or adding a pattern.
- **Respect deck materials:** keep wood, linoleum and painted steel distinct.
  Share their finish and physical detail scale; do not make all decks brown or add
  wood grain to a nonwood deck. Existing modeled retaining strips remain geometry.
- **Separate substrate from coating:** a blue deck can be painted timber or
  painted steel. Give wood-covered weather decks their own material role, with
  longitudinal grain and staggered plank joints. Do not reuse a turret-roof or
  hull-side material for them. Check the authored surface assignment as well as
  the material name; preserving a legacy assignment does not establish accuracy.
- **One deck standard:** every timber weather deck, premade or player-built, is planked
  by the game's shared teak at its own declared plank size, under its own stain or
  coating. Timber goes only on weather decks; roofs, gun platforms and painted-steel
  decks stay steel.
- **Well-maintained default:** use low-contrast fading, fine surface variation,
  restrained runoff and a narrow waterline stain. Strong rust, exposed chips and
  missing paint need a separate supported treatment; battle damage has its own
  (see [Battle damage](#battle-damage)). Avoid
  uniform dirt overlays, repetitive black grids and painted-in lighting/shadows.
- **Scale in meters:** surface grain and wear have a physical scale independent
  of ship length. Resolution may vary with surface area, within asset budgets.
  Close inspection reveals texture; gameplay distance retains a clear scheme.
- **Portable output:** bake original textures into ordinary glTF materials with
  mesh UVs. Color textures use sRGB; material constants use linear RGB. Roughness
  and metallic values are data. UVs stay attached during articulation.
- **Review together:** inspect the exact published GLB under identical neutral
  lighting and the game's ocean lighting, at both whole-ship and close distances.
  Compare with an existing textured ship at a common scale. Confirm that wear is
  restrained, deck types read correctly and textures follow moving mounts.

## Authoring contract

Historical presets and future player-built ships retain the existing versioned
blueprint/definition pipeline. Appearance is a declared original recipe input,
not a second ship definition or a runtime ship-name override.

`assets/ships/appearance/finishes.json` defines shared surface parameters;
`assets/ships/appearance/surface.py` generates original portable textures. A
consumer's version-1 `appearance.json` binds its recipe's material roles to named
linear-RGB paint swatches and shared finishes. A binding may retain its named
original recipe color by omitting a palette override; this preserves the existing
source of truth instead of copying RGB constants into another file. Reference-specific swatch IDs
describe their basis rather than making a fleet-wide historical claim. Reuse an
existing swatch when appropriate. The convoy variants share the named paints
from their common original recipe, and carrier plank tones retain their authored
variation within one named deck stain.

`wear` names the ship's wear preset (`fresh`, `in-commission`, `long-deployment`,
`battle-worn`; `in-commission` when absent). The model carries it as the
`appearanceWear` scene extra, and the game weathers the ship by it. Blender bakes no
weathering: plated finishes get a shared 8 m tile of fine paint grain only, because
the game draws their mottling, runoff, tide stain, soot and plating. Paints that do
not weather (linoleum, timber fittings) keep the baked maintained finish, ±8 to 11 %
metric mottling. There is no whole-hull texture and no `hull` block.

Plain paints share neutral surface textures and use standard glTF color factors
for their swatches. Existing original image schemes retain their texture UVs,
boundaries and markings unchanged when the game weathers them (plated finishes and
decks), and receive gentle metric fading otherwise. Declare their metric image
bounds and any atlas tiles/gutters in `imageLayout`; never guess an existing UV
layout.

Every binding with the `wood` finish is either a timber weather deck declared in
`decking` or marked `"fittings": true` (boats, oars, gratings, cradles, linings);
`surface.py` refuses anything else. A `decking` entry declares plank width, plank
length between butts, seam width and the coating (`bare`, `blue-gray`…); the
binding's paint is its named stain. The material carries `deckSubstrate=timber`,
`deckCoating`, `deckPlankWidth`, `deckPlankLength` and `deckSeamWidth` in glTF, and
the game planks it with the shared runtime teak at that size under that stain. A
whole-deck image (air-recognition markings, say) stays the stain and keeps what
it paints; the planks are drawn over it. `"modeled": true` marks decks whose planks
are modeled geometry, each board its own quad over a slab (the carriers' flight
decks); the game adds no planks there. Recipes author no plank textures or
procedural plank nodes, and no material name starts with `Teak decking`:
`scripts/ships/export.py` still bakes such a material's procedural teak, a retired
path kept because every published part's hash includes the exporter, so removing
it needs a planned `part:publish` of every part.
Only declared timber surfaces receive this treatment; steel
roofs, gun platforms and hatch covers retain their own roles. Exact covering
boundaries and plank dimensions require configuration-specific evidence; record
interpretations in the ship README.

Declare the appearance configuration, shared recipe and finishes in the ship's
`recipe-inputs.json`. Keep geometry, stable assembly/joint/socket IDs and the
approved scheme intact. Existing camouflage recipes may remain until migrated;
the surface recipe must not erase their patterns. Rebuild every declared consumer
of a changed shared input; `ship:check all` identifies stale assets.

## Runtime surface detail

Close-range plate, paint and plank detail is shared runtime shading, not baked into
assets (`src/game/ShipSurfaceDetail.ts`, applied through the ship material palette).
It works in each mesh's own geometry space, so it follows turrets and other
moving parts, and it leaves colors and schemes unchanged:

- **Plating:** 2 m strakes and 8 m staggered butts, as weld beads between shrinkage
  hollows, a grime line along each seam, each plate's shade and the paint's roller
  strips and marks, on sides, decks and roofs. Only broad plated paint gets it:
  `painted-steel`, `painted-deck` and `underwater-coating` finishes (not fitting
  paints), construction paint, and the `naval`, `hullgray`, `roof` and `underwater`
  component roles, on meshes with two sides of at least 2 m.
- **Paint roughness:** ±8 % metric variation on the same surfaces; paint stays matte.
- **Wear:** as the ship's wear preset sets it (see the rules above).
- **Teak:** every declared timber deck without relief of its own. Its stain is the
  mean of a repeating map, the colour of a whole-deck image, or the paint colour. Its
  planks come from a shared teak tile (16 cm planks, 5.12 m staggered butts, pitch
  caulking, grain and relief) stretched to the deck's plank width and length, with
  its caulking darkened for wider or narrower seams (half to one and a half times the
  tile's 4 mm). Caulking contrast fades once a texel is well under a pixel.

Mipmaps average the relief away, so the effect fades with distance. Tune it in
that module, not per ship.

By day ships take the whole sun and the whole sky light (the graded dome and the sea, as image-based
light) and no hemisphere fill, which returns only as the sun fades (`meshLightShares` in
`src/game/VisualEnvironment.ts`). Measured on grey cards at a 70° sun: 6:1 direct to diffuse light on a deck
(a clear sky gives 5–8:1), a shaded deck three stops under a sunlit one, and a sunlit 18 % card at 1.4 times
the average sky radiance (1–1.5 in daylight). Moonlight is lifted for meshes. In port the berth
sits in a gap in the clouds' shadow (`PORT_CLEARING`, 350 m clear, back by 900 m), so a passing cloud
never leaves the ship being looked at in shade; battles keep every cloud shadow.

Two more runtime treatments give a superstructure its dark accents:

- **Glazing:** the ship paint palette (`ShipMaterialPalette.ts`, `GLAZING`) draws glass
  materials as a smooth dielectric (roughness 0.1, 4 % reflectance at normal incidence,
  no metal) over a dark body: the authored tint at no more than 2 % luminance, black
  staying black. The sky and sea reflect from it by Fresnel and the sun glints off it,
  under the same mesh light shares as the paint; nothing lights it from within, so it
  goes as dark as the sky it reflects at dusk and night. It is per-vertex colour,
  roughness and metalness in the shared paint: no texture, program or draw of its own.
- **Occlusion:** ship ambient occlusion (`ShipOcclusion.ts`, High and Ultra) darkens only
  the fill and sky light, never the sun. It searches 8 m about each pixel, its steps
  crowded toward it, so it shades the underside of platforms and bridge wings, the gaps
  between deckhouses and the foot of a tower as well as small creases.

## Weather on ships

Weather reaches every ship's paint through the palette's weathering (`PaintWeathering`,
built by `src/game/ShipWeather.ts`), which multiplies whatever albedo and roughness surface
detail gives a paint. One node graph per response (paint, and timber for teak) serves every
shared paint, so premade and player-built ships get it alike and equal paints keep one
program. Dry weather leaves every pixel as it was (frozen port A/B: identical). All of it is
visual; the simulation never reads it.

- **Rain.** Exposed paint wets over about 10 s in a downpour and 45 s in a drizzle, and dries
  over three minutes once it stops (`RAIN_TIMES`); a scene that opens in rain opens wet. Wet
  paint loses albedo by how porous it is, 5 % for the smoothest paint to 24 % for the roughest
  and 42 % for teak, and its roughness falls toward the water film's (0.38 on decks and roofs,
  0.48 on walls, 0.5 on teak: satin, about as far as Lagarde's wet surfaces go). Undersides stay dry; walls take about half a deck's wetness, and in
  heavy rain water streams down them along the wear's runoff paths from each wall's top edge.
  Heavy rain stands in patches on flat decks (roughness 0.07). Where ship occlusion runs, what
  it finds deep in shelter stays drier.
- **Bow spray and green water.** A hull meeting a heavy sea at speed wets her bow and
  forecastle as seawater on steel, with the wet band's own response: strongest at the stem,
  thinning aft over up to 30 % of her length and upward to about 14 m above her deck edge,
  in patches that stay on the ship. How much depends on significant wave height, how squarely
  she meets the waves and her speed, over her freeboard; each plunge of the bow wets her within
  a second or so, and it drains over tens of seconds (`SPRAY`). The eight nearest bows wet;
  `game.shipWeather.sprayOverride` (0–1) wets every bow in view by that much, for review.
- **Lightning.** A flash lifts the hemisphere fill and lights meshes directly from the stroke:
  a point light at the middle of a ground stroke's channel (a fifth as much from the cloud base
  under an intra-cloud flash) in the sky's own convention, taken whole as meshes take the sun,
  dimmed by the rain between and never more than about a sixth of the noon sun on the ships near the camera
  (`VisualEnvironment.boltLight`). No shadows.

No setting switches it: rain and spray cost nothing in dry weather or a slight sea, and the
lightning light is one more point light beside the gun-flash and fire lights.

The runtime roster's ships, premade and player-built, consume this one standard and
retain their own original schemes and deck coverings. Plated paint bakes no mottling:
an A/B on Hood showed the baked ±11 % adding only 0.2 points of broad variation over
the runtime In commission mottle, which already matches the Scharnhorst design (about
3 % fine and 4 % broad luminance variation on a hull side). This is a
material-quality pass against existing briefs, not a new historical-accuracy claim
or acceptance of documented geometry limitations.

## Battle damage

Damage that stays on a ship in battle is drawn at runtime over the shared paint, the
same for premade and player-built ships, and never baked or authored. Nothing in the
simulation reads it.

- **Impact marks** (`ShipImpactMarks.ts`): mesh-conforming decals for each strike, the
  latest 96 per ship, from a procedural atlas (`ImpactTexture.ts`).
- **Scorch** (`ShipScorch.ts`): soot and charred paint where fires burned and around
  strikes. A burning compartment chars the deck or roof its vent opens onto and soots
  the plating above it, leaning downwind with the smoke; a burning gunhouse chars and
  soots itself; soot and char grow over the fire's life and outlast it. HE bursts and
  penetrations scorch about 1.3 and 0.75 times their mark's width in radius; strikes
  close together merge. Each ship keeps 20 scorched places, fires first.
- **Burn-out**: a lost ship (`damage.sunk`) burns out over about ten seconds while she
  settles: charcoal and the rust-brown of steel whose paint has burned away, matte and
  blistered close to, patchy, heaviest on her superstructure and where her fires were,
  her decks burned in patches and the hull above the sea scorched thinly. Gunfire and
  magazine losses burn out fully; flooding and capsize by 35 % plus her fires. Her fires
  burn on until the sea reaches each, and a few embers glow in the charred seats, a dull
  orange that reads at night and hardly by day.

The ship paint is shared across hulls and drawn in fleet batches, so the per-ship damage
lives in one float texture read with `textureLoad` (no sampler): a row for each of the 16
nearest damaged hulls with its bounds, world-to-hull matrix and spots. A fragment finds
its hull by position and works in the hull frame, so the damage follows every batch,
detail level, turret and list. With no damaged hull in view the paint skips it on one
uniform. It clears when the battle resets or the ship returns to port. Review it with
`bun scripts/browser/effects-review.ts --scene s-fire,s-hits,s-burnout`, whose frames
include the same view with the scorch switched off.
