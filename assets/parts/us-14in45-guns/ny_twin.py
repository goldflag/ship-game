"""Original 356 mm/45 Mk 8 twin, the New York and Texas main turret.

Visual proportions follow the approved GameModels3D pasb006 A artillery
(`agm125_14in_45_mk8`), whose second Texas visual `agm126` is the same shell
with extra service ladders. No reference geometry is loaded here. The catalog
owns the closed armor shell and the weapon data; this recipe draws that shell
and adds the turntable, sliding barrels, canvas port covers, sighting hoods,
roof rails and ladders.

Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from us14in45_common import Turret            # noqa: E402

SLEEVE = .465        # constant sliding jacket through the canvas cuff
COLLAR = 1.72        # cuff station forward of the trunnion
FACE = (.6864, 0, .7264)      # outward normal of the raked face plate


def create_mount(mount, col, helpers, materials):
    turret = Turret(mount, col, helpers, materials)
    turret.shell()
    turret.turntable(4.70, .10)

    # A long constant jacket carries the cuff through the 1.1 m stroke; the
    # chase then tapers to the muzzle swell.
    # The rear ring stops just behind the trunnion so the breech end stays
    # inside the gunhouse and above the sole at full elevation and recoil.
    guns = turret.barrels([(-.25, .50), (.60, SLEEVE), (3.30, SLEEVE), (3.60, .395),
                           (10.30, .276), (10.60, .30), (11.475, .30)], rim=.30)

    # Gun ports. The seam is cast onto the real face so it stays seated where
    # the port returns up the plate; the ring spans the full elevation sweep.
    collar = mount['weapon']['trunnionForward'] + COLLAR
    for side, y, _ in guns:
        turret.port_frame(y, 1.395, .62, .87, FACE, growth=(1.22, 1.16), proud=.08)
    for side, y, _ in guns:
        turret.cover(side, y, turret.seam(y, 1.395, .62, .87), collar, SLEEVE)

    # Roof: the transverse riser over the rear plate, the splinter coaming at
    # the head of the glacis, two hinged sighting hoods and the side rails.
    turret.put(turret.box(turret.name + '.rear-roof-riser', (-6.63, 0, 2.575), (.46, 5.52, .26), turret.naval, col, .02))
    turret.put(turret.box(turret.name + '.face-coaming', (1.475, 0, 2.41), (.06, 5.54, .34), turret.naval, col, .01))
    for sign in (1, -1):
        turret.sight_hood(-.615, sign * .50, 1.25, .60, 2.60)
        turret.handrail('roof-rail', -6.42, 1.41, sign * 2.42, .145, 5)

    # Access. A flank ladder climbs the port quarter to the roof, and a centre
    # ladder runs up the glacis between the two gun ports.
    turret.ladder('flank-ladder', ((-4.48, 3.330, .477), (-4.48, 2.864, 2.297)),
                  ((-4.08, 3.330, .477), (-4.08, 2.864, 2.297)), 6, (0, .9688, .2478), depth=.14)
    turret.step(-4.32, 3.42)
    turret.ladder('face-ladder', ((1.946, .22, 2.463), (4.196, .22, .406)),
                  ((1.946, -.22, 2.463), (4.196, -.22, .406)), 8, FACE, depth=.22)
    return turret.place()
