"""Original generic naval deck fittings, authored at fixed metre dimensions.

These are conventional period-inspired engineering shapes, not reconstructions
of a named vessel or manufacturer. The catalog declares provisional package
masses. Authoring axes are forward/port/up; the shared exporter converts once to
starboard/up/aft. Deck soles are Z=0; wall fittings attach at X=0 and project +X.
All mechanisms are in their supported stowed pose. In particular the searchlight
has no light source, emissive material, aiming joint or runtime capability.
"""
import math
import bpy
from mathutils import Vector
from geometry import Model


class Fitting(Model):
    def __init__(self, col, helpers, materials):
        super().__init__(col, helpers, materials)

    def cyl(self, name, loc, r, depth, **kw):
        obj = super().cyl(name, loc, r, depth, **kw)
        if kw.get('vertices', 32) >= 16:
            for face in obj.data.polygons:face.use_smooth = len(face.vertices) == 4
        return obj

    def rod(self, name, a, b, r, **kw):
        obj = super().rod(name, a, b, r, **kw)
        if kw.get('vertices', 12) >= 16:
            for face in obj.data.polygons:face.use_smooth = len(face.vertices) == 4
        return obj

    def pipe(self, name, outer, inner, lo, hi, **kw):
        rings=[(outer,lo),(outer,hi),(inner,hi),(inner,lo)]; n=40
        obj=self.mesh(name,[(r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n),z) for r,z in rings for i in range(n)],
                      [(k*n+i,k*n+(i+1)%n,((k+1)%4)*n+(i+1)%n,((k+1)%4)*n+i) for k in range(4) for i in range(n)],**kw)
        for index,face in enumerate(obj.data.polygons):face.use_smooth = index//n in [0,2]
        return obj

    def tube(self, name, points, radius, closed=False, **kw):
        """One continuous, capped sweep, so curved rails have no joint gaps."""
        points = [Vector(p) for p in points]
        n, sides = len(points), 10
        verts = []
        previous_tangent = previous_normal = None
        for i, p in enumerate(points):
            tangent = (points[(i + 1) % n] - points[(i - 1) % n]) if closed else (
                points[min(i + 1, n - 1)] - points[max(0, i - 1)])
            tangent.normalize()
            if previous_tangent is None:
                reference = min((Vector((1,0,0)), Vector((0,1,0)), Vector((0,0,1))), key=lambda a: abs(a.dot(tangent)))
                normal = tangent.cross(reference).normalized()
            else:
                normal = previous_tangent.rotation_difference(tangent) @ previous_normal
                normal = (normal - tangent * normal.dot(tangent)).normalized()
            other = tangent.cross(normal).normalized()
            previous_tangent, previous_normal = tangent.copy(), normal.copy()
            for j in range(sides):
                angle = math.tau * j / sides
                verts.append(p + radius * (normal * math.cos(angle) + other * math.sin(angle)))
        faces = []
        for i in range(n if closed else n - 1):
            k = (i + 1) % n
            faces.extend((i*sides+j, i*sides+(j+1)%sides, k*sides+(j+1)%sides, k*sides+j) for j in range(sides))
        if not closed:
            faces += [tuple(reversed(range(sides))), tuple(range((n-1)*sides, n*sides))]
        return self.mesh(name, verts, faces, smooth=True, **kw)

    def ring(self, name, center, radius, tube=.018, axis='z', **kw):
        c = Vector(center)
        axes = {'x': ((0,1,0),(0,0,1)), 'y': ((1,0,0),(0,0,1)), 'z': ((1,0,0),(0,1,0))}
        u, v = map(Vector, axes[axis])
        return self.tube(name, [c + radius*(u*math.cos(i*math.tau/40)+v*math.sin(i*math.tau/40)) for i in range(40)], tube, closed=True, **kw)

    def wheel(self, name, center, radius, axis='x', **kw):
        self.ring(name+'.rim', center, radius, .014, axis, mat='edge', **kw)
        c = Vector(center)
        axes = {'x': ((0,1,0),(0,0,1)), 'y': ((1,0,0),(0,0,1)), 'z': ((1,0,0),(0,1,0))}
        u, v = map(Vector, axes[axis])
        for i in range(4):
            a=i*math.tau/4
            self.rod(name+'.spoke-'+str(i), c, c+radius*(u*math.cos(a)+v*math.sin(a)), .011, mat='edge', **kw)

    def lathe(self, name, profile, center=(0,0,0), **kw):
        n=48; c=Vector(center)
        verts=[c+Vector((r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n),z)) for r,z in profile for i in range(n)]
        faces=[tuple(reversed(range(n))),tuple(range((len(profile)-1)*n,len(profile)*n))]
        for k in range(len(profile)-1):
            faces.extend((k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for i in range(n))
        obj = self.mesh(name,verts,faces,smooth=True,**kw)
        obj.data.polygons[0].use_smooth = False
        obj.data.polygons[1].use_smooth = False
        return obj

    def foot(self, name, x, y, length, width, height=.055, **kw):
        self.box(name, (x,y,height/2), (length,width,height), mat='edge', **kw)
        for a in [-1,1]:
            for b in [-1,1]:
                self.cyl(name+'.bolt', (x+a*(length/2-.05),y+b*(width/2-.05),height+.013), .017,.026,vertices=6,mat='bright',**kw)

    def flange(self, name, radius, z, **kw):
        self.cyl(name,(0,0,z+.022),radius,.044,mat='edge',vertices=48,**kw)
        for i in range(8):
            a=i*math.tau/8
            self.cyl(name+'.bolt',(radius*.79*math.cos(a),radius*.79*math.sin(a),z+.052),.018,.018,vertices=6,mat='bright',**kw)


def create_twin_bitts(part, col, helpers, materials):
    m=Fitting(col,helpers,materials)
    m.foot('bedplate',0,0,.70,1.56,.075)
    for side in [-1,1]:
        y=side*.46
        m.lathe('bitt-'+str(side),[(.21,.075),(.18,.14),(.155,.23),(.155,.58),(.205,.63),(.205,.68),(.17,.71)],(0,y,0))
        for sign in [-1,1]:
            m.mesh('bitt-gusset',[(sign*x,y+offset,z) for offset in [-.045,.045] for x,z in [(.10,.08),(.29,.08),(.10,.30)]],
                   [(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)],mat='edge')
    return m.root


def create_fairlead(part, col, helpers, materials):
    m=Fitting(col,helpers,materials)
    m.foot('base',0,0,.58,1.03,.06)
    for side in [-1,1]:
        y=side*.36
        for x in [-.17,.17]:m.box('bearing-cheek',(x,y,.25),(.055,.23,.38))
        m.cyl('vertical-roller',(0,y,.25),.092,.32,mat='bright',vertices=32)
        m.cyl('roller-cap',(0,y,.432),.11,.035,mat='edge',vertices=32)
    m.rod('lower-roller',(0,-.30,.145),(0,.30,.145),.072,mat='bright',vertices=32)
    m.rod('roller-shaft',(0,-.47,.145),(0,.47,.145),.028,mat='edge')
    return m.root


def create_capstan(part, col, helpers, materials):
    m=Fitting(col,helpers,materials)
    m.flange('deck-flange',.39,0)
    m.lathe('warping-head',[(.28,.05),(.30,.14),(.31,.23),(.24,.34),(.205,.51),(.22,.72),(.29,.85),(.31,.91),(.29,.965)])
    m.cyl('top-plate',(0,0,.97),.29,.04,mat='edge',vertices=48)
    m.cyl('grease-cap',(0,0,.994),.045,.012,mat='bright',vertices=12)
    for i in range(6):
        a=i*math.tau/6
        m.box('bar-socket',(.20*math.cos(a),.20*math.sin(a),.985),(.065,.045,.025),mat='dark')
    return m.root


def create_anchor_windlass(part, col, helpers, materials):
    m=Fitting(col,helpers,materials)
    m.foot('foundation',0,0,1.26,1.95,.07)
    for y in [-.69,.69]:
        m.box('bearing-pedestal',(-.04,y,.29),(.48,.17,.44))
        m.rod('bearing',(-.04,y-.12,.59),(-.04,y+.12,.59),.15,mat='edge',vertices=32)
    m.rod('main-shaft',(-.04,-.93,.59),(-.04,.93,.59),.075,mat='bright',vertices=24)
    for y in [-.40,.40]:
        m.rod('chain-drum',(-.04,y-.13,.59),(-.04,y+.13,.59),.235,vertices=40)
        for offset in [-.14,.14]:
            m.rod('gypsy-flange',(-.04,y+offset-.018,.59),(-.04,y+offset+.018,.59),.29,mat='edge',vertices=40)
        for i in range(10):
            a=i*math.tau/10
            m.rod('chain-pocket',(-.04+.244*math.cos(a),y-.10,.59+.244*math.sin(a)),(-.04+.244*math.cos(a),y+.10,.59+.244*math.sin(a)),.026,mat='bright')
        m.box('chain-guide',(.43,y,.15),(.30,.28,.16),mat='edge')
        m.rod('guide-roller',(.39,y-.14,.245),(.39,y+.14,.245),.05,mat='bright')
    m.box('gearbox',(-.35,0,.41),(.48,.33,.65))
    m.box('gearbox-cover',(-.35,0,.765),(.50,.35,.065),mat='edge')
    m.cyl('drive-housing',(-.37,0,.80),.135,.08,vertices=24)
    m.rod('brake-standard',(-.42,.70,.07),(-.42,.70,.95),.03)
    m.wheel('brake-wheel',(-.42,.70,.95),.14,axis='z')
    m.rod('brake-linkage',(-.42,.70,.46),(-.04,.40,.48),.025,mat='edge')
    return m.root


def create_stowed_anchor(part, col, helpers, materials):
    m=Fitting(col,helpers,materials)
    # The rear faces of these pads are the actual wall attachment datum X=0.
    for z in [.32,1.45,1.94]:
        m.box('wall-pad',(.035,0,z),(.07,.50,.16),mat='edge')
        for y in [-.18,.18]:m.rod('wall-bolt',(0,y,z),(.085,y,z),.023,vertices=6,mat='bright')
        m.box('stowage-stand-off',(.115,0,z),(.10,.13,.11))
    m.box('shank',(.225,0,1.22),(.14,.15,1.65),mat='edge')
    m.rod('crown',(.22,-.47,.45),(.22,.47,.45),.095,mat='edge',vertices=24)
    for side in [-1,1]:
        m.tube('arm',[(.22,0,.46),(.22,side*.38,.20),(.22,side*.66,.36),(.22,side*.78,.79)],.072,mat='edge')
        # Broad tapered flukes remain a closed, visibly thick casting.
        vs=[(.13,side*.55,.47),(.34,side*.55,.47),(.34,side*.81,.92),(.13,side*.81,.92),(.16,side*.39,.90),(.31,side*.39,.90)]
        m.mesh('fluke',vs,[(0,1,2,3),(0,4,5,1),(0,3,4),(1,5,2),(3,2,5,4)],mat='edge')
    m.ring('shackle',(.225,0,2.09),.13,.025,axis='x',mat='bright')
    m.rod('shackle-pin',(.15,-.14,2.01),(.15,.14,2.01),.034,mat='edge')
    for z in [.65,1.47]:m.rod('retaining-strap',(.31,-.17,z),(.31,.17,z),.027,mat='bright')
    return m.root


def create_lifeboat_davits(part, col, helpers, materials):
    m=Fitting(col,helpers,materials)
    stations=[(-2.72,.04,.94,1.65),(-2.25,.56,.69,1.52),(-1.50,.84,.61,1.48),(0,.92,.58,1.47),(1.50,.80,.65,1.50),(2.30,.43,.88,1.63),(2.85,.02,1.27,1.72)]
    cross=[(-1,1),(-.85,.55),(-.60,.20),(-.25,.04),(0,0),(.25,.04),(.60,.20),(.85,.55),(1,1)]
    verts=[]
    for inside in [False,True]:
        for x,w,keel,sheer in stations:
            for y,t in cross:
                verts.append((x,y*w*(.94 if inside else 1),keel+(sheer-keel)*t+(.05*(1-t) if inside else 0)))
    n=len(cross); rows=len(stations); stride=n*rows; faces=[]
    for k in range(rows-1):
        for j in range(n-1):
            a=k*n+j
            faces.extend([(a,a+n,a+n+1,a+1),(stride+a,stride+a+1,stride+a+n+1,stride+a+n)])
        for j in [0,n-1]:
            a=k*n+j;faces.append((a,stride+a,stride+a+n,a+n))
    for k in [0,rows-1]:
        faces.extend((k*n+j,k*n+j+1,stride+k*n+j+1,stride+k*n+j) for j in range(n-1))
    m.mesh('open-boat-hull',verts,faces,smooth=True)
    for side in [-1,1]:
        m.tube('gunwale',[(x,side*w,sheer) for x,w,keel,sheer in stations],.038,mat='edge')
    m.tube('keel',[(x,0,keel) for x,w,keel,sheer in stations],.055,mat='edge')
    def inside_half_width(x, z):
        for a, b in zip(stations, stations[1:]):
            if a[0] <= x <= b[0]:
                t=(x-a[0])/(b[0]-a[0])
                w,keel,sheer=[a[k]+(b[k]-a[k])*t for k in [1,2,3]]
                level=(z-keel-.05)/(sheer-keel-.05)
                for (u,lo),(v,hi) in zip(cross[4:],cross[5:]):
                    if lo <= level <= hi:
                        return .94*w*(u+(v-u)*(level-lo)/(hi-lo))
        raise ValueError('Boat furniture outside the authored inner hull')
    for x,z in [(-1.65,1.17),(-.75,1.12),(.30,1.13),(1.30,1.18)]:
        width=2*min(inside_half_width(x+dx,z-.0375) for dx in [-.125,.125])
        m.box('thwart',(x,0,z),(.25,width,.075),mat='wood')
        for side in [-1,1]:
            m.rod('seat-knee',(x,side*width*.39,z-.035),(x,side*(inside_half_width(x,z-.25)-.012),z-.25),.026,mat='wood')
    for y in [-.219,-.073,.073,.219]:m.box('floorboard',(-.10,y,.755),(2.25,.135,.045),mat='wood')
    for x in [-.85,.75]:
        m.box('floor-keel-block',(x,0,.685),(.075,.12,.095),mat='wood')
        m.box('floor-bearer',(x,0,.720),(.075,.50,.025),mat='wood')
    for x in [-1.50,1.50]:
        m.foot('cradle-foot',x,0,.32,1.97,.065)
        # Shaped knees meet the hull on both sides, supported by a deck crossbeam.
        m.box('cradle-keel-block',(x,0,.32),(.24,.29,.54),mat='wood')
        for side in [-1,1]:
            m.rod('cradle-brace',(x,side*.85,.065),(x,side*.53,.86),.075,mat='edge')
            m.rod('cradle-pad',(x-.11,side*.53,.86),(x+.11,side*.53,.86),.070,mat='wood')
    for x in [-2.05,2.05]:
        m.foot('davit-foundation',x,1.07,.62,.62,.09)
        m.cyl('davit-socket',(x,1.07,.25),.17,.32,mat='edge')
        m.tube('davit-arm',[(x,1.07,.23),(x,1.07,2.28),(x,1.03,2.70),(x,.89,3.03),(x,.63,3.23),(x,.28,3.29),(x,0,3.22)],.10)
        for side in [-1,1]:m.rod('davit-knee',(x+side*.23,1.07,.10),(x,1.07,.79),.052,mat='edge')
        m.rod('head-sheave',(x-.075,0,3.15),(x+.075,0,3.15),.14,mat='edge',vertices=32)
        m.rod('lower-block',(x-.04,0,1.67),(x+.04,0,1.67),.10,mat='wood',vertices=24)
        for y in [-.05,.05]:m.rod('fall',(x,y,1.67),(x,y,3.15),.016,mat='rope')
        m.ring('lifting-eye',(x,0,1.51),.065,.018,axis='x',mat='bright')
        for side in [-1,1]:m.rod('lifting-bridle',(x,0,1.51),(x,side*.54,1.35),.024,mat='bright')
        m.rod('winch-drum',(x-.13,1.08,.74),(x+.13,1.08,.74),.13,mat='edge',vertices=24)
        m.rod('winch-bracket',(x,1.07,.48),(x,1.08,.74),.065)
        m.rod('winch-crank',(x+.15,1.08,.74),(x+.15,1.08,.98),.022,mat='bright')
        m.rod('winch-handle',(x+.15,1.08,.98),(x+.27,1.08,.98),.03,mat='wood')
        m.tube('fall-return',[(x,.11,3.14),(x,.87,2.94),(x,1.10,.76)],.016,mat='rope')
    # Oars are clipped to the thwarts rather than floating beside the hull.
    for side in [-1,1]:
        m.rod('stowed-oar',(-1.75,side*.43,1.24),(1.72,side*.43,1.29),.026,mat='wood')
        m.box('oar-blade',(1.60,side*.43,1.29),(.49,.14,.035),mat='wood')
        for x in [-.75,1.3]:m.ring('oar-lashing',(x,side*.43,1.23),.055,.008,axis='x',mat='rope')
    return m.root


def create_mushroom_vent(part, col, helpers, materials):
    m=Fitting(col,helpers,materials)
    m.flange('foot-flange',.25,0)
    m.cyl('neck',(0,0,.34),.17,.60,vertices=40)
    m.cyl('vent-shadow',(0,0,.665),.27,.15,mat='dark',vertices=40)
    for i in range(6):
        a=i*math.tau/6
        m.rod('cap-support',(.23*math.cos(a),.23*math.sin(a),.60),(.23*math.cos(a),.23*math.sin(a),.79),.018,mat='edge')
    m.lathe('rain-cap',[(.345,.745),(.345,.78),(.30,.817),(.18,.843),(.015,.85)])
    m.cyl('lower-lip',(0,0,.598),.28,.035,vertices=40,mat='edge')
    return m.root


def create_cowl_vent(part, col, helpers, materials):
    m=Fitting(col,helpers,materials)
    m.flange('foot-flange',.29,0)
    m.pipe('hollow-trunk',.235,.20,.05,1.10)
    m.pipe('turning-collar',.25,.20,.765,.835,mat='edge')
    # Swept hollow elbow: rear centerline vertical, open mouth faces forward.
    points=[]
    for i in range(13):
        a=i*math.pi/24
        points.append(Vector((.28*(1-math.cos(a)),0,1.10+.28*math.sin(a))))
    n=40;verts=[]
    for inside in [False,True]:
        for i,p in enumerate(points):
            a=i*math.pi/24;u=Vector((0,1,0));v=Vector((math.cos(a),0,-math.sin(a)))
            radius=.235+.10*i/(len(points)-1)-(.035 if inside else 0)
            verts.extend(p+radius*(u*math.cos(j*math.tau/n)+v*math.sin(j*math.tau/n)) for j in range(n))
    stride=len(points)*n;faces=[]
    for k in range(len(points)-1):
        for j in range(n):
            a=k*n+j;b=k*n+(j+1)%n
            faces.extend([(a,b,b+n,a+n),(stride+a,stride+a+n,stride+b+n,stride+b)])
    for k in [0,len(points)-1]:
        faces.extend((k*n+j,k*n+(j+1)%n,stride+k*n+(j+1)%n,stride+k*n+j) for j in range(n))
    m.mesh('hollow-cowl',verts,faces,smooth=True)
    m.ring('mouth-rim',(.28,0,1.38),.321,.025,axis='x',mat='edge')
    m.rod('turning-handle',(-.13,-.18,.80),(-.35,-.29,.80),.02,mat='bright')
    return m.root


def create_watertight_door(part, col, helpers, materials):
    m=Fitting(col,helpers,materials)
    # Rounded rectangular raised surround, closed leaf, six compression dogs.
    outline=[(-.34,.04),(.34,.04),(.44,.14),(.44,1.98),(.34,2.08),(-.34,2.08),(-.44,1.98),(-.44,.14)]
    m.mesh('wall-flange',[(x,y,z) for x in [0,.055] for y,z in outline],
           [tuple(reversed(range(8))),tuple(range(8,16))]+[(i,(i+1)%8,8+(i+1)%8,8+i) for i in range(8)])
    inner=[(y*.89,1.06+(z-1.06)*.96) for y,z in outline]
    m.mesh('door-leaf',[(x,y,z) for x in [.054,.10] for y,z in inner],
           [tuple(reversed(range(8))),tuple(range(8,16))]+[(i,(i+1)%8,8+(i+1)%8,8+i) for i in range(8)],mat='roof')
    m.tube('rubber-seal',[(.103,y,z) for y,z in inner],.012,closed=True,mat='dark')
    for y in [-.365,.365]:
        for z in [.36,1.06,1.76]:
            m.rod('dog-spindle',(.10,y,z),(.15,y,z),.022,mat='bright')
            m.rod('dog-handle',(.145,y-.075,z-.03),(.145,y+.075,z+.03),.018,mat='edge')
    for z in [.44,1.62]:
        m.box('hinge-leaf',(.12,-.38,z),(.045,.11,.10),mat='edge')
        m.rod('hinge-pin',(.125,-.42,z-.09),(.125,-.42,z+.09),.026,mat='bright')
    m.rod('wheel-shaft',(.10,0,1.04),(.175,0,1.04),.025,mat='bright')
    m.wheel('handwheel',(.182,0,1.04),.17)
    m.box('threshold',(.06,0,.025),(.12,.75,.05),mat='edge')
    return m.root


def create_deck_hatch(part, col, helpers, materials):
    m=Fitting(col,helpers,materials)
    m.box('coaming',(0,0,.10),(1.16,.96,.20),mat='edge')
    m.box('lid',(0,0,.224),(1.12,.92,.075))
    for x in [-.44,.44]:
        m.box('hinge-strap',(x,.37,.25),(.11,.18,.03),mat='edge')
        m.rod('hinge-pin',(x-.08,.43,.25),(x+.08,.43,.25),.025,mat='bright')
        m.rod('lid-dog',(x,-.42,.266),(x,-.25,.266),.012,mat='edge')
    for y in [-.10,.10]:m.rod('handle-foot',(-.12,y,.26),(-.12,y,.275),.012,mat='bright')
    m.rod('lifting-handle',(-.12,-.10,.275),(-.12,.10,.275),.012,mat='bright')
    return m.root


def create_optical_rangefinder(part, col, helpers, materials):
    m=Fitting(col,helpers,materials)
    m.flange('pedestal-foot',.37,0)
    m.lathe('pedestal',[(.245,.05),(.21,.16),(.125,.83),(.16,.98)])
    m.cyl('training-race',(0,0,1.005),.19,.075,mat='edge',vertices=40)
    yaw=m.empty('yaw',(0,0,1.04),m.root)
    m.cyl('supported-training-spindle',(0,0,1.115),.13,.145,mat='edge',parent=yaw)
    m.box('optical-head',(0,0,1.32),(.38,.43,.38),parent=yaw)
    m.rod('optical-bar',(0,-.94,1.40),(0,.94,1.40),.105,vertices=32,parent=yaw)
    for side in [-1,1]:
        y=side*.94
        m.box('end-hood',(.015,y,1.42),(.31,.22,.30),parent=yaw)
        m.rod('objective-bezel',(.16,y,1.43),(.20,y,1.43),.085,mat='edge',vertices=32,parent=yaw)
        m.rod('objective-glass',(.20,y,1.43),(.204,y,1.43),.07,mat='glass',vertices=32,parent=yaw)
        m.rod('bar-clamp',(0,side*.29,1.40),(0,side*.35,1.40),.123,mat='edge',vertices=24,parent=yaw)
        m.rod('eyepiece',(-.19,side*.065,1.37),(-.29,side*.065,1.37),.035,mat='dark',parent=yaw)
    m.rod('elevation-wheel-shaft',(-.08,-.215,1.21),(-.08,-.28,1.21),.025,mat='bright',parent=yaw)
    m.wheel('elevation-wheel',(-.08,-.29,1.21),.12,axis='y',parent=yaw)
    m.rod('training-handle',(-.17,.11,1.08),(-.32,.11,1.08),.025,mat='edge',parent=yaw)
    m.rod('training-grip',(-.32,.11,1.08),(-.32,.11,1.23),.027,mat='dark',parent=yaw)
    return m.root


def create_static_searchlight(part, col, helpers, materials):
    m=Fitting(col,helpers,materials)
    m.flange('deck-foot',.34,0)
    m.lathe('pedestal',[(.235,.05),(.19,.14),(.135,.61),(.22,.72)])
    m.cyl('fixed-training-ring',(0,0,.755),.245,.075,mat='edge',vertices=40)
    m.box('yoke-crosspiece',(0,0,.81),(.17,.91,.08))
    for side in [-1,1]:
        m.box('yoke-arm',(0,side*.43,1.05),(.13,.07,.47))
        m.rod('fixed-trunnion',(0,side*.36,1.29),(0,side*.48,1.29),.076,mat='edge',vertices=24)
    # Closed backing and deep front recess; ordinary reflective PBR, no emission.
    m.rod('lamp-drum',(-.33,0,1.29),(.27,0,1.29),.39,vertices=48)
    m.rod('rear-cover',(-.37,0,1.29),(-.33,0,1.29),.34,mat='edge',vertices=48)
    m.rod('front-dark-recess',(.272,0,1.29),(.28,0,1.29),.35,mat='dark',vertices=48)
    m.rod('reflector',(.283,0,1.29),(.288,0,1.29),.325,mat='bright',vertices=48)
    m.rod('unlit-front-lens',(.291,0,1.29),(.295,0,1.29),.29,mat='glass',vertices=48)
    m.ring('front-bezel',(.29,0,1.29),.369,.028,axis='x',mat='edge')
    for i in range(8):
        a=i*math.tau/8
        m.rod('bezel-dog',(.27,.365*math.cos(a),1.29+.365*math.sin(a)),(.325,.365*math.cos(a),1.29+.365*math.sin(a)),.017,vertices=6,mat='bright')
    for z in [1.14,1.29,1.44]:m.box('rear-louvre',(-.39,0,z),(.04,.32,.035),mat='dark')
    m.rod('handwheel-shaft',(0,-.48,1.15),(0,-.515,1.15),.02,mat='bright')
    m.wheel('fixed-handwheel',(0,-.52,1.15),.11,axis='y')
    m.tube('power-conduit',[(-.18,0,.05),(-.18,0,.62),(-.24,0,.80),(-.24,0,1.01)],.018,mat='dark')
    m.box('switchbox',(-.21,0,.57),(.10,.15,.20),mat='edge')
    return m.root


def create_vertical_ladder(part, col, helpers, materials):
    m=Fitting(col,helpers,materials)
    for y in [-.27,.27]:
        m.box('side-rail',(.235,y,1.5),(.045,.045,3.0))
        for z in [.18,1.49,2.82]:
            m.box('wall-pad',(.018,y,z),(.036,.10,.15),mat='edge')
            m.box('wall-bracket',(.125,y,z),(.215,.035,.07))
            m.rod('pad-bolt',(0,y,z),(.05,y,z),.015,mat='bright',vertices=6)
    for i in range(10):
        z=.15+i*.30
        m.rod('rung',( .255,-.29,z),(.255,.29,z),.021,mat='edge')
    return m.root


def create_inclined_stairs(part, col, helpers, materials):
    m=Fitting(col,helpers,materials)
    for side in [-1,1]:
        y=side*.365
        m.foot('lower-foot',-1.00,y,.26,.16,.055)
        # Deep channel stringers and rear landing legs support every tread.
        vs=[(-1.10,y-.025,.06),(-1.10,y+.025,.06),(1.03,y+.025,1.98),(1.03,y-.025,1.98),(-1.10,y-.025,.20),(-1.10,y+.025,.20),(1.03,y+.025,2.12),(1.03,y-.025,2.12)]
        m.mesh('stringer',vs,[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],mat='edge')
        m.box('landing-leg',(1.02,y,1.0),(.065,.065,2.0),mat='edge')
        m.foot('landing-foot',1.02,y,.24,.16,.055)
        for i in [0,3,6,9]:
            x=-1.00+i*.218;z=.20+i*.204
            m.rod('handrail-stanchion',(x,y,z),(x,y,z+.82),.021)
        m.tube('handrail',[(-1.10,y,.92),(-1.00,y,1.02),(.962,y,2.856),(1.12,y,2.856)],.025)
        m.rod('midrail',(-1.00,y,.63),(.962,y,2.466),.014)
    for i in range(10):
        x=-1.00+i*.218;z=.20+i*.204
        m.box('tread',(x,0,z),(.24,.73,.055))
        for dx in [-.072,0,.072]:m.rod('nonslip-rib',(x+dx,-.335,z+.031),(x+dx,.335,z+.031),.006,mat='edge')
    return m.root
