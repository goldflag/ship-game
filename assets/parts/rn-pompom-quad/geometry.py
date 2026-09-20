"""Original Royal Navy quadruple 2-pounder Mk VII pom-pom (40 mm QF Mk VIII).

One power mounting drawn from measurements taken off the approved GameModels3D
reference visuals (bga002 open, bga072/uga2002 splinter shielded, bga088
corrugated plating, bga152 shielded with outrigger steps). No reference mesh,
texture or transform is loaded or copied: every vertex here is authored from the
station table below. Four catalog variants share one body and differ only in the
shield set, selected on ``mount['weapon']['id']``.

Authoring frame: +X muzzle, +Y port, +Z up, metres, yaw datum on the sole plane.
The four guns stand in two columns of two. The simulation fires from a single
uniform row, so the joints sit on that row and only the tubes, cradles and feed
boxes are carried out to their true stations: lateral offsets ride the trunnion
axis, the row offset rides rigidly in the elevation frame.
"""
import bpy
import math
from mathutils import Matrix

TRUNNION_FORWARD = -.04   # trunnion axis, forward of the yaw datum
PIVOT_HEIGHT = 1.31       # trunnion axis above the sole plane
GUN_LATERAL = .225        # true half-spacing between the two gun columns
GUN_ROW = .2588           # true half-spacing between the lower and upper rows
BORE_LENGTH = 1.695       # tube tip along the bore from the trunnion
DISC_RADIUS = .645        # elevating cheek plate, concentric with the trunnion
DISC_Y = .4275            # cheek plate centre plane
STANDARD_Y = .488         # fixed trunnion standard, just outboard of the cheek
DECK_AFT = .66            # upper (layers') deck of the training platform
DECK_FWD = .48            # lower deck under the guns
SOLE_R = .80

# Platform plan, port half, bow first; the starboard half is mirrored.
DECK_EDGE = [(1.03, 1.36), (.95, 1.44), (-1.13, 1.44), (-1.34, 1.31),
             (-1.51, 1.11), (-1.72, .77), (-1.81, .39)]
RAIL_RUN = [(-1.78, .43), (-1.45, .93), (-1.11, 1.42)]

# Splinter shields of bga072/bga152: a bent plate at each end of the wing.
SHIELD_FORWARD = [(1.31, .45), (1.31, 1.16), (.93, 1.46), (.62, 1.45)]
SHIELD_AFT = [(-1.71, .37), (-1.58, 1.00), (-1.13, 1.45), (-.64, 1.45)]
# Corrugated plating of bga088: short screens, forward pair and aft pair.
PLATE_FORWARD = [(1.04, .46), (1.04, 1.23)]
PLATE_AFT = [(-1.79, .44), (-1.66, .97), (-1.55, 1.02), (-1.14, 1.44)]

VARIANTS = {
    'qf-2pdr-mkvii-quad': (),
    'qf-2pdr-mkvii-quad-shielded': ('splinter',),
    'qf-2pdr-mkvii-quad-plated': ('corrugated',),
    'qf-2pdr-mkvii-quad-screened': ('splinter', 'outrigger'),
}


class Mounting:
    """Joint tree plus the three authoring frames used below.

    ``yaw`` coordinates are the training frame. ``elevating`` and ``recoiling``
    coordinates are (along the bore, lateral from the mount centreline, above
    the trunnion axis); the lateral component is corrected for the uniform row
    station of the joint that carries the object.
    """

    def __init__(self, mount, col, helpers, materials):
        self.mount, self.col, self.h = mount, col, helpers
        self.spec = mount['weapon']
        self.name = mount['id']
        palette = dict(materials)
        palette.setdefault('roof', palette['naval'])
        palette.setdefault('painted-edge', palette['edge'])
        self.pal = palette
        self.yaw = self.joint('yaw')
        self.elevation, self.recoil = [], []
        count = self.spec.get('barrelCount', 4)
        spacing = self.spec['barrelSpacing']
        ids = ['left-outer', 'left', 'right', 'right-outer'][:count]
        self.station = []
        for index, side in enumerate(ids):
            lateral = ((count - 1) / 2 - index) * spacing
            pitch = self.joint(side + '.elevation', self.yaw,
                               (self.spec['trunnionForward'], lateral, self.spec['pivotHeight']))
            pitch.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
            slide = self.joint(side + '.recoil', pitch)
            self.joint(side + '.muzzle', slide,
                       (self.spec['muzzleForward'] - self.spec['trunnionForward'], 0, 0))
            self.elevation.append(pitch)
            self.recoil.append(slide)
            self.station.append(lateral)
        # The gun block rides one rigid body: every fitting that elevates hangs
        # on the outermost joint and is offset back to the mount centreline.
        self.block = self.elevation[0]
        self.block_y = self.station[0]
        # Fixed fittings that touch the trunnion follow the published spec
        # rather than the design constants above.
        self.tf = self.spec['trunnionForward']
        self.ph = self.spec['pivotHeight']

    # --- joints and parenting -------------------------------------------
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

    def mat(self, key):
        return self.pal.get(key, self.pal['naval'])

    # --- primitives, yaw frame ------------------------------------------
    def box(self, label, loc, dim, key='naval', parent=None):
        return self.put(self.h['box'](self.name + '.' + label, loc, dim, self.mat(key), self.col), parent)

    def cyl(self, label, loc, radius, depth, key='naval', parent=None, r2=None, vertices=20):
        return self.put(self.h['cyl'](self.name + '.' + label, loc, radius, depth,
                                      self.mat(key), self.col, vertices, r2), parent)

    def rod(self, label, a, b, radius, key='naval', parent=None, r2=None, vertices=8):
        return self.put(self.h['rod'](self.name + '.' + label, a, b, radius,
                                      self.mat(key), self.col, r2, vertices), parent)

    def mesh(self, label, verts, faces, key='naval', parent=None):
        return self.put(self.h['mesh'](self.name + '.' + label, verts, faces,
                                       self.mat(key), self.col), parent)

    def sweep(self, label, profile, a, b, axis='y', key='naval', parent=None):
        """Closed solid swept along one axis from a flat profile.

        ``axis='y'`` sweeps an (x, z) profile across Y, ``axis='z'`` sweeps an
        (x, y) plan across Z. The profile winding is normalised so every face
        ends up pointing out of the solid.
        """
        a, b = min(a, b), max(a, b)
        # The trapezoid sum is positive for a clockwise profile, which is the
        # winding that leaves the swept faces pointing outwards across Y; the
        # plan sweep across Z wants the opposite hand.
        area = sum((q[0] - p[0]) * (q[1] + p[1]) for p, q in zip(profile, profile[1:] + profile[:1]))
        hand = 1 if axis == 'y' else -1
        ring = list(profile) if area * hand > 0 else list(reversed(profile))
        k = len(ring)
        if axis == 'y':
            verts = [(x, s, z) for s in (a, b) for x, z in ring]
        else:
            verts = [(x, y, s) for s in (a, b) for x, y in ring]
        faces = [tuple(reversed(range(k))), tuple(range(k, 2 * k))]
        faces += [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)]
        return self.mesh(label, verts, faces, key, parent)

    def prism(self, label, profile, y0, y1, key='naval', parent=None):
        return self.sweep(label, profile, y0, y1, 'y', key, parent)

    def plan(self, label, outline, z0, z1, key='naval', parent=None):
        return self.sweep(label, outline, z0, z1, 'z', key, parent)

    def wall(self, label, run, z0, z1, thickness, key='naval', parent=None, mirror=True):
        """Bent upright plate following a plan polyline (port side, mirrored)."""
        for sign in ((1, -1) if mirror else (1,)):
            points = [(x, sign * y) for x, y in run]
            inner, outer = [], []
            for index, (x, y) in enumerate(points):
                ax, ay = points[max(index - 1, 0)]
                bx, by = points[min(index + 1, len(points) - 1)]
                dx, dy = bx - ax, by - ay
                length = math.hypot(dx, dy) or 1
                nx, ny = -dy / length * thickness / 2, dx / length * thickness / 2
                inner.append((x - nx, y - ny))
                outer.append((x + nx, y + ny))
            self.plan(label, inner + list(reversed(outer)), z0, z1, key, parent)

    def disc(self, label, loc, radius, thickness, sides=20, key='naval', parent=None):
        """Upright wheel in the X-Z plane, swept across Y."""
        x, y, z = loc
        profile = [(x + radius * math.cos(math.tau * i / sides),
                    z + radius * math.sin(math.tau * i / sides)) for i in range(sides)]
        return self.prism(label, profile, y - thickness / 2, y + thickness / 2, key, parent)

    def ring(self, label, centre, radius, key='edge', parent=None, wire=.008, sides=10):
        x, y, z = centre
        points = [(x, y + radius * math.cos(math.tau * i / sides),
                   z + radius * math.sin(math.tau * i / sides)) for i in range(sides)]
        for a, b in zip(points, points[1:] + points[:1]):
            self.rod(label, a, b, wire, key, parent, vertices=4)
        return points

    def handwheel(self, label, centre, radius, key='edge', parent=None):
        x, y, z = centre
        rim = self.cyl(label + ' rim', centre, radius, .025, key, parent, vertices=12)
        rim.rotation_euler.x = math.pi / 2
        self.cyl(label + ' hub', centre, .035, .07, key, parent, vertices=8).rotation_euler.x = math.pi / 2
        for i in range(3):
            a = math.tau * i / 3
            self.rod(label + ' spoke', centre,
                     (x + radius * math.cos(a), y, z + radius * math.sin(a)), .012, key, parent, vertices=4)
        self.rod(label + ' crank', (x + radius, y, z), (x + radius, y + .08, z), .015, key, parent, vertices=4)
        return rim

    # --- elevating and recoiling frames ---------------------------------
    def local(self, u, v, w):
        return (u, v - self.block_y, w)

    def ebox(self, label, loc, dim, key='naval'):
        return self.box(label, self.local(*loc), dim, key, self.block)

    def erod(self, label, a, b, radius, key='naval', vertices=8, r2=None):
        return self.rod(label, self.local(*a), self.local(*b), radius, key, self.block, r2, vertices)

    def finish(self):
        x, y, z = self.mount['position']
        self.yaw.location = (-z, -x, y)
        self.yaw.rotation_euler.z = -math.radians(self.mount['bearingDeg'])
        return self.yaw


def create_mount(mount, col, helpers, materials):
    m = Mounting(mount, col, helpers, materials)
    shields = VARIANTS.get(mount['weapon']['id'], ())
    training_base(m)
    gun_block(m)
    layers_stations(m)
    if 'splinter' in shields:
        splinter_shields(m)
    if 'corrugated' in shields:
        corrugated_plating(m)
    if 'outrigger' in shields:
        outrigger_steps(m)
    return m.finish()


def training_base(m):
    """Roller path, the two-level rotating platform and the trunnion standards."""
    m.cyl('sole plate', (0, 0, .035), SOLE_R, .07, 'edge', vertices=16)
    m.cyl('training pedestal', (0, 0, .14), .78, .14, 'naval', vertices=16)
    m.cyl('roller path', (0, 0, .275), .66, .13, 'painted-edge', vertices=16)

    port = DECK_EDGE
    # Upper deck: the layers' floor, aft of the guns and level with the foot of
    # the elevating cheeks.
    outline = [(-.46, 1.44)] + [(x, y) for x, y in port if x <= -.46]
    m.plan('upper deck', outline + [(x, -y) for x, y in reversed(outline)],
           DECK_AFT - .22, DECK_AFT, 'roof')
    # Lower deck: the working floor under the guns, kept clear of the barrels
    # at depression.
    front = [(x, y) for x, y in port if x >= -.50] + [(-.50, 1.44)]
    m.plan('lower deck', front + [(x, -y) for x, y in reversed(front)],
           DECK_FWD - .14, DECK_FWD, 'roof')
    m.box('bow step', (1.01, 0, .345), (.56, 2.32, .15), 'roof')
    for sign in (1, -1):
        m.box('deck stringer', (-.02, sign * 1.30, DECK_FWD - .21), (2.0, .10, .16), 'naval')

    for sign in (1, -1):
        # Trunnion standard: a tapered web outboard of the elevating cheek,
        # carrying the trunnion bearing at its head.
        m.prism('trunnion standard',
                [(-.66, DECK_FWD - .02), (.70, DECK_FWD - .02), (.46, 1.12),
                 (.26, m.ph + .10), (-.26, m.ph + .10), (-.46, 1.12)],
                sign * (STANDARD_Y - .032), sign * (STANDARD_Y + .032), 'naval')
        bearing = m.cyl('trunnion bearing', (m.tf, sign * STANDARD_Y, m.ph),
                        .13, .11, 'painted-edge', vertices=12)
        bearing.rotation_euler.x = math.pi / 2
        cap = m.cyl('bearing cap', (m.tf, sign * (STANDARD_Y + .055), m.ph),
                    .075, .04, 'edge', vertices=8)
        cap.rotation_euler.x = math.pi / 2
        m.rod('standard brace', (-.58, sign * (STANDARD_Y - .03), DECK_FWD),
              (-.16, sign * (STANDARD_Y - .03), m.ph - .12), .03, 'naval')
        # Gear case over the elevating rack, at the radius the rack sweeps.
        m.box('elevating gear case', (-.26, sign * .58, .74), (.30, .13, .26), 'painted-edge')
        m.box('elevating gear cover', (-.26, sign * .52, .74), (.22, .05, .20), 'edge')
        # Low forward frame: the shell-case tray webs that carry the front of
        # the mounting. Their crown stays under the barrels at depression.
        m.prism('forward frame web',
                [(.34, DECK_FWD - .02), (.46, .74), (.76, .76), (1.38, .58), (1.42, .42)],
                sign * .40, sign * .44, 'naval')
        m.prism('forward frame web',
                [(.92, DECK_FWD - .02), (.96, .72), (1.34, .58), (1.40, .44)],
                sign * .05, sign * .09, 'naval')
    m.box('forward frame tie', (1.30, 0, .50), (.10, .86, .10), 'naval')
    m.box('case tray', (.80, 0, DECK_FWD + .02), (.90, .74, .05), 'edge')

    for sign in (1, -1):
        # Ready-use lockers: two inclined belt boxes on each wing, braced off
        # the lower deck, their lids facing the loading numbers.
        for base, lift in ((.26, .00), (-.27, .23)):
            face = [(base + .03, 1.225 + lift), (base + .20, .882 + lift),
                    (base + .46, 1.03 + lift), (base + .26, 1.376 + lift)]
            m.prism('ready-use locker', face, sign * .50, sign * 1.34, 'naval')
            lid = [(face[3][0], face[3][1]), (face[0][0], face[0][1]),
                   (face[0][0] - .06, face[0][1] - .04), (face[3][0] - .06, face[3][1] - .04)]
            m.prism('locker lid', lid, sign * .52, sign * 1.32, 'painted-edge')
            m.rod('locker handle', (base - .02, sign * .78, 1.30 + lift),
                  (base - .02, sign * 1.06, 1.30 + lift), .018, 'edge', vertices=6)
            for lateral in (.58, 1.24):
                m.rod('locker bracket', (base + .13, sign * lateral, .90 + lift),
                      (base + .13, sign * lateral, DECK_FWD), .028, 'naval')

    for sign in (1, -1):
        # Aft handrail along the chamfered edge of the layers' deck.
        run = [(x, sign * y) for x, y in RAIL_RUN]
        for height in (1.045, 1.485):
            for a, b in zip(run, run[1:]):
                m.rod('handrail', (a[0], a[1], height), (b[0], b[1], height), .022, 'painted-edge', vertices=6)
        for x, y in run:
            m.rod('rail stanchion', (x, y, DECK_AFT - .04), (x, y, 1.55), .026, 'painted-edge', vertices=6)
        m.box('corner post', (-1.585, sign * .455, 1.16), (.13, .13, 1.02), 'naval')
        m.box('corner post cap', (-1.585, sign * .455, 1.70), (.16, .16, .07), 'painted-edge')
        m.box('ready locker', (-1.60, sign * .77, .90), (.14, .33, .48), 'painted-edge')


def gun_block(m):
    """The elevating mass: cheeks, frame, four guns and their feed."""
    for sign in (1, -1):
        # Circular cheek plate, concentric with the trunnion so it sweeps the
        # full elevation range inside the fixed standards.
        m.disc('elevating cheek', m.local(0, sign * DISC_Y, 0), DISC_RADIUS, .045, 20, 'naval', m.block)
        # Stiffening boss and ribs on the outer face; the boss stays inside the
        # cheek rim so nothing new enters the swept circle.
        m.disc('cheek boss', m.local(0, sign * (DISC_Y + .035), 0), .46, .03, 16, 'painted-edge', m.block)
        for angle in (35, 145, 215, 325):
            a = math.radians(angle)
            m.erod('cheek rib', (.20 * math.cos(a), sign * (DISC_Y + .03), .20 * math.sin(a)),
                   (.60 * math.cos(a), sign * (DISC_Y + .03), .60 * math.sin(a)), .022, 'painted-edge')
        m.ebox('trunnion hub', (0, sign * (DISC_Y - .06), 0), (.26, .10, .26), 'painted-edge')
        # Elevating rack: an arc concentric with the trunnion, so it stays in
        # the gear case on the standard at every elevation.
        teeth = 14
        arc = [((.575 if i % 2 else .548) * math.cos(math.radians(a)),
                (.575 if i % 2 else .548) * math.sin(math.radians(a)))
               for i, a in enumerate([200 + 110 * i / teeth for i in range(teeth + 1)])]
        arc += [(.505 * math.cos(math.radians(a)), .505 * math.sin(math.radians(a)))
                for a in [310 - 110 * i / teeth for i in range(teeth + 1)]]
        m.sweep('elevating rack', arc, sign * (DISC_Y + .023) - m.block_y,
                sign * (DISC_Y + .056) - m.block_y, 'y', 'edge', m.block)
    m.erod('trunnion shaft', (0, -.55, 0), (0, .55, 0), .075, 'edge', vertices=12)

    m.ebox('frame lower beam', (.02, 0, -.44), (.82, .80, .10))
    m.ebox('frame upper beam', (.02, 0, .46), (.82, .80, .09))
    # The back of the frame is left open so the four breech ends, their feed
    # and the case chutes stay visible from the layers' stations.
    m.ebox('frame rear post', (-.42, 0, .01), (.10, .13, .82))
    for sign in (1, -1):
        m.ebox('frame rear post', (-.42, sign * .355, .01), (.10, .09, .82))
    m.ebox('frame centre beam', (.44, 0, 0), (.11, .80, .15))
    # Front face of the frame, split into four webs so each gun keeps its own
    # aperture without a cut plate.
    for sign in (1, -1):
        m.ebox('frame side post', (.40, sign * .37, .02), (.14, .07, .84))
        m.ebox('frame face web', (.46, sign * .105, 0), (.07, .13, .86), 'painted-edge')
        for row in (1, -1):
            m.ebox('frame face lintel', (.46, sign * .225, row * (GUN_ROW + .13)),
                   (.07, .20, .09), 'painted-edge')
        m.ebox('feed platform', (-.20, sign * .33, -.20), (.50, .13, .06), 'painted-edge')
        # Belt hoppers stand between the gun column and the cheek plate.
        for row in (1, -1):
            m.ebox('belt hopper', (-.06, sign * .335, row * GUN_ROW + .12),
                   (.38, .12, .30), 'painted-edge')
            m.erod('hopper chute', (.16, sign * .335, row * GUN_ROW + .01),
                   (.30, sign * .27, row * GUN_ROW + .02), .035, 'edge')

    spec = m.spec
    bore = spec['caliberM'] / 2
    for index, (pitch, slide) in enumerate(zip(m.elevation, m.recoil)):
        lateral = GUN_LATERAL if index < 2 else -GUN_LATERAL
        row = GUN_ROW if index in (0, 3) else -GUN_ROW
        offset = lateral - m.station[index]
        label = ['left-outer', 'left', 'right', 'right-outer'][index]
        outboard = 1 if lateral > 0 else -1

        def put_box(name, loc, dim, key='naval', parent=pitch):
            return m.box(label + ' ' + name, (loc[0], loc[1] + offset, loc[2]), dim, key, parent)

        def put_rod(name, a, b, radius, key='naval', parent=pitch, vertices=8, r2=None):
            return m.rod(label + ' ' + name, (a[0], a[1] + offset, a[2]),
                         (b[0], b[1] + offset, b[2]), radius, key, parent, r2, vertices)

        # Cradle and recoil gear ride the elevation joint; the gun body slides.
        put_box('cradle', (.06, 0, row - .115), (.78, .17, .12), 'naval')
        put_rod('recoil cylinder', (-.14, 0, row - .175), (.50, 0, row - .175), .045, 'painted-edge')
        put_rod('recuperator', (-.10, .085, row - .12), (.48, .085, row - .12), .030, 'edge')
        put_box('cradle ring', (.44, 0, row), (.09, .20, .20), 'painted-edge')
        put_rod('elevating link', (-.30, 0, row - .17), (-.30, 0, row - .30), .022, 'edge')

        put_box('receiver', (-.02, 0, row), (.62, .17, .19), 'edge', slide)
        put_box('breech casing', (-.36, 0, row), (.12, .20, .22), 'painted-edge', slide)
        put_rod('recoil rod', (-.42, 0, row - .175), (-.16, 0, row - .175), .020, 'edge', slide)
        put_rod('charging handle', (-.20, .10, row + .04), (-.20, .20, row + .04), .017, 'edge', slide, 4)
        put_box('feed tray', (-.04, outboard * .12, row + .10), (.30, .10, .07), 'edge', slide)
        put_box('case chute', (-.04, -outboard * .12, row - .09), (.26, .09, .14), 'dark', slide)

        # Tube: water jacket, chase and flash cone, one connected surface.
        rings = [(.28, .072), (.86, .072), (.90, .058), (1.48, .048),
                 (1.53, .062), (BORE_LENGTH - .02, .070), (BORE_LENGTH, .070), (BORE_LENGTH, bore)]
        sides = 10
        verts = [(x, offset + r * math.cos(math.tau * i / sides), row + r * math.sin(math.tau * i / sides))
                 for x, r in rings for i in range(sides)]
        faces = [(j * sides + i, j * sides + (i + 1) % sides,
                  (j + 1) * sides + (i + 1) % sides, (j + 1) * sides + i)
                 for j in range(len(rings) - 1) for i in range(sides)]
        m.mesh(label + ' tube', verts, faces, 'edge', slide)
        put_rod('bore shadow', (BORE_LENGTH - .12, 0, row), (BORE_LENGTH - .10, 0, row), bore * .95, 'dark', slide, 8)
        for station in (.46, .70):
            put_rod('jacket band', (station, 0, row), (station + .035, 0, row), .081, 'painted-edge', slide, 10)


def layers_stations(m):
    """Gunlayer and trainer seats, footrests, ring sights and hand controls.

    The two stations stand on the training platform rather than on the gun
    block: the sights are driven off the trunnion cross-shaft, which keeps the
    seats clear of the deck through the full elevation range.
    """
    for sign in (1, -1):
        # Seat column, rooted on the upper deck outboard of the standard.
        m.rod('seat column', (-.95, sign * .70, DECK_AFT - .04), (-.95, sign * .70, 1.42), .055, 'naval')
        m.rod('seat stay', (-.62, sign * .56, DECK_AFT), (-.92, sign * .70, 1.26), .028, 'naval')
        m.box('seat pan', (-.95, sign * .695, 1.46), (.28, .31, .07), 'painted-edge')
        m.box('seat back', (-1.10, sign * .695, 1.63), (.06, .30, .30), 'painted-edge')
        m.rod('seat back post', (-1.09, sign * .58, 1.46), (-1.09, sign * .58, 1.68), .020, 'edge')
        m.rod('seat back post', (-1.09, sign * .81, 1.46), (-1.09, sign * .81, 1.68), .020, 'edge')
        m.box('footrest', (-.58, sign * .70, 1.02), (.26, .30, .04), 'edge')
        m.rod('footrest arm', (-.72, sign * .70, .96), (-.58, sign * .70, 1.00), .024, 'naval')

        # Sight standard: a tapered web off the seat column carrying the ring
        # sight at the seated layer's eye, with a link arm to the trunnion.
        m.prism('sight standard',
                [(-.99, 1.36), (-.74, 1.44), (-.62, 1.70), (-.62, 2.36), (-.84, 2.36), (-1.22, 2.02)],
                sign * .565, sign * .605, 'naval')
        m.rod('sight standard stay', (-1.14, sign * .66, 1.78), (-.80, sign * .60, 2.20), .022, 'naval')
        m.rod('sight arm', (-.72, sign * .59, 2.32), (-.62, sign * .59, 2.47), .026, 'edge')
        m.ring('ring sight', (-.665, sign * .59, 2.47), .135, 'edge', wire=.009, sides=10)
        m.rod('ring sight spider', (-.665, sign * .455, 2.47), (-.665, sign * .725, 2.47), .005, 'edge', vertices=4)
        m.rod('ring sight spider', (-.665, sign * .59, 2.335), (-.665, sign * .59, 2.605), .005, 'edge', vertices=4)
        m.rod('sight bar', (-.70, sign * .59, 2.29), (-.70, sign * .07, 2.29), .020, 'edge', vertices=6)
        m.rod('bead sight arm', (-.70, sign * .59, 2.29), (-.28, sign * .59, 2.24), .018, 'edge', vertices=6)
        m.box('bead sight', (-.26, sign * .59, 2.27), (.06, .05, .09), 'edge')
        # Sight linkage: the follow-up arm is carried on the trunnion cross
        # shaft, so it stays coupled at every elevation.
        m.rod('sight link', (-.86, sign * .555, 1.58), (m.tf - .06, sign * .545, m.ph + .06),
              .018, 'edge', vertices=6)
        m.cyl('link boss', (m.tf, sign * .545, m.ph), .055, .05, 'edge',
              vertices=8).rotation_euler.x = math.pi / 2

        # Hand controls: elevating wheel to starboard of the layer, training
        # wheel to port of the trainer, each on a shaft into the standard.
        m.handwheel('control wheel', (-.70, sign * .92, 1.22), .15, 'edge')
        m.rod('control shaft', (-.70, sign * .92, 1.22), (-.56, sign * .60, 1.10), .026, 'naval')
        m.box('control box', (-.52, sign * .56, 1.04), (.22, .18, .24), 'painted-edge')
        m.rod('control column', (-.52, sign * .56, .92), (-.52, sign * .56, DECK_AFT - .03), .05, 'naval')


def splinter_shields(m):
    """bga072 and bga152: bent splinter plates at both ends of each wing."""
    m.wall('forward splinter shield', SHIELD_FORWARD, .21, 1.42, .05, 'naval')
    m.wall('aft splinter shield', SHIELD_AFT, .53, 2.19, .05, 'naval')
    for sign in (1, -1):
        for x, y in ((1.28, .62), (1.28, 1.05)):
            m.rod('forward shield stay', (x, sign * y, 1.30), (x - .30, sign * y, 1.34), .022, 'naval')
        for x, y in ((-1.66, .55), (-1.20, 1.40)):
            m.rod('aft shield stay', (x, sign * y, 2.05), (x + .26, sign * (y - .10), 2.05), .022, 'naval')
        m.rod('shield foot', (1.29, sign * .50, .26), (1.29, sign * 1.14, .26), .028, 'naval', vertices=6)


def corrugated_plating(m):
    """bga088: short corrugated screens forward and aft of each wing."""
    for run, z0, z1, label in ((PLATE_FORWARD, .46, 1.46, 'forward armour plate'),
                               (PLATE_AFT, .66, 1.53, 'aft armour plate')):
        for sign in (1, -1):
            points = [(x, sign * y) for x, y in run]
            for a, b in zip(points, points[1:]):
                length = math.hypot(b[0] - a[0], b[1] - a[1])
                folds = max(3, int(length / .12))
                nx, ny = -(b[1] - a[1]) / length, (b[0] - a[0]) / length
                ridge, front, back = .05, [], []
                for i in range(folds + 1):
                    t = i / folds
                    px, py = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                    depth = ridge if i % 2 else 0
                    front.append((px + nx * depth, py + ny * depth))
                    back.append((px - nx * .022, py - ny * .022))
                m.plan(label, front + list(reversed(back)), z0, z1, 'naval')
                m.rod(label + ' rail', (a[0], a[1], z1), (b[0], b[1], z1), .03, 'painted-edge', vertices=6)
                m.rod(label + ' foot', (a[0], a[1], z0), (b[0], b[1], z0), .03, 'painted-edge', vertices=6)
                m.rod(label + ' stay', ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z0),
                      ((a[0] + b[0]) / 2 - .16, (a[1] + b[1]) / 2 * .82, z0 - .18), .022, 'naval')


def outrigger_steps(m):
    """bga152: outboard step platforms and the bow ladder."""
    for sign in (1, -1):
        m.box('outrigger platform', (-.12, sign * 1.58, .255), (.52, .48, .05), 'roof')
        for x in (-.32, .10):
            m.rod('outrigger leg', (x, sign * 1.72, .02), (x, sign * 1.72, .24), .030, 'naval', vertices=6)
            m.rod('outrigger tie', (x, sign * 1.72, .24), (x, sign * 1.40, DECK_FWD - .10), .024, 'naval', vertices=6)
        for lateral, height in ((1.20, .37), (1.42, .30)):
            m.box('outrigger tread', (-.12, sign * lateral, height), (.50, .18, .035), 'edge')
        # Bow ladder: two side frames with rungs up to the lower deck.
        m.prism('bow ladder frame', [(1.34, .03), (1.55, .16), (1.55, .75), (1.34, .81)],
                sign * .47, sign * .50, 'naval')
    for height in (.22, .48, .72):
        m.rod('bow ladder rung', (1.44, -.47, height), (1.44, .47, height), .022, 'edge', vertices=6)
