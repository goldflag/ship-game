"""Original 20 mm Oerlikon multiple mounts, drawn from measurements of the
approved GameModels3D references aga225 (US quadruple), bga020 (British Mk V
power twin) and aga070/aga214/aga224 (US twins).

No reference mesh, texture or transform is imported: every surface here is
authored from station, radius and profile numbers read off those models. One
recipe serves every variant; `mount['weapon']['id']` selects the stand, the
shield and the sighting gear, while the gun itself is shared because all of
these mountings carry the same 20 mm automatic.

Authoring frame: +X muzzle, +Y port, +Z up, metres, yaw datum on the sole at
z = 0. Geometry parented to an elevation joint is authored in that joint's
local frame with the bore on local +X.
"""
import bpy
import math
from mathutils import Matrix

TAU = math.tau

# stand / shield / sight selection per catalog part
VARIANTS = {
    'us-20mm-oerlikon-mk15-quad': dict(kind='quad'),
    'bl-20mm-oerlikon-mkv-twin': dict(kind='mkv'),
    'us-20mm-oerlikon-twin-tripod': dict(kind='twin', stand='tripod', shield='wide', sight='ring'),
    'us-20mm-oerlikon-mk14-twin': dict(kind='twin', stand='tripod', shield='narrow', sight='mk14'),
    'us-20mm-oerlikon-mk4-twin': dict(kind='twin', stand='cone', shield='narrow', sight='mk14',
                                      backplate=True),
}


class Mount:
    """Joint hierarchy and the small set of shapes these mountings need."""

    def __init__(self, mount, col, helpers, materials):
        self.mount, self.col, self.h = mount, col, helpers
        self.m = dict(materials)
        self.m.setdefault('roof', self.m['naval'])
        self.m.setdefault('painted-edge', self.m['edge'])
        self.name = mount['id']
        self.spec = mount['weapon']
        self.yaw = self.joint('yaw')

    # --- hierarchy -------------------------------------------------------
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

    def mat(self, role):
        return self.m.get(role, self.m['naval'])

    # --- shapes ----------------------------------------------------------
    def box(self, n, loc, dim, role='naval', parent=None):
        return self.put(self.h['box'](self.name + '.' + n, loc, dim, self.mat(role), self.col), parent)

    def cyl(self, n, loc, r, depth, role='naval', parent=None, r2=None, k=16):
        return self.put(self.h['cyl'](self.name + '.' + n, loc, r, depth, self.mat(role), self.col, k, r2), parent)

    def rod(self, n, a, b, r, role='edge', parent=None, r2=None, k=8):
        return self.put(self.h['rod'](self.name + '.' + n, a, b, r, self.mat(role), self.col, r2=r2, vertices=k), parent)

    def mesh(self, n, verts, faces, role='naval', parent=None, smooth=False):
        return self.put(self.h['mesh'](self.name + '.' + n, verts, faces, self.mat(role), self.col, smooth), parent)

    @staticmethod
    def _clockwise(profile):
        """Outlines are quoted in whichever order reads best; normalise the
        winding here so every extrusion comes out with its faces outward."""
        area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(profile, profile[1:] + profile[:1]))
        return list(reversed(profile)) if area > 0 else list(profile)

    def plate(self, n, profile, y0, y1, role='naval', parent=None):
        """Extrude an x-z outline between two lateral stations."""
        profile = self._clockwise(profile)
        y0, y1 = sorted((y0, y1))
        k = len(profile)
        verts = [(x, y, z) for y in (y0, y1) for x, z in profile]
        faces = [tuple(reversed(range(k))), tuple(range(k, 2 * k))]
        faces += [(i, (i + 1) % k, (i + 1) % k + k, i + k) for i in range(k)]
        return self.mesh(n, verts, faces, role, parent)

    def panel(self, n, profile, x0, x1, role='naval', parent=None):
        """Extrude a y-z outline between two fore-and-aft stations."""
        profile = self._clockwise(profile)
        x0, x1 = sorted((x0, x1))
        k = len(profile)
        verts = [(x, y, z) for x in (x0, x1) for y, z in profile]
        faces = [tuple(range(k)), tuple(reversed(range(k, 2 * k)))]
        faces += [(i, i + k, (i + 1) % k + k, (i + 1) % k) for i in range(k)]
        return self.mesh(n, verts, faces, role, parent)

    def tube(self, n, rings, role='edge', parent=None, k=10, at=(0, 0, 0), smooth=True):
        """Surface of revolution about a line parallel to +X: rings of (x, r)."""
        verts = [(at[0] + x, at[1] + r * math.cos(i * TAU / k), at[2] + r * math.sin(i * TAU / k))
                 for x, r in rings for i in range(k)]
        faces = [(j * k + i, j * k + (i + 1) % k, (j + 1) * k + (i + 1) % k, (j + 1) * k + i)
                 for j in range(len(rings) - 1) for i in range(k)]
        faces.append(tuple(reversed(range(k))))
        faces.append(tuple(range((len(rings) - 1) * k, len(rings) * k)))
        return self.mesh(n, verts, faces, role, parent, smooth)

    def ring(self, n, at, r, role='edge', parent=None, wire=.008, k=10):
        """Wire hoop standing in the y-z plane."""
        x, y, z = at
        pts = [(x, y + r * math.cos(i * TAU / k), z + r * math.sin(i * TAU / k)) for i in range(k)]
        for a, c in zip(pts, pts[1:] + pts[:1]):
            self.rod(n, a, c, wire, role, parent, k=4)
        return pts

    def wheel(self, n, at, r, role='edge', parent=None):
        pts = self.ring(n, at, r, role, parent, wire=.011, k=8)
        for i in (0, 3, 6):
            self.rod(n + ' spoke', at, pts[i], .009, role, parent, k=4)
        self.rod(n + ' crank', pts[0], (pts[0][0] + .07, pts[0][1], pts[0][2]), .014, role, parent, k=6)

    def handrail(self, n, path, role='painted-edge', parent=None, stand=.09):
        """Rail on short stanchions; path points are the rail line."""
        for p in path:
            self.rod(n + ' stanchion', (p[0], p[1], p[2] - stand), p, .014, role, parent, k=4)
        for a, c in zip(path, path[1:]):
            self.rod(n + ' rail', a, c, .016, role, parent, k=4)

    # --- gun -------------------------------------------------------------
    def stations(self):
        spec = self.spec
        sides = {1: ['center'], 2: ['left', 'right'], 3: ['left', 'center', 'right'],
                 4: ['left-outer', 'left', 'right', 'right-outer']}[spec['barrelCount']]
        return [(side, ((len(sides) - 1) / 2 - i) * spec['barrelSpacing'])
                for i, side in enumerate(sides)]

    def gun_joints(self):
        """Uniform simulation stations: elevation on the trunnion axis, muzzle on the bore."""
        spec = self.spec
        out = []
        for side, y in self.stations():
            pitch = self.joint(side + '.elevation', self.yaw,
                               (spec['trunnionForward'], y, spec['pivotHeight']))
            pitch.rotation_euler.y = -math.radians(self.mount.get('initialElevationDeg', 1))
            recoil = self.joint(side + '.recoil', pitch)
            self.joint(side + '.muzzle', recoil, (spec['muzzleForward'] - spec['trunnionForward'], 0, 0))
            out.append((side, y, pitch, recoil))
        return out

    def finish(self):
        x, y, z = self.mount['position']
        self.yaw.location = (-z, -x, y)
        self.yaw.rotation_euler.z = -math.radians(self.mount['bearingDeg'])
        return self.yaw


def oerlikon_gun(b, tag, recoil, elevation, reach, breech=-.46, jacket=(-.37, .78), drum_x=.10,
                 drum_y=0.0, drum_r=.135, drum_half=.10, collar=.30, shoulder=True):
    """One 20 mm automatic in its local bore frame: +X is the bore, 0 the trunnion.

    Stations are quoted from the trunnion because each mounting slings the same
    gun at a different point along its length. `breech` is the rear face, the
    `jacket` pair the spring casing over the barrel, `reach` the muzzle.
    """
    rings = [(breech, .042), (breech + .025, .068), (jacket[0], .068), (jacket[0] + .015, .076),
             (jacket[1], .076), (jacket[1] + .02, .054), (jacket[1] + .18, .050),
             (jacket[1] + .20, .030), (reach - .15, .028), (reach - .14, .033),
             (reach - .02, .031), (reach, .029), (reach, .012)]
    b.tube(tag + ' barrel', rings, 'edge', recoil, k=10)
    # Rectangular receiver with its feed throat and the cocking gear behind it.
    body = (breech + jacket[0]) / 2
    b.box(tag + ' receiver', (body, 0, -.01), (jacket[0] - breech, .15, .155), 'edge', recoil)
    b.box(tag + ' breech casing', (breech + .04, 0, -.01), (.16, .17, .18), 'edge', recoil)
    b.box(tag + ' feed throat', (drum_x, drum_y * .5, .115), (.21, .12, .10), 'edge', recoil)
    b.rod(tag + ' charging handle', (body, .085, .02), (body, .20, .02), .016, 'edge', recoil, k=6)
    b.rod(tag + ' charging grip', (body, .20, .02), (body - .07, .22, .02), .022, 'dark', recoil, k=6)
    # Spiral drum magazine lying along the bore on top of the feed throat.
    b.tube(tag + ' drum magazine',
           [(-drum_half, drum_r * .74), (-drum_half + .012, drum_r), (drum_half - .012, drum_r),
            (drum_half, drum_r * .74)],
           'edge', recoil, k=12, at=(drum_x, drum_y, .075 + drum_r), smooth=False)
    b.rod(tag + ' drum spindle', (drum_x - drum_half - .02, drum_y, .075 + drum_r),
          (drum_x + drum_half + .02, drum_y, .075 + drum_r), .022, 'edge', recoil, k=6)
    # Cradle collar and the trunnion band stay with the elevating mass.
    b.cyl(tag + ' cradle collar', (collar, 0, 0), .098, .07, 'naval', elevation, k=10).rotation_euler.y = math.pi / 2
    b.cyl(tag + ' trunnion band', (0, 0, 0), .098, .09, 'naval', elevation, k=10).rotation_euler.y = math.pi / 2
    if shoulder:
        for s in (-1, 1):
            b.rod(tag + ' shoulder arm', (breech + .07, s * .10, -.02), (breech - .13, s * .25, .10),
                  .020, 'edge', elevation, k=6)
            b.rod(tag + ' shoulder pad', (breech - .13, s * .25, .10), (breech - .22, s * .30, .14),
                  .034, 'dark', elevation, k=6)


# ---------------------------------------------------------------------------
# US 20 mm quadruple (aga225): a rocking tub on a low training pedestal.
# ---------------------------------------------------------------------------
QUAD_WALL = [(0.319, 0.334), (0.427, 1.037), (0.318, 1.410), (-0.826, 1.170),
             (-0.792, 0.912), (-0.692, 0.670), (-0.515, 0.483), (-0.290, 0.362), (-0.037, 0.323)]


def quad_front(z):
    """Front face station of the tub at a given elevation-frame height."""
    if z <= 1.037:
        return 0.319 + (z - 0.334) * (0.427 - 0.319) / (1.037 - 0.334)
    return 0.427 - (z - 1.037) * (0.427 - 0.318) / (1.410 - 1.037)


def build_quad(b):
    spec = b.spec
    tr, ph = spec['trunnionForward'], spec['pivotHeight']
    guns = b.gun_joints()
    group = guns[0][2]
    gy = guns[0][1]

    def ev(x, y, z):
        """Elevation-frame point (yaw datum origin) in the group joint's frame."""
        return (x - tr, y - gy, z - ph)

    # --- foundation and the training yoke (train only) -------------------
    b.cyl('deck ring', (0, 0, .030), .631, .060, 'edge', k=12)
    b.cyl('training race', (0, 0, .085), .601, .050, 'naval', k=12)
    # The cone stays low: the tub's floor sweeps over the training axis at high
    # elevation, so nothing may stand above 0.22 m near the centre.
    b.cyl('pedestal cone', (0, 0, .165), .500, .110, 'naval', k=12, r2=.200)
    b.plate('yoke beam', [(-.156, .080), (.156, .080), (.156, .220), (-.156, .220)],
            -.894, .894, 'naval')
    for s in (-1, 1):
        b.plate('elevation standard',
                [(-.160, .200), (.160, .200), (.120, .800), (.070, ph + .075), (-.120, ph + .075), (-.150, .800)],
                s * .765, s * .869, 'naval')
        b.cyl('trunnion pin', (tr, s * .800, ph), .058, .140, 'edge', k=10).rotation_euler.x = math.pi / 2
        b.rod('standard brace', (-.14, s * .80, .24), (-.02, s * .80, .78), .026, 'painted-edge', k=4)
    b.box('training step', (.34, -.78, .075), (.11, .28, .150), 'painted-edge')
    b.box('training step tread', (.34, -.62, .020), (.10, .26, .040), 'edge')

    # --- the elevating tub ------------------------------------------------
    for s in (-1, 1):
        wall = [ev(x, 0, z)[0::2] for x, z in QUAD_WALL]
        b.plate('tub side', wall, *sorted([ev(0, s * .681, 0)[1], ev(0, s * .711, 0)[1]]),
                role='naval', parent=group)
    # Floor: two side strips and a front sill; the centre stays open so the
    # pedestal cap passes through the tub at full depression.
    for s in (-1, 1):
        floor = [(x, z + .035) for x, z in QUAD_WALL[-5:]] + \
                [(x, z) for x, z in reversed(QUAD_WALL[-5:])]
        b.plate('tub floor', [ev(x, 0, z)[0::2] for x, z in floor],
                *sorted([ev(0, s * .300, 0)[1], ev(0, s * .691, 0)[1]]), role='roof', parent=group)
    b.plate('tub sill', [ev(x, 0, z)[0::2] for x, z in
                         [(-.037, .323), (.319, .334), (.319, .370), (-.037, .359)]],
            *sorted([ev(0, -.300, 0)[1], ev(0, .300, 0)[1]]), role='roof', parent=group)

    # Front shield: two full-width bands and five mullions leave one aperture
    # per gun. Shield and barrels elevate together, so the cuts stay snug.
    def band(tag, z0, z1, y0, y1):
        prof = []
        zs = [z0] + ([1.037] if z0 < 1.037 < z1 else []) + [z1]
        for z in zs:
            prof.append((quad_front(z), z))
        for z in reversed(zs):
            prof.append((quad_front(z) - .032, z))
        b.plate(tag, [ev(x, 0, z)[0::2] for x, z in prof],
                *sorted([ev(0, y0, 0)[1], ev(0, y1, 0)[1]]), role='naval', parent=group)

    band('shield lower', .334, .945, -.711, .711)
    band('shield upper', 1.120, 1.410, -.711, .711)
    edges = [(-.711, -.375), (-.225, -.175), (-.025, .025), (.175, .225), (.375, .711)]
    for i, (y0, y1) in enumerate(edges):
        band('shield mullion', .945, 1.120, y0, y1)
    # Aperture rims read as pressed steel around each gun port.
    for _, y in b.stations():
        b.plate('shield port rim', [ev(x, 0, z)[0::2] for x, z in
                                    [(quad_front(1.031) + .012, .945), (quad_front(1.031) + .012, 1.120),
                                     (quad_front(1.031) - .008, 1.120), (quad_front(1.031) - .008, .945)]],
                *sorted([ev(0, y - .088, 0)[1], ev(0, y + .088, 0)[1]]), role='edge', parent=group)

    # Rear splinter plate with two ventilation ports, and the tub's top rails.
    b.plate('rear plate', [ev(x, 0, z)[0::2] for x, z in
                           [(-.860, 1.170), (-.730, 1.150), (-.790, 1.750), (-.905, 1.750)]],
            *sorted([ev(0, -.760, 0)[1], ev(0, .760, 0)[1]]), role='naval', parent=group)
    for y in (-0.48, -0.07):
        port = b.cyl('rear plate port', ev(-.795, y, 1.400), .088, .030, 'dark', group, k=6)
        port.rotation_euler = (0, math.radians(95), 0)
    for s in (-1, 1):
        rail = [ev(x, s * .790, z) for x, z in [(-.670, 1.185), (-.420, 1.235), (-.170, 1.287)]]
        b.handrail('tub grab rail', rail, 'painted-edge', group, stand=.075)
        b.box('tub side bracket', ev(-.545, s * .750, 1.170), (.30, .08, .05), 'painted-edge', group)

    # --- the four guns ----------------------------------------------------
    reach = spec['muzzleForward'] - tr
    for i, (side, y, pitch, recoil) in enumerate(guns):
        # Alternate guns sit 0.28 m further aft so the 0.31 m drums nest at the
        # 0.20 m gun spacing; every tube still reaches the common muzzle station.
        back = 0.0 if i % 2 == 0 else -.28
        oerlikon_gun(b, side, recoil, pitch, reach, breech=-.39 + back,
                     jacket=(.16 + back, .95 + back), drum_x=.22 + back, drum_r=.155,
                     drum_half=.13, collar=.60, shoulder=False)
        b.plate(side + ' gun cradle',
                [(-.36, -.075), (.36, -.075), (.40, .020), (-.40, .020)], -.105, .105, 'naval', pitch)
        b.rod(side + ' cradle strut', (-.30, 0, -.075), (-.30, 0, -.230), .028, 'naval', pitch, k=6)
        b.rod(side + ' case chute', (back - .24, 0, -.10), (back - .28, 0, -.42), .055, 'dark', pitch, k=6)

    # Cross beams tie the four cradles to the trunnion bearings.
    for x in (-.30, .34):
        b.rod('cradle cross beam', ev(tr + x, -.62, ph - .06), ev(tr + x, .62, ph - .06), .042,
              'naval', group, k=6)
    b.rod('trunnion shaft', ev(tr, -.755, ph), ev(tr, .755, ph), .050, 'edge', group, k=8)

    # --- crew stations inside the tub -------------------------------------
    # Port gunlayer: seat, back rest, foot plate and a reflector sight.
    b.box('layer platform', ev(.170, .475, 1.355), (.26, .39, .035), 'edge', group)
    b.box('layer platform', ev(-.220, .480, 1.372), (.36, .28, .030), 'edge', group)
    for x in (.050, -.380):
        b.rod('layer platform bearer', ev(x, .360, 1.250), ev(x, .360, 1.352), .022, 'painted-edge', group, k=4)
        b.rod('layer platform bearer', ev(x, .600, 1.250), ev(x, .600, 1.352), .022, 'painted-edge', group, k=4)
    b.box('layer seat pan', ev(-.215, .480, 1.415), (.30, .25, .045), 'roof', group)
    b.rod('layer seat stem', ev(-.215, .480, 1.380), ev(-.215, .480, 1.400), .042, 'painted-edge', group, k=6)
    b.plate('layer seat back', [ev(x, 0, z)[0::2] for x, z in
                                [(-.397, 1.430), (-.352, 1.430), (-.300, 1.640), (-.345, 1.640)]],
            *sorted([ev(0, .355, 0)[1], ev(0, .605, 0)[1]]), role='roof', parent=group)
    for y in (.360, .600):
        b.rod('layer seat frame', ev(-.372, y, 1.400), ev(-.322, y, 1.640), .018, 'painted-edge', group, k=4)
    b.rod('layer sight arm', ev(.060, .380, 1.375), ev(.060, .380, 1.520), .018, 'edge', group, k=6)
    b.box('layer sight head', ev(.060, .380, 1.560), (.10, .07, .08), 'edge', group)
    b.box('layer sight glass', ev(.112, .380, 1.560), (.02, .06, .065), 'glass', group)
    b.wheel('layer elevation wheel', ev(-.090, .330, 1.480), .10, 'edge', group)
    # Starboard loader: two ready-service lockers on a bracket.
    for x in (-.580, -.340):
        b.box('ready locker', ev(x, -.590, 1.040), (.21, .17, .32), 'edge', group)
        b.rod('ready locker bracket', ev(x, -.470, .960), ev(x, -.590, .880), .020, 'painted-edge', group, k=4)
    b.box('loader foot plate', ev(-.460, -.560, .880), (.52, .26, .035), 'edge', group)


# ---------------------------------------------------------------------------
# British 20 mm Mk V power twin (bga020): shielded platform on a wide pedestal.
# ---------------------------------------------------------------------------
def build_mkv(b):
    spec = b.spec
    tr, ph = spec['trunnionForward'], spec['pivotHeight']
    guns = b.gun_joints()
    group = guns[0][2]
    gy = guns[0][1]

    def ev(x, y, z):
        return (x - tr, y - gy, z - ph)

    # --- pedestal and the training platform --------------------------------
    b.cyl('deck ring', (0, 0, .020), .660, .040, 'edge', k=12)
    b.cyl('pedestal drum', (0, 0, .265), .590, .450, 'naval', k=12)
    b.cyl('training race', (0, 0, .545), .640, .110, 'edge', k=12)
    b.plate('platform floor', [(-.532, .529), (.798, .529), (.798, .620), (-.532, .620)],
            -.381, 1.029, 'roof')
    for s in (-1, 1):
        b.rod('platform bearer', (-.40, s * .32, .52), (.66, s * .32, .52), .036, 'painted-edge', k=4)
    b.rod('platform bearer', (.10, -.36, .52), (.10, 1.00, .52), .036, 'painted-edge', k=4)

    # Splinter shield: a low plate across the front, carried up on the port
    # side into the layer's shelter.
    b.plate('front shield', [(.778, .529), (.798, .529), (.798, .723), (.778, .723)],
            -.381, .298, 'naval')
    b.plate('front shield tall', [(.778, .529), (.798, .529), (.798, .959), (.778, .959)],
            .298, 1.029, 'naval')
    b.plate('port shield', [(-.532, .529), (.798, .529), (.798, .959), (-.532, .959)],
            1.007, 1.029, 'naval')
    b.plate('shelter side', [(-.532, .959), (-.019, .959), (-.019, 1.530), (-.532, 1.530)],
            1.007, 1.029, 'naval')
    b.plate('shelter front', [(-.039, .863), (-.019, .863), (-.019, 1.530), (-.039, 1.530)],
            .298, 1.029, 'naval')
    b.rod('shield stiffener', (.788, .30, .72), (.788, 1.02, .72), .020, 'painted-edge', k=4)
    b.rod('shelter coaming', (-.029, .30, 1.53), (-.029, 1.02, 1.53), .020, 'painted-edge', k=4)
    b.rod('shelter coaming', (-.029, 1.018, 1.53), (-.532, 1.018, 1.53), .020, 'painted-edge', k=4)
    # Layer's seat and foot plate inside the shelter.
    b.cyl('layer seat', (-.500, .640, .930), .175, .055, 'roof', k=10)
    b.rod('layer seat stem', (-.500, .640, .630), (-.500, .640, .910), .042, 'painted-edge', k=6)
    b.plate('layer seat back', [(-.640, .930), (-.590, .930), (-.590, 1.180), (-.640, 1.180)],
            .470, .810, 'roof')
    b.box('layer foot plate', (-.230, .680, .650), (.34, .30, .040), 'edge')
    b.box('ready locker', (.500, .820, .760), (.34, .28, .42), 'edge')
    b.rod('locker strap', (.500, .680, .760), (.500, .960, .760), .016, 'painted-edge', k=4)

    # --- elevation standards (train) and the trunnion ----------------------
    for s in (-1, 1):
        b.plate('elevation standard',
                [(-.300, .620), (-.455, .620), (-.760, 1.120), (tr + .075, ph + .045),
                 (tr - .070, ph + .045), (-.640, 1.060)],
                s * .285 - .028, s * .285 + .028, 'naval')
        b.cyl('trunnion pin', (tr, s * .285, ph), .052, .110, 'edge', k=10).rotation_euler.x = math.pi / 2
        b.rod('standard foot', (-.455, s * .285, .640), (-.230, s * .285, .640), .030, 'painted-edge', k=4)

    # --- guns and the elevating cradle -------------------------------------
    reach = spec['muzzleForward'] - tr
    for side, y, pitch, recoil in guns:
        oerlikon_gun(b, side, recoil, pitch, reach, breech=-.78, jacket=(-.23, .52),
                     drum_x=-.24, collar=.28, shoulder=False)
        b.plate(side + ' gun cradle',
                [(-.50, -.085), (.34, -.085), (.38, .030), (-.54, .030)], -.115, .115, 'naval', pitch)
        b.rod(side + ' recoil cylinder', (-.42, 0, -.115), (.26, 0, -.115), .046, 'naval', pitch, k=6)
        b.rod(side + ' case chute', (-.44, 0, -.12), (-.50, 0, -.42), .055, 'dark', pitch, k=6)
    # Cross yoke joining both guns to the trunnion, plus the power drive case.
    b.rod('cradle yoke', ev(tr, -.235, ph - .045), ev(tr, .235, ph - .045), .048, 'naval', group, k=6)
    b.rod('cradle yoke', ev(tr + .42, -.235, ph - .075), ev(tr + .42, .235, ph - .075), .040, 'naval', group, k=6)
    b.box('elevation gearcase', ev(tr - .16, 0, ph - .200), (.34, .40, .22), 'naval', group)
    b.plate('yoke web', [(-.20, -.24), (.46, -.24), (.46, -.05), (-.20, -.05)],
            *sorted([ev(0, -.235, 0)[1], ev(0, .235, 0)[1]]), role='naval', parent=group)
    # Layer's sight standard on the port side of the cradle, with the foresight
    # ring carried outboard on a short arm.
    sy = ev(0, .420, 0)[1]
    b.plate('sight standard', [(.432, .059), (.737, -.071), (.882, .180), (.576, .310)],
            sy - .020, sy + .020, 'naval', group)
    b.rod('sight standard stay', (.300, ev(0, .240, 0)[1], -.050), (.450, sy, .060),
          .020, 'painted-edge', group, k=4)
    b.rod('sight standard stay', (.700, ev(0, .240, 0)[1], -.120), (.740, sy, -.070),
          .020, 'painted-edge', group, k=4)
    ring_y = ev(0, .680, 0)[1]
    arm = [(.850, sy + .020, .120), (1.020, ring_y - .060, .010), (1.066, ring_y, -.053)]
    for a, c in zip(arm, arm[1:]):
        b.rod('sight arm', a, c, .020, 'edge', group, k=6)
    b.ring('ring sight', (1.066, ring_y, -.053), .125, 'edge', group, wire=.010, k=10)
    b.rod('ring sight bead', (1.066, ring_y, -.178), (1.066, ring_y, -.133), .008, 'edge', group, k=4)
    b.box('back sight', (.600, sy, .330), (.10, .06, .09), 'edge', group)
    for s in (-1, 1):
        b.rod('layer grip', (-.620, s * .190, -.020), (-.750, s * .300, .040), .024, 'dark', group, k=6)


# ---------------------------------------------------------------------------
# US 20 mm twins (aga070 tripod, aga214 Mk 14 sight, aga224 pedestal).
# ---------------------------------------------------------------------------
def build_twin(b, options):
    spec = b.spec
    tr, ph = spec['trunnionForward'], spec['pivotHeight']
    guns = b.gun_joints()
    group = guns[0][2]
    gy = guns[0][1]

    def ev(x, y, z):
        return (x - tr, y - gy, z - ph)

    fork = ph - .210  # top of the training column, under the trunnion yoke

    # --- stand (trains) ----------------------------------------------------
    if options['stand'] == 'tripod':
        b.cyl('deck ring', (0, 0, .040), .400, .080, 'edge', k=12)
        for i in range(3):
            a = i * TAU / 3
            foot = (.330 * math.cos(a), .330 * math.sin(a), .030)
            head = (.055 * math.cos(a), .055 * math.sin(a), fork - .140)
            b.rod('tripod leg', foot, head, .034, 'naval', k=4)
            b.box('tripod foot', (foot[0] * 1.02, foot[1] * 1.02, .045), (.14, .14, .05), 'painted-edge')
            mid = (.160 * math.cos(a), .160 * math.sin(a), .325)
            b.rod('tripod tie brace', mid, (.245 * math.cos(a), .245 * math.sin(a), .180), .020,
                  'painted-edge', k=4)
        b.cyl('tripod tie ring', (0, 0, .325), .160, .035, 'painted-edge', k=12)
        b.cyl('training column', (0, 0, (fork - .140) / 2 + .10), .090, fork - .340, 'naval', k=10)
    else:
        b.cyl('deck ring', (0, 0, .030), .380, .060, 'edge', k=12)
        b.cyl('training pedestal', (0, 0, (fork - .16) / 2 + .06), .270, fork - .220, 'naval',
              k=12, r2=.135)
    b.cyl('training race', (0, 0, fork - .085), .115, .110, 'edge', k=10)

    # Trunnion yoke: a cross head on the column with the pins outboard of the
    # cradle, so the guns swing clear of their own supports.
    b.plate('yoke head', [(-.140, fork - .030), (.140, fork - .030), (.115, fork + .060), (-.115, fork + .060)],
            -.300, .300, 'naval')
    for s in (-1, 1):
        b.plate('yoke arm', [(-.115, fork + .040), (.115, fork + .040), (.075, ph + .070), (-.085, ph + .070)],
                s * .300 - .030, s * .300 + .030, 'naval')
        b.cyl('trunnion pin', (tr, s * .300, ph), .048, .110, 'edge', k=10).rotation_euler.x = math.pi / 2
    if options['shield'] == 'narrow':
        # Fixed splinter apron standing in front of the training column, closing
        # the strip the elevating shield has to leave open.
        b.plate('front apron', [(.380, .560), (.450, .560), (.450, .980), (.380, .980)],
                -.240, .240, 'naval')
        for s in (-1, 1):
            b.rod('front apron stay', (.380, s * .180, .600), (.100, s * .070, .500),
                  .018, 'painted-edge', k=4)
            b.rod('front apron stay', (.415, s * .235, .940), (.415, s * .235, .560),
                  .016, 'painted-edge', k=4)
    if options.get('backplate'):
        # Small splinter plate beside the layer, carried on the yoke head.
        b.plate('layer splinter plate', [(-.180, fork - .150), (.180, fork - .150), (.180, ph - .140),
                                         (-.180, ph - .140)], .240, .272, 'naval')
        b.rod('splinter plate stay', (0, .150, fork - .060), (0, .256, fork + .020), .018, 'painted-edge', k=4)

    # --- elevating group ---------------------------------------------------
    b.plate('cradle', [(.010, -.365), (.590, -.250), (.590, .010), (.010, .010)],
            *sorted([ev(0, -.235, 0)[1], ev(0, .235, 0)[1]]), role='naval', parent=group)
    b.rod('trunnion shaft', ev(tr, -.290, ph), ev(tr, .290, ph), .044, 'edge', group, k=8)
    b.box('elevation gearcase', ev(tr + .13, gy * 0, ph - .285), (.28, .30, .19), 'naval', group)

    def leaf(tag, station, z0, z1, y0, y1, thick=.030):
        """Shield panel leaning with the plate: `station` gives (x at z0, x at z1)."""
        xb, xt = station
        b.plate(tag, [(xb, z0), (xt, z1), (xt - thick, z1), (xb - thick, z0)],
                y0 - gy, y1 - gy, 'naval', group)

    if options['shield'] == 'wide':
        # Wide shield leaning forward as it rises, with a shallow central notch
        # the barrels fire over. Stations measured off the levelled reference.
        def x_at(z):
            return .558 + (z + .576) * (.681 - .558) / (.177 + .576)

        def band(tag, y0, y1, z0, z1):
            leaf(tag, (x_at(z0), x_at(z1)), z0, z1, *sorted([y0, y1]))
        for s in (-1, 1):
            band('shield side', s * .355, s * .789, -.576, .177)
            # The top edge rakes down to the notch the barrels fire over.
            band('shield shoulder', s * .291, s * .355, -.550, .105)
            band('shield shoulder', s * .228, s * .291, -.530, -.038)
            b.rod('shield stay', ev(tr + .30, s * .30, ph - .34), ev(tr + .56, s * .55, ph - .40),
                  .020, 'painted-edge', group, k=4)
        band('shield centre', -.228, .228, -.511, -.110)
    else:
        # Narrow shield, also leaning forward. Below the guns the centre is
        # open: that strip sweeps across the training column near zero
        # elevation, so the fixed apron on the yoke closes it instead.
        def x_at(z):
            return .277 + (z + .619) * (.573 - .277) / (.032 + .619)
        top, waist, bot = .032, -.220, -.619
        for s in (-1, 1):
            leaf('shield side', (x_at(bot), x_at(top)), bot, top, *sorted([s * .260, s * .701]))
            leaf('shield inner', (x_at(waist), x_at(top)), waist, top, *sorted([s * .185, s * .260]))
            leaf('shield gun slot sill', (x_at(waist), x_at(-.090)), waist, -.090,
                 *sorted([s * .005, s * .185]))
        leaf('shield centre post', (x_at(waist), x_at(top)), waist, top, -.030, .030)
        for s in (-1, 1):
            b.rod('shield stay', ev(tr + .30, s * .30, ph - .30), ev(tr + .50, s * .55, ph - .44),
                  .020, 'painted-edge', group, k=4)

    if options['sight'] == 'mk14':
        b.box('mk14 sight', ev(tr - .392, 0, ph + .299), (.250, .214, .246), 'edge', group)
        b.box('mk14 sight window', ev(tr - .272, 0, ph + .310), (.022, .150, .130), 'glass', group)
        b.rod('mk14 sight mast', ev(tr - .392, 0, ph + .080), ev(tr - .392, 0, ph + .190), .038,
              'edge', group, k=6)
        b.box('mk14 sight bracket', ev(tr - .392, 0, ph + .055), (.24, .26, .05), 'naval', group)
    else:
        b.rod('ring sight arm', ev(tr - .090, 0, ph + .090), ev(tr - .090, 0, ph + .330), .020,
              'edge', group, k=6)
        b.ring('ring sight', ev(tr - .090, 0, ph + .430), .100, 'edge', group, wire=.008, k=10)
        b.rod('ring sight bead', ev(tr + .300, 0, ph + .380), ev(tr + .300, 0, ph + .430), .008,
              'edge', group, k=4)
        b.rod('ring sight post', ev(tr + .300, 0, ph + .150), ev(tr + .300, 0, ph + .380), .014,
              'edge', group, k=4)

    reach = spec['muzzleForward'] - tr
    for side, y, pitch, recoil in guns:
        out = 1 if y > 0 else -1
        oerlikon_gun(b, side, recoil, pitch, reach, breech=-.461, jacket=(-.371, .779),
                     drum_x=.099, drum_y=out * .095, collar=.45)
        b.rod(side + ' case chute', (-.34, 0, -.11), (-.42, out * .115, -.38), .050, 'dark', pitch, k=6)
        b.rod(side + ' cradle tie', (.05, 0, -.075), (.05, -out * .095, -.150), .022, 'naval', pitch, k=4)
        # Cradle cheeks, the ring the gun sits in and the gunner's shoulder
        # yoke behind the breech, all on the reference's stations.
        for s in (-1, 1):
            b.plate(side + ' cradle cheek', [(-.41, -.085), (.05, -.085), (.05, .062), (-.41, .062)],
                    s * .090 - .025, s * .090 + .025, 'naval', pitch)
            b.rod(side + ' shoulder yoke', (-.57, s * .055, .035), (-.70, s * .095, .175),
                  .022, 'edge', pitch, k=4)
            b.rod(side + ' shoulder yoke', (-.70, s * .095, .175), (-.77, s * .095, .055),
                  .020, 'edge', pitch, k=4)
        b.box(side + ' yoke pad', (-.735, 0, .115), (.055, .21, .10), 'dark', pitch)
        b.rod(side + ' cradle cross tie', (-.33, -.180, -.100), (-.33, .180, -.100), .026,
              'naval', pitch, k=6)
    for s in (-1, 1):
        b.rod('layer grip', ev(tr - .46, s * .16, ph - .12), ev(tr - .62, s * .30, ph - .05),
              .022, 'dark', group, k=6)


def create_mount(mount, col, helpers, materials):
    b = Mount(mount, col, helpers, materials)
    assert b.spec['id'] in VARIANTS, 'unknown Oerlikon mount variant %r' % b.spec['id']
    options = VARIANTS[b.spec['id']]
    if options['kind'] == 'quad':
        build_quad(b)
    elif options['kind'] == 'mkv':
        build_mkv(b)
    else:
        build_twin(b, options)
    return b.finish()
