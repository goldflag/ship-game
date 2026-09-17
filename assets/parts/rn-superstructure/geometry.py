"""Royal Navy superstructure parts for the ship editor.

Source adaptations of assets/ships/king-george-v/build.py (funnel jackets,
tripod masts, HACS Mk IV directors) and the Flower-class stack in
assets/ships/convoy/geometry-v2.py, normalised to a deck datum at the origin.
No published or reference model is an input.
"""
import sys, math
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'construction'))
from geometry import Model


def oval(rx,ry,z,n=56,p=2.0,cx=0):
    # Superellipse ring; p>2 flattens the sides while keeping rounded ends.
    out=[]
    for i in range(n):
        a=i*math.tau/n;c,s=math.cos(a),math.sin(a)
        out.append((cx+rx*math.copysign(abs(c)**(2/p),c),ry*math.copysign(abs(s)**(2/p),s),z))
    return out


def loft(m,name,rings,closed_top=False,closed_bottom=False,inward=False,**kw):
    n=len(rings[0]);vs=[v for ring in rings for v in ring]
    fs=[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(len(rings)-1) for i in range(n)]
    if closed_bottom:fs.append(tuple(reversed(range(n))))
    if closed_top:fs.append(tuple(range((len(rings)-1)*n,len(rings)*n)))
    o=m.mesh(name,vs,fs,**kw)
    # Open shells have no defined outside; force the wall normals explicitly.
    poly=o.data.polygons[0];c=poly.center;points_in=(poly.normal.x*-c.x+poly.normal.y*-c.y)>0
    if abs(poly.normal.z)>.9:
        if poly.normal.z<0:o.data.flip_normals()  # flat lips face up
    elif points_in!=inward:o.data.flip_normals()
    return o


def soot(m,ring):
    o=m.mesh('soot',ring,[tuple(range(len(ring)))],mat='dark')
    if o.data.polygons[0].normal.z<0:o.data.flip_normals()
    return o


def hoop(m,name,rx,ry,z,tube,n=48,k=6,p=2.0,**kw):
    ring=oval(1,1,0,n,p);vs=[]
    for x,y,_ in ring:
        for j in range(k):
            b=j*math.tau/k;vs.append(((rx+tube*math.cos(b))*x,(ry+tube*math.cos(b))*y,z+tube*math.sin(b)))
    return m.mesh(name,vs,[(i*k+j,((i+1)%n)*k+j,((i+1)%n)*k+(j+1)%k,i*k+(j+1)%k) for i in range(n) for j in range(k)],smooth=True,**kw)


def guard_rail(m,name,points,height=.95,closed=True,**kw):
    points=list(points)
    for h in [height*.5,height]:m.path(name+'.wire',[(x,y,z+h) for x,y,z in points],.02,closed=closed,mat='edge',vertices=5,**kw)
    for x,y,z in points:m.rod(name+'.stanchion',(x,y,z),(x,y,z+height),.028,vertices=6,**kw)


def octagon(x,y,l,w,c=.25):
    return [(x-l/2,y-w/2+c),(x-l/2+c,y-w/2),(x+l/2-c,y-w/2),(x+l/2,y-w/2+c),(x+l/2,y+w/2-c),(x+l/2-c,y+w/2),(x-l/2+c,y+w/2),(x-l/2,y+w/2-c)]


def create_battleship_funnel(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    # KGV jacket: 6.96 x 5.50 m flat-sided oval, 12.4 m above its casing, unraked.
    top=12.4;rx=3.48;ry=2.75;n=56;p=2.6;wall=.20
    loft(m,'jacket',[oval(rx*1.03,ry*1.04,0,n,p),oval(rx*1.03,ry*1.04,.55,n,p),oval(rx,ry,.75,n,p),oval(rx,ry,top,n,p)],smooth=True)
    loft(m,'mouth-lip',[oval(rx,ry,top,n,p),oval(rx-wall,ry-wall,top,n,p)],mat='roof')
    loft(m,'uptake-liner',[oval(rx-wall,ry-wall,top,n,p),oval(rx-wall,ry-wall,top-1.8,n,p)],inward=True,mat='dark',smooth=True)
    soot(m,oval(rx-wall,ry-wall,top-1.8,n,p))
    # Internal uptake division plates visible down the mouth.
    m.box('uptake-division',(0,0,top-1.2),(.10,2*(ry-wall)-.05,1.2),mat='dark')
    for z in [.62,4.0,8.3,top-.35]:hoop(m,'circumferential-band',rx+.025,ry+.025,z,.055,n=n,p=p)
    hoop(m,'rolled-mouth',rx,ry,top,.14,n=n,k=8,p=p,mat='roof')
    hoop(m,'base-flange',rx*1.03+.04,ry*1.04+.04,.07,.07,n=n,p=p,mat='edge')
    def half_width(x,inset=0):return (ry-inset)*(1-abs(x/(rx-inset))**p)**(1/p)
    for x in [-2.4,-1.2,0,1.2,2.4]:
        h=half_width(x)
        m.path('cap-lattice',[(x,-h,top+.03),(x,-h*.55,top+.48),(x,0,top+.60),(x,h*.55,top+.48),(x,h,top+.03)],.042,mat='edge',vertices=8)
    m.path('cap-spine',[(-rx,0,top),(-rx*.5,0,top+.57),(rx*.5,0,top+.57),(rx,0,top)],.055,mat='edge',vertices=8)
    for y in [-1.3,1.3]:
        x=rx*(1-abs(y/ry)**p)**(1/p)
        m.path('cap-stringer',[(-x,y,top+.03),(-x*.5,y,top+.40),(x*.5,y,top+.40),(x,y,top+.03)],.035,mat='edge',vertices=8)
    for side in [-1,1]:
        for dx in [-1.8,-.55,.7]:
            y=half_width(dx)+.10
            pts=[(dx,side*y,.1),(dx,side*y,top-1.45),(dx-.23,side*(y+.02),top-1.07),(dx-.58,side*(y+.02),top-1.0)]
            m.path('steam-pipe',pts,.085,vertices=10)
            for z in [2.2,5.2,8.2,10.6]:m.rod('pipe-clip',(dx,side*(y-.14),z),(dx,side*(y+.02),z),.035,mat='edge',vertices=6)
        # Whistle pipe up the forward shoulder with its flared bell.
        wy=half_width(2.4)+.13
        m.path('whistle-pipe',[(2.4,side*wy,.1),(2.4,side*wy,8.2),(2.62,side*wy,8.5)],.06,vertices=8)
        m.rod('whistle-bell',(2.62,side*wy,8.5),(3.10,side*wy,8.62),.07,r2=.15,mat='bronze',vertices=12)
        for z in [2.5,5.5,7.9]:m.rod('whistle-clip',(2.4,side*(wy-.16),z),(2.4,side*wy,z),.03,mat='edge',vertices=6)
    m.ladder('maintenance-ladder',(-rx-.20,0,.2),(-rx-.20,0,top+.06),.56,mat='edge')
    for z in [2,4,6,8,10,12]:
        for y in [-.28,.28]:m.rod('ladder-bracket',(-rx+.02,y,z),(-rx-.20,y,z),.025,mat='edge',vertices=6)
    # Searchlight walk about halfway up the visible stack, bracketed off the jacket.
    walk=6.4;outer=oval(rx+.85,ry+.85,walk,40,p);inner=oval(rx-.02,ry-.02,walk,40,p)
    vs=outer+inner+[(x,y,z+.12) for x,y,z in outer]+[(x,y,z+.12) for x,y,z in inner];k=40
    m.mesh('searchlight-walk',vs,[f for i in range(k) for j in [(i+1)%k] for f in [(i,j,k+j,k+i),(2*k+i,3*k+i,3*k+j,2*k+j),(i,2*k+i,2*k+j,j)]],mat='roof')
    guard_rail(m,'walk-rail',[(x,y,walk+.12) for x,y,_ in oval(rx+.80,ry+.80,0,20,p)])
    for i in range(0,40,4):
        ox,oy,_=outer[i];ix,iy,_=inner[i]
        m.rod('walk-bracket',(ox*.97,oy*.97,walk),(ix,iy,walk-.95),.04,mat='edge',vertices=6)
    return m.root


def create_tripod_foremast(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    # KGV foremast: main pole foot at origin, two legs raked aft, lookout
    # platform 19.5 m up, masthead 27 m, paired Type 279 aerials above.
    plat=19.5;top=27.0;px=-.70
    m.cyl('pole-foot',(0,0,.10),.46,.20,mat='edge',vertices=20);m.bolts(.38,.22,10)
    m.rod('lower-pole',(0,0,.1),(px,0,plat),.30,r2=.20,vertices=16)
    m.rod('upper-pole',(px,0,plat),(-.9,0,top+1.0),.145,r2=.045,vertices=12)
    foot=(-4.65,3.87);head=(px,.42)
    for side in [-1,1]:
        m.cyl('leg-foot',(foot[0],side*foot[1],.08),.34,.16,mat='edge',vertices=16)
        m.rod('tripod-leg',(foot[0],side*foot[1],.08),(head[0],side*head[1],plat),.22,r2=.13,vertices=12)
    for k in range(1,6):
        t=k/6;z=plat*t;dy=foot[1]*(1-t)+head[1]*t;dx=foot[0]*(1-t)+head[0]*t
        m.rod('cross-tie',(dx,-dy,z),(dx,dy,z),.055,vertices=8)
        m.rod('pole-tie',(dx,0,z),(px*t,0,z+.0),.05,vertices=8)
    # Lookout platform ("starfish") with plated deck, guard rail and knee supports.
    deck=octagon(-.8,0,3.1,5.0,.6)
    m.prism('lookout-platform',deck,plat,plat+.13,mat='roof')
    guard_rail(m,'platform-guard',[(x,y,plat+.13) for x,y in deck],.90)
    for side in [-1,1]:
        m.rod('platform-support',(-.8,side*2.4,plat),(-.55,side*.45,plat-1.75),.075,vertices=8)
        m.rod('platform-support',(.6,side*1.6,plat),(-.55,side*.25,plat-1.75),.06,vertices=8)
        m.rod('platform-support',(-2.2,side*1.6,plat),(-.9,side*.55,plat-1.75),.06,vertices=8)
    # Lookout office on the platform and a lower searchlight/lookout stage.
    m.prism('lookout-office',octagon(-.95,0,1.5,1.7,.3),plat+.13,plat+2.05)
    m.prism('lookout-office-roof',octagon(-.95,0,1.7,1.9,.3),plat+2.05,plat+2.13,mat='roof')
    for y in [-.45,.45]:m.box('lookout-window',(-.19,y,plat+1.55),(.03,.5,.4),mat='dark')
    low=11.4;t=low/plat;cx=foot[0]*(1-t)+head[0]*t
    stage=octagon((cx+px*t)/2,0,abs(cx-px*t)+1.2,2*(foot[1]*(1-t)+head[1]*t)+.9,.5)
    m.prism('lower-stage',stage,low,low+.11,mat='roof')
    guard_rail(m,'stage-guard',[(x,y,low+.11) for x,y in stage],.90)
    m.ladder('mast-ladder',(.34,0,.3),(px+.34-.06,0,plat-.1),.47,mat='edge')
    m.ladder('topmast-ladder',(-.62,0,plat+2.2),(-.72,0,top-.2),.40,mat='edge')
    for z,span,r in [(top-2,4.5,.062),(plat+3.2,6.0,.07)]:
        for side in [-1,1]:
            m.rod('signal-yard',(-.8,0,z),(-.8,side*span,z),r,r2=r*.55,vertices=10)
            m.rod('yard-lift',(-.8,side*span*.97,z),(-.9,0,z+2.0),.018,mat='edge',vertices=5)
            m.rod('yard-footrope-stirrup',(-.8,side*span*.5,z),(-.8,side*span*.5,z-.35),.012,mat='edge',vertices=5)
        m.box('yard-sling',(-.8,0,z),(.22,.5,.2),mat='edge')
    # Masthead: Type 279 paired aerials on a short spur.
    for dz in [0,.85]:
        m.rod('type-279-crossbar',(-.9,-1.7,top+dz),(-.9,1.7,top+dz),.045,mat='edge',vertices=6)
        for y in [-1.5,-.75,0,.75,1.5]:m.rod('type-279-dipole',(-1.28,y,top+dz),(-.52,y,top+dz),.025,vertices=6)
    for y in [-1.5,1.5]:m.rod('type-279-frame',(-.9,y,top),(-.9,y,top+.85),.03,mat='edge',vertices=6)
    m.cyl('masthead-truck',(-.9,0,top+1.02),.09,.06,mat='edge',vertices=10)
    # Masthead lamp bracket and crow's-nest style DF/lookout barrel on the topmast.
    m.cyl('crows-nest',(-.80,0,plat+4.6),.48,1.1,vertices=16)
    m.cyl('crows-nest-rim',(-.80,0,plat+5.17),.51,.06,mat='edge',vertices=16)
    m.cyl('crows-nest-well',(-.80,0,plat+5.19),.42,.03,mat='dark',vertices=16)
    return m.root


def create_hacs_director(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    # Fixed cylindrical tower stub; HACS Mk IV rotating director above.
    base=2.2
    loft(m,'tower',[oval(1.18,1.18,0,40),oval(1.18,1.18,base,40)],smooth=True)
    m.cyl('tower-top',(0,0,base-.03),1.18,.06,mat='roof',vertices=40)
    for z in [.06,1.35,base-.06]:m.cyl('tower-band',(0,0,z),1.22,.12,mat='edge',vertices=40)
    m.bolts(1.12,base+.01,16)
    m.ladder('tower-ladder',(-1.28,0,.1),(-1.28,0,base-.05),.45,mat='edge')
    m.rod('scuttle',(1.17,-.35,1.0),(1.20,-.35,1.0),.18,mat='edge',vertices=14)
    m.rod('scuttle-glass',(1.20,-.35,1.0),(1.215,-.35,1.0),.12,mat='dark',vertices=14)
    m.box('tower-door',(0,1.18,.98),(.62,.05,1.55),mat='edge')
    m.rod('door-handle',(.2,1.22,.9),(.2,1.22,1.1),.02,mat='dark',vertices=6)
    yaw=m.empty('yaw',(0,0,base),m.root)
    z=base
    m.cyl('roller-path',(0,0,z+.25),1.0,.5,mat='edge',vertices=32,parent=yaw)
    m.prism('cabinet',octagon(0,0,2.7,2.2,.40),z+.45,z+1.90,parent=yaw)
    m.prism('cabinet-skirt',octagon(0,0,2.8,2.3,.42),z+.45,z+.55,mat='edge',parent=yaw)
    # Curved hood: bent plate section from the rounded rear to the sloping nose.
    arch=[(-1.27,1.30),(-1.17,2.09),(-.70,2.57),(.20,2.71),(.85,2.42),(1.31,1.69),(1.31,1.30)]
    k=len(arch);vs=[(dx,side*1.04,z+zz) for side in [-1,1] for dx,zz in arch]
    m.mesh('curved-hood',vs,[tuple(range(k)),tuple(reversed(range(k,2*k)))]+[(i,(i+1)%k,k+(i+1)%k,k+i) for i in range(k)],parent=yaw)
    m.box('sight-aperture',(1.355,0,z+1.70),(.03,1.48,.40),mat='dark',parent=yaw)
    m.box('aperture-visor',(1.40,0,z+1.93),(.16,1.62,.05),mat='edge',parent=yaw)
    for side in [-1,1]:
        m.path('roof-rib',[(-1.18,side*.70,z+2.10),(-.70,side*.70,z+2.60),(.20,side*.70,z+2.74),(.85,side*.70,z+2.45)],.04,mat='edge',vertices=6,parent=yaw)
        # 15 ft height-finder/rangefinder arms with end hoods and object glasses.
        m.rod('rangefinder-tube',(-.25,side*.95,z+1.70),(-.25,side*2.0,z+1.70),.17,vertices=16,parent=yaw)
        m.rod('rangefinder-collar',(-.25,side*1.06,z+1.70),(-.25,side*1.16,z+1.70),.21,mat='edge',vertices=16,parent=yaw)
        m.box('rangefinder-hood',(-.25,side*2.05,z+1.70),(.72,.45,.65),parent=yaw)
        m.rod('object-glass',(.10,side*2.05,z+1.70),(.125,side*2.05,z+1.70),.13,mat='dark',vertices=14,parent=yaw)
        m.rod('layer-sight',(.95,side*1.12,z+1.55),(1.45,side*1.12,z+1.55),.09,mat='edge',vertices=10,parent=yaw)
        m.rod('layer-sight-lens',(1.45,side*1.12,z+1.55),(1.47,side*1.12,z+1.55),.07,mat='dark',vertices=10,parent=yaw)
        m.box('side-hatch',(-.35,side*1.105,z+1.2),(.7,.03,.9),mat='edge',parent=yaw)
    m.ladder('director-access',(-1.40,0,z+.5),(-1.40,0,z+1.95),.42,mat='edge',parent=yaw)
    # Type 285 "fishbone" yagi array carried on the hood.
    m.rod('yagi-beam',(-.05,-1.25,z+3.25),(-.05,1.25,z+3.25),.045,mat='edge',vertices=8,parent=yaw)
    for side in [-1,1]:m.rod('yagi-strut',(-.35,side*.55,z+2.62),(-.05,side*.75,z+3.25),.04,mat='edge',vertices=6,parent=yaw)
    m.rod('yagi-stay',(.55,0,z+2.64),(-.05,0,z+3.25),.03,mat='edge',vertices=6,parent=yaw)
    for i in range(6):
        y=-1.25+i*.5
        m.rod('yagi-boom',(-.35,y,z+3.25),(1.55,y,z+3.25),.028,mat='edge',vertices=6,parent=yaw)
        for j,x in enumerate([-.30,.10,.45,.80,1.15,1.50]):
            h=.30-.025*j;m.rod('yagi-element',(x,y,z+3.25-h),(x,y,z+3.25+h),.014,vertices=5,parent=yaw)
    return m.root


def create_corvette_funnel(part,col,helpers,materials):
    m=Model(col,helpers,materials)
    # Flower-class stack: round, 7.25 m tall, upright, dark-topped. The ship blueprint's
    # 2.7 m envelope is slimmed to 2.4 m so the standalone part reads tall and thin.
    h=7.25;r=1.2;n=48;wall=.07
    loft(m,'jacket',[oval(r*1.08,r*1.08,0,n),oval(r*1.08,r*1.08,.35,n),oval(r,r,.50,n),oval(r,r,h-1.45,n)],smooth=True)
    loft(m,'top-paint',[oval(r+.004,r+.004,h-1.45,n),oval(r+.004,r+.004,h,n)],mat='edge',smooth=True)
    loft(m,'mouth-lip',[oval(r+.004,r+.004,h,n),oval(r-wall,r-wall,h,n)],mat='edge')
    loft(m,'uptake-liner',[oval(r-wall,r-wall,h,n),oval(r-wall,r-wall,h-1.3,n)],inward=True,mat='dark',smooth=True)
    soot(m,oval(r-wall,r-wall,h-1.3,n))
    # Inner uptake pipe standing proud inside the casing, merchant style.
    loft(m,'inner-uptake',[oval(r*.72,r*.72,h-1.3,n),oval(r*.72,r*.72,h+.10,n)],mat='edge',smooth=True)
    loft(m,'inner-uptake-bore',[oval(r*.72-.04,r*.72-.04,h+.10,n),oval(r*.72-.04,r*.72-.04,h-1.3,n)],inward=True,mat='dark',smooth=True)
    loft(m,'inner-uptake-lip',[oval(r*.72,r*.72,h+.10,n),oval(r*.72-.04,r*.72-.04,h+.10,n)],mat='edge')
    hoop(m,'cowl-band',r+.01,r+.01,h-.04,.06,n=n,mat='edge')
    hoop(m,'cap-band',r+.01,r+.01,h-1.45,.045,n=n,mat='edge')
    for z in [2.3,4.1]:hoop(m,'stiffening-band',r+.005,r+.005,z,.03,n=n)
    hoop(m,'base-flange',r*1.08+.03,r*1.08+.03,.05,.05,n=n,mat='edge')
    m.bolts(r*1.08+.10,.03,16)
    # Waste-steam pipe up the fore side with the whistle on a bracket below the cowl.
    m.path('steam-pipe',[(r+.11,0,0),(r+.11,0,h+.30)],.055,mat='edge',vertices=10)
    m.cyl('steam-pipe-cap',(r+.11,0,h+.33),.075,.07,mat='edge',vertices=10)
    m.path('whistle-pipe',[(r+.09,.38,0),(r+.09,.38,h-2.0),(r+.30,.38,h-1.9)],.03,mat='edge',vertices=8)
    m.cyl('whistle',(r+.30,.38,h-1.68),.07,.42,mat='bronze',vertices=12)
    m.cyl('whistle-cap',(r+.30,.38,h-1.44),.085,.06,mat='bronze',vertices=12)
    m.rod('whistle-lever',(r+.30,.38,h-1.80),(r+.30,.62,h-1.86),.012,mat='edge',vertices=5)
    for side in [-1,1]:m.path('aft-steam-pipe',[(-.55,side*(math.sqrt(r*r-.55**2)+.06),0),(-.55,side*(math.sqrt(r*r-.55**2)+.06),h+.15)],.045,mat='edge',vertices=8)
    for z in [1.4,3.2,5.0,6.6]:m.rod('pipe-clip',(r-.02,0,z),(r+.11,0,z),.03,mat='edge',vertices=6)
    m.ladder('ladder',(-r-.14,0,.05),(-r-.14,0,h-.12),.42,mat='edge')
    for z in [1.0,2.8,4.6,6.4]:
        for y in [-.21,.21]:m.rod('ladder-bracket',(-r+.02,y,z),(-r-.14,y,z),.02,mat='edge',vertices=6)
    # Stay-band eyes remain where the (omitted) guys would shackle on.
    for i in range(4):
        a=math.pi/4+i*math.pi/2
        m.box('stay-eye',((r+.05)*math.cos(a),(r+.05)*math.sin(a),h-1.0),(.10,.10,.14),mat='edge')
    return m.root
