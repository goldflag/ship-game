"""Original metric funnel recipes. GM3D is a viewing reference, never an input.

Sections are deliberately sparse hand-authored measurements, not extracted mesh
vertices. +X forward, +Y port, +Z up; the standard exporter converts once.
"""
import math
import sys
from pathlib import Path
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'construction'))
from geometry import Model

# (height, fore/aft centre, half length, half beam, top-plane slope).
# Separate registrations below keep each source fit/position stable.
PROFILES = {
    'dreadnought-aft-funnel': dict(cageHeight=.47, shape='stadium', sections=[(0,0,3.14,1.39,0),(8.81,0,3.14,1.39,0),(9.56,0,2.99,1.24,0)], bands=[.12,8.8], pipes=[(-2.35,1),(-2.35,-1)], ladder='aft', cage=True, grates=5),
    'hood-forward-funnel': dict(cageHeight=.82, shape='stadium', sections=[(0,0,3.9,2.98,0),(11.90,0,3.9,2.98,0),(12.20,0,4.08,3.16,0),(12.44,0,3.61,2.69,0)], bands=[.12,11.9], pipes=[(2.7,1),(2.7,-1)], ladder='forward', cage=True, grates=5, platforms=[(1.1,1),(3.3,1)]),
    'nelson-funnel': dict(cageHeight=.49, platformDepth=1.13, shape='stadium', sections=[(0,0,3.25,1.89,0),(11.27,0,3.25,1.89,0),(11.79,0,3.06,1.70,0)], bands=[.13,11.22], pipes=[(-2.1,1),(-2.1,-1),(2.1,1),(2.1,-1)], ladder='aft', cage=True, grates=4, platforms=[(9.6,1),(9.6,-1)], boxes=True),
    'emden-aft-funnel': dict(shape='ellipse', squareBase=True, sections=[(0,0,1.80,1.58,0),(1.4,-.08,1.51,1.36,0),(12.12,-.54,1.51,1.36,0),(12.16,-.54,1.74,1.59,0),(12.37,-.54,1.74,1.59,0),(12.55,-.54,1.28,1.17,0)], bands=[1.4,4.1,6.8,9.5,12.25], pipes=[(.1,1),(.1,-1)], pipeStart=.65, ladder='aft', cage=False, grates=2),
    'mikasa-forward-funnel': dict(cageHeight=.18, platformDepth=.32, shape='ellipse', sections=[(0,0,2.06,2.06,0),(.12,0,1.87,1.87,0),(13.80,0,1.87,1.87,0),(14.07,0,2.06,2.06,0),(14.93,0,1.87,1.87,0)], bands=[.12,13.8], pipes=[(.2,1)], ladder='aft', cage=True, grates=2, platforms=[(4.7,1),(4.7,-1)]),
    'clemson-forward-funnel': dict(shape='ellipse', sections=[(0,0,.93,.93,0),(4.22,-.29,.84,.84,.04),(7.50,-.53,.92,.92,.04),(7.65,-.53,.97,.97,.04)], bands=[.14,4.22,7.5], pipes=[(-.5,-1)], ladder='aft', cage=True, grates=2),
    'dunkerque-funnel': dict(walkwayOverhang=.17, shape='stadium', sections=[(0,0,3.55,2.52,0),(11.04,0,3.55,2.52,0),(11.34,0,3.71,2.61,0),(11.46,0,3.18,2.29,0),(12.5,-.12,3.16,2.28,.18),(13.8,-.7,2.65,2.03,.52)], bands=[.12,11.04], pipes=[(-1.8,1),(-1.8,-1),(1.8,1),(1.8,-1)], ladder='forward', cage=True, grates=5, walkway=10.95),
    'kirov-forward-funnel': dict(platformDepth=.15, shape='stadium', sections=[(0,0,4.84,1.72,0),(.28,0,4.84,1.72,0),(3.5,-.85,4.1,1.60,0),(9.10,-2.10,4.0,1.72,.07),(9.15,-2.10,4.18,1.90,.07),(9.32,-2.10,4.18,1.90,.07),(9.38,-2.10,3.65,1.53,.07),(10.42,-2.05,3.40,1.45,.42)], bands=[.2,9.1], pipes=[(2.6,1),(2.6,-1)], ladder='aft', cage=True, grates=5, platforms=[(2.2,1)]),
    'aosta-forward-funnel': dict(shape='stadium', sections=[(0,0,5.70,2.24,0),(.14,0,5.70,2.24,0),(2.53,0,3.38,1.74,0),(5.76,0,3.38,1.74,0),(5.99,0,3.55,1.91,0),(7.10,0,2.75,1.23,.43)], bands=[.14,5.76], pipes=[(-2.4,1),(-2.4,-1)], ladder='aft', cage=True, grates=4, walkway=3.1, vent=True),
    'cesare-forward-funnel': dict(cageHeight=.80, shape='ellipse', sections=[(0,0,2.65,1.87,0),(7.4,0,2.65,1.87,.07),(7.64,0,2.88,1.99,.07),(7.83,0,2.48,1.72,.07),(8.8,-.12,2.38,1.59,.34)], bands=[.35,1.9,3.52,5.12,6.6], pipes=[(-.5,-1)], ladder='aft', cage=True, grates=3),
    'blyskawica-funnel': dict(cageHeight=.95, platformDepth=.24, shape='stadium', sections=[(0,0,4.61,1.53,0),(.24,0,4.83,1.62,0),(.37,0,4.44,1.49,0),(1.21,-.3,3.35,1.18,0),(6.55,-1.5,3.45,1.34,.13),(6.80,-1.5,3.20,1.1,.13),(7.68,-1.5,3.12,1.1,.29)], bands=[.24,6.55], pipes=[(2.2,1),(2.2,-1)], ladder='forward', cage=True, grates=5, platforms=[(4.0,1)]),
    'aurora-middle-funnel': dict(cageHeight=.40, platformDepth=.33, shape='ellipse', sections=[(0,0,1.60,1.60,0),(15.33,0,1.60,1.60,0),(15.87,0,1.50,1.50,0)], bands=[.12,15.33], pipes=[], ladder='aft', cage=True, grates=3, platforms=[(.8,1)]),
}


def ring(section, shape, n=32, inset=0, dz=0):
    z,cx,rx,ry,slope=section;rx-=inset;ry-=inset
    points=[]
    if shape=='stadium':
        half=n//2
        for center,start in [(rx-ry,-math.pi/2),(-(rx-ry),math.pi/2)]:
            for i in range(half):
                a=start+math.pi*i/(half-1);x=center+ry*math.cos(a);y=ry*math.sin(a)
                points.append((cx+x,y,z+dz+slope*x))
    else:
        for i in range(n):
            a=math.tau*i/n;x,y=rx*math.cos(a),ry*math.sin(a)
            points.append((cx+x,y,z+dz+slope*x))
    return points


def loft(m,name,rings,mat='naval',floor=False):
    # Split the strips at authored section changes for a crisp rolled lip and
    # casing transition, while retaining smooth normals around each perimeter.
    n=len(rings[0]);obj=None
    for a,b in zip(rings,rings[1:]):
        obj=m.mesh(name,a+b,[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)],mat=mat,smooth=True)
    if floor:m.mesh(name+'-baffle',rings[-1],[tuple(range(n))],mat=mat)
    return obj



def interpolate(sections,z):
    for a,b in zip(sections,sections[1:]):
        if z<=b[0]:
            t=max(0,min(1,(z-a[0])/max(.001,b[0]-a[0])))
            return tuple(x+(y-x)*t for x,y in zip(a,b))
    return sections[-1]


def perimeter_y(section,x,shape):
    _,cx,rx,ry,_=section
    d=abs(x-cx)
    if shape=='stadium':return ry*math.sqrt(max(0,1-(max(0,d-(rx-ry))/ry)**2))
    return ry*math.sqrt(max(0,1-(d/rx)**2))


def rail(m,name,pts,z,height=.85):
    for i,(a,b) in enumerate(zip(pts,pts[1:]+pts[:1])):
        if i%2==0:m.rod(name+'-post',(a[0],a[1],z),(a[0],a[1],z+height),.025,vertices=4)
        for h in [.42,height]:m.rod(name+'-rail',(a[0],a[1],z+h),(b[0],b[1],z+h),.018,vertices=4)


def build(part,col,helpers,materials,profile):
    m=Model(col,helpers,materials);p=profile;ss=p['sections'];shape=p['shape'];top=ss[-1];height=top[0];n=32
    m.root['funnelOutletWidthM']=max(.2,2*top[3]-.3)
    m.root['funnelOutletLengthM']=max(.2,2*top[2]-.3)
    rings=[ring(s,shape,n) for s in ss]
    if p.get('squareBase'):
        z,cx,rx,ry,_=ss[0]
        rings[0]=[(cx+rx*math.cos(a)/max(abs(math.cos(a)),abs(math.sin(a))),ry*math.sin(a)/max(abs(math.cos(a)),abs(math.sin(a))),z) for a in [i*math.tau/n for i in range(n)]]
    loft(m,'casing',rings)
    # A flat sole remains the attachment datum even on raked funnels.
    foot=ss[0];sole=ring((.04,foot[1],foot[2]+.035,foot[3]+.035,0),shape,n)
    if p.get('squareBase'):sole=[(x*1.02,y*1.02,.04) for x,y,z in rings[0]]
    loft(m,'deck-sole',[[(x,y,0) for x,y,z in sole],sole],mat='painted-edge')
    wall=.13 if top[3]>1.3 else .09
    # Genuine lip, visible inner wall and a shallow dark baffle; no hidden ducts.
    rim=ring(top,shape,n);inner=ring(top,shape,n,inset=wall)
    loft(m,'cap-lip',[rim,inner],mat='edge')
    # Follow the lower casing's taper and rake. A vertical copy of the lip can
    # protrude through narrow jackets (particularly Clemson).
    depth=min(1.3,height*.15);lower=list(interpolate(ss,height-depth));lower[0]=height-depth
    # Retain every collar/neck section inside that depth; a single chord across
    # a rolled cap transition can emerge through its narrower outer jacket.
    liner=[inner]+[ring(s,shape,n,inset=wall+.035) for s in reversed(ss[:-1]) if s[0]>lower[0]]+[ring(lower,shape,n,inset=wall+.035)]
    loft(m,'visible-uptake',liner,mat='dark',floor=True)
    for z in p['bands']:
        sec=interpolate(ss,z);sec=(z,sec[1],sec[2]+.026,sec[3]+.026,sec[4])
        loft(m,'casing-band',[ring(sec,shape,n,dz=-.03),ring(sec,shape,n,dz=.03)],mat='painted-edge')
    # Crossbars rest on the lip. The open area remains large enough for smoke.
    for i in range(p['grates']):
        x=top[1]+(i-(p['grates']-1)/2)*(2*(top[2]-wall)/(p['grates']+1));y=perimeter_y(top,x,shape)-wall*.5;z=height+top[4]*(x-top[1])
        m.rod('exhaust-grating',(x,-y,z),(x,y,z),.032,mat='edge',vertices=6)
    if p['cage']:
        # Low arched protective hoops, fixed to opposite cap edges.
        for factor in [-.55,0,.55]:
            x=top[1]+factor*(top[2]-wall);y=perimeter_y(top,x,shape)-.02;base=height+top[4]*(x-top[1])
            pts=[(x,-y+2*y*i/6,base+p.get('cageHeight',.32)*math.sin(math.pi*i/6)) for i in range(7)]
            m.path('cap-hoop',pts,.024,mat='edge',vertices=6)
    # Pipe routes follow the casing rake and stand off on actual saddles.
    for dx,side in p['pipes']:
        z0=max(.10,height*p.get('pipeStart',0));z1=max(1,height-.45);steps=[z0,z0+(z1-z0)*.35,z0+(z1-z0)*.70,z1];points=[]
        for z in steps:
            sec=interpolate(ss,z);x=sec[1]+max(-sec[2]*.8,min(sec[2]*.8,dx));y=side*(perimeter_y(sec,x,shape)+.16);points.append((x,y,z))
            m.rod('pipe-saddle',(x,y,z),(x,side*(perimeter_y(sec,x,shape)-.035),z),.042,vertices=6)
        m.path('steam-pipe',points,.075,vertices=8)
        x,y,z=points[-1];m.cyl('pipe-mouth',(x,y,z+.01),.055,.012,mat='dark',vertices=8)
    if p['ladder']:
        sign=1 if p['ladder']=='forward' else -1;end=height-.5;zs=[.12,end*.33,end*.66,end]
        points=[]
        for z in zs:
            sec=interpolate(ss,z);x=sec[1]+sign*(sec[2]+.14);points.append(Vector((x,0,z)))
            for y in [-.23,.23]:m.rod('ladder-bracket',(x,y,z),(sec[1]+sign*(sec[2]-.07),y,z),.035,vertices=6)
        for y in [-.23,.23]:m.path('ladder-rail',[(v.x,y,v.z) for v in points],.024,vertices=6)
        count=math.ceil(end/.34)
        for i in range(count+1):
            z=.12+(end-.12)*i/count
            for a,b in zip(points,points[1:]):
                if z<=b.z+.001:
                    x=a.x+(b.x-a.x)*(z-a.z)/(b.z-a.z);break
            m.rod('ladder-rung',(x,-.23,z),(x,.23,z),.018,vertices=6)
    for z,side in p.get('platforms',[]):
        sec=interpolate(ss,z);x=sec[1];y=side*sec[3];width=min(1.8,sec[2]*1.2);depth=p.get('platformDepth',.62)
        m.box('service-platform',(x,y+side*(depth/2-.08),z),(width,depth,.075),mat='roof')
        for dx in [-width*.4,width*.4]:
            m.rod('platform-knee',(x+dx,side*(perimeter_y(interpolate(ss,z-.7),x+dx,shape)-.05),z-.7),(x+dx,y+side*(depth-.13),z-.04),.045,vertices=6)
        pts=[(x-width/2,y-side*.06),(x-width/2,y+side*(depth-.08)),(x+width/2,y+side*(depth-.08)),(x+width/2,y-side*.06)]
        rail(m,'platform',pts,z+.04)
    if 'walkway' in p:
        z=p['walkway'];sec=interpolate(ss,z);outer=(z,sec[1],sec[2]+p.get('walkwayOverhang',.50),sec[3]+p.get('walkwayOverhang',.50),0);inside=(z,sec[1],sec[2]-.04,sec[3]-.04,0)
        loft(m,'shoulder-walkway',[ring(inside,shape),ring(outer,shape)],mat='roof')
        pts=ring(outer,shape,16);rail(m,'walkway',[(x,y) for x,y,_ in pts],z)
        for i,(x,y,_) in enumerate(pts):
            if i%2:continue
            ix=sec[1]+(x-sec[1])*.85;iy=y*.85
            m.rod('walkway-knee',(ix,iy,z-.65),(x,y,z-.015),.045,vertices=6)
    if p.get('boxes'):
        for side in [-1,1]:m.box('lower-pipe-casing',(1.85,side*1.78,.8),(.72,.48,1.6))
    if p.get('vent'):
        # The forward Aosta funnel has two broad, installed side uptakes. They
        # share its deck sole and slope into the jacket below the service decks.
        for side in [-1,1]:
            vs=[(x,side*y,z) for x,y,z in [(-1.85,1.4,0),(2.97,1.4,0),(2.97,4.42,0),(-1.85,4.42,0),(-1.4,1.4,4.05),(2.3,1.4,4.05),(2.3,3.0,4.05),(-1.4,3.0,4.05)]]
            m.mesh('side-uptake',vs,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
            m.box('uptake-service-deck',(.4,side*3.25,4.10),(3.8,2.35,.1),mat='roof')
            rail(m,'uptake-service',[(x,side*y) for x,y in [(-1.5,1.7),(-1.5,4.425),(2.3,4.425),(2.3,1.7)]],4.15)
            for x in [-1.25,2.05]:m.rod('service-deck-knee',(x,side*2.9,3.25),(x,side*4.25,4.05),.055,vertices=6)
        # Distinct forward auxiliary mouth on Duca d'Aosta's cap, joined to cap.
        cx=2.2;z=top[0]+top[4]*cx-.25
        a=(z,cx,.33,.33,0);loft(m,'auxiliary-uptake',[ring(a,'ellipse',16,dz=-.5),ring(a,'ellipse',16,dz=.28)])
        loft(m,'auxiliary-mouth',[ring(a,'ellipse',16,dz=.28),ring(a,'ellipse',16,inset=.06,dz=.28),ring(a,'ellipse',16,inset=.06,dz=.05)],mat='dark',floor=True)
    return m.root


def create_dreadnought(part,col,helpers,materials):return build(part,col,helpers,materials,PROFILES['dreadnought-aft-funnel'])
def create_hood(part,col,helpers,materials):return build(part,col,helpers,materials,PROFILES['hood-forward-funnel'])
def create_nelson(part,col,helpers,materials):return build(part,col,helpers,materials,PROFILES['nelson-funnel'])
def create_emden(part,col,helpers,materials):return build(part,col,helpers,materials,PROFILES['emden-aft-funnel'])
def create_mikasa(part,col,helpers,materials):return build(part,col,helpers,materials,PROFILES['mikasa-forward-funnel'])
def create_clemson(part,col,helpers,materials):return build(part,col,helpers,materials,PROFILES['clemson-forward-funnel'])
def create_dunkerque(part,col,helpers,materials):return build(part,col,helpers,materials,PROFILES['dunkerque-funnel'])
def create_kirov(part,col,helpers,materials):return build(part,col,helpers,materials,PROFILES['kirov-forward-funnel'])
def create_aosta(part,col,helpers,materials):return build(part,col,helpers,materials,PROFILES['aosta-forward-funnel'])
def create_cesare(part,col,helpers,materials):return build(part,col,helpers,materials,PROFILES['cesare-forward-funnel'])
def create_blyskawica(part,col,helpers,materials):return build(part,col,helpers,materials,PROFILES['blyskawica-funnel'])
def create_aurora(part,col,helpers,materials):return build(part,col,helpers,materials,PROFILES['aurora-middle-funnel'])
