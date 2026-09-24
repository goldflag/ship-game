"""Original 12.7 cm/40 Type 89 twin AA mounts of Shokaku's December 1941 fit.

Two variants, each measured against its GameModels3D pjsa108 (Shokaku, built from
Zuikaku 1944) gun visual only; no reference mesh is loaded, traced or shipped:

- `create_open`: the open A1 mount on the forward and port-aft sponsons
  (`jgs009_127mm40_type_89`, HP_JGS_1-4, 7, 8).
- `create_shielded`: the hooded A1 Mod 2 of the two starboard-aft sponsons
  (`jgs003_127mm40_type89_mod_a`, HP_JGS_5, 6).

Authoring frame: +X muzzle, +Y port, +Z up; the origin is the reference hardpoint (the
yaw datum). The catalog pivot height is the reference bore axis at the trunnions. Nodes
follow the shared barrel contract: `<id>.yaw`, `<side>.elevation`, `<side>.recoil`,
`<side>.muzzle`. Barrels and breeches ride recoil; cradles, guards, recuperators, port
collars and shutters ride elevation; everything else trains with yaw. The construction
kit and the hood of the Mod 2 follow the Yamato Type 89 recipe
(`assets/parts/ijn-yamato-aa/type89_twin.py`), re-measured for these visuals.
"""
import math
import bmesh
import bpy
from mathutils import Matrix
from blender_barrels import barrel_layout


class _Mount:
    def __init__(self, mount, col, helpers, materials):
        self.mesh, self.cyl, self.rod, self.box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
        palette = dict(materials)
        palette.setdefault('roof', palette['naval'])
        palette.setdefault('painted-edge', palette['edge'])
        palette.setdefault('glass', palette['dark'])
        self.m = palette
        self.col = col
        self.name = mount['id']
        self.mount = mount
        self.spec = mount['weapon']
        self.yaw = self.joint('yaw')
        self.sides = {}
        s = self.spec
        for side, y, _ in barrel_layout(s):
            elevation = self.joint(side + '.elevation', self.yaw, (s['trunnionForward'], y, s['pivotHeight']))
            elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
            recoil = self.joint(side + '.recoil', elevation)
            self.joint(side + '.muzzle', recoil, (s['muzzleForward'] - s['trunnionForward'], 0, 0))
            self.sides[side] = (y, elevation, recoil)

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

    def solid(self, label, verts, faces, material, parent=None, smooth=False):
        obj = self.mesh(self.name + '.' + label, verts, faces, self.m[material], self.col, smooth)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(obj.data)
        bm.free()
        return self.put(obj, parent)

    def loft(self, label, rings, material, parent=None, caps=(True, True), closed=True, smooth=False):
        """Rings of equal length; consecutive rings joined by quads, optional end caps."""
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
        """Extrude a 2D outline between a0 and a1 along `axis`: 'y' takes (x, z), 'x' takes (y, z), 'z' takes (x, y)."""
        def p(u, v, a):
            return {'y': (u, a, v), 'x': (a, u, v), 'z': (u, v, a)}[axis]
        return self.loft(label, [[p(u, v, a0) for u, v in outline], [p(u, v, a1) for u, v in outline]], material, parent)

    def arc(self, label, cx, cz, r0, r1, a0, a1, y0, y1, material, parent=None, steps=8, rise=1.0):
        """Annular sector in the XZ plane (degrees from +X toward +Z), extruded from y0 to y1."""
        rings = []
        for i in range(steps + 1):
            t = math.radians(a0 + (a1 - a0) * i / steps)
            c, s = math.cos(t), math.sin(t) * rise
            rings.append([(cx + r0 * c, y0, cz + r0 * s), (cx + r1 * c, y0, cz + r1 * s),
                          (cx + r1 * c, y1, cz + r1 * s), (cx + r0 * c, y1, cz + r0 * s)])
        return self.loft(label, rings, material, parent)

    def lathe(self, label, profile, material, parent=None, n=12, y=0.0, z=0.0, smooth=True):
        """Surface of revolution about a line parallel to X through (y, z); profile is (x, radius)."""
        rings = [[(x, y + r * math.cos(math.tau * i / n), z + r * math.sin(math.tau * i / n)) for i in range(n)]
                 for x, r in profile]
        return self.loft(label, rings, material, parent, smooth=smooth)

    def bar(self, label, a, b, r, material='painted-edge', parent=None, n=6):
        return self.put(self.rod(self.name + '.' + label, a, b, r, self.m[material], self.col, vertices=n), parent)

    def block(self, label, loc, size, material='naval', parent=None):
        return self.put(self.box(self.name + '.' + label, loc, size, self.m[material], self.col), parent)

    def drum(self, label, loc, r, h, material='naval', parent=None, n=16):
        return self.put(self.cyl(self.name + '.' + label, loc, r, h, self.m[material], self.col, n), parent)

    def rail(self, label, points, radius=.02, material='painted-edge', parent=None):
        for a, b in zip(points, points[1:]):
            self.bar(label, a, b, radius, material, parent, 4)

    def wheel(self, label, center, r, axis, material='edge', parent=None, spokes=4):
        """Handwheel: rim of 8 bars and spokes, in the plane normal to `axis` ('x' or 'y')."""
        x, y, z = center
        def at(t):
            c, s = r * math.cos(t), r * math.sin(t)
            return (x, y + c, z + s) if axis == 'x' else (x + c, y, z + s)
        for i in range(8):
            self.bar(label + '.rim', at(i * math.tau / 8), at((i + 1) * math.tau / 8), .016, material, parent, 4)
        for i in range(spokes):
            self.bar(label + '.spoke', center, at(i * math.tau / spokes + math.pi / 4), .010, material, parent, 4)

    def place(self):
        x, y, z = self.mount['position']
        self.yaw.location = (-z, -x, y)
        self.yaw.rotation_euler.z = -math.radians(self.mount['bearingDeg'])
        return self.yaw


def create_shielded(mount, col, helpers, materials):
    """Type 89 A1 Mod 2 (jgs003): sloped turntable, faceted gas hood, concentric slot shield, shutters."""
    k = _Mount(mount, col, helpers, materials)
    s = k.spec
    tf, ph, mf = s['trunnionForward'], s['pivotHeight'], s['muzzleForward']
    R = 3.31

    def deck(x):
        # The reference turntable top is a plane rising aft (0.21 m at the front lip,
        # 0.89 m at the rear); the guns clear the lip at the -7 degree depression.
        return .55 - .102 * x

    n = 32
    ring = [(R * math.cos(math.tau * i / n), R * math.sin(math.tau * i / n)) for i in range(n)]
    k.loft('turntable', [[(x, y, 0) for x, y in ring], [(x, y, deck(x)) for x, y in ring]], 'naval')
    k.loft('turntable.rim', [[(x * 1.004, y * 1.004, deck(x) - .06) for x, y in ring],
                             [(x * 1.004, y * 1.004, deck(x) + .012) for x, y in ring]], 'painted-edge',
           caps=(False, False))

    # Faceted hood: vertical lower wall, sloped shoulders and a flat crown. The port
    # front is recessed for the gunlayer's sight bay.
    port = [(1.30, 0), (1.30, .97), (.62, .97), (.62, 2.15), (.70, 2.72), (.20, 2.86), (-.6, 2.88), (-1.6, 2.6),
            (-2.35, 2.0), (-2.9, 1.35), (-3.2, .6), (-3.26, 0)]
    stbd = [(1.30, 0), (1.30, .97), (1.30, 1.6), (1.20, 2.15), (1.0, 2.55), (.35, 2.84), (-.6, 2.88), (-1.6, 2.6),
            (-2.35, 2.0), (-2.9, 1.35), (-3.2, .6), (-3.26, 0)]

    def hood_ring(p, st, z):
        return [(x, -y, z) for x, y in st] + [(x, y, z) for x, y in reversed(p[1:-1])]
    shoulder_p = [(.95, 0), (.95, .97), (-.60, .97), (-.60, 2.15), (-.55, 2.38), (-.6, 2.42), (-1.0, 2.4), (-1.5, 1.95),
                  (-1.95, 1.4), (-2.25, .95), (-2.42, .45), (-2.52, 0)]
    shoulder_s = [(.95, 0), (.95, .97), (.90, 1.3), (.60, 1.85), (.30, 2.2), (.10, 2.4), (-.6, 2.42), (-1.0, 2.4),
                  (-1.5, 1.95), (-1.95, 1.4), (-2.25, .95), (-2.52, 0)]
    top_p = [(.55, 0), (.55, .97), (-.40, 1.0), (-.45, 1.5), (-.5, 1.8), (-.7, 1.9), (-.9, 1.95), (-1.3, 1.45),
             (-1.6, 1.0), (-1.85, .6), (-1.95, .3), (-2.0, 0)]
    top_s = [(.55, 0), (.55, .97), (.50, 1.1), (.35, 1.45), (.10, 1.75), (0, 1.8), (-.9, 1.95), (-1.3, 1.45),
             (-1.6, 1.0), (-1.85, .6), (-1.95, .3), (-2.0, 0)]
    wall = [(x, y * .95 if x < 1.0 else y * .97, z) for x, y, z in hood_ring(port, stbd, .95)]
    # The crown rises toward the slot shield along its flanks.
    def crown_z(y):
        return 2.22 + .14 * max(0, min(1, (1.9 - abs(y)) / .9))
    crown = [(x, y, crown_z(y)) for x, y, _ in hood_ring(top_p, top_s, 0)]
    # A second, inner crown ring keeps the roof faces near-planar (no warped n-gon cap).
    inner = [(-.7 + .45 * (x + .7), .45 * y) for x, y, _ in crown]
    inner = [(x, y, crown_z(y)) for x, y in inner]
    k.loft('hood.shell', [hood_ring(port, stbd, deck(0) - .15), wall, hood_ring(shoulder_p, shoulder_s, 1.87), crown, inner],
           'naval')

    # Slot shield concentric with the trunnions, so the shutters slide over it at every
    # elevation; it runs aft as the raised centre ridge. Barrels pass through its face.
    cx, cz, rv = tf, ph, 1.75
    profile = [(-1.4, .35), (1.45, .35)]
    profile += [(cx + rv * math.cos(math.radians(a)), cz + rv * math.sin(math.radians(a))) for a in range(-15, 91, 15)]
    profile += [(-1.4, 2.36)]
    k.prism('slot-shield.cover', profile, -.86, .86, 'y', 'naval')
    for y in (-.64, 0, .64):
        k.arc('slot-rib', cx, cz, rv - .02, rv + .08, -15, 90, y - .045, y + .045, 'naval', steps=9)
        for a in (12, 32, 52, 72):
            t = math.radians(a)
            rung = k.box(k.name + '.rib-rung', (cx + (rv + .085) * math.cos(t), y, cz + (rv + .085) * math.sin(t)),
                         (.05, .16, .04), k.m['painted-edge'], k.col)
            rung.rotation_euler.y = -t
            k.put(rung)
        k.arc('rib-eye', cx - .02, cz + rv + .08, .05, .09, 0, 180, y - .02, y + .02, 'painted-edge', steps=4)

    # Gunlayer's sight bay on the port front: an elliptical arched opening with a curved
    # roof over its upper half, two edge frames and a middle rail, dark within.
    bx, bz, ba, rise = -.40, .55, 1.22, 1.34 / 1.22
    k.arc('sight-bay.interior', bx, bz, ba * .86, ba * .88, -8, 88, .99, 2.11, 'dark', steps=8, rise=rise)
    k.arc('sight-bay.roof', bx, bz, ba * 1.0, ba * 1.04, 40, 90, .97, 2.13, 'naval', steps=5, rise=rise)
    for y, w, mat in ((.97, .08, 'naval'), (2.13, .08, 'naval'), (1.55, .05, 'painted-edge')):
        k.arc('sight-bay.frame', bx, bz, ba * .97, ba * 1.07, -8, 90, y - w / 2, y + w / 2, mat, steps=8, rise=rise)
    for y in (1.42, 1.64):
        k.bar('sight-bay.binocular', (.35, y, 1.12), (.62, y, 1.12), .07, 'edge', n=8)
        k.bar('sight-bay.lens', (.62, y, 1.12), (.64, y, 1.12), .055, 'glass', n=8)
    k.block('sight-bay.bracket', (.30, 1.53, .83), (.14, .30, .58), 'edge')

    # Roof hatches, vents, a starboard side door with its handle and grab rails.
    for x, y in ((-1.95, .43), (-1.95, -.43), (-.45, 1.35), (-.45, -1.35), (.15, -1.25)):
        k.drum('roof-hatch', (x, y, crown_z(y) + .01), .2, .06, 'naval', n=8)
        k.bar('roof-hatch.handle', (x - .08, y, crown_z(y) + .05), (x + .08, y, crown_z(y) + .05), .012, n=4)
    for y in (1.2, -1.2):
        k.drum('roof-vent', (-1.25, y, crown_z(y) + .03), .09, .10, 'naval', n=8)
        k.drum('roof-vent.cap', (-1.25, y, crown_z(y) + .10), .13, .04, 'naval', n=8)
    # Starboard side door, leaning with the lower hood wall (14.7 degrees).
    door = k.block('side-door', (-.45, -2.797, .75), (.6, .03, .62))
    door.rotation_euler.x = -math.radians(14.7)
    handle = k.block('side-door.handle', (-.25, -2.817, .75), (.03, .03, .16), 'painted-edge')
    handle.rotation_euler.x = -math.radians(14.7)
    for y in (-1, 1):
        k.rail('rear-ladder', [(-2.95, y * .3, deck(-2.95)), (-2.60, y * .3, 1.80)])
    for z in (.2, .5, .8, 1.1, 1.4):
        x = -2.95 + (z / 1.8) * .35
        k.bar('rear-ladder.rung', (x, -.3, deck(x) + z * .5), (x, .3, deck(x) + z * .5), .014, n=4)

    # Guard rails round the open front of the turntable, parted where the barrels depress.
    for sign in (1, -1):
        pts = [(3.12 * math.cos(math.radians(a)), sign * 3.12 * math.sin(math.radians(a))) for a in (24, 44, 62, 80, 96)]
        for x, y in pts:
            k.bar('rail-post', (x, y, deck(x) - .01), (x, y, deck(x) + .70), .022, n=4)
        for h in (.38, .70):
            k.rail('rail', [(x, y, deck(x) + h) for x, y in pts])

    # Guns: slim chase, muzzle ring and breech slide in recoil; the square port collar and
    # its shutter ride the cradle across the slot shield.
    length = mf - tf
    for side, (y, elevation, recoil) in k.sides.items():
        k.lathe('barrel', [(.55, .12), (2.35, .12), (2.40, .105), (length - .1, .096), (length - .07, .108),
                           (length, .108), (length, .062), (length - .12, .062)], 'edge', recoil)
        # Square sleeve/port collar seen outside the shield face (reference 0.85 m long).
        k.block('port-collar', (rv + .335, 0, 0), (.67, .23, .42), 'naval', elevation)
        k.block('port-collar.band', (rv + .62, 0, 0), (.05, .26, .45), 'painted-edge', elevation)
        k.arc('port-shutter', 0, 0, rv + .005, rv + .035, -8, 14, -.19, .19, 'naval', elevation, steps=4)
    return k.place()


def create_open(mount, col, helpers, materials):
    """Open Type 89 A1 (jgs009): deck disc, raked A-frame cheeks with a V web, cradles with paired
    recuperators, pointer's hooded station to port, fuze setter to starboard, loaders' platform aft."""
    k = _Mount(mount, col, helpers, materials)
    s = k.spec
    tf, ph, mf = s['trunnionForward'], s['pivotHeight'], s['muzzleForward']

    # Training disc and roller path. The reference's disc hangs 0.11 m below its hardpoint; catalog guns
    # stand on their datum, so the disc is a 0.08 m plate on it and the platform carries the difference.
    k.drum('deck-disc', (0, 0, .04), 1.47, .08, 'naval', n=24)
    k.drum('roller-path', (0, 0, .095), 1.30, .03, 'edge', n=24)
    for i in range(12):
        t = math.tau * i / 12
        k.drum('disc-bolt', (1.38 * math.cos(t), 1.38 * math.sin(t), .09), .03, .02, 'edge', n=6)

    # Raked A-frame cheeks carrying the trunnions; each leg narrows toward its bearing.
    cheek = [(-.086, .07), (1.011, .07), (.856, 1.382), (.744, 1.617), (.576, 1.77), (.027, 2.067), (-.039, 2.157),
             (-.039, 2.43), (-.423, 2.43), (-.423, 1.818), (-.374, 1.692), (-.138, 1.457), (-.086, 1.33)]
    for sign in (1, -1):
        def face(y0, y1):
            return [(x, sign * (y0 + (y1 - y0) * (z - .07) / 2.36), z) for x, z in cheek]
        k.loft('carriage.cheek', [face(.56, .70), face(.96, .82)], 'naval')
        k.bar('trunnion-cap', (tf, sign * .80, ph + .05), (tf, sign * 1.00, ph + .05), .15, 'edge', n=12)
        k.bar('trunnion-cap.bolt-ring', (tf, sign * .995, ph + .05), (tf, sign * 1.02, ph + .05), .10, 'painted-edge', n=8)
        # Lightening holes and a stiffener on the outer face of each leg.
        k.drum('carriage.lightening-hole', (.42, sign * .935, .62), .16, .02, 'dark', n=8).rotation_euler.x = math.pi / 2
        k.bar('carriage.stiffener', (.95, sign * .93, .12), (.02, sign * .86, 2.00), .03, 'naval', n=4)
        # Elevating arc and its pinion box on the inner face of each leg.
        k.arc('elevating-arc', tf, ph, .52, .60, -105, -45, sign * .66, sign * .61, 'edge', steps=5)
    # V web between the cheeks, open over the middle so the breeches drop at high elevation.
    # Its shoulders climb the cheeks outboard of the cradles (|y| > 0.60), as on the reference.
    web0 = [(-.60, .78), (-.68, 1.90), (-.61, 1.90), (-.585, 1.40), (-.46, 1.10), (.46, 1.10), (.585, 1.40), (.61, 1.90), (.68, 1.90), (.60, .78)]
    web1 = [(-.58, .78), (-.62, 1.22), (-.60, 1.22), (-.58, 1.16), (-.44, .98), (.44, .98), (.58, 1.16), (.60, 1.22), (.62, 1.22), (.58, .78)]
    k.loft('carriage.web', [[(.30, y, z) for y, z in web0], [(.84, y, z) for y, z in web1]], 'naval')
    for y in (-.62, .62):
        k.bar('carriage.web-tie', (.80, y, 1.10), (.80, y, 1.24), .03, 'naval', n=4)
    k.bar('carriage.cross-bar', (.78, -.66, 1.26), (.78, .66, 1.26), .045, 'naval', n=6)
    # Training gear: pinion box, motor and hand gear on the rotating floor.
    k.block('training.gearbox', (.30, -.38, .48), (.54, .56, .54), 'naval')
    k.bar('training.motor', (.30, -.38, .74), (.30, -.38, 1.02), .16, 'naval', n=10)
    k.block('training.pinion-box', (.80, .31, .235), (.41, .40, .33), 'naval')
    k.block('training.brake', (1.04, -.30, .20), (.18, .37, .19), 'edge')
    k.bar('training.shaft', (.30, -.10, .30), (.80, .12, .30), .04, 'edge', n=6)

    # Pointer's station (port): hooded side frame on a raised platform.
    frame = [(-1.04, .93), (.80, .93), (.80, 1.60), (.70, 2.38), (.50, 2.60), (.30, 2.85), (.05, 3.02), (-.20, 3.09),
             (-.45, 3.09), (-.75, 2.96), (-.95, 2.83), (-1.04, 2.70)]
    k.prism('pointer.side-frame', frame, 2.06, 2.10, 'y', 'naval')
    hood = frame[3:]
    k.loft('pointer.hood', [[(x, .72, z - .05) for x, z in hood], [(x, .72, z) for x, z in hood],
                            [(x, 2.10, z) for x, z in hood], [(x, 2.10, z - .05) for x, z in hood]], 'naval',
           caps=(False, False), closed=False)
    k.prism('pointer.inner-frame', [(-1.04, 2.62), (-1.04, 2.70), (-.95, 2.83), (-.75, 2.96), (-.45, 3.09), (-.20, 3.09),
                                    (.05, 3.02), (.30, 2.85), (.50, 2.62)], .72, .78, 'y', 'naval')
    # Handholds round the hood's curve.
    for x, z in ((.62, 2.47), (.42, 2.72), (.18, 2.93), (-.08, 3.055), (-.33, 3.09), (-.60, 3.025), (-.86, 2.89)):
        k.block('pointer.hood-handhold', (x, .90, z + .04), (.05, .26, .10), 'painted-edge')
    k.block('pointer.platform', (-.12, 1.425, .905), (1.84, 1.36, .05))
    # Rear plates of the hood with the crew doorway between them.
    k.block('pointer.rear-plate', (-1.025, 1.80, 1.815), (.03, .60, 1.77))
    k.block('pointer.rear-plate', (-1.025, .86, 1.815), (.03, .28, 1.77))
    k.block('pointer.rear-plate', (-1.025, 1.25, 2.50), (.03, .50, .40))
    k.prism('pointer.front-plate', [(.77, .12), (1.35, .12), (2.08, .62), (2.08, .93), (.77, .93)], .54, .58, 'x', 'naval')
    # Closed front of the pointer's hood with the sight window.
    for y0, y1, z0, z1 in ((.72, 2.10, .93, 1.84), (.72, 1.08, 1.84, 2.20), (1.56, 2.10, 1.84, 2.20)):
        k.block('pointer.front-shield', (.785, (y0 + y1) / 2, (z0 + z1) / 2), (.03, y1 - y0, z1 - z0))
    k.prism('pointer.front-shield', [(.72, 2.20), (2.10, 2.20), (2.10, 2.40), (.72, 2.40)], .70, .80, 'x', 'naval')
    k.block('pointer.web', (-.40, 1.425, .50), (.04, 1.0, .74))
    k.drum('pointer.lightening-hole', (-.40, 1.425, .50), .20, .05, 'dark', n=8).rotation_euler.y = math.pi / 2
    for y in (1.625, 1.875):
        k.bar('pointer.ladder-rail', (-.80, y, .10), (-.80, y, 1.08), .02, n=4)
    for z in (.30, .55, .80):
        k.bar('pointer.ladder-rung', (-.80, 1.625, z), (-.80, 1.875, z), .015, n=4)
    for y in (1.37, 1.84):
        k.block('pointer.seat', (-.12, y, 1.45), (.24, .30, .04), 'edge')
        k.bar('pointer.seat-post', (-.12, y, .93), (-.12, y, 1.43), .03, 'edge')
        k.block('pointer.seat-back', (-.25, y, 1.62), (.03, .26, .30), 'edge')
    k.block('pointer.sight-box', (.16, 1.30, 1.95), (.30, .28, .30), 'edge')
    k.bar('pointer.sight-post', (.16, 1.30, .93), (.16, 1.30, 1.80), .045, 'edge')
    for y in (1.22, 1.38):
        k.bar('pointer.telescope', (.30, y, 2.02), (.66, y, 2.02), .06, 'edge', n=8)
        k.bar('pointer.lens', (.66, y, 2.02), (.68, y, 2.02), .05, 'glass', n=8)
    for y in (1.03, 1.53):
        k.wheel('pointer.handwheel', (.48, y, 1.25), .13, 'x')
        k.bar('pointer.handwheel-shaft', (.20, y, 1.25), (.48, y, 1.25), .02, 'edge')
        k.block('pointer.gearbox', (.16, y, 1.13), (.16, .14, .40), 'edge')
    k.block('pointer.data-receiver', (.15, 2.04, 1.58), (.25, .04, .26), 'dark')
    for x in (-.9, .4):
        k.bar('pointer.handhold', (x, 2.13, 1.3), (x, 2.13, 2.2), .02)
    # Climbing rungs up the hood's outer wall to its roof.
    for z in (1.10, 1.40, 1.70, 2.00, 2.30, 2.60):
        k.rail('pointer.wall-rung', [(-.97, 2.10, z), (-.97, 2.14, z), (-.75, 2.14, z), (-.75, 2.10, z)], .014)

    # Fuze setter (starboard front) with drawer fronts, handles and setting cranks on top.
    cab = [(-.19, .19), (.84, .19), (.84, 1.50), (.76, 1.67), (.62, 1.76), (.45, 1.79), (-.02, 1.79), (-.14, 1.74), (-.19, 1.65)]
    k.prism('fuze-setter.cabinet', cab, -2.04, -.87, 'y', 'naval')
    for z in (.65, 1.09):
        k.rail('fuze-setter.band', [(.86, -.88, z), (.86, -2.06, z), (-.19, -2.06, z)], .016)
    for z in (.30, .55, .81, 1.05, 1.32):
        k.block('fuze-setter.drawer', (.855, -1.455, z), (.03, 1.05, .02), 'painted-edge')
        k.block('fuze-setter.pull', (.865, -1.465, z + .09), (.03, .25, .025), 'painted-edge')
    for x, y in ((.28, -1.72), (.28, -1.22)):
        k.drum('fuze-setter.crank-boss', (x, y, 1.82), .12, .06, 'edge', n=8)
        k.bar('fuze-setter.crank', (x, y, 1.84), (x + .16, y, 1.92), .018, 'edge')
    k.bar('fuze-setter.grab', (-.19, -2.07, .6), (-.19, -2.07, 1.6), .02)
    # Trainer's seat and handwheel behind the fuze setter, on a footboard with rails.
    k.block('trainer.footboard', (-.71, -1.30, 1.075), (1.0, .30, .04))
    k.block('trainer.seat', (-.45, -1.30, 1.50), (.30, .30, .04), 'edge')
    k.block('trainer.seat-back', (-.60, -1.30, 1.66), (.03, .26, .28), 'edge')
    k.bar('trainer.seat-post', (-.45, -1.30, 1.09), (-.45, -1.30, 1.48), .03, 'edge')
    k.wheel('trainer.handwheel', (-.10, -1.08, 1.62), .14, 'x')
    # Trainer's sight on a bracket from the fuze setter's top.
    k.bar('trainer.sight-post', (.05, -1.45, 1.78), (.05, -1.45, 2.50), .03, 'naval')
    k.bar('trainer.sight-arm', (.05, -1.47, 2.50), (.05, -.80, 2.50), .03, 'naval')
    k.bar('trainer.sight-strut', (.05, -1.30, 1.78), (.05, -.95, 2.49), .02, 'naval')
    k.bar('trainer.telescope', (-.20, -.80, 2.56), (.30, -.80, 2.56), .05, 'edge', n=8)
    k.bar('trainer.telescope-lens', (.30, -.80, 2.56), (.32, -.80, 2.56), .04, 'glass', n=8)
    k.block('trainer.telescope-mount', (.05, -.80, 2.52), (.10, .08, .06), 'edge')
    k.bar('trainer.handwheel-shaft', (-.10, -1.08, 1.62), (-.10, -.93, 1.62), .02, 'edge')
    k.block('trainer.gearbox', (-.10, -.88, 1.50), (.20, .14, .34), 'edge')
    for x in (-.60, -.22):
        k.bar('trainer.footboard-leg', (x, -1.30, .08), (x, -1.30, 1.06), .03, 'naval')
    for y in (-1.17, -1.43):
        k.rail('trainer.footboard-rail', [(-1.21, y, 1.09), (-1.21, y, 1.44), (-.21, y, 1.44), (-.21, y, 1.09)])

    # Loaders' platform aft: arms from the cheeks, fuze drums, central tray, rails.
    for sign in (1, -1):
        arm = [(-2.32, 1.71), (-.40, 1.71), (-.40, 2.16), (-1.50, 2.16), (-2.32, 1.98)]
        k.prism('loading-arm', arm, sign * .66, sign * .94, 'y', 'naval')
        hexagon = [(-1.535 + .35 * math.cos(math.radians(30 + 60 * i)), 1.755 + .35 * math.sin(math.radians(30 + 60 * i)))
                   for i in range(6)]
        k.prism('fuze-drum', hexagon, sign * 1.09, sign * 1.51, 'y', 'naval')
        k.drum('fuze-drum.hub', (-1.535, sign * 1.53, 1.755), .12, .05, 'edge', n=8).rotation_euler.x = math.pi / 2
        k.bar('fuze-drum.post', (-1.22, sign * 1.29, 1.43), (-1.22, sign * 1.29, 2.46), .025, 'naval')
        k.block('fuze-drum.bracket', (-1.26, sign * 1.02, 1.93), (.22, .22, .10), 'naval')
        k.block('fuze-drum.outer-plate', (-1.53, sign * 1.48, 2.07), (.56, .03, .62), 'naval')
        k.block('fuze-drum.handle', (-1.22, sign * 1.29, 2.50), (.14, .10, .10), 'edge')
        k.bar('fuze-drum.strut', (-.95, sign * 1.05, .08), (-1.45, sign * 1.47, 1.80), .025, 'naval')
        for x in (-2.19, -1.78):
            k.block('rammer-housing', (x, sign * .545, 1.91), (.20, .27, .36), 'naval')
        k.block('loading-tray', (-1.94, sign * .41, 2.07), (.84, .30, .06), 'painted-edge')
        k.block('loading-tray.side', (-1.94, sign * .565, 2.12), (.84, .03, .14), 'painted-edge')
    # Central tray between the guns, kept behind the breech guards' sweep (1.23 m from the trunnions).
    k.block('central-tray', (-1.90, 0, 1.835), (1.20, .14, .31), 'naval')
    k.block('central-tray.rammer', (-1.90, 0, 2.02), (1.10, .10, .06), 'edge')
    for x in (-2.25, -1.85):
        k.bar('loader.cross-rail', (x, -.66, 2.02), (x, .66, 2.02), .03, 'naval')

    # Guns and cradles. Each gun keeps its own cradle half and guard so the two elevate
    # independently; the recuperator pair rides on top of each cradle with pointed heads.
    length = mf - tf
    for side, (y, elevation, recoil) in k.sides.items():
        inward = -math.copysign(1, y)
        k.lathe('barrel', [(-.40, .20), (.23, .182), (1.73, .119), (2.33, .109), (3.73, .087), (length - .21, .08),
                           (length - .16, .086), (length, .086), (length, .05), (length - .15, .05)], 'edge', recoil)
        k.block('breech-ring', (-.62, 0, 0), (.30, .36, .38), 'edge', recoil)
        k.block('breech-block', (-.76, 0, -.02), (.08, .28, .34), 'dark', recoil)
        k.bar('breech-lever', (-.70, -inward * .19, .10), (-.80, -inward * .215, -.12), .02, 'edge', recoil)
        # Cradle body round the barrel's jacket, its front sleeve and the lower buffer cylinder.
        k.block('cradle', (-.20, 0, -.06), (.72, .46, .50), 'naval', elevation)
        k.lathe('cradle.sleeve', [(.16, .22), (.62, .22), (.66, .20)], 'naval', elevation, n=10)
        k.lathe('buffer', [(.27, .07), (1.38, .07), (1.40, .05)], 'naval', elevation, n=8, y=inward * .155, z=-.29)
        k.block('buffer.bracket', (.55, inward * .08, -.21), (.14, .10, .14), 'naval', elevation)
        for off in (-.19, .19):
            k.lathe('recuperator', [(-.50, .105), (1.28, .105), (1.30, .12), (1.36, .12), (1.38, .105), (1.52, .04)],
                    'naval', elevation, n=6, y=off, z=.255, smooth=False)
            for x in (.63, 1.38):
                k.lathe('recuperator.band', [(x - .025, .125), (x + .025, .125)], 'painted-edge', elevation, n=6,
                        y=off, z=.255, smooth=False)
        k.block('recuperator.saddle', (.10, 0, .17), (.30, .50, .08), 'naval', elevation)
        # Breech guard: side plates and top plate round the recoiling breech, open behind.
        for off in (-.235, .235):
            k.block('breech-guard.side', (-.774, off, .065), (.77, .03, .67), 'naval', elevation)
        k.block('breech-guard.top', (-.774, 0, .385), (.77, .50, .03), 'naval', elevation)
        k.block('breech-guard.rear-bar', (-1.14, 0, .34), (.04, .50, .06), 'painted-edge', elevation)
    return k.place()
