"""Shared body work for the US 14-inch/50 triple turrets (New Mexico, Tennessee).

Both classes carried the same gun on the same roller path, so the rotating sole,
the elevating masses, the sliding jackets and the canvas seals are built once
here; the gunhouse shells, the gun-port treatment and the service fittings
differ and live in the two recipes beside this file.

No reference geometry is loaded here. Authoring frame: +X muzzle, +Y port,
+Z up, yaw datum on the turntable sole (z = 0); nothing is drawn below it.
"""
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.geometry import intersect_ray_tri
from blender_barrels import barrel_layout
from gun_bloomers import create_bloomer


class Turret:
    """One triple mount under construction: rig nodes, armor shell and fittings."""

    def __init__(self, mount, col, helpers, materials):
        self.mount, self.col, self.helpers = mount, col, helpers
        self.spec = mount['weapon']
        self.name = mount['id']
        self.mesh, self.cyl, self.rod, self.box = (helpers[k] for k in ('mesh', 'cyl', 'rod', 'box'))
        palette = dict(materials)
        palette.setdefault('roof', palette['naval'])
        palette.setdefault('painted-edge', palette['edge'])
        palette.setdefault('glass', palette['dark'])
        palette.setdefault('canvas', palette['dark'])
        self.palette = palette
        self.naval, self.roof, self.edge, self.dark, self.painted, self.glass = (
            palette[k] for k in ('naval', 'roof', 'edge', 'dark', 'painted-edge', 'glass'))
        self.plates = []
        self.yaw = self.joint('yaw')

    # ---------------------------------------------------------------- rigging
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

    # ------------------------------------------------------------- armor shell
    def gunhouse(self):
        """Draw the catalog shell: it is the armor and the visible gunhouse both."""
        shape = self.spec['gunhouseMesh']
        shell = self.put(self.mesh(self.name + '.gunhouse', [tuple(v) for v in shape['vertices']],
                                   [f['indices'] for f in shape['faces']], self.naval, self.col))
        shell.data.materials.append(self.roof)
        for polygon, face in zip(shell.data.polygons, shape['faces']):
            polygon.material_index = 1 if face['finish'] == 'roof' else 0
        self.plates = [[Vector(shape['vertices'][i]) for i in f['indices']] for f in shape['faces']]
        return shell

    def cast(self, origin, direction):
        hits = [intersect_ray_tri(*t, Vector(direction), Vector(origin)) for t in self.plates]
        return [h for h in hits if h is not None]

    def front_x(self, y, z):
        """Where the glacis stands at this height, so fittings seat on the real plate."""
        return max(h.x for h in self.cast((30, y, z), (-1, 0, 0)))

    def top_z(self, x, y):
        return max(h.z for h in self.cast((x, y, 30), (0, 0, -1)))

    def side_y(self, x, z, sign=1):
        hits = self.cast((x, sign * 30, z), (0, -sign, 0))
        return sign * max(sign * h.y for h in hits) if hits else None

    def face_lean(self):
        """Pitch that lays a box flat on the glacis (its +X becomes the plate normal)."""
        low, high = self.front_x(0, .35), self.front_x(0, 1.85)
        return -math.atan2(1.50, max(.05, low - high))

    # ------------------------------------------------------------------- sole
    def sole(self, radius, thickness, sides=40):
        """Rotating sole. The Shipbuilder owns the fixed barbette below z = 0."""
        self.put(self.cyl(self.name + '.turntable', (0, 0, thickness / 2), radius, thickness,
                          self.naval, self.col, sides))
        self.put(self.cyl(self.name + '.roller-path', (0, 0, thickness * .56), radius - .22, thickness * .86,
                          self.painted, self.col, sides))

    # --------------------------------------------------------------- the guns
    def elevating(self, profile, count=14):
        """Elevation, recoil and muzzle nodes plus one connected sliding surface per gun."""
        spec = self.spec
        length = spec['muzzleForward'] - spec['trunnionForward']
        bore = spec['caliberM'] / 2
        chase = profile[-1][1]
        for side, y, _ in barrel_layout(spec):
            elevation = self.joint(side + '.elevation', self.yaw,
                                   (spec['trunnionForward'], y, spec['pivotHeight']))
            elevation.rotation_euler.y = -math.radians(self.mount.get('initialElevationDeg', 1))
            recoil = self.joint(side + '.recoil', elevation)
            self.joint(side + '.muzzle', recoil, (length, 0, 0))
            # One connected surface: jacket, shoulder, tapering chase, the muzzle
            # rim and the bore returning inboard, so nothing is a loose cap.
            stations = list(profile) + [(length, bore), (length - .40, bore), (length - .43, .03)]
            ring = lambda x, r: [(x, r * math.cos(math.tau * i / count), r * math.sin(math.tau * i / count))
                                 for i in range(count)]
            points = [p for x, r in stations for p in ring(x, r)]
            faces = [(j * count + i, j * count + (i + 1) % count, (j + 1) * count + (i + 1) % count, (j + 1) * count + i)
                     for j in range(len(stations) - 1) for i in range(count)]
            barrel = self.put(self.mesh(self.name + '.barrel', points, faces, self.edge, self.col, True), recoil)
            barrel.data.materials.append(self.dark)
            for index, polygon in enumerate(barrel.data.polygons):
                if index >= len(profile) * count:
                    polygon.material_index = 1
                polygon.use_smooth = index < (len(profile) - 1) * count
            assert chase > bore, 'the chase must stand proud of the bore for the muzzle rim'

    # ----------------------------------------------------------- canvas seals
    def bloomers(self, seam_shape, collar_x, collar_radius, sleeve, rings=5, slack=.14, fullness=.08,
                 proud=.03, sectors=20):
        """Pleated covers: fixed seam cast on the real glacis, cuff riding the jacket.

        `seam_shape(angle)` returns the (y, z) offset of the seam from the gun
        axis. Intermediate rings are draped outside the armor and kept clear of
        the sliding sleeve so the cloth never cuts through either.
        """
        spec = self.spec
        for side, y, _ in barrel_layout(spec):
            seam = []
            for i in range(sectors):
                dy, dz = seam_shape(i * math.tau / sectors)
                yy, zz = y + dy, spec['pivotHeight'] + dz
                seam.append((self.front_x(yy, zz) + proud, yy, zz))
            cover = create_bloomer(self.mount, self.col, self.helpers, self.palette, side, seam,
                                   collar_x, collar_radius, rings=rings, slack=slack, fullness=fullness)
            angles = [cover['gunCoverBaseAngle']] + list(cover['gunCoverAngles'])
            inner = len(seam)
            outer = inner * (rings - 1)
            for key, degrees in zip(cover.data.shape_keys.key_blocks, angles):
                theta = math.radians(degrees)
                axis = (math.cos(theta), 0, math.sin(theta))
                for index, point in enumerate(key.data):
                    if index < inner or index >= outer:
                        continue
                    plate = self.cast((30, point.co.y, point.co.z), (-1, 0, 0))
                    if plate:
                        point.co.x = max(point.co.x, max(h.x for h in plate) + proud)
                    delta = (point.co.x - spec['trunnionForward'], point.co.y - y,
                             point.co.z - spec['pivotHeight'])
                    along = sum(delta[i] * axis[i] for i in range(3))
                    radial = [delta[i] - along * axis[i] for i in range(3)]
                    distance = math.sqrt(sum(v * v for v in radial))
                    if 0 < distance < sleeve + .03:
                        for i in range(3):
                            point.co[i] += radial[i] * ((sleeve + .03) / distance - 1)
                    # The sole is the attachment plane: no cloth hangs below it.
                    point.co.z = max(point.co.z, .03)

    # ------------------------------------------------------- shared fittings
    def roof_hatch(self, x, y, size=(.62, .52), lift=.09):
        """Crew hatch: a coaming sunk into the roof plate with a hinged lid and a handle."""
        seat = self.top_z(x, y)
        self.put(self.box(self.name + '.hatch-coaming', (x, y, seat + .02),
                          (size[0] * 2 + .12, size[1] * 2 + .12, .12), self.naval, self.col))
        lid = self.put(self.box(self.name + '.hatch-lid', (x + .04, y, seat + .10),
                                (size[0] * 2, size[1] * 2, .07), self.painted, self.col))
        lid.rotation_euler.y = -math.radians(6)
        grip = seat + lift + .15
        for across in (-.16, .16):
            self.put(self.rod(self.name + '.hatch-handle-post', (x + .22, y + across, seat + lift - .04),
                              (x + .22, y + across, grip), .020, self.painted, self.col, vertices=4))
        self.put(self.rod(self.name + '.hatch-handle', (x + .22, y - .17, grip), (x + .22, y + .17, grip),
                          .022, self.painted, self.col, vertices=4))

    def sight_hood(self, x, y, sign, height=.44, radius=.33):
        """Periscope hood rooted in the roof plate, with a forward optical window."""
        seat = self.top_z(x, y)
        self.put(self.cyl(self.name + '.sight-hood-flange', (x, y, seat + .02), radius + .12, .07,
                          self.naval, self.col, 12))
        self.put(self.cyl(self.name + '.sight-hood', (x, y, seat + height / 2 + .05), radius, height,
                          self.naval, self.col, 12, radius * .74))
        self.put(self.cyl(self.name + '.sight-hood-cap', (x, y, seat + height + .08), radius * .78, .09,
                          self.painted, self.col, 12))
        self.put(self.box(self.name + '.sight-hood-window', (x + radius * .74, y, seat + height * .74),
                          (.04, .20, .12), self.glass, self.col))

    def flank_ladder(self, sign, foot, crown, rails=(-.20, .20), rungs=7, off=.055):
        """Ladder up a sloping flank: two rails on standoffs, welded to the real plate.

        `foot` and `crown` are (y, z) stations on the flank in the port half.
        """
        run = math.hypot(crown[0] - foot[0], crown[1] - foot[1])
        normal = ((crown[1] - foot[1]) / run, (foot[0] - crown[0]) / run)
        for x in rails:
            a = (x, sign * (foot[0] + normal[0] * off), foot[1] + normal[1] * off)
            b = (x, sign * (crown[0] + normal[0] * off), crown[1] + normal[1] * off)
            self.put(self.rod(self.name + '.ladder-rail', a, b, .028, self.painted, self.col, vertices=4))
            for t in (.14, .52, .90):
                py = foot[0] + (crown[0] - foot[0]) * t
                pz = foot[1] + (crown[1] - foot[1]) * t
                self.put(self.rod(self.name + '.ladder-standoff',
                                  (x, sign * (py - normal[0] * .02), pz - normal[1] * .02),
                                  (x, sign * (py + normal[0] * off), pz + normal[1] * off),
                                  .020, self.painted, self.col, vertices=4))
        for i in range(rungs):
            t = (.08 + i * (.84 / max(1, rungs - 1)))
            py = foot[0] + (crown[0] - foot[0]) * t + normal[0] * off
            pz = foot[1] + (crown[1] - foot[1]) * t + normal[1] * off
            self.put(self.rod(self.name + '.ladder-rung', (rails[0], sign * py, pz), (rails[1], sign * py, pz),
                              .020, self.painted, self.col, vertices=4))

    def grab_rail(self, points, sign, height=.085):
        """Grab rail on short stanchions, each post landing on the roof plate it stands on."""
        seated = []
        for x, y in points:
            surface = self.top_z(x, sign * y)
            seated.append((x, sign * y, surface + height))
            self.put(self.rod(self.name + '.grab-rail-post', (x, sign * y, surface - .01),
                              (x, sign * y, surface + height), .016, self.painted, self.col, vertices=4))
        for p, q in zip(seated, seated[1:]):
            self.put(self.rod(self.name + '.grab-rail', p, q, .018, self.painted, self.col, vertices=4))

    def finish(self):
        a, b, c = self.mount['position']
        self.yaw.location = (-c, -a, b)
        self.yaw.rotation_euler.z = -math.radians(self.mount['bearingDeg'])
        return self.yaw
