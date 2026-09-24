# IJN main-battery originals

`geometry.py` builds separate Yamato 46 cm and Mogami E/E3 variants;
`type3_155_triple.py` builds the Yamato 15.5 cm triple. GameModels3D
comparison resources are registered in
`tools/ship-overlay/component-references.json`; they are visual references,
never recipe inputs.

Gun-port fabric uses `gun_bloomers.py`: its perimeter follows the original
front plate, the cuff pitches, and the barrel slides inside it during recoil.
Turned barrels use 16-sided smooth-shaded sections; small raised plate-marking
rods are omitted while ladders, rangefinders, hatches and port frames remain.

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

Mogami E3/E retain their 13e3e07 whole-assembly ceilings of 3,406/3,666 triangles.
The main-battery refinement removes bearing fasteners, narrows aft shoulders,
adds a seated rear access ladder and replaces the E variant's exposed rangefinder
tube/braces with a continuous tapered armored casing. Canvas folds remain an
approximation; small face mechanisms and optical housings are simplified.

The Yamato 15.5 cm/60 3rd Year Type triple (`type3-155-triple`) follows the
GameModels3D pjsb018 A_ATBA artillery `jgs156_155mm_60_type3`, the one visual
fitted at both Yamato secondary positions. Its catalog `gunhouseMesh` (62
vertices, 120 plates) is the visible gunhouse: a faceted round rear, the
athwartships rangefinder housing whose arms stand past both flanks, cambered
roof edges, and raked cheeks either side of an open gun recess. Pivot 1.291 m,
trunnion 1.762 m, muzzle 9.045 m and 1.55 m spacing are the reference joints
measured from the Yamato yaw datum, which sits 0.253 m below the reference
hardpoint; a barbette lip and shadowed roller ring fill that height, so the
ship's fixed support ends at the datum. Each gun pitches an elevating blast bag
(hood over the breech, bell round the chase) through its slot and recoils its
chase inside it; guard hoops arch over the slots from the inter-gun blocks,
which carry the gunlayers' hoods. Other fittings: grilled rangefinder hoods,
periscope cupola, housing steps, flank frames, flank, nose and block ladders,
rear and forward handrails and rear rain brows. The reference barrels are
treated as level (its muzzle joint is 0.6° above the trunnion) and share one
trunnion and muzzle station. The hood stays within 0.93 m of the trunnion and
the bag's lower edge is raised just enough to clear the recess floor and skirt
through −7°…+55° and the 0.6 m recoil, so the neutral pose shows a small gap
above the floor that the reference closes. The reference's ribbed hoops and
hoods are simplified to swept bars and boxes. The complete standalone export is
5,648 triangles (previous: 4,324). Weapon, armor and plate values remain the
provisional uniform 25 mm (10 mm floor) calibration; facet boundaries are
estimated. The aft mount trained forward still meets the raised 25 mm tubs and
the aft director foundation, which stand at the reference's own positions.
