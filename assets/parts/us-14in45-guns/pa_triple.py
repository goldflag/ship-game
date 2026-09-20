"""Original 356 mm/45 Mk 8 triple, the Pennsylvania-class main turret.

Visual proportions follow the approved GameModels3D pasb506 A artillery
(`agm162_14in45_triple`), whose middle-turret visual `agm163` is the same
shell. No reference geometry is loaded here. The catalog owns the closed armor
shell and the weapon data; this recipe draws that shell and adds the wide
turntable with its bracket ring, the three sliding barrels in long canvas
sleeves, the rangefinder end hoods on the rear corners, the rear-quarter
equipment fairings, the roof rails and the flank ladder.

Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from us14in45_common import Turret            # noqa: E402

SLEEVE = .435        # constant sliding jacket through the canvas cuff
COLLAR = 3.40        # cuff station forward of the trunnion
FACE = (.7213, 0, .6926)      # outward normal of the raked face plate


def create_mount(mount, col, helpers, materials):
    turret = Turret(mount, col, helpers, materials)
    turret.shell()
    # Radial brackets stiffen the gunhouse foot out to the roller path; the
    # rear quarters are wider than the ring, so they carry none.
    turret.turntable(5.02, .104, gussets=28, gusset_out=.62)

    # The rear ring stops at the trunnion so the breech end stays inside the
    # gunhouse and above the sole at full elevation and recoil.
    guns = turret.barrels([(-.10, .47), (1.80, SLEEVE), (4.80, SLEEVE), (4.92, .395),
                           (10.79, .299), (11.00, .325), (11.307, .325)], rim=.325, rim_run=.40)

    # Three tall gun ports on the raked face; the sleeves nearly touch, so the
    # raised frames stay narrow.
    collar = mount['weapon']['trunnionForward'] + COLLAR
    for side, y, _ in guns:
        turret.port_frame(y, 1.18, .58, 1.00, FACE, growth=(1.06, 1.10), proud=.055)
    for side, y, _ in guns:
        turret.cover(side, y, turret.seam(y, 1.18, .58, 1.00), collar, SLEEVE, slack=.20, fullness=.12)

    # Splinter coaming at the head of the glacis, and the AA seatings the
    # reference rig carries on the after roof.
    turret.put(turret.box(turret.name + '.face-coaming', (2.145, 0, 2.615), (.39, 5.54, .53), turret.naval, col, .02))
    for sign in (1, -1):
        seat = turret.top_z(-6.593, sign * .765)
        turret.put(turret.cyl(turret.name + '.aa-seat', (-6.593, sign * .765, seat + .015), .32, .09,
                              turret.naval, col, 16))
        turret.handrail('roof-rail-aft', -7.15, -2.45, sign * 2.645, .14, 4)
        turret.handrail('roof-rail-forward', -2.18, 2.05, sign * 2.645, .14, 4)

        # Rangefinder end hood: a housing rooted in the upper flank, its pod
        # and window reaching past the shell on the rear corner.
        turret.put(turret.box(turret.name + '.rangefinder-hood', (-6.36, sign * 3.225, 2.26),
                              (1.12, 1.45, .72), turret.naval, col, .03))
        turret.put(turret.box(turret.name + '.rangefinder-bracket', (-6.14, sign * 4.005, 2.255),
                              (.08, .33, .37), turret.naval, col, .01))
        turret.put(turret.box(turret.name + '.rangefinder-cap', (-6.155, sign * 4.03, 2.26),
                              (.25, .16, .14), turret.painted, col, .01))
        turret.put(turret.rod(turret.name + '.rangefinder-pod', (-6.405, sign * 3.90, 2.255),
                              (-6.405, sign * 4.33, 2.255), .285, turret.naval, col, vertices=12))
        turret.put(turret.rod(turret.name + '.rangefinder-window', (-6.405, sign * 4.32, 2.255),
                              (-6.405, sign * 4.37, 2.255), .21, turret.glass, col, vertices=12))

        # Rear-quarter equipment fairing, hung on the flank and stopping on
        # the sole; the ship owns everything below it.
        turret.put(turret.box(turret.name + '.quarter-fairing', (-5.96, sign * 3.035, .95),
                              (2.70, 1.43, 1.86), turret.naval, col, .03))
        turret.put(turret.box(turret.name + '.quarter-fairing-rim', (-5.96, sign * 3.10, 1.92),
                              (2.74, 1.32, .10), turret.painted, col, .01))

    # Port flank ladder to the roof, and the loading rails on the forward sole.
    turret.ladder('flank-ladder', ((-2.70, 4.044, .433), (-2.70, 3.064, 2.433)),
                  ((-2.38, 4.044, .433), (-2.38, 3.064, 2.433)), 7, (0, .8977, .4403), depth=.15)
    for y in (.37, 1.13):
        for sign in (1, -1):
            turret.put(turret.box(turret.name + '.sole-rail', (4.73, sign * y, .17),
                                  (.43, .04, .11), turret.painted, col, .01))
    return turret.place()
