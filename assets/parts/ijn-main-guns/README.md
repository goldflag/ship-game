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

The Yamato 46 cm original includes a 2.4 m support between its yaw datum and
gunhouse floor. GameModels3D's standalone turret omits that installation
support; whole-model height comparisons therefore need this datum distinction.
Keep the support when using the existing ship mount positions. Detailed source
fit and installed-neighbor clearance remain subject to model review.

Mogami E3/E retain their 13e3e07 whole-assembly ceilings of 3,406/3,666 triangles.
The main-battery refinement removes bearing fasteners, narrows aft shoulders,
adds a seated rear access ladder and replaces the E variant's exposed rangefinder
tube/braces with a continuous tapered armored casing. Canvas folds remain an
approximation; small face mechanisms and optical housings are simplified. The
Yamato 15.5 cm variant is secondary-only in current consumers and belongs to the
separate secondary/AA pass, despite that caliber's use as main armament elsewhere.
