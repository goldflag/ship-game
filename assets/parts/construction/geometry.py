"""Original fixed equipment packages for construction.

Fletcher fittings are source adaptations of assets/ships/fletcher/build.py,
normalized to an installation datum; no installed model is imported. Machinery
and magazines are explicitly generic engineering packages, not reconstructions.
"""
import math
import bpy
from mathutils import Vector


class Model:
    def __init__(self, col, helpers, materials):
        self.col, self.h, self.m = col, helpers, materials
        self.root = self.empty('root', (0, 0, 0))

    def empty(self, name, loc, parent=None):
        o = bpy.data.objects.new('component.' + name, None)
        self.col.objects.link(o)
        o.location = loc
        o['nodeId'] = 'component.' + name
        o['assemblyId'] = 'component'
        if parent: self.attach(o, parent)
        return o

    def attach(self, o, parent):
        bpy.context.view_layer.update()
        matrix = o.matrix_world.copy()
        o.parent = parent
        o.matrix_world = matrix
        return o

    def part(self, kind, name, *args, mat='naval', parent=None, **kwargs):
        o = self.h[kind]('component.' + name, *args, self.m[mat], self.col, **kwargs)
        o['assemblyId'] = 'component'
        return self.attach(o, parent or self.root)

    def box(self, name, loc, size, **kw): return self.part('box', name, loc, size, **kw)
    def cyl(self, name, loc, r, depth, **kw): return self.part('cyl', name, loc, r, depth, **kw)
    def rod(self, name, a, b, r, **kw): return self.part('rod', name, a, b, r, **kw)
    def mesh(self, name, vs, fs, **kw): return self.part('mesh', name, vs, fs, **kw)

    def path(self, name, points, r, closed=False, **kw):
        points = list(points)
        for a, b in zip(points, points[1:] + ([points[0]] if closed else [])):
            self.rod(name, a, b, r, **kw)

    def prism(self, name, outline, lo, hi, **kw):
        n = len(outline)
        return self.mesh(name, [(x,y,z) for z in [lo,hi] for x,y in outline],
                         [tuple(reversed(range(n))), tuple(range(n,2*n))] +
                         [(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)], **kw)

    def ladder(self, name, a, b, width, **kw):
        a,b = Vector(a),Vector(b)
        for sign in [-1,1]: self.rod(name+'.rail',a+Vector((0,sign*width/2,0)),b+Vector((0,sign*width/2,0)),.025,**kw)
        steps = max(1, math.ceil((b-a).length/.30))
        for i in range(steps+1):
            p=a.lerp(b,i/steps)
            self.rod(name+'.rung',p+Vector((0,-width/2,0)),p+Vector((0,width/2,0)),.018,**kw)

    def bolts(self, radius, z, count=12, **kw):
        for i in range(count):
            a=i*math.tau/count
            self.cyl('bolt',(radius*math.cos(a),radius*math.sin(a),z),.035,.055,mat='edge',vertices=6,**kw)


def create_torpedo_launcher(part, col, helpers, materials):
    m=Model(col,helpers,materials)
    m.cyl('fixed-race',(0,0,.08),1.43,.36,mat='edge',vertices=64)
    m.bolts(1.29,.28,24)
    yaw=m.empty('yaw',(0,0,0),m.root)
    outline=[(-3.25,-1.56),(-2.95,-1.86),(2.95,-1.86),(3.25,-1.56),(3.25,1.56),(2.95,1.86),(-2.95,1.86),(-3.25,1.56)]
    m.prism('training-platform',outline,.28,.45,mat='roof',parent=yaw)
    for x in [-2.25,0,2.25]:m.box('saddle',(x,0,.64),(.23,3.32,.36),mat='edge',parent=yaw)
    for i,offset in enumerate(part['tubeOffsets']):
        # Public catalog offsets are runtime X/Y/Z; original recipes use forward/port/up.
        end=Vector((-offset[2],-offset[0],offset[1]));rear=end-Vector((7.1,0,0))
        m.rod('launch-tube',rear,end,.315,parent=yaw,vertices=32)
        m.rod('breech',rear-Vector((.085,0,0)),rear+Vector((.05,0,0)),.345,mat='edge',parent=yaw,vertices=32)
        m.rod('door',rear-Vector((.10,0,0)),rear-Vector((.115,0,0)),.29,parent=yaw,vertices=24)
        m.rod('mouth',end+Vector((.002,0,0)),end+Vector((.018,0,0)),.279,mat='dark',parent=yaw,vertices=32)
        for x in [.12,1.5,3.1,4.8,6.7]:
            p=end-Vector((x,0,0));m.rod('tube-band',p-Vector((.04,0,0)),p+Vector((.04,0,0)),.336,mat='edge',parent=yaw,vertices=24)
        m.rod('guide-rail',rear+Vector((.2,0,.31)),end+Vector((-.25,0,.31)),.026,mat='edge',parent=yaw,vertices=8)
        m.rod('air-line',rear+Vector((.3,.29,.16)),end+Vector((-1,.29,.16)),.025,mat='edge',parent=yaw,vertices=8)
        for x in [-2.9,-1.4,0,1.4,2.9]:m.box('tube-bracket',(x,end.y,end.z+.34),(.12,.29,.09),parent=yaw)
        m.empty('tube-'+str(i+1)+'.muzzle',end,yaw)
    m.cyl('trainer-cabin',(-2.35,0,1.72),.62,1.5,parent=yaw,vertices=32)
    m.cyl('trainer-roof',(-2.35,0,2.51),.65,.075,mat='roof',parent=yaw,vertices=32)
    m.rod('trainer-port',(-1.734,0,2.12),(-1.71,0,2.12),.11,mat='dark',parent=yaw)
    m.path('handwheel',[(-1.95,.70+.20*math.cos(i*math.tau/24),1.9+.20*math.sin(i*math.tau/24)) for i in range(24)],.025,mat='edge',parent=yaw,closed=True)
    m.rod('wheel-axle',(-2.2,.70,1.9),(-1.95,.70,1.9),.03,parent=yaw)
    m.rod('wheel-bracket',(-2.15,.45,1.9),(-2.15,.70,1.9),.04,parent=yaw)
    for x in [-2.4,2.4]:
        for side in [-1,1]:m.rod('guard',(x,side*1.82,.46),(x,side*1.82,.94),.021,mat='edge',parent=yaw)
    return m.root


def create_funnel(part,col,helpers,materials):
    m=Model(col,helpers,materials);height=7.9;rx=1.83;ry=1.48;n=64
    def ring(t,scale=1,zoff=0):
        return [(-.15*height*t+rx*scale*math.cos(i*math.tau/n),ry*scale*math.sin(i*math.tau/n),height*t+zoff+.90*math.cos(i*math.tau/n)*t*t+.30*math.sin(i*math.tau/n)**2*t**5) for i in range(n)]
    rings=[ring(t,sc) for t,sc in [(0,1.03),(.14,1),(.79,.94),(1,.82)]]
    m.mesh('jacket',[v for row in rings for v in row],[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(3) for i in range(n)],smooth=True)
    top,inner,deep=ring(1,.82),ring(1,.72,-.08),ring(.90,.72,-.12)
    m.mesh('cap-interior',top+inner+deep,[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]+[(n+i,n+(i+1)%n,2*n+(i+1)%n,2*n+i) for i in range(n)]+[tuple(range(2*n,3*n))],mat='dark',smooth=True)
    for t,sc in [(.13,1.015),(.79,.95),(1,.835)]:m.path('rolled-band',ring(t,sc),.065,mat='edge',closed=True)
    for y in [-.85,0,.85]:
        st=y/(ry*.82);ct=math.sqrt(1-st*st)
        m.rod('grille',(-.15*height-rx*.82*ct,y,height-.90*ct+.30*st*st),(-.15*height+rx*.82*ct,y,height+.90*ct+.30*st*st),.042,mat='edge')
    for side in [-1,1]:
        for offset in [-.50,.43]:
            points=[(offset,side*(ry+.18),0),(offset-.15*(height-.1),side*(ry*.85+.16),height-.1),(offset-.15*(height-.1)+.14,side*(ry*.85+.16),height+.27)]
            m.path('steam-pipe',points,.082,mat='edge')
            for t in [.2,.5,.8]:
                p=Vector(points[0]).lerp(Vector(points[1]),t);m.rod('pipe-clip',p,(p.x,p.y-side*.22,p.z),.03)
        m.ladder('access',(-rx-.18,side*.65,0),(-rx-.18-.15*height,side*.65,height-.25),.45,mat='edge')
        for z in [.40,2.4,4.5,6.6,7.45]:
            t=z/height;scale=1 if t<.14 else 1-(t-.14)*(.18/.86)
            for y in [side*.65-.225,side*.65+.225]:
                jacket_x=-.15*height*t-rx*scale*math.sqrt(max(0,1-(y/(ry*scale))**2))
                ladder_x=-rx-.18-.15*height*z/(height-.25)
                m.rod('ladder-standoff',(ladder_x,y,z),(jacket_x+.06,y,z),.035,mat='edge')
    # Integral casing foot and socket; installation owns any surrounding deck platform.
    m.path('base-flange',ring(0,1.05),.07,mat='edge',closed=True)
    return m.root


def create_mast(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    # Fletcher aftermast source dimensions; external ship-to-ship stays are installation-owned.
    m.cyl('foot',(0,0,.08),.26,.16,mat='edge');m.bolts(.20,.18,6)
    m.rod('pole',(0,0,.08),(-.55,0,10.50),.095,r2=.028)
    m.rod('yard',(-.45,-1.75,8.20),(-.45,1.75,8.20),.037,mat='edge')
    for side in [-1,1]:m.rod('yard-brace',(-.51,0,9.25),(-.45,side*1.75,8.20),.023,mat='edge')
    return m.root


def create_director(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    # Fletcher Mk37 source normalized about pedestal bottom, with fixed support.
    m.cyl('pedestal',(0,0,1.02),1.24,2.04,vertices=48)
    for z in [.15,1.60,2.01]:m.cyl('band',(0,0,z),1.285,.075,mat='edge',vertices=48)
    yaw=m.empty('yaw',(0,0,2.05),m.root)
    outline=[(-1.85,-1.05),(-1.45,-1.45),(1.1,-1.45),(1.5,-1.05),(1.5,1.05),(1.1,1.45),(-1.45,1.45),(-1.85,1.05)]
    m.prism('housing',outline,2.05,3.82,parent=yaw)
    v=[(x,y,3.78) for x,y in outline]+[(-.2+(x+.2)*.87,y*.88,4.13) for x,y in outline]
    m.mesh('shoulders',v,[(i,(i+1)%8,8+(i+1)%8,8+i) for i in range(8)]+[tuple(range(8,16))],parent=yaw)
    m.rod('rangefinder',(-.35,-2.18,3.08),(-.35,2.18,3.08),.24,mat='edge',vertices=24,parent=yaw)
    for side in [-1,1]:
        m.box('optical-hood',(-.35,side*2.14,3.10),(.65,.45,.60),parent=yaw)
        m.rod('lens',(-.035,side*2.14,3.11),(.015,side*2.14,3.11),.15,mat='dark',parent=yaw)
    for y in [-.65,0,.65]:m.rod('glass',(1.51,y,3.4),(1.54,y,3.4),.18,mat='dark',parent=yaw)
    for side in [-1,1]:m.rod('radar-support',(-.55,side*.7,4.05),(-.15,side*.8,5.15),.055,mat='edge',parent=yaw)
    for z in [4.85,5.22,5.6,5.98]:m.path('radar-horizontal',[(.30-.26*(y/1.65)**2,y,z) for y in [-1.65,-1.32,-.99,-.66,-.33,0,.33,.66,.99,1.32,1.65]],.021,mat='edge',parent=yaw)
    for i in range(15):
        y=-1.65+i*3.3/14;x=.30-.26*(y/1.65)**2;m.rod('radar-vertical',(x,y,4.85),(x,y,5.98),.019,mat='edge',parent=yaw)
    for side in [-1,1]:m.rod('radar-brace',(-.50,0,4.35),(.03,side*1.65,5.98),.029,mat='edge',parent=yaw)
    return m.root


def create_rudder(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    # Original Fletcher planform; the stock and bearing are explicit physical attachments.
    m.cyl('bearing',(0,0,.62),.24,.26,mat='edge')
    yaw=m.empty('yaw',(0,0,0),m.root)
    m.cyl('stock',(0,0,-.3),.15,1.85,mat='edge',parent=yaw)
    v=[(1.5,-.12,.65),(-1.1,-.12,.65),(-1.55,-.08,-1.82),(.9,-.09,-2.05),(1.5,.12,.65),(-1.1,.12,.65),(-1.55,.08,-1.82),(.9,.09,-2.05)]
    m.mesh('blade',v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat='underwater',parent=yaw)
    return m.root


def create_propeller(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    # Fletcher original closed, cambered three-blade loft, starboard hand, 4.2 m diameter.
    m.rod('shaft-seat',(.40,0,0),(1.30,0,0),.16,mat='edge')
    m.rod('bearing',(.80,0,0),(1.32,0,0),.24,mat='underwater')
    spin=m.empty('spin',(0,0,0),m.root)
    profile=[(.65,.16),(.48,.28),(.20,.34),(-.22,.35),(-.48,.27),(-.74,.16),(-1.00,.025)]
    vs=[(x,r*math.cos(j*math.tau/48),r*math.sin(j*math.tau/48)) for x,r in profile for j in range(48)]
    fs=[(i*48+j,i*48+(j+1)%48,(i+1)*48+(j+1)%48,(i+1)*48+j) for i in range(len(profile)-1) for j in range(48)]+[tuple(reversed(range(48))),tuple((len(profile)-1)*48+j for j in range(48))]
    m.mesh('hub',vs,fs,mat='bronze',smooth=True,parent=spin)
    sections=[(.25,.34),(.44,.88),(.72,1.54),(1.05,1.93),(1.38,2.00),(1.65,1.88),(1.86,1.48),(2.02,.82),(2.10,.012)]
    def chord(r):
        if r>2.02:return max(.012,.82*math.sqrt(max(0,(2.10-r)/.08)))
        slopes=[(b[1]-a[1])/(b[0]-a[0]) for a,b in zip(sections,sections[1:])]
        tangents=[slopes[0]]+[0 if slopes[i-1]*slopes[i]<=0 else 2/(1/slopes[i-1]+1/slopes[i]) for i in range(1,len(slopes))]+[slopes[-1]]
        k=next((i for i in range(len(slopes)) if r<=sections[i+1][0]),len(slopes)-1)
        a,b=sections[k:k+2];d=b[0]-a[0];t=(r-a[0])/d
        return (2*t**3-3*t*t+1)*a[1]+(t**3-2*t*t+t)*d*tangents[k]+(-2*t**3+3*t*t)*b[1]+(t**3-t*t)*d*tangents[k+1]
    for i in range(3):
        a=math.pi/2+i*math.tau/3;v=[];nr,nc=49,25
        for face in [-1,1]:
            for k in range(nr):
                r=.25+1.85*(.5-.5*math.cos(math.pi*k/(nr-1)));c=chord(r);pitch=math.atan2(3.8,math.tau*r)
                for j in range(nc):
                    u=-math.cos(math.pi*j/(nc-1));t=u*c/2+.10*(r/2.1)**2
                    thick=(.012+.125*(1-r/2.1)**1.4)*math.sqrt(max(0,1-u*u))+.004
                    x=-t*math.sin(pitch)+.06*r+.038*c*(1-u*u)+face*thick/2*math.cos(pitch)
                    tang=t*math.cos(pitch)+face*thick/2*math.sin(pitch)
                    v.append((x,-(r*math.cos(a)-tang*math.sin(a)),r*math.sin(a)+tang*math.cos(a)))
        stride=nr*nc;f=[]
        for k in range(nr-1):
            for j in range(nc-1):
                n=k*nc+j;f.extend([(n,n+nc,n+nc+1,n+1),(stride+n,stride+n+1,stride+n+nc+1,stride+n+nc)])
        edge=list(range(nc))+[k*nc+nc-1 for k in range(1,nr)]+[(nr-1)*nc+j for j in range(nc-2,-1,-1)]+[k*nc for k in range(nr-2,0,-1)]
        f.extend((n,edge[(j+1)%len(edge)],stride+edge[(j+1)%len(edge)],stride+n) for j,n in enumerate(edge))
        m.mesh('blade-'+str(i+1),v,f,mat='bronze',smooth=True,parent=spin)
    return m.root


def create_engine(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    # Package casing dimensions are the authored installation envelope. Interior
    # service fittings are illustrative; no boiler/shaft routing simulation implied.
    w,h,l=part['size']
    m.box('foundation',(0,0,.12),(l,w,.24),mat='edge')
    m.box('casing',(0,0,h*.42),(l*.92,w*.84,h*.68))
    for side in [-1,1]:
        for i in range(6):
            x=l*(-.37+i*.148)
            m.box('cylinder-head',(x,side*w*.24,h*.81),(l*.11,w*.30,h*.18),mat='roof')
            m.rod('head-pipe',(x,side*w*.24,h*.75),(x,side*w*.38,h*.55),.07,mat='edge')
        m.rod('service-rail',(-l*.41,side*w*.43,h*.60),(l*.41,side*w*.43,h*.60),.045,mat='edge')
    m.rod('flywheel',(-l*.49,0,h*.37),(-l*.44,0,h*.37),min(w*.29,h*.29),mat='edge',vertices=48)
    for x in [-l*.4,l*.4]:
        for y in [-w*.44,w*.44]:m.cyl('foundation-bolt',(x,y,.26),.05,.06,mat='edge',vertices=6)
    return m.root


def create_magazine(part,col,helpers,materials):
    m=Model(col,helpers,materials);w,h,l=part['size']
    m.box('floor',(0,0,.06),(l,w,.12),mat='edge')
    for y in [-w/2+.04,w/2-.04]:m.box('wall',(0,y,h/2),(l,.08,h))
    for x in [-l/2+.04,l/2-.04]:m.box('bulkhead',(x,0,h/2),(.08,w,h))
    # Open top for inspection, fixed rack envelope and internal passage.
    for y in [-w*.29,w*.29]:
        for z in [.5,h*.45,h*.75]:
            m.box('rack-shelf',(0,y,z),(l*.86,w*.29,.06),mat='roof')
        for x in [-l*.4,l*.4]:m.box('rack-post',(x,y,h*.45),(.06,.06,h*.85),mat='edge')
    # Fixed storage geometry is independent of remaining ammunition in a battle.
    return m.root
