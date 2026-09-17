"""Reusable original Japanese funnels, tripod foremast and fire-control directors.

Source adaptations of the original ship recipes (assets/ships/yamato/build.py,
assets/ships/mogami/superstructure.py, assets/ships/fubuki/build.py,
assets/ships/yukikaze/build.py + refinements.py), normalised to an installation
datum on the deck. Jacket stations are hard-coded from the owning blueprints; no
published or reference model is an input.
"""
import sys, math
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'construction'))
from geometry import Model


def _sgn(v):return 0 if abs(v)<1e-9 else (1 if v>0 else -1)


class Stack:
    """Lofted uptake jacket. Stations are (z, aft x, fore x, half breadth, corner radius)."""
    def __init__(self,m,stations,slope,n=48,ellipse=False):
        self.m,self.st,self.slope,self.n,self.ellipse=m,stations,slope,n,ellipse
        self.top=stations[-1][0]

    def _ring(self,k,grow=0):
        z,x0,x1,w,r=self.st[k];cx=(x0+x1)/2;hl=(x1-x0)/2+grow;w+=grow;r=min(r+grow,w,hl)
        slope=self.slope if k==len(self.st)-1 else 0;out=[]
        for i in range(self.n):
            a=i*math.tau/self.n;c,s=math.cos(a),math.sin(a)
            if self.ellipse:x,y=hl*c,w*s
            else:x,y=_sgn(c)*(hl-r)+r*c,_sgn(s)*(w-r)+r*s
            out.append(Vector((cx+x,y,z+slope*x)))
        return out

    def _seg(self,z):
        z=min(max(z,self.st[0][0]),self.top)
        for k in range(len(self.st)-1):
            a,b=self.st[k][0],self.st[k+1][0]
            if z<=b+1e-9:return k,(z-a)/(b-a)
        return len(self.st)-2,1

    def ring(self,z,grow=0):
        k,t=self._seg(z);return [a.lerp(b,t) for a,b in zip(self._ring(k,grow),self._ring(k+1,grow))]

    def params(self,z):
        k,t=self._seg(z);a,b=self.st[k],self.st[k+1]
        sl=t*self.slope if k==len(self.st)-2 else 0
        return [a[i]+(b[i]-a[i])*t for i in range(1,5)]+[sl]

    def side(self,z,offset,sign,gap=0):
        x0,x1,w,r,sl=self.params(z);return Vector(((x0+x1)/2+offset,sign*(w+gap),z+sl*offset))

    def fore(self,z,gap=0):
        x0,x1,w,r,sl=self.params(z);return Vector((x1+gap,0,z+sl*(x1-x0)/2))

    def aft(self,z,gap=0):
        x0,x1,w,r,sl=self.params(z);return Vector((x0-gap,0,z-sl*(x1-x0)/2))

    def shell(self,name,cap=.8,inset=.93,depth=1.3):
        """Closed jacket with an open, dark-lined mouth and a blackened cap."""
        n=self.n;zs=[s[0] for s in self.st[:-1]]+[self.top-cap,self.top]
        rings=[self.ring(z) for z in zs];K=len(rings);top=rings[-1]
        c=sum(top,Vector())/n;down=(sum(rings[-3],Vector())/n-c).normalized()*depth
        inner=[c+(p-c)*inset for p in top];deep=[p+down for p in inner]
        vs=[tuple(p) for row in rings+[inner,deep] for p in row]
        fs=[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(K+1) for i in range(n)]
        fs+=[tuple(range(n)),tuple(range((K+1)*n,(K+2)*n))]
        o=self.m.mesh(name,vs,fs,smooth=True);o.data.materials.append(self.m.m['dark'])
        for i,p in enumerate(o.data.polygons):
            if i>=(K-2)*n:p.material_index=1
            if i>=(K+1)*n:p.use_smooth=False
        return o

    def band(self,name,z,r,grow=.0,mat='edge',vertices=6):
        self.m.path(name,self.ring(z,grow),r,closed=True,mat=mat,vertices=vertices)


def _ladder(m,name,points,across,width=.40,standoff=None,**kw):
    """Ladder following a polyline; `across` is the rung direction."""
    across=Vector(across).normalized()*width/2;points=[Vector(p) for p in points]
    for a,b in zip(points,points[1:]):
        for s in (-1,1):m.rod(name+'.stringer',a+s*across,b+s*across,.026,mat='edge',vertices=6,**kw)
        steps=max(1,math.ceil((b-a).length/.32))
        for i in range(steps):
            p=a.lerp(b,i/steps);m.rod(name+'.rung',p-across,p+across,.017,mat='edge',vertices=6,**kw)
        if standoff:
            for s in (-1,1):m.rod(name+'.standoff',a+s*across,a+s*across+Vector(standoff),.024,mat='edge',vertices=6,**kw)


def _arch(a,b,rise,count=8):
    a,b=Vector(a),Vector(b);return [a.lerp(b,i/count)+Vector((0,0,rise*math.sin(math.pi*i/count))) for i in range(count+1)]


def _rail(m,name,outline,z,height,r=.02,mid=True,**kw):
    top=[(x,y,z+height) for x,y in outline]
    m.path(name,top,r,closed=True,mat='edge',vertices=6,**kw)
    if mid:m.path(name,[(x,y,z+height*.5) for x,y in outline],r*.8,closed=True,mat='edge',vertices=6,**kw)
    for x,y in outline:m.rod(name+'.stanchion',(x,y,z),(x,y,z+height),r,mat='edge',vertices=6,**kw)


# --- Yamato: single heavily raked capsule funnel -------------------------------------------
YAMATO=[(0,-6.5,6.5,3.1,3.1),(2,-6.5,5.1,2.8,2.8),(5,-6.84,3.32,2.46,2.46),(8.5,-7.3,1.5,1.89,1.89),(12,-8.26,.46,1.89,1.89),(14.45,-8.76,-.04,1.89,1.89)]

def create_battleship_funnel(part,col,helpers,materials):
    m=Model(col,helpers,materials);f=Stack(m,YAMATO,.15,48)
    f.shell('jacket',cap=1.5,inset=.92,depth=1.6)
    f.band('base-flange',.11,.10,.03)
    for z in (2,5,8.5,12):f.band('shell-band',z,.05,.01)
    f.band('cap-band',f.top-1.5,.075,.02);f.band('cap-lip',f.top,.10,.02,vertices=8)
    # Vertical stiffeners follow the same lofted rings as the jacket.
    levels=[2,5,8.5,12,f.top-1.5];rows=[f.ring(z,.015) for z in levels]
    for j in (3,9,15,21,27,33,39,45):
        for a,b in zip(rows,rows[1:]):m.rod('stiffener',a[j],b[j],.07,mat='edge',vertices=7)
    # Rain guard: arched fore-and-aft bars on the sloping rim, tied by transverse hoops.
    top=f.ring(f.top);cx=-4.4;hl,w=4.36,1.89
    def rim(x,y):return Vector((cx+x,y,f.top+.15*x))
    for y in (-1.4,-.7,0,.7,1.4):
        e=(hl-w)+w*math.sqrt(1-(y/w)**2)
        m.path('rain-guard',_arch(rim(-e,y),rim(e,y),.55,12),.04,mat='edge',vertices=6)
    for x in (-3.0,-1.5,0,1.5,3.0):
        lift=.55*math.sin(math.pi*(x+hl)/(2*hl))
        m.path('rain-guard-hoop',[rim(x,-w),rim(x,-1.4)+Vector((0,0,lift*.93)),rim(x,0)+Vector((0,0,lift)),rim(x,1.4)+Vector((0,0,lift*.93)),rim(x,w)],.032,mat='edge',vertices=6)
    for side in (-1,1):
        # Bent external steam lines follow the rake on the narrow capsule shell.
        for offset in (-2.0,0,2.0):
            route=[f.side(z,offset,side,.16) for z in (.12,2,5,8.5,12,14.1)]
            route.append(route[-1]+Vector((-.05,0,.75)))
            m.path('steam-line',route,.10,mat='edge',vertices=10)
            m.rod('steam-cowl',route[-1]-Vector((0,0,.22)),route[-1],.15,mat='edge',vertices=10)
            for p in route[1:-1]:m.rod('steam-clamp',p,(p.x,p.y-side*.30,p.z),.052,mat='edge',vertices=8)
        # Inspection ladders on the forward quarters of the raked face.
        pts=[f.side(z,(f.params(z)[1]-f.params(z)[0])/2-f.params(z)[2]-.35,side,.10) for z in (.1,2,5,8.5,12,14.2)]
        _ladder(m,'inspection-ladder',pts,(1,0,0),.5,standoff=(0,-side*.14,0))
    # Searchlight / inspection gallery ring partway up the aft face, with knees.
    walk=f.ring(8.5,.75);inner=f.ring(8.5,0);n=f.n;idx=list(range(13,36))
    vs=[tuple(inner[i]) for i in idx]+[tuple(walk[i]) for i in idx]+[(p.x,p.y,p.z-.08) for p in [inner[i] for i in idx]]+[(p.x,p.y,p.z-.08) for p in [walk[i] for i in idx]]
    k=len(idx);fs=[]
    for i in range(k-1):fs+=[(i,i+1,k+i+1,k+i),(2*k+i,3*k+i,3*k+i+1,2*k+i+1),(k+i,k+i+1,3*k+i+1,3*k+i)]
    fs+=[(0,k,3*k,2*k),(k-1,2*k-1,4*k-1,3*k-1)]
    m.mesh('aft-gallery',vs,fs,mat='roof')
    m.path('aft-gallery-rail',[walk[i]+Vector((0,0,1.0)) for i in idx],.022,mat='edge',vertices=6)
    m.path('aft-gallery-rail',[walk[i]+Vector((0,0,.5)) for i in idx],.018,mat='edge',vertices=6)
    for i in idx[::2]:
        m.rod('aft-gallery-stanchion',walk[i],walk[i]+Vector((0,0,1.0)),.022,mat='edge',vertices=6)
        low=f.ring(7.4,0)[i];m.rod('aft-gallery-knee',low,walk[i]-Vector((0,0,.06)),.04,mat='edge',vertices=6)
    return m.root


# --- Mogami: forward uptake swept aft into the after stack --------------------------------
MOGAMI_FORE=[(0,1.5,11.3,2.42,1.52),(1.7,-.3,11.4,2.39,1.5),(2.7,-2.6,10.75,2.37,1.48),(3.7,-4.4,8.1,2.33,1.45),(4.7,-5.85,5.45,2.28,1.42),(5.7,-6.95,2.8,2.24,1.38),(6.7,-7.85,.15,2.2,1.35),(7.7,-8.3,-2.0,2.21,1.32),(8.7,-8.5,-2.9,2.23,1.29),(9.7,-8.55,-3.22,2.26,1.26),(11.5,-8.55,-3.56,2.3,1.24)]
MOGAMI_AFT=[(0,-12.0,-7.85,2.35,1.16),(2.7,-12.0,-7.88,2.35,1.13),(6.7,-12.0,-8.16,2.35,1.08),(9.9,-11.95,-8.27,2.35,1.03),(10.62,-11.95,-8.27,2.35,1.03)]

def create_trunked_funnel(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    for label,stations,cap,pipes in (('forward',MOGAMI_FORE,.9,(-.5,.5)),('after',MOGAMI_AFT,.6,(-.55,.45))):
        f=Stack(m,stations,.24,40);f.shell(label+'-jacket',cap=cap,inset=.94,depth=1.1)
        f.band(label+'-base-flange',.09,.08,.03);f.band(label+'-cap-lip',f.top,.075,.015,vertices=8)
        f.band(label+'-cap-band',f.top-cap,.05,.012)
        for s in stations[1:-1:2]:f.band(label+'-seam',s[0],.024,.006)
        x0,x1,w,r,sl=f.params(f.top);cx=(x0+x1)/2
        # Arched spark guards follow the sloping mouth instead of covering it.
        for yy in (-1.0,0,1.0):
            a=Vector((x0+.12,yy,f.top+.24*(x0+.12-cx)));b=Vector((x1-.12,yy,f.top+.24*(x1-.12-cx)))
            m.path(label+'-spark-guard',_arch(a,b,.36),.036,mat='edge',vertices=8)
        for xx in (x0+.75,cx,x1-.75):
            lift=.36*math.sin(math.pi*(xx-x0-.12)/(x1-x0-.24));zz=f.top+.24*(xx-cx)
            m.path(label+'-transverse-grille',[(xx,-w,zz),(xx,-1.0,zz+lift),(xx,0,zz+lift),(xx,1.0,zz+lift),(xx,w,zz)],.031,mat='edge',vertices=8)
        # Slender steam pipes and saddles follow the uptake curve on both sides.
        for sign in (-1,1):
            for offset in pipes:
                pts=[f.side(max(.0,s[0]-.45) if i else .1,offset,sign,.13) for i,s in enumerate(stations)]
                pts[-1]=f.side(f.top-.35,offset,sign,.13);pts.append(pts[-1]+Vector((0,0,.75)))
                m.path(label+'-steam-pipe',pts,.078,vertices=10)
                for p in pts[1:-1:2]:m.rod(label+'-pipe-saddle',p,(p.x,p.y-sign*.2,p.z),.034,mat='edge',vertices=6)
                m.rod(label+'-pipe-cowl',pts[-1]-Vector((0,0,.3)),pts[-1]+Vector((0,0,.05)),.115,mat='edge',vertices=12)
        # The forward trunk carries its ladder up the swept face; the after stack on its aft face.
        if label=='forward':pts=[f.fore(max(.08,s[0]),.07) for s in stations[:-1]]+[f.fore(f.top-.2,.07)];off=(-.09,0,0)
        else:pts=[f.aft(z,.07) for z in (.08,2.7,6.7,9.9)];off=(.09,0,0)
        _ladder(m,label+'-uptake-ladder',pts,(0,1,0),.5,standoff=off)
    return m.root


# --- Fubuki: single raked oval destroyer funnel --------------------------------------------
FUBUKI=[(0,-2.12,2.12,1.46,1.46),(.55,-1.97,1.83,1.26,1.26),(1.2,-2.06,1.74,1.26,1.26),(6.85,-2.82,.98,1.26,1.26),(8.15,-3.0,.8,1.26,1.26)]

def create_destroyer_funnel(part,col,helpers,materials):
    m=Model(col,helpers,materials);f=Stack(m,FUBUKI,.25,48,ellipse=True)
    f.shell('jacket',cap=1.1,inset=.92,depth=.9)
    f.band('base-flange',.07,.06,.02);f.band('skirt-band',.55,.035,.008)
    for z in (2.3,4.4,6.2):f.band('seam',z,.023,.006)
    f.band('cap-band',f.top-1.1,.04,.01);f.band('rolled-lip',f.top,.05,.015,vertices=8)
    rim=f.ring(f.top);N=f.n;cx=-1.1
    # Arched cap ribs sit on the actual rim at both ends, tied by a transverse spine.
    for offset in (-.65,0,.65):
        a=rim[int((.5-offset*.12)*N)%N];b=rim[int((offset*.12)*N)%N]
        m.path('cap-rib',_arch(a,b,.26,12),.024,mat='edge',vertices=6)
    m.path('cap-spine',_arch(rim[3*N//4],rim[N//4],.26,10),.023,mat='edge',vertices=6)
    # External steam / waste pipes up the fore and aft faces, ending in cowls above the rim.
    for face,gap in ((f.fore,1),(f.aft,1)):
        pts=[face(z,.13) for z in (.1,.55,1.2,6.85,7.9)];pts.append(pts[-1]+Vector((0,0,.75)))
        m.path('steam-pipe',pts,.075,vertices=10)
        m.rod('pipe-cowl',pts[-1]-Vector((0,0,.22)),pts[-1]+Vector((0,0,.04)),.11,mat='edge',vertices=10)
        for z in (2.0,4.2,6.4):
            p=face(z,.13);q=face(z,0);m.rod('pipe-bracket',p,q,.027,mat='edge',vertices=6)
    pts=[f.aft(z,.30)+Vector((0,.42,0)) for z in (1.2,6.85,7.6)]
    m.path('whistle-pipe',pts,.04,mat='edge',vertices=8)
    m.rod('steam-whistle',pts[-1],pts[-1]+Vector((0,0,.34)),.07,mat='bronze',vertices=10)
    m.rod('whistle-bracket',pts[-1],pts[-1]+Vector((.32,-.1,0)),.022,mat='edge',vertices=6)
    # Port-side ladder with grabs, and a footrail hoop for the funnel-cover party.
    pts=[f.side(z,.0,-1,.09) for z in (.1,.55,1.2,6.85,7.75)]
    _ladder(m,'ladder',pts,(1,0,0),.36,standoff=(0,.12,0))
    for offset in (-.45,.35):
        pts=[f.side(z,offset,1,.06) for z in (.07,.55,1.2,6.85,7.8)];pts.append(pts[-1]+Vector((0,0,.7)))
        m.path('galley-pipe',pts,.05,mat='edge',vertices=8)
        for z in (2.0,4.2,6.4):p=f.side(z,offset,1,.06);m.rod('galley-pipe-clip',p,(p.x,p.y-.12,p.z),.022,mat='edge',vertices=6)
    for z in (2.5,5.0):p=f.aft(z,.30)+Vector((0,.42,0));m.rod('whistle-pipe-clip',p,f.aft(z,0)+Vector((0,.30,0)),.02,mat='edge',vertices=6)
    hoop=f.ring(6.0,.22);m.path('footrail',hoop,.02,closed=True,mat='edge',vertices=6)
    for i in range(0,N,6):m.rod('footrail-stay',hoop[i],f.ring(6.0,0)[i],.018,mat='edge',vertices=6)
    return m.root


# --- Yukikaze: tripod foremast with Type 22 horns ------------------------------------------
def create_tripod_foremast(part,col,helpers,materials):
    m=Model(col,helpers,materials);H=18.2
    def pole(z,dx=0):return Vector((-z/H+dx,0,z))
    m.cyl('pole-foot',(0,0,.05),.30,.10,mat='edge',vertices=16);m.bolts(.24,.10,8)
    m.rod('pole',pole(.03),pole(12.6),.14,r2=.095,mat='edge',vertices=16)
    m.rod('topmast',pole(12.4),pole(H),.085,r2=.035,mat='edge',vertices=12)
    m.cyl('topmast-cap',tuple(pole(12.5)),.125,.22,mat='edge',vertices=12)
    head=Vector((-.55,0,10.6))
    for sign in (-1,1):
        foot=Vector((-2.1,sign*1.65,0))
        m.cyl('leg-foot',(foot.x,foot.y,.04),.22,.08,mat='edge',vertices=12)
        m.rod('tripod-leg',foot.lerp(head,.006),head,.10,r2=.06,vertices=12)
        for z in (2.3,4.3,6.3,8.3):m.rod('leg-brace',foot.lerp(head,z/10.6),pole(z+2),.032,mat='edge',vertices=6)
    for z in (3.4,7.0):
        a=Vector((-2.1,-1.65,0)).lerp(Vector((-.55,0,10.6)),z/10.6);b=Vector((a.x,-a.y,a.z))
        m.rod('leg-spreader',a,b,.035,mat='edge',vertices=6)
    m.cyl('hounds-collar',tuple(pole(10.6)),.17,.30,mat='edge',vertices=12)
    # Type 22 platform carried forward of the pole on a knee, with the two stacked horns.
    plat=[(-.8,-.65),(-.7,-.75),(2.2,-.75),(2.3,-.65),(2.3,.65),(2.2,.75),(-.7,.75),(-.8,.65)]
    m.prism('radar-platform',plat,8.60,8.75,mat='roof')
    m.rod('platform-knee',pole(7.3),(1.7,0,8.63),.08,vertices=8)
    for sign in (-1,1):m.rod('platform-side-knee',pole(7.9),(.9,sign*.62,8.62),.045,mat='edge',vertices=6)
    _rail(m,'platform-rail',plat,8.75,.95,.018)
    m.box('radar-office',(.58,0,9.50),(.50,.62,1.50))
    m.box('radar-office-roof',(.58,0,10.28),(.60,.72,.06),mat='roof')
    for z in (9.2,9.95):
        m.rod('type-22-horn',(.85,0,z),(2.15,0,z),.12,r2=.26,vertices=24)
        m.rod('type-22-horn-mouth',(2.145,0,z),(2.165,0,z),.235,mat='dark',vertices=24)
        m.rod('type-22-horn-ring',(2.10,0,z),(2.16,0,z),.275,mat='edge',vertices=24)
        m.rod('type-22-waveguide',(.55,0,z),(.95,0,z),.07,mat='edge',vertices=8)
    # Lookout nest above the hounds, yards, aerial spreader and truck.
    p=pole(11.3);nest=[(p.x+.78*math.cos(i*math.tau/12),.78*math.sin(i*math.tau/12)) for i in range(12)]
    m.prism('lookout-floor',nest,11.30,11.38,mat='roof')
    wall=[(x,y,z) for z in (11.38,12.25) for x,y in nest]+[(p.x+(x-p.x)*.95,y*.95,z) for z in (12.25,11.38) for x,y in nest]
    m.mesh('lookout-screen',wall,[(r*12+i,r*12+(i+1)%12,((r+1)%4)*12+(i+1)%12,((r+1)%4)*12+i) for r in range(4) for i in range(12)])
    for i in range(0,12,3):m.rod('lookout-knee',pole(10.75),(nest[i][0],nest[i][1],11.31),.03,mat='edge',vertices=6)
    for z,span,r in ((13.6,2.3,.04),(16.7,1.6,.035)):
        q=pole(z,-.12);m.rod('yard',(q.x,-span,z),(q.x,span,z),r,r2=r,mat='edge',vertices=8)
        m.rod('yard-truss',pole(z),q,.05,mat='edge',vertices=6)
        for sign in (-1,1):
            m.rod('yard-lift',(q.x,sign*span*.85,z),pole(z+1.3),.016,mat='edge',vertices=5)
            for k in (.45,.9):m.cyl('halyard-block',(q.x,sign*span*k,z-.09),.035,.10,mat='dark',vertices=6)
    q=pole(17.8);m.rod('aerial-spreader',(q.x,-.48,17.8),(q.x,.48,17.8),.03,mat='edge',vertices=6)
    m.cyl('truck-light',tuple(pole(H)+Vector((0,0,.08))),.07,.16,mat='dark',vertices=8)
    m.rod('gaff',pole(12.2),pole(12.2)+Vector((-1.7,0,1.0)),.035,r2=.02,mat='edge',vertices=6)
    # Ladder up the fore side to the platform, then the aft side to the nest.
    m.ladder('lower-ladder',pole(.1,.22),pole(8.6,.22),.32,mat='edge')
    m.ladder('upper-ladder',pole(8.75,.22),pole(11.3,.22),.32,mat='edge')
    return m.root


# --- Mogami: Type 95 director over the 6 m rangefinder cabin --------------------------------
def create_director_tower(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    m.cyl('director-trunk',(0,0,1.62),1.6,3.24,vertices=40)
    for z in (.08,1.62,3.12):m.cyl('trunk-band',(0,0,z),1.64,.09,mat='edge',vertices=40)
    m.bolts(1.72,.04,16)
    m.box('trunk-door',(-1.60,0,1.05),(.06,.62,1.55),mat='edge')
    for y in (-.2,.2):m.rod('door-hinge',(-1.64,y*1.45,.55),(-1.64,y*1.45,1.55),.02,mat='edge',vertices=6)
    for a in (55,125,235,305):
        r=math.radians(a);m.rod('trunk-scuttle',(1.59*math.cos(r),1.59*math.sin(r),2.35),(1.63*math.cos(r),1.63*math.sin(r),2.35),.15,mat='dark',vertices=12)
        m.rod('scuttle-rim',(1.59*math.cos(r),1.59*math.sin(r),2.35),(1.62*math.cos(r),1.62*math.sin(r),2.35),.19,mat='edge',vertices=12)
    _ladder(m,'trunk-ladder',[(-1.18,1.18,.05),(-1.18,1.18,3.2)],(1,1,0),.36,standoff=(.05,-.05,0))
    yaw=m.empty('yaw',(0,0,3.25),m.root)
    m.cyl('rangefinder-seat',(0,0,3.40),1.67,.30,mat='edge',vertices=40,parent=yaw)
    m.cyl('rangefinder-lower-drum',(0,0,3.98),1.65,.90,vertices=40,parent=yaw)
    # The rangefinder cabin is a broad chamfered house, not a tall plain cylinder.
    cabin=[(-1.74,-1.25),(-1.39,-1.60),(1.63,-1.60),(1.98,-1.25),(1.98,1.25),(1.63,1.60),(-1.39,1.60),(-1.74,1.25)]
    m.prism('rangefinder-cabin',cabin,4.16,5.36,parent=yaw)
    m.prism('rangefinder-cabin-roof',[(x*1.02+.0,y*1.02) for x,y in cabin],5.36,5.44,mat='roof',parent=yaw)
    m.rod('six-metre-rangefinder',(0,-3.25,4.35),(0,3.25,4.35),.30,vertices=24,parent=yaw)
    for sign in (-1,1):
        y=sign*3.10
        m.rod('rangefinder-armoured-end',(0,y-.15,4.35),(0,y+.15,4.35),.37,mat='edge',vertices=20,parent=yaw)
        m.rod('rangefinder-end-cap',(0,sign*3.25,4.35),(0,sign*3.31,4.35),.31,vertices=20,parent=yaw)
        m.box('rangefinder-optical-hood',(.30,y,4.35),(.24,.30,.30),parent=yaw)
        m.box('rangefinder-optical-slit',(.425,y,4.35),(.02,.23,.22),mat='dark',parent=yaw)
        m.rod('rangefinder-sleeve',(0,sign*1.62,4.35),(0,sign*1.95,4.35),.36,mat='edge',vertices=20,parent=yaw)
        m.rod('rangefinder-stay',(-.2,sign*1.62,5.2),(0,sign*2.55,4.62),.035,mat='edge',vertices=6,parent=yaw)
        for x in (-.75,.9):
            m.rod('cabin-scuttle',(x,sign*1.595,4.84),(x,sign*1.625,4.84),.17,mat='dark',vertices=12,parent=yaw)
            m.rod('cabin-scuttle-rim',(x,sign*1.59,4.84),(x,sign*1.615,4.84),.21,mat='edge',vertices=12,parent=yaw)
    for y in (-.8,0,.8):m.box('cabin-front-window',(1.985,y,4.92),(.03,.50,.36),mat='dark',parent=yaw)
    m.box('cabin-rear-door',(-1.745,0,4.74),(.04,.58,1.08),mat='edge',parent=yaw)
    m.cyl('type-95-director-base',(0,0,5.66),1.38,.44,vertices=40,parent=yaw)
    m.cyl('type-95-director-body',(0,0,6.30),1.35,.88,vertices=40,parent=yaw)
    m.cyl('type-95-body-band',(0,0,5.90),1.375,.06,mat='edge',vertices=40,parent=yaw)
    m.cyl('type-95-sloping-roof',(0,0,6.915),1.37,.35,mat='roof',r2=1.12,vertices=40,parent=yaw)
    for a in (-35,0,35):
        r=math.radians(a);c,s=math.cos(r),math.sin(r)
        w=m.box('director-front-window',(1.34*c,1.34*s,6.40),(.07,.46,.43),mat='dark',parent=yaw);w.rotation_euler=(0,0,r)
        h=m.box('director-window-hood',(1.37*c,1.37*s,6.66),(.16,.54,.04),mat='edge',parent=yaw);h.rotation_euler=(0,0,r)
    for sign in (-1,1):
        m.rod('director-sight-arm',(.1,sign*1.30,6.35),(.1,sign*1.62,6.35),.11,mat='edge',vertices=12,parent=yaw)
        m.rod('director-sight-lens',(.22,sign*1.55,6.35),(.26,sign*1.55,6.35),.075,mat='dark',vertices=10,parent=yaw)
        m.box('director-sight-head',(.1,sign*1.55,6.35),(.24,.22,.26),parent=yaw)
    m.cyl('roof-hatch',(-.45,0,7.10),.34,.06,mat='edge',vertices=20,parent=yaw)
    m.rod('roof-periscope',(.55,0,7.05),(.55,0,7.42),.06,mat='edge',vertices=8,parent=yaw)
    m.box('roof-periscope-head',(.57,0,7.46),(.16,.14,.12),mat='edge',parent=yaw)
    roof=[(x*.93,y*.93) for x,y in cabin]
    m.path('cabin-roof-rail',[(x,y,5.44+.55) for x,y in roof if x<1.2],.018,mat='edge',vertices=6,parent=yaw)
    for x,y in roof:
        if x<1.2:m.rod('cabin-roof-stanchion',(x,y,5.44),(x,y,5.99),.018,mat='edge',vertices=6,parent=yaw)
    return m.root


# --- Yamato: Type 98 main director on the 15 m rangefinder ---------------------------------
def create_main_director(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    m.cyl('fixed-pedestal',(0,0,.725),1.95,1.45,vertices=40)
    for z in (.06,.80):m.cyl('pedestal-band',(0,0,z),1.99,.10,mat='edge',vertices=40)
    m.bolts(2.08,.03,20)
    for a in range(8):
        r=math.radians(22.5+a*45);c,s=math.cos(r),math.sin(r)
        m.mesh('pedestal-gusset',[(1.93*c+.04*s,1.93*s-.04*c,.1),(1.93*c-.04*s,1.93*s+.04*c,.1),(2.30*c-.04*s,2.30*s+.04*c,.1),(2.30*c+.04*s,2.30*s-.04*c,.1),(1.93*c+.04*s,1.93*s-.04*c,1.3),(1.93*c-.04*s,1.93*s+.04*c,1.3)],[(0,1,2,3),(0,3,4),(1,5,2),(3,2,5,4),(0,4,5,1)],mat='edge')
    yaw=m.empty('yaw',(0,0,1.45),m.root)
    m.cyl('bearing-lower',(0,0,1.5495),2.031,.207,vertices=40,parent=yaw)
    m.cyl('bearing-collar',(0,0,1.8625),2.210,.419,mat='edge',vertices=40,parent=yaw)
    drum=[(-2.638,1.457),(-2.113,2.162),(-.41,2.589),(.884,2.589),(1.605,2.322),(2.203,1.896),(2.641,1.341),(3.031,0),(2.641,-1.341),(2.203,-1.896),(1.605,-2.322),(.884,-2.589),(-.41,-2.589),(-2.113,-2.162),(-2.638,-1.457)]
    m.prism('faceted-housing',drum,2.07,3.61,parent=yaw)
    m.prism('housing-roof',[(x*1.015,y*1.015) for x,y in drum],3.61,3.76,mat='roof',parent=yaw)
    for (x,y),(x2,y2) in zip(drum[3:8],drum[4:8]):
        for sign in (-1,1):
            cx,cy=(x+x2)/2,(y+y2)/2*sign;ang=math.atan2((y2-y)*sign,x2-x)
            b=m.box('housing-vision-port',(cx*1.004,cy*1.004,3.05),(.46,.04,.24),mat='dark',parent=yaw);b.rotation_euler=(0,0,ang)
    m.box('housing-rear-door',(-2.645,0,2.78),(.05,.66,1.22),mat='edge',parent=yaw)
    m.cyl('cupola-collar',(0,0,3.895),1.78,.29,vertices=32,parent=yaw)
    m.cyl('type-98-director-head',(0,0,5.1235),1.762,2.171,vertices=40,parent=yaw)
    m.cyl('director-head-band',(0,0,4.12),1.79,.08,mat='edge',vertices=40,parent=yaw)
    m.cyl('director-cap',(0,0,6.255),1.80,.091,mat='roof',vertices=40,parent=yaw)
    m.cyl('director-cap-crown',(0,0,6.37),1.45,.14,mat='roof',r2=1.0,vertices=40,parent=yaw)
    m.box('director-forward-optical-hood',(1.4485,.024,5.3475),(1.369,.98,.439),parent=yaw)
    m.box('director-forward-optical-aperture',(2.142,.024,5.3475),(.025,.61,.23),mat='dark',parent=yaw)
    for a in (-52,-28,28,52):
        r=math.radians(a);c,s=math.cos(r),math.sin(r)
        w=m.box('director-window',(1.75*c,1.75*s,5.35),(.05,.50,.30),mat='dark',parent=yaw);w.rotation_euler=(0,0,r)
    for sign in (-1,1):
        m.rod('director-side-sight',(0,sign*1.70,5.0),(0,sign*2.08,5.0),.13,mat='edge',vertices=12,parent=yaw)
        m.box('director-side-sight-head',(.02,sign*2.02,5.0),(.30,.24,.32),parent=yaw)
        m.rod('director-side-sight-lens',(.17,sign*2.02,5.0),(.19,sign*2.02,5.0),.09,mat='dark',vertices=10,parent=yaw)
    m.rod('director-roof-sight',(.46,0,6.28),(.46,0,6.76),.06,mat='edge',vertices=12,parent=yaw)
    m.box('director-roof-sight-head',(.48,0,6.80),(.20,.16,.14),mat='edge',parent=yaw)
    m.cyl('director-roof-hatch',(-.7,.45,6.46),.32,.05,mat='edge',vertices=16,parent=yaw)
    for side in (-1,1):
        # Aft-set, tapered box arms join the broad rear shoulders of the housing.
        m.prism('rangefinder-arm-root',[(-2.113,side*1.4),(-.743,side*1.4),(-.743,side*4.498),(-2.113,side*4.498)][::side],2.40,3.59,parent=yaw)
        v=[]
        for y,x0,x1,low,high in [(side*4.49,-2.0,-.854,2.40,3.59),(side*6.81,-1.903,-.952,2.48,3.51)]:
            v.extend([(x0,y,low),(x1,y,low),(x1,y,high),(x0,y,high)])
        m.mesh('tapered-rangefinder-arm',v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],parent=yaw)
        for y in (2.2,3.4,4.49,5.65):m.path('arm-stiffener',[(-2.13+(y>4.49)*.06,side*y,2.40),(-2.13+(y>4.49)*.06,side*y,3.60),(-.73-(y>4.49)*.06,side*y,3.60),(-.73-(y>4.49)*.06,side*y,2.40)],.03,closed=True,mat='edge',vertices=6,parent=yaw)
        hood=[(-1.873+q[0],side*(7.4765+q[1])) for q in [(-.39,-.675),(.39,-.675),(.4545,-.61),(.4545,.61),(.39,.675),(-.39,.675),(-.4545,.61),(-.4545,-.61)]]
        m.prism('rangefinder-end-hood',hood[::side],2.48,3.506,parent=yaw)
        m.prism('rangefinder-end-hood-roof',[(x,y) for x,y in hood][::side],3.506,3.56,mat='roof',parent=yaw)
        m.rod('rangefinder-outer-optics',(-1.19,side*8.05,3.02),(-1.19,side*8.362,3.02),.20,mat='edge',vertices=16,parent=yaw)
        m.box('rangefinder-forward-optical-hood',(-.93,side*7.95,3.10),(.444,.42,.48),parent=yaw)
        m.box('rangefinder-aperture',(-.70,side*7.95,3.10),(.02,.23,.25),mat='dark',parent=yaw)
        for y in (2.9,6.3):m.rod('rangefinder-underside-bracket',(-1.34,side*y,2.45),(0,side*1.7,1.81),.075,mat='edge',vertices=10,parent=yaw)
        # Type 21 mattress frames stand on the aft arms and train with the director.
        for y in (3.147,7.608):m.rod('type-21-support',(-1.34,side*y,3.02),(-1.09,side*y,3.92),.065,mat='edge',vertices=8,parent=yaw)
        for y in (2.844,7.815):m.rod('type-21-outer-frame',(-1.09,side*y,3.896),(-1.09,side*y,5.174),.045,mat='edge',vertices=8,parent=yaw)
        for i in range(10):
            y=side*(3.147+i*(7.608-3.147)/9)
            m.rod('type-21-array-vertical',(-1.09,y,4.128),(-1.09,y,4.968),.025,mat='edge',vertices=6,parent=yaw)
            for z in (4.34,4.76):m.rod('type-21-dipole',(-1.09,y-.17,z),(-1.09,y+.17,z),.02,mat='dark',vertices=5,parent=yaw).location.x+=.12
        for z in (3.896,4.128,4.548,4.968,5.174):m.rod('type-21-array-horizontal',(-1.09,side*2.844,z),(-1.09,side*7.815,z),.028,mat='edge',vertices=6,parent=yaw)
    return m.root
