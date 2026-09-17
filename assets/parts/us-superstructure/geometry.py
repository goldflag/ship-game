"""Standalone US superstructure fittings for the ship editor.

Source adaptations of the original Iowa (assets/ships/iowa/superstructure.py and
blueprint funnel loft) and Baltimore (assets/ships/baltimore/build.py) recipes,
normalized to a deck datum at the origin: +X forward, +Y port, +Z up. No published
or reference model is an input; ship-only context (blueprint structures, support
surfaces, ship-to-ship rigging) is dropped and the numbers are hard-coded here.
"""
import sys, math
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'construction'))
from geometry import Model


def _loft(m,name,rings,closed_top=False,**kw):
    n=len(rings[0]);vs=[v for ring in rings for v in ring]
    fs=[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(len(rings)-1) for i in range(n)]
    if closed_top:fs.append(tuple(range((len(rings)-1)*n,len(rings)*n)))
    return m.mesh(name,vs,fs,smooth=True,**kw)

def _stadium(r,xf,xa,zf,za=None,half=21):
    """Oblong ring: semicircular ends of radius r, tips at xf/xa, planar height zf..za."""
    za=zf if za is None else za;pts=[]
    for cx,start in [(xf-r,-math.pi/2),(xa+r,math.pi/2)]:
        for i in range(half):
            a=start+math.pi*i/(half-1);x=cx+r*math.cos(a)
            pts.append((x,r*math.sin(a),za+(zf-za)*(x-xa)/(xf-xa)))
    return pts

def _ellipse(cx,rx,ry,z,n=48,slope=0):
    return [(cx+rx*math.cos(i*math.tau/n),ry*math.sin(i*math.tau/n),z+slope*rx*math.cos(i*math.tau/n)) for i in range(n)]

def _side_ladder(m,name,a,b,width,**kw):
    """Ladder whose rungs run fore and aft (for the flanks of a casing)."""
    a,b=Vector(a),Vector(b);w=Vector((width/2,0,0))
    for s in [-1,1]:m.rod(name+'.rail',a+s*w,b+s*w,.025,vertices=6,**kw)
    steps=max(1,math.ceil((b-a).length/.32))
    for i in range(steps+1):
        p=a.lerp(b,i/steps);m.rod(name+'.rung',p-w,p+w,.017,vertices=5,**kw)

def _rail(m,name,pts,z,height=.9,every=2,closed=True,**kw):
    pts=[(p[0],p[1]) for p in pts]
    if not closed:m.rod(name+'.stanchion',(*pts[-1],z),(*pts[-1],z+height),.022,vertices=6,**kw)
    for i,(a,b) in enumerate(zip(pts,pts[1:]+(pts[:1] if closed else []))):
        if i%every==0:m.rod(name+'.stanchion',(*a,z),(*a,z+height),.022,vertices=6,**kw)
        for dz in [height*.5,height]:m.rod(name+'.wire',(*a,z+dz),(*b,z+dz),.015,mat='edge',vertices=5,**kw)

def _annulus(m,name,outer,inner,z,thick=.11,**kw):
    n=len(outer);vs=[(x,y,z+dz) for dz in [-thick/2,thick/2] for ring in [outer,inner] for x,y in ring];fs=[]
    for i in range(n):
        j=(i+1)%n
        for a,b in [(0,n),(2*n,0),(n,3*n),(3*n,2*n)]:fs.append((a+i,a+j,b+j,b+i))
    return m.mesh(name,vs,fs,**kw)


def create_battleship_funnel(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    # Iowa forward funnel loft (blueprint funnel-forward), datum at the jacket foot:
    # a vertical 8.0 x 4.8 m oblong jacket, flared shoulder, and the swept-back hood
    # whose raked mouth sits over the forward two thirds of the cap.
    R=2.4
    m.prism('base-flange',[(x,y) for x,y,_ in _stadium(R+.13,4.13,-4.13,0)],0,.22,mat='edge')
    _loft(m,'jacket',[_stadium(R,4,-4,0),_stadium(R,4,-4,13.09)])
    _loft(m,'shoulder-flare',[_stadium(R,4,-4,13.09),_stadium(2.52,4.21,-4.21,13.56)])
    _loft(m,'shoulder',[_stadium(2.52,4.21,-4.21,13.56),_stadium(2.23,3.92,-3.96,14.725)])
    hood=[_stadium(2.23,3.92,-3.96,14.725),_stadium(2.18,3.73,-3.96,15.52,14.82),_stadium(2.13,3.34,-3.96,16.23,14.90),
          _stadium(2.09,2.88,-3.96,16.86,14.97),_stadium(2.04,2.22,-3.96,17.57,15.05)]
    _loft(m,'swept-hood',hood)
    _loft(m,'hood-crown',[hood[-1],_stadium(1.65,2.29,-2.05,17.27,15.46)],mat='roof')
    # Black lip extruded normal to the raked mouth plane, with a recessed uptake.
    n=64;lip=[]
    for cx,z,rx,ry in [(.12,16.362,2.175,1.65),(-.28,17.1075,2.09,1.59),(-.28,17.1075,1.94,1.44),(.12,15.51,1.94,1.44)]:
        lip.append(_ellipse(cx,rx,ry,z,n,.416))
    _loft(m,'raked-lip-and-uptake',lip,closed_top=True,mat='dark')
    m.path('lip-rolled-edge',_ellipse(-.28,2.02,1.52,17.1075,32,.416),.04,closed=True,mat='edge',vertices=6)
    for along in [-1.35,-.45,.45,1.35]:
        half=1.43*math.sqrt(1-(along/1.94)**2);x=-.28+along;z=17.04+.416*along
        m.rod('uptake-grating',(x,-half,z),(x,half,z),.05,mat='edge',vertices=6)
    m.rod('grating-spine',(-2.20,0,16.24),(1.64,0,17.84),.045,mat='edge',vertices=8)
    # Plating bands on the jacket.
    for z in [3.3,6.6,9.9,13.0]:
        m.prism('jacket-band',[(x,y) for x,y,_ in _stadium(R+.035,4.035,-4.035,0)],z-.07,z+.07,mat='edge')
    # Annular service walkway at the hood shoulder, on plate knees.
    walk=[(-.02+(x+.02)*1.10,y*1.20) for x,y,_ in _stadium(2.23,3.92,-3.96,0)]
    inner=[(-.02+(x+.02)*.84,y*.83) for x,y in walk]
    _annulus(m,'service-walkway',walk,inner,14.725,mat='roof')
    _rail(m,'walkway-rail',walk,14.78,.82)
    for i in range(0,len(walk),3):
        x,y=walk[i];a=Vector((-.02+(x+.02)*.88,y*.82,13.74));b=Vector((x,y,14.67));c=Vector((a.x,a.y,14.67))
        t=Vector((-y,x+.02,0)).normalized()
        vs=[tuple(v+t*s) for s in [-.028,.028] for v in [a,b,c]]
        m.mesh('walkway-knee',vs,[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)])
    for side in [-1,1]:
        _side_ladder(m,'jacket-ladder',(1.6,side*2.56,.22),(1.6,side*2.56,14.74),.41,mat='edge')
        for z in [2.5,6.5,10.5,13.5]:
            for dx in [-.205,.205]:m.rod('ladder-shoe',(1.6+dx,side*2.38,z),(1.6+dx,side*2.57,z),.026,vertices=6)
        _side_ladder(m,'cap-ladder',(-1.12,side*2.31,14.78),(-1.27,side*1.96,16.01),.37,mat='edge')
        for z in [14.9,15.8]:
            t=(z-14.78)/1.23;m.rod('cap-ladder-shoe',(-1.12-.15*t,side*1.75,z),(-1.12-.15*t,side*(2.31-.35*t),z),.026,vertices=6)
        # Two gooseneck steam outlets run up the after edge of the jacket.
        y=side*.63;pipe=[(-4.36,y,0),(-4.36,y,14.57),(-4.55,y,15.22),(-4.77,y,15.49),(-5.06,y,15.49)]
        m.path('steam-pipe',pipe[:2],.104,vertices=12)
        m.path('steam-gooseneck',pipe[1:],.104,mat='dark',vertices=12)
        for z in [1.5,5,9,12.4,14.2]:m.rod('steam-pipe-bracket',(-3.85,y,z),(-4.40,y,z),.044,vertices=8)
    # Steam whistle and siren on a bracket platform on the forward face.
    m.box('whistle-platform',(4.45,0,10.6),(.9,1.7,.06),mat='roof')
    for y in [-.75,.75]:m.rod('whistle-platform-knee',(4.0,y,9.9),(4.85,y,10.57),.04,vertices=6)
    _rail(m,'whistle-rail',[(4.0,-.85),(4.9,-.85),(4.9,.85),(4.0,.85)],10.63,.85,every=1,closed=False)
    m.cyl('whistle',(4.5,-.35,11.05),.1,.55,mat='bronze',vertices=12);m.cyl('whistle-bell',(4.5,-.35,11.42),.13,.2,mat='bronze',vertices=12)
    m.rod('siren',(4.35,.35,10.95),(4.85,.35,10.95),.16,r2=.24,mat='edge',vertices=16)
    m.path('whistle-steam-line',[(4.1,-.35,0),(4.1,-.35,10.75),(4.5,-.35,10.78)],.04,vertices=8)
    return m.root


def create_cruiser_funnel(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    # Baltimore forward stack: flared oval uptake foot, then an oval casing raked
    # 1.25 m aft over 13.2 m, flat edge cap with an open black exhaust.
    n=48;top=15.4;rake=1.25
    def cx(z):return -max(0,z-2.2)/(top-2.2)*rake
    m.prism('base-flange',[(x,y) for x,y,_ in _ellipse(0,4.22,3.22,0,n)],0,.2,mat='edge')
    _loft(m,'uptake-foot',[_ellipse(0,4.1,3.1,0,n),_ellipse(0,3.4,2.55,2.2,n)])
    _loft(m,'casing',[_ellipse(0,3.4,2.55,2.2,n),_ellipse(-rake,3.4,2.55,top,n)])
    cap=[_ellipse(-rake,3.4,2.55,top-.02,n),_ellipse(-rake,3.55,2.7,top,n),_ellipse(-rake,3.55,2.7,top+.4,n),_ellipse(-rake,3.20,2.35,top+.4,n)]
    _loft(m,'cap',cap,mat='edge')
    _loft(m,'exhaust-interior',[_ellipse(-rake,3.20,2.35,top+.4,n),_ellipse(-rake+.17,3.12,2.28,top-1.4,n)],closed_top=True,mat='dark')
    for dx in [-2.1,-.7,.7,2.1]:
        half=2.35*math.sqrt(1-(dx/3.2)**2);m.rod('cap-grating',(-rake+dx,-half,top+.33),(-rake+dx,half,top+.33),.05,mat='edge',vertices=6)
    m.rod('cap-grating-spine',(-rake-3.2,0,top+.33),(-rake+3.2,0,top+.33),.055,mat='edge',vertices=6)
    for z in [5.2,9.2,12.2]:
        m.path('stack-band',_ellipse(cx(z),3.43,2.58,z,40),.04,closed=True,mat='edge',vertices=6)
    for side in [-1,1]:
        for dx in [-1.5,0,1.5]:
            a=Vector((dx-.02,side*2.65,1.9));b=Vector((dx-1.1,side*2.65,top+.65))
            m.rod('steam-pipe',a,b,.11,vertices=10)
            m.rod('steam-pipe-mouth',b,b+(b-a).normalized()*.012,.085,mat='dark',vertices=10)
            for z in [4.2,8.2,12.0]:
                p=a.lerp(b,(z-a.z)/(b.z-a.z));rx=3.4;y=2.55*math.sqrt(max(0,1-((p.x-cx(z))/rx)**2))
                m.rod('steam-pipe-saddle',p,(p.x,side*(y-.05),z),.05,vertices=8)
        # Uptake air intake louvres in the flared foot.
        m.box('uptake-intake',(0,side*2.90,1.15),(2.0,.30,1.15),mat='edge')
        for z in [.75,.95,1.15,1.35,1.55]:m.box('intake-slat',(0,side*3.06,z),(1.9,.035,.04))
    # Walkway wraps the oval shoulder below the cap.
    zc=13.0;outer=[(x,y) for x,y,_ in _ellipse(cx(zc),3.95,3.05,0,32)];inner=[(x,y) for x,y,_ in _ellipse(cx(zc),3.36,2.5,0,32)]
    _annulus(m,'shoulder-walkway',outer,inner,zc,.1,mat='roof')
    _rail(m,'walkway-rail',outer,zc+.05,.95)
    for i in range(0,32,2):
        x,y=outer[i];ix,iy=inner[i];t=Vector((-y,x-cx(zc),0)).normalized()
        a=Vector((ix+(x-ix)*.08,iy+(y-iy)*.08,zc-.85));b=Vector((x,y,zc-.05));c=Vector((a.x,a.y,zc-.05))
        vs=[tuple(v+t*s) for s in [-.025,.025] for v in [a,b,c]]
        m.mesh('walkway-knee',vs,[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)])
    # Maintenance ladder on the after centreline follows the rake.
    m.ladder('maintenance-ladder',(-3.62,0,2.2),(-3.62-rake*(zc-2.2)/(top-2.2),0,zc+.05),.5,mat='edge')
    for z in [3.5,6.5,9.5,12.3]:
        for y in [-.25,.25]:m.rod('ladder-standoff',(cx(z)-3.63,y,z),(cx(z)-3.38,y,z),.028,vertices=6)
    return m.root


def create_main_director(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    # Iowa Mk 38 head on a short fixed barbette so it can stand on a deck or tower top.
    base=1.2
    _loft(m,'pedestal',[_ellipse(0,r,r,z) for r,z in [(1.86,0),(1.68,base)]],closed_top=True)
    for z,r in [(.06,1.92),(base-.05,1.73)]:m.cyl('pedestal-band',(0,0,z),r,.11,mat='edge',vertices=48)
    m.bolts(1.80,.14,20)
    m.box('pedestal-access-door',(-1.76,0,.62),(.07,.62,.92),mat='edge')
    for side in [-1,1]:m.rod('pedestal-conduit',(.4,side*1.80,.1),(.4,side*1.70,base-.1),.045,mat='edge',vertices=8)
    yaw=m.empty('yaw',(0,0,base),m.root)
    def head(name,bottom,top,z0,z1,**kw):
        k=len(bottom);vs=[(a,b,z) for poly,z in [(bottom,z0),(top,z1)] for a,b in poly]
        return m.mesh(name,vs,[tuple(reversed(range(k))),tuple(range(k,2*k))]+[(i,(i+1)%k,(i+1)%k+k,i+k) for i in range(k)],parent=yaw,**kw)
    m.cyl('training-race',(0,0,base+.13),1.57,.26,mat='edge',vertices=40,parent=yaw)
    bottom=[(-1.76,-1.12),(-1.31,-1.50),(1.34,-1.50),(1.76,-1.06),(1.76,1.06),(1.34,1.50),(-1.31,1.50),(-1.76,1.12)]
    top=[(-1.35,-.95),(-1.05,-1.20),(1.03,-1.20),(1.39,-.86),(1.39,.86),(1.03,1.20),(-1.05,1.20),(-1.35,.95)]
    head('armored-head-skirt',bottom,bottom,base+.24,base+.64)
    head('armored-head',bottom,top,base+.64,base+1.59)
    head('head-roof',[(x*.93,y*.93) for x,y in top],[(x*.93,y*.93) for x,y in top],base+1.59,base+1.63,mat='roof')
    m.cyl('roof-hatch',(-.55,0,base+1.66),.36,.07,mat='edge',vertices=20,parent=yaw)
    # Armored rangefinder wings: chamfered tubes reaching 4.7 m either side.
    c=.13;sec=[(-.512+c,0),(.512-c,0),(.512,c),(.512,1.06-c),(.512-c,1.06),(-.512+c,1.06),(-.512,1.06-c),(-.512,c)]
    for side in [-1,1]:
        vs=[(.18+x,side*y,base+.08+z) for y in [1.30,4.714] for x,z in sec]
        m.mesh('rangefinder-wing',vs,[tuple(reversed(range(8))),tuple(range(8,16))]+[(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)],parent=yaw)
        for y in [2.35,3.45]:m.box('wing-joint-strap',(.18,side*y,base+.61),(1.05,.09,1.085),mat='edge',parent=yaw)
        m.box('wing-optical-bezel',(.706,side*4.42,base+.53),(.065,.29,.55),mat='edge',parent=yaw)
        m.box('wing-objective',(.749,side*4.42,base+.53),(.025,.17,.41),mat='dark',parent=yaw)
        for y in [1.75,3.15,4.60]:m.rod('wing-rail-post',(-.2,side*y,base+1.14),(-.2,side*y,base+1.38),.018,vertices=6,parent=yaw)
        m.rod('wing-rail',(-.2,side*1.75,base+1.38),(-.2,side*4.60,base+1.38),.018,vertices=6,parent=yaw)
        m.box('sight-cover',(1.53,side*.77,base+1.01),(.18,.37,.55),parent=yaw)
        m.box('vision-slit',(1.63,side*.77,base+.88),(.025,.23,.24),mat='dark',parent=yaw)
        for x in [-.76,.12]:m.rod('instrument-trestle',(x,side*1.24,base+1.59),(-.28,side*1.24,base+2.37),.05,vertices=8,parent=yaw)
    # Long covered instrument above the head and the small auxiliary unit to port.
    cross=[(-.76,2.56),(-.73,2.90),(-.58,3.10),(.08,3.10),(.24,2.94),(.27,2.59),(.12,2.36),(-.57,2.36)]
    vs=[(x,y,base+z) for y in [-2.05,2.05] for x,z in cross]
    m.mesh('covered-instrument',vs,[tuple(reversed(range(8))),tuple(range(8,16))]+[(i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8)],parent=yaw)
    for y in [-1.65,-1.1,-.55,0,.55,1.1,1.65]:
        m.path('cover-seam',[(x,y,base+z+.006) for x,z in cross[:6]],.012,mat='edge',vertices=4,parent=yaw)
    for side in [-1,1]:m.box('instrument-window',(.262,side*1.45,base+2.76),(.025,.5,.2),mat='dark',parent=yaw).rotation_euler.y=-.09
    for x in [-.65,.15]:
        for y in [2.17,2.77]:m.rod('auxiliary-leg',(x,y,base+1.14),(-.20,(y-2.47)*.5+2.47,base+2.19),.036,vertices=8,parent=yaw)
    m.box('auxiliary-instrument',(-.20,2.47,base+2.44),(.62,.69,.48),parent=yaw)
    m.box('auxiliary-window',(.123,2.47,base+2.44),(.025,.43,.15),mat='dark',parent=yaw)
    _rail(m,'roof-rail',[(x*.9,y*.9) for x,y in [top[2],top[1],top[0],top[7],top[6],top[5]]],base+1.63,.55,every=1,closed=False,parent=yaw)
    for i in range(20):
        a=i*math.tau/20+.157;m.cyl('race-bolt',(1.47*math.cos(a),1.47*math.sin(a),base+.27),.035,.05,mat='edge',vertices=6,parent=yaw)
    for z,x in [(base+.35,-1.76),(base+1.45,-1.41)]:
        for y in [-.22,.22]:m.rod('ladder-standoff',(-1.98+.36*(z-base-.1)/1.5,y,z),(x,y,z),.022,mat='edge',vertices=6,parent=yaw)
    m.ladder('rear-access',(-1.98,0,base+.1),(-1.62,0,base+1.6),.44,mat='edge',parent=yaw)
    return m.root


def create_pole_mast(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    # Baltimore mainmast: 27.6 m pole raked 1.5 m aft, two forward struts, an 11 m
    # yard and the SK mattress on a small platform at the head. Fixed (no joints).
    top=27.6
    def px(z):return -1.5*z/top
    def pr(z):return .3-.225*z/top
    m.cyl('foot',(0,0,.09),.52,.18,mat='edge',vertices=24);m.bolts(.43,.2,10)
    zp=23.55
    m.rod('pole',(0,0,.1),(px(zp+.6),0,zp+.6),.3,r2=pr(zp+.6),vertices=16)
    for z in [5,10,15.73,20]:m.cyl('pole-band',(px(z),0,z),pr(z)+.025,.12,mat='edge',vertices=16)
    zj=top*.57
    for side in [-1,1]:
        m.cyl('strut-foot',(4,side*2.7,.06),.3,.12,mat='edge',vertices=16)
        m.rod('strut',(4,side*2.7,.06),(px(zj),0,zj),.13,r2=.09,vertices=10)
    m.rod('strut-spreader',(4-4.86*.45,-2.7*.55,zj*.45),(4-4.86*.45,2.7*.55,zj*.45),.05,vertices=8)
    # Lookout platform at the strut junction.
    def disc(name,z,r,cxo=0):
        c=px(z)+cxo;ring=[(c+r*math.cos(i*math.tau/20),r*math.sin(i*math.tau/20)) for i in range(20)]
        m.prism(name,ring,z-.05,z+.05,mat='roof');_rail(m,name+'-rail',ring,z+.05,.95)
        for a in [math.pi/4,3*math.pi/4,5*math.pi/4,7*math.pi/4]:
            m.rod(name+'-knee',(px(z-1.1)+pr(z)*math.cos(a),pr(z)*math.sin(a),z-1.1),(c+r*.85*math.cos(a),r*.85*math.sin(a),z-.05),.04,vertices=6)
    disc('lookout-platform',zj+.75,1.15,.25)
    # Yard with braces, footropes and signal halyards.
    zy=top-6.4;mx=-1.15
    m.rod('yard-sling',(px(zy),0,zy),(mx,0,zy),.07,vertices=8)
    for side in [-1,1]:
        m.rod('yard',(mx,0,zy),(mx,side*5.5,zy),.09,r2=.055,vertices=12)
        m.rod('yard-brace',(px(zy+2.2),0,zy+2.2),(mx,side*5.5,zy),.03,mat='edge',vertices=6)
        m.path('footrope',[(mx,side*y,zy-.12-.5*math.sin(math.pi*(y-.4)/5.0)) for y in [.4,1.4,2.4,3.4,4.4,5.4]],.014,mat='edge',vertices=5)
        for y in [2.4,4.0]:
            m.cyl('signal-block',(mx,side*y,zy-.14),.06,.1,mat='edge',vertices=8)
        m.cyl('yardarm-light',(mx,side*5.35,zy+.13),.07,.16,mat='dark',vertices=8)
        m.rod('signal-halyard',(mx,side*4.0,zy-.18),(3.7,side*2.7,.5),.013,mat='edge',vertices=5)
    # Radar platform and the SK air-search mattress (4.9 x 3.1 m) at the masthead.
    disc('radar-platform',zp,1.35)
    xr=px(zp);m.cyl('radar-pedestal',(xr,0,zp+.5),.2,.9,mat='edge',vertices=16)
    zc=zp+.95+1.55;xa=xr+.22;w,h=4.9,3.1
    m.rod('radar-spine',(xr,0,zp+.9),(xr,0,zc+h/2),.06,vertices=8)
    for z in [zc-1.1,zc,zc+1.1]:
        m.rod('radar-standoff',(xr,0,z),(xa,0,z),.04,vertices=6)
        m.rod('radar-back-beam',(xr,-w*.42,z),(xr,w*.42,z),.035,vertices=6)
        for side in [-1,1]:m.rod('radar-beam-tie',(xr,side*w*.42,z),(xa,side*w*.42,z),.03,vertices=6)
    for i in range(13):
        y=-w/2+w*i/12;m.rod('mattress-vertical',(xa,y,zc-h/2),(xa,y,zc+h/2),.025,mat='edge',vertices=6)
    for i in range(9):
        z=zc-h/2+h*i/8;m.rod('mattress-horizontal',(xa,-w/2,z),(xa,w/2,z),.025,mat='edge',vertices=6)
    for i in range(6):
        for j in range(4):
            y=-w/2+w*(i+.5)/6;z=zc-h/2+h*(j+.5)/4
            m.rod('dipole',(xa+.16,y-.17,z),(xa+.16,y+.17,z),.014,vertices=5)
            m.rod('dipole-stem',(xa,y,z),(xa+.16,y,z),.011,vertices=4)
    for side in [-1,1]:m.rod('mattress-brace',(xr,0,zp+1.0),(xa,side*w/2,zc-h/2),.035,vertices=6)
    m.rod('iff-bar',(xa,-1.3,zc+h/2+.28),(xa,1.3,zc+h/2+.28),.03,mat='edge',vertices=6)
    for y in [-.9,.9]:m.rod('iff-post',(xa,y,zc+h/2),(xa,y,zc+h/2+.28),.02,vertices=5)
    # Climbing rungs up the after side of the pole to the lookout platform.
    m.ladder('pole-ladder',(-.36,0,.3),(px(zj)-pr(zj)-.12,0,zj+.6),.4,mat='edge')
    return m.root
