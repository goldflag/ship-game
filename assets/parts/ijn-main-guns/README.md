# IJN main-battery originals

`type94_460_triple.py` builds the Yamato 46 cm triple; `geometry.py` builds
the Yamato 15.5 cm and Mogami E/E3 variants. GameModels3D comparison resources are registered in
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

The 46 cm Type 94 triple follows the GameModels3D pjsb018 A artillery
(`jgm178_460mm_45_type94`), measured from its joint nodes and inspection
sections; no reference geometry is loaded. Datums are the reference's own:
pivot 1.692 m and trunnion 3.655 m, muzzle 19.511 m, barrels 3.05 m apart, all
relative to a yaw datum 2.40 m below the reference hardpoint (pivotHeight
4.092 m). The catalog `gunhouseMesh` is both the armour and the visible
gunhouse: a 45-degree face, raked sides widest abreast the trunnions, forward
quarter plates, a rounded raked rear and a crown falling 0.41 m toward the face,
with 650/250/190/270 mm face/side/rear/roof plates on estimated facet
boundaries. The recipe adds the turntable, a low curved plinth under the ports,
three raised round-topped port frames with canvas bags seated inside them,
stepped barrels (0.649 m reinforce, a clear shoulder, a tapering chase and a
muzzle swell), the armoured end hoods of the 15 m rangefinder with their open
objective windows, gussets and grab rungs, roof joint straps, lifting eyes, the
gunlayer's sight hood, the commander's periscope hood and pillar, a forward
sight, a roof conduit, edge rails, flank, face and rear ladders, octagonal side
vision ports, and the rear davit arm, shelves and lamp. `rangefinderForward` is
-7.9 m, the hoods' station. The standalone export is about 7,100 triangles.

The bags keep fixed seams on the port frames and pitching cuffs with a lashing
band; the constant reinforce runs through the cuff for the full 1.43 m recoil.
Intermediate canvas rings ride high over the gun, sag toward the plinth and are
held proud of the face and outside the reinforce at every five-degree shape.
Approximations: canvas folds are procedural rather than the reference's
wrinkles; the ports are sized for the −5°…+45° travel; the hood windows are
rectangular; roof and rear fittings are simplified; the housing's shallow
foot sits on the ship's support at 2.15 m, 0.25 m below the reference's
turntable ring. Reference matching does not certify historical fit.

Mogami E3/E retain their 13e3e07 whole-assembly ceilings of 3,406/3,666 triangles.
The main-battery refinement removes bearing fasteners, narrows aft shoulders,
adds a seated rear access ladder and replaces the E variant's exposed rangefinder
tube/braces with a continuous tapered armored casing. Canvas folds remain an
approximation; small face mechanisms and optical housings are simplified. The
Yamato 15.5 cm variant is secondary-only in current consumers and belongs to the
separate secondary/AA pass, despite that caliber's use as main armament elsewhere.
