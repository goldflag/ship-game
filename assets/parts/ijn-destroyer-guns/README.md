# Japanese destroyer guns

Original shared builders, called through `assets/parts/library.py`:

- `type_c.py`: the existing Yukikaze twin 127 mm Type C recipe, extracted with its independent elevation/recoil joints and installation-specific deck-height callback.
- `aa.py`: the existing Mogami Type 96 recipes, preserved without combining catalog variants.
- `type_93.py`: independently authored single and twin 13.2 mm mounts, based on the approved [GameModels3D Fubuki A configuration](https://gamemodels3d.com/games/worldofwarships/vehicles/pjsd106). Includes pedestal, fork, bearings, receiver, ammunition feed, cooling fins, sights and variant-specific controls/seats or shoulder rests.

Downloaded models are comparison-only. Type 93 identification follows the approved source configuration; dimensions and operating limits are game conventions, not independently verified historical specifications. Installation review on Fubuki does not certify arbitrary installations on other ships. Standalone previews remain generated under `.build/parts/`.

Type C fabric follows the full front-and-roof gun-slot perimeter through the
shared pitching-cover morphs. Its cuff does not recoil; the barrel slides
through it. Reduced circular tessellation preserves the muzzle/joint contract.
Type 93 cooling ribs are spaced more coarsely for the inspection mesh, and
small unsupported decorative magazine apertures are omitted.

Type C's 13e3e07 published assembly sets a 6,460-triangle ceiling. The refinement
uses larger rear access doors, a lower offset sight hood, fewer rear steps and
reworked canvas folds, spending fewer triangles on rolled edges. The broad roof
profile and small face fittings still differ from the registered source. Fubuki
and Yukikaze retain this exact registered part, their pivots and weapon values.
