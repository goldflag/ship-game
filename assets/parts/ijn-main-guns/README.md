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
