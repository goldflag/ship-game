"""Original 14-inch/50 three-gun turret, the Tennessee class main battery.

Visual proportions follow the approved GameModels3D pasb718 artillery
(`agm049_14in50_3gun_turret`), which California shares. No reference geometry is
loaded here. The catalog owns the closed armor shell and the weapon data; this
recipe draws that shell and adds the rotating sole, the short sliding jackets,
the tall hooded canvas seals that give this variant its rounded gun-port
blisters, the bolted seam cleats and the service fittings. Unlike the New Mexico
turret there are no rangefinder end hoods.

Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import importlib.util
import math
from pathlib import Path
from blender_barrels import barrel_layout

SLEEVE = .48       # constant jacket radius under the canvas cuff
COLLAR = 2.71      # cuff station forward of the trunnion
BASE = .07         # sole plate thickness; the shell floor sits on it

# jacket, jacket mouth and the tapering chase, in trunnion-local metres
PROFILE = [(-.14, .50), (2.50, .50), (2.62, SLEEVE), (4.00, SLEEVE), (4.07, .43), (4.20, .41),
           (9.55, .29), (12.76, .29), (12.94, .315), (12.991, .315)]


def _common():
    path = Path(__file__).resolve().parent / 'common.py'
    spec = importlib.util.spec_from_file_location('us_14in50_common', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def create_mount(mount, collection, helpers, materials):
    turret = _common().Turret(mount, collection, helpers, materials)
    spec = mount['weapon']
    axis = spec['pivotHeight']
    box, rod, cyl, name = turret.box, turret.rod, turret.cyl, turret.name

    turret.gunhouse()
    turret.sole(spec.get('rollerRadius', 5.19), BASE)
    turret.elevating(PROFILE)

    lean = turret.face_lean()

    # Tall hooded canvas seals. The glacis carries no port frame on this
    # variant: the cloth is bolted straight to the plate around an oval seam
    # and rises well above the bore, which is what gives the reference its
    # blistered face.
    def seam(angle):
        c, s = math.cos(angle), math.sin(angle)
        return (.66 * math.copysign(abs(c) ** .82, c),
                .05 + .88 * math.copysign(abs(s) ** .82, s))

    turret.bloomers(seam, spec['trunnionForward'] + COLLAR, SLEEVE + .025, SLEEVE,
                    rings=5, slack=.15, fullness=.10)

    # The seam is held by a ring of small cleats bolted to the plate, in the
    # five rows the approved model shows down each port.
    for _, y, _ in barrel_layout(spec):
        for dz, dy in [(.86, .49), (.86, -.49), (-.06, .77), (-.06, -.77), (-.33, .77), (-.33, -.77),
                       (-.60, .74), (-.60, -.74), (-.79, .47), (-.79, -.47)]:
            z = axis + dz
            cleat = turret.put(box(name + '.seam-cleat', (turret.front_x(y + dy, z) + .04, y + dy, z),
                                   (.10, .12, .13), turret.painted, collection))
            cleat.rotation_euler.y = lean

    for sign in (1, -1):
        # Pointer's and trainer's periscope hoods on the roof panel, and the
        # rear ventilation hood standing proud of the after plate.
        turret.sight_hood(-1.25, sign * 3.40, sign, height=.29, radius=.26)
        turret.put(box(name + '.vent-hood', (-7.86, sign * 1.95, 1.30), (.80, .86, 2.10),
                       turret.naval, collection))
        turret.put(box(name + '.vent-hood-cap', (-7.80, sign * 1.95, 2.42), (.92, .94, .16),
                       turret.painted, collection))
        turret.put(box(name + '.vent-grille', (-8.22, sign * 1.95, 1.90), (.10, .58, .64),
                       turret.dark, collection))

        # Ladder up the after flank to the roof, and grab rails along the roof
        # rim where the walking line runs forward.
        foot = (turret.side_y(-3.00, .36, sign) * sign, .36)
        crown = (turret.side_y(-3.00, 2.20, sign) * sign, 2.20)
        turret.flank_ladder(sign, foot, crown, rails=(-3.20, -2.80), rungs=7)
        turret.grab_rail([(-3.25, 3.60), (-2.25, 3.84)], sign)
        turret.grab_rail([(1.90, 2.90), (.90, 3.22), (-.10, 3.55)], sign)

        # Steps on the exposed sole abreast the flank.
        for x, y in [(.60, 4.78), (1.45, 4.46), (2.30, 4.14)]:
            turret.put(box(name + '.sole-cleat', (x, sign * y, BASE + .05), (.20, .36, .12),
                           turret.painted, collection))

    # Centreline roof fittings: the after crew hatch and the training-sight hood.
    turret.roof_hatch(-4.10, 0, size=(.58, .48))
    seat = turret.top_z(-6.10, 0)
    turret.put(cyl(name + '.training-hood', (-6.10, 0, seat + .08), .34, .20, turret.naval, collection, 12, .27))

    # Steps on the sole under the gun ports.
    for y in (0, .90, -.90):
        turret.put(box(name + '.face-step', (4.86, y, BASE + .055), (.34, .10, .11),
                       turret.painted, collection))

    return turret.finish()
