"""Original 14 cm/50 3rd Year Type casemate mount, Nagato's secondary battery.

Proportions follow the approved GameModels3D Nagato (pjsb010) visual `jgs053_140mm_type3`, measured with
`ship:slice` cuts of the cached reference: a twelve-sided fixed seat 2.78 m across and 0.58 m tall, a
twelve-sided revolving drum 2.38 m across rising to 1.70 m, a tall front slot closed by a canvas curtain that
runs out to the barrel, two square sight ports on the facets beside the slot, the bore axis 0.96 m above the
seat and the muzzle 6.2 m ahead of the drum axis. No reference geometry is loaded here. The catalog owns the
weapon data; this recipe draws the seat, the drum and roof, the sight ports, the carriage and the sliding gun.

Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the seat sole.
"""
import bpy
import math
from mathutils import Matrix
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer

SEAT_R, SEAT_TOP = 1.39, .58      # fixed twelve-sided seat (circumradius, height)
DRUM_R, DRUM_TOP = 1.19, 1.70     # revolving drum (circumradius, roof plane)
WALL = .06                        # drum plating
SLOT = (.26, .66, 1.62)           # half width, sill and lintel of the gun slot
SLEEVE = .175                     # constant jacket radius carried through the canvas cuff
COLLAR = 3.0                      # cuff station, in mount coordinates


def create_mount(mount, col, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    palette = dict(materials)
    palette.setdefault('roof', palette['naval'])
    palette.setdefault('painted-edge', palette['edge'])
    palette.setdefault('glass', palette['dark'])
    naval, roof, edge, dark, painted, glass = (
        palette[k] for k in ['naval', 'roof', 'edge', 'dark', 'painted-edge', 'glass'])
    name = mount['id']
    spec = mount['weapon']

    def joint(suffix, parent=None, loc=(0, 0, 0)):
        node = bpy.data.objects.new(name + '.' + suffix, None)
        col.objects.link(node)
        node.location = loc
        node.parent = parent
        node['nodeId'] = node.name
        node['assemblyId'] = name
        return node

    base = joint('base')
    yaw = joint('yaw', base)

    def put(obj, parent=None):
        obj.parent = parent or yaw
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj['assemblyId'] = name
        return obj

    def polygon(r, n=12, phase=math.pi / 12):
        return [(r * math.cos(phase + math.tau * i / n), r * math.sin(phase + math.tau * i / n)) for i in range(n)]

    def ring_wall(label, outer, inner, z0, z1, material, parent, n=12, skip=()):
        """Twelve-sided plated wall between two heights; `skip` leaves facets open (index 0 faces +X... after
        the phase, facet i spans vertices i and i + 1)."""
        vv, ff = [], []
        po, pi = polygon(outer, n), polygon(inner, n)
        for i in range(n):
            if i in skip:
                continue
            j = (i + 1) % n
            k = len(vv)
            for x, y in (po[i], po[j], pi[j], pi[i]):
                vv.append((x, y, z0))
            for x, y in (po[i], po[j], pi[j], pi[i]):
                vv.append((x, y, z1))
            ff += [(k + 3, k + 2, k + 1, k), (k + 4, k + 5, k + 6, k + 7), (k, k + 1, k + 5, k + 4), (k + 1, k + 2, k + 6, k + 5),
                   (k + 2, k + 3, k + 7, k + 6), (k + 3, k, k + 4, k + 7)]
        return put(mesh(name + '.' + label, vv, ff, material, col), parent)

    def prism(label, pts, z0, z1, material, parent):
        n = len(pts)
        vv = [(x, y, z) for z in (z0, z1) for x, y in pts]
        ff = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, (i + 1) % n + n, i + n) for i in range(n)]
        return put(mesh(name + '.' + label, vv, ff, material, col), parent)

    # Fixed seat: a twelve-sided plated ring on the deck with a rolled top band and a riveted girth band,
    # open inside so the breech can dip into the well at full elevation.
    ring_wall('seat', SEAT_R, SEAT_R - .10, 0, SEAT_TOP - .05, naval, base)
    ring_wall('seat-top-band', SEAT_R + .015, SEAT_R - .16, SEAT_TOP - .05, SEAT_TOP, painted, base)
    ring_wall('seat-girth-band', SEAT_R + .012, SEAT_R - .02, .20, .30, painted, base)

    # Revolving drum on its roller race; facet 0 (centred on +X after the phase) carries the gun slot.
    ring_wall('roller-race', DRUM_R + .03, DRUM_R - .14, SEAT_TOP, SEAT_TOP + .04, edge, yaw)
    ring_wall('drum', DRUM_R, DRUM_R - WALL, SEAT_TOP + .04, DRUM_TOP, naval, yaw, skip=(11,))
    # The slot facet: jambs, sill and lintel round the gun slot (facet 11 spans -15..+15 degrees).
    apo = DRUM_R * math.cos(math.pi / 12)
    half_face = DRUM_R * math.sin(math.pi / 12)
    w, sill, lintel = SLOT
    for label, (y0, y1, z0, z1) in {'slot-jamb-port': (w, half_face, SEAT_TOP + .04, DRUM_TOP),
                                    'slot-jamb-starboard': (-half_face, -w, SEAT_TOP + .04, DRUM_TOP),
                                    'slot-sill': (-w, w, SEAT_TOP + .04, sill),
                                    'slot-lintel': (-w, w, lintel, DRUM_TOP)}.items():
        put(box(name + '.' + label, (apo - WALL / 2, (y0 + y1) / 2, (z0 + z1) / 2), (WALL, y1 - y0, z1 - z0), naval, col))
    # Roof plate with a slight overhang and a drip rim.
    prism('roof', polygon(DRUM_R + .025), DRUM_TOP, DRUM_TOP + .045, roof, yaw)
    ring_wall('roof-rim', DRUM_R + .03, DRUM_R - .01, DRUM_TOP - .03, DRUM_TOP + .005, painted, yaw)
    # Vertical stiffeners at the facet corners (the approved visual's panel joints).
    for x, y in polygon(DRUM_R + .012):
        if x > apo - .05:
            continue
        put(box(name + '.corner-strap', (x, y, (SEAT_TOP + DRUM_TOP) / 2 + .02), (.05, .05, DRUM_TOP - SEAT_TOP - .06), painted, col))
    # Two square sight ports on the facets beside the slot, each a framed dark aperture with its lid.
    for sign in (1, -1):
        a = sign * math.radians(30)
        cx, cy = (apo + .005) * math.cos(a), (apo + .005) * math.sin(a)
        frame = put(box(name + '.sight-port-frame', (cx, cy, 1.18), (.04, .40, .50), painted, col))
        frame.rotation_euler.z = a
        port = put(box(name + '.sight-port', (cx + .012 * math.cos(a), cy + .012 * math.sin(a), 1.18), (.03, .30, .40), dark, col))
        port.rotation_euler.z = a
        lens = put(rod(name + '.sight-lens', (cx + .02 * math.cos(a), cy + .02 * math.sin(a), 1.20),
                       (cx + .035 * math.cos(a), cy + .035 * math.sin(a), 1.20), .07, glass, col, vertices=12))
        lid = put(box(name + '.sight-lid', (cx + .10 * math.cos(a), cy + .10 * math.sin(a), 1.47), (.18, .40, .03), naval, col))
        lid.rotation_euler = (0, math.radians(-35), a)
    # Rear access door and a small ventilator on the roof.
    put(box(name + '.rear-door', (-apo - .01, 0, 1.12), (.03, .62, .92), painted, col))
    for z in (.84, 1.40):
        put(box(name + '.door-hinge', (-apo - .03, .30, z), (.04, .05, .12), edge, col))
    put(cyl(name + '.roof-vent', (-.45, .40, DRUM_TOP + .12), .12, .20, naval, col, 12))
    put(cyl(name + '.roof-vent-cap', (-.45, .40, DRUM_TOP + .235), .16, .03, painted, col, 12))

    # Carriage: a racer beam across the drum carries the trunnion standards; the training gear and a
    # ready-use rack stand against the drum wall.
    put(box(name + '.racer-beam', (0, 0, SEAT_TOP + .06), (.30, 2 * (DRUM_R - WALL / 2) * math.cos(math.pi / 12), .08), naval, col))
    for sign in (1, -1):
        put(box(name + '.trunnion-standard', (.02, sign * .36, (SEAT_TOP + .10 + spec['pivotHeight'] + .06) / 2),
                (.30, .14, spec['pivotHeight'] + .06 - SEAT_TOP - .10), naval, col))
        put(rod(name + '.trunnion-cap', (.02, sign * .22, spec['pivotHeight']), (.02, sign * .45, spec['pivotHeight']), .11, edge, col, vertices=12))
        put(cyl(name + '.elevating-handwheel', (-.12, sign * .445, .88), .12, .03, edge, col, 12)).rotation_euler.x = math.pi / 2
    put(box(name + '.training-gear', (-.20, -1.00, .82), (.30, .24, .34), edge, col))
    put(box(name + '.ready-rack', (-.92, .50, .94), (.34, .50, .40), naval, col))

    # Elevating mass: an eight-sided slide with recoil cylinders under it and the sliding gun. The breech
    # end stays within 0.7 m of the trunnions so the gun recoils and elevates inside the drum.
    length = spec['muzzleForward'] - spec['trunnionForward']
    bore = spec['caliberM'] / 2
    for side, y, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (spec['trunnionForward'], y, spec['pivotHeight']))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))

        def ring(x, r, count=16):
            return [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count)) for i in range(count)]

        def tube(label, profile, material, parent, count=16, smooth=True):
            points = [p for x, r in profile for p in ring(x, r, count)]
            faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                     for j in range(len(profile) - 1) for i in range(count)]
            return put(mesh(name + '.' + side + '.' + label, points, faces, material, col, smooth), parent)

        outer, inner = .25, .21
        stations = [(-.52, outer), (.62, outer)]
        points = [p for x, r in stations for p in ring(x, r, 8)]
        points += [p for x, r in stations for p in ring(x, inner, 8)]
        faces = [(i, (i + 1) % 8, 8 + (i + 1) % 8, 8 + i) for i in range(8)]
        faces += [(16 + i, 24 + i, 24 + (i + 1) % 8, 16 + (i + 1) % 8) for i in range(8)]
        faces += [(i, 16 + i, 16 + (i + 1) % 8, (i + 1) % 8) for i in range(8)]
        faces += [(8 + i, 8 + (i + 1) % 8, 24 + (i + 1) % 8, 24 + i) for i in range(8)]
        put(mesh(name + '.' + side + '.slide', points, faces, edge, col), elevation)
        put(box(name + '.' + side + '.slide-yoke', (0, 0, -.02), (.34, .50, .40), edge, col), elevation)
        for sy in (1, -1):
            put(rod(name + '.' + side + '.recoil-cylinder', (-.45, sy * .15, -.24), (.55, sy * .15, -.24), .065, edge, col, vertices=10), elevation)
        put(box(name + '.' + side + '.elevating-arc', (-.30, 0, -.34), (.22, .18, .14), edge, col), elevation)

        stroke = spec['recoilM']
        profile = [(-.62, .215), (-.30, .225), (.45, .205), (.80, .19), (1.05, SLEEVE), (COLLAR + stroke + .10, SLEEVE),
                   (COLLAR + stroke + .16, .165), (length - .12, .148)]
        tube('barrel', profile, edge, recoil)
        rim = [(length - .12, .148), (length - .05, .160), (length, .160), (length, bore), (length - .35, bore)]
        tube('muzzle-rim', rim, edge, recoil, smooth=False)
        put(box(name + '.' + side + '.breech', (-.52, 0, .06), (.30, .52, .56), edge, col), recoil)
        put(box(name + '.' + side + '.breech-block', (-.69, 0, .02), (.06, .40, .42), edge, col), recoil)
        put(rod(name + '.' + side + '.breech-lever', (-.71, .16, .08), (-.80, .32, -.06), .03, painted, col, vertices=6), recoil)

    # Canvas curtain over the slot: the seam runs round the slot on the front facet and returns over the roof
    # edge, as the approved visual's curtain does; the cuff rides the constant jacket through the recoil stroke.
    for side, y, _ in barrel_layout(spec):
        seam = []
        for i in range(20):
            a = i * math.tau / 20
            ca, sa = math.cos(a), math.sin(a)
            yy = y + (w + .05) * math.copysign(abs(ca) ** .55, ca)
            zz = 1.22 + .56 * math.copysign(abs(sa) ** .55, sa)
            x = apo + .03 if zz < DRUM_TOP else apo - .08 * (zz - DRUM_TOP) / .08
            seam.append((x, yy, min(zz, DRUM_TOP + .07)))
        create_bloomer(mount, col, helpers, palette, side, seam, COLLAR, SLEEVE + .014, rings=6, slack=.10,
                       fullness=.04, forward_fullness=.05)

    a, b, c = mount['position']
    base.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw
