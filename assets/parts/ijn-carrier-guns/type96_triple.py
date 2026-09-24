"""Original 25 mm Type 96 triple mounts of Shokaku's December 1941 fit.

Two variants, each measured against one GameModels3D pjsa108 visual (the reference is
used for measurement and silhouette comparison only; no reference mesh is loaded here):

- `create_open`: the open triple (`jga173_25mm_type96`): fixed foundation ring, training
  carriage with raked side frames, crew seats, foot rests and hand wheels; one cradle per
  gun with receiver, 15-round box magazine, finned barrel, flash hider, case chute, rear
  grip frame, cross bar and the pointer's sight; toothed elevating arc and pinion.
- `create_shielded`: the carrier smoke-shield triple (`jga004_25mm_type96_triple_1`): the
  fixed twelve-sided drum, and a training shield of the same plan with a rolled roof edge,
  a scoop of ribs, slot dividers and crew channels falling to the front ledge, rails, and
  the same three guns behind mantlet plates.

Authoring frame: +X muzzle, +Y port, +Z up; the origin is the reference hardpoint (the
foot of the mount), so the catalog pivot is the reference trunnion height. Nodes follow
the shared barrel contract: `<id>.base` (fixed), `<id>.yaw`, `<side>.elevation`,
`<side>.recoil`, `<side>.muzzle`. Guns, magazines and receivers recoil; cradles, sights
and chutes elevate; each gun keeps its own lateral band so the three elevating groups
never touch.
"""
import math
import bmesh
import bpy
from mathutils import Matrix, Vector
from blender_barrels import barrel_layout


class _Kit:
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
        self.base = self.joint('base')
        self.yaw = self.joint('yaw', self.base)
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

    def solid(self, label, verts, faces, material, parent=None, smooth=False, recalc=True, thickness=0):
        obj = self.mesh(self.name + '.' + label, verts, faces, self.m[material], self.col, smooth)
        if recalc:
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            bm.to_mesh(obj.data)
            bm.free()
        if thickness:
            mod = obj.modifiers.new('Plate thickness', 'SOLIDIFY')
            mod.thickness = thickness
            mod.offset = 0
        return self.put(obj, parent)

    def loft(self, label, rings, material, parent=None, caps=(True, True), closed=True, wrap=False, smooth=False,
             thickness=0):
        """Rings of equal length joined by quads; `wrap` also joins the last ring to the first."""
        n = len(rings[0])
        verts = [tuple(p) for ring in rings for p in ring]
        span = n if closed else n - 1
        count = len(rings) if wrap else len(rings) - 1
        faces = [(j * n + i, j * n + (i + 1) % n, ((j + 1) % len(rings)) * n + (i + 1) % n, ((j + 1) % len(rings)) * n + i)
                 for j in range(count) for i in range(span)]
        if caps[0] and not wrap:
            faces.append(tuple(range(n)))
        if caps[1] and not wrap:
            faces.append(tuple(range(len(verts) - n, len(verts))))
        manifold = (closed and (wrap or (caps[0] and caps[1])))
        return self.solid(label, verts, faces, material, parent, smooth, recalc=manifold, thickness=thickness)

    def slab(self, label, outline, y0, y1, material, parent=None):
        """An (x, z) outline extruded across y0..y1."""
        return self.loft(label, [[(x, y0, z) for x, z in outline], [(x, y1, z) for x, z in outline]], material, parent)

    def plan(self, label, outline, z0, z1, material, parent=None):
        """An (x, y) outline extruded from z0 to z1."""
        return self.loft(label, [[(x, y, z0) for x, y in outline], [(x, y, z1) for x, y in outline]], material, parent)

    def lathe(self, label, profile, material, parent=None, n=8, smooth=True):
        """Surface of revolution about the local X axis; profile is (x, radius)."""
        rings = [[(x, r * math.cos(math.tau * (i + .5) / n), r * math.sin(math.tau * (i + .5) / n)) for i in range(n)]
                 for x, r in profile]
        return self.loft(label, rings, material, parent, smooth=smooth)

    def cube(self, label, center, size, material, parent=None, pitch=0.0, roll=0.0, yaw=0.0):
        obj = self.box(self.name + '.' + label, center, size, self.m[material], self.col)
        obj.rotation_euler = (math.radians(roll), math.radians(pitch), math.radians(yaw))
        return self.put(obj, parent)

    def bar(self, label, a, b, r, material='edge', parent=None, n=6):
        return self.put(self.rod(self.name + '.' + label, a, b, r, self.m[material], self.col, vertices=n), parent)

    def drum(self, label, center, r, h, material, parent=None, n=12):
        return self.put(self.cyl(self.name + '.' + label, center, r, h, self.m[material], self.col, n), parent)

    def torus(self, label, center, normal, R, r, material='edge', parent=None, n=10, k=3):
        normal = Vector(normal).normalized()
        a = normal.orthogonal().normalized()
        b = normal.cross(a)
        c = Vector(center)
        verts = []
        for i in range(n):
            t = i * math.tau / n
            d = a * math.cos(t) + b * math.sin(t)
            verts += [tuple(c + d * (R + r * math.cos(j * math.tau / k)) + normal * r * math.sin(j * math.tau / k)) for j in range(k)]
        faces = [(i * k + j, ((i + 1) % n) * k + j, ((i + 1) % n) * k + (j + 1) % k, i * k + (j + 1) % k)
                 for i in range(n) for j in range(k)]
        return self.solid(label, verts, faces, material, parent)

    def place(self):
        x, y, z = self.mount['position']
        self.base.location = (-z, -x, y)
        self.yaw.rotation_euler.z = -math.radians(self.mount['bearingDeg'])
        return self.yaw


def _arc(r, a0, a1, steps, teeth=0.0):
    """(x, z) points on an arc (degrees); `teeth` alternates the radius for a toothed rim."""
    out = []
    for i in range(steps + 1):
        t = math.radians(a0 + (a1 - a0) * i / steps)
        rr = r + (teeth if i % 2 else 0.0)
        out.append((rr * math.cos(t), rr * math.sin(t)))
    return out


# ---- The Type 96 gun (common to both mounts) ------------------------------------------
# Elevation-local frame: +X along the bore from the trunnion, +Z square to it, Y lateral
# about the gun's own bore. Measured from jga173 in its baked 30-degree pose: bore 1.81 m
# from the trunnion, finned jacket 0.17-0.92, barrel r 0.022, joint collar 1.44-1.62,
# conical flash hider to the muzzle; breech casing -0.61..0.17; feed block over the casing;
# 15-round box magazine standing 13 degrees forward of square to the bore.

def _gun(k, side, fins=True):
    y, elevation, recoil = k.sides[side]
    length = k.spec['muzzleForward'] - k.spec['trunnionForward']
    k.lathe('barrel', [(.17, .048), (.92, .048), (.92, .024), (1.444, .022), (1.444, .029), (1.62, .029), (1.62, .025),
                       (1.66, .026), (length - .01, .039), (length, .039), (length, .016), (length - .04, .016)], 'edge', recoil)
    k.cube('breech-casing', (-.22, 0, -.031), (.79, .137, .17), 'edge', recoil)
    k.slab('feed-block', [(-.463, .04), (-.002, .04), (-.002, .14), (-.08, .215), (-.463, .215)], -.05, .05, 'edge', recoil)
    k.cube('magazine', (-.118, 0, .254), (.276, .075, .357), 'naval', recoil, pitch=13)
    k.cube('magazine-lip', (-.118 + .19 * math.sin(math.radians(13)), 0, .254 + .19 * math.cos(math.radians(13))),
           (.20, .085, .025), 'edge', recoil, pitch=13)
    k.cube('buffer-plate', (-.62, 0, -.02), (.02, .16, .16), 'edge', recoil)
    k.bar('charging-handle', (-.32, .068, -.02), (-.32, .095, -.01), .014, 'edge', recoil, 4)
    if fins:
        k.bar('gas-cylinder', (.27, 0, -.065), (.86, 0, -.065), .036, 'edge', recoil, 6)
        for x in (.40, .55, .70):
            k.bar('cooling-fin', (x - .008, 0, -.04), (x + .008, 0, -.04), .066, 'edge', recoil, 6)
    return y, elevation, recoil


def _band(k, side, bands):
    """This gun's lateral band (absolute y) and its bounds relative to the gun's bore."""
    y = k.sides[side][0]
    a0, a1 = bands[side]
    return y, a0, a1, a0 - y, a1 - y, (a0 + a1) / 2 - y


def _cradle(k, side, bands, open_mount=True):
    y, a0, a1, r0, r1, mid = _band(k, side, bands)
    elevation = k.sides[side][1]
    width = r1 - r0
    outer = side != 'center'
    sign = 1 if y > 0 else -1
    k.cube('cradle-tray', (-.145, mid, -.12), (1.01, width, .02), 'naval', elevation)
    k.cube('cradle-front', (.33, mid, -.015), (.06, width, .23), 'naval', elevation)
    if outer:
        wall = (sign * .40 - y, sign * .42 - y)
        k.slab('cradle-side', [(-.65, -.13), (-.14, -.13), (.10, -.40), (.36, -.40), (.36, .10), (.05, .195), (-.65, .10)],
               min(wall), max(wall), 'naval', elevation)
        pin = (sign * .415 - y, (sign * .475 if open_mount else sign * .437) - y)
        k.bar('trunnion-pin', (0, pin[0], 0), (0, pin[1], 0), .035, 'edge', elevation, 8)
    return y, elevation, mid, r0, r1


# ---- Open triple (jga173) -------------------------------------------------------------

OPEN_BANDS = {'left': (.11, .42), 'center': (-.10, .10), 'right': (-.42, -.11)}
FRAME = [(-.332, .128), (.388, .128), (.388, .483), (.378, .508), (.201, .718), (-.086, .894), (-.088, .954),
         (-.166, .996), (-.297, .864), (-.332, .712)]


def create_open(mount, col, helpers, materials):
    """Type 96 open triple: foundation, carriage, crew stations and three articulated guns."""
    k = _Kit(mount, col, helpers, materials)
    s = k.spec
    tf, ph = s['trunnionForward'], s['pivotHeight']

    # Fixed foundation ring with its holding-down bolts; the carriage trains on it.
    k.drum('foundation-ring', (0, 0, .0215), .60, .043, 'naval', k.base, 16)
    for i in range(8):
        t = (i + .5) * math.tau / 8
        k.drum('foundation-bolt', (.55 * math.cos(t), .55 * math.sin(t), .05), .022, .016, 'edge', k.base, 6)

    # Carriage deck, raked side frames with trunnion bosses, gear housings and the
    # training pinion box ahead.
    k.cube('carriage-deck', (-.034, 0, .0855), (.954, .92, .085), 'naval')
    for sign in (1, -1):
        k.slab('side-frame', FRAME, sign * .478, sign * .532, 'naval')
        k.bar('trunnion-boss', (tf, sign * .53, ph), (tf, sign * .575, ph), .065, 'edge', None, 10)
        k.bar('frame-boss', (-.20, sign * .53, .45), (-.20, sign * .55, .45), .05, 'edge', None, 6)
        k.bar('frame-boss', (.14, sign * .53, .40), (.14, sign * .55, .40), .05, 'edge', None, 6)
        k.cube('side-gear-housing', (.0125, sign * .5845, .1665), (.589, .147, .177), 'naval')
        k.cube('front-gearbox', (.50, sign * .5165, .263), (.223, .169, .44), 'naval')
        k.cube('front-gearbox-cover', (.614, sign * .5165, .30), (.01, .12, .20), 'painted-edge')
    k.cube('training-pinion-box', (.5355, 0, .1245), (.205, .15, .17), 'naval')
    # Lower carriage: the walls of the training well and a sloped front apron. The well
    # between them stays open: breeches, grip frames and chutes swing through it.
    for sign in (1, -1):
        k.slab('well-side', [(-.33, .128), (.39, .128), (.39, .30), (.10, .37), (-.33, .37)], sign * .43, sign * .478, 'naval')
        k.bar('housing-bolt', (-.282, sign * .585, .17), (-.31, sign * .585, .17), .05, 'edge', None, 6)
    k.slab('front-apron', [(.20, .128), (.39, .128), (.39, .24), (.20, .28)], -.43, .43, 'naval')

    # Elevating pinion under the starboard arc, on a shaft into the starboard frame.
    t = math.radians(-60)
    px, pz = tf + .565 * math.cos(t), ph + .565 * math.sin(t)
    k.bar('elevating-pinion', (px, -.37, pz), (px, -.405, pz), .028, 'edge', None, 8)
    k.bar('elevating-pinion-shaft', (px, -.405, pz), (px, -.48, pz), .015, 'edge', None, 6)

    # Crew: pointer (port) and trainer (starboard) seats with backrests on arms off the
    # gear housings, and foot rests ahead on brackets from the front gearboxes.
    for sign in (1, -1):
        y0 = .853 * sign
        k.cube('seat', (-.138, y0, .278), (.30, .315, .03), 'naval')
        k.cube('seat-back', (-.37, y0, .47), (.05, .30, .24), 'naval', pitch=-10)
        for dy in (-.12, .12):
            k.bar('seat-back-post', (-.28, y0 + dy, .28), (-.36, y0 + dy, .40), .014, 'painted-edge', None, 4)
        k.bar('seat-arm', (-.20, sign * .60, .19), (-.20, y0, .265), .022, 'painted-edge', None, 6)
        k.bar('seat-arm', (.05, sign * .60, .19), (-.02, y0, .265), .022, 'painted-edge', None, 6)
        k.cube('foot-rest', (.72, y0, .227), (.05, .34, .16), 'edge', pitch=20)
        k.bar('foot-rest-bracket', (.55, sign * .56, .12), (.70, y0, .18), .02, 'painted-edge', None, 6)
        k.bar('foot-rest-bar', (.70, y0 - .15, .17), (.70, y0 + .15, .17), .015, 'painted-edge', None, 4)

    # Trainer's hand wheel on its shaft into the starboard front gearbox.
    c, normal = Vector((.148, -.851, .616)), Vector((-.66, 0, .75)).normalized()
    k.torus('trainer-handwheel', c, normal, .16, .015, 'edge', None, 10, 3)
    a = normal.orthogonal().normalized()
    b = normal.cross(a)
    for d in (a, b):
        k.bar('handwheel-spoke', tuple(c - d * .16), tuple(c + d * .16), .01, 'edge', None, 4)
    k.bar('handwheel-knob', tuple(c + a * .16), tuple(c + a * .16 + normal * .08), .014, 'edge', None, 4)
    k.bar('handwheel-shaft', tuple(c), (.42, -.58, .40), .022, 'edge', None, 6)
    # Pointer's crank box on a strut from the port foot rest.
    k.bar('pointer-strut', (.70, .853, .18), (.15, .857, .64), .018, 'painted-edge', None, 6)
    k.cube('pointer-crank-box', (.13, .857, .665), (.11, .10, .09), 'edge')
    k.bar('pointer-crank', (.13, .905, .665), (.09, .95, .60), .012, 'edge', None, 4)
    k.bar('pointer-crank-handle', (.09, .95, .60), (.09, 1.01, .60), .016, 'edge', None, 6)

    # Three guns, each on its own cradle band.
    for side in ('left', 'center', 'right'):
        _gun(k, side)
        y, elevation, mid, r0, r1 = _cradle(k, side, OPEN_BANDS)
        # Spent-case chute hanging forward-down from the cradle.
        k.cube('case-chute', (.19, 0, -.37), (.10, .14, .50), 'naval', elevation, pitch=-14)
        # Cross bar (pointer's and trainer's grips at its ends) on a post from the cradle front.
        a0, a1 = OPEN_BANDS[side]
        lo, hi = (a0, a1)
        if side == 'left':
            hi = .86
        if side == 'right':
            lo = -.86
        k.bar('cross-bar', (.24, lo - y, .142), (.24, hi - y, .142), .016, 'edge', elevation, 4)
        k.bar('cross-bar-post', (.30, mid, .08), (.24, mid, .142), .014, 'edge', elevation, 4)
        # Loaders' shoulder rests curving up and forward off the rear grip frame.
        for yb in ((-.075, .075) if side == 'center' else ((.39 if y > 0 else -.39) - y,)):
            rest = [(-.74, yb, -.02), (-.76, yb, .10), (-.70, yb, .22), (-.56, yb, .24)]
            for p, q in zip(rest, rest[1:]):
                k.bar('shoulder-rest', p, q, .014, 'edge', elevation, 4)
        if side != 'center':
            sign = 1 if y > 0 else -1
            k.cube('grip-pad', (.24, sign * .78 - y, .142), (.08, .16, .08), 'naval', elevation)
            # Rear grip frame behind the gun.
            k.bar('rear-frame', (-.64, sign * .405 - y, -.02), (-.74, sign * .405 - y, -.02), .015, 'edge', elevation, 4)
            k.bar('rear-frame', (-.74, sign * .405 - y, -.02), (-.74, sign * .14 - y, -.02), .015, 'edge', elevation, 4)
        else:
            for dy in (-.095, .095):
                k.bar('rear-frame', (-.64, dy, -.11), (-.74, dy, -.02), .014, 'edge', elevation, 4)
            k.bar('rear-frame', (-.74, -.095, -.02), (-.74, .095, -.02), .014, 'edge', elevation, 4)

    # Pointer's sight on an arm off the port cradle side: drum head, telescope and lens.
    y, elevation, _ = k.sides['left']
    k.bar('sight-arm', (0, .40 - y, .12), (.30, .59 - y, .22), .018, 'edge', elevation, 6)
    k.drum('sight-head', (.33, .59 - y, .24), .09, .07, 'edge', elevation, 10)
    k.put(k.cyl(k.name + '.sight-cap', (.33, .59 - y, .295), .06, .04, k.m['edge'], k.col, 10, .03), elevation)
    k.cube('sight-bracket', (.33, .64 - y, .25), (.06, .06, .04), 'edge', elevation)
    k.bar('sight-telescope', (.18, .66 - y, .25), (.46, .66 - y, .25), .028, 'edge', elevation, 8)
    k.bar('sight-lens', (.46, .66 - y, .25), (.47, .66 - y, .25), .022, 'glass', elevation, 8)

    # Toothed elevating arc on the starboard cradle, meshing with the fixed pinion.
    y, elevation, _ = k.sides['right']
    rim = _arc(.52, -20, -160, 14, .015)
    outline = [(.489, -.12)] + rim + [(-.489, -.12)]
    k.slab('elevating-arc', outline, -.40 - y, -.375 - y, 'edge', elevation)
    return k.place()


# ---- Smoke-shield triple (jga004) ----------------------------------------------------

SHIELD_BANDS = {'left': (.21, .42), 'center': (-.12, .12), 'right': (-.42, -.21)}
R_SHELL = 1.8
# The scoop at the front of the shield: rib/divider top curve and the channel floor.
RIB_TOP = [(-.306, 2.198), (.048, 2.198), (.444, 2.121), (.732, 1.858), (1.095, .946)]
FLOOR = [(-.306, 1.891), (-.063, 1.893), (.309, 1.822), (.522, 1.68), (.66, 1.45), (.744, 1.10)]


def _gon(r, n=12, phase=0.0):
    return [(r * math.cos(phase + i * math.tau / n), r * math.sin(phase + i * math.tau / n)) for i in range(n)]


def create_shielded(mount, col, helpers, materials):
    """Smoke-shield Type 96 triple: fixed drum, training shield with the scoop and slots, three guns."""
    k = _Kit(mount, col, helpers, materials)
    zd = .657  # drum top: the shield turns on it

    # Fixed drum: a hollow twelve-sided bulwark with a base plate; the guns' breeches
    # swing down inside it at high elevation.
    outer, inner = _gon(1.70), _gon(1.62)
    k.loft('drum', [[(x, y, 0) for x, y in outer], [(x, y, zd) for x, y in outer],
                    [(x, y, zd) for x, y in inner], [(x, y, 0) for x, y in inner]], 'naval', k.base, wrap=True)
    k.plan('drum-base-plate', inner, 0, .02, 'roof', k.base)
    # Training floor on a pedestal inside the drum.
    k.drum('pedestal', (0, 0, .16), .40, .28, 'naval', None, 16)
    k.drum('training-floor', (0, 0, .315), 1.50, .03, 'roof', None, 16)
    # Gun carriage cheeks carrying the trunnions (under the ribs).
    tf, ph = k.spec['trunnionForward'], k.spec['pivotHeight']
    for sign in (1, -1):
        k.slab('carriage-cheek', [(-.35, .33), (.40, .33), (tf + .10, ph + .07), (tf - .10, ph + .07)],
               sign * .44, sign * .50, 'naval')
        k.bar('trunnion-boss', (tf, sign * .50, ph), (tf, sign * .53, ph), .06, 'edge', None, 8)

    # Shield wall: twelve-sided plan (R 1.8) whose top falls from the roof edge to the front
    # ledge, notched low where the guns depress.
    half = [(1.800, 0.0, .85), (1.682, .44, .85), (1.673, .475, 1.10), (1.559, .90, 1.10), (.90, 1.559, 1.10),
            (.74, 1.603, 1.10), (.62, 1.634, 1.72), (.43, 1.685, 1.954), (0.0, 1.80, 1.954), (-.90, 1.559, 1.954),
            (-1.559, .90, 1.954), (-1.80, 0.0, 1.954)]
    ring = half + [(x, -y, z) for x, y, z in reversed(half[1:-1])]
    t = (R_SHELL - .05) / R_SHELL
    k.loft('shield-wall', [[(x, y, zd) for x, y, _ in ring], [(x, y, z) for x, y, z in ring],
                           [(x * t, y * t, z) for x, y, z in ring], [(x * t, y * t, zd + .03) for x, y, _ in ring]],
           'naval', wrap=True)
    base_o, base_i = _gon(1.79), _gon(1.60)
    k.loft('shield-base-ring', [[(x, y, zd) for x, y in base_o], [(x, y, zd + .03) for x, y in base_o],
                                [(x, y, zd + .03) for x, y in base_i], [(x, y, zd) for x, y in base_i]], 'naval', wrap=True)
    # Rolled roof edge over the rear of the shield, and the roof.
    rear = [p for p in ring if p[2] > 1.9]
    rear.sort(key=lambda p: math.atan2(p[1], p[0]) % math.tau)
    c = 1.64 / R_SHELL
    k.loft('roof-edge', [[(x, y, 1.954) for x, y, _ in rear], [(x * c, y * c, 2.096) for x, y, _ in rear]], 'roof',
           caps=(False, False), closed=False, thickness=.04)
    k.plan('roof', [(-.306, -1.155), (-.306, 1.155), (-.82, 1.42), (-1.42, .82), (-1.64, 0), (-1.42, -.82), (-.82, -1.42)],
           2.056, 2.096, 'roof')
    for sign in (1, -1):
        k.plan('roof', [(-.306, sign * 1.155), (.43, sign * 1.155), (.392, sign * 1.535), (0, sign * 1.64), (-.82, sign * 1.42)],
               2.056, 2.096, 'roof')

    for sign in (1, -1):
        def ys(a, b):
            return (sign * a, sign * b) if sign > 0 else (sign * b, sign * a)
        # Cheek: the shield's shoulder falling from the roof to the ledge.
        cheek = [(-.306, 2.096), (.43, 2.096), (.62, 1.78), (.744, 1.10)] + list(reversed(FLOOR[1:-1])) + [(-.306, 1.891)]
        k.slab('shield-cheek', cheek, *ys(1.155, 1.62), 'naval')
        # Crew channel: its floor falls from the roof step to the ledge.
        prof = [(-.306, 2.096)] + FLOOR + [(.80, 1.10)]
        y0, y1 = ys(.687, 1.155)
        k.loft('crew-channel', [[(x, y0, z) for x, z in prof], [(x, y1, z) for x, z in prof]], 'naval',
               caps=(False, False), closed=False, thickness=.03)
        # Rib either side of the gun well, and the thin slot divider: crescents on the scoop.
        crescent = RIB_TOP + [(.826, .946)] + list(reversed(FLOOR[1:-1])) + [(-.306, 1.891)]
        k.slab('shield-rib', crescent, *ys(.43, .687), 'naval')
        divider = RIB_TOP[:-1] + [(1.095, .85), (.826, .85)] + list(reversed(FLOOR[1:-1])) + [(-.306, 1.891)]
        k.slab('slot-divider', divider, *ys(.13, .20), 'naval')
        # Slot floors: the scoop continues over each gun slot, leaving a narrow slit in
        # the plane of the barrel (its jacket and mantlet pass through it) that opens
        # into the notch in front.
        slot = FLOOR + [(.744, .85)]
        for a, b in ((.065, .13), (.20, .235), (.365, .43)):
            y0, y1 = ys(a, b)
            k.loft('slot-floor', [[(x, y0, z) for x, z in slot], [(x, y1, z) for x, z in slot]], 'naval',
                   caps=(False, False), closed=False, thickness=.03)
        # Front ledge beside the gun well and its step down to the notch.
        k.plan('front-ledge', [(.744, sign * .44), (1.63, sign * .44), (1.51, sign * .87), (.87, sign * 1.51),
                               (.744, sign * 1.56)], 1.06, 1.10, 'roof')
        k.cube('ledge-step', (1.19, sign * .45, .955), (.90, .02, .29), 'naval')
        # Front rails round the ledge.
        posts = [(.76, sign * 1.50), (1.32, sign * 1.04), (1.555, sign * .58)]
        for x, y in posts:
            k.bar('ledge-rail-post', (x, y, 1.10), (x, y, 1.66), .014, 'painted-edge', None, 4)
        for z in (1.64,):
            for (xa, ya), (xb, yb) in zip(posts, posts[1:]):
                k.bar('ledge-rail', (xa, ya, z), (xb, yb, z), .014, 'painted-edge', None, 4)
    # Notch floor under the guns (held lower than the reference so the barrels clear it at
    # -10 degrees), the gun well's back, ceiling and rear wall.
    k.plan('well-notch', [(.74, -.44), (1.63, -.44), (1.75, 0), (1.63, .44), (.74, .44)], .81, .85, 'roof')
    k.cube('well-back', (-.75, 0, 1.11), (.02, .86, 1.56), 'naval')
    k.cube('well-ceiling', (-.528, 0, 1.88), (.444, .86, .02), 'naval')
    k.cube('well-rear-wall', (-.291, 0, 1.994), (.03, .86, .205), 'naval')

    # Roof rail round the rear edge, stepping down each cheek.
    pts = [(.62, 1.47, 2.20), (.42, 1.51, 2.20), (0, 1.56, 2.20), (-.80, 1.36, 2.20), (-1.39, .75, 2.20), (-1.60, 0, 2.20)]
    path = pts + [(x, -y, z) for x, y, z in reversed(pts[:-1])]
    for a, b in zip(path, path[1:]):
        k.bar('roof-rail', a, b, .015, 'painted-edge', None, 4)
    for x, y, z in path:
        base = 1.78 if abs(x - .62) < .01 else 2.096
        k.bar('roof-rail-post', (x, y, base), (x, y, z), .012, 'painted-edge', None, 4)

    # Guns: cradle tray, front, sides and pins, and a mantlet plate that closes each slit
    # behind the barrel as it elevates.
    for side in ('left', 'center', 'right'):
        _gun(k, side, fins=False)
        y, elevation, mid, r0, r1 = _cradle(k, side, SHIELD_BANDS, open_mount=False)
        k.cube('mantlet', (.67, 0, .02), (.02, .12, .40), 'naval', elevation)
    y, elevation, _ = k.sides['right']
    rim = _arc(.52, -20, -160, 14, .015)
    k.slab('elevating-arc', [(.489, -.12)] + rim + [(-.489, -.12)], -.40 - y, -.375 - y, 'edge', elevation)
    return k.place()
