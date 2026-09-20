"""Shared turret geometry for the US 14-inch/45 Mk 8 mounts.

Both the New York twin and the Pennsylvania triple are round-nosed shells on a
wide turntable ring with a deeply raked face plate, so they share the rig, the
plate casting, the sliding barrels, the canvas port covers and the service
fittings; only the stations and the fitting arrangement differ.

Authoring frame: +X toward the muzzle, +Y port, +Z up, yaw datum on the
turntable sole (z = 0). No reference geometry is loaded here; the catalog owns
the closed armor shell, which is also the visible gunhouse.
"""
import math
import bpy
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer


def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


class Turret:
    """Rig, armor shell and the fittings both 14-inch/45 mounts share."""

    def __init__(self, mount, col, helpers, materials):
        self.mount, self.col, self.spec = mount, col, mount['weapon']
        self.name = mount['id']
        self.mesh, self.cyl, self.rod, self.box = (helpers[k] for k in ('mesh', 'cyl', 'rod', 'box'))
        palette = dict(materials)
        palette.setdefault('roof', palette['naval'])
        palette.setdefault('painted-edge', palette['edge'])
        palette.setdefault('glass', palette['dark'])
        self.paint = palette
        self.naval, self.roof, self.edge = palette['naval'], palette['roof'], palette['edge']
        self.dark, self.painted, self.glass = palette['dark'], palette['painted-edge'], palette['glass']
        self.yaw = self.joint('yaw')
        self.plates = []

    # ---- rig -------------------------------------------------------------
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

    def place(self):
        a, b, c = self.mount['position']
        self.yaw.location = (-c, -a, b)
        self.yaw.rotation_euler.z = -math.radians(self.mount['bearingDeg'])
        return self.yaw

    # ---- armor shell -----------------------------------------------------
    def shell(self):
        """Draw the catalog gunhouse exactly; it is the armor and the skin."""
        shape = self.spec['gunhouseMesh']
        body = self.put(self.mesh(self.name + '.gunhouse', [tuple(v) for v in shape['vertices']],
                                  [f['indices'] for f in shape['faces']], self.naval, self.col))
        body.data.materials.append(self.roof)
        for polygon, face in zip(body.data.polygons, shape['faces']):
            polygon.material_index = 1 if face['finish'] == 'roof' else 0
        self.plates = [[Vector(shape['vertices'][i]) for i in f['indices']] for f in shape['faces']]
        return body

    def cast(self, origin, direction):
        hits = [intersect_ray_tri(*t, Vector(direction), Vector(origin)) for t in self.plates]
        return [h for h in hits if h is not None]

    def front_x(self, y, z):
        return max(h.x for h in self.cast((40, y, z), (-1, 0, 0)))

    def top_z(self, x, y):
        return max(h.z for h in self.cast((x, y, 40), (0, 0, -1)))

    def side_y(self, x, z, sign=1):
        return sign * max(sign * h.y for h in self.cast((x, sign * 40, z), (0, -sign, 0)))

    # ---- turntable -------------------------------------------------------
    def turntable(self, radius, height, gussets=0, gusset_out=0.0):
        """The rotating sole; the Shipbuilder owns the fixed barbette below it."""
        deck = height + .02          # the disc laps the gunhouse floor plate
        self.put(self.cyl(self.name + '.turntable', (0, 0, deck / 2), radius, deck, self.naval, self.col, 48))
        for i in range(gussets):
            angle = math.tau * i / gussets
            direction = (math.cos(angle), math.sin(angle))
            foot = self.foot_radius(direction)
            outer = min(radius - .02, foot + gusset_out)
            if outer - foot < .12:
                continue
            inner = foot - .12
            middle = (inner + outer) / 2
            pad = self.put(self.box(self.name + '.sole-bracket',
                                    (direction[0] * middle, direction[1] * middle, height + .045),
                                    (outer - inner, .30, .09), self.naval, self.col, .01))
            pad.rotation_euler.z = angle

    def foot_radius(self, direction, start=1.0, stop=6.5):
        """Radius at which the gunhouse floor edge crosses a sole bearing."""
        low, high = start, stop
        for _ in range(28):
            middle = (low + high) / 2
            point = (direction[0] * middle, direction[1] * middle)
            if self.cast((point[0], point[1], 40), (0, 0, -1)):
                low = middle
            else:
                high = middle
        return low

    # ---- guns ------------------------------------------------------------
    def barrels(self, profile, sides=14, rim=.30, rim_run=.45):
        """Sliding barrels: one recoil node each, tapering chase, muzzle rim."""
        spec = self.spec
        length = spec['muzzleForward'] - spec['trunnionForward']
        bore = spec['caliberM'] / 2
        made = []
        for side, y, _ in barrel_layout(spec):
            elevation = self.joint(side + '.elevation', self.yaw,
                                   (spec['trunnionForward'], y, spec['pivotHeight']))
            elevation.rotation_euler.y = -math.radians(self.mount.get('initialElevationDeg', 1))
            recoil = self.joint(side + '.recoil', elevation)
            self.joint(side + '.muzzle', recoil, (length, 0, 0))
            points = [(x, r * math.cos(math.tau * i / sides), r * math.sin(math.tau * i / sides))
                      for x, r in profile for i in range(sides)]
            faces = [(j * sides + i, j * sides + (i + 1) % sides, (j + 1) * sides + (i + 1) % sides, (j + 1) * sides + i)
                     for j in range(len(profile) - 1) for i in range(sides)]
            self.put(self.mesh(self.name + '.barrel', points, faces, self.edge, self.col, True), recoil)
            # The rim band laps the chase and the bore plug laps the rim, so
            # the muzzle stays one connected body.
            crown = [(x, r * math.cos(math.tau * i / sides), r * math.sin(math.tau * i / sides))
                     for x, r in [(length - .14, rim - .03), (length, rim + .012), (length, bore), (length - rim_run, bore)]
                     for i in range(sides)]
            faces = [(j * sides + i, j * sides + (i + 1) % sides, (j + 1) * sides + (i + 1) % sides, (j + 1) * sides + i)
                     for j in range(3) for i in range(sides)]
            self.put(self.mesh(self.name + '.muzzle-rim', crown, faces, self.edge, self.col), recoil)
            self.put(self.rod(self.name + '.bore-interior', (length - rim_run - .02, 0, 0), (length - rim_run + .05, 0, 0),
                              bore + .006, self.dark, self.col, vertices=sides), recoil)
            made.append((side, y, recoil))
        return made

    # ---- gun ports -------------------------------------------------------
    def seam(self, y0, z0, semi_y, semi_z, sectors=20, scale=1.0, proud=.03):
        """A gun-port ring cast onto the real raked face, winding +Y toward +Z."""
        sill = min(v[2] for v in self.spec['gunhouseMesh']['vertices']) + .03
        ring = []
        for i in range(sectors):
            angle = i * math.tau / sectors
            y = y0 + semi_y * scale * math.cos(angle)
            z = max(sill, z0 + semi_z * scale * math.sin(angle))
            ring.append((self.front_x(y, z) + proud, y, z))
        return ring

    def port_frame(self, y0, z0, semi_y, semi_z, normal, sectors=16, growth=(1.22, 1.16), proud=.08):
        """Raised armored frame standing around the canvas, seated in the plate."""
        inner = self.seam(y0, z0, semi_y, semi_z, sectors, 1.0, -.03)
        outer = self.seam(y0, z0, semi_y * growth[0], semi_z * growth[1], sectors, 1.0, -.03)
        lift = lambda ring: [tuple(p[i] + normal[i] * proud for i in range(3)) for p in ring]
        rings = [outer, lift(outer), lift(inner), inner]
        points = [p for ring in rings for p in ring]
        faces = [(j * sectors + i, j * sectors + (i + 1) % sectors,
                  (j + 1) * sectors + (i + 1) % sectors, (j + 1) * sectors + i)
                 for j in range(3) for i in range(sectors)]
        self.put(self.mesh(self.name + '.gun-port-frame', points, faces, self.naval, self.col))

    def cover(self, side, y, seam, collar_x, sleeve, slack=.18, fullness=.10, rings=5):
        """Pleated canvas port cover, draped clear of the armor and the jacket."""
        spec = self.spec
        cloth = create_bloomer(self.mount, self.col, {'mesh': self.mesh}, self.paint, side, seam,
                               collar_x, sleeve + .02, rings=rings, slack=slack, fullness=fullness)
        sectors = len(seam)
        sill = .02                  # nothing hangs below the turntable sole
        angles = [cloth['gunCoverBaseAngle']] + list(cloth['gunCoverAngles'])
        for key, degrees in zip(cloth.data.shape_keys.key_blocks, angles):
            theta = math.radians(degrees)
            axis = (math.cos(theta), 0, math.sin(theta))
            for index, point in enumerate(key.data):
                if index < sectors or index >= sectors * (rings - 1):
                    continue
                plate = self.cast((40, point.co.y, point.co.z), (-1, 0, 0))
                if plate:
                    point.co.x = max(point.co.x, max(h.x for h in plate) + .03)
                delta = (point.co.x - spec['trunnionForward'], point.co.y - y, point.co.z - spec['pivotHeight'])
                along = sum(delta[i] * axis[i] for i in range(3))
                radial = [delta[i] - along * axis[i] for i in range(3)]
                distance = math.sqrt(sum(v * v for v in radial))
                if 0 < distance < sleeve + .035:
                    for i in range(3):
                        point.co[i] += radial[i] * ((sleeve + .035) / distance - 1)
                point.co.z = max(point.co.z, sill)
        for vertex in cloth.data.vertices:
            vertex.co.z = max(vertex.co.z, sill)

    # ---- service fittings ------------------------------------------------
    def ladder(self, label, first, second, rungs, normal, depth=.07, rail_r=.030, rung_r=.021):
        """Two stringers on standoffs with rungs between them."""
        for a, b in (first, second):
            self.put(self.rod(self.name + '.' + label + '-rail', a, b, rail_r, self.painted, self.col, vertices=4))
            for t in (.06, .5, .94):
                point = lerp(a, b, t)
                root = tuple(point[i] - normal[i] * depth for i in range(3))
                self.put(self.rod(self.name + '.' + label + '-standoff', root, point, rung_r * .8,
                                  self.painted, self.col, vertices=4))
        for i in range(rungs):
            t = (i + .5) / rungs
            self.put(self.rod(self.name + '.' + label + '-rung', lerp(first[0], first[1], t),
                              lerp(second[0], second[1], t), rung_r, self.painted, self.col, vertices=4))

    def handrail(self, label, x0, x1, y, lift, posts):
        """A low welded rail following the roof, on short stanchions."""
        ends = [(x, y, self.top_z(x, y) + lift) for x in (x0, x1)]
        self.put(self.rod(self.name + '.' + label, ends[0], ends[1], .045, self.painted, self.col, vertices=6))
        for i in range(posts):
            x = x0 + (x1 - x0) * (i + .5) / posts
            seat = self.top_z(x, y)
            self.put(self.rod(self.name + '.' + label + '-post', (x, y, seat - .02), (x, y, seat + lift), .034,
                              self.painted, self.col, vertices=4))

    def sight_hood(self, x, y, span, width, top, hinge_side=1):
        """A hinged sighting hood sunk into the roof, with its vision slit."""
        seat = self.top_z(x, y)
        height = top - (seat - .07)
        self.put(self.box(self.name + '.sight-hood', (x, y, top - height / 2), (span, width, height),
                          self.naval, self.col, .02))
        self.put(self.rod(self.name + '.sight-hood-hinge', (x - span / 2, y - width / 2 + .04, top - .03),
                          (x - span / 2, y + width / 2 - .04, top - .03), .028, self.painted, self.col, vertices=6))
        for offset in (-1, 1):
            self.put(self.box(self.name + '.sight-hood-lug', (x - span / 2 + .05, y + offset * (width / 2 - .08), top - .03),
                              (.10, .07, .09), self.painted, self.col, .01))
        self.put(self.box(self.name + '.sight-hood-window', (x + span / 2 - .02, y, top - .10),
                          (.04, width - .22, .09), self.glass, self.col, .01))
        self.put(self.rod(self.name + '.sight-hood-handle', (x + span / 2 - .16, y - .10, top + .02),
                          (x + span / 2 - .16, y + .10, top + .02), .022, self.painted, self.col, vertices=4))

    def step(self, x, y, z=.205, span=.36, width=.16):
        """A foot step standing on the sole edge under a ladder."""
        self.put(self.box(self.name + '.step', (x, y, z), (span, width, .05), self.painted, self.col, .01))
        for sign in (-1, 1):
            self.put(self.rod(self.name + '.step-post', (x + sign * span * .35, y, .09),
                              (x + sign * span * .35, y, z), .018, self.painted, self.col, vertices=4))
