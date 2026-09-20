"""Original 14-inch/50 three-gun turret, the New Mexico class main battery.

Visual proportions follow the approved GameModels3D pasb034 artillery
(`agm065_14in50_3gun_turret`). No reference geometry is loaded here. The catalog
owns the closed armor shell and the weapon data; this recipe draws that shell
and adds the rotating sole, the framed gun ports, the sliding jackets, the
canvas seals and the fittings that mark this variant: rangefinder end hoods
projecting outboard at the rear quarters and louvred hoist fairings on the
after flanks.

Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the turntable sole.
"""
import importlib.util
import math
from pathlib import Path
from blender_barrels import barrel_layout

SLEEVE = .56       # constant jacket radius under the canvas cuff
COLLAR = 1.91      # cuff station forward of the trunnion
BASE = .05         # sole plate thickness; the shell floor sits on it

# jacket, jacket mouth and the tapering chase, in trunnion-local metres
PROFILE = [(-.14, .62), (1.45, .62), (1.62, SLEEVE), (3.32, SLEEVE), (3.55, .52), (3.888, .49),
           (3.91, .41), (9.44, .29), (12.57, .29), (12.82, .315), (12.852, .315)]


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
    turret.sole(spec.get('rollerRadius', 5.02), BASE)
    turret.elevating(PROFILE)

    lean = turret.face_lean()

    # Framed gun ports. The glacis rakes back, so each rib is seated on the
    # plate at its own height rather than on one shared station.
    for _, y, _ in barrel_layout(spec):
        for label, z in [('port-brow', axis + .86), ('port-sill', axis - .86)]:
            rib = turret.put(box(name + '.' + label, (turret.front_x(y, z) + .045, y, z),
                                 (.15, 1.46, .17), turret.naval, collection))
            rib.rotation_euler.y = lean
        for across in (.71, -.71):
            jamb = turret.put(box(name + '.port-jamb', (turret.front_x(y + across, axis) + .045, y + across, axis),
                                  (.15, .16, 1.88), turret.naval, collection))
            jamb.rotation_euler.y = lean

    # Canvas seals. These ports are square, so the fixed seam follows a rounded
    # rectangle bolted to the port frame while the cuff rides the jacket.
    def seam(angle):
        c, s = math.cos(angle), math.sin(angle)
        return (.63 * math.copysign(abs(c) ** .55, c), .63 * math.copysign(abs(s) ** .55, s))

    turret.bloomers(seam, spec['trunnionForward'] + COLLAR, SLEEVE + .02, SLEEVE,
                    rings=4, slack=.09, fullness=.05)

    for sign in (1, -1):
        # Rangefinder end hood: a box rooted in the after flank plate with a
        # rounded weather cap and the optical window in its outboard end.
        x = -5.64
        turret.put(box(name + '.rangefinder-arm', (x, sign * 4.18, 2.38), (1.10, 2.32, .44),
                       turret.naval, collection))
        turret.put(rod(name + '.rangefinder-cap', (x, sign * 3.30, 2.60), (x, sign * 5.35, 2.60),
                       .23, turret.naval, collection, vertices=10))
        turret.put(box(name + '.rangefinder-end', (x, sign * 5.35, 2.40), (1.14, .10, .62),
                       turret.painted, collection))
        turret.put(box(name + '.rangefinder-window', (x, sign * 5.39, 2.44), (.64, .04, .17),
                       turret.glass, collection))

        # Hoist fairing on the after flank with a louvred vent band along its
        # top. Its inboard face is sunk into the sloping side plate.
        turret.put(box(name + '.hoist-fairing', (-5.80, sign * 3.82, .80), (2.79, 1.40, 1.50),
                       turret.naval, collection))
        turret.put(box(name + '.hoist-fairing-cap', (-5.80, sign * 3.88, 1.62), (2.87, 1.32, .24),
                       turret.naval, collection))
        turret.put(box(name + '.vent-recess', (-5.80, sign * 4.44, 1.36), (2.55, .16, .34),
                       turret.dark, collection))
        for i in range(4):
            turret.put(box(name + '.vent-slat', (-7.02 + i * .82, sign * 4.48, 1.36), (.10, .18, .32),
                           turret.painted, collection))

        # Trainer's periscope hood on the forward roof shoulder.
        turret.sight_hood(1.30, sign * 3.05, sign, height=.40, radius=.29)

        # Ladder up the after flank to the roof, with grab rails where the
        # walking line reaches the roof and again beside the forward shoulder.
        foot = (turret.side_y(-2.80, .34, sign) * sign, .34)
        crown = (turret.side_y(-2.80, 2.28, sign) * sign, 2.28)
        turret.flank_ladder(sign, foot, crown, rails=(-3.00, -2.60), rungs=7)
        turret.grab_rail([(-3.05, 3.68), (-2.05, 3.92)], sign)
        turret.grab_rail([(2.20, 2.82), (1.20, 3.18), (.20, 3.54)], sign)

        # Toe blocks along the exposed sole, as on the approved model.
        for x, y in [(.70, 4.72), (1.51, 4.43), (2.32, 4.14)]:
            turret.put(box(name + '.sole-cleat', (x, sign * y, BASE + .05), (.20, .36, .12),
                           turret.painted, collection))

    # Centreline roof fittings: the after hatch, the training-sight hood and the
    # slim periscope mast standing beside it on the approved model.
    turret.roof_hatch(-3.10, 0, size=(.58, .48))
    seat = turret.top_z(-5.35, 0)
    turret.put(cyl(name + '.training-hood', (-5.35, 0, seat + .13), .34, .30, turret.naval, collection, 12, .26))
    turret.put(rod(name + '.periscope-mast', (-5.01, 0, turret.top_z(-5.01, 0) - .05), (-5.01, 0, 3.47),
                   .10, turret.painted, collection, vertices=8))

    # Steps on the sole under the gun ports.
    for y in (0, .86, -.86):
        turret.put(box(name + '.face-step', (4.76, y, BASE + .055), (.34, .10, .11),
                       turret.painted, collection))

    return turret.finish()
