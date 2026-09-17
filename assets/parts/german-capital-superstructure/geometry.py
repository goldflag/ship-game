"""German capital-ship superstructure fittings adapted from assets/ships/bismarck/build.py.

Funnel rings are a simplified transcription of the Bismarck blueprint's
'funnel-jacket' surface, normalized to a deck datum at the jacket foot. The
rangefinder cupola follows the ship script's director(); the mainmast follows
its pole-mast loop without rigging. No published or reference model is an input.
"""
import sys, math
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'construction'))
from geometry import Model

Q=16  # vertices per quarter arc; every oblong ring has 4*Q vertices


def oblong(x0,x1,w,rf,rr,z,slope=0):
    """Closed plan ring: straight sides, quarter-round corners (front radius rf,
    rear radius rr) and a flat nose/tail where the radius is less than w."""
    pts=[]
    for cx,cy,r,start in [(x1-rf,w-rf,rf,0),(x0+rr,w-rr,rr,math.pi/2),(x0+rr,-(w-rr),rr,math.pi),(x1-rf,-(w-rf),rf,1.5*math.pi)]:
        for i in range(Q):
            a=start+(i+.5)*(math.pi/2)/Q
            pts.append((cx+r*math.cos(a),cy+r*math.sin(a)))
    return [(x,y,z+slope*x) for x,y in pts]


def loft(rings,cap_bottom=False,cap_top=False):
    n=len(rings[0]);vs=[v for ring in rings for v in ring]
    fs=[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(len(rings)-1) for i in range(n)]
    if cap_bottom:fs.append(tuple(reversed(range(n))))
    if cap_top:fs.append(tuple((len(rings)-1)*n+i for i in range(n)))
    return vs,fs


def face_inward(obj,centre):
    """Make an open cup's faces look toward its own axis so the interior is what renders."""
    mesh=obj.data;centre=Vector(centre);score=0
    for p in mesh.polygons:
        if abs(p.normal.z)<.5:score+=p.normal.dot(centre-p.center)*p.area
    if score<0:mesh.flip_normals()
    return obj


def rail(m,name,pts,height,closed=False,parent=None,r=.022):
    pts=[Vector(p) for p in pts]
    for p in pts:m.rod(name+'.stanchion',p,p+Vector((0,0,height)),r,mat='edge',vertices=6,parent=parent)
    for h in [height,height*.52]:
        m.path(name+'.rail',[p+Vector((0,0,h)) for p in pts],r*.85,closed=closed,mat='edge',vertices=6,parent=parent)


def side_ladder(m,name,a,b,across,width=.42,parent=None):
    """Ladder whose rungs run along the `across` direction."""
    a,b,across=Vector(a),Vector(b),Vector(across).normalized()*width/2
    for s in [-1,1]:m.rod(name+'.rail',a+s*across,b+s*across,.024,mat='edge',vertices=6,parent=parent)
    steps=max(1,math.ceil((b-a).length/.32))
    for i in range(steps+1):
        p=a.lerp(b,i/steps);m.rod(name+'.rung',p-across,p+across,.016,mat='edge',vertices=5,parent=parent)


# x0, x1, half-breadth, front radius, rear radius, z  (x forward, datum = jacket centre at its foot)
FUNNEL_RINGS=[
    (-6.00,13.50,2.67,0.65,2.60,0.00),   # swept forward uptake foot
    (-5.85,10.60,2.67,1.20,2.60,1.35),
    (-5.75, 8.45,2.67,1.75,2.60,2.80),
    (-5.70, 7.45,2.67,2.10,2.60,3.80),
    (-5.65, 6.55,2.67,2.40,2.60,4.80),
    (-5.65, 5.94,2.90,2.78,2.83,7.00),   # nearly straight-sided jacket
    (-5.65, 5.65,2.90,2.83,2.83,11.10),
    (-5.85, 5.85,3.12,3.04,3.04,11.50),  # projecting collar
]
CAP=(-5.32,5.32,2.40,2.32,2.32)          # smaller raked cap
CAP_Z,CAP_SLOPE,CAP_H=11.75,.12,1.05


def funnel_ring_at(z):
    for a,b in zip(FUNNEL_RINGS,FUNNEL_RINGS[1:]):
        if a[5]<=z<=b[5]:
            t=(z-a[5])/(b[5]-a[5]);return oblong(*[a[k]+(b[k]-a[k])*t for k in range(6)])
    raise ValueError(z)


def create_battleship_funnel(part,col,helpers,materials):
    m=Model(col,helpers,materials);n=4*Q
    rings=[oblong(*r) for r in FUNNEL_RINGS]
    cap_lo=oblong(*CAP,11.5);cap_hi=oblong(*CAP,CAP_Z+CAP_H,CAP_SLOPE)
    inner=[(x*.945,y*.90,z-.05) for x,y,z in cap_hi]
    vs,fs=loft(rings+[cap_lo,cap_hi,inner],cap_bottom=True)
    m.mesh('jacket',vs,fs)
    # Dark uptake: inner wall and recessed floor, faces turned to the inside.
    deep=[(x,y,z-1.30) for x,y,z in inner]
    vs,fs=loft([inner,deep]);fs.append(tuple(range(n,2*n)))
    face_inward(m.mesh('uptake-interior',vs,fs,mat='dark'),(0,0,CAP_Z))
    m.path('cap-rolled-lip',cap_hi,.055,closed=True,mat='edge',vertices=6)
    m.path('cap-foot-band',oblong(*CAP,11.53),.04,closed=True,mat='edge',vertices=6)
    m.path('collar-edge',rings[-1],.05,closed=True,mat='edge',vertices=6)
    top=lambda x:CAP_Z+CAP_H+CAP_SLOPE*x-.03
    def span(axis,value):
        other=1-axis;hits=[]
        for a,b in zip(inner,inner[1:]+inner[:1]):
            if min(a[axis],b[axis])<=value<=max(a[axis],b[axis]) and abs(a[axis]-b[axis])>1e-4:
                hits.append(a[other]+(b[other]-a[other])*(value-a[axis])/(b[axis]-a[axis]))
        return min(hits),max(hits)
    for x in [-4.2,-2.8,-1.4,0,1.4,2.8,4.2]:
        lo,hi=span(0,x);m.rod('cap-grating-transverse',(x,lo,top(x)),(x,hi,top(x)),.038,mat='edge',vertices=6)
    for y in [-1.25,0,1.25]:
        lo,hi=span(1,y);m.rod('cap-grating-longitudinal',(lo,y,top(lo)),(hi,y,top(hi)),.042,mat='edge',vertices=6)
    for z in [2.0,4.5,7.4,9.6,10.95]:
        m.path('plating-band',funnel_ring_at(z),.035,closed=True,mat='edge',vertices=5)
    m.path('foot-flange',oblong(-6.04,13.54,2.71,.68,2.63,.05),.06,closed=True,mat='edge',vertices=6)
    # Standing cowl ventilators ring the collar outside the smaller cap.
    for i in range(1,n,2):
        x,y,_=rings[-1][i];x*=.955;y*=.885
        m.cyl('collar-ventilator',(x,y,11.72),.105,.44,vertices=6)
        m.cyl('ventilator-crown',(x,y,11.96),.125,.04,mat='edge',vertices=6)
    for side in [-1,1]:
        # Swept uptake louvres low on the foot.
        for x in [2.2,5.2,8.2]:
            m.box('uptake-louvre',(x,side*2.68,.95),(1.6,.06,.95),mat='dark')
            for k in range(4):m.box('louvre-slat',(x,side*2.72,.59+k*.24),(1.66,.05,.05),mat='edge')
        # Lower walkway and the broader searchlight gallery, both landed on the jacket side.
        for tag,z,x0,x1,y1 in [('walkway',2.85,-3.0,6.4,3.75),('searchlight-gallery',5.75,-3.0,3.6,4.75)]:
            y0=2.55;c=.35
            outline=[(x0,y0),(x1,y0),(x1,y1-c),(x1-c,y1),(x0+c,y1),(x0,y1-c)]
            m.prism(tag,[(x,side*y) for x,y in outline],z,z+.14,mat='roof')
            rail(m,tag,[(x0,side*2.95,z+.14),(x0,side*(y1-c),z+.14),(x0+c,side*y1,z+.14)]+
                 [(x0+c+(x1-x0-2*c)*k/6,side*y1,z+.14) for k in range(1,6)]+
                 [(x1-c,side*y1,z+.14),(x1,side*(y1-c),z+.14),(x1,side*2.95,z+.14)],1.0)
            for x in [x0+.5,(x0+x1)/2,x1-.5]:
                m.rod(tag+'.knee',(x,side*(y1-.15),z+.02),(x,side*2.72,z-1.1),.06,vertices=6)
        m.box('searchlight-pedestal',(1.2,side*3.85,6.24),(.5,.5,.7))
        m.rod('searchlight-drum',(.78,side*3.85,7.1),(1.62,side*3.85,7.1),.62,vertices=20)
        m.rod('searchlight-lens',(1.62,side*3.85,7.1),(1.65,side*3.85,7.1),.55,mat='dark',vertices=20)
        for s in [-1,1]:m.rod('searchlight-yoke',(1.2,side*3.85+s*.68,6.55),(1.2,side*3.85+s*.68,7.15),.05,mat='edge',vertices=6)
        m.rod('searchlight-trunnion',(1.2,side*3.85-.70,7.1),(1.2,side*3.85+.70,7.1),.045,mat='edge',vertices=6)
        side_ladder(m,'gallery-stair',(-2.6,side*3.35,.0),(-.6,side*3.35,2.95),(0,1,0),.55)
        side_ladder(m,'gallery-ladder',(4.6,side*3.35,2.99),(3.2,side*3.35,5.85),(0,1,0),.5)
        side_ladder(m,'upper-ladder',(-2.2,side*3.04,5.89),(-2.2,side*3.04,11.45),(1,0,0))
        for z in [6.6,8.4,10.2]:
            for x in [-2.41,-1.99]:m.rod('ladder-standoff',(x,side*3.04,z),(x,side*2.88,z),.022,mat='edge',vertices=5)
        # Steam pipes climb the after face and clear the cap lip.
        for y in [.75,1.55]:
            back=lambda z:min(v[0] for v in funnel_ring_at(z) if abs(abs(v[1])-y)<.35)
            pts=[(back(z)-.13,side*y,z) for z in [0,2.8,7.0,11.0]]
            capx=min(v[0] for v in cap_hi if abs(abs(v[1])-y)<.3)-.14
            pts+=[(back(11.45)-.16,side*y,11.45),(capx,side*y,11.62),(capx,side*y,CAP_Z+CAP_H+CAP_SLOPE*capx+.35)]
            m.path('steam-pipe',pts,.07,mat='edge',vertices=8)
            for z in [1.5,4.5,8.0,10.4]:
                x=back(z);m.rod('pipe-clip',(x-.2,side*y,z),(x+.05,side*y,z),.03,vertices=5)
    return m.root


def rounded_rect(lx,ly,r,seg=5,cx=0,cy=0):
    pts=[]
    for sx,sy,start in [(1,1,0),(-1,1,math.pi/2),(-1,-1,math.pi),(1,-1,1.5*math.pi)]:
        for i in range(seg+1):
            a=start+i*(math.pi/2)/seg
            pts.append((cx+sx*(lx/2-r)+r*math.cos(a),cy+sy*(ly/2-r)+r*math.sin(a)))
    return pts


def create_rangefinder_cupola(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    axis=1.30;span=10.5;bottom=.30;top=axis+1.13
    # Fixed roller-path foundation.
    m.cyl('foundation',(0,0,.10),1.72,.20,mat='edge',vertices=48)
    m.cyl('training-ring',(0,0,.25),1.58,.10,vertices=48)
    m.bolts(1.65,.215,24)
    yaw=m.empty('yaw',(0,0,0),m.root)
    hood=rounded_rect(3.25,3.5,.70)
    m.prism('armoured-hood',hood,bottom,top,parent=yaw)
    m.prism('crown-edge',rounded_rect(3.38,3.62,.73),top,top+.12,mat='edge',parent=yaw)
    # Shallow domed crown in two lifts.
    n=len(hood);low=rounded_rect(3.30,3.54,.71);mid=rounded_rect(2.2,2.4,.55)
    vs=[(x,y,top+.12) for x,y in low]+[(x,y,top+.30) for x,y in mid]+[(0,0,top+.38)]
    fs=[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]+[(n+i,n+(i+1)%n,2*n) for i in range(n)]
    m.mesh('domed-crown',vs,fs,parent=yaw,smooth=True)
    m.path('plating-joint',[(x,y,bottom+.62) for x,y in rounded_rect(3.27,3.52,.71)],.018,closed=True,mat='edge',vertices=5,parent=yaw)
    m.path('skirt-band',[(x,y,bottom+.04) for x,y in rounded_rect(3.30,3.55,.72)],.03,closed=True,mat='edge',vertices=5,parent=yaw)
    # Sighting ports and hatch on the hood.
    for y in [-.85,0,.85]:m.box('sighting-port',(1.63,y,axis+.45),(.04,.42,.20),mat='dark',parent=yaw)
    m.box('rear-hatch',(-1.64,0,axis-.05),(.05,.75,1.25),mat='edge',parent=yaw)
    m.cyl('roof-vent',(-.75,.8,top+.36),.12,.28,vertices=10,parent=yaw)
    m.rod('roof-aerial',(-.6,0,top+.30),(-.6,0,top+1.5),.022,mat='edge',vertices=6,parent=yaw)
    for side in [-1,1]:
        m.rod('aerial-stay',(-.6,side*.6,top+.22),(-.6,0,top+.95),.012,mat='edge',vertices=5,parent=yaw)
        # Cast junction, tapered optical tube, bolted collars and end optic casing.
        m.prism('tube-junction',[(-.59,side*1.34),(.60,side*1.34),(.43,side*2.12),(-.41,side*2.12)],axis-.38,axis+.40,parent=yaw)
        m.rod('optical-tube',(0,side*1.72,axis),(0,side*(span/2-.33),axis),.245,r2=.18,vertices=24,parent=yaw)
        for y in [2.05,3.35,span/2-.70]:
            r=.27-.05*(y-2.05)/2.5
            m.rod('tube-collar',(0,side*(y-.08),axis),(0,side*(y+.08),axis),r,mat='edge',vertices=24,parent=yaw)
        yy=side*(span/2-.25)
        m.prism('optic-housing',rounded_rect(.74,.69,.16,3,0,yy),axis-.29,axis+.29,parent=yaw)
        m.rod('lens-sleeve',(.28,yy,axis),(.45,yy,axis),.145,mat='edge',vertices=20,parent=yaw)
        m.rod('objective',(.449,yy,axis),(.462,yy,axis),.111,mat='dark',vertices=20,parent=yaw)
        m.box('lens-shade',(.40,yy,axis+.20),(.30,.40,.03),mat='edge',parent=yaw)
        # Narrow service step, braces and handrail behind each arm.
        a,b=side*1.65,side*(span/2+.06)
        m.box('service-step',(-.38,(a+b)/2,axis-.57),(.62,abs(b-a),.08),mat='edge',parent=yaw)
        ys=[side*(1.75+k*(span/2-1.9)/4) for k in range(5)]
        for y in ys:m.rod('step-stanchion',(-.67,y,axis-.55),(-.67,y,axis+.40),.021,mat='edge',vertices=5,parent=yaw)
        for y in [side*2.0,side*3.4,side*(span/2-.32)]:
            m.rod('step-brace',(-.38,y,axis-.60),(-.10,y,axis-.20),.033,mat='edge',vertices=6,parent=yaw)
        for h in [.40,-.08]:m.rod('step-handrail',(-.67,ys[0],axis+h),(-.67,ys[-1],axis+h),.019,mat='edge',vertices=5,parent=yaw)
        for k in range(7):
            z=bottom+.30+k*.27
            m.path('casing-rung',[(-1.48,side*1.42,z),(-1.63,side*1.52,z),(-1.63,side*1.17,z),(-1.48,side*1.13,z)],.020,mat='edge',vertices=5,parent=yaw)
    # FuMO mattress aerial on the front face: frame, dipole grid and standoffs.
    fx,w,z0,z1=1.98,2.0,axis-.55,axis+1.20
    m.box('fumo-backing',(fx-.06,0,(z0+z1)/2),(.04,2*w,z1-z0),mat='roof',parent=yaw)
    m.path('fumo-frame',[(fx,-w,z0),(fx,w,z0),(fx,w,z1),(fx,-w,z1)],.035,closed=True,mat='edge',vertices=6,parent=yaw)
    for k in range(1,8):
        y=-w+k*2*w/8;m.rod('fumo-vertical',(fx,y,z0),(fx,y,z1),.016,mat='edge',vertices=5,parent=yaw)
    for k in range(1,6):
        z=z0+k*(z1-z0)/6;m.rod('fumo-horizontal',(fx,-w,z),(fx,w,z),.016,mat='edge',vertices=5,parent=yaw)
        for j in range(8):
            y=-w+(j+.5)*2*w/8;m.rod('fumo-dipole',(fx+.10,y-.16,z),(fx+.10,y+.16,z),.012,mat='edge',vertices=4,parent=yaw)
    for y in [-1.2,1.2]:
        for z in [z0+.25,z1-.25]:m.rod('fumo-standoff',(1.55,y,z),(fx-.06,y,z),.035,mat='edge',vertices=6,parent=yaw)
    for y in [-1.95,1.95]:m.rod('fumo-outrigger',(1.2,math.copysign(1.74,y),axis+.75),(fx-.06,y,axis+.75),.03,mat='edge',vertices=6,parent=yaw)
    return m.root


def create_mainmast(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    height=37.54;rake=-.50
    at=lambda z:Vector((rake*z/height,0,z))
    radius=lambda z:.31+(.065-.31)*z/height
    m.cyl('foot',(0,0,.10),.52,.20,mat='edge',vertices=24);m.bolts(.43,.22,10)
    m.rod('pole',(0,0,0),at(height),.31,r2=.065,mat='edge',vertices=20)
    for z in [10.0,19.2,26.0,33.0]:
        p=at(z);m.rod('pole-band',p-Vector((0,0,.07)),p+Vector((0,0,.07)),radius(z)+.03,vertices=16)
    # Tripod-style lower supports landing ahead of the pole.
    for side in [-1,1]:
        m.rod('lower-support',(1.1,side*2.0,0),at(10.0),.12,vertices=10)
        m.cyl('support-foot',(1.1,side*2.0,.06),.24,.12,mat='edge',vertices=12)
    m.rod('support-spreader',(.62,-1.12,4.4),(.62,1.12,4.4),.05,mat='edge',vertices=8)
    # Enclosed lookout with railed platform on its roof.
    lz=17.94;lx=at(lz).x+.30
    m.prism('enclosed-lookout',rounded_rect(1.9,1.7,.35,4,lx,0),lz-1.10,lz+1.10)
    m.prism('lookout-floor',rounded_rect(2.1,1.9,.40,4,lx,0),lz-1.18,lz-1.10,mat='edge')
    for side in [-1,1]:
        m.box('lookout-window',(lx,side*.855,lz+.50),(.95,.03,.50),mat='dark')
        m.rod('lookout-knee',(lx+.6,side*.5,lz-1.15),at(lz-2.4),.045,mat='edge',vertices=6)
    m.box('lookout-window-fore',(lx+.955,0,lz+.50),(.03,.85,.50),mat='dark')
    pz=lz+1.10;px=at(pz).x+.20
    m.cyl('lookout-platform',(px,0,pz+.08),1.5,.16,mat='roof',vertices=24)
    rail(m,'lookout',[(px+1.44*math.cos(i*math.tau/12),1.44*math.sin(i*math.tau/12),pz+.16) for i in range(12)],1.0,closed=True)
    # Small upper searchlight/signal platform.
    uz=28.0;ux=at(uz).x
    m.cyl('upper-platform',(ux,0,uz),.85,.10,mat='roof',vertices=16)
    rail(m,'upper',[(ux+.80*math.cos(i*math.tau/8),.80*math.sin(i*math.tau/8),uz+.05) for i in range(8)],.9,closed=True)
    for a in [.8,2.34,3.94,5.48]:m.rod('upper-knee',(ux+.7*math.cos(a),.7*math.sin(a),uz-.04),at(uz-.9),.03,mat='edge',vertices=5)
    m.cyl('signal-lamp',(ux+.45,0,uz+.40),.16,.5,vertices=10)
    # Yards with fixed braces in place of running rigging.
    for z,span,r in [(22.0,8.0,.085),(25.04,11.5,.09),(32.04,14.4,.09),(36.04,6.4,.07)]:
        x=at(z).x-radius(z)-.06
        for side in [-1,1]:
            m.rod('yard',(x,0,z),(x,side*span/2,z),r,r2=r*.5,mat='edge',vertices=10)
            m.rod('yard-brace',(x,side*span*.28,z),at(z+span*.10+.4),.022,mat='edge',vertices=5)
            for k in [.45,.72,.96]:m.cyl('halyard-block',(x,side*span*k/2,z-r-.08),.035,.14,mat='dark',vertices=6)
        m.box('yard-truss',(x+.10,0,z),(.30,.50,.22),mat='edge')
    # Gaff and ensign spur aft, wireless spreader and truck at the head.
    g=at(30.0);m.rod('gaff',g,g+Vector((-3.6,0,2.2)),.06,r2=.03,mat='edge',vertices=8)
    m.rod('gaff-span',g+Vector((-2.2,0,1.35)),at(32.6),.016,mat='edge',vertices=5)
    h=at(height-.5);m.rod('wireless-spreader',h+Vector((0,-.55,0)),h+Vector((0,.55,0)),.045,mat='edge',vertices=8)
    for side in [-1,1]:m.cyl('spreader-insulator',h+Vector((0,side*.55,-.09)),.04,.16,mat='dark',vertices=6)
    t=at(height);m.cyl('truck',t+Vector((0,0,.03)),.12,.06,mat='edge',vertices=12)
    m.rod('truck-light',t+Vector((0,0,.06)),t+Vector((0,0,.34)),.05,mat='dark',vertices=8)
    # Pole ladder on the forward face with mounting lugs, broken at the lookout.
    for z0,z1 in [(.4,16.7),(19.4,27.9),(28.2,35.4)]:
        a=at(z0)+Vector((radius(z0)+.16,0,0));b=at(z1)+Vector((radius(z1)+.16,0,0))
        m.ladder('pole-ladder',a,b,.40,mat='edge',vertices=5)
        steps=max(2,int((z1-z0)/3))
        for i in range(steps+1):
            p=a.lerp(b,i/steps)
            for y in [-.2,.2]:m.rod('ladder-lug',at(p.z),(p.x,y,p.z),.025,mat='edge',vertices=5)
    return m.root
