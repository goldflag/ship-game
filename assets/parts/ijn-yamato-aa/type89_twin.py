"""Original 12.7 cm/40 Type 89 twin AA mounts of Yamato's 1945 fit.

Two variants, both measured against GameModels3D pjsb018 only (no reference mesh is
loaded here): the hooded mod A of the outer shelter-deck towers
(`jgs157_127mm40_type89_mod_a`) and the open mount of the inner tubs
(`jgs158_127mm40_type_89`). Authoring frame: +X muzzle, +Y port, +Z up; the origin
is the reference hardpoint (the yaw datum), so the catalog pivot height is the
reference trunnion height. The ship owns the tower or tub under the mount.
Nodes follow the shared barrel contract: `<id>.yaw`, `<side>.elevation`,
`<side>.recoil`, `<side>.muzzle`. Barrels ride recoil; cradles, shutters and
recuperators ride elevation; everything else trains with yaw.
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
        """Annular sector in the XZ plane (degrees from +X toward +Z), extruded from y0 to y1;
        `rise` stretches it vertically into an elliptical arch."""
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

    def rail(self, label, points, radius=.022, material='painted-edge', parent=None):
        for a, b in zip(points, points[1:]):
            self.put(self.rod(self.name + '.' + label, a, b, radius, self.m[material], self.col, vertices=4), parent)

    def place(self):
        x, y, z = self.mount['position']
        self.yaw.location = (-z, -x, y)
        self.yaw.rotation_euler.z = -math.radians(self.mount['bearingDeg'])
        return self.yaw


def create_shielded(mount, col, helpers, materials):
    """Type 89 mod A: sloped turntable, faceted hood, concentric slot shield with ribs and sliding shutters."""
    k = _Mount(mount, col, helpers, materials)
    s = k.spec
    tf, ph, mf = s['trunnionForward'], s['pivotHeight'], s['muzzleForward']
    R = 3.3

    def deck(x):
        # The reference turntable top is a plane rising aft; the front lip is held low
        # enough for the barrels to clear it at full depression.
        return .42 - .118 * x

    n = 32
    ring = [(R * math.cos(math.tau * i / n), R * math.sin(math.tau * i / n)) for i in range(n)]
    k.loft('turntable', [[(x, y, 0) for x, y in ring], [(x, y, deck(x)) for x, y in ring]], 'naval')

    # Faceted hood: vertical lower wall, sloped shoulders and a flat crown. The port
    # front is recessed for the gunlayer's sight bay.
    port = [(1.30, 0), (1.30, .97), (.55, .97), (.55, 2.15), (.70, 2.72), (.20, 2.88), (-.6, 2.9), (-1.6, 2.6),
            (-2.35, 2.0), (-2.9, 1.35), (-3.2, .6), (-3.28, 0)]
    stbd = [(1.30, 0), (1.30, .97), (1.30, 1.6), (1.20, 2.15), (1.0, 2.55), (.35, 2.86), (-.6, 2.9), (-1.6, 2.6),
            (-2.35, 2.0), (-2.9, 1.35), (-3.2, .6), (-3.28, 0)]
    def hood_ring(p, st, z):
        return [(x, -y, z) for x, y in st] + [(x, y, z) for x, y in reversed(p[1:-1])]
    shoulder_p = [(.95, 0), (.95, .97), (-.65, .97), (-.65, 2.15), (-.55, 2.38), (-.6, 2.42), (-1.0, 2.4), (-1.5, 1.95),
                  (-1.95, 1.4), (-2.25, .95), (-2.42, .45), (-2.48, 0)]
    shoulder_s = [(.95, 0), (.95, .97), (.90, 1.3), (.60, 1.85), (.30, 2.2), (.10, 2.4), (-.6, 2.42), (-1.0, 2.4),
                  (-1.5, 1.95), (-1.95, 1.4), (-2.25, .95), (-2.48, 0)]
    top_p = [(.55, 0), (.55, .97), (-.40, 1.0), (-.45, 1.5), (-.5, 1.8), (-.7, 1.9), (-.9, 1.95), (-1.3, 1.45),
             (-1.6, 1.0), (-1.85, .6), (-1.95, .3), (-2.0, 0)]
    top_s = [(.55, 0), (.55, .97), (.50, 1.1), (.35, 1.45), (.10, 1.75), (0, 1.8), (-.9, 1.95), (-1.3, 1.45),
             (-1.6, 1.0), (-1.85, .6), (-1.95, .3), (-2.0, 0)]
    wall = [(x, y * .95 if x < 1.0 else y * .97, z) for x, y, z in hood_ring(port, stbd, .95)]
    # The crown rises toward the slot shield along its flanks.
    crown = [(x, y, 2.2 + .16 * max(0, min(1, (1.9 - abs(y)) / .9))) for x, y, _ in hood_ring(top_p, top_s, 0)]
    k.loft('hood.shell', [hood_ring(port, stbd, .2), wall, hood_ring(shoulder_p, shoulder_s, 1.85), crown], 'naval')

    # Slot shield concentric with the trunnions, so the shutters slide over it at every
    # elevation; it runs aft as the raised centre ridge. Barrels pass through its face.
    cx, cz, rv = tf, ph, 1.82
    profile = [(-1.4, .2), (1.40, .2)]
    profile += [(cx + rv * math.cos(math.radians(a)), cz + rv * math.sin(math.radians(a))) for a in range(-15, 91, 15)]
    profile += [(-1.4, 2.28)]
    k.prism('slot-shield.cover', profile, -.86, .86, 'y', 'naval')
    for y in (-.63, 0, .63):
        k.arc('slot-rib', cx, cz, rv - .02, rv + .08, -15, 90, y - .045, y + .045, 'naval', steps=9)
        for a in (12, 32, 52, 72):
            t = math.radians(a)
            rung = k.box(k.name + '.rib-rung', (cx + (rv + .085) * math.cos(t), y, cz + (rv + .085) * math.sin(t)),
                         (.05, .16, .04), k.m['painted-edge'], k.col)
            rung.rotation_euler.y = -t
            k.put(rung)
        # Lifting eye at the crown of each rib.
        k.arc('rib-eye', cx - .02, cz + rv + .08, .05, .09, 0, 180, y - .02, y + .02, 'painted-edge', steps=4)

    # Gunlayer's sight bay on the port front: an elliptical arched opening with a curved
    # roof over its upper half, two edge frames and a middle rail, dark within.
    bx, bz, ba, rise = -.45, .44, 1.28, 1.40 / 1.28
    k.arc('sight-bay.interior', bx, bz, ba * .86, ba * .88, -8, 88, .99, 2.11, 'dark', steps=8, rise=rise)
    k.arc('sight-bay.roof', bx, bz, ba * 1.0, ba * 1.04, 40, 90, .97, 2.13, 'naval', steps=5, rise=rise)
    for y, w, mat in ((.97, .08, 'naval'), (2.13, .08, 'naval'), (1.55, .05, 'painted-edge')):
        k.arc('sight-bay.frame', bx, bz, ba * .97, ba * 1.07, -8, 90, y - w / 2, y + w / 2, mat, steps=8, rise=rise)
    k.put(k.rod(k.name + '.sight-bay.binocular', (.35, 1.42, 1.05), (.62, 1.42, 1.05), .07, k.m['edge'], k.col, vertices=8))
    k.put(k.rod(k.name + '.sight-bay.binocular', (.35, 1.64, 1.05), (.62, 1.64, 1.05), .07, k.m['edge'], k.col, vertices=8))
    k.put(k.rod(k.name + '.sight-bay.lens', (.62, 1.42, 1.05), (.64, 1.42, 1.05), .055, k.m['glass'], k.col, vertices=8))
    k.put(k.rod(k.name + '.sight-bay.lens', (.62, 1.64, 1.05), (.64, 1.64, 1.05), .055, k.m['glass'], k.col, vertices=8))
    k.put(k.box(k.name + '.sight-bay.bracket', (.30, 1.53, .72), (.14, .30, .62), k.m['edge'], k.col))

    # Roof hatches and a starboard side door.
    for x, y in ((-1.95, .43), (-1.95, -.43), (-.45, 1.35), (-.45, -1.35), (.15, -1.25)):
        k.put(k.cyl(k.name + '.roof-hatch', (x, y, 2.23), .2, .06, k.m['naval'], k.col, 8))
    k.put(k.box(k.name + '.side-door', (-.45, -2.905, .62), (.6, .03, .78), k.m['naval'], k.col))
    k.put(k.box(k.name + '.side-door.handle', (-.25, -2.93, .62), (.03, .03, .16), k.m['painted-edge'], k.col))

    # Guard rails round the open front of the turntable, parted where the barrels depress.
    for sign in (1, -1):
        pts = [(3.12 * math.cos(math.radians(a)), sign * 3.12 * math.sin(math.radians(a))) for a in (24, 48, 72, 94)]
        for x, y in pts:
            k.put(k.rod(k.name + '.rail-post', (x, y, deck(x) - .01), (x, y, deck(x) + .95), .025, k.m['painted-edge'], k.col, vertices=4))
        for h in (.5, .95):
            k.rail('rail', [(x, y, deck(x) + h) for x, y in pts])

    # Guns: sleeve, chase and muzzle ring slide in recoil; the port collar and its
    # shutter ride the cradle across the slot shield.
    length = mf - tf
    for side, (y, elevation, recoil) in k.sides.items():
        k.lathe('barrel', [(.40, .15), (2.56, .15), (2.60, .118), (2.64, .105), (length - .1, .098), (length - .07, .112),
                           (length, .112), (length, .066), (length - .12, .066)], 'edge', recoil)
        k.lathe('port-collar', [(rv - .04, .2), (rv + .12, .2)], 'naval', elevation, n=8, smooth=False)
        k.arc('port-shutter', 0, 0, rv + .005, rv + .035, -5, 13, -.25, .25, 'naval', elevation, steps=4)
    return k.place()


def create_open(mount, col, helpers, materials):
    """Open Type 89: pedestal and cheeks, cradle with recuperators over the guns, crew stations."""
    k = _Mount(mount, col, helpers, materials)
    s = k.spec
    tf, ph, mf = s['trunnionForward'], s['pivotHeight'], s['muzzleForward']

    # Fixed deck ring and the training base with its roller path.
    k.put(k.cyl(k.name + '.deck-ring', (0, 0, -.015), 1.42, .07, k.m['naval'], k.col, 16))
    k.put(k.cyl(k.name + '.roller-path', (0, 0, .045), 1.26, .06, k.m['edge'], k.col, 16))
    # Pedestal drum under the carriage; the well between the cheeks stays open so the
    # breeches can drop at high elevation.
    k.put(k.cyl(k.name + '.pedestal', (.25, 0, .46), .66, .78, k.m['naval'], k.col, 16))
    k.prism('carriage.front', [(.30, .07), (1.02, .07), (1.0, .40), (.72, 1.30), (.52, 1.52), (.30, 1.52)], -1.0, 1.0, 'y', 'naval')
    for sign in (1, -1):
        cheek = [(-.85, .85), (.55, .85), (.55, 1.52), (.20, 2.05), (-.10, 2.34), (-.50, 2.38), (-.80, 2.20), (-.95, 1.85)]
        k.prism('carriage.cheek', cheek, sign * .66, sign * .82, 'y', 'naval')
        k.put(k.rod(k.name + '.trunnion-cap', (tf, sign * .82, ph), (tf, sign * .90, ph), .17, k.m['edge'], k.col, vertices=10))
        # Elevating arc and pinion box on the cheek.
        k.arc('elevating-arc', tf, ph, .55, .66, -110, -40, sign * .84, sign * .9, 'edge', steps=5)

    # Pointer's station (port): tall curved side frame roofing a platform with seat, sights and handwheels.
    frame = [(-1.26, .90), (.78, .90), (.78, 1.75), (.62, 2.30), (.36, 2.62), (.10, 2.86), (-.36, 3.0), (-.80, 2.84),
             (-1.02, 2.62), (-1.26, 2.44)]
    for y0, y1 in ((.70, .74), (2.02, 2.06)):
        k.prism('pointer.side-frame', frame, y0, y1, 'y', 'naval')
    hood = [(.62, 2.30), (.36, 2.62), (.10, 2.86), (-.36, 3.0), (-.80, 2.84), (-1.02, 2.62)]
    k.loft('pointer.hood', [[(x, .70, z) for x, z in hood], [(x, .70, z + .04) for x, z in hood],
                            [(x, 2.06, z + .04) for x, z in hood], [(x, 2.06, z) for x, z in hood]], 'naval',
           caps=(False, False), closed=False)
    k.put(k.box(k.name + '.pointer.platform', (-.24, 1.38, .92), (2.04, 1.36, .05), k.m['naval'], k.col))
    k.put(k.box(k.name + '.pointer.column', (-.09, 1.40, .45), (.24, .44, .86), k.m['naval'], k.col))
    # Lightened bracket under the platform, a short ladder, and the housing's front and rear plates
    # (sight window and seat opening left open).
    k.put(k.box(k.name + '.pointer.bracket', (.47, 1.54, .47), (.06, 1.0, .84), k.m['naval'], k.col))
    k.put(k.cyl(k.name + '.pointer.lightening-hole', (.505, 1.54, .45), .2, .02, k.m['dark'], k.col, 6)).rotation_euler.y = math.pi / 2
    for z in (.25, .50, .75):
        k.put(k.box(k.name + '.pointer.ladder-rung', (.53, 1.84, z), (.04, .30, .03), k.m['painted-edge'], k.col))
    for yy in (1.69, 1.99):
        k.put(k.box(k.name + '.pointer.ladder-rail', (.53, yy, .45), (.04, .025, .84), k.m['painted-edge'], k.col))
    k.put(k.box(k.name + '.pointer.front-plate', (.76, 1.38, 1.33), (.04, 1.36, .82), k.m['naval'], k.col))
    k.put(k.box(k.name + '.pointer.rear-plate', (-1.24, 1.38, 1.12), (.04, 1.36, .40), k.m['naval'], k.col))
    k.put(k.box(k.name + '.pointer.rear-plate', (-1.24, 1.38, 2.36), (.04, 1.36, .16), k.m['naval'], k.col))
    k.put(k.box(k.name + '.pointer.rear-plate', (-1.24, 1.90, 1.74), (.04, .32, 1.10), k.m['naval'], k.col))
    k.put(k.box(k.name + '.pointer.seat', (-.55, 1.40, 1.45), (.34, .34, .06), k.m['edge'], k.col))
    k.put(k.rod(k.name + '.pointer.seat-post', (-.55, 1.40, .94), (-.55, 1.40, 1.42), .03, k.m['edge'], k.col, vertices=6))
    k.put(k.box(k.name + '.pointer.sight-box', (-.02, 1.38, 1.95), (.36, .30, .30), k.m['edge'], k.col))
    for y in (1.28, 1.48):
        k.put(k.rod(k.name + '.pointer.binocular', (.16, y, 2.08), (.52, y, 2.08), .075, k.m['edge'], k.col, vertices=8))
        k.put(k.rod(k.name + '.pointer.lens', (.52, y, 2.08), (.54, y, 2.08), .06, k.m['glass'], k.col, vertices=8))
    k.put(k.rod(k.name + '.pointer.sight-post', (-.02, 1.38, .94), (-.02, 1.38, 1.80), .05, k.m['edge'], k.col, vertices=6))
    for y, z in ((.98, 1.40), (1.80, 1.40)):
        k.put(k.rod(k.name + '.pointer.handwheel', (.10, y, z), (.14, y, z), .16, k.m['edge'], k.col, vertices=12))
        k.put(k.rod(k.name + '.pointer.handwheel-shaft', (-.10, y, z), (.10, y, z), .025, k.m['edge'], k.col, vertices=6))
        k.put(k.box(k.name + '.pointer.gearbox', (-.22, y, 1.20), (.24, .18, .52), k.m['edge'], k.col))
    for x in (-.9, .4):
        k.put(k.rod(k.name + '.pointer.handhold', (x, 2.08, 1.3), (x, 2.08, 2.2), .02, k.m['painted-edge'], k.col, vertices=4))

    # Trainer's side (starboard): fuze-setter cabinet with drawer fronts and a curved top.
    cab = [(-.35, .10), (.64, .10), (.64, 1.45), (.52, 1.62), (.30, 1.71), (-.35, 1.71)]
    k.prism('fuze-setter.cabinet', cab, -2.07, -.84, 'y', 'naval')
    for z in (.35, .65, .95, 1.25):
        k.put(k.box(k.name + '.fuze-setter.drawer', (.655, -1.45, z), (.03, 1.0, .02), k.m['painted-edge'], k.col))
        k.put(k.box(k.name + '.fuze-setter.pull', (.655, -1.45, z + .1), (.03, .16, .03), k.m['painted-edge'], k.col))
    k.put(k.box(k.name + '.trainer.seat', (-.55, -1.15, 1.45), (.34, .34, .06), k.m['edge'], k.col))
    k.put(k.rod(k.name + '.trainer.seat-post', (-.55, -1.15, .01), (-.55, -1.15, 1.42), .035, k.m['edge'], k.col, vertices=6))
    k.put(k.rod(k.name + '.trainer.handwheel', (-.30, -.95, 1.55), (-.26, -.95, 1.55), .16, k.m['edge'], k.col, vertices=12))
    k.put(k.box(k.name + '.trainer.gearbox', (-.42, -.92, 1.45), (.24, .16, .32), k.m['edge'], k.col))

    # Loading platform aft: fuze-setting drums, loaders' footboards and brackets off the cheeks.
    for sign in (1, -1):
        k.put(k.rod(k.name + '.fuze-drum', (-1.52, sign * 1.02, 1.62), (-1.52, sign * 1.45, 1.62), .27, k.m['naval'], k.col, vertices=6))
        k.put(k.box(k.name + '.fuze-drum.bracket', (-1.30, sign * 1.10, 1.62), (.50, .40, .12), k.m['naval'], k.col))
        k.prism('loading-arm', [(-2.29, 1.64), (-.80, 1.64), (-.80, 1.84), (-1.60, 1.84), (-2.29, 1.78)],
                sign * .80, sign * .94, 'y', 'naval')
        k.put(k.box(k.name + '.loader.footboard', (-1.81, sign * .82, 1.865), (.58, .28, .05), k.m['naval'], k.col))
        k.put(k.rod(k.name + '.loader.stanchion', (-2.25, sign * .87, 1.84), (-2.25, sign * .87, 2.35), .02, k.m['painted-edge'], k.col, vertices=4))
        k.put(k.rod(k.name + '.loader.rail', (-2.25, sign * .87, 2.35), (-1.30, sign * .87, 2.35), .02, k.m['painted-edge'], k.col, vertices=4))
        k.put(k.rod(k.name + '.loader.rail-post', (-1.30, sign * .87, 1.84), (-1.30, sign * .87, 2.35), .02, k.m['painted-edge'], k.col, vertices=4))

    # Guns and cradle. Each gun keeps its own cradle half so the two sides stay independent.
    length = mf - tf
    for side, (y, elevation, recoil) in k.sides.items():
        k.lathe('barrel', [(-.30, .125), (1.55, .118), (1.60, .10), (length - .1, .092), (length - .07, .106),
                           (length, .106), (length, .062), (length - .12, .062)], 'edge', recoil)
        k.put(k.box(k.name + '.breech-ring', (-.46, 0, 0), (.34, .31, .31), k.m['edge'], k.col), recoil)
        k.put(k.box(k.name + '.breech-block', (-.60, 0, -.02), (.12, .24, .36), k.m['dark'], k.col), recoil)
        # Cradle sleeve, recuperator and recoil cylinders over the gun with pointed front heads.
        # Half-width so the two cradles never touch; the recuperator pair rides on top.
        k.put(k.box(k.name + '.cradle', (-.05, 0, .02), (1.30, .60, .52), k.m['naval'], k.col), elevation)
        k.put(k.box(k.name + '.cradle.slide', (.85, 0, -.04), (.50, .34, .26), k.m['naval'], k.col), elevation)
        for off in (-.15, .15):
            k.lathe('recuperator', [(-.62, .11), (1.02, .11), (1.04, .125), (1.14, .125), (1.46, .03)], 'naval', elevation,
                    n=6, y=off, z=.36, smooth=False)
        # Cradle rear: breech guard, loading tray and the rammer bar.
        k.put(k.box(k.name + '.breech-guard', (-.55, 0, .20), (.95, .56, .06), k.m['naval'], k.col), elevation)
        k.put(k.box(k.name + '.loading-tray', (-.86, 0, -.24), (.48, .30, .05), k.m['painted-edge'], k.col), elevation)
        for w in (-.18, .18):
            k.put(k.box(k.name + '.tray-side', (-.86, w, -.18), (.48, .03, .14), k.m['painted-edge'], k.col), elevation)
        k.put(k.box(k.name + '.rammer-bar', (-1.0, 0, .44), (.26, .56, .08), k.m['naval'], k.col), elevation)
        k.put(k.rod(k.name + '.rammer-post', (-1.0, 0, .20), (-1.0, 0, .42), .03, k.m['edge'], k.col, vertices=6), elevation)
    return k.place()
