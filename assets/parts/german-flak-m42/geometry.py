"""Original 3.7 cm Flak M42 naval mounts: the LM/42 twin (Zwilling) and the LM/42 single.

Authored against the approved GameModels3D references gga043_37mm_flak_m42_zwilling and
gga034_37mm_flak_m42. No source mesh, texture or reference transform is imported: every
dimension is an editable catalog input taken from measurements of those references and
re-expressed at this catalog's neutral one-degree pose. The references bake their barrels
at thirty degrees, so elevating and recoiling geometry below is written in the trunnion
frame (origin on the trunnion, +X along the bore) and the yaw frame carries only the
training structure. Fidelity to the reference silhouette is the target; nothing here is a
historical certification.
"""
import bpy
import math
from mathutils import Matrix
from blender_barrels import barrel_layout

# Gun shield centre surface, in the yaw frame. One straight panel leaning aft, then a
# shallower top band folded back above the knuckle. Half thickness is applied normally.
SHIELD_CENTRE = [(0.7225, 0.370), (0.3205, 1.642), (-0.0105, 1.9805)]
SHIELD_HALF = 0.010
KNUCKLE_NORMAL = (0.8576, 0.5143)
KNUCKLE_SCALE = 1.028


def _panel(index):
    (x0, z0), (x1, z1) = SHIELD_CENTRE[index], SHIELD_CENTRE[index + 1]
    length = math.hypot(x1 - x0, z1 - z0)
    return (x0, z0), (x1, z1), ((z1 - z0) / length, -(x1 - x0) / length)


def shield_point(height):
    """Centre-surface point and outward normal of the shield at a given height."""
    for index in range(len(SHIELD_CENTRE) - 1):
        (x0, z0), (x1, z1), normal = _panel(index)
        if height <= z1 or index == len(SHIELD_CENTRE) - 2:
            share = (height - z0) / (z1 - z0)
            return (x0 + share * (x1 - x0), height), normal
    raise ValueError(height)


def shield_profile(low, high):
    """Closed section of the shield plate between two heights, knuckle included."""
    stations = [shield_point(low)]
    knuckle = SHIELD_CENTRE[1][1]
    if low < knuckle < high:
        stations.append(((SHIELD_CENTRE[1]), (KNUCKLE_NORMAL[0] * KNUCKLE_SCALE,
                                              KNUCKLE_NORMAL[1] * KNUCKLE_SCALE)))
    stations.append(shield_point(high))
    outer = [(x + SHIELD_HALF * nx, z + SHIELD_HALF * nz) for (x, z), (nx, nz) in stations]
    inner = [(x - SHIELD_HALF * nx, z - SHIELD_HALF * nz) for (x, z), (nx, nz) in stations]
    return outer + inner[::-1]


class Mount:
    """Joint-aware builder shared by the twin and the single LM/42 carriage."""

    def __init__(self, mount, collection, helpers, materials):
        self.mount, self.col, self.h, self.m = mount, collection, helpers, materials
        self.name = mount['id']
        self.spec = mount['weapon']
        self.yaw = self.joint('yaw')

    # joints and parenting -------------------------------------------------
    def joint(self, suffix, parent=None, location=(0, 0, 0)):
        node = bpy.data.objects.new(self.name + '.' + suffix, None)
        self.col.objects.link(node)
        node.location = location
        node.parent = parent
        node['nodeId'] = node.name
        node['assemblyId'] = self.name
        return node

    def gun_joints(self, side, lateral):
        spec = self.spec
        pitch = self.joint(side + '.elevation', self.yaw,
                           (spec['trunnionForward'], lateral, spec['pivotHeight']))
        pitch.rotation_euler.y = -math.radians(self.mount.get('initialElevationDeg', 1))
        recoil = self.joint(side + '.recoil', pitch)
        self.joint(side + '.muzzle', recoil,
                   (spec['muzzleForward'] - spec['trunnionForward'], 0, 0))
        return pitch, recoil

    def put(self, obj, parent=None):
        obj.parent = parent or self.yaw
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj['assemblyId'] = self.name
        return obj

    def mat(self, role):
        return self.m.get(role, self.m['naval'])

    # primitives -----------------------------------------------------------
    def box(self, name, location, dimensions, role='naval', parent=None):
        return self.put(self.h['box'](self.name + '.' + name, location, dimensions,
                                      self.mat(role), self.col), parent)

    def cyl(self, name, location, radius, depth, role='naval', parent=None,
            radius2=None, sides=14):
        return self.put(self.h['cyl'](self.name + '.' + name, location, radius, depth,
                                      self.mat(role), self.col, sides, radius2), parent)

    def rod(self, name, start, end, radius, role='naval', parent=None, radius2=None, sides=8):
        return self.put(self.h['rod'](self.name + '.' + name, start, end, radius,
                                      self.mat(role), self.col, radius2, sides), parent)

    def mesh(self, name, vertices, faces, role='naval', parent=None):
        return self.put(self.h['mesh'](self.name + '.' + name, vertices, faces,
                                       self.mat(role), self.col), parent)

    def plate(self, name, profile, y0, y1, role='naval', parent=None):
        """Prism of a closed (x, z) profile swept between two lateral stations."""
        count = len(profile)
        vertices = [(x, y, z) for y in (y0, y1) for x, z in profile]
        faces = [tuple(reversed(range(count))), tuple(range(count, 2 * count))]
        faces += [(i, (i + 1) % count, (i + 1) % count + count, i + count)
                  for i in range(count)]
        return self.mesh(name, vertices, faces, role, parent)

    def torus(self, name, centre, radius, tube, role='edge', parent=None,
              segments=12, axis='x'):
        cx, cy, cz = centre
        vertices = []
        for i in range(segments):
            angle = i * math.tau / segments
            for j in range(4):
                turn = j * math.tau / 4 + math.pi / 4
                ring = radius + tube * math.cos(turn)
                lift = tube * math.sin(turn)
                if axis == 'x':
                    vertices.append((cx + lift, cy + ring * math.cos(angle),
                                     cz + ring * math.sin(angle)))
                else:
                    vertices.append((cx + ring * math.cos(angle), cy + lift,
                                     cz + ring * math.sin(angle)))
        faces = [(i * 4 + j, i * 4 + (j + 1) % 4,
                  ((i + 1) % segments) * 4 + (j + 1) % 4, ((i + 1) % segments) * 4 + j)
                 for i in range(segments) for j in range(4)]
        return self.mesh(name, vertices, faces, role, parent)

    def handwheel(self, name, centre, radius, parent=None, axis='x'):
        cx, cy, cz = centre
        self.torus(name + ' rim', centre, radius, 0.016, 'edge', parent, 10, axis)
        for i in range(3):
            angle = i * math.tau / 3
            if axis == 'x':
                tip = (cx, cy + radius * math.cos(angle), cz + radius * math.sin(angle))
            else:
                tip = (cx + radius * math.cos(angle), cy, cz + radius * math.sin(angle))
            self.rod(name + ' spoke', centre, tip, 0.011, 'edge', parent, sides=4)
        self.cyl(name + ' hub', centre, 0.026, 0.05, 'edge', parent, sides=8)
        grip = (cx + 0.05, cy + radius * 0.92, cz) if axis == 'x' else (cx, cy + 0.05, cz)
        self.rod(name + ' crank grip', (cx, cy + radius * 0.92, cz) if axis == 'x'
                 else (cx + radius * 0.92, cy, cz), grip, 0.014, 'edge', parent, sides=6)

    def barrel(self, name, length, parent, bore, tube=0.0462, flare=0.070, root=0.058):
        """Stepped autocannon tube: breech collar, plain tube, flash hider, bore shadow."""
        steps = [(-0.06, root), (0.10, root), (0.12, tube), (length - 0.215, tube),
                 (length - 0.20, flare * 0.92), (length - 0.05, flare), (length, flare),
                 (length, bore), (length - 0.11, bore)]
        sides = 8
        vertices = [(x, r * math.cos(i * math.tau / sides), r * math.sin(i * math.tau / sides))
                    for x, r in steps for i in range(sides)]
        faces = [(j * sides + i, j * sides + (i + 1) % sides,
                  (j + 1) * sides + (i + 1) % sides, (j + 1) * sides + i)
                 for j in range(len(steps) - 1) for i in range(sides)]
        self.mesh(name, vertices, faces, 'edge', parent)
        self.rod(name + ' bore shadow', (length - 0.115, 0, 0), (length - 0.11, 0, 0),
                 bore * 0.97, 'dark', parent, sides=8)

    def finish(self):
        px, py, pz = self.mount['position']
        self.yaw.location = (-pz, -px, py)
        self.yaw.rotation_euler.z = -math.radians(self.mount['bearingDeg'])
        return self.yaw


# ---------------------------------------------------------------------------
# Variant tables. Shield bands are (y0, y1, low, high) on the port half and are
# mirrored to starboard; the openings between them are the reference's slots.
# ---------------------------------------------------------------------------
TWIN = dict(
    half=0.907, cheek=0.316, standard=0.392, slot_low=1.000, corner=True,
    bands=[(0.000, 0.068, 0.367, 1.100), (0.068, 0.238, 0.367, 0.972),
           (0.238, 0.333, 0.367, 1.100), (0.333, 0.540, 0.367, 1.973),
           (0.540, 0.695, 0.367, 1.174), (0.540, 0.695, 1.875, 1.973),
           (0.695, 0.764, 0.367, 1.973), (0.764, 0.840, 0.408, 1.973),
           (0.840, 0.907, 0.506, 1.973),
           (0.000, 0.068, 1.642, 1.973), (0.238, 0.333, 1.642, 1.973)],
)
SINGLE = dict(
    half=0.852, cheek=0.210, standard=0.286, slot_low=1.000, corner=False,
    bands=[(0.000, 0.080, 0.367, 0.972), (0.080, 0.540, 0.367, 1.973),
           (0.540, 0.695, 0.367, 1.174), (0.695, 0.852, 0.367, 1.973)],
)


def _variant(spec):
    return SINGLE if spec.get('barrelCount', 2) == 1 else TWIN


def create_mount(mount, collection, helpers, materials):
    b = Mount(mount, collection, helpers, materials)
    spec = b.spec
    shape = _variant(spec)
    reach = spec['muzzleForward'] - spec['trunnionForward']

    _pedestal(b, shape['standard'])
    _shield(b, shape)
    _stations(b, shape)
    _elevating(b, shape, reach)
    return b.finish()


# ---------------------------------------------------------------------------
def _pedestal(b, standard):
    """Deck sole, the two splayed training legs, the gun well and the standards.

    The head is a well: two side beams outboard of the breech sweep over a low
    floor, so the breech end can drop between them at high elevation.
    """
    b.cyl('sole plate', (0, 0, 0.030), 0.435, 0.060, 'edge', sides=12)
    b.cyl('training race', (0, 0, 0.098), 0.400, 0.076, 'naval', sides=12)
    b.cyl('training bearing', (0, 0, 0.168), 0.236, 0.064, 'edge', sides=12)
    for sign in (-1, 1):
        # Tapered plate leg: broad, splayed foot on the race, narrow at the head.
        foot = [(-0.060, sign * 0.130), (0.330, sign * 0.130),
                (0.330, sign * 0.350), (-0.060, sign * 0.350)]
        head = [(0.020, sign * 0.146), (0.330, sign * 0.146),
                (0.330, sign * 0.196), (0.020, sign * 0.196)]
        vertices = [(x, y, 0.185) for x, y in foot] + [(x, y, 0.664) for x, y in head]
        faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5),
                 (2, 3, 7, 6), (3, 0, 4, 7)]
        b.mesh('training leg', vertices, faces, 'naval')
        b.rod('leg stay', (0.300, sign * 0.150, 0.500), (0.050, sign * 0.300, 0.250),
              0.030, 'naval')
    b.box('carriage floor', (-0.150, 0, 0.680), (1.04, 0.88, 0.050), 'naval')
    for sign in (-1, 1):
        b.box('carriage side beam', (-0.150, sign * 0.355, 0.772), (1.04, 0.17, 0.145), 'naval')
        b.box('side beam capping', (-0.150, sign * 0.355, 0.850), (1.06, 0.19, 0.022), 'edge')
        b.box('traverse gearcase', (-0.150, sign * 0.510, 0.828), (0.30, 0.16, 0.20), 'edge')
        b.rod('traverse shaft', (-0.150, sign * 0.430, 0.828), (-0.150, sign * 0.620, 0.828),
              0.022, 'edge', sides=6)
        b.box('ready rack', (-0.530, sign * 0.500, 0.900), (0.28, 0.18, 0.20), 'edge')
        b.box('ready rack lid', (-0.530, sign * 0.500, 1.012), (0.30, 0.20, 0.028), 'naval')
        b.rod('ready rack bracket', (-0.530, sign * 0.412, 0.856),
              (-0.530, sign * 0.500, 0.830), 0.026, 'naval', sides=4)
        # Trunnion standard: an A-plate outboard of the cradle carrying the bearing.
        profile = [(-0.560, 0.845), (-0.190, 0.845), (-0.190, 1.130),
                   (-0.275, 1.295), (-0.415, 1.295), (-0.500, 1.120)]
        b.plate('trunnion standard', profile, sign * standard - 0.024,
                sign * standard + 0.024, 'naval')
        b.rod('standard brace', (-0.545, sign * standard, 0.880),
              (-0.345, sign * standard, 1.222), 0.028, 'naval')
        bearing = b.cyl('trunnion bearing', (-0.345, sign * (standard + 0.002), 1.222),
                        0.082, 0.056, 'edge', sides=10)
        bearing.rotation_euler.x = math.pi / 2
        b.box('elevation pinion housing', (-0.345, sign * standard, 0.798),
              (0.17, 0.11, 0.105), 'edge')
        # Aft frame: the layer's bracket the reference carries behind the carriage,
        # here an extension of the standard so it is clear of the elevating mass.
        b.plate('aft frame', [(-1.215, 0.915), (-0.480, 0.915), (-0.480, 0.760),
                              (-1.215, 0.635)], sign * standard - 0.020,
                sign * standard + 0.020, 'naval')
        b.plate('aft standard', [(-1.045, 0.915), (-0.905, 0.915), (-0.905, 1.405),
                                 (-1.010, 1.405)], sign * standard - 0.027,
                sign * standard + 0.027, 'naval')
        b.rod('aft frame strut', (-0.950, sign * standard, 0.640),
              (-0.860, sign * standard, 0.470), 0.028, 'naval')
        b.box('aft frame shoe', (-0.880, sign * standard, 0.455), (0.20, 0.09, 0.05), 'edge')
        b.rod('aft frame diagonal', (-0.950, sign * standard, 1.380),
              (-0.760, sign * standard, 0.880), 0.028, 'naval', sides=6)
        b.rod('aft frame diagonal', (-1.150, sign * standard, 0.900),
              (-0.930, sign * standard, 0.660), 0.024, 'naval', sides=6)
    # Training handwheel, on the starboard gearcase as the reference carries it.
    b.handwheel('traverse handwheel', (-0.150, -0.648, 0.828), 0.108, axis='y')
    b.box('aft cross beam', (-0.955, 0, 1.380), (0.16, 2 * standard, 0.06), 'edge')
    b.box('aft head plate', (-0.815, 0, 0.845), (0.27, 0.42, 0.05), 'roof')


# ---------------------------------------------------------------------------
def _shield(b, shape):
    """Slotted gun shield with its stiffeners, forward shelf and foot plates."""
    half = shape['half']
    for y0, y1, low, high in shape['bands']:
        profile = shield_profile(low, high)
        b.plate('shield plate', profile, y0, y1, 'naval')
        b.plate('shield plate', profile, -y1, -y0, 'naval')
    # Rolled edge on the outboard flanks and along the bottom.
    for sign in (-1, 1):
        (bx, bz), _ = shield_point(0.520 if shape['corner'] else 0.380)
        (tx, tz), _ = shield_point(1.960)
        b.rod('shield edge roll', (bx + 0.006, sign * half, bz),
              (tx + 0.006, sign * half, tz), 0.020, 'naval', sides=6)
    (fx, fz), _ = shield_point(0.372)
    b.rod('shield bottom roll', (fx + 0.006, -half + 0.03, fz),
          (fx + 0.006, half - 0.03, fz), 0.019, 'naval', sides=6)
    # Central slot liners: doubler flanges the reference sets against the opening.
    lip = 0.333 if shape['half'] > 0.88 else 0.075
    for sign in (-1, 1):
        b.plate('slot liner', [(0.483, 0.970), (0.298, 1.652), (0.170, 1.652),
                               (0.365, 0.940)], sign * lip - 0.020, sign * lip, 'edge')
    # Outer face stiffener: the swept pair of ribs on the front of the plate.
    for sign in (-1, 1):
        (ax, az), _ = shield_point(0.820)
        (cx, cz), _ = shield_point(0.985)
        b.mesh('face stiffener', [
            (ax + 0.012, sign * 0.030, az - 0.030), (cx + 0.012, sign * 0.046, cz),
            (cx + 0.012, sign * 0.262, cz - 0.075), (ax + 0.030, sign * 0.262, az - 0.105),
            (ax + 0.030, sign * 0.030, az - 0.060),
        ], [(0, 1, 2, 3), (0, 3, 4)], 'naval')
        b.rod('stiffener foot', (ax + 0.020, sign * 0.140, az - 0.080),
              (ax - 0.040, sign * 0.140, az - 0.170), 0.022, 'naval', sides=6)
    # Forward shelf outside the shield and its two knees.
    (sx, sz), _ = shield_point(0.808)
    shelf = b.mesh('forward shelf', [
        (sx + 0.010, 0.330, sz - 0.020), (0.876, 0.330, sz + 0.055),
        (0.876, -0.330, sz + 0.055), (sx + 0.010, -0.330, sz - 0.020),
    ], [(0, 1, 2, 3)], 'roof')
    shelf.modifiers.new('Shelf thickness', 'SOLIDIFY').thickness = 0.022
    # Swept deflector bars carried clear of the shield face, the reference's most
    # recognisable outboard fitting on this carriage.
    for sign in (-1, 1):
        bar = b.mesh('deflector bar', [
            (0.602, sign * 0.030, 0.908), (0.702, sign * 0.030, 0.878),
            (0.812, sign * 0.560, 0.762), (0.702, sign * 0.560, 0.748),
        ], [(0, 1, 2, 3)], 'naval')
        bar.modifiers.new('Bar thickness', 'SOLIDIFY').thickness = 0.030
        for lateral in (0.170, 0.430):
            share = (lateral - 0.030) / 0.530
            root = (0.650 + 0.055 * share, sign * lateral, 0.890 - 0.135 * share)
            (ax, az), _ = shield_point(root[2] + 0.055)
            b.rod('deflector stay', root, (ax + 0.012, sign * lateral, az),
                  0.016, 'naval', sides=4)
        b.rod('shelf knee', (sx + 0.010, sign * 0.300, sz - 0.090),
              (0.840, sign * 0.300, sz + 0.050), 0.024, 'naval', sides=6)
        # Foot plate for the seated layer, hung on the inner face of the shield.
        (px, pz), _ = shield_point(0.392)
        foot = b.mesh('shield foot plate', [
            (px - 0.016, sign * 0.400, pz - 0.010), (px - 0.016, sign * 0.860, pz - 0.010),
            (px - 0.230, sign * 0.860, pz + 0.048), (px - 0.230, sign * 0.400, pz + 0.048),
        ], [(0, 1, 2, 3)], 'edge')
        foot.modifiers.new('Foot plate thickness', 'SOLIDIFY').thickness = 0.020
        b.rod('foot plate bearer', (px - 0.030, sign * 0.630, pz + 0.010),
              (px - 0.225, sign * 0.630, pz + 0.048), 0.018, 'edge', sides=6)
    # Shield support arms reaching back to the rotating head.
    for sign in (-1, 1):
        (hx, hz), _ = shield_point(0.700)
        b.rod('shield support arm', (hx - 0.020, sign * 0.340, hz),
              (0.070, sign * 0.330, 0.845), 0.030, 'naval', sides=6)
        (kx, kz), _ = shield_point(0.470)
        b.rod('shield lower stay', (kx - 0.020, sign * 0.560, kz),
              (0.150, sign * 0.330, 0.790), 0.026, 'naval', sides=6)


# ---------------------------------------------------------------------------
def _stations(b, shape):
    """Layers' stations: gear standards and handwheels in the shield slots, seats."""
    for sign in (-1, 1):
        lateral = sign * 0.6175
        # Gear housing behind the shield, below the slot, carrying the standard.
        b.plate('gear housing', [(0.380, 0.760), (0.380, 1.050), (0.060, 1.072),
                                 (0.060, 0.760)], lateral - 0.098, lateral + 0.098, 'naval')
        b.box('gear housing cap', (0.220, lateral, 1.086), (0.32, 0.21, 0.035), 'edge')
        b.rod('gear housing tie', (0.090, lateral, 0.860), (0.090, sign * 0.360, 0.848),
              0.024, 'naval', sides=6)
        # Standard rising through the slot with the aiming handwheel on its head.
        b.plate('aiming standard', [(0.235, 1.060), (0.125, 1.560), (0.038, 1.900),
                                    (-0.020, 1.900), (0.062, 1.548), (0.165, 1.060)],
                lateral - 0.040, lateral + 0.040, 'naval')
        b.box('aiming gearbox', (0.130, lateral, 1.480), (0.22, 0.14, 0.24), 'edge')
        b.cyl('gear shaft collar', (0.062, lateral, 1.822), 0.055, 0.060, 'edge', sides=10)
        b.handwheel('aiming handwheel', (0.088, lateral, 1.944), 0.070)
        b.rod('handwheel shaft', (0.020, lateral, 1.944), (0.098, lateral, 1.944),
              0.020, 'edge', sides=6)
        # Seat on an outboard bracket, with a back rest and a stalk to the housing.
        seat = (-0.120, lateral, 0.650)
        b.cyl('layer seat', seat, 0.155, 0.045, 'roof', sides=8)
        b.rod('seat stalk', (-0.120, lateral, 0.470), (-0.120, lateral, 0.640),
              0.036, 'edge', sides=6)
        b.rod('seat bracket', (-0.120, lateral, 0.480), (0.060, sign * 0.330, 0.760),
              0.028, 'naval', sides=6)
        b.rod('seat back post', (-0.250, lateral, 0.660), (-0.262, lateral, 0.880),
              0.022, 'edge', sides=6)
        b.box('seat back', (-0.262, lateral, 0.880), (0.045, 0.26, 0.18), 'roof')


# ---------------------------------------------------------------------------
def _elevating(b, shape, reach):
    """Cradle, feed and barrels. Written in each barrel's trunnion frame."""
    spec = b.spec
    layout = barrel_layout(spec)
    cheek = shape['cheek']
    share_side, share_y, _ = layout[0]
    pitches = {}
    for side, lateral, _ in layout:
        pitch, recoil = b.gun_joints(side, lateral)
        pitches[side] = pitch
        # Recoiling group: receiver, breech, tube and flash hider.
        b.box(side + ' receiver', (0.055, 0, -0.005), (0.70, 0.168, 0.215), 'edge', recoil)
        b.box(side + ' receiver top rib', (0.090, 0, 0.112), (0.50, 0.120, 0.030),
              'edge', recoil)
        b.box(side + ' breech ring', (-0.290, 0, -0.010), (0.16, 0.196, 0.250),
              'naval', recoil)
        b.rod(side + ' breech cap', (-0.395, 0, -0.010), (-0.360, 0, -0.010), 0.098,
              'edge', recoil, sides=10)
        b.rod(side + ' charging handle', (-0.150, 0.086, 0.040), (-0.150, 0.186, 0.040),
              0.018, 'edge', recoil, sides=6)
        b.rod(side + ' spring housing', (0.100, 0, -0.128), (0.520, 0, -0.128), 0.046,
              'edge', recoil, sides=8)
        b.barrel(side + ' tube', reach, recoil, spec['caliberM'] / 2)
        # Elevating fittings that ride with this barrel: jacket, feed and case chute.
        b.rod(side + ' barrel jacket', (0.400, 0, 0), (0.950, 0, 0), 0.055, 'naval',
              pitch, sides=10)
        b.rod(side + ' jacket collar', (0.872, 0, 0), (0.918, 0, 0), 0.063, 'edge',
              pitch, sides=10)
        b.box(side + ' clip guide', (0.095, 0, 0.225), (0.240, 0.150, 0.250), 'naval', pitch)
        b.box(side + ' clip guide mouth', (0.095, 0, 0.358), (0.280, 0.186, 0.040),
              'edge', pitch)
        for step in range(4):
            offset = -0.060 + step * 0.040
            b.rod(side + ' loaded round', (offset, 0, 0.145), (offset, 0, 0.395), 0.017,
                  'bronze', pitch, sides=6)
        b.plate(side + ' feed ramp', [(-0.075, 0.115), (0.175, 0.115), (0.175, 0.150),
                                      (-0.115, 0.150)], -0.082, 0.082, 'edge', pitch)
        b.plate(side + ' case chute', [(-0.215, -0.110), (-0.060, -0.110), (-0.060, -0.212),
                                       (-0.232, -0.240)], -0.076, 0.076, 'dark', pitch)

    # Shared cradle, written in the first barrel's frame.
    pitch = pitches[share_side]
    def y(value):
        return value - share_y

    body = [(-0.300, -0.070), (-0.255, -0.205), (0.290, -0.215), (0.435, -0.115),
            (0.435, 0.055), (0.120, 0.098), (-0.300, 0.070)]
    for sign in (-1, 1):
        b.plate('cradle cheek', body, y(sign * cheek) - 0.020, y(sign * cheek), 'naval', pitch)
        boss = b.cyl('trunnion boss', (0, y(sign * (cheek - 0.045)), 0), 0.085, 0.060,
                     'edge', pitch, sides=10)
        boss.rotation_euler.x = math.pi / 2
        b.rod('cradle trunnion pin', (0, y(sign * (cheek - 0.020)), 0),
              (0, y(sign * (cheek + 0.036)), 0), 0.040, 'edge', pitch, sides=10)
    b.plate('cradle floor', [(-0.285, -0.178), (0.420, -0.192), (0.420, -0.150),
                             (-0.285, -0.136)], y(-cheek), y(cheek), 'naval', pitch)
    b.plate('cradle deck', [(-0.180, 0.070), (0.400, 0.030), (0.400, 0.062),
                            (-0.180, 0.102)], y(-cheek + 0.02), y(cheek - 0.02),
            'naval', pitch)
    b.box('cradle front bearing', (0.405, 0, -0.026), (0.075, 2 * cheek, 0.23), 'naval', pitch)
    # Toothed elevating arc under the breech end.
    arc = [(-0.055 - 0.248 * math.cos(math.radians(-35 + i * 10)),
            -0.248 * math.sin(math.radians(-35 + i * 10))) for i in range(8)]
    arc_out = [(-0.055 - 0.285 * math.cos(math.radians(-35 + i * 10)),
                -0.285 * math.sin(math.radians(-35 + i * 10))) for i in range(8)][::-1]
    b.plate('elevating arc', arc + arc_out, y(cheek + 0.010), y(cheek + 0.042),
            'edge', pitch)
    # Balance spring between the cradle and the trunnion standard side.
    for sign in (-1, 1):
        b.rod('balance spring', (-0.215, y(sign * (cheek - 0.058)), -0.128),
              (0.300, y(sign * (cheek - 0.058)), -0.150), 0.045, 'edge', pitch, sides=8)
    # Ring sight on a bracket above the cradle, clear of both feeds.
    sight = (0.235, y(share_y * 0 + (0.240 if len(layout) > 1 else 0.215)), 0.352)
    b.rod('sight arm', (0.010, sight[1] - 0.010, 0.095), (sight[0] - 0.020, sight[1], 0.320),
          0.022, 'edge', pitch, sides=6)
    b.rod('sight arm knee', (sight[0] - 0.020, sight[1], 0.320), sight, 0.018, 'edge',
          pitch, sides=6)
    b.torus('ring sight', sight, 0.082, 0.008, 'edge', pitch, 10, 'x')
    b.rod('sight cross wire', (sight[0], sight[1] - 0.082, sight[2]),
          (sight[0], sight[1] + 0.082, sight[2]), 0.004, 'edge', pitch, sides=4)
    b.rod('sight cross wire', (sight[0], sight[1], sight[2] - 0.082),
          (sight[0], sight[1], sight[2] + 0.082), 0.004, 'edge', pitch, sides=4)
    b.rod('fore sight post', (0.930, sight[1] * 0.35, 0.086), (0.930, sight[1] * 0.35, 0.150),
          0.012, 'edge', pitch, sides=4)
