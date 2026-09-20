# IJN heavy-cruiser main guns

Original reusable 20 cm/50 3rd Year Type twin turrets for the Shipbuilder catalog. Geometry is authored in
these recipes; the only visual reference is GameModels3D (World of Warships), one gun visual per part, used
for silhouette, proportions, joints and which ships share a mount. No reference mesh is loaded or shipped.

Evidence pages: `https://gamemodels3d.com/games/worldofwarships/vehicles/<vehicleId>` (model files under
`https://gamemodels3d.com/games/worldofwarships/data/current/common/visual/japan/gun/main/<name>/<name>.model`).

| Part | Recipe | Source vehicle | Gun visual |
| --- | --- | --- | --- |
| `type3-203-aoba-twin` | `type3_203_c_twin.py` | pjsc007 Aoba, AB1 artillery | `jgm013_203mm50_type_c` |
| `type3-203-aoba-twin-rf` | `type3_203_c_twin_rf.py` | pjsc007 Aoba, AB1 artillery | `jgm014_203mm50_type_c_rf` |
| `type3-203-furutaka-twin` | `type3_203_e_rail_twin.py` | pjsc005 Furutaka, AB1/AB2 artillery | `jgm146_203mm50_type_e` |
| `type3-203-furutaka-twin-rf` | `type3_203_e_rail_twin_rf.py` | pjsc005 Furutaka, AB1/AB2 artillery | `jgm147_203mm50_type_e_rf` |

## Model C twin (Aoba)

Aoba's AB1 artillery fits two rangefinder mountings and one without, so both are registered. The two visuals
share one gunhouse, one pair of barrels and one pair of bloomers; `jgm014` adds a 6.85 m rangefinder housing
lying athwartships on the rear crown whose optical ends stand 0.4 m proud of both flanks and raise the
mounting from 6.15 m to 7.18 m across and from 2.69 m to 3.14 m tall, and it breaks the perimeter rail either
side of the housing. That is a visible difference at the fitted scale, so they are two parts rather than one.

The catalog's closed `gunhouseMesh` is both the armour and the visible shell: a plumb-sided house with a
rounded stern and bow in plan, a front plate raking aft with height, a sloping shoulder plate all round and a
flat crown. The recipes add the turntable roller path, two sliding barrels with a jacket step where the chase
leaves the bloomer, canvas gun-port covers, the crown panel, the gunlayer's periscope hood, the raised trunk
on the port shoulder, the perimeter railing, both flank ladders and the rear-quarter ladder.

Approximations: the reference's 8 cm recessed panel on the forward crown is drawn as a raised plate of the
same outline; the two-facet shoulder chamfer is reduced to one facet per bay; the 24-sided reference plan is
carried on 20 points, which rounds the after quarter by up to 10 cm; the shell floor sits 4 cm above the sole
on a roller path, where the reference plates straight to the deck.

## Model E twin (Furutaka, Takao class)

`jgm146` (Furutaka) and `jgm025` (Atago, Maya) are the same mesh, and so are `jgm147` and `jgm024`; one part
therefore covers Furutaka's rebuilt mountings and the Takao class. This is **not** the catalog's existing
Mogami mount: against `jgm143_203_50_type_e3` the gunhouse is 8.28 x 6.02 x 2.06 m instead of
8.14 x 5.67 x 2.04 m, the muzzle datum is 9.45 m instead of 9.09 m, the stern facet comes to a point on the
centreline, and the roof carries a full perimeter railing, three hatch panels and a raised trunk that the E3
roof does not have. The glacis also carries three columns of climbing rungs and three raised ridges.

`jgm147` adds a low 6.6 m rangefinder bar over the rear roof with its optical ends projecting to y = 3.45 m,
and deletes the after railing, so it is registered separately under the same rule.

Approximations: the reference sinks each gun port into a deep pocket cut back to x = 1.48 m. A catalog shell
must be closed, so the face is flattened and the pocket walls are redrawn as the raised glacis ridges the
reference also carries; the bloomer seam therefore starts on the face instead of a metre inside it. The plan
is carried on nine half-stations at four levels (124 triangles), which straightens the curved glacis break by
up to about 0.2 m between z = 1.35 m and z = 1.8 m. The two rangefinder sighting hoods are not a mirrored
pair on the reference and are drawn as it has them. The shell floor sits 4 cm above the sole on a roller path.

## Data basis

Pivot, trunnion, muzzle and barrel-spacing datums are the reference joint nodes (`Rotate_X`, `Roll_Back*`)
converted to the authoring frame. Projectile mass 125.85 kg, muzzle velocity 840 m/s, mounting weight
166-175 t, elevation -5/+40 deg with 6 deg/s (Model C) and -5/+70 deg with 12 deg/s (Model E), 4 deg/s
training and 3-4 rounds per minute per gun are commonly published figures (navweaps.com 20 cm/50 3rd Year
Type); reload is entered at 15 s (4 rounds per minute). Traverse arc and recoil stroke follow the nearest
sibling, `type3-203-mogami-e-twin`.

Weapon and armor values are provisional game calibration scaled from `type3-203-mogami-e-twin`; plate
families use commonly published figures (25 mm Japanese heavy-cruiser turret plating, 10 mm floor) with
estimated facet boundaries. Model fidelity checks do not certify historical accuracy.
