"""Original metric mast recipes, authored from inspected GameModels3D views.

No external meshes, source triangle coordinates, UVs or textures are inputs.
+X bow, +Y port, +Z up; foot datum Z=0. Shared construction exporter changes
basis exactly once. Small integral guys end on structure; ship rigging is external.
Each explicit builder preserves its own assembly, proportions and fitted equipment.
"""
import math
import sys
from pathlib import Path
from mathutils import Vector, Matrix
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'construction'))
from geometry import Model


class Mast(Model):
    """Low-sided structural primitives and supported platform assemblies."""
    def rod(self, name, a, b, r=.045, **kw):
        kw.setdefault('vertices', 6)
        return super().rod(name, a, b, r, **kw)

    def foot(self, x=0, y=0, r=.4):
        self.cyl('deck-shoe', (x, y, .06), r, .12, vertices=12)

    def pole(self, points):
        # Stations are (forward, height, radius); all pieces meet at stations.
        for (x,z,r),(xx,zz,rr) in zip(points, points[1:]):
            self.rod('mast-course',(x,0,z),(xx,0,zz),r,r2=rr,vertices=12)

    def rail(self, outline, z, height=.8):
        for x,y in outline:
            self.rod('rail-stanchion',(x,y,z-.06),(x,y,z+height),.025,vertices=4)
        for h in [height*.5,height]:
            self.path('platform-rail',[(x,y,z+h) for x,y in outline],.019,closed=True,vertices=4)

    def platform(self, outline, z, center=(0,0), shield=0, rail=True, knees=True):
        self.prism('platform-deck',outline,z-.1,z,mat='roof')
        if shield:
            n=len(outline);inside=[(center[0]+(x-center[0])*.97,center[1]+(y-center[1])*.97) for x,y in outline]
            rings=[[(x,y,h) for x,y in poly] for poly,h in [(outline,z),(outline,z+shield),(inside,z+shield),(inside,z)]]
            self.mesh('platform-splinter-screen',[v for ring in rings for v in ring],[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(3) for i in range(n)])
        elif rail:self.rail(outline,z)
        if knees:
            for x,y in outline[::max(1,len(outline)//6)]:
                self.rod('platform-knee',(*center,z-.85),(x,y,z-.12),.055)

    def yard(self,x,z,half,r=.065,stay=1.5,footrope=False):
        self.rod('yard',(x,-half,z),(x,half,z),r,vertices=8)
        if stay:
            for sign in [-1,1]:self.rod('yard-stay',(x,0,z+stay),(x,sign*half,z),.017,vertices=4)
        if footrope:
            for sign in [-1,1]:
                p=[(x,sign*half*t,z-.38*math.sin(math.pi*t)) for t in [0,.25,.5,.75,1]]
                self.path('yard-footrope',p,.014,vertices=4)
                for t in [.25,.5,.75]:self.rod('footrope-stirrup',(x,sign*half*t,z),(x,sign*half*t,z-.38*math.sin(math.pi*t)),.012,vertices=4)

    def ladder(self,a,b,width=.45,step=.4,standoffs=True):
        a,b=Vector(a),Vector(b);side=Vector((0,width/2,0))
        for sign in [-1,1]:self.rod('ladder-stile',a+side*sign,b+side*sign,.026,vertices=4)
        steps=math.ceil((b-a).length/step)
        for i in range(steps+1):
            p=a.lerp(b,i/steps);self.rod('ladder-rung',p-side,p+side,.02,vertices=4)
        # Standoffs terminate at the structural centerline, not in midair.
        for i in range(math.ceil((b-a).length/2.5)+1) if standoffs else []:
            t=min(1,i*2.5/(b-a).length);p=a.lerp(b,t)
            for sign in [-1,1]:
                q=p+side*sign
                self.rod('ladder-bracket',q,Vector((q.x+.3,q.y,q.z)),.03,vertices=4)

    def cage(self, height, bottom, top, waist_twist=1.6, count=20):
        # Straight crossed structural tubes form a hyperboloid; no subdivisions.
        for direction in [-1,1]:
            for i in range(count):
                a=i*math.tau/count;b=a+direction*waist_twist
                self.rod('cage-diagonal',(bottom*math.cos(a),bottom*math.sin(a),.12),
                         (top*math.cos(b),top*math.sin(b),height),.047,vertices=5)
        for t in [0,.16,.33,.5,.67,.82,1]:
            x=bottom*(1-t)+top*math.cos(waist_twist)*t;y=top*math.sin(waist_twist)*t;r=math.hypot(x,y)
            self.path('cage-hoop',ellipse(0,r,r,24,z=.12+(height-.12)*t),.045,closed=True,vertices=5)
        # Annular foundation keeps the open cage hollow and supplies a real sole.
        self.band('cage-foot-ring',bottom+.08,bottom-.08,0,.2)

    def band(self,name,outer,inner,z,height,x=0):
        n=24;vs=[p for r,h in [(outer,z),(outer,z+height),(inner,z+height),(inner,z)] for p in ellipse(x,r,r,n,z=h)]
        self.mesh(name,vs,[(k*n+i,k*n+(i+1)%n,((k+1)%4)*n+(i+1)%n,((k+1)%4)*n+i) for k in range(4) for i in range(n)])

    def screen(self,x,z,width,height,columns=8,rows=4):
        # Open lattice reflector, structural back braces and central bearing.
        self.rod('radar-shaft',(x,0,z-height/2-.8),(x,0,z),.1,vertices=8)
        for i in range(columns+1):
            y=-width/2+width*i/columns;self.rod('radar-upright',(x,y,z-height/2),(x,y,z+height/2),.022,vertices=4)
        for i in range(rows+1):
            h=z-height/2+height*i/rows;self.rod('radar-horizontal',(x,-width/2,h),(x,width/2,h),.023,vertices=4)
        for y in [-width/2,width/2]:
            self.rod('radar-back-brace',(x-.35,0,z-height/2),(x,y,z+height/2),.035)
        self.rod('radar-bearing',(x-.35,0,z-height/2),(x,0,z-height/2),.09)

    def curved_radar(self,x,z,width,height,depth=.5,rim_raise=0):
        # Independent shallow cylindrical reflector with a supported open rear frame.
        n=10;vs=[]
        for h in [-height/2,height/2]:
            for i in range(n+1):
                u=2*i/n-1;vs.append((x+depth*u*u,u*width/2,z+h+(rim_raise*u*u if h<0 else 0)))
        self.mesh('radar-reflector',vs,[(i,i+1,n+2+i,n+1+i) for i in range(n)],mat='roof')
        for h in [-height/2,height/2]:self.path('radar-rim',[(x+depth*(2*i/n-1)**2,(2*i/n-1)*width/2,z+h+(rim_raise*(2*i/n-1)**2 if h<0 else 0)) for i in range(n+1)],.03,vertices=4)
        for i in range(0,n+1,2):
            u=2*i/n-1;p=(x+depth*u*u,u*width/2,z)
            self.rod('radar-rib',(p[0],p[1],z-height/2+rim_raise*u*u),(p[0],p[1],z+height/2),.03,vertices=4)
            self.rod('radar-spider',(x-.3,0,z-height/2-.2),p,.04,vertices=4)
        self.rod('radar-bearing',(x-.3,0,z-height/2-.7),(x-.3,0,z-height/2-.1),.16,vertices=10)


def ellipse(x,rx,ry,n=16,z=None):
    return [(x+rx*math.cos(i*math.tau/n),ry*math.sin(i*math.tau/n))+(tuple() if z is None else (z,)) for i in range(n)]


def clipped_box(x,length,width,cut=.3):
    a=length/2;b=width/2;c=min(cut,a*.5,b*.5)
    return [(x-a+c,-b),(x+a-c,-b),(x+a,-b+c),(x+a,b-c),(x+a-c,b),(x-a+c,b),(x-a,b-c),(x-a,-b+c)]


def hut(m,x,z,length,width,height,windows=True):
    outline=clipped_box(x,length,width,min(length,width)*.24)
    m.prism('spotting-house',outline,z,z+height)
    m.prism('spotting-house-roof',[(x+(a-x)*1.04,b*1.04) for a,b in outline],z+height,z+height+.12,mat='roof')
    if windows:
        for sign in [-1,1]:
            for i in [-1,0,1]:
                m.box('observation-window',(x+sign*(length/2+.005),i*width*.24,z+height*.66),(.016,width*.16,height*.35),mat='dark')
                m.box('observation-window',(x+i*length*.24,sign*(width/2+.005),z+height*.66),(length*.16,.016,height*.35),mat='dark')


def create_mikasa(part,col,helpers,materials):
    m=Mast(col,helpers,materials);m.foot(r=.62)
    m.pole([(0,.06,.50),(0,28.4,.31)])
    m.rod('topmast-step',(0,0,27.8),(.82,0,28.4),.24)
    m.pole([(.82,27.8,.16),(.82,47.72,.07)])
    # Two fighting tops with their conical undersides and open screens.
    for z,r in [(12.5,2.38),(24.5,2.74)]:
        m.cyl('fighting-top-cone',(0,0,z-.65),.53,1.15,r2=r,vertices=18)
        m.platform(ellipse(0,r,r,18),z,shield=.95,knees=False)
    m.yard(.82,28.2,9.60,.075,8.0,True);m.yard(.82,40.85,6.10,.05,3.5,True)
    for side in [-1,1]:m.rod('topmast-shroud',(0,side*2.65,24.5),(.82,0,44.2),.022,vertices=4)
    m.ladder((-.6,0,.15),(-.6,0,28.1),.45,.42)
    return m.root


def create_dreadnought(part,col,helpers,materials):
    m=Mast(col,helpers,materials);m.foot(r=.66)
    m.pole([(0,.08,.53),(0,23.4,.34),(0,44.42,.08)])
    for y in [-4.85,4.85]:
        m.foot(4.35,y,.62);m.rod('tripod-leg',(4.35,y,.22),(.2,y*.08,19.7),.5,r2=.34,vertices=12)
    m.platform(ellipse(0,1.3,1.15,12),19.8)
    m.platform(clipped_box(0,4.6,5.65,.7),22.3)
    hut(m,-.2,22.3,3.6,4.6,1.55)
    m.platform(clipped_box(-.2,3.1,3.9,.4),24.05,rail=False,knees=False)
    m.yard(0,42.3,3.2,.046,1.5)
    for side in [-1,1]:
        m.rod('topmast-shroud',(-1.9,side*2.65,22.3),(0,0,41.8),.02,vertices=4)
    m.ladder((-.65,0,.15),(-.65,0,22.3),.45,.42)
    return m.root


def create_michigan(part,col,helpers,materials):
    m=Mast(col,helpers,materials);m.cage(25.2,3.05,1.72,1.85,24)
    m.platform(clipped_box(0,1.5,9.6,.3),7.82,knees=False)
    for y in [-4.7,4.7]:m.rod('wing-knee',(0,y*.44,4.2),(0,y,7.72),.06)
    m.platform(clipped_box(0,4.7,5.5,.35),25.25,shield=1.1,knees=False)
    m.rod('topmast',(-.3,0,24.8),(-.3,0,40.1),.12,r2=.055,vertices=10)
    m.yard(-.3,39.1,3.8,.045,0);m.yard(-.3,21.6,5.5,.04,4.0)
    # Yard roots connect to the ring at this height via the center mast.
    m.rod('central-spar',(-.3,0,17),(-.3,0,25.4),.1)
    for z in [17,21.6]:m.rod('spar-tie',(-.3,0,z),(1.55,0,z),.045)
    for side in [-1,1]:m.rod('topmast-shroud',(0,side*2.7,25.25),(-.3,0,38.7),.02,vertices=4)
    m.ladder((-.35,0,.2),(-.35,0,25.25),.48,.45,False)
    # Ladder heel and head have actual cross-members inside the open cage.
    for z,r in [(.2,3.05),(25.2,1.72)]:m.rod('ladder-landing',(-r,0,z),(r,0,z),.055)
    return m.root


def create_gangut(part,col,helpers,materials):
    m=Mast(col,helpers,materials);m.foot(r=.48)
    m.pole([(0,.06,.38),(0,18.6,.23),(.88,18.8,.12),(.88,31.66,.055)])
    m.platform(clipped_box(.32,1.65,3.4,.4),3.7)
    m.platform(ellipse(0,.65,.7,12),8.25)
    m.cyl('lookout-drum',(.35,0,17.0),.83,1.65,vertices=16)
    m.cyl('lookout-roof',(.35,0,17.92),.96,.18,vertices=16,mat='roof')
    m.rod('lookout-support',(0,0,15.1),(.35,0,16.2),.26)
    m.yard(.88,27.25,3.5,.05,0,True)
    m.ladder((-.43,0,.15),(-.43,0,18.6),.4,.4)
    return m.root


def create_hood(part,col,helpers,materials):
    m=Mast(col,helpers,materials);m.foot(r=.57)
    m.pole([(0,.06,.43),(-1.55,15.6,.36),(-1.55,33.4,.07)])
    for y in [-3.35,3.35]:
        m.foot(-3.3,y,.53);m.rod('tripod-leg',(-3.3,y,.16),(-1.5,y*.11,15.6),.43,r2=.30,vertices=12)
    m.platform(ellipse(-1.5,1.2,.95,12),15.7,center=(-1.5,0))
    # Wide triangular signal platform, recognizably different from KGV's huts.
    outline=[(-1.65,-6.1),(.6,0),(-1.65,6.1),(-3.0,0)]
    m.platform(outline,19.1,center=(-1.55,0),rail=False)
    m.yard(-1.6,19.12,6.1,.05,7)
    m.platform(clipped_box(-2.3,1.75,1,.2),31.9,center=(-1.55,0))
    m.yard(-1.55,32,5.85,.035,1.1)
    for sign in [-1,1]:m.rod('topmast-shroud',(-1.6,sign*5.3,19.1),(-1.55,0,31.8),.02,vertices=4)
    m.ladder((-.55,0,.2),(-2.05,0,15.7),.4,.4)
    return m.root


def create_scharnhorst(part,col,helpers,materials):
    m=Mast(col,helpers,materials);m.foot(r=.58)
    m.pole([(0,.06,.42),(0,19.38,.29),(0,42.03,.055)])
    m.platform(clipped_box(-.65,5.15,9.4,.55),9.5,center=(0,0),shield=1.1)
    m.platform(ellipse(-.2,2.05,1.96,16),13.4)
    m.platform(ellipse(.12,.95,.75,12),16.25,center=(0,0))
    m.yard(0,29.9,6.25,.055,3.9,True)
    m.yard(0,40.1,1.85,.035,1.15,True)
    # Lower stays join the yard to the mast collar, not an external ship deck.
    for sign in [-1,1]:m.rod('yard-lower-stay',(-.65,sign*4.4,10.6),(0,sign*6.25,29.9),.018,vertices=4)
    m.ladder((-.50,0,.2),(-.50,0,19.35),.42,.42)
    return m.root


def create_roma(part,col,helpers,materials):
    m=Mast(col,helpers,materials);m.foot(r=1.48)
    # Narrow tubular trunk, widened upper sleeve and enclosed signal drum.
    m.pole([(0,.06,1.40),(0,6.05,1.4)])
    m.cyl('upper-trunk-sleeve',(0,0,5.15),2.10,1.8,vertices=24)
    m.prism('signal-drum',ellipse(-.15,2.9,3.5,24),6.05,8.5)
    outline=[(-3.2,-2.4),(-2.8,-3.5),(-.1,-3.5),(.1,-4.8),(1.8,-5.1),(2.8,-4.4),(3.0,-3.0),(3.0,3.0),(2.8,4.4),(1.8,5.1),(.1,4.8),(-.1,3.5),(-2.8,3.5),(-3.2,2.4)]
    m.platform(outline,8.65,shield=.7,knees=False)
    m.pole([(0,8.2,.38),(0,15.0,.28),(0,24.64,.065)])
    m.platform(ellipse(0,.95,1.05,12),12.0)
    m.yard(0,14.55,2.8,.07,0);m.yard(0,20.7,2.9,.035,1.1)
    for y in [-2.7,2.7]:
        m.rod('mast-stay',(0,y,14.55),(0,0,23.7),.019,vertices=4)
        m.rod('signal-halyard',(0,y,14.55),(0,y,20.7),.011,vertices=4)
    for z in [10.6,11.3]:
        m.rod('horn-bracket',(0,-.8,z),(0,.8,z),.035)
        for y in [-.8,.8]:m.rod('signal-horn',(-.1,y,z),(.35,y,z),.13,r2=.20,vertices=8)
    m.ladder((-1.5,0,.18),(-1.5,0,6.15),.5,.4)
    m.ladder((-.52,0,9),(-.52,0,15),.4,.4)
    return m.root


def create_arizona(part,col,helpers,materials):
    m=Mast(col,helpers,materials);m.foot(r=.55)
    m.pole([(0,.06,.42),(0,28.3,.30)])
    for sign in [-1,1]:
        y=sign*5.0;m.foot(8.5,y,.48);m.rod('tripod-leg',(8.5,y,.19),(.65,sign*1.2,26.1),.39,r2=.27,vertices=10)
    m.platform(ellipse(1.8,2.2,2.3,12),14.55,center=(0,0))
    # Three-lobed signal/searchlight platform retained without separate searchlights.
    platform=[(-.7,-4.6),(1,-5.6),(3.2,-5.6),(4.0,-4.8),(7.4,-3.3),(8.1,-2.4),(7.5,-1.4),(4.3,-.7),(4.3,.7),(7.5,1.4),(8.1,2.4),(7.4,3.3),(4,4.8),(3.2,5.6),(1,5.6),(-.7,4.6)]
    m.platform(platform,18.8,center=(1,0))
    for z in [21.5,23.6]:m.platform(ellipse(1.7,1.7,2.1,12),z,center=(0,0),rail=False)
    hut(m,1.55,26.1,4.8,7.25,2.2);hut(m,1.55,28.4,3.7,5.25,2.6)
    hut(m,1.55,31.1,3.1,3.5,1.9)
    m.platform(clipped_box(2.1,5.8,5.75,.75),33.55,center=(1.55,0),shield=1.15)
    m.rod('spotting-top-neck',(1.55,0,32.7),(1.55,0,33.7),.9,vertices=12)
    m.rod('signal-staff',(2.1,0,33.5),(2.1,0,38.4),.07,vertices=8)
    m.ladder((-.55,0,.2),(-.55,0,26.1),.45,.42)
    return m.root


def create_colorado(part,col,helpers,materials):
    m=Mast(col,helpers,materials);m.cage(12.35,1.82,1.66,1.65,24)
    m.platform(clipped_box(0,1.4,9.5,.3),2.25,knees=False)
    for y in [-4.65,4.65]:m.rod('gallery-knee',(0,y*.34,.25),(0,y,2.15),.065)
    m.platform(clipped_box(0,4.65,8.5,1.0),10.1,rail=False,knees=False)
    hut(m,0,10.1,4.3,8.0,2.4);hut(m,0,12.65,3.5,4.7,2.05)
    hut(m,0,14.8,3.25,3.8,1.55)
    m.box('mk3-director-frame',(.1,0,16.8),(.48,3.7,.85))
    m.rod('mk3-director-bearing',(.1,0,16.25),(.1,0,16.85),.2,vertices=8)
    for y in [-1.2,-.6,0,.6,1.2]:m.box('mk3-director-slot',(.35,y,16.8),(.02,.37,.3),mat='dark')
    m.platform(ellipse(-.9,2.4,1.6,16),16.45,center=(0,0))
    m.rod('radar-bearing',(0,0,16.2),(0,0,18.9),.32,vertices=12)
    m.screen(-.4,20.25,5.65,4.65,10,6)
    m.rod('radar-plinth',(0,0,18),(-.4,0,18),.25,vertices=10)
    # After-offset SG pole and open truss behind the spotting tower.
    m.rod('sg-mast',(-5.6,0,10.15),(-5.6,0,24.85),.16,r2=.10,vertices=10)
    for z in [10.2,12.6,14.8,16.45]:
        m.rod('aft-truss-chord',(-5.6,0,z),(-1.65,0,z),.065)
        if z<16:m.rod('aft-truss-brace',(-5.6,0,z),(-1.65,0,z+2.2),.055)
    m.platform(clipped_box(-3,5.5,2.4,.3),16.45,center=(-1.4,0),rail=True,knees=False)
    m.rod('sg-pedestal',(-5.6,0,24.5),(-5.6,0,25.25),.13,vertices=8)
    m.curved_radar(-5.3,25.18,1.05,.5,.16)
    m.ladder((-.35,0,.2),(-.35,0,10.1),.42,.42,False)
    for z,r in [(.2,1.82),(10.1,1.62)]:m.rod('ladder-landing',(-r,0,z),(r,0,z),.055)
    return m.root


def create_halland(part,col,helpers,materials):
    m=Mast(col,helpers,materials);m.foot(r=.5)
    m.pole([(0,.06,.38),(0,9.9,.25),(0,10.9,.17)])
    m.platform(clipped_box(.38,3.45,.98,.32),8.5,center=(0,0))
    m.platform(ellipse(0,.90,.84,12),10.0)
    for z in [10.2,10.75]:
        m.rod('upper-aerial-bracket',(0,-.65,z),(0,.65,z),.027)
        for y in [-.65,.65]:m.rod('upper-aerial',(-.12,y,z),(.18,y,z+.18),.07,r2=.1,vertices=6)
    m.rod('radar-plinth',(0,0,9.95),(0,0,11.15),.22,vertices=12)
    m.curved_radar(.30,11.45,3.35,.48,.3)
    m.rod('navigation-radar-neck',(1.5,0,8.5),(1.5,0,9.35),.13)
    m.box('navigation-radar',(1.5,0,9.5),(.55,.46,.65))
    m.yard(0,9.75,2.9,.042,0)
    for sign in [-1,1]:
        y=sign*2.25;m.rod('yard-brace',(0,0,9.1),(0,y,9.75),.04)
        m.rod('yard-antenna',(0,y,9.75),(0,y,11.05),.022,vertices=4)
        m.rod('antenna-crosspiece',(0,y-.32,10.65),(0,y+.32,10.65),.016,vertices=4)
    m.ladder((-.45,0,.2),(-.45,0,9.95),.38,.4)
    return m.root


def create_friesland(part,col,helpers,materials):
    m=Mast(col,helpers,materials)
    # The upper foremast package begins at the roof mounting plane; bridge excluded.
    m.foot(r=.32);m.pole([(0,.06,.20),(-.1,10.4,.055)])
    for y in [-.75,.75]:
        m.foot(1.1,y,.2);m.rod('mast-brace',(1.1,y,.08),(0,0,3.2),.055)
    outline=[(-.4,-1.15),(3.85,-1.15),(4.35,-.65),(4.35,.65),(3.85,1.15),(-.4,1.15)]
    m.platform(outline,.95,center=(0,0),knees=True)
    m.rod('radar-pedestal',(2.55,0,.9),(2.55,0,2.5),.40,vertices=12)
    m.box('radar-drive',(2.55,0,1.75),(1.3,1.15,1.3))
    m.curved_radar(2.85,4.65,4.5,1.45,.8,.28)
    m.rod('radar-neck',(2.55,0,2.2),(2.55,0,4.0),.26,vertices=10)
    m.yard(3.4,1.72,5.4,.055,0,True)
    for y in [-5.3,5.3]:m.rod('yard-end-aerial',(3.4,y,1.72),(3.4,y,2.35),.025,vertices=4)
    for y in [-4.5,-3.4,-2.3,-1.2,1.2,2.3,3.4,4.5]:
        m.rod('signal-cleat',(3.4,y,1.72),(3.4,y,1.98),.02,vertices=4)
        m.rod('signal-cleat-cross',(3.4,y-.13,1.98),(3.4,y+.13,1.98),.018,vertices=4)
    for sign in [-1,1]:m.rod('yard-knee',(2.55,sign*.5,.98),(3.4,sign*4.8,1.72),.035)
    m.rod('yard-center-bracket',(2.55,0,1.72),(3.4,0,1.72),.06)
    # Three paired sets of horn-like aerials around the slim topmast.
    for z in [7.5,8.35,9.2]:
        for dx,dy in [(1,0),(-1,0),(0,1),(0,-1)]:
            a=(-.1,0,z);b=(-.1+dx*.72,dy*.72,z);m.rod('aerial-spreader',a,b,.025,vertices=4)
            m.box('aerial-tip',b,(.2 if dy else .25,.25 if dy else .2,.1),mat='painted-edge')
    for sign in [-1,1]:m.rod('mast-stay',(1.0,sign*.72,.95),(-.1,0,6.5),.016,vertices=4)
    m.ladder((-.3,0,.15),(-.3,0,3.1),.35,.38)
    return m.root


def create_le_fantasque(part,col,helpers,materials):
    m=Mast(col,helpers,materials)
    # Narrow four-sided open lattice tower, not a rescaled pole mast.
    h=5.85
    feet=[(-.25,-.31),(.25,-.31),(.25,.31),(-.25,.31)]
    for x,y in feet:
        m.foot(x,y,.11);m.rod('tower-leg',(x,y,.06),(x*.62,y*.62,h),.045)
    for i in range(5):
        z0=.1+h*i/5;z1=.1+h*(i+1)/5;r0=1-.38*z0/h;r1=1-.38*z1/h
        for j,(x,y) in enumerate(feet):
            xx,yy=feet[(j+1)%4]
            m.rod('tower-diagonal',(x*r0,y*r0,z0),(xx*r1,yy*r1,z1),.024,vertices=4)
            m.rod('tower-diagonal',(xx*r0,yy*r0,z0),(x*r1,y*r1,z1),.024,vertices=4)
            m.rod('tower-tie',(x*r1,y*r1,z1),(xx*r1,yy*r1,z1),.027,vertices=4)
    m.platform(ellipse(0,.55,.65,12),h,rail=False)
    m.platform(ellipse(0,.38,.42,10),3.6,shield=.27,knees=False)
    m.box('radar-shelf',(.65,0,h),(1.5,.55,.09),mat='roof')
    m.rod('shelf-brace',(0,0,h-.5),(1.25,0,h),.04)
    m.cyl('sf-radome',(1.08,0,h+.46),.32,.83,r2=.27,vertices=10)
    m.cyl('sa-pedestal',(0,0,h+.86),.23,1.7,vertices=10)
    m.rod('sa-neck',(0,0,h+1.5),(0,0,8.0),.10)
    radar_start=set(col.objects)
    m.screen(0,9.2,2.65,1.5,7,3)
    # SA reflector has a closed, chamfered face; the open frame is on its rear.
    outline=[(-1.12,-.75),(1.12,-.75),(1.325,-.55),(1.325,.55),(1.12,.75),(-1.12,.75),(-1.325,.55),(-1.325,-.55)]
    m.mesh('sa-reflector',[(.035,y,9.2+h) for y,h in outline],[tuple(range(8))],mat='roof')
    pivot=Vector((0,0,9.2));pose=Matrix.Translation(pivot)@Matrix.Rotation(.18,4,'Y')@Matrix.Translation(-pivot)
    for ob in set(col.objects)-radar_start:ob.matrix_world=pose@ob.matrix_world
    m.rod('radar-tilt-bearing',(0,0,7.7),(-.29,0,7.7),.12,vertices=10)
    m.cyl('sf-domed-cap',(1.08,0,h+.93),.27,.2,r2=.09,vertices=10)
    m.rod('sa-tapered-neck',(0,0,h+1.6),(0,0,8.0),.22,r2=.09,vertices=10)
    m.ladder((-.36,0,.15),(-.36,0,h),.35,.4,False)
    return m.root
