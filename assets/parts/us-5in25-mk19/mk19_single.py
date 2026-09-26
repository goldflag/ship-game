"""Original 5-inch/25 Mk 19 single open anti-aircraft mount.

Visual proportions follow the approved GameModels3D visual `ags007_5in25_mk19_mod6`, which
Pensacola (pasc106, A_ATBA and B_ATBA) and New Orleans (pasc107, AB_ATBA) both fit at all eight
of their HP_AGS hardpoints. No reference geometry is loaded here: every piece below is authored
from measurements taken off that model, and README.md lists what was changed so the mount works.

Authoring frame: +X muzzle, +Y port, +Z up. The origin is the reference hardpoint, which is the
sole of the fixed stand, so the ship owns the deck under it. Nodes follow the shared barrel
contract: a fixed `<id>.base` (the stand that does not train), `<id>.yaw` (training platform,
carriage, crew stations and fuze setter), and `center.elevation`, `center.recoil` and
`center.muzzle`. The slide, loading tray, elevating arc and sights ride elevation; the gun, its
breech ring and lever ride recoil.
"""
import math
import bmesh
import bpy
from mathutils import Matrix, Vector

# Stand and platform (authoring metres).
STAND_FOOT = .699      # decagonal stand radius at the sole
STAND_TOP = .600       # and at the training race, under the platform
STAND_BORE = .46       # hollow stand: the breech end drops into it at high elevation
RACE = .207            # top of the fixed stand; the platform trains on it
REAR_DECK = .341       # after (low) working deck
FORE_DECK = .570       # forward (raised) deck the carriage and gunners stand on
WELL = (-.87, .46, .318)   # breech well through the platform: x from, x to, half width
CHEEK = (.320, .397)   # inner and outer faces of the carriage cheeks, both sides
ARC = (.580, .555)     # elevating arc tooth tip and root radii about the trunnion
PINION = -50.0         # world angle of the elevating pinion below the trunnion (degrees)
SIDE_BOX = -.095       # sight box moved outboard of the starboard cheek (y shift)


def _ear_clip(points):
    """Triangulate a simple 2D polygon of either winding; index triples in input order."""
    n = len(points)
    area = sum(points[i][0] * points[(i + 1) % n][1] - points[(i + 1) % n][0] * points[i][1] for i in range(n))
    ccw = area > 0
    idx = list(range(n))
    tris = []

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def inside(p, a, b, c):
        d1, d2, d3 = cross(a, b, p), cross(b, c, p), cross(c, a, p)
        neg = d1 < -1e-12 or d2 < -1e-12 or d3 < -1e-12
        pos = d1 > 1e-12 or d2 > 1e-12 or d3 > 1e-12
        return not (neg and pos)

    guard = 0
    while len(idx) > 3 and guard < 20000:
        guard += 1
        m = len(idx)
        for k in range(m):
            i0, i1, i2 = idx[(k - 1) % m], idx[k], idx[(k + 1) % m]
            a, b, c = points[i0], points[i1], points[i2]
            cr = cross(a, b, c)
            if (cr > 1e-12) != ccw or abs(cr) <= 1e-12:
                continue
            if any(inside(points[j], a, b, c) for j in idx if j not in (i0, i1, i2)):
                continue
            tris.append((i0, i1, i2))
            idx.pop(k)
            break
        else:
            break
    if len(idx) == 3:
        tris.append(tuple(idx))
    if not ccw:
        tris = [(a, c, b) for a, b, c in tris]
    return tris


class _Kit:
    """Primitives authored in rest-pose mount coordinates; `frame` picks the parent node and
    converts to its local frame ('base', 'yaw', 'elev' or 'recoil')."""

    def __init__(self, mount, col, helpers, materials):
        self.mesh = helpers['mesh']
        palette = dict(materials)
        for role, fallback in [('roof', 'naval'), ('painted-edge', 'edge'), ('glass', 'dark'),
                               ('bright', 'edge'), ('hullgray', 'naval')]:
            palette.setdefault(role, palette[fallback])
        self.m = palette
        self.col = col
        self.name = mount['id']
        spec = self.spec = mount['weapon']
        self.T, self.P = spec['trunnionForward'], spec['pivotHeight']
        x, y, z = mount['position']
        self.base = self.joint('base', None, (-z, -x, y))
        self.yaw = self.joint('yaw', self.base)
        self.yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
        # One barrel: its elevation joint is the trunnion on the bore axis.
        self.elevation = self.joint('center.elevation', self.yaw, (self.T, 0, self.P))
        self.elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        self.recoil = self.joint('center.recoil', self.elevation)
        self.joint('center.muzzle', self.recoil, (spec['muzzleForward'] - self.T, 0, 0))
        self.frames = {'base': (self.base, (0, 0, 0)), 'yaw': (self.yaw, (0, 0, 0)),
                       'elev': (self.elevation, (self.T, 0, self.P)), 'recoil': (self.recoil, (self.T, 0, self.P))}

    def joint(self, suffix, parent=None, loc=(0, 0, 0)):
        node = bpy.data.objects.new(self.name + '.' + suffix, None)
        self.col.objects.link(node)
        node.location = loc
        node.parent = parent
        node['nodeId'] = node.name
        node['assemblyId'] = self.name
        return node

    # ---- mesh creation -------------------------------------------------------------------
    def solid(self, label, verts, faces, material, frame='yaw', smooth=False, roof=False):
        parent, (ox, oy, oz) = self.frames[frame]
        local = [(x - ox, y - oy, z - oz) for x, y, z in verts]
        obj = self.mesh(self.name + '.' + label, local, faces, self.m[material], self.col, smooth)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(obj.data)
        bm.free()
        obj.data.update()
        if roof:
            # Walkway tops take the deck finish; sides keep the mount paint.
            obj.data.materials.append(self.m['roof'])
            for polygon in obj.data.polygons:
                polygon.material_index = 1 if polygon.normal.z > .9 else 0
        if smooth:
            for polygon in obj.data.polygons:
                polygon.use_smooth = len(polygon.vertices) == 4
        obj.parent = parent
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj['assemblyId'] = self.name
        return obj

    def loft(self, label, rings, material, frame='yaw', caps=(True, True), closed=True, smooth=False):
        n = len(rings[0])
        verts = [tuple(p) for ring in rings for p in ring]
        span = n if closed else n - 1
        faces = [(j * n + i, j * n + (i + 1) % n, (j + 1) * n + (i + 1) % n, (j + 1) * n + i)
                 for j in range(len(rings) - 1) for i in range(span)]
        if caps[0]:
            faces.append(tuple(range(n)))
        if caps[1]:
            faces.append(tuple(range(len(verts) - n, len(verts))))
        return self.solid(label, verts, faces, material, frame, smooth)

    def prism(self, label, outline, a0, a1, axis, material, frame='yaw', roof=False):
        """Extrude a 2D outline between a0 and a1 along `axis`: 'y' takes (x, z), 'x' takes (y, z),
        'z' takes (x, y). Concave outlines are ear-clipped."""
        def p(u, v, a):
            return {'y': (u, a, v), 'x': (a, u, v), 'z': (u, v, a)}[axis]
        n = len(outline)
        verts = [p(u, v, a0) for u, v in outline] + [p(u, v, a1) for u, v in outline]
        faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
        for t in _ear_clip(outline):
            faces.append(t)
            faces.append(tuple(n + i for i in reversed(t)))
        return self.solid(label, verts, faces, material, frame, roof=roof)

    def box(self, label, center, size, material, frame='yaw', rot=None, roof=False):
        cx, cy, cz = center
        sx, sy, sz = (v / 2 for v in size)
        verts = [(dx * sx, dy * sy, dz * sz) for dz in (-1, 1) for dy in (-1, 1) for dx in (-1, 1)]
        if rot:
            from mathutils import Euler
            m = Euler([math.radians(a) for a in rot]).to_matrix()
            verts = [tuple(m @ Vector(v)) for v in verts]
        verts = [(cx + x, cy + y, cz + z) for x, y, z in verts]
        faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
        return self.solid(label, verts, faces, material, frame, roof=roof)

    def rod(self, label, a, b, r, material, frame='yaw', n=8, r2=None, phase=0.0, smooth=False):
        """Capped tube from a to b with n sides."""
        a, b = Vector(a), Vector(b)
        d = b - a
        if d.length < 1e-6:
            return None
        d.normalize()
        # A stable side vector: horizontal where possible, so polygon faces line up with decks.
        u = d.cross(Vector((0, 0, 1)))
        if u.length < 1e-6:
            u = d.cross(Vector((0, 1, 0)))
        u.normalize()
        w = d.cross(u)
        r2 = r if r2 is None else r2

        def ring(c, rr):
            return [tuple(c + (u * math.cos(math.tau * i / n + phase) + w * math.sin(math.tau * i / n + phase)) * rr)
                    for i in range(n)]
        verts = ring(a, r) + ring(b, r2)
        faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
        faces += [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
        return self.solid(label, verts, faces, material, frame, smooth)

    def path(self, label, points, r, material, frame='yaw', n=4):
        """Bent tube through points, one closed mesh. At each bend the section lies in the
        bisecting plane and is stretched across the bend so the tube keeps its width."""
        pts = [Vector(p) for p in points]
        rings = []
        prev = None
        for i, c in enumerate(pts):
            d1 = (pts[i] - pts[i - 1]).normalized() if i > 0 else None
            d2 = (pts[i + 1] - pts[i]).normalized() if i < len(pts) - 1 else None
            t = (d1 + d2).normalized() if d1 is not None and d2 is not None else (d1 if d2 is None else d2)
            if prev is None:
                u = t.cross(Vector((0, 0, 1)))
                if u.length < 1e-6:
                    u = t.cross(Vector((0, 1, 0)))
                u.normalize()
            else:
                u = (prev - t * prev.dot(t)).normalized()
            prev = u
            w = t.cross(u)
            bend, stretch = None, 1.0
            if d1 is not None and d2 is not None and (d2 - d1).length > 1e-6:
                bend = (d2 - d1).normalized()
                stretch = 1 / max(.2, d1.dot(t))
            ring = []
            for k in range(n):
                ang = math.tau * k / n + math.pi / n
                offset = u * math.cos(ang) * r + w * math.sin(ang) * r
                if bend is not None:
                    offset = offset + bend * offset.dot(bend) * (stretch - 1)
                ring.append(tuple(c + offset))
            rings.append(ring)
        return self.loft(label, rings, material, frame)

    def lathe(self, label, profile, material, frame='yaw', n=12, axis='x', center=(0, 0, 0), smooth=False,
              caps=(True, True), phase=0.0, closed_profile=False):
        """Surface of revolution about a line parallel to `axis` through `center`; profile is
        (along, radius). A closed profile (an annulus section) wraps back to its first ring."""
        cx, cy, cz = center
        rings = []
        for s, r in profile:
            ring = []
            for i in range(n):
                ang = math.tau * i / n + phase
                c, sn = r * math.cos(ang), r * math.sin(ang)
                ring.append({'x': (cx + s, cy + c, cz + sn), 'y': (cx + c, cy + s, cz + sn),
                             'z': (cx + c, cy + sn, cz + s)}[axis])
            rings.append(ring)
        if not closed_profile:
            return self.loft(label, rings, material, frame, caps=caps, smooth=smooth)
        m = len(rings)
        verts = [p for ring in rings for p in ring]
        faces = [(j * n + i, j * n + (i + 1) % n, ((j + 1) % m) * n + (i + 1) % n, ((j + 1) % m) * n + i)
                 for j in range(m) for i in range(n)]
        return self.solid(label, verts, faces, material, frame, smooth)

    def wheel(self, label, center, r, tube, material, frame='yaw', n=12, spokes=3, hub=.03):
        """Handwheel in the XZ plane (axis along Y): low-poly rim with spokes and a hub."""
        cx, cy, cz = center
        rings = []
        for i in range(n):
            a = math.tau * i / n
            pts = []
            for j in range(3):
                b = math.tau * j / 3
                rr = r + tube * math.cos(b)
                pts.append((cx + rr * math.cos(a), cy + tube * math.sin(b), cz + rr * math.sin(a)))
            rings.append(pts)
        verts = [p for ring in rings for p in ring]
        faces = [(i * 3 + j, ((i + 1) % n) * 3 + j, ((i + 1) % n) * 3 + (j + 1) % 3, i * 3 + (j + 1) % 3)
                 for i in range(n) for j in range(3)]
        self.solid(label, verts, faces, material, frame)
        for k in range(spokes):
            a = math.tau * k / spokes + math.pi / 2
            end = (cx + r * math.cos(a), cy, cz + r * math.sin(a))
            self.rod(label + '-spoke', (cx, cy, cz), end, tube * .7, material, frame, n=4)
        self.rod(label + '-hub', (cx, cy - .018, cz), (cx, cy + .018, cz), hub, material, frame, n=6)


def create_mount(mount, col, helpers, materials):
    k = _Kit(mount, col, helpers, materials)
    s = k.spec
    T, P = k.T, k.P
    N, R, E, PE, D, G = 'naval', 'roof', 'edge', 'painted-edge', 'dark', 'glass'

    # ==================================================================== fixed stand (base)
    # Decagonal pedestal with a vertex forward, hollow so the breech end can drop into it,
    # a foundation plate closing the bore at the sole, and the training race it turns on.
    k.lathe('stand', [(0.0, STAND_BORE), (0.0, STAND_FOOT), (.180, STAND_FOOT - (STAND_FOOT - STAND_TOP) * .180 / RACE),
                      (.180, STAND_BORE)], N, 'base', n=10, axis='z', closed_profile=True)
    k.lathe('stand.race', [(.180, .470), (.180, .606), (RACE, STAND_TOP), (RACE, .470)], E, 'base',
            n=10, axis='z', closed_profile=True)
    k.lathe('stand.foundation-plate', [(0.0, STAND_BORE + .005), (.012, STAND_BORE + .005)], N, 'base', n=10, axis='z')

    # ==================================================================== training platform
    # Low after deck with the reference's slot at the after edge and its chamfered starboard
    # corner, raised forward deck, and a breech well cut through both between the cheeks.
    x0, x1, hw = WELL
    rear = [(-.132, 1.448), (-1.621, 1.448), (-1.746, .168), (-1.053, .168), (-1.053, -.141), (-1.746, -.141),
            (-1.376, -1.248), (-.702, -1.435), (-.132, -1.435), (-.132, -hw), (x0, -hw), (x0, hw), (-.132, hw)]
    k.prism('platform.after-deck', rear, RACE, REAR_DECK, 'z', N, roof=True)
    fore = [(.613, 1.448), (-.132, 1.448), (-.132, hw), (x1, hw), (x1, -hw), (-.132, -hw), (-.132, -1.435),
            (.613, -1.435)]
    k.prism('platform.fore-deck', fore, RACE, FORE_DECK, 'z', N, roof=True)
    # Well coaming: a lip round the breech well on the after deck.
    k.path('platform.well-coaming', [(-.132, -hw - .03, REAR_DECK + .012), (x0 - .04, -hw - .03, REAR_DECK + .012),
                                     (x0 - .04, hw + .03, REAR_DECK + .012), (-.132, hw + .03, REAR_DECK + .012)],
           .018, PE, n=4)
    # Forward locker on the platform's front edge, under the gun, narrowing forward.
    k.loft('front-locker', [[(.613, -.239, RACE), (.613, .307, RACE), (.613, .307, .948), (.613, -.239, .948)],
                            [(.795, -.158, RACE), (.795, .225, RACE), (.795, .225, .867), (.795, -.158, .867)]], N)
    k.rod('front-locker.handle', (.800, -.10, .72), (.800, .16, .72), .014, E, n=6)

    # ==================================================================== carriage
    # Each side frame is the reference's sloping wedge base with the triangular cheek standing
    # on it and the trunnion head at its apex. The reference joins the wedges across the
    # middle; here the space between the frames stays open to the well so the slide can swing
    # its breech end down at full elevation.
    head = [(.125 * math.cos(math.radians(a)), P + .125 * math.sin(math.radians(a))) for a in range(30, 111, 16)]
    cheek = ([(-.321, REAR_DECK), (-.132, REAR_DECK), (-.132, FORE_DECK), (.613, FORE_DECK), (.613, 1.081)] + head
             + [(-.219, 1.764), (-.300, 1.643), (-.295, 1.496), (.086, 1.034), (.086, .846)])
    for sy in (1, -1):
        k.prism('carriage.cheek', cheek, sy * CHEEK[0], sy * CHEEK[1], 'y', N)
        # Trunnion bearing cap and its bolts on the outer face.
        k.rod('carriage.trunnion-cap', (T, sy * CHEEK[1], P), (T, sy * (CHEEK[1] + .025), P), .100, E, n=10)
        k.rod('carriage.trunnion-hub', (T, sy * (CHEEK[1] + .025), P), (T, sy * (CHEEK[1] + .040), P), .045, E, n=8)
        for i in range(4):
            a = math.tau * (i + .5) / 4
            k.rod('carriage.cap-bolt', (T + .075 * math.cos(a), sy * (CHEEK[1] + .025), P + .075 * math.sin(a)),
                  (T + .075 * math.cos(a), sy * (CHEEK[1] + .034), P + .075 * math.sin(a)), .012, E, n=4)
    # Front web joining the cheeks ahead of the well.
    k.prism('carriage.front-web', [(.470, FORE_DECK), (.613, FORE_DECK), (.613, 1.081), (.470, 1.068)],
            -CHEEK[0], CHEEK[0], 'y', N)
    # Elevating gear case on the web, its pinion reaching back to the arc, and the cross shaft
    # that couples the pointer's and trainer's gearing through it.
    k.prism('carriage.elevating-gear-case', [(.43, 1.19), (.47, 1.070), (.613, 1.081), (.70, 1.20), (.71, 1.31),
                                             (.60, 1.44), (.49, 1.34)], -.05, .05, 'y', N)
    pr = .050
    reach = ARC[0] + pr + .006
    px, pz = reach * math.cos(math.radians(PINION)), P + reach * math.sin(math.radians(PINION))
    k.rod('carriage.elevating-pinion', (px, -.045, pz), (px, .045, pz), pr, E, n=12)
    k.rod('carriage.pinion-boss', (px, -.058, pz), (px, .058, pz), .022, E, n=6)
    k.rod('carriage.cross-shaft', (.532, -.860, 1.280), (.532, .860, 1.280), .045, E, n=8)

    # ==================================================================== gunners' stations
    # Pointer to port, trainer to starboard: leaning pedestal, indicator drum with a handwheel
    # either side, the arm down to the cross shaft, seat on its arm, and the drive housings.
    for sy in (1, -1):
        y = sy * .822
        k.rod('station.pedestal', (.328, y, FORE_DECK - .02), (.593, y, 1.51), .064, N, n=8)
        k.box('station.pedestal-foot', (.328, y, FORE_DECK + .012), (.20, .20, .024), N)
        # Indicator drum and its two handwheels on one shaft; each wheel's crank handle points
        # away from the drum.
        k.rod('station.indicator-drum', (.133, sy * .714, 1.552), (.133, sy * .907, 1.552), .089, N, n=8)
        k.rod('station.handwheel-shaft', (.132, sy * .655, 1.552), (.132, sy * .965, 1.552), .020, E, n=6)
        for yy, h, deg in ((.6795, -1, 231), (.9425, 1, 50)):
            k.wheel('station.handwheel', (.132, sy * yy, 1.552), .112, .012, PE, n=12, spokes=3, hub=.030)
            a = math.radians(deg)
            gx, gz = .132 + .112 * math.cos(a), 1.552 + .112 * math.sin(a)
            k.rod('station.crank-handle', (gx, sy * yy, gz), (gx, sy * (yy + h * .085), gz), .012, E, n=6)
        k.box('station.indicator-dial', (.133, sy * .810, 1.641), (.10, .10, .016), G)
        # Arm from the drum down to the pedestal head, and the indicator box on the cross shaft.
        k.path('station.arm', [(.170, y, 1.500), (.360, y, 1.390), (.535, y, 1.280)], .034, N, n=4)
        k.box('station.gear-box', (.535, sy * .670, 1.281), (.066, .390, .066), N)
        # Seat: tractor pan, post and the arm that carries it from the pedestal.
        pan = [(-.315, sy * .741), (-.235, sy * .685), (.012, sy * .778), (.012, sy * .845), (-.235, sy * .939),
               (-.315, sy * .884)]
        k.prism('station.seat', pan, 1.171, 1.214, 'z', PE)
        k.rod('station.seat-post', (-.178, y, .878), (-.178, y, 1.175), .021, PE, n=6)
        k.rod('station.seat-arm', (-.219, y, 1.062), (.450, y, 1.062), .030, PE, n=6)
        # Front guard rail round the forward corner.
        rail = [(.279, sy * 1.412, 1.600), (.586, sy * 1.412, 1.600), (.586, sy * 1.057, 1.600)]
        for px_, py_, _ in rail:
            k.rod('rail.post', (px_, py_, FORE_DECK), (px_, py_, 1.600), .022, PE, n=6)
        k.path('rail', rail, .022, PE, n=6)

    # Starboard (training) drive: leaning housing from the deck and the gear box on the shaft.
    k.rod('training-drive.housing', (.481, -.525, FORE_DECK - .02), (.842, -.525, 1.087), .090, N, n=6)
    k.box('training-drive.gear-box', (.5755, -.527, 1.179), (.448, .260, .382), N, rot=(0, 35.0, 0))
    # Port (elevating) drive: slanted block from the deck, the gear box above it and the motor.
    k.prism('elevating-drive.base', [(.523, .572), (.696, .570), (.781, .612), (.962, .869), (.723, 1.035),
                                     (.523, .751)], .399, .630, 'y', N)
    k.prism('elevating-drive.gear-box', [(.419, 1.250), (.723, 1.035), (.852, 1.218), (.547, 1.433)],
            .399, .630, 'y', N)
    k.box('elevating-drive.motor', (.8638, .5275, 1.040), (.232, .169, .178), N, rot=(0, 35.0, 0))

    # ==================================================================== fuze setter (port aft)
    fx0, fx1, fy0, fy1 = -1.566, -.681, 1.200, 1.444
    k.box('fuze-setter.case', ((fx0 + fx1) / 2, (fy0 + fy1) / 2, (REAR_DECK + 1.008) / 2),
          (fx1 - fx0, fy1 - fy0, 1.008 - REAR_DECK), N)
    for a, b in ((-1.566, -1.485), (-.762, -.681)):
        k.box('fuze-setter.end-post', ((a + b) / 2, (fy0 + fy1) / 2, 1.1595), (b - a, fy1 - fy0, .303), N)
    for xc in (-1.2695, -.9755):
        k.prism('fuze-setter.divider', [(xc - .0415, 1.008), (xc + .0415, 1.008), (xc + .0415, 1.240), (xc + .0815, 1.311),
                                        (xc - .0815, 1.311), (xc - .0415, 1.240)], 1.254, 1.389, 'y', N)
    for xc in (-1.419, -1.121, -.827):
        # Setter pot between the dividers, its dark mouth, and the setting crank on the outboard face.
        k.rod('fuze-setter.pot', (xc, 1.3215, 1.008), (xc, 1.3215, 1.052), .070, N, n=6)
        k.rod('fuze-setter.pot-mouth', (xc, 1.3215, 1.052), (xc, 1.3215, 1.056), .052, D, n=6)
        k.rod('fuze-setter.crank-boss', (xc, 1.443, .884), (xc, 1.506, .884), .1125, N, n=6)
        k.rod('fuze-setter.crank-hub', (xc, 1.444, .884), (xc, 1.512, .884), .030, E, n=6)
    # Indicator tower at the forward end, with its ridged hood and a dial on the inboard face.
    k.prism('fuze-setter.tower', [(-.681, .716), (-.570, .808), (-.570, 1.311), (-.435, 1.311), (-.435, 1.580),
                                  (-.681, 1.580)], fy0, fy1, 'y', N)
    k.prism('fuze-setter.hood', [(fy0, 1.580), (fy1, 1.580), (1.376, 1.648), (1.269, 1.648)], -.681, -.435, 'x', N)
    k.rod('fuze-setter.dial', (-.51, fy0 + .002, 1.45), (-.51, fy0 - .010, 1.45), .060, G, n=12)
    # Loader's step seat on the forward deck, port side.
    k.rod('loader-seat.post', (.026, 1.323, FORE_DECK), (.026, 1.323, .722), .045, PE, n=6)
    seat = [(-.137, 1.116), (-.107, 1.095), (0.0, 1.103), (.117, 1.155), (.189, 1.280), (.189, 1.363), (.117, 1.490),
            (0.0, 1.542), (-.107, 1.550), (-.137, 1.528)]
    k.prism('loader-seat.pan', seat, .718, .758, 'z', PE)

    # ==================================================================== slide (elevation)
    # Front block round the chase, the tall rammer housing to starboard, and the loading tray to
    # port: a trough whose floor clears the recoiling gun and whose outer wall keeps the
    # reference's sloping top.
    k.box('slide.front-block', ((-.107 + .283) / 2, 0, (1.448 + 2.087) / 2), (.390, .620, 2.087 - 1.448), N, 'elev')
    under = [(-1.49, 1.542), (-1.300, 1.203), (-1.113, 1.203), (-1.113, 1.448), (-.107, 1.448)]
    k.prism('slide.rammer-housing', [(-.107, 2.087), (-.317, 2.178), (-1.49, 2.178)] + under, -.310, -.078, 'y', N, 'elev')
    k.prism('slide.tray-floor', [(-.107, 1.535), (-1.440, 1.535), (-1.490, 1.560)] + under, -.078, .250, 'y', N, 'elev')
    k.prism('slide.tray-wall', [(-.107, 1.932), (-1.490, 1.697)] + under, .250, .310, 'y', N, 'elev')
    k.box('slide.tray-lip', (-1.465, .086, 1.585), (.050, .328, .050), E, 'elev')
    # Rammer housing inspection cover.
    k.box('slide.housing-cover', (-.80, -.194, 2.183), (.90, .19, .012), E, 'elev')
    # Front collar the gun slides through, and the recoil cylinder above the chase.
    k.box('slide.collar', (.374, -.0565, 1.767), (.182, .507, .526), N, 'elev')
    k.rod('slide.recoil-cylinder', (.283, -.205, 1.886), (1.296, -.205, 1.886), .080, N, 'elev', n=10)
    k.rod('slide.cylinder-head', (1.296, -.205, 1.886), (1.320, -.205, 1.886), .060, E, 'elev', n=10)
    k.rod('slide.cylinder-band', (1.08, -.205, 1.886), (1.12, -.205, 1.886), .097, E, 'elev', n=10)
    # Trunnion pins (coaxial with the cheek bearings).
    for sy in (1, -1):
        k.rod('slide.trunnion-pin', (T, sy * .300, P), (T, sy * .398, P), .070, E, 'elev', n=8)
    # Toothed elevating arc about the trunnion, hung from the slide's underside.
    teeth = 22
    rim = []
    for i in range(teeth * 2 + 1):
        a = math.radians(-30 - 120 * i / (teeth * 2))
        rr = ARC[0] if i % 2 == 0 else ARC[1]
        rim.append((T + rr * math.cos(a), P + rr * math.sin(a)))
    arc = [(-.46, 1.460), (.283, 1.460), (.283, 1.504), (.460, 1.504)] + rim
    k.prism('slide.elevating-arc', arc, -.035, .035, 'y', E, 'elev')

    # Sight box outboard of the starboard cheek, carried by a bracket over the cheek head, with
    # the two dial heads on their stalks.
    dy = SIDE_BOX
    k.box('slide.sight-box', ((-.393 + .458) / 2, (-.427 - .310) / 2 + dy, (1.821 + 2.030) / 2),
          (.851, .117, .209), N, 'elev')
    k.box('slide.sight-box-bracket', (.275, -.360, 1.925), (.25, .105, .15), N, 'elev')
    k.rod('slide.sight-stalk', (.390, -.369 + dy, 2.020), (.390, -.369 + dy, 2.290), .038, N, 'elev', n=6)
    k.rod('slide.sight-stalk', (.248, -.369 + dy, 1.990), (.117, -.369 + dy, 2.240), .038, N, 'elev', n=6)
    for (x, z) in ((.0923, 2.2847), (.4015, 2.3425)):
        k.rod('slide.sight-head', (x, -.202 + dy, z), (x, -.514 + dy, z), .095, N, 'elev', n=10)
        k.rod('slide.sight-glass', (x, -.514 + dy, z), (x, -.520 + dy, z), .070, G, 'elev', n=10)
    # Ring-sight bar across the front of the collar, with the pointer's and trainer's
    # telescopes on posts at its outer ends.
    bar = [(.486, -.854, 1.768), (.486, -.510, 1.768), (.486, -.300, 1.997), (.486, .300, 1.997), (.486, .510, 1.768),
           (.486, .854, 1.768)]
    k.path('slide.sight-bar', bar, .040, PE, 'elev', n=4)
    for sy in (1, -1):
        y = sy * .822
        k.rod('slide.sight-post', (.490, y, 1.768), (.490, y, 1.930), .020, PE, 'elev', n=6)
        k.rod('slide.telescope', (.372, y, 1.960), (.605, y, 1.960), .040, E, 'elev', n=8)
        k.rod('slide.telescope-eyepiece', (.345, y, 1.960), (.372, y, 1.960), .030, D, 'elev', n=6)
        k.rod('slide.telescope-objective', (.605, y, 1.960), (.612, y, 1.960), .032, G, 'elev', n=6)
        k.box('slide.telescope-clamp', (.490, y, 1.925), (.06, .07, .03), PE, 'elev')

    # ==================================================================== gun (recoil)
    # Straight-tapered chase from the collar to the muzzle, breech ring riding in the tray with
    # its block and operating lever, dark bore.
    muzzle = s['muzzleForward']
    k.lathe('gun.barrel', [(-.107, .158), (.281, .158), (muzzle, .095)], N, 'recoil', n=16, axis='x',
            center=(0, 0, P), smooth=True)
    k.rod('gun.bore', (muzzle - .050, 0, P), (muzzle + .002, 0, P), .066, D, 'recoil', n=12)
    k.box('gun.breech-ring', (-.2535, 0, P), (.293, .300, .300), N, 'recoil')
    k.box('gun.breech-block', (-.412, .010, P), (.030, .230, .240), E, 'recoil')
    k.rod('gun.lever-pivot', (-.300, .150, 1.780), (-.300, .185, 1.780), .025, E, 'recoil', n=8)
    k.rod('gun.operating-lever', (-.300, .168, 1.780), (-.520, .200, 1.880), .016, E, 'recoil', n=6)
    k.rod('gun.lever-grip', (-.520, .185, 1.880), (-.520, .225, 1.880), .020, E, 'recoil', n=6)
    return k.yaw
