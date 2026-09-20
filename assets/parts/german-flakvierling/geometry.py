"""Original 2 cm Flakvierling 38 naval mountings (four 2 cm C/38 on one block).

Three mountings are drawn here, from the approved GameModels3D references
gga008 (pedestal mounting), gga042 (shielded mounting) and gga035 (C/35
mounting with the long trail). No reference mesh, texture or transform is
loaded: every surface below is authored from measured stations only, and the
catalog keeps the weapon data.

Authoring frame: +X muzzle, +Y port, +Z up, metres, yaw datum on the sole.

The four barrels stand in a 2x2 block: two columns at +/-LATERAL and two rows
at +/-ROW in the elevation frame, all four sharing one trunnion axis so the
block elevates rigidly. The simulation fires from one uniform row, so the
elevation/recoil/muzzle joints stay on that row (see aa_articulation) while the
tubes, receivers and magazines are offset to their true stations.
"""
import bpy
import math
from mathutils import Matrix
from blender_barrels import barrel_layout

LATERAL = .345   # true lateral station of each barrel column
ROW = .15        # true vertical offset of each barrel row, elevation frame
ARC = .583       # carriage cheek radius about the trunnion
TUBE = .028      # barrel tube radius


class Vierling:
    def __init__(self, mount, col, helpers, materials):
        self.mount, self.col, self.h = mount, col, helpers
        self.m = dict(materials)
        self.m.setdefault('roof', self.m['naval'])
        self.m.setdefault('painted-edge', self.m['edge'])
        self.name = mount['id']
        self.s = mount['weapon']
        self.yaw = self.joint('yaw')
        self.elevation, self.recoil, self.station = [], [], []

    # joints ---------------------------------------------------------------
    def joint(self, suffix, parent=None, loc=(0, 0, 0)):
        o = bpy.data.objects.new(self.name + '.' + suffix, None)
        self.col.objects.link(o)
        o.location = loc
        o.parent = parent
        o['nodeId'] = o.name
        o['assemblyId'] = self.name
        return o

    def guns(self):
        s = self.s
        for side, y, _ in barrel_layout(s):
            e = self.joint(side + '.elevation', self.yaw,
                           (s['trunnionForward'], y, s['pivotHeight']))
            e.rotation_euler.y = -math.radians(self.mount.get('initialElevationDeg', 1))
            r = self.joint(side + '.recoil', e)
            self.joint(side + '.muzzle', r, (s['muzzleForward'] - s['trunnionForward'], 0, 0))
            self.elevation.append(e)
            self.recoil.append(r)
            self.station.append(y)

    # placement ------------------------------------------------------------
    def put(self, o, parent=None):
        o.parent = parent or self.yaw
        o.matrix_parent_inverse = Matrix.Identity(4)
        o['assemblyId'] = self.name
        return o

    def ep(self, t, u, d):
        """Elevation-frame station -> local coordinates of the shared pitch joint.

        The joint already sits on the trunnion, so only the lateral offset from
        that barrel's uniform simulation station has to be taken out.
        """
        return (t, u - self.station[0], d)

    # Shorthands for geometry that rides the elevating mass: the whole block
    # hangs off one pitch joint, so every station is given in the elevation
    # frame (t along the bore, u lateral, d vertical from the trunnion axis).
    def ebox(self, n, t, u, d, dim, mat='naval'):
        return self.box(n, self.ep(t, u, d), dim, mat, self.elevation[0])

    def ecyl(self, n, t, u, d, r, depth, mat='naval', vertices=12):
        return self.cyl(n, self.ep(t, u, d), r, depth, mat, self.elevation[0], vertices=vertices)

    def erod(self, n, a, c, r, mat='naval', vertices=8, r2=None):
        return self.rod(n, self.ep(*a), self.ep(*c), r, mat, self.elevation[0], r2, vertices)

    def rp(self, i, t, u, d):
        """Elevation-frame station -> local coordinates of barrel i's recoil joint."""
        return (t, u - self.station[i], d)

    # primitives -----------------------------------------------------------
    def box(self, n, p, dim, mat='naval', parent=None):
        return self.put(self.h['box'](self.name + '.' + n, p, dim, self.m[mat], self.col), parent)

    def cyl(self, n, p, r, depth, mat='naval', parent=None, r2=None, vertices=12):
        return self.put(self.h['cyl'](self.name + '.' + n, p, r, depth, self.m[mat],
                                      self.col, vertices, r2), parent)

    def rod(self, n, a, b, r, mat='naval', parent=None, r2=None, vertices=8):
        return self.put(self.h['rod'](self.name + '.' + n, a, b, r, self.m[mat],
                                      self.col, r2, vertices), parent)

    def mesh(self, n, verts, faces, mat='naval', parent=None):
        return self.put(self.h['mesh'](self.name + '.' + n, verts, faces, self.m[mat],
                                       self.col), parent)

    def plate(self, n, profile, y0, y1, mat='naval', parent=None):
        """Closed (x, z) profile extruded between two lateral stations."""
        k = len(profile)
        return self.mesh(n, [(x, y, z) for y in [y0, y1] for x, z in profile],
                         [tuple(reversed(range(k))), tuple(range(k, 2 * k))] +
                         [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)],
                         mat, parent)

    def eplate(self, n, profile, u0, u1, mat='naval'):
        """Closed (t, d) profile in the elevation frame, extruded laterally."""
        k = len(profile)
        return self.mesh(n, [self.ep(t, u, d) for u in [u0, u1] for t, d in profile],
                         [tuple(reversed(range(k))), tuple(range(k, 2 * k))] +
                         [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)],
                         mat, self.elevation[0])

    def ring(self, n, centre, r, mat='edge', parent=None, wire=.012, count=10, plane='td'):
        pts = []
        for i in range(count):
            a = i * math.tau / count
            if plane == 'td':      # ring standing in the fore-aft/vertical plane
                pts.append((centre[0] + r * math.cos(a), centre[1], centre[2] + r * math.sin(a)))
            else:                  # ring across the line of sight
                pts.append((centre[0], centre[1] + r * math.cos(a), centre[2] + r * math.sin(a)))
        for a, b in zip(pts, pts[1:] + pts[:1]):
            self.rod(n, a, b, wire, mat, parent, vertices=4)
        return pts

    def wheel(self, n, centre, r, parent=None):
        pts = self.ring(n + ' rim', centre, r, 'edge', parent, wire=.016, count=8)
        for i in [0, 3, 6]:
            self.rod(n + ' spoke', centre, pts[i], .011, 'edge', parent, vertices=4)
        self.rod(n + ' crank', pts[0], (pts[0][0], pts[0][1] + .08, pts[0][2]), .017,
                 'edge', parent, vertices=6)

    def finish(self):
        a, b, c = self.mount['position']
        self.yaw.location = (-c, -a, b)
        self.yaw.rotation_euler.z = -math.radians(self.mount['bearingDeg'])
        return self.yaw

    # ------------------------------------------------------------------ guns
    def gun_block(self, sight='mast', seat=-.95):
        """The elevating mass: four guns in a 2x2 block on one trunnion axis."""
        s = self.s
        muzzle = s['muzzleForward'] - s['trunnionForward']
        for i in range(len(self.recoil)):
            u = LATERAL if i < 2 else -LATERAL       # port column first
            d = ROW if i in (0, 3) else -ROW         # outer ids take the upper row
            side = 1 if u > 0 else -1
            gun = self.recoil[i]

            def rbox(n, t, uu, dd, dim, mat='edge'):
                return self.box(n, self.rp(i, t, uu, dd), dim, mat, gun)

            def rrod(n, a, c, r, mat='edge', vertices=8, r2=None):
                return self.rod(n, self.rp(i, *a), self.rp(i, *c), r, mat, gun, r2, vertices)

            # --- recoiling: breech, receiver, jacketed tube, flash hider
            rbox('breech block', -.49, u, d, (.20, .15, .19))
            rbox('receiver', -.16, u, d, (.60, .13, .15))
            rbox('feed way', -.09, u, d + .09, (.28, .10, .06))
            rrod('barrel jacket', (.16, u, d), (.58, u, d), .042, vertices=10)
            for t in [.30, .46]:
                rrod('jacket rib', (t - .012, u, d), (t + .012, u, d), .050, vertices=10)
            rrod('barrel', (.54, u, d), (muzzle - .12, u, d), TUBE, vertices=10)
            rrod('flash hider', (muzzle - .13, u, d), (muzzle, u, d), .036, r2=.048, vertices=8)
            rrod('bore', (muzzle - .03, u, d), (muzzle + .002, u, d), s['caliberM'] / 2 + .004,
                 'dark', vertices=8)
            rrod('charging handle', (-.33, u, d + .04), (-.33, u + side * .18, d + .04),
                 .016, vertices=6)

            # --- elevating: cradle trough, spring housing, magazine
            self.ebox('cradle', .00, u, d - .10, (.98, .12, .09))
            self.ebox('cradle bearer', -.28, u + side * .02, d - .10, (.24, .14, .13))
            self.ebox('spring housing', -.02, u, d + .095, (.82, .085, .075), 'edge')
            magazine = self.ebox('magazine', .12, u + side * .20, d + .01, (.28, .32, .10), 'dark')
            magazine.rotation_euler.x = -side * .20
            self.ebox('magazine catch', .12, u + side * .06, d + .01, (.16, .10, .10), 'edge')

        # --- elevating frame: two side plates outboard of the carriage cheeks
        frame = [(-.66, -.08), (-.52, -.30), (.30, -.34), (.66, -.24),
                 (.70, .14), (.46, .34), (-.34, .36), (-.62, .18)]
        for u in [.275, -.275]:
            self.eplate('elevating frame', frame, u - .027, u + .027)
            self.erod('trunnion pin', (0, u * .78, 0), (0, u, 0), .075, 'edge')
        # Cross ties stand clear of the carriage cheeks at every elevation.
        for t, d in [(.68, .30), (.68, -.28)]:
            self.erod('block tie', (t, -.29, d), (t, .29, d), .035)
        self.eplate('block front web', [(.56, -.30), (.74, -.24), (.74, .30), (.56, .34)], -.30, .30)

        # --- spent case chutes, one per column, outboard of the cheeks
        for u in [.30, -.30]:
            self.eplate('case chute', [(-.10, -.20), (.36, -.26), (.40, -.40), (-.08, -.36)],
                        u - .035, u + .035, 'dark')
            self.erod('case chute strap', (-.08, u, -.20), (-.08, u, -.36), .014, 'edge', vertices=4)

        # --- footrests for the layer, on the frame
        for u in [.30, -.30]:
            self.ebox('layer footrest', -.32, u, -.17, (.26, .16, .03), 'roof')
            self.erod('footrest arm', (-.32, u, -.06), (-.32, u, -.16), .018, 'edge', vertices=4)

        # --- layer's seat and controls, carried on the frame
        for u in [.28, -.28]:
            self.erod('seat bracket', (-.36, u, .26), (seat + .03, u, .42), .033, 'painted-edge')
            self.erod('seat bracket stay', (seat + .33, u, .10), (seat + .15, u, .41), .022,
                      'painted-edge')
            self.wheel('handwheel', self.ep(-.56, u + (.10 if u > 0 else -.10), .46), .145,
                       self.elevation[0])
            self.erod('handwheel shaft', (-.56, u, .46), (-.56, u + (.10 if u > 0 else -.10), .46),
                      .024, 'edge', vertices=6)
        self.ecyl('layer seat', seat, 0, .47, .20, .05, 'roof', vertices=8)
        self.erod('seat cross bearer', (seat, -.28, .42), (seat, .28, .42), .030, 'painted-edge')
        back = self.ebox('layer backrest', seat - .16, 0, .70, (.06, .36, .30), 'roof')
        back.rotation_euler.y = .22
        for u in [-.15, .15]:
            self.erod('backrest post', (seat - .14, u, .47), (seat - .17, u, .70), .020,
                      'painted-edge')

        if sight == 'mast':
            self.sight_mast(.12)
        elif sight == 'twin-mast':
            self.sight_mast(LATERAL, tie=False)
            self.sight_mast(-LATERAL, tie=False)
        else:
            for u in [.275, -.275]:
                self.erod('sight post', (-.30, u, .36), (-.34, u, .56), .022, 'edge')
                self.ring('sight ring', self.ep(-.34, u, .64), .072, 'edge',
                          self.elevation[0], wire=.009, count=8, plane='ud')
                self.erod('sight crosshair', (-.34, u, .57), (-.34, u, .71), .005, 'edge', vertices=4)
            for u in [LATERAL, -LATERAL]:
                self.erod('foresight arm', (.44, u, .26), (.48, u, .38), .016, 'edge')
                self.erod('foresight bead', (.48, u, .38), (.48, u, .42), .010, 'edge')

    def sight_mast(self, u, tie=True):
        """Tall layer's ring sight on its braced arm above the block.

        The arm springs from the elevating frame outside the carriage cheeks so
        that the whole sight clears the carriage through the elevation range.
        """
        root = math.copysign(.275, u if u else 1)
        self.erod('sight arm', (-.30, root, .34), (-.33, u, 1.08), .042, 'painted-edge')
        self.erod('sight arm knee', (.10, root, .34), (-.28, root, .84), .028, 'painted-edge')
        self.ebox('sight head', -.33, u, 1.14, (.10, .09, .12), 'edge')
        self.ring('sight ring', self.ep(-.31, u, 1.25), .125, 'edge', self.elevation[0],
                  wire=.011, count=10, plane='ud')
        self.erod('sight crosshair', (-.31, u - .125, 1.25), (-.31, u + .125, 1.25),
                  .005, 'edge', vertices=4)
        self.erod('sight crosshair', (-.31, u, 1.125), (-.31, u, 1.375), .005, 'edge', vertices=4)
        if tie:
            self.erod('sight tie rod', (-.31, u, 1.20), (.70, u, .31), .014, 'edge', vertices=4)
            self.erod('foresight bead arm', (.70, u, .31), (.74, u, .44), .014, 'edge')
            self.erod('foresight bead', (.74, u, .44), (.74, u, .48), .010, 'edge')

    # -------------------------------------------------------------- carriage
    def cheeks(self, apex=.34):
        """Curved trunnion cheeks: the elevating frame rides outside this radius."""
        tr, ph = self.s['trunnionForward'], self.s['pivotHeight']
        outer = [(tr + ARC * math.cos(a), ph + ARC * math.sin(a))
                 for a in [math.radians(-76 + 146 * i / 9) for i in range(10)]]
        inner = [(tr + apex * math.cos(a), ph + apex * math.sin(a))
                 for a in [math.radians(70 - 146 * i / 5) for i in range(6)]]
        for y in [.218, -.218]:
            self.plate('trunnion cheek', outer + inner, y - .018, y + .018)
        for y in [.20, -.20]:
            self.rod('trunnion boss', (tr, y, ph), (tr, y * 1.45, ph), .085, 'edge', vertices=10)

    def pedestal_ribs(self, top, base=.44, waist=.34):
        for i in range(8):
            a = math.tau * i / 8
            lo, hi = .08, top - .20
            r0 = base - (base - waist) * (lo - .06) / max(.01, top - .22)
            r1 = base - (base - waist) * (hi - .06) / max(.01, top - .22)
            rib = self.box('pedestal rib', ((r0 + r1) / 2 * math.cos(a) * .99,
                                            (r0 + r1) / 2 * math.sin(a) * .99, (lo + hi) / 2),
                           (.10, .10, hi - lo), 'naval')
            rib.rotation_euler.z = a

    def side_platform(self, x0, x1, y0, y1, z, seat=True):
        for side in [1, -1]:
            self.box('side platform', ((x0 + x1) / 2, side * (y0 + y1) / 2, z - .025),
                     (x1 - x0, y1 - y0, .05), 'roof')
            # The inner edge laps the turntable, and the bearer carries the
            # overhang forward onto the plate.
            self.rod('platform bearer', (x0 + .04, side * (y0 + .06), z - .06),
                     (x1 + .18, side * (y0 + .06), z - .06), .035, 'naval')
            if seat:
                post = (x0 + .60, side * (y1 - .06))
                self.rod('seat arm', (post[0], side * (y0 + .22), z + .02),
                         (post[0], post[1], z + .44), .033, 'painted-edge')
                self.rod('seat arm stay', (post[0] - .26, side * (y0 + .30), z + .02),
                         (post[0] - .02, post[1] * .98, z + .42), .022, 'painted-edge')
                self.cyl('loader seat', (post[0], post[1], z + .50), .19, .05, 'roof', vertices=8)
                rest = self.box('loader backrest', (post[0] - .18, post[1], z + .63),
                                (.04, .28, .22), 'roof')
                rest.rotation_euler.y = -.20
                self.rod('backrest arm', (post[0] - .15, post[1], z + .50),
                         (post[0] - .18, post[1], z + .61), .018, 'painted-edge', vertices=4)

    def ready_rack(self, x0, x1, y0, y1, z, rounds=4):
        for side in [1, -1]:
            self.box('ready rack floor', ((x0 + x1) / 2, side * (y0 + y1) / 2, z + .02),
                     (x1 - x0, y1 - y0, .04), 'edge')
            self.rod('ready rack bearer', (x0 + .03, side * (y1 - .04), z),
                     (x1 - .03, side * (y1 - .04), z), .028, 'naval')
            self.rod('ready rack stay', (x0 + .06, side * (y1 - .06), z),
                     (x0 + .10, side * (y0 - .10), z - .06), .022, 'naval')
            self.box('ready rack back', (x1 - .02, side * (y0 + y1) / 2, z + .16),
                     (.035, y1 - y0, .30), 'naval')
            for i in range(rounds):
                x = x0 + .07 + (x1 - x0 - .14) * i / max(1, rounds - 1)
                self.box('ready magazine', (x, side * (y0 + y1) / 2, z + .16),
                         (.075, .26, .24), 'dark')
            self.rod('rack strap', (x0 + .04, side * (y0 + y1) / 2, z + .27),
                     (x1 - .04, side * (y0 + y1) / 2, z + .27), .012, 'edge', vertices=4)


def create_mount(mount, col, helpers, materials):
    b = Vierling(mount, col, helpers, materials)
    b.guns()
    variant = b.s['id']

    if variant == 'flak38-20-vierling-shielded':
        b.gun_block(sight='twin-mast', seat=-.62)
        shielded_carriage(b)
    elif variant == 'flak38-20-vierling-c35':
        b.gun_block(sight='post', seat=-.52)
        c35_carriage(b)
    else:
        b.gun_block(sight='mast')
        pedestal_carriage(b)
    return b.finish()


def pedestal_carriage(b):
    """gga008: tall fluted pedestal, open carriage, two loader platforms."""
    top = .66
    b.box('sole plate', (0, 0, .03), (1.04, 1.04, .06), 'edge')
    for x, y in [(1, 1), (1, -1), (-1, 1), (-1, -1)]:
        b.box('holding down pad', (x * .42, y * .42, .075), (.17, .17, .05), 'edge')
    b.cyl('training pedestal', (0, 0, .31), .44, .50, 'naval', r2=.34)
    b.pedestal_ribs(top + .06)
    b.cyl('training bearing', (0, 0, .61), .40, .10, 'edge')

    outline = [(.60, .30), (.42, .58), (-.08, .61), (-.26, .44),
               (-.26, -.44), (-.08, -.61), (.42, -.58), (.60, -.30)]
    k = len(outline)
    b.mesh('turntable', [(x, y, z) for z in [.66, .71] for x, y in outline],
           [tuple(reversed(range(k))), tuple(range(k, 2 * k))] +
           [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)], 'naval')

    body = [(-.35, .70), (.46, .70), (.46, 1.34), (.36, 1.52), (.10, 1.58), (-.29, 1.56), (-.35, 1.42)]
    b.plate('carriage body', body, -.20, .20)
    b.cheeks()
    b.side_platform(-.86, -.08, .33, 1.04, .76)
    b.ready_rack(.04, .44, .40, .76, .76)
    for side in [1, -1]:
        b.box('training gear case', (-.16, side * .185, .94), (.30, .10, .26), 'edge')
        b.box('elevation gear case', (.26, side * .185, .92), (.22, .10, .22), 'edge')


def shielded_carriage(b):
    """gga042: low deck carriage inside a large plated shield."""
    b.box('sole plate', (0, 0, .03), (1.12, 1.12, .06), 'edge')
    for x, y in [(1, 1), (1, -1), (-1, 1), (-1, -1)]:
        b.box('holding down pad', (x * .46, y * .46, .075), (.17, .17, .05), 'edge')
    b.cyl('training pedestal', (0, 0, .15), .47, .18, 'naval', r2=.42)
    b.cyl('training bearing', (0, 0, .27), .43, .10, 'edge')
    outline = [(.58, .32), (.40, .56), (-.10, .58), (-.30, .42),
               (-.30, -.42), (-.10, -.58), (.40, -.56), (.58, -.32)]
    k = len(outline)
    b.mesh('turntable', [(x, y, z) for z in [.30, .35] for x, y in outline],
           [tuple(reversed(range(k))), tuple(range(k, 2 * k))] +
           [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)], 'naval')
    body = [(-.40, .34), (.40, .34), (.40, 1.06), (.33, 1.28), (.10, 1.37), (-.34, 1.42), (-.40, 1.30)]
    b.plate('carriage body', body, -.20, .20)
    b.cheeks()

    # The shield stands on the deck: tall wings either side of a central
    # aperture that the gun block elevates through, and side returns aft.
    for side in [1, -1]:
        wing = [(.52, .06), (.52, 1.74), (.474, 1.74), (.474, .06)]
        b.plate('shield wing', wing, side * .44, side * .86)
        # The outer third of each wing turns aft, as on the reference mounting.
        outer = b.plate('shield wing outer', wing, side * .86, side * 1.26)
        for v in outer.data.vertices:
            v.co.x -= max(0, abs(v.co.y) - .86) * .55
        b.plate('shield wing rim', [(.53, 1.70), (.53, 1.76), (.46, 1.76), (.46, 1.70)],
                side * .44, side * .88)
        b.plate('shield aperture rim', [(.55, .06), (.55, 1.74), (.44, 1.74), (.44, .06)],
                side * .44, side * .48)
        b.rod('shield wing stiffener', (.42, side * .62, .12), (.42, side * .62, 1.70), .032)
        b.rod('shield wing stay', (.42, side * .62, .34), (.14, side * .54, .16), .028)
        b.rod('shield wing stay', (.45, side * 1.06, .30), (.30, side * 1.06, .12), .028)
        # Side returns carry the shield aft past the layer's station.
        ret = b.plate('shield side return',
                      [(.30, .12), (.30, 1.52), (.255, 1.52), (.255, .12)], side * 1.22, side * 1.26)
        for v in ret.data.vertices:
            v.co.x -= .62 if v.co.z < .82 else .0
        b.plate('shield side return upper',
                [(.28, 1.44), (.28, 1.56), (-.34, 1.56), (-.34, 1.44)], side * 1.22, side * 1.26)
    b.plate('shield sill', [(.52, .06), (.52, .48), (.474, .48), (.474, .06)], -.44, .44)
    b.plate('shield sill rim', [(.53, .44), (.53, .50), (.44, .50), (.44, .44)], -.44, .44)
    b.box('shield roller step', (.30, 0, .40), (.50, .70, .05), 'roof')


def c35_carriage(b):
    """gga035: C/35 mounting on a cruciform platform with the long rear trail."""
    b.box('sole plate', (0, 0, .025), (1.08, 1.02, .05), 'edge')
    for x, y in [(1, 1), (1, -1), (-1, 1), (-1, -1)]:
        b.box('holding down pad', (x * .44, y * .40, .065), (.16, .16, .04), 'edge')
    b.plate('base flange', [(-.44, .05), (.48, .05), (.48, .24), (-.44, .24)], -.42, .42)
    b.cyl('training pedestal', (0, 0, .43), .40, .40, 'naval', r2=.32)
    b.cyl('training bearing', (0, 0, .66), .37, .10, 'edge')
    outline = [(.56, .28), (.40, .52), (-.10, .55), (-.28, .40),
               (-.28, -.40), (-.10, -.55), (.40, -.52), (.56, -.28)]
    k = len(outline)
    b.mesh('turntable', [(x, y, z) for z in [.71, .76] for x, y in outline],
           [tuple(reversed(range(k))), tuple(range(k, 2 * k))] +
           [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)], 'naval')
    body = [(-.34, .75), (.44, .75), (.44, 1.44), (.38, 1.66), (.16, 1.74), (-.28, 1.80), (-.34, 1.68)]
    b.plate('carriage body', body, -.20, .20)
    b.cheeks()

    # Long rear trail with the trainer's seat at its end.
    b.plate('rear trail', [(-.62, .44), (-1.66, .66), (-1.66, .78), (-.62, .70)], -.11, .11)
    b.plate('rear trail web', [(-.62, .38), (-1.20, .54), (-1.20, .64), (-.62, .58)], -.06, .06)
    b.box('trail deck', (-1.42, 0, .80), (.40, .40, .05), 'roof')
    b.rod('trail seat post', (-1.46, 0, .80), (-1.46, 0, .95), .045, 'painted-edge')
    b.cyl('trainer seat', (-1.46, 0, .98), .19, .05, 'roof', vertices=8)
    rest = b.box('trainer backrest', (-1.64, 0, 1.12), (.05, .34, .26), 'roof')
    rest.rotation_euler.y = -.22
    b.rod('backrest arm', (-1.62, 0, .98), (-1.64, 0, 1.10), .018, 'painted-edge', vertices=4)

    # Forward spar and the transverse ready-ammunition rail.
    b.plate('forward spar', [(.54, .40), (1.64, .40), (1.64, .52), (.54, .58)], -.09, .09)
    b.rod('ammunition rail', (.94, -.84, .93), (.94, .84, .93), .045, 'naval', vertices=8)
    for side in [1, -1]:
        b.rod('rail stanchion', (.92, side * .16, .52), (.94, side * .30, .92), .030)
        b.rod('rail stay', (1.44, side * .05, .46), (.96, side * .62, .90), .022)
        b.box('rail end box', (.92, side * .86, .90), (.22, .20, .22), 'edge')
        for y in [.50, .74]:
            b.box('ready ammunition box', (.94, side * y, .78), (.20, .18, .24), 'dark')
            b.rod('box hanger', (.94, side * y, .93), (.94, side * y, .84), .014, 'edge', vertices=4)
        # Loaders' seats on the forward outriggers.
        b.rod('loader seat arm', (.72, side * .30, .50), (.70, side * .62, .82), .032, 'painted-edge')
        b.rod('loader seat stay', (.40, side * .26, .58), (.68, side * .58, .80), .022, 'painted-edge')
        b.cyl('loader seat', (.70, side * .64, .86), .19, .05, 'roof', vertices=8)
        rest = b.box('loader backrest', (.52, side * .64, 1.00), (.05, .34, .26), 'roof')
        rest.rotation_euler.y = -.20
        b.rod('backrest arm', (.54, side * .64, .86), (.52, side * .64, .98), .018,
              'painted-edge', vertices=4)
        b.box('loader footplate', (.90, side * .60, .54), (.34, .30, .04), 'roof')
        # Forward splinter plates on the outriggers, clear of the barrel sweep.
        b.plate('outrigger splinter plate', [(1.05, .55), (1.05, .84), (1.00, .84), (1.00, .55)],
                side * .18, side * .71)
        b.rod('splinter plate stay', (1.02, side * .22, .58), (.86, side * .18, .48), .024)
