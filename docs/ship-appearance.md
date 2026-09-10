# Ship appearance

The fleet shares a standard of material quality. Each ship keeps the colors,
camouflage, markings and deck coverings in its approved configuration. Start with
the [ship pipeline](ship-pipeline.md) and the ship's approved brief.

## Rules

- **Shared finish:** opaque paint uses a matte, nonmetallic surface. Exposed metal,
  canvas, wood and deck coverings have their own reusable finishes. A fitting uses
  the same paint as its supporting structure unless the reference shows otherwise.
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
- **Well-maintained default:** use low-contrast fading, fine surface variation,
  restrained runoff and a narrow waterline stain. Strong rust, exposed chips,
  missing paint and battle damage need a separate supported treatment. Avoid
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

Plain paints share neutral surface textures and use standard glTF color factors
for their swatches. Existing original image schemes retain their texture UVs,
boundaries and markings while receiving gentle metric fading. Declare their
metric image bounds and any atlas tiles/gutters in `imageLayout`; never guess an
existing UV layout. Exporter-supported procedural teak keeps its original plank
nodes and receives the shared wood finish before the existing export bake.

For a timber surface missing plank detail, `appearance/decking.py` creates
original repeating plank color and normal maps. The `decking` entry declares
plank width/length, seam width and coating independently of its color swatch.
The material carries `deckSubstrate=timber` and a separate `deckCoating` in glTF.
Only declared timber surfaces receive this treatment; steel roofs, gun platforms
and hatch covers retain their own roles. Exact covering boundaries and plank
dimensions require configuration-specific evidence; record interpretations in
the ship README.

Declare the appearance configuration, shared recipe and finishes in the ship's
`recipe-inputs.json`. Keep geometry, stable assembly/joint/socket IDs and the
approved scheme intact. Existing camouflage recipes may remain until migrated;
the surface recipe must not erase their patterns. Rebuild every declared consumer
of a changed shared input; `ship:check all` identifies stale assets.

The runtime roster's ships consume this standard. Mogami established the accepted
maintained finish; subsequent ships retain their own original schemes and deck
coverings. This is a material-quality pass against existing briefs, not a new
historical-accuracy claim or acceptance of documented geometry limitations.
