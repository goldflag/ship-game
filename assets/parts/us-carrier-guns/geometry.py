"""Original open US AA/DP mounts for USS Enterprise (CV-6), measured against GameModels3D only.

Three variants, each authored from sections and silhouettes of one GameModels3D visual (no
reference mesh is loaded, traced or shipped here):

- `create_five_inch`: 5-inch/38 Mk 24 open single mount (`AGS022_5in38_Mk24`, Enterprise `pasa518`).
- `create_quad`: 1.1-inch/75 Mk 2 Mod 2 quadruple mount (`AGA013_1in_Mk2_Mod2`, Pensacola `pasc106`).
- `create_oerlikon`: 20 mm Oerlikon Mk 4 single mount (`AGA003_20mm_Oerlikon_MK4`, Enterprise `pasa518`).

Authoring frame: +X muzzle, +Y port, +Z up; the origin is the reference hardpoint (the yaw
datum). Nodes follow the shared barrel contract: `<id>.yaw`, `<side>.elevation`,
`<side>.recoil`, `<side>.muzzle`, plus a fixed `<id>.base` for the stand that does not train.
Barrels ride recoil; slides, cradles, feeds and sights that elevate ride elevation; the
carriage, platform and crew stations train with yaw. The ship owns the deck, tub or sponson
under the stand.
"""
import math
import bmesh
import bpy
from mathutils import Matrix
from blender_barrels import barrel_layout


def _ear_clip(points):
    """Triangulate a simple 2D polygon (any winding). Returns index triples in input order."""
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
    while len(idx) > 3 and guard < 10000:
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
    def __init__(self, mount, col, helpers, materials):
        self.mesh, self.cyl, self.rod_h, self.box_h = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
        palette = dict(materials)
        palette.setdefault('roof', palette['naval'])
        palette.setdefault('painted-edge', palette['edge'])
        palette.setdefault('glass', palette['dark'])
        palette.setdefault('canvas', palette['naval'])
        self.m = palette
        self.col = col
        self.name = mount['id']
        self.mount = mount
        self.spec = mount['weapon']
        x, y, z = mount['position']
        self.base = self.joint('base', None, (-z, -x, y))
        self.yaw = self.joint('yaw', self.base)
        self.yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
        self.sides = {}
        s = self.spec
        for side, lateral, _ in barrel_layout(s):
            elevation = self.joint(side + '.elevation', self.yaw, (s['trunnionForward'], lateral, s['pivotHeight']))
            elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
            recoil = self.joint(side + '.recoil', elevation)
            self.joint(side + '.muzzle', recoil, (s['muzzleForward'] - s['trunnionForward'], 0, 0))
            self.sides[side] = (lateral, elevation, recoil)

    # ---- nodes and parenting
    def joint(self, suffix, parent=None, loc=(0, 0, 0)):
        node = bpy.data.objects.new(self.name + '.' + suffix, None)
        self.col.objects.link(node)
        node.location = loc
        node.parent = parent
        node['nodeId'] = node.name
        node['assemblyId'] = self.name
        return node

    def put(self, obj, parent=None):
        obj.parent = parent or self.yaw
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj['assemblyId'] = self.name
        return obj

    # ---- primitives (all in the parent's local frame)
    def solid(self, label, verts, faces, material, parent=None, smooth=False, recalc=True):
        obj = self.mesh(self.name + '.' + label, verts, faces, self.m[material], self.col, smooth)
        if recalc:
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            bm.to_mesh(obj.data)
            bm.free()
        return self.put(obj, parent)

    def loft(self, label, rings, material, parent=None, caps=(True, True), closed=True, smooth=False):
        n = len(rings[0])
        verts = [tuple(p) for ring in rings for p in ring]
        span = n if closed else n - 1
        faces = [(j * n + i, j * n + (i + 1) % n, (j + 1) * n + (i + 1) % n, (j + 1) * n + i)
                 for j in range(len(rings) - 1) for i in range(span)]
        if caps[0]:
            faces.append(tuple(range(n)))
        if caps[1]:
            faces.append(tuple(range(len(verts) - n, len(verts))))
        return self.solid(label, verts, faces, material, parent, smooth)

    def prism(self, label, outline, a0, a1, axis, material, parent=None):
        """Extrude a 2D outline between a0 and a1 along `axis`: 'y' takes (x, z), 'x' takes (y, z), 'z' takes (x, y).
        Concave outlines are ear-clipped so no cap fan invents overlaps."""
        def p(u, v, a):
            return {'y': (u, a, v), 'x': (a, u, v), 'z': (u, v, a)}[axis]
        n = len(outline)
        verts = [p(u, v, a0) for u, v in outline] + [p(u, v, a1) for u, v in outline]
        faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
        for t in _ear_clip(outline):
            faces.append(t)
            faces.append(tuple(n + i for i in reversed(t)))
        return self.solid(label, verts, faces, material, parent)

    def box(self, label, center, size, material, parent=None, rot=None):
        cx, cy, cz = center
        sx, sy, sz = (v / 2 for v in size)
        verts = [(cx + dx * sx, cy + dy * sy, cz + dz * sz) for dz in (-1, 1) for dy in (-1, 1) for dx in (-1, 1)]
        faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
        obj = self.solid(label, verts, faces, material, parent)
        if rot:
            self._rotate(obj, center, rot)
        return obj

    def _rotate(self, obj, pivot, rot):
        """Rotate mesh data about `pivot` by euler (rx, ry, rz) degrees (kept in the mesh, not the object)."""
        from mathutils import Euler, Vector
        m = Matrix.Translation(Vector(pivot)) @ Euler([math.radians(a) for a in rot]).to_matrix().to_4x4() @ Matrix.Translation(-Vector(pivot))
        obj.data.transform(m)

    def rod(self, label, a, b, r, material, parent=None, n=6, r2=None):
        """Capped tube from a to b (n sides), built directly as mesh data."""
        from mathutils import Vector
        a, b = Vector(a), Vector(b)
        d = (b - a)
        if d.length < 1e-6:
            return None
        d.normalize()
        u = d.orthogonal().normalized()
        w = d.cross(u)
        r2 = r if r2 is None else r2
        ring = lambda c, rr: [tuple(c + (u * math.cos(math.tau * i / n) + w * math.sin(math.tau * i / n)) * rr) for i in range(n)]
        verts = ring(a, r) + ring(b, r2)
        faces = [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)] + [tuple(reversed(range(n))), tuple(range(n, 2 * n))]
        return self.solid(label, verts, faces, material, parent)

    def path(self, label, points, r, material, parent=None, n=4):
        """Bent tube through points, one continuous mesh (mitred joints)."""
        from mathutils import Vector
        P = [Vector(p) for p in points]
        rings = []
        prev_u = None
        for i, c in enumerate(P):
            if i == 0:
                t = (P[1] - P[0]).normalized()
            elif i == len(P) - 1:
                t = (P[-1] - P[-2]).normalized()
            else:
                t = ((P[i] - P[i - 1]).normalized() + (P[i + 1] - P[i]).normalized()).normalized()
            u = t.orthogonal().normalized() if prev_u is None else (prev_u - t * prev_u.dot(t)).normalized()
            prev_u = u
            w = t.cross(u)
            rings.append([tuple(c + (u * math.cos(math.tau * k / n) + w * math.sin(math.tau * k / n)) * r) for k in range(n)])
        return self.loft(label, rings, material, parent)

    def cylinder(self, label, center, r, h, axis, material, parent=None, n=8, r2=None):
        cx, cy, cz = center
        d = {'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1)}[axis]
        a = (cx - d[0] * h / 2, cy - d[1] * h / 2, cz - d[2] * h / 2)
        b = (cx + d[0] * h / 2, cy + d[1] * h / 2, cz + d[2] * h / 2)
        return self.rod(label, a, b, r, material, parent, n, r2)

    def lathe(self, label, profile, material, parent=None, n=12, axis='x', center=(0, 0, 0), smooth=True, caps=(True, True)):
        """Surface of revolution about a line parallel to `axis` through `center`; profile is (along, radius)."""
        cx, cy, cz = center
        rings = []
        for s, r in profile:
            ring = []
            for i in range(n):
                c, sn = r * math.cos(math.tau * i / n), r * math.sin(math.tau * i / n)
                ring.append({'x': (cx + s, cy + c, cz + sn), 'y': (cx + c, cy + s, cz + sn), 'z': (cx + c, cy + sn, cz + s)}[axis])
            rings.append(ring)
        return self.loft(label, rings, material, parent, caps=caps, smooth=smooth)

    def ring(self, label, center, r, tube, axis, material, parent=None, n=10, spokes=0):
        """Low-poly torus (triangular section) for handwheels and ring sights, optional spokes."""
        cx, cy, cz = center
        rings = []
        for i in range(n):
            a = math.tau * i / n
            pts = []
            for j in range(3):
                b = math.tau * j / 3
                rr = r + tube * math.cos(b)
                q = (rr * math.cos(a), rr * math.sin(a), tube * math.sin(b))
                pts.append({'x': (cx + q[2], cy + q[0], cz + q[1]), 'y': (cx + q[0], cy + q[2], cz + q[1]), 'z': (cx + q[0], cy + q[1], cz + q[2])}[axis])
            rings.append(pts)
        verts = [p for rr in rings for p in rr]
        faces = [(i * 3 + j, ((i + 1) % n) * 3 + j, ((i + 1) % n) * 3 + (j + 1) % 3, i * 3 + (j + 1) % 3) for i in range(n) for j in range(3)]
        obj = self.solid(label, verts, faces, material, parent, smooth=True)
        for k in range(spokes):
            a = math.tau * k / spokes + .3
            q = (r * math.cos(a), r * math.sin(a), 0)
            end = {'x': (cx, cy + q[0], cz + q[1]), 'y': (cx + q[0], cy, cz + q[1]), 'z': (cx + q[0], cy + q[1], cz)}[axis]
            self.rod(label + '-spoke', center, end, tube * .8, material, parent, n=3)
        return obj


# ---------------------------------------------------------------------------------------------
# 5-inch/38 Mk 24 open single mount
# ---------------------------------------------------------------------------------------------
def create_five_inch(mount, col, helpers, materials):
    """5-inch/38 Mk 24: hollow stand, stepped crew platform, twin carriage brackets, starboard
    elevating-arc housing, long slide with rammer housing and loading tray, pointer's and
    trainer's stations with telescopes, handwheels and seats, fuze-setter table, guard rails
    and the slide-mounted open ring-sight bar."""
    k = _Kit(mount, col, helpers, materials)
    s = k.spec
    T, P = s['trunnionForward'], s['pivotHeight']
    N, E, PE = 'naval', 'edge', 'painted-edge'

    # Fixed stand: foot flange, hollow drum, top flange (the slide's breech end descends into it).
    k.lathe('stand', [(0.0, .56), (0.0, .74), (.05, .74), (.07, .64), (.19, .64), (.21, .72), (.24, .72), (.24, .56), (0.0, .56)],
            N, k.base, n=16, axis='z', smooth=False, caps=(False, False))
    # Training ring and the carriage bed (an annulus: the pit stays open inside it).
    k.lathe('training-ring', [(.24, .56), (.24, .73), (.31, .73), (.31, .56), (.24, .56)], E, n=16, axis='z', smooth=False,
            caps=(False, False))
    for sy in (-1, 1):
        k.box('bed-rail', (.10, sy * .50, .34), (1.10, .14, .08), N)

    # Crew platform: low aft deck (with a trough down the middle) and raised side decks forward.
    aft = [(-2.03, -.68), (-1.86, -1.04), (-1.64, -1.26), (-1.32, -1.36), (-.10, -1.36), (-.10, -.44), (-.85, -.44),
           (-.85, .44), (-.10, .44), (-.10, 1.36), (-1.32, 1.36), (-1.64, 1.26), (-1.86, 1.04), (-2.03, .68)]
    k.prism('aft-deck', aft, .44, .52, 'z', N)
    for sy in (-1, 1):
        side = [(-.10, sy * .44), (1.18, sy * .44), (1.18, sy * 1.36), (-.10, sy * 1.36)]
        k.prism('side-deck', side, .66, .72, 'z', N)
        # Skirt plates under the side decks, chamfered in at the bottom.
        k.prism('side-deck.skirt', [(sy * .44, .42), (sy * 1.30, .45), (sy * 1.36, .56), (sy * 1.36, .66), (sy * .44, .66)],
                -.10, 1.18, 'x', N)
        # Webs from the carriage bed out under the aft deck.
        for x in (-1.15, -.55):
            k.box('aft-deck.web', (x, sy * .9, .40), (.08, .90, .10), N)
        k.box('aft-deck.skirt', (-1.05, sy * 1.33, .47), (1.1, .05, .10), N)
    k.box('aft-deck.rear-skirt', (-2.0, 0, .45), (.06, 1.5, .12), N)
    k.prism('aft-deck.trough', [(-2.0, -.44), (-.85, -.44), (-.85, .44), (-2.0, .44)], .40, .46, 'z', N)
    # Keel under the trough: rises from the rear edge, then drops into the pit.
    k.prism('aft-deck.keel', [(-2.03, .22), (-1.22, .38), (-.85, .30), (-.85, .41), (-2.03, .41)], -.10, .10, 'y', N)
    # Training motor slung under the starboard deck.
    k.cylinder('training-motor', (-.58, -1.02, .24), .12, .30, 'x', N, n=8)
    k.box('training-motor.bracket', (-.58, -1.02, .38), (.18, .16, .14), N)
    k.box('training-motor.gearcase', (.78, -.78, .24), (.24, .20, .22), N)
    k.box('training-motor.gearcase-hanger', (.78, -.78, .45), (.12, .12, .22), N)

    # Carriage: two brackets carrying the trunnions, joined by a front web plate.
    bracket = [(-.12, .30), (.62, .30), (.62, .42), (.50, .48), (.50, 1.40), (.45, 1.50), (.18, 1.97), (.02, 2.10),
               (-.18, 2.10), (-.31, 1.96), (-.33, 1.80), (-.28, 1.56), (-.06, 1.22), (-.06, .60), (-.12, .54)]
    for sy in (-1, 1):
        k.prism('carriage.bracket', bracket, sy * .33, sy * .45, 'y', N)
        k.cylinder('carriage.trunnion-cap', (T, sy * .47, P), .15, .06, 'y', E, n=10)
        k.box('carriage.bracket-foot', (.25, sy * .40, .36), (.74, .14, .10), N)
    k.box('carriage.front-web', (.465, 0, .80), (.07, .66, 1.00), N)
    k.box('carriage.web-cap', (.47, 0, 1.33), (.12, .90, .08), N)
    # Starboard elevating-arc housing round the trunnion, and its gear case.
    k.cylinder('carriage.elevating-arc', (T, -.50, P), .475, .12, 'y', N, n=16)
    k.cylinder('carriage.arc-hub', (T, -.59, P), .16, .06, 'y', E, n=10)
    k.box('carriage.arc-gearbox', (-.42, -.52, 1.46), (.20, .16, .30), N, rot=(0, 35, 0))
    # Cross shaft linking the pointer's and trainer's handwheels under the gun.
    k.rod('carriage.cross-shaft', (.58, -.62, 1.25), (.58, 1.03, 1.25), .05, E, n=6)
    for y in (-.52, .52):
        k.box('carriage.shaft-bearing', (.58, y, 1.25), (.14, .10, .16), N)

    # Pointer (port) and trainer (starboard) stations.
    for sy in (-1, 1):
        # Tall sight/indicator housing with the telescope and eyepiece.
        k.box('station.sight-housing', (.77, sy * .86, 1.42), (.46, .28, .74), N)
        k.box('station.sight-hood', (.80, sy * .86, 1.81), (.36, .22, .06), N)
        # Sight head raised on the housing: telescope box, inclined eyepiece arm and the telescope tube.
        k.box('station.sight-head', (.72, sy * .70, 1.97), (.34, .20, .22), N)
        k.box('station.eyepiece-arm', (.62, sy * .80, 2.06), (.36, .10, .10), E, rot=(0, 28, 0))
        k.cylinder('station.eyepiece', (.46, sy * .80, 2.15), .055, .06, 'x', 'dark', n=8)
        k.rod('station.telescope', (.55, sy * .64, 1.88), (1.08, sy * .64, 1.88), .05, E, n=8)
        k.box('station.telescope-bracket', (.77, sy * .70, 1.83), (.20, .16, .08), N)
        k.box('station.indicator', (.45, sy * .81, 1.26), (.46, .32, .40), N)
        k.box('station.front-case', (.97, sy * .72, 1.06), (.24, .58, .30), N)
        # Handwheel on the indicator.
        k.rod('station.handwheel-shaft', (.40, sy * .96, 1.20), (.40, sy * 1.06, 1.20), .025, E, n=6)
        k.ring('station.handwheel', (.40, sy * 1.07, 1.20), .15, .018, 'y', PE, n=12, spokes=3)
        # Seat: pan and back on a post; side plates on the port seat frame.
        k.rod('station.seat-post', (.22, sy * .72, .72), (.22, sy * .72, .88), .035, N, n=6)
        k.box('station.seat', (.22, sy * .72, .91), (.32, .30, .06), PE)
        k.box('station.seat-back', (.05, sy * .72, 1.06), (.05, .28, .30), PE, rot=(0, -12, 0))
        k.box('station.footrest', (.62, sy * .72, .745), (.12, .26, .05), PE)
    k.box('station.foot-box', (1.01, .50, .86), (.26, .34, .28), N)
    # Guard rails: along the port deck edge on outriggers, the starboard edge, and the open fronts.
    port = [(-.50, 1.52), (.92, 1.52), (1.08, 1.36), (1.08, 1.00)]
    stbd = [(-.05, -1.34), (.95, -1.34), (1.08, -1.20), (1.08, -1.00)]
    for pts in (port, stbd):
        for x, y in pts:
            z0 = .72 if x > -.1 else .52
            k.rod('rail.post', (x, y, z0), (x, y, 1.72), .022, PE, n=4)
        for h in (1.12, 1.72):
            k.path('rail', [(x, y, h) for x, y in pts], .02, PE)
    for x in (-.50, .92):
        k.rod('rail.outrigger', (x, 1.30, .60 if x < -.1 else .70), (x, 1.54, .60 if x < -.1 else .70), .03, PE, n=4)
    k.rod('rail.post', (-.50, 1.52, .52), (-.50, 1.52, .60), .022, PE, n=4)
    # Boarding rail hanging off the port deck edge.
    k.path('boarding-rail', [(.30, 1.36, .70), (.30, 1.62, .66), (.30, 1.64, .45), (-.30, 1.64, .45), (-.30, 1.62, .66),
                             (-.30, 1.36, .70)], .02, PE)

    # Fuze-setter table on the port side of the aft deck with four setter pots.
    k.box('fuze-setter.table', (-.87, 1.21, .85), (.86, .28, .66), N)
    for x in (-1.20, -.98, -.76, -.54):
        k.cylinder('fuze-setter.pot', (x, 1.21, 1.25), .10, .14, 'z', N, n=6)
        k.rod('fuze-setter.handle', (x, 1.30, 1.25), (x, 1.30, 1.42), .02, E, n=4)
    k.box('fuze-setter.motor', (-.34, 1.24, 1.25), (.18, .20, .16), N)
    k.box('fuze-setter.post', (-.33, 1.23, 1.35), (.10, .28, .96), N)
    # Starboard aft: ready-service case, tool locker and the case-deflector stanchion.
    k.cylinder('ready-case', (-.58, -1.02, .80), .17, .56, 'z', N, n=8)
    k.cylinder('ready-case.lid', (-.58, -1.02, 1.10), .12, .06, 'z', E, n=8)
    k.box('aft-locker', (-1.86, -.66, .75), (.26, .42, .46), N)
    k.cylinder('aft-locker.cylinder', (-1.74, -.60, 1.08), .07, .30, 'z', E, n=8)
    k.path('case-deflector', [(-1.99, -.30, .52), (-2.00, -.30, 1.30), (-1.96, -.30, 1.66), (-1.88, -.30, 1.74)], .025, PE)

    # ---- elevating mass (one barrel: the 'center' side)
    _, elevation, recoil = k.sides['center']
    ex = lambda x: x - T  # authoring helper: absolute x at rest -> elevation-local x
    ez = lambda z: z - P
    # Slide: tall starboard half (breech housing, rammer), lower port half with a sloped top.
    stbd = [(ex(-1.48), ez(1.40)), (ex(-1.10), ez(1.46)), (ex(-1.08), ez(1.62)), (ex(.62), ez(1.62)), (ex(.62), ez(2.20)),
            (ex(-1.52), ez(2.20)), (ex(-1.56), ez(1.95)), (ex(-1.52), ez(1.62))]
    k.prism('slide.starboard', stbd, -.29, -.02, 'y', N, elevation)
    port = [(ex(-1.12), ez(1.68)), (ex(.60), ez(1.68)), (ex(.60), ez(2.00)), (ex(.10), ez(2.00)), (ex(.10), ez(2.13)),
            (ex(-.25), ez(2.13)), (ex(-.32), ez(2.02)), (ex(-1.12), ez(1.82))]
    k.prism('slide.port', port, -.02, .27, 'y', N, elevation)
    k.box('slide.front-ring', (ex(.62), 0, 0), (.08, .40, .44), N, elevation)
    k.box('slide.fuze-box', (ex(-.05), -.12, ez(2.30)), (.40, .34, .36), N, elevation)
    # Rammer housing outboard on the starboard side (kept above the trunnion line so it clears
    # the carriage bracket at full elevation), rammer motor above it, and the rammer cylinder.
    k.prism('slide.rammer-housing', [(ex(-1.45), ez(1.88)), (ex(-.86), ez(1.88)), (ex(-.80), ez(1.98)), (ex(-.80), ez(2.24)),
                                     (ex(-1.45), ez(2.24))], -.41, -.29, 'y', N, elevation)
    k.box('slide.rammer-motor', (ex(-.87), -.28, ez(2.40)), (.36, .28, .40), N, elevation)
    k.box('slide.rammer-cover', (ex(-1.25), -.20, ez(2.32)), (.32, .20, .24), N, elevation)
    k.cylinder('slide.rammer-cylinder', (ex(-.95), -.08, ez(2.26)), .06, 1.00, 'x', E, elevation, n=8)
    # Loading tray and its back plate at the rear, carried by the slide.
    k.prism('slide.loading-tray', [(ex(-1.47), ez(1.38)), (ex(-1.10), ez(1.44)), (ex(-1.10), ez(1.50)), (ex(-1.47), ez(1.46))],
            -.02, .26, 'y', E, elevation)
    k.box('slide.tray-lip', (ex(-1.28), .25, ez(1.52)), (.36, .03, .12), E, elevation)
    k.box('slide.tray-back', (ex(-1.43), .12, ez(1.66)), (.10, .26, .50), N, elevation)
    # Sight linkage rod along the top and the slide-mounted open ring-sight bar.
    k.rod('slide.sight-rod', (ex(-.40), -.23, ez(2.26)), (ex(1.44), -.23, ez(2.26)), .018, PE, elevation, n=4)
    k.box('slide.sight-rod-bracket', (ex(1.44), -.23, ez(2.18)), (.10, .06, .18), PE, elevation)
    k.rod('slide.sight-arm', (ex(.62), 0, ez(2.20)), (ex(1.02), 0, ez(2.28)), .03, PE, elevation, n=4)
    k.rod('slide.sight-bar', (ex(1.02), -.96, ez(2.28)), (ex(1.02), .96, ez(2.28)), .02, PE, elevation, n=4)
    for sy in (-1, 1):
        k.rod('slide.sight-rail', (ex(1.02), sy * .92, ez(2.28)), (ex(1.47), sy * .92, ez(2.28)), .015, PE, elevation, n=4)
        k.rod('slide.sight-post', (ex(1.47), sy * .92, ez(2.28)), (ex(1.49), sy * .92, ez(1.97)), .012, PE, elevation, n=4)
        k.ring('slide.ring-sight', (ex(1.46), sy * .92, ez(2.33)), .07, .008, 'x', PE, elevation, n=10, spokes=2)
        k.ring('slide.ring-sight', (ex(1.50), sy * .92, ez(1.97)), .07, .008, 'x', PE, elevation, n=10, spokes=2)
    # Barrel: constant breech section, tapered chase, straight muzzle; dark bore.
    L = s['muzzleForward'] - T
    k.lathe('barrel', [(-.30, .155), (1.98, .155), (4.12, .099), (L, .099)], N, recoil, n=12)
    k.cylinder('bore', (L - .02, 0, 0), .064, .045, 'x', 'dark', recoil, n=12)
    k.box('breech-block', (-.42, 0, 0), (.24, .24, .26), E, recoil)
    return k.yaw


# ---------------------------------------------------------------------------------------------
# 1.1-inch/75 Mk 2 Mod 2 quadruple mount
# ---------------------------------------------------------------------------------------------
def create_quad(mount, col, helpers, materials):
    raise NotImplementedError


# ---------------------------------------------------------------------------------------------
# 20 mm Oerlikon Mk 4 single mount
# ---------------------------------------------------------------------------------------------
def create_oerlikon(mount, col, helpers, materials):
    raise NotImplementedError
