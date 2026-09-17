"""Standalone shipboard aviation deck fittings: catapults and handling cranes.

Source adaptations of the catapult and crane geometry in
assets/ships/{baltimore,cleveland,iowa}/ (US) and assets/ships/{mogami,yamato}/
(Japanese), normalized to a deck installation datum. Static fittings stowed
fore-and-aft: launch/jib direction is +X, origin under the pedestal centre.
"""
import sys, math
from pathlib import Path
import bpy
from mathutils import Vector
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'construction'))
from geometry import Model


def lerp(a,b,t): return a+(b-a)*t

def truss(m,name,a,b,w,h,n,chord=.07,web=.04,w_end=None,h_end=None,chord_mat='naval',web_mat='edge',top_ties=True,bottom_ties=True):
    """Four-chord lattice girder from a to b lying in the XZ plane. Width is
    along Y; depth is perpendicular to the axis within XZ. Optional taper."""
    a,b=Vector(a),Vector(b);d=(b-a).normalized();side=Vector((0,1,0));up=side.cross(d)*-1
    if up.z<0 or (abs(up.z)<1e-6 and up.x>0): up=-up
    w_end=w if w_end is None else w_end;h_end=h if h_end is None else h_end
    def corner(t,s,u): return a+(b-a)*t+side*s*lerp(w,w_end,t)/2+up*u*lerp(h,h_end,t)/2
    for s in [-1,1]:
        for u in [-1,1]: m.rod(name+'-chord',corner(0,s,u),corner(1,s,u),chord,mat=chord_mat,vertices=8)
    for i in range(n):
        t,v=i/n,(i+1)/n;f=1 if i%2==0 else -1
        for s in [-1,1]:
            m.rod(name+'-web',corner(t,s,-f),corner(v,s,f),web,mat=web_mat,vertices=6)
        if top_ties: m.rod(name+'-top-web',corner(t,-f,1),corner(v,f,1),web,mat=web_mat,vertices=6)
        if bottom_ties: m.rod(name+'-bottom-web',corner(t,f,-1),corner(v,-f,-1),web,mat=web_mat,vertices=6)
    for i in range(n+1):
        t=i/n
        for s in [-1,1]: m.rod(name+'-post',corner(t,s,-1),corner(t,s,1),web,mat=web_mat,vertices=6)
        for u in [-1,1]: m.rod(name+'-tie',corner(t,-1,u),corner(t,1,u),web,mat=web_mat,vertices=6)
    return corner

def plate(m,name,x0,x1,y0,y1,z0,z1,mat='naval'):
    return m.prism(name,[(x0,y0),(x1,y0),(x1,y1),(x0,y1)],z0,z1,mat=mat)

def ring(m,name,c,r,tube,segments=12,mat='edge'):
    """Ring in the XZ plane (axis along Y), e.g. a lifting hook eye."""
    pts=[(c[0]+r*math.cos(i*math.tau/segments),c[1],c[2]+r*math.sin(i*math.tau/segments)) for i in range(segments)]
    m.path(name,pts,tube,closed=True,mat=mat,vertices=6)

def sheave(m,name,c,r,width,mat='edge'):
    m.rod(name,(c[0],c[1]-width/2,c[2]),(c[0],c[1]+width/2,c[2]),r,mat=mat,vertices=16)

def catwalk(m,name,x0,x1,y_in,y_out,z,rail_h=.95,step=1.6,brackets=True):
    """Side walkway with outboard stanchions and two light rails."""
    plate(m,name+'-plank',x0,x1,min(y_in,y_out),max(y_in,y_out),z-.05,z,mat='roof')
    count=max(2,round((x1-x0)/step));yo=y_out-.04*(1 if y_out>0 else -1)
    for i in range(count+1):
        x=lerp(x0,x1,i/count)
        m.rod(name+'-stanchion',(x,yo,z),(x,yo,z+rail_h),.022,mat='edge',vertices=6)
        if brackets: m.rod(name+'-bracket',(x,y_in,z-.45),(x,yo,z-.04),.03,vertices=6)
    for h in [rail_h*.55,rail_h]:
        m.rod(name+'-rail',(x0,yo,z+h),(x1,yo,z+h),.016,mat='edge',vertices=6)


def create_us_catapult(part,col,helpers,materials):
    """US Type P powder catapult, about 20.6 m, stowed fore-and-aft."""
    m=Model(col,helpers,materials)
    x0,x1,hw=-10.3,10.3,.55;zl,zu=1.42,2.12
    # Round pedestal, roller path and turntable.
    m.cyl('pedestal',(0,0,.5),1.2,1.0,vertices=32)
    m.cyl('pedestal-flange',(0,0,.06),1.42,.12,mat='edge',vertices=32)
    for i in range(16):
        a=i*math.tau/16;m.cyl('pedestal-bolt',(1.31*math.cos(a),1.31*math.sin(a),.145),.04,.05,mat='dark',vertices=6)
    for i in range(8):
        a=(i+.5)*math.tau/8;c,s=math.cos(a),math.sin(a)
        m.mesh('pedestal-gusset',[(1.2*c-.03*s,1.2*s+.03*c,.12),(1.2*c+.03*s,1.2*s-.03*c,.12),(1.4*c+.03*s,1.4*s-.03*c,.12),(1.4*c-.03*s,1.4*s+.03*c,.12),(1.2*c-.03*s,1.2*s+.03*c,.62),(1.2*c+.03*s,1.2*s-.03*c,.62)],[(0,1,2,3),(0,1,5,4),(2,3,4,5),(0,3,4),(1,2,5)])
    m.cyl('roller-path',(0,0,1.06),1.32,.12,mat='dark',vertices=32)
    m.cyl('turntable',(0,0,1.22),1.45,.2,mat='edge',vertices=32)
    # Centre bolster carrying the girder over the turntable.
    plate(m,'bolster',-1.6,1.6,-hw-.06,hw+.06,1.3,zl+.06)
    # Lattice girder: lower chords, box-section top rails, webs and ties.
    n=22;dx=(x1-x0)/n
    for y in [-hw,hw]:
        m.rod('lower-chord',(x0,y,zl),(x1,y,zl),.075,vertices=8)
        plate(m,'top-rail',x0,x1,y-.075,y+.075,zu-.09,zu+.09,mat='edge')
        for i in range(n):
            a=x0+i*dx;up=i%2==0
            m.rod('diagonal',(a,y,zl if up else zu-.08),(a+dx,y,zu-.08 if up else zl),.045,mat='edge',vertices=6)
        for i in range(n+1):
            m.rod('vertical',(x0+i*dx,y,zl),(x0+i*dx,y,zu-.08),.036,mat='edge',vertices=6)
    for i in range(n+1):
        x=x0+i*dx
        m.rod('cross-tie',(x,-hw,zl),(x,hw,zl),.045,vertices=6)
        m.rod('top-tie',(x,-hw,zu-.12),(x,hw,zu-.12),.04,vertices=6)
        if i<n:
            f=1 if i%2==0 else -1
            m.rod('plan-brace',(x,-f*hw,zl),(x+dx,f*hw,zl),.032,mat='edge',vertices=6)
    # Central powder-gas cylinder/track trough between the rails.
    m.rod('launch-cylinder',(x0+.9,0,zu-.22),(x1-1.6,0,zu-.22),.17,vertices=12)
    plate(m,'track-deck',x0+.3,x1-.3,-.3,.3,zu-.06,zu-.02,mat='roof')
    # Firing chamber / breech at the after end.
    m.rod('powder-chamber',(x0+.2,0,zu-.22),(x0+1.4,0,zu-.22),.27,mat='edge',vertices=16)
    m.rod('breech',(x0-.02,0,zu-.22),(x0+.22,0,zu-.22),.2,mat='dark',vertices=12)
    # Launching car near the after end with aircraft float cradle.
    cx=-7.2
    plate(m,'launching-car',cx-1.15,cx+1.15,-.78,.78,zu+.12,zu+.32,mat='roof')
    for dxx in [-.8,.8]:
        for y in [-hw,hw]:
            sheave(m,'car-roller',(cx+dxx,y,zu+.17),.13,.22,mat='dark')
    for dxx in [-.55,.55]:
        m.rod('float-cradle',(cx+dxx,-1.25,zu+.72),(cx+dxx,1.25,zu+.72),.06,mat='edge',vertices=8)
        for y in [-1.1,1.1]:
            m.rod('cradle-stay',(cx+dxx,y*.55,zu+.32),(cx+dxx,y,zu+.72),.045,vertices=6)
    for y in [-.62,.62]:
        m.rod('cradle-longitudinal',(cx-.55,y,zu+.72),(cx+.55,y,zu+.72),.045,mat='edge',vertices=6)
    m.rod('car-post',(cx,0,zu+.32),(cx,0,zu+.8),.07,vertices=8)
    # Forward end buffer and sheave housing.
    plate(m,'end-buffer',x1-.55,x1,-hw-.1,hw+.1,zl-.06,zu+.3)
    for y in [-.3,.3]:
        m.rod('buffer-ram',(x1-1.5,y,zu+.16),(x1-.55,y,zu+.16),.09,mat='edge',vertices=10)
    sheave(m,'return-sheave',(x1-.9,0,zu-.2),.26,.16,mat='dark')
    plate(m,'after-end-plate',x0,x0+.12,-hw-.08,hw+.08,zl-.04,zu+.1)
    # Side walkways with light rails along the girder.
    for s in [-1,1]:
        catwalk(m,'walkway',x0+.6,x1-1.0,s*(hw+.08),s*(hw+.72),zu-.1,step=1.72)
    # Stowage rests carry the girder ends to the deck.
    for x in [-8.6,8.6]:
        for y in [-hw,hw]:
            m.rod('stowage-rest',(x,y*1.5,.03),(x,y,zl),.08,vertices=8)
            m.cyl('rest-foot',(x,y*1.5,.03),.17,.06,mat='edge',vertices=10)
        m.rod('rest-brace',(x,-hw*1.3,.55),(x,hw*1.3,.55),.04,mat='edge',vertices=6)
    # Training rack arc on the deck under the after overhang is omitted; a
    # control stand sits beside the pedestal.
    m.box('control-stand',(.2,-1.05,1.62),(.5,.3,.6),mat='edge')
    m.rod('control-lever',(.2,-1.1,1.9),(.35,-1.25,2.25),.025,mat='dark',vertices=6)
    return m.root


def create_us_crane(part,col,helpers,materials):
    """US stern aircraft/boat crane: lattice king post and 13 m lattice jib."""
    m=Model(col,helpers,materials)
    # Pedestal and rotating platform.
    m.cyl('foundation',(0,0,.65),.95,1.3,vertices=28)
    m.cyl('foundation-flange',(0,0,.05),1.18,.1,mat='edge',vertices=28)
    for i in range(12):
        a=i*math.tau/12;m.cyl('foundation-bolt',(1.07*math.cos(a),1.07*math.sin(a),.125),.04,.05,mat='dark',vertices=6)
    m.cyl('slew-ring',(0,0,1.37),1.08,.14,mat='dark',vertices=28)
    plate(m,'platform',-2.5,1.5,-1.25,1.25,1.44,1.56,mat='edge')
    # Machinery house and operator's cab at the base.
    plate(m,'machinery-house',-2.35,-.75,-1.05,1.05,1.56,3.0)
    plate(m,'machinery-roof',-2.42,-.68,-1.12,1.12,3.0,3.07,mat='roof')
    for y in [-.55,.15]:
        plate(m,'house-door',-2.37,-2.34,y,y+.5,1.62,2.75,mat='edge')
    for x in [-1.9,-1.2]:
        for s in [-1,1]:
            plate(m,'house-louvre',x-.22,x+.22,s*1.05-.015,s*1.05+.015,2.35,2.75,mat='dark')
    plate(m,'operator-cab',.0,1.15,-1.2,-.3,1.56,3.35)
    plate(m,'cab-roof',-.06,1.22,-1.26,-.24,3.35,3.41,mat='roof')
    plate(m,'cab-window-front',1.14,1.17,-1.1,-.4,2.45,3.15,mat='dark')
    plate(m,'cab-window-side',.15,1.0,-1.215,-1.185,2.45,3.15,mat='dark')
    plate(m,'cab-window-inboard',.15,1.0,-.315,-.285,2.45,3.15,mat='dark')
    # Hoist and topping winch drums between the house and the king post.
    for x,r in [(-.35,.36),(.55,.3)]:
        m.rod('winch-drum',(x,-.15 if x>0 else -.6,1.56+r+.12),(x,.95 if x>0 else .6,1.56+r+.12),r,mat='edge',vertices=16)
        for y in ([-.15,.95] if x>0 else [-.6,.6]):
            sheave(m,'drum-flange',(x,y,1.56+r+.12),r+.12,.05,mat='naval')
            plate(m,'drum-cheek',x-.12,x+.12,y-.04,y+.04,1.56,1.56+r+.12)
    # Lattice king post, slightly raked forward like Baltimore's crane tower.
    foot=(-.5,0,1.56);head=(.35,0,9.6)
    truss(m,'king-post',foot,head,1.2,1.2,7,chord=.075,web=.04,w_end=.7,h_end=.7)
    plate(m,'king-post-cap',.35-.42,.35+.42,-.42,.42,9.56,9.66,mat='edge')
    m.ladder('king-post-ladder',(-1.22,0,3.1),(-.12,0,9.5),.4,mat='edge')
    # Jib: 13 m lattice raised 40 degrees toward +X, heel pinned ahead of the post.
    ang=math.radians(40);heel=Vector((1.25,0,2.05));tip=heel+Vector((math.cos(ang),0,math.sin(ang)))*13
    for y in [-.5,.5]:
        m.mesh('heel-bracket',[(.7,y-.04,1.56),(1.5,y-.04,1.56),(1.42,y-.04,2.2),(1.08,y-.04,2.2),(.7,y+.04,1.56),(1.5,y+.04,1.56),(1.42,y+.04,2.2),(1.08,y+.04,2.2)],[(0,1,2,3),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat='edge')
    m.rod('heel-pin',(heel.x,-.62,heel.z),(heel.x,.62,heel.z),.08,mat='dark',vertices=10)
    d=(tip-heel).normalized()
    # Short converging heel section, then the long tapered jib.
    j0=heel+d*1.4
    for s in [-1,1]:
        for u in [-1,1]:
            up=Vector((-d.z,0,d.x))
            m.rod('jib-heel-leg',heel+Vector((0,s*.5,0)),j0+Vector((0,s*.5,0))+up*u*.45,.075,vertices=8)
    truss(m,'jib',j0,tip-d*.5,1.0,.9,11,chord=.07,web=.037,w_end=.42,h_end=.36)
    head_c=tip-d*.25
    for y in [-.2,.2]:
        m.mesh('jib-head-plate',[(tip.x-d.x*.7-.0,y-.02,tip.z-d.z*.7-.26),(tip.x+.12,y-.02,tip.z-.2),(tip.x+.12,y-.02,tip.z+.22),(tip.x-d.x*.7,y-.02,tip.z-d.z*.7+.3),
                                 (tip.x-d.x*.7-.0,y+.02,tip.z-d.z*.7-.26),(tip.x+.12,y+.02,tip.z-.2),(tip.x+.12,y+.02,tip.z+.22),(tip.x-d.x*.7,y+.02,tip.z-d.z*.7+.3)],
               [(0,1,2,3),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat='edge')
    sheave(m,'jib-head-sheave',(tip.x-.1,0,tip.z),.24,.3,mat='dark')
    sheave(m,'topping-sheave',(head_c.x-.15,0,head_c.z+.3),.16,.3,mat='dark')
    # King post head sheaves, topping lift, hoist wire and backstays.
    sheave(m,'post-head-sheave',(.5,0,9.9),.24,.34,mat='dark')
    for y in [-.2,.2]:
        plate(m,'post-head-cheek',.2,.8,y-.02,y+.02,9.66,10.05,mat='edge')
    for y in [-.09,.09]:
        m.rod('topping-lift',(.62,y,10.0),(head_c.x-.15,y,head_c.z+.42),.022,mat='dark',vertices=6)
    m.rod('hoist-lead',(.55,0,2.3),(.45,0,9.7),.018,mat='dark',vertices=6)
    m.rod('hoist-run',(.6,0,10.08),(tip.x-.1,0,tip.z+.24),.018,mat='dark',vertices=6)
    for s in [-1,1]:
        m.rod('backstay',(.2,s*.3,9.6),(-2.4,s*1.15,1.56),.05,mat='edge',vertices=8)
        m.rod('backstay-strut',(-1.05,s*.72,5.7),(-.1,s*.5,5.7),.035,mat='edge',vertices=6)
    hx=tip.x+.14
    m.rod('hoist-wire',(hx,0,tip.z),(hx,0,5.35),.02,mat='dark',vertices=6)
    plate(m,'hook-block',hx-.16,hx+.16,-.09,.09,4.9,5.4,mat='edge')
    sheave(m,'hook-block-sheave',(hx,0,5.18),.15,.24,mat='dark')
    m.rod('hook-shank',(hx,0,4.9),(hx,0,4.62),.04,mat='dark',vertices=8)
    ring(m,'hook',(hx,0,4.44),.18,.045)
    # Platform guard rail round the after end.
    rail=[(-.7,1.2),(-2.45,1.2),(-2.45,-1.2),(-.7,-1.2)]
    for h in [.5,1.0]:m.path('platform-rail',[(x,y,1.56+h) for x,y in rail],.018,mat='edge',vertices=6)
    for x,y in rail+[(-1.6,1.2),(-1.6,-1.2),(-2.45,0)]:m.rod('platform-stanchion',(x,y,1.56),(x,y,2.56),.022,mat='edge',vertices=6)
    return m.root


def create_ijn_catapult(part,col,helpers,materials):
    """Kure Type No.2 Model 5 catapult, 19.4 m, stowed fore-and-aft."""
    m=Model(col,helpers,materials)
    x0,x1,hw=-9.7,9.7,.65;zu=2.62;zl_mid=1.58
    # Foundation drum, roller path, turntable bed.
    m.cyl('foundation',(0,0,.6),1.2,1.2,vertices=32)
    m.cyl('foundation-skirt',(0,0,.09),1.5,.18,vertices=32,r2=1.24)
    for i in range(10):
        a=i*math.tau/10;c,s=math.cos(a),math.sin(a)
        m.rod('deck-bracket',(1.72*c,1.72*s,.045),(1.18*c,1.18*s,.95),.05,mat='edge',vertices=6)
        m.cyl('bracket-foot',(1.72*c,1.72*s,.025),.1,.05,mat='edge',vertices=8)
    m.cyl('roller-path',(0,0,1.25),1.35,.14,mat='edge',vertices=32)
    for i in range(20):
        a=i*math.tau/20;m.cyl('roller',(1.27*math.cos(a),1.27*math.sin(a),1.35),.07,.1,mat='dark',vertices=8)
    m.cyl('turntable',(0,0,1.44),1.42,.12,vertices=32)
    plate(m,'bed',-2.1,2.1,-hw-.1,hw+.1,1.5,zl_mid+.05)
    for y in [-hw-.1,hw+.1]:
        plate(m,'bed-cheek',-1.5,1.5,y-.04,y+.04,1.5,zl_mid+.5,mat='edge')
    # Deep girder: straight top longerons, lower longerons swept up at both ends.
    n=24;dx=(x1-x0)/n
    def zl(x):
        t=max(0,(abs(x)-5.6)/(9.7-5.6));return zl_mid+t*.62
    for y in [-hw,hw]:
        plate(m,'top-longeron',x0,x1,y-.08,y+.08,zu-.1,zu+.06,mat='edge')
        m.path('lower-longeron',[(x0,y,zl(x0)),(-5.6,y,zl_mid),(5.6,y,zl_mid),(x1,y,zl(x1))],.08,vertices=8)
        for i in range(n):
            a=x0+i*dx;b=a+dx;up=i%2==0
            m.rod('diagonal',(a,y,zl(a) if up else zu-.1),(b,y,zu-.1 if up else zl(b)),.05,mat='edge',vertices=6)
        for i in range(n+1):
            x=x0+i*dx;m.rod('upright',(x,y,zl(x)),(x,y,zu-.1),.042,mat='edge',vertices=6)
    for i in range(n+1):
        x=x0+i*dx
        m.rod('cross-tie',(x,-hw,zl(x)),(x,hw,zl(x)),.05,vertices=6)
        if i%2==0:m.rod('crossbeam',(x,-hw,zu-.16),(x,hw,zu-.16),.06,vertices=6)
        if i<n:
            f=1 if i%2==0 else -1
            m.rod('plan-brace',(x,-f*hw,zl(x)),(x+dx,f*hw,zl(x+dx)),.035,mat='edge',vertices=6)
    # Track deck, centre slot and hauling wire sheaves.
    for y0,y1 in [(-hw+.08,-.12),(.12,hw-.08)]:
        plate(m,'track-deck',x0+.2,x1-.2,y0,y1,zu-.04,zu,mat='roof')
    m.rod('powder-cylinder',(x0+.5,0,zu-.42),(3.5,0,zu-.42),.2,vertices=12)
    m.rod('powder-breech',(x0+.15,0,zu-.42),(x0+.95,0,zu-.42),.29,mat='edge',vertices=14)
    m.rod('piston-rod',(3.5,0,zu-.42),(x1-1.2,0,zu-.42),.07,mat='dark',vertices=8)
    for x in [x0+.35,x1-.45]:
        sheave(m,'end-sheave',(x,.0,zu-.12) if x>0 else (x,0,zu+.0),.22,.14,mat='dark')
    # End buffers.
    plate(m,'fore-buffer',x1-.4,x1,-hw-.08,hw+.08,zl(x1)-.05,zu+.28)
    for y in [-.34,.34]:m.rod('buffer-ram',(x1-1.3,y,zu+.15),(x1-.4,y,zu+.15),.085,mat='edge',vertices=10)
    plate(m,'after-end-plate',x0,x0+.1,-hw-.08,hw+.08,zl(x0)-.05,zu+.12)
    # Launching cradle (carriage with raised saddles) near the after end.
    cx=-6.6
    plate(m,'carriage',cx-.95,cx+.95,-.8,.8,zu+.08,zu+.26,mat='edge')
    for dxx in [-.65,.65]:
        for y in [-hw,hw]:ring(m,'carriage-wheel',(cx+dxx,y,zu+.17),.19,.04,segments=10,mat='dark')
    for dxx in [-.6,.6]:
        for y in [-.58,.58]:
            m.rod('carriage-saddle',(cx+dxx,y,zu+.26),(cx+dxx,y*1.45,zu+.92),.085,vertices=8)
        m.rod('saddle-bar',(cx+dxx,-.9,zu+.92),(cx+dxx,.9,zu+.92),.06,mat='edge',vertices=8)
        m.rod('saddle-tie',(cx+dxx,-.58,zu+.3),(cx+dxx,.58,zu+.3),.04,mat='edge',vertices=6)
    for y in [-.84,.84]:m.rod('saddle-rail',(cx-.6,y,zu+.92),(cx+.6,y,zu+.92),.045,mat='edge',vertices=6)
    m.rod('holdback-post',(cx-.8,0,zu+.26),(cx-.55,0,zu+.75),.06,vertices=8)
    # Side catwalks along the middle of the girder with stanchions and rails.
    for s in [-1,1]:
        catwalk(m,'catwalk',-7.6,7.6,s*(hw+.1),s*(hw+.78),zu-.12,rail_h=.9,step=1.9)
    # Traversing rail arc segments and end rollers on the deck.
    for x in [-8.4,8.4]:
        r=abs(x);pts=[(math.copysign(r*math.cos(a),x),r*math.sin(a),.05) for a in [math.radians(v) for v in (-11,-5.5,0,5.5,11)]]
        m.path('traversing-rail',pts,.05,mat='edge',vertices=6)
        for k in (0,2,4):m.cyl('rail-chair',(pts[k][0],pts[k][1],.015),.13,.03,mat='dark',vertices=8)
        for y in [-hw,hw]:
            m.rod('end-support',(x,y,zl(x)),(x,y*.7,.32),.07,vertices=8)
        m.rod('support-axle',(x,-hw*.9,.26),(x,hw*.9,.26),.05,mat='edge',vertices=6)
        for y in [-hw*.7,hw*.7]:sheave(m,'support-roller',(x,y,.26),.16,.12,mat='dark')
    return m.root


def create_ijn_crane(part,col,helpers,materials):
    """Japanese aircraft handling crane: pedestal, post and 15 m tapered lattice jib."""
    m=Model(col,helpers,materials)
    # Pedestal drum (Yamato's stern crane pedestal) with heel column.
    m.cyl('pedestal',(0,0,.9),1.5,1.8,vertices=32)
    m.cyl('pedestal-skirt',(0,0,.08),1.72,.16,mat='edge',vertices=32)
    m.cyl('pedestal-band',(0,0,1.72),1.54,.12,mat='edge',vertices=32)
    for i in range(12):
        a=i*math.tau/12;c,s=math.cos(a),math.sin(a)
        m.rod('pedestal-stiffener',(1.52*c,1.52*s,.16),(1.52*c,1.52*s,1.66),.035,mat='edge',vertices=6)
    plate(m,'pedestal-door',1.48,1.53,-.3,.3,.2,1.45,mat='dark')
    m.cyl('slew-ring',(0,0,1.87),1.2,.14,mat='dark',vertices=28)
    m.cyl('turntable',(0,0,2.0),1.4,.12,vertices=28)
    m.cyl('heel-column',(0,0,2.4),.55,.7,vertices=20)
    # Machinery house abaft the post on the turntable, with winch drum.
    plate(m,'machinery-floor',-3.0,.2,-1.0,1.0,2.0,2.1,mat='edge')
    for s in [-1,1]:m.rod('floor-bracket',(-2.9,s*.8,2.0),(-1.1,s*.8,.95),.06,vertices=8)
    plate(m,'machinery-house',-2.9,-1.3,-.95,.95,2.1,3.45)
    m.mesh('machinery-roof',[(-2.98,-1.02,3.45),(-1.22,-1.02,3.45),(-1.22,1.02,3.45),(-2.98,1.02,3.45),(-2.98,0,3.72),(-1.22,0,3.72)],[(0,1,2,3),(0,1,5,4),(3,2,5,4),(0,3,4),(1,2,5)],mat='roof')
    for y in [-.5,.5]:
        plate(m,'house-window',-1.31,-1.28,y-.2,y+.2,2.8,3.15,mat='dark')
    for s in [-1,1]:
        plate(m,'house-side-window',-2.4,-1.8,s*.95-.015,s*.95+.015,2.75,3.15,mat='dark')
    m.rod('winch-drum',(-.85,-.6,2.55),(-.85,.6,2.55),.34,mat='edge',vertices=16)
    for y in [-.6,.6]:
        sheave(m,'winch-flange',(-.85,y,2.55),.48,.05,mat='naval')
        plate(m,'winch-cheek',-1.0,-.7,y+(.03 if y>0 else -.11),y+(.11 if y>0 else -.03),2.1,2.6)
    # Support post raked slightly aft of vertical carries the topping sheaves.
    post_top=Vector((-.55,0,9.2))
    m.rod('support-post',(0,0,2.7),post_top,.24,vertices=14,r2=.15)
    for s in [-1,1]:
        m.rod('post-strut',(-2.7,s*.8,3.45),(-.5,s*.1,7.6),.07,vertices=8)
    m.rod('post-strut-tie',(-1.85,-.53,5.05),(-1.85,.53,5.05),.04,mat='edge',vertices=6)
    for y in [-.17,.17]:
        plate(m,'post-head-cheek',post_top.x-.3,post_top.x+.35,y-.02,y+.02,post_top.z-.15,post_top.z+.45,mat='edge')
    sheave(m,'post-head-sheave',(post_top.x+.05,0,post_top.z+.2),.22,.3,mat='dark')
    m.ladder('post-ladder',(-.40,0,3.75),(-.76,0,8.9),.36,mat='edge')
    # Jib: 15 m, raised 35 degrees toward +X. Deep at the heel, tapering to the head,
    # with a straight upper chord pair (Yamato/Mogami boom profile).
    ang=math.radians(35);heel=Vector((.55,0,2.75));d=Vector((math.cos(ang),0,math.sin(ang)));up=Vector((-d.z,0,d.x));tip=heel+d*15
    m.rod('heel-bearing',(heel.x,-.8,heel.z),(heel.x,.8,heel.z),.2,vertices=12)
    for s in [-1,1]:
        plate(m,'heel-cheek',.1,1.0,s*.72-.05,s*.72+.05,2.06,2.95,mat='edge')
    n=13;L=14.6
    def lo(t,s):return heel+d*(L*t)+Vector((0,s*lerp(.65,.22,t),0))
    def hi(t,s):return heel+d*(L*t)+up*lerp(1.55,.34,t)*(1 if t>0 else 0)+Vector((0,s*lerp(.65,.22,t),0))
    for s in [-1,1]:
        m.rod('jib-lower-chord',lo(0,s),lo(1,s),.11,mat='edge',vertices=8)
        m.rod('jib-upper-chord',hi(1/n,s),hi(1,s),.09,mat='edge',vertices=8)
        m.rod('jib-heel-rise',lo(0,s),hi(1/n,s),.09,mat='edge',vertices=8)
        for i in range(1,n):
            t,v=i/n,(i+1)/n
            if i%2:m.rod('jib-lattice',hi(t,s),lo(v,s),.05,mat='edge',vertices=6)
            else:m.rod('jib-lattice',lo(t,s),hi(v,s),.05,mat='edge',vertices=6)
        for i in range(1,n+1):m.rod('jib-upright',lo(i/n,s),hi(i/n,s),.04,mat='edge',vertices=6)
    for i in range(n+1):
        t=i/n
        m.rod('jib-transverse-tie',lo(t,-1),lo(t,1),.05,mat='edge',vertices=6)
        if i>0:m.rod('jib-transverse-tie',hi(t,-1),hi(t,1),.045,mat='edge',vertices=6)
        if 0<i<n:
            f=1 if i%2 else -1
            m.rod('jib-plan-brace',hi(t,-f),hi((i+1)/n,f),.035,mat='edge',vertices=6)
            m.rod('jib-plan-brace',lo(t,f),lo((i+1)/n,-f),.035,mat='edge',vertices=6)
    # Jib head: cheek plates, sheaves.
    hc=heel+d*(L+.1)+up*.17
    for y in [-.2,.2]:
        a=hc-d*.45-up*.3;b=hc+d*.4-up*.24;c=hc+d*.4+up*.24;e=hc-d*.45+up*.3
        vs=[(p.x,y+o,p.z) for o in (-.02,.02) for p in (a,b,c,e)]
        m.mesh('jib-head-plate',vs,[(0,1,2,3),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
    sheave(m,'jib-head-sheave',(hc.x+.12,0,hc.z),.23,.3,mat='dark')
    # Topping lift from the post head, hoist wire from the winch over the head sheave.
    for y in [-.1,.1]:
        m.rod('topping-lift',(post_top.x+.15,y,post_top.z+.38),(hc.x-.2,y,hc.z+.25),.024,mat='dark',vertices=6)
    lead=heel+d*1.2+up*1.45
    m.rod('hoist-lead',(-.75,.34,2.88),(lead.x,.34,lead.z),.018,mat='dark',vertices=6)
    m.rod('hoist-run',(lead.x,.34,lead.z),(hc.x+.1,.05,hc.z+.23),.018,mat='dark',vertices=6)
    sheave(m,'lead-sheave',(lead.x,.34,lead.z-.12),.13,.16,mat='dark')
    hx=hc.x+.35
    m.rod('hook-line',(hx,0,hc.z),(hx,0,6.2),.022,mat='dark',vertices=6)
    m.mesh('hook-block',[(hx-.17,-.09,5.75),(hx+.17,-.09,5.75),(hx+.1,-.09,6.25),(hx-.1,-.09,6.25),(hx-.17,.09,5.75),(hx+.17,.09,5.75),(hx+.1,.09,6.25),(hx-.1,.09,6.25)],[(0,1,2,3),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],mat='edge')
    sheave(m,'hook-block-sheave',(hx,0,6.0),.14,.24,mat='dark')
    m.rod('hook-shank',(hx,0,5.75),(hx,0,5.45),.04,mat='dark',vertices=8)
    pts=[(hx+.19*math.cos(a),0,5.27+.19*math.sin(a)) for a in [math.radians(v) for v in (90,40,-10,-60,-110,-160,-200)]]
    m.path('hook-crook',pts,.05,mat='dark',vertices=6)
    return m.root
