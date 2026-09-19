# IJN main-battery originals

`geometry.py` builds separate Yamato 46 cm, Yamato 15.5 cm and Mogami E/E3
variants. GameModels3D comparison resources are registered in
`tools/ship-overlay/component-references.json`; they are visual references,
never recipe inputs.

Gun-port fabric uses `gun_bloomers.py`: its perimeter follows the original
front plate, the cuff pitches, and the barrel slides inside it during recoil.
Turned barrels use 16-sided smooth-shaded sections; small raised plate-marking
rods are omitted while ladders, rangefinders, hatches and port frames remain.
The 15.5 cm roof slopes toward the low front plate, with roof fittings seated
on that surface.

The Yamato 46 cm original contains only a shallow bearing below the gunhouse.
Its support attachment is Y=2.15 m above the unchanged yaw datum. Shipbuilder
supplies the adjustable barbette; historical ship recipes supply their own
fixed support to that same bearing plane. No full-height cylinder is baked into
the reusable component. Detailed source fit and installed-neighbor clearance
remain subject to model review.

The 46 cm refinement uses an original two-course, continuously raked gunhouse
with a longer afterbody, a gently forward-falling roof and broad swept armored
rangefinder wings with physical recessed optical apertures. Its barrel chase retains a constant sleeve under the pitching
canvas cuff through the full recoil stroke. The three barrel groups, joint IDs,
muzzle datums and catalog combat dimensions are unchanged. The complete highest-detail standalone export is 4,830 triangles (previous merged model: 5,884).

The registered JGM178 resource is the same identified variant. Inspection uses
its geometry-only front, side, rear, top and quarter views at one metric scale.
The retained muzzle endpoints, simplified roof
fittings and approximate rear curvature still differ from that reference;
reference shape matching does not certify historical fit. Armor/collision
calibration retains the existing catalog envelope independently of this visual
refinement.

The 46 cm closed ports extend to the forward crown and use a lower sill to
clear the retained −5°…+45° gun travel. These taller openings are an explicit
articulation-driven approximation to the neutral reference. The canvas retains
fixed seams and pitching cuffs; intermediate rings clear the full recoiling
jacket, with a short neck behind each cuff so its faces cannot cross the barrel
shoulder. The cuff radius includes 7 mm of extra chord/interpolation clearance.
