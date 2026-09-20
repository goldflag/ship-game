"""Original 40 mm/56 Bofors quadruple mounts: US Mk 2 and its shielded variant.

Three catalog parts share one body builder and switch on ``mount['weapon']['id']``:

* ``us-40mm-bofors-mk2-quad``       - the open quad (GameModels3D ``aga008``)
* ``us-40mm-bofors-mk2-shielded-quad`` - the same mount inside splinter plating
  (``aga056``; the British RP Mk II ``bga012`` is the identical model)
* ``us-40mm-bofors-mk2-mk19-quad``  - the open quad carrying a Mk 19 director
  on a lattice pylon over the port gun pair (``aga175``)

Proportions were measured off those approved references and redrawn here; no
reference mesh, transform or texture is loaded, and nothing is copied out of
another recipe. Authoring frame: +X muzzle, +Y port, +Z up, metres, with the
yaw datum on the sole plane (z = 0).

The four guns really stand at y = +-0.8925 and +-0.6315. The simulation places
muzzles on one evenly spaced row, so the joints follow ``barrelSpacing`` while
the tubes, receivers and cradles keep their true stations; the lateral offset
between a tube and its muzzle socket is the documented approximation.
"""
import bpy
import math
from mathutils import Matrix
from blender_barrels import barrel_layout

# --- measured layout ------------------------------------------------------
PAIR = .762                       # lateral centre of each two-gun group
TRUE_LATERAL = (.8925, .6315, -.6315, -.8925)   # port to starboard
SLOT = .261                       # half width of the open gun bay in a standard
CHEEK = .058                      # trunnion standard side-plate thickness

# Trunnion standard side profile (x, z), counter-clockwise, from the reference.
STANDARD = [(-.030, 1.835), (-.084, 1.796), (-.103, 1.733), (.021, 1.316),
            (.065, 1.174), (.065, .837), (-.314, .375), (.411, .375),
            (.411, 1.316), (.090, 1.796), (.036, 1.835)]
SLOT_FLOOR = .830                 # the gun bay is open above this height

# Ammunition chute centre line (x, z); the trough runs from the loaders'
# station down through the platform slot and forward under the guns.
CHUTE = [(-1.283, 1.801), (-1.275, 1.518), (-1.183, 1.223), (-1.028, .956),
         (-.799, .720), (-.504, .543), (-.206, .451)]

DECK_Z = (.681, .805)             # loading platform slab
RAIL_Z = 1.78

# Shielded variant: plan of the splinter plating and the four front cut-downs.
SHIELD_TOP, SHIELD_NOTCH = 2.351, 1.452
SHIELD_SIDE = [(-.953, 1.867, .748, 2.248), (-.608, 1.988, .748, SHIELD_TOP),
               (-.084, 2.167, 1.276, SHIELD_TOP), (.905, 1.986, 1.276, SHIELD_TOP)]
# Front wall spans (y0, y1, top): four cut-downs let the guns and sights train.
SHIELD_FRONT = [(-1.986, -1.890, SHIELD_TOP), (-1.890, -1.627, SHIELD_NOTCH),
                (-1.627, -1.028, SHIELD_TOP), (-1.028, -.496, SHIELD_NOTCH),
                (-.496, .496, SHIELD_TOP), (.496, 1.028, SHIELD_NOTCH),
                (1.028, 1.627, SHIELD_TOP), (1.627, 1.890, SHIELD_NOTCH),
                (1.890, 1.986, SHIELD_TOP)]


class Quad:
    """Small builder: named joints, parented primitives and extruded plates."""

    def __init__(self, mount, col, helpers, materials):
        self.mount, self.col, self.h = mount, col, helpers
        self.m = dict(materials)
        self.m.setdefault('roof', self.m['naval'])
        self.m.setdefault('painted-edge', self.m['edge'])
        self.name = mount['id']
        self.s = mount['weapon']
        self.yaw = self.joint('yaw')

    # joints ---------------------------------------------------------------
    def joint(self, suffix, parent=None, loc=(0, 0, 0)):
        node = bpy.data.objects.new(self.name + '.' + suffix, None)
        self.col.objects.link(node)
        node.location = loc
        node.parent = parent
        node['nodeId'] = node.name
        node['assemblyId'] = self.name
        return node

    def gun_joints(self, side, lateral):
        spec = self.s
        pitch = self.joint(side + '.elevation', self.yaw,
                           (spec['trunnionForward'], lateral, spec['pivotHeight']))
        pitch.rotation_euler.y = -math.radians(self.mount.get('initialElevationDeg', 1))
        recoil = self.joint(side + '.recoil', pitch)
        self.joint(side + '.muzzle', recoil,
                   (spec['muzzleForward'] - spec['trunnionForward'], 0, 0))
        return pitch, recoil

    # primitives -----------------------------------------------------------
    def put(self, ob, parent=None):
        ob.parent = parent or self.yaw
        ob.matrix_parent_inverse = Matrix.Identity(4)
        ob['assemblyId'] = self.name
        return ob

    def mat(self, role):
        return self.m.get(role, self.m['naval'])

    def box(self, n, loc, dim, role='naval', parent=None):
        return self.put(self.h['box'](self.name + '.' + n, loc, dim, self.mat(role), self.col), parent)

    def cyl(self, n, loc, r, depth, role='naval', parent=None, r2=None, sides=12):
        return self.put(self.h['cyl'](self.name + '.' + n, loc, r, depth, self.mat(role),
                                      self.col, sides, r2), parent)

    def rod(self, n, a, b, r, role='naval', parent=None, r2=None, sides=8):
        return self.put(self.h['rod'](self.name + '.' + n, a, b, r, self.mat(role), self.col,
                                      r2, sides), parent)

    def mesh(self, n, verts, faces, role='naval', parent=None, smooth=False):
        return self.put(self.h['mesh'](self.name + '.' + n, verts, faces, self.mat(role),
                                       self.col, smooth), parent)

    def plate(self, n, profile, y0, y1, role='naval', parent=None):
        """Polygon in (x, z) extruded between two lateral stations."""
        k = len(profile)
        verts = [(x, y, z) for y in (y0, y1) for x, z in profile]
        faces = [tuple(reversed(range(k))), tuple(range(k, 2 * k))]
        faces += [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)]
        return self.mesh(n, verts, faces, role, parent)

    def slab(self, n, quads, boundary, z0, z1, role='naval', parent=None):
        """Flat deck: a set of (x, y) faces with a shared closed outline."""
        index, verts = {}, []

        def vid(x, y, z):
            key = (round(x, 4), round(y, 4), round(z, 4))
            if key not in index:
                index[key] = len(verts)
                verts.append((x, y, z))
            return index[key]

        faces = []
        for quad in quads:
            faces.append(tuple(vid(x, y, z1) for x, y in quad))
            faces.append(tuple(reversed([vid(x, y, z0) for x, y in quad])))
        for (ax, ay), (bx, by) in zip(boundary, boundary[1:] + boundary[:1]):
            faces.append((vid(ax, ay, z0), vid(bx, by, z0), vid(bx, by, z1), vid(ax, ay, z1)))
        return self.mesh(n, verts, faces, role, parent)

    def hoop(self, n, centre, radius, wire, role='edge', parent=None, segments=10):
        """Ring lying in the plane normal to local +X (a sight ring)."""
        cx, cy, cz = centre
        verts, faces = [], []
        for i in range(segments):
            a = i * math.tau / segments
            uy, uz = math.cos(a), math.sin(a)
            for dx, dr in ((-wire, -wire), (-wire, wire), (wire, wire), (wire, -wire)):
                verts.append((cx + dx, cy + uy * (radius + dr), cz + uz * (radius + dr)))
        for i in range(segments):
            j = (i + 1) % segments
            for c in range(4):
                faces.append((i * 4 + c, i * 4 + (c + 1) % 4, j * 4 + (c + 1) % 4, j * 4 + c))
        return self.mesh(n, verts, faces, role, parent)

    def wheel(self, n, centre, radius, role='edge', parent=None):
        cx, cy, cz = centre
        self.cyl(n, (cx, cy, cz), radius, .022, role, parent, sides=12).rotation_euler.x = math.pi / 2
        self.cyl(n + ' hub', (cx, cy, cz), .045, .07, role, parent, sides=8).rotation_euler.x = math.pi / 2
        for i in range(3):
            a = i * math.tau / 3
            self.rod(n + ' spoke', (cx, cy, cz), (cx + radius * math.cos(a), cy, cz + radius * math.sin(a)),
                     .013, role, parent, sides=4)
        self.rod(n + ' crank', (cx, cy + .015, cz + radius), (cx, cy + .10, cz + radius),
                 .017, role, parent, sides=6)

    def channel(self, n, path, y, half_floor, half_lip, depth, role='painted-edge', parent=None):
        """U-section trough swept along a path in (x, z), opening along +normal."""
        rows = []
        for i, (x, z) in enumerate(path):
            a = path[max(0, i - 1)]
            b = path[min(len(path) - 1, i + 1)]
            tx, tz = b[0] - a[0], b[1] - a[1]
            length = math.hypot(tx, tz) or 1
            nx, nz = -tz / length, tx / length
            rows.append([(x + nx * depth, y + half_lip, z + nz * depth),
                         (x, y + half_floor, z),
                         (x, y - half_floor, z),
                         (x + nx * depth, y - half_lip, z + nz * depth)])
        verts = [v for row in rows for v in row]
        faces = []
        for i in range(len(rows) - 1):
            for c in range(3):
                faces.append((i * 4 + c, i * 4 + c + 1, (i + 1) * 4 + c + 1, (i + 1) * 4 + c))
        trough = self.mesh(n, verts, faces, role, parent)
        solid = trough.modifiers.new('Chute plate', 'SOLIDIFY')
        solid.thickness = .018
        solid.offset = 0
        return trough

    def ribbon(self, n, stations, thickness, role='naval', parent=None):
        """Vertical wall through (x, y, z_bottom, z_top) stations, given thickness."""
        verts = [c for x, y, z0, z1 in stations for c in ((x, y, z0), (x, y, z1))]
        faces = [(i * 2, i * 2 + 1, i * 2 + 3, i * 2 + 2) for i in range(len(stations) - 1)]
        wall = self.mesh(n, verts, faces, role, parent)
        solid = wall.modifiers.new('Shield thickness', 'SOLIDIFY')
        solid.thickness = thickness
        solid.offset = 0
        return wall

    def finish(self):
        x, y, z = self.mount['position']
        self.yaw.location = (-z, -x, y)
        self.yaw.rotation_euler.z = -math.radians(self.mount['bearingDeg'])
        return self.yaw


def create_mount(mount, col, helpers, materials):
    b = Quad(mount, col, helpers, materials)
    spec = b.s
    variant = spec['id']
    shielded = 'shielded' in variant
    director = 'mk19' in variant
    tf, ph = spec['trunnionForward'], spec['pivotHeight']
    reach = spec['muzzleForward'] - tf

    # ---------------------------------------------------------------- sole
    b.cyl('sole ring', (0, 0, .112), .996, .224, 'naval', sides=14)
    b.cyl('training race', (0, 0, .280), .996, .112, 'edge', r2=.822, sides=14)
    b.cyl('roller path', (0, 0, .352), .806, .038, 'painted-edge', sides=14)

    # ------------------------------------------------------------- carriage
    corner = .16
    plan = [(.892 - corner, -1.163), (.892, -1.163 + corner), (.892, 1.163 - corner),
            (.892 - corner, 1.163), (-1.131 + corner, 1.163), (-1.131, 1.163 - corner),
            (-1.131, -1.163 + corner), (-1.131 + corner, -1.163)]
    b.slab('carriage deck', [plan], plan, .320, .386, 'naval')
    sill = [(.892, .320), (.892, .386), (-.019, .386), (-.333, .692), (-1.131, .692), (-1.131, .320)]
    for sign in (-1, 1):
        b.plate('carriage sill', sill, sign * 1.091, sign * 1.163, 'naval')
    for x in (-1.02, -.22, .68):
        b.box('carriage cross beam', (x, 0, .420), (.14, 2.18, .10), 'naval')
    # Centre body between the two gun bays: pintle bearing and training machinery.
    b.cyl('pintle housing', (0, 0, .40), .54, .24, 'naval', sides=12)
    b.box('centre machinery casing', (-.20, 0, .545), (1.62, .98, .32), 'naval')
    b.box('training motor', (.56, 0, .560), (.44, .62, .35), 'edge')

    # ------------------------------------------- trunnion standards (fixed)
    for sign in (1, -1):
        yc = sign * PAIR
        for inner in (-1, 1):
            edge = yc + inner * (SLOT + CHEEK / 2)
            b.plate('trunnion standard cheek', STANDARD, edge - CHEEK / 2, edge + CHEEK / 2, 'naval')
            # Trunnion bearing boss straddling the elevation axis.
            b.rod('trunnion bearing', (tf, edge, ph - .037), (tf + .001, edge + inner * .085, ph - .037),
                  .088, 'edge', sides=10)
        heel = [(-.314, .375), (.411, .375), (.411, SLOT_FLOOR), (.059, SLOT_FLOOR)]
        b.plate('standard heel', heel, yc - SLOT, yc + SLOT, 'naval')
        b.plate('standard nose', [(.411, .538), (.621, .538), (.621, 1.316), (.411, 1.316)],
                yc - SLOT - CHEEK, yc + SLOT + CHEEK, 'naval')
        b.box('gun bay front web', (.340, yc, .950), (.142, 2 * SLOT, .240), 'naval')
        b.box('gear case', (.300, yc - sign * (SLOT + .05), 1.28), (.22, .17, .28), 'edge')

    # ---------------------------------------------- loading platform (fixed)
    z0, z1 = DECK_Z
    edge_y = 1.741            # outline half width at the platform slot station
    quads = [[(-1.367, -1.614), (-.998, -edge_y), (-.998, edge_y), (-1.367, 1.614)],
             [(-.998, -.447), (-.304, -.447), (-.304, .447), (-.998, .447)],
             [(-.998, 1.071), (-.304, 1.071), (-.304, 1.980), (-.998, edge_y)],
             [(-.998, -edge_y), (-.304, -1.980), (-.304, -1.071), (-.998, -1.071)]]
    boundary = [(-.304, 1.980), (-.998, edge_y), (-1.367, 1.614), (-1.367, -1.614),
                (-.998, -edge_y), (-.304, -1.980), (-.304, -1.071), (-.998, -1.071),
                (-.998, -.447), (-.304, -.447), (-.304, .447), (-.998, .447),
                (-.998, 1.071), (-.304, 1.071)]
    b.slab('loading platform', quads, boundary, z0, z1, 'roof')
    for sign in (-1, 1):
        b.plate('platform bearer', [(-1.32, .40), (-.36, .40), (-.36, z0), (-1.32, z0)],
                sign * 1.16, sign * 1.22, 'naval')
        b.plate('platform outboard bearer', [(-1.02, .55), (-.44, .62), (-.44, z0), (-1.02, z0)],
                sign * 1.62, sign * 1.68, 'naval')
        b.rod('platform knee', (-.44, sign * 1.19, .52), (-.44, sign * 1.86, z0 - .01), .045, 'naval')
        b.box('ready service locker', (-1.175, sign * .762, 1.00), (.35, .74, .39), 'naval')

    # handrail round the loaders' platform
    for sign in (-1, 1):
        line = [(-.320, sign * 1.935), (-1.120, sign * 1.660), (-1.350, sign * 1.160),
                (-1.350, sign * .370)]
        for x, y in line:
            b.rod('handrail stanchion', (x, y, z1 - .02), (x, y, RAIL_Z), .022, 'painted-edge', sides=4)
        for a, c in zip(line, line[1:]):
            b.rod('handrail', (a[0], a[1], RAIL_Z), (c[0], c[1], RAIL_Z), .022, 'painted-edge', sides=4)

    # ------------------------------------------------ gunners' outriggers
    for sign in (-1, 1):
        arm = [(.41, .32), (.41, 1.30), (.30, 1.38), (-.20, 1.38), (-.20, .32)]
        b.plate('outrigger bracket', arm, sign * 1.127 - .035, sign * 1.127 + .035, 'naval')
        b.plate('outrigger web', [(.56, .62), (.56, .97), (-.12, .97), (-.12, .62)],
                sign * 1.75 - .028, sign * 1.75 + .028, 'naval')
        b.rod('outrigger beam', (.275, sign * 1.02, .94), (.275, sign * 1.78, .94), .034, 'naval')
        b.rod('outrigger tie', (-.14, sign * 1.13, .76), (-.14, sign * 1.78, .84), .030, 'naval')
        b.rod('seat stalk', (-.085, sign * 1.75, .86), (-.115, sign * 1.75, 1.26), .046, 'naval')
        b.cyl('gunner seat', (-.125, sign * 1.745, 1.285), .215, .07, 'roof', sides=10)
        b.box('seat back', (-.275, sign * 1.745, 1.295), (.10, .49, .11), 'roof')
        b.rod('footrest bracket', (.30, sign * 1.75, .93), (.62, sign * 1.75, .885), .030, 'naval')
        b.box('footrest', (.655, sign * 1.75, .880), (.31, .44, .05), 'edge')
        b.box('layer gearbox', (.225, sign * 1.19, 1.31), (.19, .26, .17), 'edge')
        b.rod('handwheel shaft', (.22, sign * 1.30, 1.31), (.22, sign * 1.46, 1.31), .028, 'edge', sides=6)
        b.wheel('handwheel', (.22, sign * 1.48, 1.31), .12, 'edge')

    # power drives on the front of the carriage (asymmetric, as on the model)
    b.box('elevation power drive', (.510, 1.170, 1.20), (.19, .17, .28), 'edge')
    b.box('training power drive', (.510, -.355, 1.20), (.19, .17, .28), 'edge')
    b.rod('drive cross shaft', (.510, -.33, 1.005), (.510, .46, 1.005), .028, 'edge', sides=6)
    for y in (1.170, -.355):
        b.rod('drive column', (.510, y, .36), (.510, y, 1.06), .050, 'naval')

    # ------------------------------------------- ammunition chutes (fixed)
    for y in TRUE_LATERAL:
        b.channel('ammunition chute', CHUTE, y, .046, .069, .075, 'painted-edge')
        b.rod('chute stay', (-1.283, y, 1.17), (-1.283, y, 1.801), .028, 'painted-edge', sides=6)
        b.rod('chute stay', (-.62, y, z0), (-.55, y, .52), .026, 'painted-edge', sides=6)
        for x, z, slope in ((-1.150, 1.235, 1.72), (-.980, .958, 1.03)):
            clip = b.box('ammunition clip', (x, y, z), (.22, .085, .075), 'edge')
            clip.rotation_euler.y = math.atan(slope)
        # Forward spent-case chute under each gun, discharging clear of the mount.
        b.rod('case chute', (.408, y, .472), (1.399, y, .392), .055, 'painted-edge', sides=3)
        b.rod('case chute mouth', (1.330, y, .400), (1.420, y, .388), .070, 'edge', sides=3)

    # ------------------------------------------------------- gun assemblies
    stations = barrel_layout(spec)
    pairs = {}
    for index, ((side, uniform, _), lateral) in enumerate(zip(stations, TRUE_LATERAL)):
        pitch, recoil = b.gun_joints(side, uniform)
        pairs.setdefault(0 if index < 2 else 1, []).append((pitch, uniform, lateral))
        off = lateral - uniform                 # tube offset from the sim's row

        # recoiling tube: jacket, chase, flash hider and a dark bore
        rings = [(.075, .095), (1.095, .095), (1.143, .070), (1.917, .066),
                 (2.090, .050), (2.300, .050), (2.372, .052), (reach, .088), (reach, .022)]
        k = 8
        verts = [(t, off + r * math.cos(i * math.tau / k), r * math.sin(i * math.tau / k))
                 for t, r in rings for i in range(k)]
        faces = [(j * k + i, j * k + (i + 1) % k, (j + 1) * k + (i + 1) % k, (j + 1) * k + i)
                 for j in range(len(rings) - 1) for i in range(k)]
        b.mesh(side + ' barrel', verts, faces, 'edge', recoil, True)
        b.rod(side + ' bore', (reach - .16, off, 0), (reach - .14, off, 0), .021, 'dark', recoil, sides=8)
        b.box(side + ' breech block', (-.22, off, -.012), (.34, .20, .21), 'edge', recoil)
        b.rod(side + ' recoil rod', (-.52, off, -.116), (-.10, off, -.116), .026, 'edge', recoil, sides=6)

        # cradle fittings that ride the elevation joint
        b.box(side + ' cradle guide', (.338, off, -.116), (.526, .076, .062), 'edge', pitch)
        b.rod(side + ' recoil cylinder', (.10, off + .075, -.085), (.90, off + .075, -.085),
              .034, 'edge', pitch, sides=6)
        b.rod(side + ' recoil cylinder', (.10, off - .075, -.085), (.90, off - .075, -.085),
              .034, 'edge', pitch, sides=6)
        b.plate(side + ' cradle bracket', [(.42, -.070), (.55, -.070), (.485, -.200)],
                off - .048, off + .048, 'edge', pitch)
        # automatic loader with its clip guide above the receiver
        b.mesh(side + ' loader guide',
               [(-.72, off - .043, .105), (-.72, off + .043, .105), (-.28, off + .043, .105),
                (-.28, off - .043, .105), (-.72, off - .043, .455), (-.72, off + .043, .455),
                (-.28, off + .043, .250), (-.28, off - .043, .250)],
               [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (3, 7, 6, 2), (1, 2, 6, 5), (0, 4, 7, 3)],
               'edge', pitch)
        clip = b.box(side + ' loaded clip', (-.50, off, .345), (.34, .075, .070), 'edge', pitch)
        clip.rotation_euler.y = -math.radians(24)

    # per-pair elevating structure, hung on the outer barrel's joint
    for group, members in pairs.items():
        pitch, uniform, _ = members[0]
        yc = PAIR if group == 0 else -PAIR
        c = yc - uniform                     # pair centre in that joint's frame
        b.mesh('receiver housing',
               [(t, c + dy, p) for t, p in ((-.82, -.20), (.08, -.20), (.08, .105), (-.82, .105))
                for dy in (-.250, .250)],
               [(0, 2, 4, 6), (7, 5, 3, 1), (0, 1, 3, 2), (2, 3, 5, 4), (4, 5, 7, 6), (6, 7, 1, 0)],
               'naval', pitch)
        for dy in (-.2455, .2455):
            b.box('receiver panel', (-.37, c + dy, -.050), (.62, .018, .16), 'dark', pitch)
        b.box('receiver front recess', (.086, c, -.050), (.030, .42, .21), 'dark', pitch)
        # Toothed elevating arc: a segment of radius .515 about the trunnion.
        arc = [(.482, -.181)]
        for i in range(11):
            a = math.radians(-20.6 - 13.88 * i)
            arc.append((.515 * math.cos(a), .515 * math.sin(a)))
        arc.append((-.482, -.181))
        b.plate('elevating arc', arc, c - .028, c + .028, 'edge', pitch)
        b.box('arc pinion', (.06, c + .062, -.472), (.12, .10, .12), 'edge', pitch)

    # -------------------------------------------------- gunners' sights
    for group, members in pairs.items():
        pitch, uniform, _ = members[0]
        sign = 1 if group == 0 else -1
        inner = sign * (PAIR - .14) - uniform
        outer = sign * 1.755 - uniform
        inb = -sign                          # inboard direction in the joint frame
        b.rod('sight arm', (.45, inner, .160), (.48, sign * 1.15 - uniform, .010), .028, 'edge', pitch, sides=6)
        b.rod('sight arm', (.48, sign * 1.15 - uniform, .010), (.52, outer + inb * .20, -.115),
              .028, 'edge', pitch, sides=6)
        b.rod('sight arm stay', (.22, inner, .175), (.30, outer + inb * .20, -.110), .020, 'edge', pitch, sides=4)
        # Open sight cage: two arches over a base rail, with the ring between them.
        legs = [(outer + inb * .201, -.115), (outer + inb * .095, .165),
                (outer, .206), (outer - inb * .105, .150), (outer - inb * .162, .052)]
        for t in (.287, .650):
            for a, c2 in zip(legs, legs[1:]):
                b.rod('sight arch', (t, a[0], a[1]), (t, c2[0], c2[1]), .016, 'edge', pitch, sides=4)
        for y, p in (legs[0], legs[2], legs[4]):
            b.rod('sight stringer', (.287, y, p), (.650, y, p), .014, 'edge', pitch, sides=4)
        b.hoop('ring sight', (.650, outer, .075), .082, .011, 'edge', pitch)
        b.rod('sight crosshair', (.650, outer - .082, .075), (.650, outer + .082, .075), .004, 'dark', pitch, sides=4)
        b.rod('sight crosshair', (.650, outer, -.007), (.650, outer, .157), .004, 'dark', pitch, sides=4)
        b.hoop('rear peep', (.287, outer, .075), .040, .011, 'edge', pitch)

    # ------------------------------------------------- splinter shielding
    if shielded:
        stations = [(x, -y, z0s, z1s) for x, y, z0s, z1s in SHIELD_SIDE]
        # Each cut-down span gets its own pair of stations so the vertical step
        # between two top heights is a real face, not a degenerate one.
        for y0, y1, top in SHIELD_FRONT:
            stations += [(.905, y0 + .003, 1.276, top), (.905, y1 - .003, 1.276, top)]
        stations += list(reversed(SHIELD_SIDE))
        b.ribbon('splinter shield', stations, .045, 'naval')
        for sign in (-1, 1):
            b.rod('shield lip', (.684, sign * 1.986, SHIELD_TOP), (.905, sign * 1.986, SHIELD_TOP),
                  .030, 'naval', sides=4)
            # Every plate is carried: two knees off the outrigger, a bracket on
            # the platform edge and a strut from the standard nose to the front.
            b.rod('shield knee', (.275, sign * 1.76, .94), (.300, sign * 2.085, 1.276), .034, 'naval', sides=6)
            b.rod('shield knee', (-.12, sign * 1.74, .95), (-.150, sign * 2.145, 1.276), .034, 'naval', sides=6)
            b.rod('shield bracket', (-.80, sign * 1.80, .78), (-.80, sign * 1.955, .78), .030, 'naval', sides=4)
            b.rod('shield front strut', (.615, sign * .90, 1.28), (.885, sign * .90, 1.34), .032, 'naval', sides=4)

    # ------------------------------------------------- Mk 19 director pylon
    if director:
        pitch, uniform, _ = pairs[0][0]
        c = PAIR - uniform
        for dy in (-.207, .207):
            y = c + dy
            b.box('director bearer', (.125, y, .112), (.86, .06, .05), 'edge', pitch)
            b.rod('director leg', (.50, y, .100), (.33, y, .900), .026, 'painted-edge', pitch, sides=4)
            b.rod('director leg', (.06, y, .084), (.30, y, .908), .026, 'painted-edge', pitch, sides=4)
            b.rod('director leg brace', (.28, y, .430), (.46, y, .440), .018, 'painted-edge', pitch, sides=4)
        for t, p in ((.30, .350), (.42, .620), (.31, .880)):
            b.rod('director cross brace', (t, c - .207, p), (t, c + .207, p), .018, 'painted-edge', pitch, sides=4)
        b.box('director trunnion', (.21, c, .900), (.20, .50, .10), 'edge', pitch)
        b.box('director housing', (.10, c, .980), (.34, .30, .34), 'naval', pitch)
        b.rod('director dish back', (.46, c, .985), (.56, c, .985), .150, 'naval', pitch, r2=.360, sides=14)
        b.rod('director dish rim', (.555, c, .985), (.585, c, .985), .360, 'edge', pitch, r2=.395, sides=14)
        b.rod('director feed arm', (.58, c, .985), (.79, c, .985), .022, 'edge', pitch, sides=6)
        b.box('director feed horn', (.80, c, .985), (.10, .07, .07), 'edge', pitch)

    return b.finish()
