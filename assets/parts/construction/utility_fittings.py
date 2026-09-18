"""Plain, low-poly ship hardware; no service-specific ornament or small fasteners.

Original replacement recipes retain the catalog's metre envelopes and attachment
datums. Curves use 12 sides (six on thin rods); detail belongs in the silhouette.
The exporter batches static meshes by material. Axes are forward/port/up.
"""
import math
from mathutils import Vector
from geometry import Model


class Fitting(Model):
    def cyl(self, name, loc, r, depth, **kw):
        kw.setdefault('vertices', 12)
        obj = super().cyl(name, loc, r, depth, **kw)
        for face in obj.data.polygons:
            face.use_smooth = len(face.vertices) == 4
        return obj

    def rod(self, name, a, b, r, **kw):
        kw.setdefault('vertices', 6)
        return super().rod(name, a, b, r, **kw)

    def lathe(self, name, profile, center=(0, 0, 0), axis='z', **kw):
        """Capped 12-sided casting, profile in (radius, axial distance)."""
        n = 12
        a, u, v = map(Vector, {
            'z': ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
            'y': ((0, 1, 0), (0, 0, 1), (1, 0, 0)),
        }[axis])
        c = Vector(center)
        vertices = [c + a*z + r*(u*math.cos(i*math.tau/n) + v*math.sin(i*math.tau/n))
                    for r, z in profile for i in range(n)]
        faces = [tuple(reversed(range(n))), tuple(range((len(profile)-1)*n, len(profile)*n))]
        faces += [(k*n+i, k*n+(i+1)%n, (k+1)*n+(i+1)%n, (k+1)*n+i)
                  for k in range(len(profile)-1) for i in range(n)]
        obj = self.mesh(name, vertices, faces, smooth=True, **kw)
        for face in obj.data.polygons[:2]:
            face.use_smooth = False
        return obj

    def ring(self, name, center, radius, tube, axis='z', **kw):
        a, u, v = map(Vector, {
            'x': ((1, 0, 0), (0, 1, 0), (0, 0, 1)),
            'z': ((0, 0, 1), (1, 0, 0), (0, 1, 0)),
        }[axis])
        c = Vector(center)
        n, sides = 12, 4
        vertices = []
        for i in range(n):
            radial = u*math.cos(i*math.tau/n) + v*math.sin(i*math.tau/n)
            vertices += [c + (radius+tube*math.cos(j*math.tau/sides))*radial
                         + a*tube*math.sin(j*math.tau/sides) for j in range(sides)]
        return self.mesh(name, vertices,
                         [(i*sides+j, i*sides+(j+1)%sides, ((i+1)%n)*sides+(j+1)%sides,
                           ((i+1)%n)*sides+j) for i in range(n) for j in range(sides)], **kw)


def create_twin_bitts(part, col, helpers, materials):
    m = Fitting(col, helpers, materials)
    m.box('bedplate', (0, 0, .0375), (.70, 1.56, .075))
    for y in [-.46, .46]:
        m.cyl('post', (0, y, .365), .155, .58)
        m.cyl('head', (0, y, .67), .205, .08)
    return m.root


def create_fairlead(part, col, helpers, materials):
    m = Fitting(col, helpers, materials)
    m.box('base', (0, 0, .03), (.58, 1.03, .06))
    for y in [-.36, .36]:
        for x in [-.17, .17]:
            m.box('bearing-cheek', (x, y, .25), (.055, .23, .38))
        m.cyl('roller', (0, y, .25), .092, .32, mat='painted-edge')
        m.cyl('cap', (0, y, .43), .11, .035)
    m.rod('lower-roller', (0, -.36, .145), (0, .36, .145), .072, vertices=12, mat='painted-edge')
    return m.root


def create_capstan(part, col, helpers, materials):
    m = Fitting(col, helpers, materials)
    m.cyl('sole', (0, 0, .04), .39, .08)
    # Plain waisted drum; the waist retains both original rigging sockets.
    m.lathe('drum', [(.29, .08), (.29, .18), (.205, .34), (.205, .68),
                     (.30, .86), (.30, .96)])
    return m.root


def create_anchor_windlass(part, col, helpers, materials):
    m = Fitting(col, helpers, materials)
    m.box('foundation', (0, 0, .035), (1.26, 1.95, .07))
    for y in [-.69, .69]:
        m.box('bearing-pedestal', (-.04, y, .33), (.36, .18, .52))
    m.rod('shaft', (-.04, -.93, .59), (-.04, .93, .59), .075, mat='painted-edge')
    for y in [-.40, .40]:
        m.lathe('chain-drum', [(.29, -.16), (.29, -.12), (.235, -.12),
                              (.235, .12), (.29, .12), (.29, .16)], (-.04, y, .59), axis='y')
        m.box('chain-guide', (.43, y, .15), (.30, .28, .16))
    m.box('drive-case', (-.35, 0, .39), (.48, .33, .64))
    m.rod('brake-lever', (-.35, .70, .08), (-.42, .70, .95), .025)
    m.rod('grip', (-.52, .70, .95), (-.32, .70, .95), .025, mat='painted-edge')
    return m.root


def create_stowed_anchor(part, col, helpers, materials):
    m = Fitting(col, helpers, materials)
    for z in [.32, 1.45, 1.94]:
        m.box('wall-pad', (.035, 0, z), (.07, .50, .16))
        m.box('stand-off', (.13, 0, z), (.14, .13, .11))
    m.box('shank', (.225, 0, 1.22), (.14, .15, 1.65), mat='painted-edge')
    m.rod('crown', (.22, -.47, .45), (.22, .47, .45), .095, mat='painted-edge')
    for side in [-1, 1]:
        m.path('arm', [(.22, 0, .46), (.22, side*.38, .20), (.22, side*.66, .36),
                       (.22, side*.78, .79)], .072, mat='painted-edge')
        vs = [(.13, side*.55, .47), (.34, side*.55, .47), (.34, side*.81, .92),
              (.13, side*.81, .92), (.16, side*.39, .90), (.31, side*.39, .90)]
        m.mesh('fluke', vs, [(0,1,2,3), (0,4,5,1), (0,3,4), (1,5,2), (3,2,5,4)], mat='painted-edge')
    m.ring('shackle', (.225, 0, 2.09), .13, .025, axis='x', mat='painted-edge')
    return m.root


def create_mushroom_vent(part, col, helpers, materials):
    m = Fitting(col, helpers, materials)
    m.cyl('sole', (0, 0, .025), .25, .05)
    m.cyl('trunk', (0, 0, .34), .17, .60)
    m.cyl('opening', (0, 0, .675), .27, .15, mat='dark')
    m.lathe('rain-cap', [(.345, .735), (.345, .785), (.18, .85)])
    return m.root


def create_cowl_vent(part, col, helpers, materials):
    m = Fitting(col, helpers, materials)
    m.cyl('sole', (0, 0, .025), .29, .05)
    # A single plain trunk and quarter-turn hood; hollow only where visible.
    # Four bend spans replace the old double-wall sweep and its separate torus rim.
    n = 12
    rings = [(Vector((0, 0, .05)), 0, .235), (Vector((0, 0, 1.08)), 0, .235)]
    for i in range(1, 5):
        a = i*math.pi/8
        rings.append((Vector((.28*(1-math.cos(a)), 0, 1.08+.28*math.sin(a))), a, .235+.10*i/4))
    mouth, a, r = rings[-1]
    rings += [(mouth, a, r-.04), (mouth-Vector((.17, 0, 0)), a, r-.07)]
    vertices = [p + r*(Vector((0, 1, 0))*math.cos(j*math.tau/n)
                       + Vector((math.cos(a), 0, -math.sin(a)))*math.sin(j*math.tau/n))
                for p, a, r in rings for j in range(n)]
    faces = [(k*n+j, k*n+(j+1)%n, (k+1)*n+(j+1)%n, (k+1)*n+j)
             for k in range(len(rings)-1) for j in range(n)]
    m.mesh('trunk-and-hood', vertices, faces, smooth=True)
    m.mesh('recess', vertices[-n:], [tuple(range(n))], mat='dark')
    return m.root


def create_deck_hatch(part, col, helpers, materials):
    m = Fitting(col, helpers, materials)
    m.box('coaming', (0, 0, .10), (1.16, .96, .20), mat='painted-edge')
    m.box('lid', (0, 0, .224), (1.12, .92, .075))
    for x in [-.44, .44]:
        m.box('hinge', (x, .37, .25), (.11, .18, .03), mat='painted-edge')
    m.box('handle', (-.12, 0, .27), (.05, .20, .025), mat='painted-edge')
    return m.root


def create_inclined_stairs(part, col, helpers, materials):
    m = Fitting(col, helpers, materials)
    for y in [-.365, .365]:
        for x in [-1.00, 1.02]:
            m.box('foot', (x, y, .025), (.24, .16, .05))
        m.rod('stringer', (-1.10, y, .09), (1.03, y, 2.07), .08, vertices=4)
        m.box('landing-leg', (1.02, y, 1), (.065, .065, 2))
        for i in [0, 5, 9]:
            x, z = -1+i*.218, .20+i*.204
            m.rod('stanchion', (x, y, z), (x, y, z+.82), .021)
        m.rod('handrail', (-1, y, 1.02), (.962, y, 2.856), .025)
        m.rod('midrail', (-1, y, .63), (.962, y, 2.466), .014)
    for i in range(10):
        m.box('tread', (-1+i*.218, 0, .20+i*.204), (.24, .73, .055))
    return m.root


def create_hawse_pipe(part, col, helpers, materials):
    m = Fitting(col, helpers, materials)
    m.box('wear-plate', (0, 0, .02), (2, 1.04, .04))
    n = 12
    rows = [(.60, .42, .04), (.52, .34, .21), (.40, .23, .21), (.35, .19, .045)]
    vertices = [(.36+a*math.cos(i*math.tau/n), b*math.sin(i*math.tau/n), z)
                for a, b, z in rows for i in range(n)]
    m.mesh('bolster', vertices, [(k*n+i, k*n+(i+1)%n, (k+1)*n+(i+1)%n, (k+1)*n+i)
                                for k in range(3) for i in range(n)], smooth=True)
    m.mesh('mouth-shadow', vertices[-n:], [tuple(range(n))], mat='dark')
    return m.root


def create_cable_reel(part, col, helpers, materials):
    m = Fitting(col, helpers, materials)
    for y in [-.60, .60]:
        m.box('foot', (0, y, .025), (1.10, .16, .05))
        for x in [-.43, .43]:
            m.rod('stand', (x, y, .05), (0, y, .68), .05, vertices=4)
    m.rod('shaft', (0, -.70, .68), (0, .70, .68), .05, mat='painted-edge')
    m.rod('wound-hawser', (0, -.44, .68), (0, .44, .68), .385, vertices=12, mat='rope')
    for y in [-.46, .46]:
        m.rod('drum-side', (0, y-.02, .68), (0, y+.02, .68), .50, vertices=12)
    m.rod('crank', (0, .70, .68), (.20, .70, .46), .025)
    m.rod('grip', (.20, .70, .46), (.20, .79, .46), .03, mat='painted-edge')
    return m.root


def create_deck_winch(part, col, helpers, materials):
    m = Fitting(col, helpers, materials)
    m.box('bedplate', (-.17, 0, .05), (2.04, 2.12, .10))
    for y in [-.68, .68]:
        m.box('bearing-stand', (0, y, .42), (.35, .20, .64))
    m.rod('shaft', (0, -1.28, .74), (0, 1.28, .74), .07, mat='painted-edge')
    m.rod('cable-drum', (0, -.42, .74), (0, .42, .74), .40, vertices=12, mat='painted-edge')
    for y in [-.44, .44]:
        m.rod('drum-side', (0, y-.025, .74), (0, y+.025, .74), .52, vertices=12)
    for side in [-1, 1]:
        m.lathe('warping-head', [(.21, side*.78), (.15, side*.92), (.15, side*1.12),
                                (.235, side*1.25)], (0, 0, .74), axis='y')
    m.box('motor-foot', (-.80, -.10, .17), (.56, .82, .14))
    m.rod('motor', (-.80, -.55, .45), (-.80, .40, .45), .27, vertices=12)
    m.box('gear-case', (-.35, .52, .54), (.95, .22, .88))
    m.box('control-box', (.62, .30, .47), (.22, .26, .74))
    m.rod('control-lever', (.62, .30, .84), (.76, .30, 1.16), .025, mat='painted-edge')
    return m.root


def create_accommodation_ladder(part, col, helpers, materials):
    m = Fitting(col, helpers, materials)
    for x in [-2.20, 2.20]:
        m.box('deck-chock', (x, 0, .15), (.28, 1.16, .30))
    for y in [-.36, .36]:
        m.box('stringer', (0, y, .42), (7.56, .045, .24))
        m.box('folded-handrail', (0, y, .56), (7.56, .04, .04))
    for i in range(25):
        tread = m.box('tread', (-3.55+i*7.10/24, 0, .42), (.25, .72, .028))
        tread.rotation_euler.y = math.radians(38)
    for x, width in [(-3.38, 1.04), (3.36, .94)]:
        m.box('folded-platform', (x, 0, .59), (.90, width, .06))
    return m.root


def create_ensign_staff(part, col, helpers, materials):
    m = Fitting(col, helpers, materials)
    m.cyl('sole', (0, 0, .025), .17, .05)
    m.cyl('socket', (0, 0, .20), .075, .35)
    m.rod('staff', (0, 0, .05), (0, 0, 4.50), .048, r2=.022, vertices=8)
    m.box('cleat', (-.06, 0, 1.10), (.10, .04, .15))
    return m.root


def create_round_wall_vent(part, col, helpers, materials):
    m = Fitting(col, helpers, materials)
    r = part['size'][0]/2
    n = 16
    m.mesh('flush-panel', [(0, r*math.cos(i*math.tau/n), r*math.sin(i*math.tau/n))
                           for i in range(n)], [tuple(range(n))], mat='dark')
    relief = m.empty('surface-relief', (0, 0, 0), m.root)
    relief['wallRelief'] = True
    rim = m.ring('rim', (.018, 0, 0), r*.92, .018, axis='x', parent=relief)
    rim['wallRelief'] = True
    for i in range(-3, 4):
        z = i*r*.22
        half = math.sqrt((r*.92)**2-z*z)
        bar = m.box('grille-bar', (.027, 0, z), (.035, half*2, .017), mat='painted-edge', parent=relief)
        bar['wallRelief'] = True
    return m.root
