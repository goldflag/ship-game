"""Original Royal Navy twin 40 mm Bofors mountings: STAAG Mk II and the Hazemeyer Mk IV.

Proportions are interpreted from the approved GameModels3D references
`bga036_staag_markv` and `bga060_40mm_bofors_mark_iv_hazemeyer`; no reference mesh,
transform or texture is loaded and no geometry is taken from another recipe. Both
mounts share the barrel, cradle and receiver code because they carry the same
water-jacketed twin 40 mm gun; everything around it differs.

Authoring frame: +X muzzle, +Y port, +Z up, metres. The sole plane is z = 0 and the
yaw datum sits on it. Joints follow the shared AA contract: `yaw`, then per barrel
`<side>.elevation` (uniform station), `<side>.recoil`, `<side>.muzzle`.
"""
import bpy
import math
from mathutils import Matrix
from blender_barrels import barrel_layout

TAU = math.tau


class Twin:
    """Named joints, painted/bare roles, and the lofts the two mountings share."""

    def __init__(self, mount, col, helpers, materials):
        self.mount, self.col, self.h = mount, col, helpers
        palette = dict(materials)
        palette.setdefault('roof', palette['naval'])
        palette.setdefault('painted-edge', palette['edge'])
        palette.setdefault('glass', palette['dark'])
        self.m = palette
        self.name = mount['id']
        self.spec = mount['weapon']
        self.yaw = self.joint('yaw')

    # -- scaffolding -------------------------------------------------------
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

    def role(self, key):
        return self.m.get(key, self.m['naval'])

    def box(self, label, loc, dim, key='naval', parent=None):
        return self.put(self.h['box'](self.name + '.' + label, loc, dim, self.role(key), self.col), parent)

    def cyl(self, label, loc, radius, depth, key='naval', parent=None, r2=None, vertices=16):
        return self.put(self.h['cyl'](self.name + '.' + label, loc, radius, depth,
                                      self.role(key), self.col, vertices, r2), parent)

    def rod(self, label, a, b, radius, key='edge', parent=None, r2=None, vertices=8):
        return self.put(self.h['rod'](self.name + '.' + label, a, b, radius,
                                      self.role(key), self.col, r2, vertices), parent)

    def mesh(self, label, verts, faces, key='naval', parent=None, smooth=False):
        return self.put(self.h['mesh'](self.name + '.' + label, verts, faces,
                                       self.role(key), self.col, smooth), parent)

    # -- lofts -------------------------------------------------------------
    def plate(self, label, profile, y0, y1, key='naval', parent=None):
        """Closed (x, z) profile extruded across y; profile runs counter-clockwise."""
        k = len(profile)
        verts = [(x, y, z) for y in (y0, y1) for x, z in profile]
        faces = [tuple(reversed(range(k))), tuple(range(k, 2 * k))]
        faces += [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)]
        return self.mesh(label, verts, faces, key, parent)

    def wall(self, label, stations, z_bottom, thickness=.055, key='naval', parent=None):
        """Open plate wall. Each station is (x_foot, y_foot, x_head, y_head, z_head).

        The path keeps its interior on the left, so the inward offset is -(dy, -dx).
        Both faces, the coaming and the two end reveals are built, so the wall reads
        as plating from inside the tub as well as from outside.
        """
        count = len(stations)
        normals = []
        for i in range(count):
            a = stations[max(0, i - 1)]
            b = stations[min(count - 1, i + 1)]
            dx, dy = b[0] - a[0], b[1] - a[1]
            length = math.hypot(dx, dy) or 1.
            normals.append((dy / length, -dx / length))
        verts = []
        for (xf, yf, xh, yh, zh), (nx, ny) in zip(stations, normals):
            verts += [(xf, yf, z_bottom), (xf - nx * thickness, yf - ny * thickness, z_bottom),
                      (xh, yh, zh), (xh - nx * thickness, yh - ny * thickness, zh)]
        faces = []
        for i in range(count - 1):
            o, n = 4 * i, 4 * (i + 1)
            faces += [(o + 0, n + 0, n + 2, o + 2),      # outer face
                      (o + 3, n + 3, n + 1, o + 1),      # inner face
                      (o + 2, n + 2, n + 3, o + 3),      # coaming
                      (o + 1, n + 1, n + 0, o + 0)]      # sole
        last = 4 * (count - 1)
        faces += [(0, 2, 3, 1), (last + 1, last + 3, last + 2, last + 0)]
        return self.mesh(label, verts, faces, key, parent)

    def tube(self, label, rings, key='edge', parent=None, sides=10, smooth=True):
        """Revolved (station, radius) profile about the local +X axis."""
        verts = [(s, r * math.cos(TAU * i / sides), r * math.sin(TAU * i / sides))
                 for s, r in rings for i in range(sides)]
        faces = [(j * sides + i, j * sides + (i + 1) % sides,
                  (j + 1) * sides + (i + 1) % sides, (j + 1) * sides + i)
                 for j in range(len(rings) - 1) for i in range(sides)]
        return self.mesh(label, verts, faces, key, parent, smooth)

    def hoop(self, label, centre, radius, axis='y', parent=None, wire=.014, key='painted-edge', steps=12):
        x, y, z = centre
        points = []
        for i in range(steps):
            a = TAU * i / steps
            points.append((x + radius * math.cos(a), y, z + radius * math.sin(a)) if axis == 'y'
                          else (x, y + radius * math.cos(a), z + radius * math.sin(a)))
        for a, b in zip(points, points[1:] + points[:1]):
            self.rod(label, a, b, wire, key, parent, vertices=5)
        return points

    def handwheel(self, label, centre, radius, parent=None, axis='y'):
        points = self.hoop(label, centre, radius, axis, parent, .016, 'edge', 10)
        for i in (0, 3, 7):
            self.rod(label + '-spoke', centre, points[i], .012, 'edge', parent, vertices=4)

    def railing(self, label, path, height, parent=None, posts=None, key='painted-edge'):
        """Tubular guard rail: a top rail following `path` on vertical stanchions."""
        top = [(x, y, z + height) for x, y, z in path]
        for a, b in zip(top, top[1:]):
            self.rod(label, a, b, .022, key, parent, vertices=5)
        for index in (posts if posts is not None else range(len(path))):
            x, y, z = path[index]
            self.rod(label + '-stanchion', (x, y, z), (x, y, z + height), .021, key, parent, vertices=5)
        return top

    def ladder(self, label, foot, head, width, rungs, parent=None, across='y'):
        (x0, y0, z0), (x1, y1, z1) = foot, head
        step = (width / 2, 0) if across == 'y' else (0, width / 2)
        for side in (-1, 1):
            dy, dx = side * step[0], side * step[1]
            self.rod(label + '-stringer', (x0 + dx, y0 + dy, z0), (x1 + dx, y1 + dy, z1),
                     .022, 'painted-edge', parent, vertices=5)
        for i in range(rungs):
            t = (i + .5) / rungs
            x, y, z = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t
            self.rod(label + '-rung', (x - step[1], y - step[0], z), (x + step[1], y + step[0], z),
                     .016, 'painted-edge', parent, vertices=4)

    # -- the gun itself ----------------------------------------------------
    def gun(self, jacket_start, jacket_end, collar, breech_back, feed=True, feed_at=None,
            jacket_r=.086, band_r=.102, chase_r=.084, hider_r=.098, muzzle_r=.079, tip_r=.075):
        """Twin water-jacketed barrels, cradles, receivers and the loaders' clips.

        Returns the two elevation joints, port first. Joints stay on the uniform
        simulation stations; only the visible tubes and their fittings are placed.
        """
        spec = self.spec
        reach = spec['muzzleForward'] - spec['trunnionForward']
        bore = spec['caliberM'] / 2
        pivots = []
        for side, lateral, _ in barrel_layout(spec):
            elevation = self.joint(side + '.elevation', self.yaw,
                                   (spec['trunnionForward'], lateral, spec['pivotHeight']))
            elevation.rotation_euler.y = -math.radians(self.mount.get('initialElevationDeg', 1))
            recoil = self.joint(side + '.recoil', elevation)
            self.joint(side + '.muzzle', recoil, (reach, 0, 0))
            pivots.append((side, lateral, elevation, recoil))

            # Jacket, chase, flash hider and a dark bore, in one connected surface.
            self.tube(side + '-barrel', [
                (jacket_start, jacket_r), (collar - .13, jacket_r), (collar - .13, band_r),
                (collar, band_r), (collar, chase_r), (jacket_end, chase_r), (jacket_end, hider_r),
                (reach - .085, hider_r), (reach - .06, muzzle_r), (reach, tip_r),
                (reach, bore)], 'edge', recoil, 10)
            self.rod(side + '-bore', (reach - .16, 0, 0), (reach - .002, 0, 0), bore * .98,
                     'dark', recoil, vertices=10)
            # Jacket bands and the water connection that rides the recoiling mass.
            for station in (jacket_start + .30, jacket_start + .74):
                self.cyl(side + '-jacket-band', (station, 0, 0), jacket_r + .012, .035, 'edge',
                         recoil, vertices=10).rotation_euler.y = math.pi / 2
            self.rod(side + '-water-pipe', (jacket_start + .12, 0, jacket_r + .014),
                     (jacket_end - .22, 0, jacket_r + .034), .019, 'edge', recoil, vertices=5)

            # Receiver, breech casing and the automatic loader's guides.
            self.box(side + '-receiver', ((breech_back + jacket_start) / 2, 0, -.005),
                     (jacket_start - breech_back, .20, .23), 'edge', recoil)
            self.box(side + '-breech-casing', (breech_back + .09, 0, .04), (.20, .24, .29), 'naval', recoil)
            self.rod(side + '-cocking-lever', (breech_back + .30, .10, .02), (breech_back + .30, .18, -.05),
                     .018, 'edge', recoil, vertices=5)
            if feed:
                hopper = jacket_start - .30 if feed_at is None else feed_at
                self.box(side + '-feed-hopper', (hopper, 0, .23), (.26, .21, .26), 'naval', recoil)
                for offset in (-.09, 0, .09):
                    self.rod(side + '-loaded-clip', (hopper + offset, 0, .16),
                             (hopper + offset, 0, .50), .022, 'edge', recoil, vertices=6)
            self.box(side + '-case-chute', (breech_back + .16, 0, -.24), (.34, .17, .18), 'dark', recoil)
        return pivots

    def cradle(self, pivot, half, back, front, drop=-.17):
        """Shared elevating cradle, recoil cylinders and the trunnion bearings."""
        side, lateral, elevation, _ = pivot
        centre = -lateral
        self.plate(side + '-cradle', [(back, drop - .10), (front, drop - .10), (front, drop + .12),
                                      (back + .10, drop + .16)],
                   centre - half, centre + half, 'naval', elevation)
        self.rod(side + '-trunnion-pin', (0, centre - half - .16, 0), (0, centre + half + .16, 0),
                 .075, 'edge', elevation, vertices=10)
        for sign in (-1, 1):
            y = centre + sign * (half - .09)
            self.rod(side + '-recoil-cylinder', (back + .08, y, drop - .07), (front - .06, y, drop - .07),
                     .050, 'naval', elevation, vertices=8)
        return elevation, centre

    def finish(self):
        x, y, z = self.mount['position']
        self.yaw.location = (-z, -x, y)
        self.yaw.rotation_euler.z = -math.radians(self.mount['bearingDeg'])
        return self.yaw


# ---------------------------------------------------------------------------
# STAAG Mk II: Stabilised Tachymetric Anti-Aircraft Gun
# ---------------------------------------------------------------------------
# The reference is a shielded tub on a roller path: a full-width faceted front
# plate with a slotted gun port between two raised cheeks, side plating that runs
# aft and stops short of the stern, and an open working deck behind it carrying
# the gyro housing, the layers' ring sights and the mounting's own radar.

STAAG_WALL = [
    (-0.92, -1.98, -0.92, -1.84, 2.38),
    (-0.10, -2.04, -0.10, -1.90, 2.46),
    (0.31, -2.00, 0.31, -1.92, 2.54),
    (1.17, -1.44, 1.36, -1.47, 1.52),
    (1.36, -0.62, 1.36, -0.69, 1.52),
    (1.36, 0.62, 1.36, 0.69, 1.52),
    (1.17, 1.44, 1.36, 1.47, 1.52),
    (0.31, 2.00, 0.31, 1.92, 2.54),
    (-0.10, 2.04, -0.10, 1.90, 2.46),
    (-0.92, 1.98, -0.92, 1.84, 2.38),
]

STAAG_DECK = [(1.14, -1.34), (0.33, -1.82), (-0.56, -1.86), (-1.04, -1.80), (-1.33, -1.66),
              (-1.54, -1.30), (-1.54, 1.30), (-1.33, 1.66), (-1.04, 1.80), (-0.56, 1.86),
              (0.33, 1.82), (1.14, 1.34)]


def staag(b):
    spec = b.spec
    trunnion, pivot_height = spec['trunnionForward'], spec['pivotHeight']

    # Roller path, training rack and the pedestal that carries the rotating deck.
    b.cyl('roller-path', (0, 0, .14), .70, .28, 'edge', vertices=20)
    b.cyl('training-rack', (0, 0, .30), .62, .09, 'painted-edge', vertices=20)
    b.cyl('pedestal', (0, 0, .53), .47, .40, 'naval', vertices=20)

    # Rotating deck on radial brackets, with a kerb under the shield foot.
    k = len(STAAG_DECK)
    b.mesh('deck', [(x, y, z) for z in (.72, .82) for x, y in STAAG_DECK],
           [tuple(range(k)), tuple(range(2 * k - 1, k - 1, -1))]
           + [(i, i + k, (i + 1) % k + k, (i + 1) % k) for i in range(k)], 'roof')
    for i in range(k):
        a, c = STAAG_DECK[i], STAAG_DECK[(i + 1) % k]
        b.rod('deck-kerb', (a[0], a[1], .85), (c[0], c[1], .85), .035, 'painted-edge', vertices=4)
        b.rod('deck-bracket', (a[0] * .40, a[1] * .40, .56), (a[0] * .94, a[1] * .94, .70),
              .040, 'painted-edge', vertices=4)

    # Faceted shield: front plate, gun-port cheeks and side plating.
    b.wall('shield', STAAG_WALL, .26, .06)
    for sign in (-1, 1):
        b.plate('gun-port-cheek', [(1.32, 1.36), (1.32, 1.58), (0.50, 2.62), (0.40, 2.62),
                                   (0.40, 2.02), (1.02, 1.36)],
                sign * .38, sign * .62, 'naval')
        # Plated-on detail: an access hatch, a vision slit and the lifting eyes.
        b.box('shield-vision-slit', (1.37, sign * 1.05, 1.32), (.05, .34, .09), 'dark')
        b.box('shield-hatch', (0.28, sign * 1.98, 1.24), (.56, .10, .72), 'painted-edge')
        for x in (-.30, -.76):
            b.box('shield-rib', (x, sign * 1.97, 1.46), (.10, .10, 1.06), 'painted-edge')
        b.rod('shield-lifting-eye', (0.20, sign * 1.94, 2.56), (0.20, sign * 1.76, 2.60),
              .030, 'painted-edge', vertices=5)
        b.box('shield-stowage', (-.66, sign * 1.32, 2.40), (.52, .34, .26), 'naval')
        b.rod('shield-stowage-strap', (-.66, sign * 1.32, 2.54), (-.66, sign * 1.32, 2.28),
              .022, 'painted-edge', vertices=4)

    # Open stern: a tubular rail on stanchions rising from the deck kerb.
    stern = [(-0.92, 1.88, .84), (-1.33, 1.66, .84), (-1.54, 1.30, .84),
             (-1.54, -1.30, .84), (-1.33, -1.66, .84), (-0.92, -1.88, .84)]
    top = b.railing('stern-rail', stern, 1.54)
    middle = [(x, y, z - .74) for x, y, z in top]
    for a, c in zip(middle, middle[1:]):
        b.rod('stern-rail-course', a, c, .018, 'painted-edge', vertices=5)

    # Trunnion frame: side cheeks carrying the bearings, with a bridging beam.
    arc = [(trunnion + .165 * math.cos(math.radians(a)), pivot_height + .165 * math.sin(math.radians(a)))
           for a in (-52, 0, 52, 104, 156, 208)]
    profile = [(-.12, .76), (.62, .76), (.72, 1.04), (.40, 1.58)] + arc + [(-.12, 1.32)]
    for sign in (-1, 1):
        b.plate('trunnion-cheek', profile, sign * .455, sign * .545, 'naval')
        b.cyl('trunnion-bearing', (trunnion, sign * .50, pivot_height), .155, .12, 'edge',
              vertices=14).rotation_euler.x = math.pi / 2
    b.box('trunnion-beam', (.30, 0, .92), (.62, 1.02, .24), 'naval')

    # Gyro and elevating-gear housing, with the stabiliser case on its crown.
    # Its forward face stands clear of the elevating gear's arc at full depression.
    b.box('gyro-housing', (-.90, 0, 1.32), (.58, .92, 1.04), 'naval')
    b.box('stabiliser-case', (-.92, 0, 2.03), (.56, .86, .30), 'edge')
    b.box('training-motor', (-.34, 0, 1.02), (.36, .62, .44), 'edge')
    for sign in (-1, 1):
        b.rod('gyro-conduit', (-.62, sign * .46, 1.82), (-.62, sign * .46, 1.00), .026, 'edge', vertices=5)

    # Layers' ring sights on braced arms above the stabiliser case.
    for sign in (-1, 1):
        y = sign * .50
        b.rod('sight-arm', (-1.30, y, 2.22), (-.82, y, 2.70), .032, 'painted-edge', vertices=6)
        b.rod('sight-arm-brace', (-.98, y, 2.20), (-.84, y, 2.62), .022, 'painted-edge', vertices=5)
        b.hoop('ring-sight', (-.82, y, 2.76), .095, 'x', wire=.010, key='edge')
        b.rod('ring-sight-bar', (-.82, y - .095, 2.76), (-.82, y + .095, 2.76), .005, 'edge', vertices=4)
        b.rod('ring-sight-bar', (-.82, y, 2.665), (-.82, y, 2.855), .005, 'edge', vertices=4)
        b.rod('sight-bead', (-.50, y, 2.60), (-.50, y, 2.68), .011, 'edge', vertices=5)
        b.rod('sight-bead-post', (-.50, y, 2.34), (-.50, y, 2.60), .017, 'painted-edge', vertices=5)
        # Layer's seat and footplate on the after deck.
        b.rod('layer-seat-column', (-1.30, y, .84), (-1.30, y, 1.86), .055, 'naval', vertices=8)
        b.cyl('layer-seat', (-1.30, y, 1.90), .19, .07, 'roof', vertices=10)
        b.box('layer-seat-back', (-1.46, y, 2.10), (.06, .34, .33), 'roof')
        b.rod('layer-backrest-post', (-1.46, y, 1.88), (-1.46, y, 2.03), .022, 'painted-edge', vertices=5)
        b.box('layer-footplate', (-.90, sign * .74, 1.32), (.34, .30, .05), 'painted-edge')
        b.rod('layer-footplate-bracket', (-.90, sign * .47, 1.22), (-.90, sign * .74, 1.32),
              .020, 'painted-edge', vertices=5)
        b.handwheel('layer-handwheel', (-1.06, sign * .76, 1.86), .155)
        b.rod('layer-handwheel-shaft', (-1.06, sign * .46, 1.86), (-1.06, sign * .76, 1.86),
              .028, 'edge', vertices=6)

        # Ready-use lockers against the side plating, with a clip rack on top.
        b.box('ready-use-locker', (-.30, sign * 1.10, 1.30), (.66, .52, .92), 'naval')
        b.box('ready-use-lid', (-.30, sign * 1.10, 1.78), (.70, .56, .05), 'painted-edge')
        for i in range(3):
            b.rod('ready-clip', (-.50 + i * .20, sign * 1.10, 1.81), (-.50 + i * .20, sign * 1.10, 2.06),
                  .024, 'edge', vertices=6)
        b.box('spent-case-bin', (.62, sign * 1.14, 1.08), (.46, .44, .48), 'edge')

    # Type 262 radar on its own stand on the port quarter of the deck.
    for x, y in ((-.24, 1.12), (-.24, 1.56), (-.72, 1.34)):
        b.rod('radar-stand-leg', (x, y, .84), (x, y, 2.42), .045, 'naval', vertices=6)
    b.rod('radar-stand-brace', (-.24, 1.12, 1.70), (-.72, 1.34, 1.94), .024, 'painted-edge', vertices=5)
    b.rod('radar-stand-brace', (-.24, 1.56, 1.70), (-.72, 1.34, 1.94), .024, 'painted-edge', vertices=5)
    b.box('radar-yoke', (-.42, 1.34, 2.58), (.44, .84, .34), 'naval')
    b.rod('radar-trunnion', (-.42, 1.02, 2.72), (-.42, 1.66, 2.72), .038, 'edge', vertices=8)
    b.rod('radar-dish', (-.30, 1.34, 3.18), (-.06, 1.34, 3.22), .36, 'naval', r2=.30, vertices=14)
    b.cyl('radar-dish-face', (-.07, 1.34, 3.21), .29, .03, 'dark', vertices=14).rotation_euler.y = math.pi / 2
    b.rod('radar-feed-boom', (-.07, 1.34, 3.21), (.20, 1.34, 3.22), .022, 'edge', vertices=5)
    b.box('radar-feed-horn', (.21, 1.34, 3.22), (.09, .10, .10), 'edge')
    b.rod('radar-waveguide', (-.30, 1.34, 3.00), (-.42, 1.34, 2.74), .026, 'edge', vertices=5)
    for sign in (-1, 1):
        guard = [(-.50, 1.34 + sign * .30, 2.74), (-.44, 1.34 + sign * .62, 3.02),
                 (-.20, 1.34 + sign * .66, 3.34), (.06, 1.34 + sign * .40, 3.42)]
        for a, c in zip(guard, guard[1:]):
            b.rod('radar-guard', a, c, .020, 'painted-edge', vertices=5)
        b.rod('radar-guard-root', (-.50, 1.34 + sign * .30, 2.74), (-.46, 1.34 + sign * .30, 2.62),
              .018, 'painted-edge', vertices=4)

    # Outboard access: a ladder down the starboard plating and a grab rail above it.
    b.ladder('access-ladder', (-.42, -1.96, .10), (-.42, -2.02, 1.30), .38, 4, across='x')
    b.rod('access-grab-rail', (-.20, -2.00, 1.46), (-.64, -2.00, 1.46), .020, 'painted-edge', vertices=5)
    for x in (-.20, -.64):
        b.rod('access-grab-stanchion', (x, -1.92, 1.24), (x, -2.00, 1.46), .018, 'painted-edge', vertices=4)

    # Guns. The STAAG's jackets run almost the whole chase, as the reference shows.
    pivots = b.gun(jacket_start=.34, jacket_end=1.92, collar=1.28, breech_back=-.52)
    elevate, mid = b.cradle(pivots[0], .34, -.60, .52)
    # Armoured cradle casing over both guns, open forward for the jackets.
    b.plate('cradle-casing', [(-.60, .12), (.44, .12), (.44, .40), (-.52, .44)],
            mid - .34, mid + .34, 'naval', elevate)
    b.box('cradle-casing-front', (.44, mid, .26), (.06, .68, .30), 'painted-edge', elevate)
    # Slide guides stay inside the cradle's own width so they clear the cheeks.
    for side, lateral, elevation, _ in pivots:
        b.box(side + '-slide-guide', (.16, .18 if lateral > 0 else -.18, -.05),
              (.60, .07, .16), 'edge', elevation)
    b.box('elevation-arc-housing', (-.42, mid, -.32), (.36, .74, .36), 'naval', elevate)
    b.rod('elevation-arc', (-.58, mid, -.32), (-.28, mid, -.46), .052, 'edge', elevate, vertices=8)


# ---------------------------------------------------------------------------
# Hazemeyer Mk IV: the stabilised Dutch twin on its open triaxial platform
# ---------------------------------------------------------------------------

HAZEMEYER_DECK = [(1.62, -0.92), (1.22, -1.58), (0.55, -1.78), (-0.76, -1.78), (-1.22, -1.56),
                  (-1.38, -1.04), (-1.38, 1.04), (-1.22, 1.56), (-0.76, 1.78), (0.55, 1.78),
                  (1.22, 1.58), (1.62, 0.92)]


def hazemeyer(b):
    spec = b.spec
    trunnion, pivot_height = spec['trunnionForward'], spec['pivotHeight']

    # Roller path and the low training base under the stabilised platform.
    b.cyl('roller-path', (0, 0, .155), .84, .31, 'edge', vertices=20)
    k = len(HAZEMEYER_DECK)
    b.mesh('platform', [(x, y, z) for z in (.33, .39) for x, y in HAZEMEYER_DECK],
           [tuple(range(k)), tuple(range(2 * k - 1, k - 1, -1))]
           + [(i, i + k, (i + 1) % k + k, (i + 1) % k) for i in range(k)], 'roof')
    b.cyl('platform-hub', (0, 0, .35), .98, .08, 'naval', vertices=20)
    for i in range(k):
        x, y = HAZEMEYER_DECK[i]
        b.rod('platform-bracket', (x * .52, y * .52, .30), (x * .96, y * .96, .35),
              .034, 'painted-edge', vertices=4)
        a, c = HAZEMEYER_DECK[i], HAZEMEYER_DECK[(i + 1) % k]
        b.rod('platform-kerb', (a[0], a[1], .41), (c[0], c[1], .41), .028, 'painted-edge', vertices=4)

    # Stabilising gear: the roll and cross-level cradle under the gun frame.
    b.box('stabiliser-bed', (.10, 0, .60), (1.70, 1.10, .36), 'naval')
    for sign in (-1, 1):
        b.rod('cross-level-ram', (-.44, sign * .60, .62), (.46, sign * .60, .84), .052, 'edge', vertices=8)
        b.rod('roll-link', (.52, sign * .34, .78), (.52, sign * .34, 1.16), .034, 'edge', vertices=6)

    # Gun frame: a broad trapezoidal A-frame up to the trunnion bearings.
    frame = [(-.80, .78), (.58, .78), (.58, 1.60), (.40, 1.66),
             (trunnion + .13, pivot_height - .05), (trunnion + .11, pivot_height + .11),
             (trunnion - .11, pivot_height + .11), (trunnion - .16, pivot_height - .10),
             (-.52, 1.20)]
    for sign in (-1, 1):
        b.plate('gun-frame-cheek', frame, sign * .34, sign * .42, 'naval')
        b.cyl('trunnion-bearing', (trunnion, sign * .38, pivot_height), .125, .10, 'edge',
              vertices=12).rotation_euler.x = math.pi / 2
        # Splayed legs carrying the frame out to the stabilised bed.
        b.plate('frame-leg', [(.44, .78), (.66, .78), (.62, 1.46), (.46, 1.46)],
                sign * .39, sign * .49, 'naval').rotation_euler.x = -sign * math.radians(16)
        b.rod('frame-brace', (.54, sign * .39, .84), (trunnion - .04, sign * .39, pivot_height - .30),
              .034, 'painted-edge', vertices=5)
        b.rod('frame-tie-rod', (-.62, sign * .39, .88), (trunnion - .12, sign * .39, pivot_height - .22),
              .030, 'painted-edge', vertices=5)
    b.box('frame-tie', (.58, 0, 1.56), (.22, .88, .14), 'naval')
    b.box('frame-cross-beam', (.24, 0, 1.06), (.30, 1.62, .16), 'naval')
    b.box('frame-lower-beam', (.10, 0, .86), (.26, 1.30, .14), 'naval')
    for sign in (-1, 1):
        b.rod('cross-beam-stay', (.24, sign * .70, 1.00), (.24, sign * .40, .82), .028,
              'painted-edge', vertices=5)
        # Broad wing plates spreading the trunnion load out to the beam ends.
        b.mesh('frame-wing', [(.46, sign * .42, 1.62), (.46, sign * .42, .84), (.30, sign * 1.12, 1.00),
                              (.30, sign * 1.12, 1.12), (.40, sign * .42, 1.66)],
               [(0, 1, 2, 3), (0, 3, 4)], 'naval')
        b.rod('wing-edge', (.30, sign * 1.12, 1.12), (.46, sign * .42, 1.64), .022,
              'painted-edge', vertices=4)

    # Rear blast frame: two uprights and a head rail, open where the guns swing.
    for sign in (-1, 1):
        b.plate('blast-frame-upright', [(-.28, 1.54), (-.20, 1.54), (-.20, 2.80), (-.28, 2.80)],
                sign * .41, sign * .49, 'naval')
    b.box('blast-frame-head', (-.24, 0, 2.78), (.08, 1.00, .12), 'naval')

    # Stabilised director box with the radar mast on top. Ribs and the instrument
    # face keep the case from reading as one blank slab.
    # The tower stands clear of the breech's arc; only the low bed reaches forward.
    b.box('director-bed', (-.46, 0, .96), (.60, .64, .36), 'naval')
    b.box('director-case', (-1.10, 0, 1.84), (.68, .66, 1.72), 'naval')
    b.box('director-face', (-.75, 0, 2.02), (.06, .50, .66), 'dark')
    b.box('predictor-lid', (-1.10, 0, 2.74), (.74, .72, .10), 'painted-edge')
    for x in (-1.38, -1.10, -.82):
        b.box('director-rib', (x, 0, 1.84), (.08, .70, 1.64), 'painted-edge')
    for sign in (-1, 1):
        b.box('director-handhole', (-1.16, sign * .34, 1.44), (.34, .06, .30), 'edge')
    b.rod('aerial-mast', (-1.02, 0, 2.76), (-.74, 0, 3.22), .062, 'naval', vertices=8)
    for sign in (-1, 1):
        b.rod('aerial-mast-stay', (-1.32, sign * .18, 2.76), (-.78, 0, 3.16), .024,
              'painted-edge', vertices=5)
    # Type 282 yagi pair on a tilted frame: booms and dipoles rooted in the frame.
    array = b.box('aerial-frame', (-.66, 0, 3.36), (.40, 1.12, .12), 'naval')
    array.rotation_euler.y = -math.radians(30)
    b.rod('aerial-frame-spine', (-.82, 0, 3.26), (-.50, 0, 3.44), .034, 'naval', vertices=6)
    for sign in (-1, 1):
        y = sign * .32
        b.rod('aerial-boom', (-.80, y, 3.28), (-.40, y, 3.98), .026, 'edge', vertices=6)
        b.rod('aerial-boom-root', (-.80, y, 3.28), (-.74, 0, 3.24), .018, 'edge', vertices=4)
        for i in range(5):
            t = .12 + i * .20
            x, z = -.80 + .40 * t, 3.28 + .70 * t
            half = .24 - i * .028
            b.rod('aerial-dipole', (x, y - half, z), (x, y + half, z), .012, 'edge', vertices=4)

    # Layers' stations: seat, backrest, footrest, handwheels and a ring sight.
    for sign in (-1, 1):
        y = sign * 1.09
        b.rod('seat-arm', (.05, sign * .40, .62), (.02, y, .96), .046, 'naval', vertices=6)
        b.rod('seat-column', (.02, y, .90), (.02, y, 1.16), .050, 'naval', vertices=6)
        b.box('layer-seat', (.02, y, 1.20), (.34, .38, .07), 'roof')
        b.box('layer-seat-back', (-.20, y, 1.42), (.06, .36, .38), 'roof')
        b.rod('layer-backrest-post', (-.20, y, 1.18), (-.20, y, 1.32), .022, 'painted-edge', vertices=5)
        b.box('layer-footrest', (.68, y, .92), (.34, .30, .05), 'painted-edge')
        b.rod('layer-footrest-strut', (.52, sign * .56, .58), (.68, y, .92), .026, 'painted-edge', vertices=5)
        b.handwheel('training-handwheel', (.34, sign * .74, 1.32), .170)
        b.rod('training-shaft', (.34, sign * .40, 1.20), (.34, sign * .74, 1.32), .030, 'edge', vertices=6)
        b.handwheel('elevating-handwheel', (.34, sign * 1.40, 1.32), .170)
        b.rod('elevating-shaft', (.34, sign * 1.16, 1.32), (.34, sign * 1.40, 1.32), .030, 'edge', vertices=6)
        b.rod('handwheel-bracket', (.34, y, 1.24), (.14, y, 1.20), .026, 'painted-edge', vertices=5)
        # Open ring sight on a post beside the layer's shoulder.
        b.rod('sight-post', (.30, sign * .86, 1.42), (.22, sign * .86, 1.84), .026, 'painted-edge', vertices=5)
        b.hoop('ring-sight', (.22, sign * .86, 1.90), .090, 'x', wire=.010, key='edge')
        b.rod('ring-sight-bar', (.22, sign * .86 - .09, 1.90), (.22, sign * .86 + .09, 1.90), .005, 'edge', vertices=4)
        b.rod('ring-sight-bar', (.22, sign * .86, 1.81), (.22, sign * .86, 1.99), .005, 'edge', vertices=4)
        # Ready-use ammunition on the platform beside each layer.
        b.box('ready-use-locker', (-.62, sign * 1.32, .66), (.60, .42, .54), 'naval')
        b.box('ready-use-lid', (-.62, sign * 1.32, .94), (.64, .46, .05), 'painted-edge')
        for i in range(3):
            b.rod('ready-clip', (-.78 + i * .16, sign * 1.32, .97), (-.78 + i * .16, sign * 1.32, 1.22),
                  .024, 'edge', vertices=6)
        b.box('spare-barrel-box', (1.18, sign * .82, .62), (.52, .34, .42), 'edge')

    # Guard rail round the working platform. It stops short of the bow so the
    # barrels sweep over open deck at full depression.
    rail = [(1.26, 1.62, .41), (.55, 1.82, .41), (-.76, 1.82, .41), (-1.22, 1.56, .41),
            (-1.38, 1.04, .41), (-1.38, -1.04, .41), (-1.22, -1.56, .41), (-.76, -1.82, .41),
            (.55, -1.82, .41), (1.26, -1.62, .41)]
    top = b.railing('platform-rail', rail, 2.36, posts=(0, 2, 4, 5, 7, 9))
    middle = [(x, y, z - 1.14) for x, y, z in top]
    for a, c in zip(middle, middle[1:]):
        b.rod('platform-rail-course', a, c, .018, 'painted-edge', vertices=5)

    # Access ladder onto the platform at the after end, and deck-edge fittings.
    b.ladder('access-ladder', (-1.34, 0, .04), (-1.34, 0, .41), .42, 2)
    for sign in (-1, 1):
        b.box('junction-box', (-1.12, sign * .86, .62), (.26, .22, .40), 'edge')
        b.rod('cable-run', (-1.12, sign * .86, .82), (-1.00, sign * .40, 1.20), .022, 'edge', vertices=5)
        b.box('telephone-box', (1.32, sign * 1.24, .62), (.22, .18, .38), 'edge')

    # Guns. The Hazemeyer's jackets are shorter and the receivers sit at the trunnion.
    pivots = b.gun(jacket_start=.18, jacket_end=1.72, collar=1.10, breech_back=-.46)
    elevate, mid = b.cradle(pivots[0], .28, -.50, .34)
    b.box('elevation-arc-housing', (-.32, mid, -.26), (.28, .62, .26), 'naval', elevate)
    b.rod('elevation-arc', (-.44, mid, -.26), (-.22, mid, -.36), .046, 'edge', elevate, vertices=8)
    for side, lateral, elevation, _ in pivots:
        b.box(side + '-slide-guide', (.02, .13 if lateral > 0 else -.13, -.04),
              (.66, .07, .16), 'edge', elevation)


# ---------------------------------------------------------------------------
# Mk V twin: the utility shielded twin, open-topped with a castellated rim
# ---------------------------------------------------------------------------
# The reference is a faceted shield tub, raked back from a wide foot to a
# narrow crown. Its forward plate carries three cut-outs -- the gun slot on the
# centreline and a notch over each layer -- which leave four raised tabs along
# the crown, and a blast deflector arches over the barrels inside the slot.

MKV_FRONT = [(1.25, .31), (1.10, .72), (0.86, 1.56), (0.78, 1.86), (0.71, 2.08), (0.30, 2.55)]

MKV_WALL = [
    (1.20, 1.28, 1.16, 1.22, 2.06),
    (0.87, 1.36, 0.90, 1.26, 2.00),
    (-0.60, 1.36, -0.60, 1.26, 2.00),
    (-1.11, 1.11, -1.11, 1.06, 2.00),
    (-1.45, 0.40, -1.45, 0.38, 2.00),
    (-1.45, -0.40, -1.45, -0.38, 2.00),
    (-1.11, -1.11, -1.11, -1.06, 2.00),
    (-0.60, -1.36, -0.60, -1.26, 2.00),
    (0.87, -1.36, 0.90, -1.26, 2.00),
    (1.20, -1.28, 1.16, -1.22, 2.06),
]

MKV_FLOOR = [(1.20, -1.30), (0.87, -1.36), (-0.60, -1.36), (-1.11, -1.11), (-1.45, -0.40),
             (-1.45, 0.40), (-1.11, 1.11), (-0.60, 1.36), (0.87, 1.36), (1.20, 1.30)]


def _inward(points, distance):
    """Offset an (x, z) polyline towards the inside of the shield plating."""
    out = []
    for i, (x, z) in enumerate(points):
        ax, az = points[max(0, i - 1)]
        bx, bz = points[min(len(points) - 1, i + 1)]
        dx, dz = bx - ax, bz - az
        length = math.hypot(dx, dz) or 1.
        out.append((x - dz / length * distance, z + dx / length * distance))
    return out


def _mkv_band(b, label, y0, y1, top, thickness=.062):
    """One strip of the forward plate, stopped at `top` where a cut-out begins."""
    outer = []
    for (x, z), (nx, nz) in zip(MKV_FRONT, MKV_FRONT[1:] + [MKV_FRONT[-1]]):
        if z >= top:
            break
        outer.append((x, z))
        if nz >= top:
            t = (top - z) / (nz - z)
            outer.append((x + (nx - x) * t, top))
            break
    profile = outer + list(reversed(_inward(outer, thickness)))
    k = len(profile)
    verts = [(x, y, z) for y in (y0, y1) for x, z in profile]
    faces = [tuple(reversed(range(k))), tuple(range(k, 2 * k))]
    faces += [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)]
    return b.mesh(label, verts, faces, 'naval')


def mkv(b):
    spec = b.spec
    trunnion, pivot_height = spec['trunnionForward'], spec['pivotHeight']

    # Roller path and the plated tub floor the crew stand on.
    b.cyl('roller-path', (0, 0, .155), .84, .31, 'edge', vertices=20)
    b.cyl('training-rack', (0, 0, .33), .98, .06, 'painted-edge', vertices=20)
    k = len(MKV_FLOOR)
    b.mesh('tub-floor', [(x, y, z) for z in (.31, .37) for x, y in MKV_FLOOR],
           [tuple(range(k)), tuple(range(2 * k - 1, k - 1, -1))]
           + [(i, i + k, (i + 1) % k + k, (i + 1) % k) for i in range(k)], 'roof')

    # Shield: raked side and after plating, then the forward plate in four
    # strips per side so the gun slot and the layers' notches stay open.
    b.wall('shield', MKV_WALL, .31, .062)
    _mkv_band(b, 'front-plate-centre', -.35, .35, 1.58)
    for sign in (-1, 1):
        lo, hi = sorted((sign * .35, sign * .85))
        _mkv_band(b, 'front-plate-inner', lo, hi, 2.55)
        lo, hi = sorted((sign * .85, sign * 1.13))
        _mkv_band(b, 'front-plate-notch', lo, hi, 1.72)
        lo, hi = sorted((sign * 1.13, sign * 1.36))
        _mkv_band(b, 'front-plate-outer', lo, hi, 2.55)
        # Coamings finish the cut edges of the slot and the notch.
        b.rod('slot-coaming', (.85, sign * .34, 1.57), (.33, sign * .34, 2.52),
              .028, 'painted-edge', vertices=4)
        b.rod('notch-coaming', (.80, sign * .85, 1.71), (.80, sign * 1.13, 1.71),
              .026, 'painted-edge', vertices=4)
        b.rod('crown-coaming', (.30, sign * .35, 2.55), (.30, sign * .85, 2.55),
              .026, 'painted-edge', vertices=4)
        b.rod('crown-coaming', (.30, sign * 1.13, 2.55), (.30, sign * 1.36, 2.55),
              .026, 'painted-edge', vertices=4)

        # Blast deflector: a swept hood rising outboard over each barrel, hung
        # from posts stepped off the slot coaming.
        rows = [(.34 + .53 * t, 2.14 + .30 * t ** .7) for t in (0, .28, .58, 1.)]
        n = len(rows)
        verts = [(x, sign * y, z + dz) for dz in (0, .10) for x in (.24, .50) for y, z in rows]
        quads = [(0, n, n + 1, 1), (0, 1, 2 * n + 1, 2 * n), (2 * n, 2 * n + 1, 3 * n + 1, 3 * n),
                 (n, 3 * n, 3 * n + 1, n + 1)]
        faces = [tuple(a + i for a in q) for q in quads for i in range(n - 1)]
        faces += [(0, 2 * n, 3 * n, n), (n - 1, 2 * n - 1, 4 * n - 1, 3 * n - 1)]
        b.mesh('blast-deflector', verts,
               faces if sign > 0 else [tuple(reversed(f)) for f in faces], 'edge')
        b.rod('deflector-post', (.37, sign * .87, 2.40), (.55, sign * .87, 1.96),
              .024, 'painted-edge', vertices=4)
        b.rod('deflector-stay', (.37, sign * .36, 2.14), (.62, sign * .35, 1.74),
              .020, 'painted-edge', vertices=4)

        # Layer's station: seat on a column off the tub floor, footrest,
        # training handwheel and the open ring sight that looks out of the notch.
        y = sign * .95
        b.rod('layer-seat-column', (-.05, y, .37), (-.05, y, 1.20), .055, 'naval', vertices=8)
        b.cyl('layer-seat', (-.05, y, 1.24), .19, .07, 'roof', vertices=10)
        b.box('layer-seat-back', (-.25, y, 1.46), (.06, .34, .36), 'roof')
        b.rod('layer-backrest-post', (-.25, y, 1.22), (-.25, y, 1.36), .022, 'painted-edge', vertices=5)
        b.box('layer-footrest', (.52, y, .78), (.34, .30, .05), 'painted-edge')
        b.rod('layer-footrest-strut', (.40, sign * .52, .40), (.52, y, .78), .026,
              'painted-edge', vertices=5)
        b.handwheel('training-handwheel', (.22, sign * .62, 1.52), .160)
        b.rod('training-shaft', (.22, sign * .36, 1.44), (.22, sign * .62, 1.52), .030, 'edge', vertices=6)
        b.handwheel('elevating-handwheel', (.22, sign * 1.24, 1.52), .160)
        b.rod('elevating-shaft', (.22, sign * 1.02, 1.52), (.22, sign * 1.24, 1.52), .030, 'edge', vertices=6)
        b.rod('handwheel-bracket', (.22, y, 1.46), (.02, y, 1.30), .026, 'painted-edge', vertices=5)
        b.rod('sight-post', (.44, sign * .99, 1.76), (.33, sign * .99, 2.20), .026,
              'painted-edge', vertices=5)
        b.hoop('ring-sight', (.32, sign * .99, 2.30), .095, 'x', wire=.010, key='edge')
        b.rod('ring-sight-bar', (.32, sign * .99 - .095, 2.30), (.32, sign * .99 + .095, 2.30),
              .005, 'edge', vertices=4)
        b.rod('ring-sight-bar', (.32, sign * .99, 2.205), (.32, sign * .99, 2.395), .005, 'edge', vertices=4)

        # Ready-use lockers along the after plating, with clips on their lids.
        b.box('ready-use-locker', (-.19, sign * 1.15, .66), (.60, .42, .58), 'naval')
        b.box('ready-use-lid', (-.19, sign * 1.15, .96), (.64, .46, .05), 'painted-edge')
        for i in range(3):
            b.rod('ready-clip', (-.35 + i * .16, sign * 1.15, .99), (-.35 + i * .16, sign * 1.15, 1.24),
                  .024, 'edge', vertices=6)
        b.box('spent-case-bin', (-.86, sign * 1.10, .62), (.44, .40, .50), 'edge')
        b.rod('grab-rail', (-1.30, sign * 1.02, 1.32), (-.72, sign * 1.14, 1.32), .020,
              'painted-edge', vertices=5)
        for x, yy in ((-1.30, 1.02), (-.72, 1.14)):
            b.rod('grab-rail-post', (x, sign * (yy - .12), 1.32), (x, sign * yy, 1.32),
                  .018, 'painted-edge', vertices=4)

    # Gun pedestal: an open fork so the breech swings between the cheeks.
    fork = [(-.62, .40), (.60, .40), (.60, 1.42), (.44, 1.50),
            (trunnion + .14, pivot_height - .06), (trunnion + .12, pivot_height + .12),
            (trunnion - .12, pivot_height + .12), (trunnion - .18, pivot_height - .12),
            (-.44, 1.06)]
    for sign in (-1, 1):
        b.plate('pedestal-cheek', fork, sign * .33, sign * .41, 'naval')
        b.cyl('trunnion-bearing', (trunnion, sign * .37, pivot_height), .130, .10, 'edge',
              vertices=12).rotation_euler.x = math.pi / 2
        b.rod('pedestal-brace', (.54, sign * .37, .46), (trunnion - .05, sign * .37, pivot_height - .34),
              .032, 'painted-edge', vertices=5)
    b.box('pedestal-base', (0, 0, .58), (1.24, .96, .42), 'naval')
    b.box('training-gearbox', (-.95, 0, 1.25), (.66, .50, .46), 'edge')
    b.rod('training-shafting', (-.62, 0, 1.25), (-.30, 0, 1.00), .038, 'edge', vertices=6)

    # Hoist trunk on the centreline aft, feeding clips up to the loaders.
    for sign in (-1, 1):
        b.plate('hoist-trunk', [(-1.42, .60), (-0.88, 1.84), (-0.98, 1.92), (-1.46, .76)],
                sign * .07, sign * .20, 'naval')
    b.box('hoist-head', (-.96, 0, 1.94), (.34, .44, .22), 'edge')
    b.box('hoist-foot', (-1.36, 0, .62), (.34, .44, .34), 'naval')

    # Guns. Slim chase with a bulbous flash hider, as on the reference.
    pivots = b.gun(jacket_start=.14, jacket_end=1.58, collar=.96, breech_back=-.46)
    elevate, mid = b.cradle(pivots[0], .28, -.50, .34)
    b.box('elevation-arc-housing', (-.32, mid, -.26), (.28, .62, .26), 'naval', elevate)
    b.rod('elevation-arc', (-.44, mid, -.26), (-.22, mid, -.36), .046, 'edge', elevate, vertices=8)
    for side, lateral, elevation, _ in pivots:
        b.box(side + '-slide-guide', (.02, .13 if lateral > 0 else -.13, -.04),
              (.62, .07, .16), 'edge', elevation)


# ---------------------------------------------------------------------------
# RP Mk I twin: the remote-power-controlled twin, unshielded and all machinery
# ---------------------------------------------------------------------------
# Nothing is covered on this one. A stepped roller base carries a blocky drive
# body, thick water jackets run back over the trunnions, two curved tubular arms
# sweep out to caged ring sights, and a railed grating hangs off the after end.

RPMK1_DECK = [(-0.64, -1.06), (-0.64, 1.06), (-0.84, 1.28), (-1.24, 1.28),
              (-1.46, 1.02), (-1.46, -1.02), (-1.24, -1.28), (-0.84, -1.28)]


def rp_mk1(b):
    spec = b.spec
    trunnion, pivot_height = spec['trunnionForward'], spec['pivotHeight']

    # Stepped roller base: two paths with the training rack between them.
    b.cyl('roller-path', (0, 0, .065), .74, .13, 'edge', vertices=20)
    b.cyl('training-rack', (0, 0, .155), .66, .11, 'painted-edge', vertices=20)
    b.cyl('roller-cap', (0, 0, .29), .74, .16, 'edge', vertices=20)

    # Drive body: the blocky RP machinery the whole mounting is built around.
    b.box('drive-body', (-.28, 0, .72), (1.28, .98, .76), 'naval')
    b.plate('drive-skirt', [(-.96, .36), (.40, .36), (.50, .56), (-1.06, .56)], -.62, .62, 'naval')
    b.box('drive-crown', (-.24, 0, 1.02), (1.04, .86, .16), 'naval')
    b.box('crown-hatch', (-.56, 0, 1.12), (.34, .40, .06), 'painted-edge')
    for x in (-.74, -.28, .18):
        b.box('body-rib', (x, 0, .72), (.07, 1.00, .72), 'painted-edge')
    for sign in (-1, 1):
        # The receiver casings sit outboard, clear of the sweeping breech.
        b.box('receiver-deck', (.34, sign * .64, 1.18), (.52, .32, .64), 'naval')
        b.box('drive-motor', (-.66, sign * .42, .96), (.46, .34, .44), 'edge')
        b.box('junction-box', (.30, sign * .56, .98), (.30, .16, .32), 'edge')
        b.box('elevation-receiver', (-.12, sign * .58, .80), (.38, .16, .52), 'edge')
        b.rod('power-cable', (-.36, sign * .54, .62), (-.86, sign * .30, .40), .034, 'edge', vertices=6)
        b.rod('power-cable', (.30, sign * .56, .82), (.02, sign * .62, .62), .028, 'edge', vertices=6)

    # Trunnion cheeks rising out of the crown, with the bearings on top.
    fork = [(-.58, 1.06), (.62, 1.06), (.62, 1.62),
            (trunnion + .15, pivot_height - .06), (trunnion + .13, pivot_height + .13),
            (trunnion - .13, pivot_height + .13), (trunnion - .19, pivot_height - .11),
            (-.44, 1.44)]
    for sign in (-1, 1):
        b.plate('trunnion-cheek', fork, sign * .34, sign * .46, 'naval')
        b.cyl('trunnion-bearing', (trunnion, sign * .41, pivot_height), .135, .11, 'edge',
              vertices=12).rotation_euler.x = math.pi / 2
        b.rod('cheek-brace', (.56, sign * .40, 1.14), (trunnion - .06, sign * .40, pivot_height - .34),
              .032, 'painted-edge', vertices=5)

    # After grating on brackets, with a tubular rail round its open edge.
    k = len(RPMK1_DECK)
    b.mesh('after-grating', [(x, y, z) for z in (1.66, 1.72) for x, y in RPMK1_DECK],
           [tuple(range(k)), tuple(range(2 * k - 1, k - 1, -1))]
           + [(i, i + k, (i + 1) % k + k, (i + 1) % k) for i in range(k)], 'roof')
    rail = [(-.64, 1.06, 1.72), (-.84, 1.28, 1.72), (-1.24, 1.28, 1.72), (-1.46, 1.02, 1.72),
            (-1.46, -1.02, 1.72), (-1.24, -1.28, 1.72), (-.84, -1.28, 1.72), (-.64, -1.06, 1.72)]
    b.railing('grating-rail', rail, .40, posts=(0, 1, 2, 3, 4, 5, 6, 7))
    middle = [(x, y, z + .20) for x, y, z in rail]
    for a, c in zip(middle, middle[1:]):
        b.rod('grating-rail-course', a, c, .017, 'painted-edge', vertices=5)
    for sign in (-1, 1):
        b.rod('grating-bracket', (-.70, sign * .46, 1.06), (-1.10, sign * 1.10, 1.66),
              .032, 'painted-edge', vertices=5)
        b.rod('grating-bracket', (-.70, sign * .46, 1.06), (-.70, sign * 1.10, 1.66),
              .032, 'painted-edge', vertices=5)

    for sign in (-1, 1):
        # Curved tubular arm out to the layer's caged ring sight.
        arm = [(.06, sign * .42, 1.46), (.24, sign * .72, 1.62), (.42, sign * .95, 1.86),
               (.45, sign * .99, 2.02)]
        for a, c in zip(arm, arm[1:]):
            b.rod('sight-arm', a, c, .046, 'edge', vertices=8)
        b.hoop('ring-sight', (.46, sign * .99, 2.10), .115, 'x', wire=.012, key='edge')
        b.rod('ring-sight-bar', (.46, sign * .99 - .115, 2.10), (.46, sign * .99 + .115, 2.10),
              .006, 'edge', vertices=4)
        b.rod('ring-sight-bar', (.46, sign * .99, 1.985), (.46, sign * .99, 2.215), .006, 'edge', vertices=4)
        # Cage guarding the sight, hooped over its forward face.
        for a in (30, 90, 150, 210, 270, 330):
            t = math.radians(a)
            edge = (.46, sign * .99 + .15 * math.cos(t), 2.10 + .15 * math.sin(t))
            b.rod('sight-cage-rib', (.30, sign * .99, 2.10), edge, .012, 'painted-edge', vertices=4)
        b.hoop('sight-cage-hoop', (.32, sign * .99, 2.10), .150, 'x', wire=.014, key='painted-edge', steps=10)
        b.hoop('sight-cage-rim', (.46, sign * .99, 2.10), .150, 'x', wire=.014, key='painted-edge', steps=10)

        # Layer's bucket seat, backrest, footplate and the hand controller.
        b.rod('seat-arm', (-.02, sign * .52, 1.10), (-.19, sign * .92, 1.06), .042, 'naval', vertices=6)
        b.cyl('layer-seat', (-.19, sign * .99, 1.08), .21, .08, 'roof', vertices=10)
        b.box('layer-seat-back', (-.40, sign * .99, 1.30), (.06, .38, .38), 'roof')
        b.rod('layer-backrest-post', (-.40, sign * .99, 1.06), (-.40, sign * .99, 1.18),
              .022, 'painted-edge', vertices=5)
        b.box('layer-footplate', (.60, sign * .99, .78), (.34, .32, .06), 'painted-edge')
        b.rod('footplate-strut', (.42, sign * .56, .50), (.60, sign * .99, .78), .028,
              'painted-edge', vertices=5)
        b.box('hand-controller', (.30, sign * .78, 1.34), (.22, .20, .24), 'edge')
        b.rod('controller-grip', (.30, sign * .78, 1.46), (.24, sign * .78, 1.60), .022, 'dark', vertices=5)
        b.rod('controller-column', (.30, sign * .78, 1.22), (.30, sign * .62, 1.02), .030,
              'painted-edge', vertices=5)

        # Ready-use clips stowed flat on the grating, and a case bin on the body.
        b.box('ready-use-locker', (-1.10, sign * .86, 1.86), (.52, .38, .28), 'naval')
        b.box('ready-use-lid', (-1.10, sign * .86, 2.01), (.56, .42, .04), 'painted-edge')
        for i in range(3):
            b.rod('ready-clip', (-1.24 + i * .14, sign * .86, 2.04), (-1.24 + i * .14, sign * .86, 2.26),
                  .024, 'edge', vertices=6)
        b.box('spent-case-bin', (-.48, sign * .66, .70), (.34, .30, .40), 'edge')

    # Guns. Thick water jackets carried back over the trunnions, slim chase.
    pivots = b.gun(jacket_start=-.26, jacket_end=.88, collar=.30, breech_back=-.52, feed_at=-.22,
                   jacket_r=.115, band_r=.128, chase_r=.066, hider_r=.076,
                   muzzle_r=.062, tip_r=.058)
    elevate, mid = b.cradle(pivots[0], .28, -.50, .34)
    b.box('elevation-arc-housing', (-.30, mid, -.26), (.26, .62, .26), 'naval', elevate)
    b.rod('elevation-arc', (-.42, mid, -.26), (-.20, mid, -.36), .046, 'edge', elevate, vertices=8)
    for side, lateral, elevation, _ in pivots:
        b.box(side + '-slide-guide', (.30, .13 if lateral > 0 else -.13, -.04),
              (.70, .07, .16), 'edge', elevation)


VARIANTS = {'qf-40mm-bofors-staag-twin': staag,
            'qf-40mm-bofors-hazemeyer-twin': hazemeyer,
            'qf-40mm-bofors-mkv-twin': mkv,
            'qf-40mm-bofors-rp-mk1-twin': rp_mk1}


def create_mount(mount, col, helpers, materials):
    builder = Twin(mount, col, helpers, materials)
    VARIANTS[mount['weapon']['id']](builder)
    return builder.finish()
