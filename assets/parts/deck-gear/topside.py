"""Generic, nation-neutral WW2-era topside gear: ready-use locker, signalling
projector, ensign staff, splinter-shield gun tubs, straight splinter plating and
a stowed Carley float.

Original period-inspired shapes authored at fixed metre dimensions, not
reconstructions of a named vessel. Authoring axes are forward/port/up (+X bow,
+Y port, +Z up); the deck sole is Z=0 and nothing goes below it. All parts are
static deck fittings: no joints, no yaw empties.
"""
import sys, math
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'construction'))
from geometry import Model


class Gear(Model):
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

    def rbox(self, name, loc, size, rot=(0,0,0), **kw):
        obj = self.box(name, loc, size, **kw)
        obj.rotation_euler = rot
        return obj

    def tube(self, name, points, radius, closed=False, sides=8, **kw):
        """One continuous capped sweep so curved rails and ropes have no joint gaps."""
        points = [Vector(p) for p in points]
        n = len(points)
        verts = []
        previous_tangent = previous_normal = None
        for i, p in enumerate(points):
            tangent = (points[(i + 1) % n] - points[(i - 1) % n]) if closed else (
                points[min(i + 1, n - 1)] - points[max(0, i - 1)])
            tangent.normalize()
            if previous_tangent is None:
                reference = min((Vector((0,0,1)), Vector((0,1,0)), Vector((1,0,0))), key=lambda a: abs(a.dot(tangent)))
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

    def hoop(self, name, center, u, v, radius, tube=.012, n=16, sides=6, **kw):
        c, u, v = Vector(center), Vector(u).normalized(), Vector(v).normalized()
        return self.tube(name, [c + radius*(u*math.cos(i*math.tau/n)+v*math.sin(i*math.tau/n)) for i in range(n)], tube, closed=True, sides=sides, **kw)

    def lathe(self, name, profile, center=(0,0,0), n=32, **kw):
        c = Vector(center)
        verts=[c+Vector((r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n),z)) for r,z in profile for i in range(n)]
        faces=[tuple(reversed(range(n))),tuple(range((len(profile)-1)*n,len(profile)*n))]
        for k in range(len(profile)-1):
            faces.extend((k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for i in range(n))
        obj = self.mesh(name,verts,faces,smooth=True,**kw)
        obj.data.polygons[0].use_smooth = False
        obj.data.polygons[1].use_smooth = False
        return obj

    def extrude_x(self, name, section, x0, x1, **kw):
        """Closed prism of a (y,z) section extruded along X."""
        n=len(section)
        verts=[(x,y,z) for x in [x0,x1] for y,z in section]
        faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]
        return self.mesh(name,verts,faces,**kw)

    def extrude_y(self, name, section, y0, y1, **kw):
        """Closed prism of an (x,z) section extruded along Y."""
        n=len(section)
        verts=[(x,y,z) for y in [y0,y1] for x,z in section]
        faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]
        return self.mesh(name,verts,faces,**kw)

    def arc_band(self, name, r_in, r_out, lo, hi, a0, a1, n, **kw):
        """Solid annular sector with real thickness and closed ends."""
        rings=[(r_out,lo),(r_out,hi),(r_in,hi),(r_in,lo)]
        verts=[(r*math.cos(a0+(a1-a0)*i/n),r*math.sin(a0+(a1-a0)*i/n),z) for r,z in rings for i in range(n+1)]
        s=n+1
        faces=[(k*s+i,k*s+i+1,((k+1)%4)*s+i+1,((k+1)%4)*s+i) for k in range(4) for i in range(n)]
        faces+=[(0,s,2*s,3*s),(n,3*s+n,2*s+n,s+n)]
        obj=self.mesh(name,verts,faces,**kw)
        for index,face in enumerate(obj.data.polygons):face.use_smooth = index < 4*n and (index//n) in [0,2]
        return obj

    def flange(self, name, radius, thickness=.035, bolts=8, **kw):
        self.cyl(name,(0,0,thickness/2),radius,thickness,mat='edge',vertices=32,**kw)
        for i in range(bolts):
            a=(i+.5)*math.tau/bolts
            self.cyl(name+'.bolt',(radius*.80*math.cos(a),radius*.80*math.sin(a),thickness+.008),.014,.016,vertices=6,mat='dark',**kw)


def create_ammo_locker(part, col, helpers, materials):
    """Ready-use locker, 1.6 m along X, doors facing -Y (starboard)."""
    m=Gear(col,helpers,materials)
    for x in [-.60,.60]:
        m.box('skid',(x,0,.05),(.10,.66,.10),mat='edge')
        for y in [-.27,.27]:m.cyl('skid-bolt',(x,y,.108),.016,.016,vertices=6,mat='dark')
    m.extrude_x('body',[(-.33,.10),(.33,.10),(.33,1.02),(-.33,.92)],-.78,.78)
    m.extrude_x('sloped-lid',[(-.385,.912),(.355,1.024),(.355,1.066),(-.385,.954)],-.81,.81,mat='roof')
    m.extrude_x('lid-front-lip',[(-.385,.880),(-.365,.880),(-.365,.952),(-.385,.952)],-.81,.81,mat='roof')
    # Lid piano hinge along the high (rear) edge and a hasp at the front lip.
    for x in [-.55,0,.55]:
        m.rod('lid-hinge',(x-.11,.352,1.018),(x+.11,.352,1.018),.020,mat='edge',vertices=8)
        m.box('lid-hinge-leaf',(x,.338,.965),(.16,.012,.09),mat='edge')
    m.box('lid-hasp',(0,-.392,.905),(.07,.014,.11),mat='edge')
    m.rod('lid-hasp-staple',(-.02,-.40,.875),(.02,-.40,.875),.010,mat='dark',vertices=6)
    m.tube('lid-handle',[(-.13,-.30,.967),(-.13,-.30,1.005),(.13,-.30,1.005),(.13,-.30,.967)],.011,mat='edge',sides=6)
    # Front door frame and two doors.
    m.box('door-head',(0,-.336,.885),(1.56,.014,.05),mat='edge')
    m.box('door-sill',(0,-.336,.13),(1.56,.014,.05),mat='edge')
    m.box('door-mullion',(0,-.336,.51),(.05,.014,.70),mat='edge')
    for side in [-1,1]:
        x=side*.385
        m.box('door',(x,-.343,.51),(.70,.026,.69),mat='roof')
        m.box('door-panel-swage',(x,-.358,.51),(.56,.006,.55))
        for z in [.30,.72]:
            m.rod('door-hinge-pin',(side*.748,-.362,z-.07),(side*.748,-.362,z+.07),.017,mat='edge',vertices=8)
            m.box('door-hinge-strap',(side*.675,-.359,z),(.15,.008,.05),mat='edge')
        # Dog clips on the meeting edge and the head.
        for z in [.30,.72]:
            m.rod('dog-spindle',(side*.035,-.34,z),(side*.035,-.385,z),.014,mat='dark',vertices=6)
            m.rbox('dog-clip',(side*.075,-.380,z),(.13,.012,.032),(0,side*.35,0),mat='edge')
        m.rod('head-dog-spindle',(x,-.34,.875),(x,-.385,.875),.014,mat='dark',vertices=6)
        m.rbox('head-dog-clip',(x,-.380,.84),(.032,.012,.12),(0,.25,0),mat='edge')
        m.tube('door-handle',[(side*.17,-.358,.46),(side*.17,-.395,.46),(side*.17,-.395,.58),(side*.17,-.358,.58)],.010,mat='edge',sides=6)
        # Lifting eye on each end wall.
        m.box('lifting-pad',(side*.786,0,.80),(.012,.14,.10),mat='edge')
        m.hoop('lifting-eye',(side*.835,0,.80),(1,0,0),(0,0,1),.045,.013,mat='edge')
    m.box('stencil-plate',(-.42,-.3625,.62),(.34,.005,.15),mat='edge')
    m.box('stencil-plate-face',(-.42,-.366,.62),(.31,.003,.12),mat='naval')
    # End-wall stiffening swage.
    for side in [-1,1]:
        m.box('end-swage',(side*.783,0,.45),(.008,.50,.04),mat='edge')
    return m.root


def create_signal_lamp(part, col, helpers, materials):
    """10-12 inch signalling projector on a pedestal, lens facing +X."""
    m=Gear(col,helpers,materials)
    m.flange('base-flange',.20,.035,8)
    m.lathe('pedestal',[(.135,.035),(.115,.09),(.075,.20),(.060,.80),(.085,.88),(.095,.90),(.095,.94)])
    m.cyl('training-head',(0,0,.965),.105,.05,mat='edge',vertices=24)
    m.rod('training-clamp',(0,.10,.965),(0,.17,.965),.014,mat='dark',vertices=6)
    H=1.24
    m.box('yoke-crosspiece',(0,0,1.012),(.11,.52,.045))
    for side in [-1,1]:
        m.extrude_y('yoke-arm',[(-.055,.99),(.055,.99),(.035,H+.05),(-.035,H+.05)],side*.232,side*.262)
        m.rod('trunnion',(0,side*.19,H),(0,side*.285,H),.034,mat='edge',vertices=12)
        m.rod('elevation-clamp',(0,side*.285,H),(0,side*.315,H),.05,mat='dark',vertices=8)
    m.rod('lamp-drum',(-.19,0,H),(.17,0,H),.19,vertices=32)
    m.rod('rear-cone',(-.19,0,H),(-.27,0,H),.19,r2=.10,vertices=32)
    m.rod('rear-cap',(-.27,0,H),(-.29,0,H),.105,mat='edge',vertices=24)
    for x in [-.17,.0]:m.rod('drum-band',(x-.012,0,H),(x+.012,0,H),.196,mat='edge',vertices=32)
    m.rod('front-bezel',(.17,0,H),(.205,0,H),.205,mat='edge',vertices=32)
    m.rod('lens',(.206,0,H),(.211,0,H),.165,mat='dark',vertices=32)
    # Louvred shutter frame in front of the lens.
    f=.185
    for z in [-f,f]:m.box('shutter-frame',(.245,0,H+z),(.075,2*f+.03,.03),mat='edge')
    for y in [-f,f]:m.box('shutter-frame',(.245,y,H),(.075,.03,2*f+.03),mat='edge')
    for i in range(6):
        z=H-f+.035+i*(2*f-.07)/5
        m.rbox('shutter-louvre',(.245,0,z),(.070,2*f,.008),(0,-.55,0),mat='roof')
    m.rod('shutter-link',(.245,-f-.025,H-f+.02),(.245,-f-.025,H+f-.02),.008,mat='dark',vertices=6)
    m.tube('shutter-lever',[(.245,-f-.025,H-.05),(.05,-.235,H-.10),(-.22,-.235,H-.12)],.010,mat='edge',sides=6)
    m.rod('shutter-grip',(-.22,-.235,H-.12),(-.31,-.235,H-.125),.017,mat='dark',vertices=8)
    # Top ventilator and sighting tube.
    m.cyl('vent-neck',(-.09,0,H+.205),.045,.05,vertices=12,mat='edge')
    for x in [-.13,.12]:m.box('sight-bracket',(x,.085,H+.195),(.025,.03,.06),mat='edge')
    m.rod('sighting-tube',(-.20,.085,H+.24),(.17,.085,H+.24),.022,vertices=12)
    m.rod('sight-eyepiece',(-.20,.085,H+.24),(-.235,.085,H+.24),.028,mat='dark',vertices=12)
    m.rod('sight-objective',(.17,.085,H+.24),(.176,.085,H+.24),.017,mat='dark',vertices=12)
    # Training handles at the rear.
    for side in [-1,1]:
        m.tube('training-handle',[(-.17,side*.17,H-.08),(-.30,side*.20,H-.12),(-.40,side*.20,H-.20)],.013,mat='edge',sides=6)
        m.rod('handle-grip',(-.40,side*.20,H-.20),(-.46,side*.20,H-.25),.019,mat='dark',vertices=8)
    m.tube('power-cable',[(-.10,.04,.035),(-.10,.04,.55),(-.12,.03,.95),(-.20,.02,1.08),(-.24,0,H-.06)],.012,mat='dark',sides=6)
    m.box('junction-box',(-.085,.04,.50),(.06,.09,.13),mat='edge')
    return m.root


def create_ensign_staff(part, col, helpers, materials):
    """Stern ensign staff raked aft (-X), braced by two forward struts."""
    m=Gear(col,helpers,materials)
    top=Vector((-.55,0,4.42));foot=Vector((0,0,0))
    def at(z):return foot.lerp(top,z/top.z)
    m.flange('deck-socket-flange',.17,.03,6)
    m.rod('deck-socket',(0,0,.03),at(.36),.075,mat='edge',vertices=16)
    m.rod('socket-collar',at(.36),at(.40),.085,mat='edge',vertices=16)
    m.rod('socket-pin',at(.22)+Vector((0,-.10,0)),at(.22)+Vector((0,.10,0)),.012,mat='dark',vertices=6)
    m.rod('staff',at(.03),top,.048,r2=.022,vertices=16)
    # Truck with sheave cheeks.
    m.rod('truck-disc',top,top+Vector((0,0,.03)),.06,mat='edge',vertices=16)
    m.lathe('truck-ball',[(.0,.03),(.030,.037),(.048,.058),(.052,.082),(.048,.106),(.030,.127),(.0,.134)],top,n=16,mat='bronze')
    # Brace clamp and tripod struts.
    clamp=at(1.55);spreader=[]
    m.rod('brace-clamp',at(1.50),at(1.60),.058,mat='edge',vertices=16)
    for side in [-1,1]:
        deck=Vector((.95,side*.42,0))
        m.box('strut-foot',(deck.x,deck.y,.0125),(.20,.14,.025),mat='edge')
        for dx in [-.06,.06]:m.cyl('strut-foot-bolt',(deck.x+dx,deck.y,.031),.012,.012,vertices=6,mat='dark')
        m.rod('strut-lug',(deck.x,deck.y,.02),(deck.x-.03,deck.y-side*.012,.07),.022,mat='edge',vertices=8)
        lower=Vector((deck.x-.02,deck.y-side*.008,.05));upper=clamp+Vector((.03,side*.035,0))
        m.rod('brace-strut',lower,upper,.021,vertices=10)
        spreader.append(lower.lerp(upper,.30))
    m.rod('strut-spreader',spreader[0],spreader[1],.012,mat='edge',vertices=8)
    # Halyard cleat on the aft face.
    c=at(1.10)
    m.rod('cleat-stem',c+Vector((-.03,0,0)),c+Vector((-.085,0,0)),.013,mat='edge',vertices=8)
    m.rod('cleat-horn',c+Vector((-.085,0,-.085)),c+Vector((-.085,0,.085)),.012,r2=.008,mat='edge',vertices=8)
    m.rod('cleat-horn',c+Vector((-.085,0,.0)),c+Vector((-.085,0,-.085)),.012,r2=.008,mat='edge',vertices=8)
    # Two halyard blocks: one under the truck, one at the gaff-height eye.
    blocks=[]
    for z in [4.30,3.25]:
        p=at(z)
        m.rod('block-band',at(z-.025),at(z+.025),.034 if z>4 else .042,mat='edge',vertices=12)
        eye=p+Vector((-.065,0,0))
        m.rod('block-eye',p,eye,.008,mat='edge',vertices=6)
        b=eye+Vector((-.01,0,-.07))
        m.rod('block-strop',eye,b,.006,mat='dark',vertices=6)
        m.rod('halyard-block',b+Vector((0,-.018,0)),b+Vector((0,.018,0)),.038,mat='bronze',vertices=12)
        m.rod('block-sheave-pin',b+Vector((0,-.024,0)),b+Vector((0,.024,0)),.008,mat='dark',vertices=6)
        blocks.append(b)
    for k,b in enumerate(blocks):
        off=Vector((0,(.012 if k==0 else -.012),0))
        m.rod('halyard',b+Vector((-.03,0,0))+off,c+Vector((-.085,0,.03))+off,.005,mat='dark',vertices=6)
    return m.root


def create_gun_tub(part, col, helpers, materials):
    """Circular splinter-shield tub, open top, no floor, doorway at the rear (-X)."""
    m=Gear(col,helpers,materials)
    large=part['id'].endswith('-large')
    R=2.5 if large else 1.5
    t=.02;wall_top=1.125;rim=.032
    gap=math.asin(.35/R)              # 0.70 m clear doorway
    a0,a1=-math.pi+gap,math.pi-gap
    n=72 if large else 56
    m.arc_band('splinter-wall',R,R+t,0,wall_top,a0,a1,n)
    mid=R+t/2
    m.tube('rolled-rim',[(mid*math.cos(a0+(a1-a0)*i/n),mid*math.sin(a0+(a1-a0)*i/n),wall_top) for i in range(n+1)],rim,sides=8,mat='edge')
    m.arc_band('foot-angle',R+t,R+.10,0,.015,a0,a1,n,mat='edge')
    bolts=round((a1-a0)*(R+.065)/.32)
    for i in range(bolts):
        a=a0+(a1-a0)*(i+.5)/bolts
        m.cyl('foot-bolt',((R+.065)*math.cos(a),(R+.065)*math.sin(a),.022),.014,.014,vertices=6,mat='dark')
    # Door jambs: a flat bar and a rolled post each side of the doorway.
    for a in [a0,a1]:
        p=Vector((mid*math.cos(a),mid*math.sin(a),0))
        m.rod('door-jamb',p,p+Vector((0,0,wall_top)),.030,mat='edge',vertices=10)
        m.cyl('jamb-foot',(p.x,p.y,.0125),.06,.025,vertices=12,mat='edge')
    # External vertical stiffeners with a small toe bracket.
    count=round((a1-a0)*R/.62)
    for i in range(count+1):
        a=a0+(a1-a0)*i/count
        if i in [0,count]:continue
        r=R+t+.03
        m.rbox('stiffener',(r*math.cos(a),r*math.sin(a),wall_top/2-.02),(.06,.012,wall_top-.06),(0,0,a),mat='edge')
        r=R+t+.06+.0005
        m.rbox('stiffener-face',(r*math.cos(a),r*math.sin(a),wall_top/2-.02),(.010,.05,wall_top-.06),(0,0,a),mat='edge')
    # Mid-height external stringer.
    m.arc_band('stringer',R+t,R+t+.035,.60,.612,a0,a1,n,mat='edge')
    # Ready-use clip racks round the inside wall, in four bays.
    for lo,hi in [(-150,-98),(-82,-12),(12,82),(98,150)]:
        b0,b1=math.radians(lo),math.radians(hi)
        seg=max(6,round((b1-b0)*R/.20))
        m.arc_band('rack-shelf',R-.135,R,.52,.545,b0,b1,seg,mat='edge')
        m.arc_band('rack-kick',R-.135,R-.123,.545,.60,b0,b1,seg,mat='edge')
        m.arc_band('rack-rail',R-.135,R-.115,.80,.83,b0,b1,seg,mat='edge')
        clips=round((b1-b0)*(R-.07)/.235)
        for i in range(clips+1):
            a=b0+(b1-b0)*i/clips
            r=R-.0675
            m.rbox('rack-divider',(r*math.cos(a),r*math.sin(a),.69),(.135,.010,.29),(0,0,a),mat='edge')
            rb=R-.125
            m.rod('shelf-bracket',(rb*math.cos(a),rb*math.sin(a),.522),(R*math.cos(a),R*math.sin(a),.36),.010,mat='edge',vertices=6)
            if i<clips:
                a+= (b1-b0)/clips/2
                r=R-.065
                m.rbox('ammunition-clip',(r*math.cos(a),r*math.sin(a),.70),(.085,.165,.31),(0,0,a),mat='bronze')
                m.rbox('clip-charger',(r*math.cos(a),r*math.sin(a),.865),(.095,.175,.02),(0,0,a),mat='dark')
    # Voice-pipe / sound-power phone box on the inside forward wall.
    m.rbox('phone-box',(R-.05,0,.95),(.10,.22,.26),mat='edge')
    m.rod('phone-conduit',(R-.025,0,.0),(R-.025,0,.82),.014,mat='dark',vertices=6)
    return m.root


def create_splinter_shield(part, col, helpers, materials):
    """Straight 3.0 m run of splinter plating along X; stays on the +Y (port) face."""
    m=Gear(col,helpers,materials)
    L=3.0;H=1.2;t=.016;rim=.030
    m.box('plate',(0,0,(H-rim)/2),(L,t,H-rim))
    m.rod('rolled-top',(-L/2,0,H-rim),(L/2,0,H-rim),rim,mat='edge',vertices=12)
    m.box('foot-angle',(0,t/2+.05,.0075),(L,.10,.015),mat='edge')
    m.box('foot-angle-heel',(0,t/2+.006,.05),(L,.012,.10),mat='edge')
    for i in range(10):
        x=-L/2+.15+i*(L-.30)/9
        m.cyl('foot-bolt',(x,t/2+.065,.022),.014,.014,vertices=6,mat='dark')
    for x in [-L/2+.02,L/2-.02]:
        m.box('end-stiffener',(x,t/2+.025,(H-rim)/2),(.012,.05,H-rim-.02),mat='edge')
    m.box('stringer',(0,t/2+.0175,.62),(L-.06,.035,.012),mat='edge')
    for x in [-1.15,0,1.15]:
        y0=t/2
        m.extrude_x('stay-web',[(y0,.015),(y0+.48,.015),(y0+.48,.06),(y0,1.02)],x-.006,x+.006)
        a=Vector((x,y0+.48,.06));b=Vector((x,y0+.004,1.02))
        d=(b-a).normalized();nrm=Vector((0,d.z,-d.y))
        m.rbox('stay-flange',(a+b)/2+nrm*.004,(.06,(b-a).length,.008),(math.atan2(d.z,d.y),0,0),mat='edge')
        m.box('stay-foot',(x,y0+.43,.0225),(.16,.14,.015),mat='edge')
        for dx in [-.055,.055]:m.cyl('stay-bolt',(x+dx,y0+.44,.036),.013,.013,vertices=6,mat='dark')
        m.cyl('lightening-hole',(x,y0+.17,.30),.075,.014,vertices=16,mat='dark').rotation_euler=(0,math.pi/2,0)
    return m.root


def create_carley_float(part, col, helpers, materials):
    """Carley float stowed flat on a low slatted rack; long axis along X."""
    m=Gear(col,helpers,materials)
    r=.17;hl=1.5-r;hw=.75-r;straight=hl-hw
    # Rack: three steel bearers with wooden slats.
    for x in [-1.05,0,1.05]:
        m.box('rack-bearer',(x,0,.05),(.09,1.40,.10),mat='edge')
        for y in [-.62,.62]:m.cyl('rack-bolt',(x,y,.106),.015,.014,vertices=6,mat='dark')
    for y in [-.58,-.29,0,.29,.58]:m.box('rack-slat',(0,y,.1175),(2.84,.10,.035),mat='bronze')
    zc=.135+r
    def stadium(n_end=14,n_side=6,offset=0.0):
        pts=[];rr=hw+offset
        for i in range(n_side):pts.append(Vector((-straight+2*straight*i/n_side,-rr,0)))
        for i in range(n_end):
            a=-math.pi/2+math.pi*i/n_end;pts.append(Vector((straight+rr*math.cos(a),rr*math.sin(a),0)))
        for i in range(n_side):pts.append(Vector((straight-2*straight*i/n_side,rr,0)))
        for i in range(n_end):
            a=math.pi/2+math.pi*i/n_end;pts.append(Vector((-straight+rr*math.cos(a),rr*math.sin(a),0)))
        return pts
    ring=stadium()
    m.tube('float-tube',[p+Vector((0,0,zc)) for p in ring],r,closed=True,sides=14,mat='roof')
    # Canvas seams and webbing bands round the tube, with the grab line becketed between them.
    n=len(ring);bands=[]
    for k in range(0,n,2):
        p=ring[k];tangent=(ring[(k+1)%n]-ring[k-1]).normalized()
        out=Vector((tangent.y,-tangent.x,0))
        m.hoop('web-band',p+Vector((0,0,zc)),out,(0,0,1),r+.006,.011,n=14,sides=5,mat='edge')
        bands.append((p,out))
    for (p,out),(q,out2) in zip(bands,bands[1:]+bands[:1]):
        a=p+out*(r+.012)+Vector((0,0,zc+.02));b=q+out2*(r+.012)+Vector((0,0,zc+.02))
        mid=(a+b)/2+((out+out2).normalized())*.035+Vector((0,0,-.13))
        q1=a.lerp(mid,.5)+Vector((0,0,-.035));q2=mid.lerp(b,.5)+Vector((0,0,-.035))
        m.tube('grab-line',[a,q1,mid,q2,b],.011,sides=5,mat='dark')
    # Slatted grating floor inside the ring, lashed to the tube.
    inner=hw-r
    for y in [-.24,.24]:m.box('grating-stringer',(0,y,.155),(2*straight+.55,.07,.04),mat='bronze')
    xs=[-1.0+i*.20 for i in range(11)]
    for x in xs:
        half=inner+.05 if abs(x)<=straight else max(.12,math.sqrt(max(0,(inner+.05)**2-(abs(x)-straight)**2)))
        m.box('grating-slat',(x,0,.19),(.11,2*half,.03),mat='bronze')
    for x in xs[1::3]:
        for side in [-1,1]:
            m.rod('grating-lashing',(x,side*(inner-.02),.205),(x,side*(hw-.06),zc+.10),.008,mat='dark',vertices=5)
    # Two paddles lashed on the grating.
    for side in [-1,1]:
        y=side*.13
        m.rod('paddle-shaft',(-.95,y,.228),(.45,y,.228),.019,mat='bronze',vertices=8)
        m.rod('paddle-grip',(-.97,y-.05,.228),(-.97,y+.05,.228),.017,mat='bronze',vertices=8)
        m.box('paddle-blade',(.68,y,.222),(.50,.15,.022),mat='bronze')
        for x in [-.60,.20]:m.hoop('paddle-lashing',(x,y,.222),(0,1,0),(0,0,1),.030,.007,n=10,sides=5,mat='dark')
    # Gripes holding the float down to the rack.
    for x in [-.78,.78]:
        pts=[(x,-.70,.10),(x,-.765,.20),(x,-.76,zc+.06),(x,-.66,zc+r-.02),(x,-hw,zc+r+.008),(x,hw,zc+r+.008),(x,.66,zc+r-.02),(x,.76,zc+.06),(x,.765,.20),(x,.70,.10)]
        m.tube('gripe',pts,.012,sides=5,mat='dark')
        m.box('gripe-slip',(x,0,zc+r+.02),(.05,.09,.025),mat='edge')
    return m.root
