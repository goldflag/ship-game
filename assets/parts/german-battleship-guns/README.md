# German battleship gun mounts

`sk-c34-380-twin` is the original reusable Bismarck 38 cm twin mount. The catalog
owns the armor facets and weapon data; `sk_c34.py` owns the optical housings,
service fittings and cloth seals. The ship supplies the fixed barbette's deck
height. Existing mount IDs, yaw/elevation/recoil nodes and muzzle sockets remain
unchanged. The compiled mount's `rangefinder` flag selects the projecting optical
wings; Anton retains covered side blisters.

Geometry follows the approved [GameModels3D Bismarck '41 A artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pgsb708)
visual reference. Geometry is independently authored; this is not historical
certification. Fine service details and the fixed-rim, pitching-cuff cloth remain
approximations. Barrels slide through the cuffs during recoil. The installed elevation range follows the approved A artillery
configuration (−1° to +30°), not an independently established mechanical stop. Library review stays unreviewed until installation review passes.

```sh
bun run part:build sk-c34-380-twin
bun run part:check sk-c34-380-twin
bun run model:viewer
```

Standalone preview uses the default covered-blister installation; choose Bruno,
Caesar or Dora's installed preview to inspect rangefinder wings. Temporary
comparison renders and articulation captures belong in `.build/`.

`flak-37-bismarck-1941` now uses the original reusable `sk_c30.py` twin. Its
rearward trunnions, open bearing fork, sliding receivers, recoil cylinders,
controls and footboards replace the ship recipe's generic medium AA mount.
At the approved model's displayed 30-degree pose, the muzzle locations imply
an approximately −0.45 m fore/aft pivot, 1.6275 m axis height and 0.40 m barrel
spacing with a 2.22 m pivot-to-muzzle length. These are visual reconstruction
measurements, not a recovered mechanical drawing. The builder reads those
dimensions from the catalog and preserves the existing joint/socket IDs.

The low mounting sole extends 0.10 m below the installation root. Ships own
their deck or sponson support; the component does not build a column down to
the weather deck. The original reference's AA `horizSector`, `deadZone` and
`pitchDeadZones` fields are empty, so the retained catalog travel remains an
authored game approximation. Isolated receiver/cradle clearance does not certify
independent neighboring mounts or each ship's surrounding galleries.

```sh
bun run part:build flak-37-bismarck-1941
bun run part:check flak-37-bismarck-1941
bun run part:inputs flak-37-bismarck-1941
```

The 15 cm original builder now respects each installation's `rangefinder` flag:
standalone and the four no-rangefinder installations omit the optical wings;
the two flagged ship mounts retain them. Its muzzle reach follows the approved
no-rangefinder source's common-scale silhouette. The barrel profile is adapted
to the shorter reach rather than reversing overlapping tube segments.

The named SK C/33 heavy AA component uses the approved `ggs003_105_mm_skc_33`
open C/31 shield. It explicitly reuses the original cruiser C/31 constructor,
replacing an enclosed shield that conflated the separate C/37 source fit.
Catalog-specific pivot, barrel spacing and joint IDs are retained. This visual
correction does not independently certify the historical mounting designation.

The capital-gun shape pass uses the registered no-rangefinder `ggm2016`
comparison. Its original visual shell has a rounded aft plate and higher curved
roof break; the side covers follow both sloping shoulders, and connected barrel
surfaces replace hidden segment caps. The shallow cuff profile remains continuous
through full recoil. Armor/collision facets, weapon balance and joint/socket
transforms remain unchanged; they are a coarser approximation of the visible
aft curve. Fine cloth folds and the support race remain simplified. The projecting
rangefinder installation remains a distinct flag, not a claim that `ggm2016`
shows that equipment.

## 28 cm SK C/34 triple

`sk-c34-283-triple` is the original reusable Scharnhorst main turret
(`sk_c34_triple.py`). Geometry follows the approved
[GameModels3D Scharnhorst A artillery](https://gamemodels3d.com/en/games/worldofwarships/vehicles/pgsb507)
visual `ggm058_280mm54_5_c34`, which that model fits at all three positions
without turret rangefinder arms; there is therefore one variant. Geometry is
independently authored from measured proportions; this is not historical
certification.

The catalog `gunhouseMesh` is both the armor and the visible shell: vertical
flanks to a 1.91 m knuckle, 43° shoulders, a flat roof, the long forward glacis
and a seven-station rounded back plate. The recipe adds the 5.53 m turntable
sole and raised working platform, tapered shoulder sight hoods, flank ladders,
shoulder grab rails, the side stowage tubes on saddles, rear ventilation hoods
and the two gunlayers' sight ports, whose apertures both open toward starboard
as on the approved model. The support attachment is the sole at Y = 0; the
Shipbuilder owns the barbette below it.

Barrels slide through flexible `gun_bloomers` cuffs on a constant 0.36 m jacket
that spans the 1.2 m recoil stroke. The fixed seams are cast onto the real
face, upper plate and glacis, and intermediate cloth rings are draped over the
armor knuckle at depression and kept outside the jacket at high elevation.
Pivot, spacing and muzzle datums come from the approved model's joint nodes.

Weapon values are provisional game calibration scaled from the 38 cm sibling
(330 kg at 890 m/s, 17 s reload, −8° to +40°); plate families use the commonly
published 360/200/350/150 mm figures with estimated facet boundaries. Fine
cloth folds, plate seams and the small rear fittings remain approximations.
Library review stays unreviewed until installation review passes.

```sh
bun run part:build sk-c34-283-triple
bun run part:check sk-c34-283-triple
```
