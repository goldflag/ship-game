"""Original Duca d'Aosta forward funnel, viewed against GM3D's 1943 asset.

Hand-authored sections and fittings in metres, +X forward / +Y port / +Z up.
No reference mesh or texture is an input. The installation sole is Z=0.
"""
import math
import sys
from pathlib import Path
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'construction'))
from geometry import Model


def oval(z, length, beam, slope=0, n=32):
    return [(length * math.cos(i * math.tau / n),
             beam * math.sin(i * math.tau / n),
             z + slope * length * math.cos(i * math.tau / n)) for i in range(n)]


def skin(m, name, rings, mat='naval'):
    n = len(rings[0])
    # Split normals at the collar and foot, smooth around each circumference.
    for a, b in zip(rings, rings[1:]):
        m.mesh(name, a + b, [(i, (i+1) % n, n+(i+1) % n, n+i)
                            for i in range(n)], mat=mat, smooth=True)


def racetrack(z, length, beam, slope=0):
    points = []
    for i in range(32):
        a = i*math.tau/32
        c = math.cos(a)
        x = 0 if abs(c) < 1e-8 else math.copysign(length-beam,c)+beam*c
        points.append((x,beam*math.sin(a),z+slope*x))
    return points


def guard(m, name, points, height=.90, closed=False):
    for p in points:
        m.rod(name+'-stanchion', p, (p[0], p[1], p[2]+height), .025, vertices=4)
    for rise in ([height] if height < .3 else [height/2, height]):
        m.path(name+'-rail', [(x, y, z+rise) for x, y, z in points],
               .018, closed=closed, vertices=4)


def ladder(m, name, points, across, width=.46):
    points = [Vector(p) for p in points]
    across = Vector(across) * width / 2
    for side in [-1, 1]:
        m.path(name+'-stringer', [p+across*side for p in points], .024, vertices=6)
    for a, b in zip(points, points[1:]):
        count = math.ceil((b-a).length/.31)
        for i in range(count):
            p = a.lerp(b, i/count)
            m.rod(name+'-rung', p-across, p+across, .018, vertices=4)


def create_aosta(part, col, helpers, materials):
    m = Model(col, helpers, materials)
    m.root['funnelOutletWidthM'] = 2.24
    m.root['funnelOutletLengthM'] = 5.14

    # The jacket has a long flared foot, a straight oval trunk, then a recessed
    # neck below the separate sloping shoulder and short, oblique upper crown.
    sections = [(0,5.70,2.22,0), (.12,5.70,2.22,0), (2.52,3.38,1.72,0),
                (5.60,3.38,1.72,0), (5.88,3.25,1.62,0),
                (5.88,3.55,1.90,0), (6.00,3.55,1.90,0),
                (6.98,2.76,1.29,.12), (7.51,2.72,1.25,.30)]
    skin(m, 'jacket', [(racetrack if i < 5 else oval)(*s)
                       for i,s in enumerate(sections)])
    for z, length, beam, slope in [(.09,5.70,2.235,0), (4.26,3.395,1.735,0),
                                  (5.59,3.395,1.735,0), (5.96,3.57,1.92,0),
                                  (6.98,2.78,1.31,.12)]:
        outline = racetrack if z < 5.8 else oval
        skin(m, 'rolled-seam', [outline(z-.026,length,beam,slope),
                               outline(z+.026,length,beam,slope)], 'painted-edge')

    # Visible mouth only: thin lip, short inner wall and recessed soot baffle.
    # The liner follows the crown's changing rake instead of piercing its wall.
    rim = oval(7.51,2.72,1.25,.30)
    inner = oval(7.51,2.60,1.13,.30)
    deep = oval(6.85,2.60,1.12,.12)
    skin(m, 'mouth-lip', [rim, inner], 'painted-edge')
    skin(m, 'uptake-liner', [inner, deep], 'dark')
    m.mesh('recessed-baffle', deep, [tuple(range(32))], mat='dark')
    # Radial cap grating and its low perimeter guard are attached to the lip.
    hub = (0,0,7.66)
    for x, y, z in oval(7.53,2.68,1.21,.30,12):
        m.rod('cap-spoke', hub, (x,y,z), .026, mat='edge', vertices=4)
    m.cyl('cap-hub', hub, .15, .045, mat='edge', vertices=12)
    guard(m, 'cap-guard', oval(7.53,2.73,1.26,.30,16), .20, True)

    # Small auxiliary uptake at the AFT end of the crown. Its lower wall crosses
    # the shoulder, so it remains attached despite the inclined principal mouth.
    aux = [[(x-2.38,y,z) for x,y,z in oval(z,.35,.35,slope,16)]
           for z,slope in [(6.48,0),(7.40,.30)]]
    skin(m, 'aft-auxiliary-uptake', aux)
    mouth = [(x-2.38,y,z) for x,y,z in oval(7.40,.275,.275,.30,16)]
    low = [(x,y,z-.36) for x,y,z in mouth]
    skin(m, 'auxiliary-lip', [aux[-1],mouth], 'painted-edge')
    skin(m, 'auxiliary-liner', [mouth,low], 'dark')
    m.mesh('auxiliary-baffle',low,[tuple(range(16))],mat='dark')

    # Paired, nearly vertical side casings sit forward of the jacket centre.
    # Rounded outside corners distinguish these from generic flared wedges.
    housing = [(.12,1.25),(3.05,1.25),(3.05,3.62),(3.01,3.83),
               (2.87,3.99),(2.64,4.05),(.54,4.05),(.31,4.00),(.16,3.84),(.12,3.64)]
    deck = [(-2.46,1.10),(-1.94,1.73),(-1.58,2.23),(-1.13,2.73),
            (-.58,3.24),(-.18,3.57),(.02,3.97),(.19,4.26),(.50,4.40),
            (2.59,4.40),(2.86,4.22),(3.02,3.98),(3.08,3.62),(3.08,1.02)]
    for side in [-1,1]:
        outline = [(x,side*y) for x,y in housing]
        # Reverse mirrored outlines to retain outward face winding.
        if side < 0: outline.reverse()
        m.prism('side-casing',outline,0,4.20)
        platform = [(x,side*y) for x,y in deck]
        if side < 0: platform.reverse()
        m.prism('service-deck',platform,4.20,4.30,mat='roof')
        # The inner ends intersect the jacket; the outer deck rests on casings.
        railpoints = [(-2.13,side*1.51,4.30),(-1.23,side*2.61,4.30),
                      (-.11,side*3.64,4.30),(.50,side*4.40,4.30),
                      (2.59,side*4.40,4.30),(3.08,side*3.62,4.30),
                      (3.08,side*2.85,4.30)]
        guard(m,'service-guard',railpoints)
        m.box('front-service-screen',(3.045,side*2.21,4.77),(.075,.57,.94))
        for x,y in [(-1.65,2.05),(-.55,3.10)]:
            m.rod('deck-knee',(x,side*1.52,3.63),(x,side*y,4.21),.045,vertices=6)

        # Outer access ladder and shallow raised casing seams.
        ladder(m,'outer-access',[(.53,side*4.17,.12),(.53,side*4.17,4.32)],(1,0,0))
        for z in [.26,1.55,2.87,4.12]:
            for x in [.30,.76]:
                m.rod('access-bracket',(x,side*4.17,z),(x,side*3.98,z),.032,vertices=4)
        for x in [.16,3.05]:
            m.box('casing-seam',(x,side*3.59,2.06),(.034,.034,4.12),mat='painted-edge')

        # Hanging service frames are bolted to the housing front and platform;
        # short stand-offs and diagonal knees make every fitting's support visible.
        for y in [2.02,3.45]:
            sy = side*y
            m.box('service-foot',(3.40,sy,2.79),(.68,.52,.065),mat='roof')
            for dy in [-.22,.22]:
                m.rod('service-frame',(3.66,sy+dy,2.80),(3.66,sy+dy,4.27),.032,vertices=4)
                for z in [2.82,4.16]:
                    m.rod('frame-anchor',(3.66,sy+dy,z),(3.01,sy+dy,z),.027,vertices=4)
                m.rod('frame-knee',(3.04,sy+dy,2.43),(3.63,sy+dy,2.79),.035,vertices=4)
            if y < 3:
                ladder(m,'service-access',[(3.71,sy,2.82),(3.71,sy,4.28)],(0,1,0),.42)
            else:
                m.rod('spindle-crossmember',(3.66,sy-.22,3.91),(3.66,sy+.22,3.91),.028,vertices=4)
                m.rod('service-spindle',(3.64,sy,3.91),(3.93,sy,3.91),.046,vertices=6)
                m.path('service-wheel',[(3.94,sy+.13*math.cos(i*math.tau/8),
                                        3.91+.13*math.sin(i*math.tau/8)) for i in range(8)],
                       .019,closed=True,vertices=4)
                for dy,dz in [(.13,0),(-.13,0),(0,.13),(0,-.13)]:
                    m.rod('wheel-spoke',(3.94,sy,3.91),(3.94,sy+dy,3.91+dz),.014,vertices=4)

        # Two exposed jacket pipes with physical clips, above the service deck.
        for x in [.85,1.80]:
            y = side*(math.sqrt(1.72**2-max(0,abs(x)-(3.38-1.72))**2)+.09)
            m.rod('jacket-pipe',(x,y,4.32),(x,y,5.42),.055,vertices=8)
            for z in [4.46,5.21]:
                m.rod('pipe-clip',(x,y,z),(x,y-side*.15,z),.033,vertices=4)
        ladder(m,'jacket-access',[(.10,side*1.84,4.30),(.10,side*1.84,5.52)],(1,0,0),.40)
        for z in [4.4,5.4]:
            for x in [-.10,.30]:
                m.rod('jacket-access-clip',(x,side*1.84,z),(x,side*1.69,z),.027,vertices=4)

    m.rod('forward-steam-pipe',(3.46,0,4.38),(3.46,0,5.39),.069,vertices=8)
    for z in [4.48,5.23]:
        m.rod('forward-pipe-clip',(3.46,0,z),(3.31,0,z),.038,vertices=6)

    # Aft ladder follows the foot into the straight jacket, with repeated saddles.
    ladder(m,'aft-access',[(-3.60,0,2.42),(-3.55,0,5.75),(-2.95,0,6.72)],(0,1,0))
    for z,x,attach in [(2.5,-3.60,-3.35),(3.8,-3.58,-3.35),(5.4,-3.55,-3.35),(6.6,-3.02,-2.96)]:
        for y in [-.23,.23]:
            m.rod('aft-ladder-clip',(x,y,z),(attach+.03,y,z),.031,vertices=4)

    # Six small shoulder fittings, seated along the sloped casing surface.
    for i in range(6):
        a = i*math.tau/6
        p = Vector((3.17*math.cos(a),1.615*math.sin(a),6.43+.06*3.17*math.cos(a)))
        normal = Vector((.30*math.cos(a),.65*math.sin(a),.76)).normalized()
        m.rod('shoulder-flange',p-normal*.085,p+normal*.035,.15,vertices=12)
        m.rod('shoulder-fitting',p,p+normal*.16,.085,mat='painted-edge',vertices=8)
    return m.root
