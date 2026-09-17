"""Ship's boats in deck chocks and a nation-neutral boat crane.

Standalone adaptations of the boats carried by the full-ship build scripts
(Iowa/Baltimore/Cleveland whaleboats, Yamato/Mogami launches, King George V
motor boats) and of their boat/aircraft cranes. Every hull is a lofted double
skin (outer shell, gunwale cap, inner lining) resting in two shaped chocks with
gripes. Authoring axes are forward/port/up with the bow toward +X; the deck is
Z=0. No published model is read.
"""
import sys, math
from pathlib import Path
import bpy
from mathutils import Vector, Matrix
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'construction'))
from geometry import Model

ROUND=[(0,0),(.30,.035),(.58,.13),(.80,.30),(.93,.55),(.985,.80),(1,1)]
CHINE=[(0,0),(.42,.10),(.84,.215),(.855,.245),(.92,.50),(.97,.78),(1,1)]


def lerp(a,b,t):return a+(b-a)*t

def catmull(p0,p1,p2,p3,t):
    return .5*(2*p1+(p2-p0)*t+(2*p0-5*p1+4*p2-p3)*t*t+(3*p1-p0-3*p2+p3)*t**3)

def paint(m,obj,mat,indices):
    obj.data.materials.append(m.m[mat]);slot=len(obj.data.materials)-1
    for i in indices:obj.data.polygons[i].material_index=slot

def tube(m,name,points,radius,mat='edge',sides=8,parent=None):
    """One continuous capped sweep so curved rails have no joint gaps."""
    pts=[Vector(p) for p in points];n=len(pts);verts=[];previous=normal=None
    for i,p in enumerate(pts):
        tangent=(pts[min(i+1,n-1)]-pts[max(0,i-1)]).normalized()
        if previous is None:
            ref=min((Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1))),key=lambda a:abs(a.dot(tangent)))
            normal=tangent.cross(ref).normalized()
        else:
            normal=previous.rotation_difference(tangent)@normal
            normal=(normal-tangent*normal.dot(tangent)).normalized()
        other=tangent.cross(normal).normalized();previous=tangent.copy()
        for j in range(sides):
            a=math.tau*j/sides;verts.append(tuple(p+radius*(normal*math.cos(a)+other*math.sin(a))))
    faces=[(k*sides+j,k*sides+(j+1)%sides,(k+1)*sides+(j+1)%sides,(k+1)*sides+j) for k in range(n-1) for j in range(sides)]
    faces+=[tuple(reversed(range(sides))),tuple(range((n-1)*sides,n*sides))]
    return m.mesh(name,verts,faces,mat=mat,smooth=False,parent=parent)

def strip_solid(m,name,a,b,extrude,mat='naval'):
    """Closed slab between two polylines, extruded along one vector."""
    a=[Vector(p) for p in a];b=[Vector(p) for p in b];e=Vector(extrude);k=len(a)
    verts=[tuple(p) for p in a+b]+[tuple(p+e) for p in a+b];faces=[]
    for i in range(k-1):
        faces+=[(i,i+1,k+i+1,k+i),(2*k+i,3*k+i,3*k+i+1,2*k+i+1),(i,2*k+i,2*k+i+1,i+1),(k+i,k+i+1,3*k+i+1,3*k+i)]
    for i in [0,k-1]:
        if (a[i]-b[i]).length>1e-4:faces.append((i,k+i,3*k+i,2*k+i))
    return m.mesh(name,verts,faces,mat=mat)

def section_solid(m,name,sections,mat='naval',smooth=False):
    q=len(sections[0]);verts=[tuple(p) for s in sections for p in s]
    faces=[(k*q+i,k*q+(i+1)%q,(k+1)*q+(i+1)%q,(k+1)*q+i) for k in range(len(sections)-1) for i in range(q)]
    faces+=[tuple(reversed(range(q))),tuple(range((len(sections)-1)*q,len(sections)*q))]
    return m.mesh(name,verts,faces,mat=mat,smooth=smooth)

def plate_xz(m,name,outline,thickness,mat='naval',y=0):
    n=len(outline)
    verts=[(x,y+s*thickness/2,z) for s in [-1,1] for x,z in outline]
    return m.mesh(name,verts,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)],mat=mat)

def slab(m,name,a,b,mat='roof',width=.07,thickness=.012):
    """Flat strap segment in a transverse (YZ) plane."""
    a,b=Vector(a),Vector(b);d=b-a
    o=m.box(name,tuple((a+b)/2),(width,d.length,thickness),mat=mat)
    o.rotation_euler=(math.atan2(d.z,d.y),0,0);return o


class Hull:
    """Lofted boat hull. Stations are (x, halfBeam, keel, sheer, fineness, rake)."""
    def __init__(self,stations,cross,z0,per=3,skin=.05):
        p=[tuple(float(v) for v in s) for s in stations]
        e=[tuple(2*a-b for a,b in zip(p[0],p[1]))]+p+[tuple(2*a-b for a,b in zip(p[-1],p[-2]))]
        dense=[]
        for i in range(len(p)-1):
            for k in range(per):
                dense.append(tuple(catmull(e[i][c],e[i+1][c],e[i+2][c],e[i+3][c],k/per) for c in range(6)))
        dense.append(p[-1])
        lo,hi=p[0][0],p[-1][0]
        self.st=[(min(hi,max(lo,x)),max(.012,w),k,s,min(1,max(0,f)),r) for x,w,k,s,f,r in dense]
        self.cross,self.z0,self.skin=cross,z0,skin

    def at(self,x):
        st=self.st
        if x<=st[0][0]:return st[0]
        for a,b in zip(st,st[1:]):
            if a[0]<=x<=b[0]:
                t=(x-a[0])/max(1e-9,b[0]-a[0]);return tuple(lerp(u,v,t) for u,v in zip(a,b))
        return st[-1]

    def shape(self,f):return [(lerp(u,t**1.25,f),t) for u,t in self.cross]

    def u_at(self,f,t):
        pts=self.shape(f)
        for (u0,t0),(u1,t1) in zip(pts,pts[1:]):
            if t0<=t<=t1:return lerp(u0,u1,(t-t0)/(t1-t0))
        return pts[-1][0] if t>1 else 0

    def section(self,station,inner=False):
        x,w,keel,sheer,f,rake=station;pts=self.shape(f);out=[]
        wi=max(w-self.skin,.004) if inner else w
        half=[(x+rake*t,wi*u,self.z0+keel+(sheer-keel)*t+(self.skin*(1-t) if inner else 0)) for u,t in pts]
        return [(px,-py,pz) for px,py,pz in reversed(half[1:])]+half

    def sheer(self,x):return self.z0+self.at(x)[3]
    def keel(self,x):return self.z0+self.at(x)[2]

    def z_at(self,x,y):
        """Outer skin height under lateral offset y."""
        sec=self.section(self.at(x));half=sec[len(sec)//2:]
        for a,b in zip(half,half[1:]):
            if a[1]<=abs(y)<=b[1]:return lerp(a[2],b[2],(abs(y)-a[1])/max(1e-9,b[1]-a[1]))
        return half[-1][2]

    def half_width(self,x,z,inner=True):
        st=self.at(x);_,w,keel,sheer,f,_=st
        t=min(1,max(0,(z-self.z0-keel-(self.skin if inner else 0))/(sheer-keel)))
        return (max(w-self.skin,.004) if inner else w)*self.u_at(f,t)-(.015 if inner else 0)

    def line(self,t,side,out=0,x0=-1e9,x1=1e9):
        pts=[]
        for st in self.st:
            x,w,keel,sheer,f,rake=st
            if x0<=x<=x1:pts.append((x+rake*t,side*(w*self.u_at(f,t)+out),self.z0+keel+(sheer-keel)*t))
        return pts

    def build(self,m,name,mat='naval',lining='roof',cap='edge'):
        outer=[self.section(s) for s in self.st];inner=[self.section(s,True) for s in self.st]
        n=len(outer[0]);rows=len(outer);stride=n*rows
        verts=[p for row in outer for p in row]+[p for row in inner for p in row]
        skin,caps,inside=[],[],[]
        for k in range(rows-1):
            for j in range(n-1):
                a=k*n+j;skin.append((a,a+n,a+n+1,a+1));inside.append((stride+a,stride+a+1,stride+a+n+1,stride+a+n))
            for j in [0,n-1]:
                a=k*n+j;caps.append((a,stride+a,stride+a+n,a+n))
        for k in [0,rows-1]:
            caps+=[(k*n+j,k*n+j+1,stride+k*n+j+1,stride+k*n+j) for j in range(n-1)]
        obj=m.mesh(name,verts,skin+caps+inside,mat=mat,smooth=True)
        paint(m,obj,cap,range(len(skin),len(skin)+len(caps)))
        paint(m,obj,lining,range(len(skin)+len(caps),len(skin)+len(caps)+len(inside)))
        return obj

    def transom(self,m,name,end=0,thickness=.06,mat='naval'):
        sec=self.section(self.st[end]);h=len(sec)//2
        left=list(reversed(sec[:h+1]));right=sec[h:]
        return strip_solid(m,name,left,right,(thickness if end==0 else -thickness,0,0),mat=mat)

    def bulkhead(self,m,name,x,top=None,thickness=.05,mat='roof'):
        st=self.at(x);sec=self.section(st,True);h=len(sec)//2
        left=[(p[0],p[1]-.01,min(p[2],top) if top else p[2]) for p in reversed(sec[:h+1])]
        right=[(p[0],p[1]+.01,min(p[2],top) if top else p[2]) for p in sec[h:]]
        return strip_solid(m,name,left,right,(thickness,0,0),mat=mat)

    def deck(self,m,name,x0,x1,camber=.05,thickness=.04,drop=.03,mat='roof'):
        xs=sorted({x0,x1,*[s[0] for s in self.st if x0<s[0]<x1]});sections=[]
        for x in xs:
            _,w,keel,sheer,f,rake=self.at(x);w=max(w-.025,.006);z=self.z0+sheer-drop;px=x+rake
            sections.append([(px,-w,z),(px,0,z+camber),(px,w,z),(px,w,z-thickness),(px,0,z+camber-thickness),(px,-w,z-thickness)])
        return section_solid(m,name,sections,mat=mat)

    def stem_line(self,end,top=.07):
        x,w,keel,sheer,f,rake=self.st[end]
        return [(x+rake*t,0,self.z0+keel+(sheer-keel)*t) for t in [.2,.4,.6,.8,1]]+[(x+rake*1.03,0,self.z0+sheer+top)]

    def keel_line(self,pointed_stern=True):
        pts=[(x,0,self.z0+keel) for x,w,keel,sheer,f,rake in self.st]
        if pointed_stern:pts=list(reversed(self.stem_line(0)))+pts
        return pts+self.stem_line(-1)


def chock(m,hull,x,frac=.62,length=.22):
    w=hull.at(x)[1];half=w*frac
    m.box('chock-deck-beam',(x,0,.05),(length+.08,2*half+.36,.10),mat='edge')
    ys=[-half+2*half*i/14 for i in range(15)]
    strip_solid(m,'chock',[(x-length/2,y,.10) for y in ys],[(x-length/2,y,hull.z_at(x,y)+.004) for y in ys],(length,0,0),mat='roof')
    for side in [-1,1]:
        m.rod('chock-knee',(x,side*(half+.15),.10),(x,side*half*.97,hull.z_at(x,half)-.03),.045,mat='edge',vertices=8)
        m.cyl('chock-bolt',(x,side*(half+.10),.115),.03,.03,mat='dark',vertices=6)

def gripe(m,hull,x,over=None):
    """Lashing strap from deck eye, over the boat, to the opposite deck eye."""
    _,w,keel,sheer,f,rake=hull.at(x);top=hull.z0+sheer+.045;reach=w+.30
    crown=over or [(x,-(w+.012),top),(x,w+.012,top)]
    pts=[(x,-reach,.34)]+crown+[(x,reach,.34)]
    for a,b in zip(pts,pts[1:]):slab(m,'gripe',a,b)
    for side in [-1,1]:
        foot=Vector((x,side*(reach+.035),.03));eye=Vector((x,side*reach,.34))
        m.rod('gripe-turnbuckle',tuple(foot),tuple(eye),.024,mat='edge',vertices=8)
        m.rod('gripe-turnbuckle-body',tuple(foot.lerp(eye,.3)),tuple(foot.lerp(eye,.75)),.04,mat='edge',vertices=6)
        m.box('gripe-deck-pad',(x,side*(reach+.035),.015),(.20,.16,.03),mat='edge')

def propeller(m,centre,radius,blades=3):
    c=Vector(centre)
    m.rod('propeller-hub',tuple(c+Vector((-.09,0,0))),tuple(c+Vector((.09,0,0))),radius*.24,mat='bronze',r2=radius*.16,vertices=10)
    for i in range(blades):
        rot=Matrix.Rotation(i*math.tau/blades,3,'X')@Matrix.Rotation(math.radians(32),3,'Z')
        o=m.box('propeller-blade',tuple(c+Matrix.Rotation(i*math.tau/blades,3,'X')@Vector((0,0,radius*.58))),(.018,radius*.62,radius*.86),mat='bronze')
        o.rotation_euler=rot.to_euler()

def cabin(m,hull,name,profile,top,width,camber=.07,mat='naval',base_drop=.02):
    """Coachroof solid. profile is [(x, height fraction)], width(x) the half width at the deck."""
    sections=[]
    for x,frac in profile:
        w=width(x);zb=hull.sheer(x)-base_drop;zt=zb+(top-zb)*frac
        sections.append([(x,-w,zb),(x,-w*.93,zt),(x,-w*.5,zt+camber*.8*frac),(x,0,zt+camber*frac),(x,w*.5,zt+camber*.8*frac),(x,w*.93,zt),(x,w,zb)])
    section_solid(m,name,sections,mat=mat)
    def side_y(x,z):
        w=width(x);zb=hull.sheer(x)-base_drop
        return w*(1-.07*min(1,max(0,(z-zb)/(top-zb))))
    return side_y

def side_window(m,name,x0,x1,z0,z1,side,side_y,mat='dark'):
    verts=[(x,side*(side_y(x,z)+d),z) for d in [.012,-.04] for x,z in [(x0,z0),(x1,z0),(x1,z1),(x0,z1)]]
    m.mesh(name,verts,[(0,1,2,3),(7,6,5,4)]+[(i,(i+1)%4,4+(i+1)%4,4+i) for i in range(4)],mat=mat)
    for z in [z0,z1]:m.rod(name+'-frame',(x0,side*(side_y(x0,z)+.012),z),(x1,side*(side_y(x1,z)+.012),z),.014,mat='edge',vertices=6)

def rail_on_posts(m,name,points,height,r=.016):
    tube(m,name,[(x,y,z+height) for x,y,z in points],r,sides=6)
    for x,y,z in points:m.rod(name+'-post',(x,y,z-.01),(x,y,z+height),r,mat='edge',vertices=6)


def create_motor_whaleboat(part,col,helpers,materials):
    """US Navy 26 ft motor whaleboat: double-ended open boat, engine box amidships, tiller."""
    m=Model(col,helpers,materials);z0=.36
    hull=Hull([(-3.95,.02,.46,1.14,1,-.22),(-3.45,.43,.10,1.02,.8,-.10),(-2.55,.84,.02,.90,.35,0),(-1.2,1.07,0,.82,.08,0),(0,1.12,0,.80,0,0),
               (1.3,1.06,0,.84,.08,0),(2.55,.82,.02,.95,.35,0),(3.45,.41,.10,1.09,.8,.10),(3.95,.02,.46,1.24,1,.24)],ROUND,z0,per=3)
    hull.build(m,'whaleboat-hull')
    tube(m,'keel-stem-sternpost',hull.keel_line(True),.05,sides=8)
    for side in [-1,1]:
        tube(m,'gunwale',hull.line(1,side,.012),.042,sides=8)
        tube(m,'rubbing-strake',hull.line(.80,side,.008),.026,sides=6)
        tube(m,'bilge-keel',hull.line(.17,side,.0,-1.6,1.6),.026,sides=6)
    # Bow and stern sheets, thwarts, side benches and bottom boards.
    hull.deck(m,'bow-sheets',3.05,3.95,camber=.02,drop=.10)
    hull.deck(m,'stern-sheets',-3.95,-3.0,camber=.02,drop=.10)
    for x in [-2.35,-1.35,1.05,2.1]:
        z=z0+.60;width=2*min(hull.half_width(x+d,z-.035) for d in [-.13,.13])
        m.box('thwart',(x,0,z),(.26,width,.07),mat='roof')
        for side in [-1,1]:m.rod('thwart-knee',(x,side*width*.40,z-.03),(x,side*hull.half_width(x,z-.26),z-.26),.025,mat='edge',vertices=6)
    for side in [-1,1]:
        for xa,xb in [(-2.22,-1.48),(1.18,1.97)]:
            ya=hull.half_width(xa,z0+.57)-.13;yb=hull.half_width(xb,z0+.57)-.13
            m.mesh('side-bench',[(xa,side*(ya-.12),z0+.565),(xb,side*(yb-.12),z0+.565),(xb,side*(yb+.12),z0+.565),(xa,side*(ya+.12),z0+.565),
                                 (xa,side*(ya-.12),z0+.615),(xb,side*(yb-.12),z0+.615),(xb,side*(yb+.12),z0+.615),(xa,side*(ya+.12),z0+.615)],
                   [(3,2,1,0),(4,5,6,7)]+[(i,(i+1)%4,4+(i+1)%4,4+i) for i in range(4)],mat='roof')
    for y in [-.39,-.13,.13,.39]:m.box('bottom-board',(0,y,z0+.175),(5.0,.235,.035),mat='roof')
    for x in [-2.0,-.7,.7,2.0]:m.box('board-bearer',(x,0,z0+.12),(.07,.96,.08),mat='edge')
    # Engine box amidships with lid, exhaust, and the reversing lever.
    m.box('engine-box',(-.12,0,z0+.50),(1.30,.74,.62),mat='naval')
    m.box('engine-box-lid',(-.12,0,z0+.83),(1.38,.82,.05),mat='roof')
    for x in [-.45,.21]:m.box('engine-lid-batten',(x,0,z0+.865),(.06,.82,.02),mat='edge')
    for side in [-1,1]:
        for x in [-.52,-.37,-.22,-.07,.08,.23]:m.box('engine-box-louvre',(x,side*.372,z0+.60),(.07,.012,.16),mat='dark')
    m.rod('exhaust-stack',(.30,.22,z0+.85),(.30,.22,z0+1.22),.045,mat='edge',vertices=10)
    m.rod('exhaust-mouth',(.30,.22,z0+1.215),(.30,.22,z0+1.225),.034,mat='dark',vertices=10)
    m.rod('reverse-lever',(-.86,.20,z0+.22),(-.95,.20,z0+.92),.018,mat='edge',vertices=6)
    m.rod('throttle-lever',(-.86,-.20,z0+.22),(-.90,-.20,z0+.74),.014,mat='edge',vertices=6)
    m.rod('fuel-tank-body',(2.62,-.30,z0+.52),(2.62,.30,z0+.52),.17,mat='edge',vertices=12)
    # Rudder, tiller, screw in its aperture and the skeg guard.
    sx=-3.95;plate_xz(m,'rudder',[(sx-.17,z0+1.10),(sx-.10,z0+.62),(sx+.02,z0+.12),(sx-.30,z0+.12),(sx-.36,z0+.48),(sx-.25,z0+.70),(sx-.24,z0+1.10)],.045,mat='naval')
    tube(m,'tiller',[(sx-.25,0,z0+1.13),(sx+.35,0,z0+1.25),(sx+1.25,0,z0+1.22)],.024,sides=6)
    for z in [z0+.30,z0+.85]:m.rod('rudder-pintle',(sx-.10,0,z-.05),(sx-.10,0,z+.05),.035,mat='edge',vertices=8)
    m.rod('propeller-shaft',(-2.75,0,z0+.10),(-3.34,0,z0+.13),.026,mat='bronze',vertices=8)
    propeller(m,(-3.40,0,z0+.135),.125)
    m.rod('skeg-guard',(-2.9,0,z0+.0),(sx+.06,0,z0+.0),.028,mat='edge',vertices=8)
    m.rod('skeg-heel',(sx+.06,0,z0+.0),(sx+.06,0,z0+.16),.028,mat='edge',vertices=8)
    # Hoisting eyes, bow fairlead, and stowed boat hook.
    for x in [-2.85,2.85]:
        m.rod('hoisting-rod',(x,0,z0+.06),(x,0,z0+.74),.018,mat='edge',vertices=6)
        m.path('hoisting-ring',[(x+.07*math.cos(i*math.tau/10),0,z0+.80+.07*math.sin(i*math.tau/10)) for i in range(10)],.013,mat='edge',closed=True,vertices=5)
    m.rod('boat-hook',(-.9,.62,z0+.66),(2.2,.52,z0+.70),.018,mat='roof',vertices=6)
    for side in [-1,1]:m.rod('bow-chock',(3.55,side*.20,hull.sheer(3.55)+.0),(3.55,side*.20,hull.sheer(3.55)+.10),.03,mat='edge',vertices=6)
    for x in [-1.75,1.75]:chock(m,hull,x)
    for x in [-2.62,2.62]:gripe(m,hull,x)
    return m.root


def create_ijn_launch(part,col,helpers,materials):
    """IJN 11 m motor launch: plumb stem, transom stern, forward cabin, open cockpit aft."""
    m=Model(col,helpers,materials);z0=.40
    hull=Hull([(-5.5,1.04,.24,1.18,.12,-.10),(-4.2,1.22,.10,1.15,.06,0),(-2.0,1.34,.01,1.15,0,0),(0,1.36,0,1.20,0,0),(2.0,1.27,0,1.31,.18,0),
               (3.8,.86,.02,1.47,.55,0),(4.95,.33,.06,1.60,.9,.04),(5.5,.02,.16,1.67,1,.10)],ROUND,z0,per=3)
    hull.build(m,'launch-hull');hull.transom(m,'transom',0)
    tube(m,'keel-and-stem',hull.keel_line(False),.055,sides=8)
    for side in [-1,1]:
        tube(m,'gunwale',hull.line(1,side,.012),.045,sides=8)
        tube(m,'rubbing-strake',hull.line(.84,side,.010),.04,sides=6)
        tube(m,'lower-strake',hull.line(.62,side,.006),.02,sides=6)
    hull.deck(m,'foredeck-and-cabin-sole',-.95,5.5,camber=.06)
    hull.deck(m,'afterdeck',-5.5,-4.55,camber=.04)
    hull.bulkhead(m,'cockpit-forward-bulkhead',-.95,top=z0+1.16)
    hull.bulkhead(m,'cockpit-after-bulkhead',-4.60,top=z0+1.13)
    # Forward cabin with portholes, then the lower engine casing.
    width=lambda x:min(1.02,hull.at(x)[1]-.24)
    top=z0+2.02
    side_y=cabin(m,hull,'forward-cabin',[(.85,1),(3.35,1),(3.85,.93)],top,width,camber=.10)
    section=lambda x,grow:[(x,-width(x)*.93-grow,top-.005),(x,-width(x)*.5,top+.08),(x,0,top+.10),(x,width(x)*.5,top+.08),(x,width(x)*.93+grow,top-.005),(x,width(x)*.93+grow,top-.05),(x,0,top+.045),(x,-width(x)*.93-grow,top-.05)]
    section_solid(m,'cabin-roof',[section(x,.07) for x in [.72,2.0,3.4,3.97]],mat='roof')
    for side in [-1,1]:
        for x in [1.25,1.95,2.65,3.30]:
            y=side_y(x,z0+1.70)
            m.rod('porthole-rim',(x,side*(y-.02),z0+1.70),(x,side*(y+.018),z0+1.70),.155,mat='edge',vertices=16)
            m.rod('porthole',(x,side*(y+.0),z0+1.70),(x,side*(y+.026),z0+1.70),.115,mat='dark',vertices=16)
        m.rod('cabin-grab-rail',(1.0,side*.62,top+.13),(3.3,side*.60,top+.13),.016,mat='edge',vertices=6)
        for x in [1.0,2.15,3.3]:m.rod('grab-rail-foot',(x,side*.61,top+.05),(x,side*.61,top+.13),.014,mat='edge',vertices=6)
    for y in [-.42,.42]:
        m.box('cabin-front-window',(3.855,y,z0+1.72),(.02,.42,.26),mat='dark')
        m.box('front-window-frame',(3.853,y,z0+1.72),(.012,.48,.32),mat='edge')
    m.box('cabin-door',(.84,0,z0+1.58),(.03,.56,.80),mat='edge')
    m.box('cabin-door-light',(.825,0,z0+1.78),(.03,.30,.22),mat='dark')
    casing_w=lambda x:.62
    cabin(m,hull,'engine-casing',[(-.95,1),(.85,1)],z0+1.66,casing_w,camber=.05)
    m.box('engine-skylight',(-.05,0,z0+1.73),(.95,.66,.07),mat='roof')
    for y in [-.17,.17]:m.box('skylight-glass',(-.05,y,z0+1.77),(.78,.24,.012),mat='dark')
    m.rod('exhaust-funnel',(.45,0,z0+1.66),(.38,0,z0+2.55),.085,mat='edge',vertices=12)
    m.rod('exhaust-mouth',(.381,0,z0+2.545),(.379,0,z0+2.557),.068,mat='dark',vertices=12)
    m.rod('funnel-band',(.40,0,z0+2.36),(.395,0,z0+2.41),.095,mat='roof',vertices=12)
    # Helm at the casing's after end, cockpit benches and bottom boards.
    m.rod('helm-pedestal',(-1.22,0,z0+.30),(-1.22,0,z0+1.18),.05,mat='edge',vertices=8)
    m.path('steering-wheel',[(-1.30,.24*math.cos(i*math.tau/16),z0+1.18+.24*math.sin(i*math.tau/16)) for i in range(16)],.016,mat='bronze',closed=True,vertices=5)
    for i in range(3):
        a=i*math.pi/3;m.rod('wheel-spoke',(-1.30,-.24*math.cos(a),z0+1.18-.24*math.sin(a)),(-1.30,.24*math.cos(a),z0+1.18+.24*math.sin(a)),.011,mat='bronze',vertices=5)
    m.rod('wheel-axle',(-1.32,0,z0+1.18),(-1.20,0,z0+1.18),.03,mat='edge',vertices=6)
    for y in [-.48,-.16,.16,.48]:m.box('cockpit-bottom-board',(-2.78,y,z0+.29),(3.55,.29,.035),mat='roof')
    for x in [-4.2,-3.0,-1.6]:m.box('board-bearer',(x,0,z0+.22),(.07,1.3,.10),mat='edge')
    for side in [-1,1]:
        pts=[(x,hull.half_width(x,z0+.72)) for x in [-4.55,-3.6,-2.6,-1.75]]
        verts=[(x,side*(y-d),z0+z) for z in [.70,.75] for x,y in pts for d in [.0,.40]]
        k=len(pts);faces=[]
        for layer,flip in [(0,True),(1,False)]:
            for i in range(k-1):
                a=layer*2*k+2*i;f=(a,a+2,a+3,a+1);faces.append(tuple(reversed(f)) if flip else f)
        for i in range(k-1):
            for d in [0,1]:faces.append((2*i+d,2*i+2+d,2*k+2*i+2+d,2*k+2*i+d))
        for i in [0,k-1]:faces.append((2*i,2*i+1,2*k+2*i+1,2*k+2*i))
        m.mesh('cockpit-side-bench',verts,faces,mat='roof')
        for x in [-4.2,-3.1,-2.1]:m.rod('bench-leg',(x,side*(hull.half_width(x,z0+.72)-.37),z0+.30),(x,side*(hull.half_width(x,z0+.72)-.37),z0+.70),.022,mat='edge',vertices=6)
    m.box('stern-bench',(-4.40,0,z0+.725),(.34,1.45,.05),mat='roof')
    # Canopy frame over the cockpit (canvas struck).
    ridge=[]
    for x in [-4.45,-3.35,-2.25,-1.15]:
        w=hull.at(x)[1]-.03;s=hull.sheer(x);h=z0+2.0
        tube(m,'canopy-hoop',[(x,-w,s),(x,-w*.97,h-.28),(x,-w*.72,h-.04),(x,0,h+.06),(x,w*.72,h-.04),(x,w*.97,h-.28),(x,w,s)],.02,sides=6)
        ridge.append((x,0,h+.06))
    tube(m,'canopy-ridge',ridge+[(.80,0,z0+2.08)],.018,sides=6)
    for side in [-1,1]:tube(m,'canopy-side-rail',[(x,side*(hull.at(x)[1]-.03)*.97,z0+1.72) for x in [-4.45,-3.35,-2.25,-1.15]]+[(.80,side*.94,z0+1.74)],.015,sides=6)
    # Foredeck fittings.
    m.cyl('bow-bollard',(4.55,0,hull.sheer(4.55)+.14),.06,.30,mat='edge',vertices=10)
    m.rod('bollard-crossbar',(4.55,-.16,hull.sheer(4.55)+.22),(4.55,.16,hull.sheer(4.55)+.22),.025,mat='edge',vertices=6)
    m.rod('jackstaff',(5.35,0,hull.sheer(5.4)),(5.35,0,hull.sheer(5.4)+1.0),.016,mat='edge',vertices=6)
    m.box('fore-hatch',(4.0,0,hull.sheer(4.0)+.07),(.5,.5,.10),mat='naval')
    m.rod('ensign-staff',(-5.42,0,hull.sheer(-5.4)),(-5.62,0,hull.sheer(-5.4)+1.15),.016,mat='edge',vertices=6)
    for side in [-1,1]:
        m.box('navigation-light-board',(3.0,side*1.0,top+.0),(.34,.04,.18),mat='edge')
        for x in [-5.1,4.2]:
            y=side*(hull.at(x)[1]-.14);m.box('mooring-cleat',(x,y,hull.sheer(x)+.05),(.26,.06,.05),mat='edge')
    # Rudder on the transom, shaft, screw and guard.
    sx=-5.5;plate_xz(m,'rudder',[(sx-.13,z0+1.22),(sx-.03,z0+.26),(sx-.06,z0+.04),(sx-.52,z0+.04),(sx-.56,z0+.50),(sx-.22,z0+.80),(sx-.20,z0+1.22)],.05,mat='naval')
    for z in [z0+.45,z0+1.0]:m.rod('rudder-gudgeon',(sx-.09,0,z-.06),(sx-.09,0,z+.06),.04,mat='edge',vertices=8)
    m.rod('rudder-head',(sx-.165,0,z0+1.2),(sx-.165,0,z0+1.34),.035,mat='edge',vertices=8)
    m.rod('rudder-yoke',(sx-.165,-.30,z0+1.32),(sx-.165,.30,z0+1.32),.02,mat='edge',vertices=6)
    m.rod('propeller-shaft',(-3.9,0,z0+.10),(-5.02,0,z0-.06),.03,mat='bronze',vertices=8)
    m.rod('shaft-strut',(-4.85,0,hull.keel(-4.85)),(-4.85,0,z0-.04),.035,mat='edge',vertices=8)
    propeller(m,(-5.10,0,z0-.07),.21)
    tube(m,'propeller-guard',[(-4.3,0,hull.keel(-4.3)-.02),(-4.8,0,z0-.31),(-5.45,0,z0-.31),(sx-.10,0,z0+.05)],.028,sides=6)
    for x in [-2.6,2.3]:chock(m,hull,x)
    gripe(m,hull,-3.85)
    s=hull.sheer(4.25);w=hull.at(4.25)[1]
    gripe(m,hull,4.25,over=[(4.25,-(w+.012),s+.045),(4.25,0,s+.10),(4.25,w+.012,s+.045)])
    return m.root


def create_rn_pinnace(part,col,helpers,materials):
    """Royal Navy 35 ft fast motor boat: raked stem, hard chine, long low cabin, cockpit aft."""
    m=Model(col,helpers,materials);z0=.40
    hull=Hull([(-5.35,1.13,.13,.98,0,-.16),(-3.6,1.27,.05,1.0,0,0),(-1.2,1.31,0,1.05,0,0),(1.3,1.22,0,1.15,.08,0),(3.1,.90,.05,1.29,.30,.10),
               (4.3,.47,.22,1.41,.62,.32),(4.95,.02,.62,1.49,1,.50)],CHINE,z0,per=3)
    hull.build(m,'pinnace-hull');hull.transom(m,'transom',0)
    tube(m,'keel-and-stem',hull.keel_line(False),.045,sides=8)
    for side in [-1,1]:
        tube(m,'gunwale-rubber',hull.line(1,side,.012),.048,sides=8)
        tube(m,'chine-spray-rail',hull.line(.23,side,.012),.03,sides=6)
        tube(m,'topside-strake',hull.line(.72,side,.008),.018,sides=6)
    hull.deck(m,'foredeck-and-side-decks',-1.95,4.95,camber=.07)
    hull.deck(m,'afterdeck',-5.35,-4.35,camber=.04)
    hull.bulkhead(m,'cockpit-forward-bulkhead',-1.95,top=z0+1.02)
    hull.bulkhead(m,'cockpit-after-bulkhead',-4.40,top=z0+.98)
    # Long low cabin with a raked windscreen and a stepped after shelter.
    width=lambda x:min(.92,hull.at(x)[1]-.30)
    top=z0+1.78
    side_y=cabin(m,hull,'cabin',[(-1.95,1),(1.75,1),(2.45,.12)],top,width,camber=.09)
    roof=lambda x,grow:[(x,-width(x)*.93-grow,top),(x,-width(x)*.5,top+.075),(x,0,top+.095),(x,width(x)*.5,top+.075),(x,width(x)*.93+grow,top),(x,width(x)*.93+grow,top-.04),(x,0,top+.05),(x,-width(x)*.93-grow,top-.04)]
    section_solid(m,'cabin-roof',[roof(x,.06) for x in [-2.35,-1.0,.6,1.82]],mat='roof')
    # Windscreen panes lie on the sloped face between x=1.75 and x=2.45.
    za=top;zb=hull.sheer(2.45)-.02+(top-hull.sheer(2.45)+.02)*.12
    for side in [-1,1]:
        pane=[]
        for t,yy in [(.12,.06),(.12,.70),(.80,.62),(.80,.06)]:
            x=lerp(2.45,1.75,t);z=lerp(zb,za,t)+.09*(1-abs(yy)/.9)*lerp(.12,1,t);pane.append((x+.02,side*yy,z+.025))
        m.mesh('windscreen',pane+[(x-.04,y,z-.03) for x,y,z in pane],[(0,1,2,3),(7,6,5,4)]+[(i,(i+1)%4,4+(i+1)%4,4+i) for i in range(4)],mat='dark')
        for x0,x1 in [(-1.55,-.85),(-.60,.10),(.35,1.05)]:side_window(m,'cabin-window',x0,x1,z0+1.36,z0+1.64,side,side_y)
        rail_on_posts(m,'roof-handrail',[(x,side*.52,top+.06) for x in [-1.7,-.55,.6,1.6]],.10,.014)
        m.box('navigation-light-box',(1.25,side*.80,top+.10),(.22,.10,.14),mat='edge')
    m.rod('windscreen-centre-bar',(2.40,0,zb+.12),(1.80,0,za+.09),.02,mat='edge',vertices=6)
    m.box('cabin-after-door',(-1.965,.0,z0+1.30),(.03,.58,.82),mat='edge')
    m.box('cabin-door-light',(-1.985,0,z0+1.52),(.03,.30,.20),mat='dark')
    m.rod('mast',(.2,0,top+.08),(.05,0,top+1.35),.022,mat='edge',vertices=6)
    m.rod('mast-yard',(.10,-.32,top+1.05),(.10,.32,top+1.05),.012,mat='edge',vertices=5)
    m.cyl('masthead-light',(.05,0,top+1.38),.035,.07,mat='dark',vertices=8)
    for y in [-.35,.35]:
        m.rod('cowl-vent-trunk',(-.9,y,top+.05),(-.9,y,top+.30),.05,mat='naval',vertices=10)
        m.rod('cowl-vent-mouth',(-.92,y,top+.30),(-.80,y,top+.30),.075,mat='naval',r2=.085,vertices=10)
        m.rod('cowl-vent-dark',(-.802,y,top+.30),(-.797,y,top+.30),.07,mat='dark',vertices=10)
    # Cockpit: helm on the bulkhead, engine hatch, side seats, bottom boards.
    for y in [-.42,-.14,.14,.42]:m.box('cockpit-bottom-board',(-3.17,y,z0+.30),(2.35,.25,.035),mat='roof')
    for x in [-4.0,-3.1,-2.3]:m.box('board-bearer',(x,0,z0+.22),(.07,1.2,.12),mat='edge')
    m.box('engine-hatch',(-3.2,0,z0+.50),(1.05,.70,.38),mat='naval')
    m.box('engine-hatch-lid',(-3.2,0,z0+.71),(1.12,.78,.04),mat='roof')
    m.path('steering-wheel',[(-2.06,.42+.20*math.cos(i*math.tau/16),z0+1.06+.20*math.sin(i*math.tau/16)) for i in range(16)],.015,mat='bronze',closed=True,vertices=5)
    for i in range(3):
        a=i*math.pi/3;m.rod('wheel-spoke',(-2.06,.42-.20*math.cos(a),z0+1.06-.20*math.sin(a)),(-2.06,.42+.20*math.cos(a),z0+1.06+.20*math.sin(a)),.010,mat='bronze',vertices=5)
    m.rod('wheel-axle',(-2.06,.42,z0+1.06),(-1.94,.42,z0+1.06),.028,mat='edge',vertices=6)
    for side in [-1,1]:
        for x in [-4.0,-3.3,-2.6]:
            y=hull.half_width(x,z0+.70)-.19
            m.box('cockpit-side-seat',(x,side*y,z0+.70),(.66,.36,.05),mat='roof')
    m.box('stern-seat',(-4.24,0,z0+.70),(.26,1.5,.05),mat='roof')
    tube(m,'cockpit-coaming',[(-1.95,-1.0,z0+1.08),(-3.2,-1.04,z0+1.06),(-4.36,-.96,z0+1.04),(-4.36,.96,z0+1.04),(-3.2,1.04,z0+1.06),(-1.95,1.0,z0+1.08)],.028,sides=6)
    # Foredeck and stern fittings.
    fx=3.75;m.cyl('bow-bollard',(fx,0,hull.sheer(3.4)+.17),.055,.26,mat='edge',vertices=10)
    m.rod('bollard-crossbar',(fx,-.15,hull.sheer(3.4)+.23),(fx,.15,hull.sheer(3.4)+.23),.022,mat='edge',vertices=6)
    m.box('fore-hatch',(2.95,0,hull.sheer(2.95)+.08),(.52,.52,.09),mat='naval')
    m.rod('jackstaff',(5.25,0,hull.sheer(4.9)-.02),(5.25,0,hull.sheer(4.9)+.85),.014,mat='edge',vertices=6)
    m.rod('ensign-staff',(-5.38,0,hull.sheer(-5.3)),(-5.62,0,hull.sheer(-5.3)+1.1),.015,mat='edge',vertices=6)
    for side in [-1,1]:
        for x in [-4.9,3.3]:
            y=side*(hull.at(x)[1]-.13);m.box('mooring-cleat',(x+(.08 if x>0 else 0),y,hull.sheer(x)+.05),(.24,.055,.05),mat='edge')
        for x in [2.6,3.5,4.3]:
            st=hull.at(x);m.rod('toe-rail-post',(x+st[5],side*(st[1]-.06),hull.sheer(x)),(x+st[5],side*(st[1]-.06),hull.sheer(x)+.09),.012,mat='edge',vertices=5)
    # Rudder, shaft, P-bracket, screw and guard under the flat run aft.
    sx=-5.35;plate_xz(m,'rudder',[(sx+.32,z0+.10),(sx+.30,z0-.30),(sx-.08,z0-.30),(sx-.10,z0+.12)],.04,mat='naval')
    m.rod('rudder-stock',(sx+.20,0,z0-.05),(sx+.20,0,z0+.24),.03,mat='edge',vertices=8)
    m.rod('propeller-shaft',(-3.6,0,z0+.06),(-4.80,0,z0-.12),.028,mat='bronze',vertices=8)
    for side in [-1,1]:m.rod('p-bracket',(-4.62,side*.20,hull.z_at(-4.62,.20)),(-4.62,0,z0-.095),.025,mat='edge',vertices=6)
    propeller(m,(-4.88,0,z0-.13),.19)
    tube(m,'propeller-guard',[(-4.1,0,hull.keel(-4.1)-.02),(-4.55,0,z0-.33),(-5.1,0,z0-.33),(sx+.11,0,z0-.30)],.026,sides=6)
    for x in [-2.9,1.9]:chock(m,hull,x,frac=.70)
    gripe(m,hull,-4.0)
    s=hull.sheer(3.35);st=hull.at(3.35);w=st[1]
    gripe(m,hull,3.35,over=[(3.35,-(w+.012),s+.045),(3.35,0,s+.115),(3.35,w+.012,s+.045)])
    return m.root


def create_boat_crane(part,col,helpers,materials):
    """Nation-neutral boat and stores crane: pedestal, machinery house, lattice jib toward +X."""
    m=Model(col,helpers,materials)
    m.cyl('foundation-flange',(0,0,.11),1.08,.22,mat='edge',vertices=40)
    m.bolts(.95,.245,16)
    m.cyl('pedestal',(0,0,1.35),.72,2.30,mat='naval',vertices=40,r2=.66)
    for a in range(8):
        c,s=math.cos(a*math.tau/8+.39),math.sin(a*math.tau/8+.39)
        m.mesh('pedestal-gusset',[(c*.70-s*.02,s*.70+c*.02,.22),(c*1.02-s*.02,s*1.02+c*.02,.22),(c*.69-s*.02,s*.69+c*.02,.85),(c*.70+s*.02,s*.70-c*.02,.22),(c*1.02+s*.02,s*1.02-c*.02,.22),(c*.69+s*.02,s*.69-c*.02,.85)],
               [(0,1,2),(5,4,3),(0,3,4,1),(1,4,5,2),(2,5,3,0)],mat='naval')
    m.box('pedestal-door',(-.705,0,1.15),(.04,.55,1.45),mat='edge')
    m.cyl('slewing-ring',(0,0,2.62),1.05,.24,mat='edge',vertices=48)
    m.cyl('slewing-gear-skirt',(0,0,2.47),.92,.10,mat='dark',vertices=48)
    m.bolts(.97,2.765,20)
    m.ladder('pedestal-ladder',(-.80,.0,.22),(-.80,.0,2.80),.42,mat='edge')
    # Machinery house on the rotating platform.
    outline=[(-2.35,-1.25),(1.30,-1.25),(1.30,1.25),(-2.35,1.25)]
    m.prism('house-platform',outline,2.74,2.86,mat='roof')
    m.box('machinery-house',(-.65,0,3.86),(2.70,1.90,2.00),mat='naval')
    m.box('house-roof',(-.65,0,4.90),(2.86,2.06,.09),mat='roof')
    m.box('counterweight',(-2.12,0,3.36),(.42,1.70,1.0),mat='edge')
    m.box('operator-front-window',(.705,0,4.30),(.03,1.40,.56),mat='dark')
    for y in [-.24,.24]:m.box('front-window-mullion',(.72,y,4.30),(.03,.04,.60),mat='edge')
    for side in [-1,1]:
        m.box('operator-side-window',(.20,side*.955,4.30),(.80,.03,.56),mat='dark')
        m.box('house-door',(-.95,side*.955,3.80),(.62,.03,1.62),mat='edge')
        m.rod('door-port',(-.95,side*.965,4.25),(-.95,side*.985,4.25),.11,mat='dark',vertices=12)
        for x in [-1.75,-1.55,-1.35]:m.box('house-louvre',(x,side*.955,3.45),(.12,.03,.70),mat='dark')
    rail=[(-2.30,-1.20,2.86),(1.25,-1.20,2.86),(1.25,-.62,2.86)]
    for side in [-1,1]:
        pts=[(x,side*1.20 if abs(y)>1 else side*.62,z) for x,y,z in rail]
        for h in [.5,1.0]:tube(m,'platform-rail',[(x,y,z+h) for x,y,z in pts],.02,sides=6)
        for x in [-2.30,-1.1,.1,1.25]:m.rod('platform-stanchion',(x,side*1.20,2.86),(x,side*1.20,3.86),.022,mat='edge',vertices=6)
        m.rod('platform-stanchion',(1.25,side*.62,2.86),(1.25,side*.62,3.86),.022,mat='edge',vertices=6)
    for h in [.5,1.0]:m.rod('platform-rail-aft',(-2.30,-1.20,2.86+h),(-2.30,1.20,2.86+h),.02,mat='edge',vertices=6)
    # Jib: four chords converging on the heel pin and the head, 12 m at 35 degrees.
    heel=Vector((.95,0,3.30));along=Vector((math.cos(math.radians(35)),0,math.sin(math.radians(35))));up=Vector((-along.z,0,along.x));side_axis=Vector((0,1,0))
    length=12.0;head=heel+along*length
    for side in [-1,1]:
        m.box('jib-heel-bracket',(.95,side*.62,3.22),(.50,.10,.72),mat='edge')
    m.rod('jib-heel-pin',tuple(heel-side_axis*.72),tuple(heel+side_axis*.72),.07,mat='edge',vertices=12)
    def frame(t):
        widths=lerp(.56,.20,t);depth=.06+.50*math.sin(math.pi*min(1,t/.30)/2) if t<.30 else lerp(.56,.17,(t-.30)/.70)
        c=heel+along*length*t
        return [c+side_axis*sy*widths+up*sz*depth for sy,sz in [(-1,-1),(1,-1),(1,1),(-1,1)]]
    bays=12;frames=[frame(i/bays) for i in range(bays+1)]
    for c in range(4):
        tube(m,'jib-chord',[f[c] for f in frames],.045,mat='naval',sides=6)
    for i,(a,b) in enumerate(zip(frames,frames[1:])):
        for c in range(4):
            d=(c+1)%4
            m.rod('jib-batten',tuple(b[c]),tuple(b[d]),.022,mat='naval',vertices=5)
            p,q=(a[c],b[d]) if i%2==0 else (a[d],b[c])
            m.rod('jib-lacing',tuple(p),tuple(q),.02,mat='edge',vertices=5)
    # Head: cheek plates, sheaves, and the hoist fall to the hook block.
    m.rod('jib-head-axle',tuple(head-side_axis*.30+along*.10),tuple(head+side_axis*.30+along*.10),.05,mat='edge',vertices=10)
    axle=head+along*.10
    for side in [-1,1]:
        m.rod('jib-head-cheek',tuple(axle+side_axis*side*.20),tuple(axle+side_axis*side*.235),.30,mat='naval',vertices=16)
    for y in [-.09,.09]:m.rod('head-sheave',tuple(axle+side_axis*(y-.035)),tuple(axle+side_axis*(y+.035)),.24,mat='edge',vertices=20)
    block=Vector((axle.x+.24,0,axle.z-1.5))
    for y in [-.09,.09]:m.rod('hoist-fall',(axle.x+.24,y,axle.z),(block.x,y*.6,block.z+.18),.016,mat='dark',vertices=5)
    for side in [-1,1]:m.rod('hook-block-cheek',(block.x,side*.085,block.z),(block.x,side*.115,block.z),.21,mat='edge',vertices=16)
    m.rod('hook-block-sheave',(block.x,-.085,block.z),(block.x,.085,block.z),.17,mat='naval',vertices=16)
    m.rod('hook-swivel',(block.x,0,block.z-.18),(block.x,0,block.z-.36),.04,mat='edge',vertices=8)
    tube(m,'hook',[(block.x,0,block.z-.36),(block.x+.02,0,block.z-.50),(block.x+.12,0,block.z-.62),(block.x+.02,0,block.z-.72),(block.x-.11,0,block.z-.66),(block.x-.14,0,block.z-.55)],.032,sides=6)
    m.cyl('hook-ball-weight',(block.x,0,block.z+.28),.12,.22,mat='edge',vertices=12)
    # A-frame on the house roof with the topping lift and hoist lead.
    apex=Vector((-1.35,0,7.75))
    for side in [-1,1]:
        m.rod('a-frame-back-leg',(-1.90,side*.85,4.94),tuple(apex+side_axis*side*.16),.075,mat='naval',vertices=8)
        m.rod('a-frame-front-leg',(.35,side*.85,4.94),tuple(apex+side_axis*side*.16),.06,mat='naval',vertices=8)
        m.box('a-frame-foot',(-1.90,side*.85,4.97),(.30,.24,.06),mat='edge');m.box('a-frame-foot',(.35,side*.85,4.97),(.30,.24,.06),mat='edge')
        m.rod('a-frame-brace',(-1.62,side*.50,6.35),(-.50,side*.50,6.35),.035,mat='naval',vertices=6)
        m.rod('topping-lift',tuple(apex+side_axis*side*.12),tuple(frames[-1][2 if side>0 else 3]),.02,mat='dark',vertices=5)
        m.rod('topping-lift-link',tuple(frames[-1][2 if side>0 else 3]),tuple(axle+side_axis*side*.20+up*.2),.03,mat='edge',vertices=5)
    m.rod('a-frame-cross-tie',(-1.62,-.50,6.35),(-1.62,.50,6.35),.035,mat='naval',vertices=6)
    m.rod('a-frame-cross-tie',(-.50,-.50,6.35),(-.50,.50,6.35),.035,mat='naval',vertices=6)
    m.rod('a-frame-head-pin',tuple(apex-side_axis*.26),tuple(apex+side_axis*.26),.06,mat='edge',vertices=10)
    m.rod('a-frame-sheave',tuple(apex-side_axis*.05),tuple(apex+side_axis*.05),.20,mat='edge',vertices=16)
    m.rod('hoist-lead',tuple(apex+Vector((.05,0,.18))),tuple(axle+up*.24),.016,mat='dark',vertices=5)
    m.rod('hoist-lead-to-winch',tuple(apex+Vector((-.18,0,0))),(-1.55,0,4.98),.016,mat='dark',vertices=5)
    m.box('winch-roof-trunk',(-1.55,0,5.0),(.40,.50,.12),mat='edge')
    m.ladder('house-ladder',(-1.30,1.02,2.88),(-1.30,1.02,4.92),.40,mat='edge')
    m.cyl('roof-vent',(-.2,-.55,5.08),.14,.28,mat='naval',vertices=12)
    m.cyl('roof-vent-cap',(-.2,-.55,5.24),.19,.05,mat='roof',vertices=12)
    return m.root
