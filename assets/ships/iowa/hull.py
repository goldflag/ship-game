"""Hull shell and weather decks: deck-edge rails, the bow bulwark and jack staff, anchor and mooring gear,
hatches, ventilators, reels, life rafts, accommodation ladders and boat booms, aircraft handling
(catapults and stern crane), underwater appendages, and the main-deck light AA installations.

Region: the hull and the forecastle/quarterdeck outside the deckhouse. Executed in build.py's scope after house.py.
Positions are measured from the approved GameModels3D Iowa (A_Hull) in the runtime frame (x starboard, y up,
z aft) and converted once with h_pt(); every fitting stands on our own weather deck (h_deck), which is up to
1 m below the reference's at the stern.
"""
COL=collections['Deck fittings'];ASSEMBLY='hull';F=Fittings(helpers,materials,COL)

def h_pt(x,z):
    """Runtime plan point (x starboard, z aft) to authoring plan point (bow, port)."""
    return (-z,-x)

def h_deck(z):
    """Our weather-deck height at runtime z."""
    return deckz(-z)

def h_edge(z,y=None):
    """Hull half-breadth at runtime z and height y (default: the deck edge)."""
    return loft_breadth(H,-z,deckz(-z)-.02 if y is None else y)

def h_box(name,c,yaw,size,material='naval'):
    o=box(name,c,size,material);o.rotation_euler.z=yaw;return o

def h_frame(origin,yaw):
    """Map local (along, across, up) offsets to authoring points for a fitting turned `yaw` about Z."""
    ca,sa=math.cos(yaw),math.sin(yaw);ox,oy,oz=origin
    return lambda a,b,c:(ox+a*ca-b*sa,oy+a*sa+b*ca,oz+c)

def h_loft(name,rings,material='naval',cap=True,smooth=False):
    """Skin through equal-length closed point rings; caps the two end rings."""
    n=len(rings[0]);vv=[p for ring in rings for p in ring];ff=[]
    for j in range(len(rings)-1):
        for i in range(n):ff.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    if cap:ff+=[tuple(reversed(range(n))),tuple(range((len(rings)-1)*n,len(rings)*n))]
    return mesh(name,vv,ff,material,smooth=smooth)

def h_extrude(name,profile,frame,depth,material='naval'):
    """A flat (along, up) profile extruded `depth` across a local frame, centred on the frame origin."""
    return h_loft(name,[[frame(a,b,c) for a,c in profile] for b in (-depth/2,depth/2)],material)

def h_ring_face(name,outer,inner,frame,depth,material='edge'):
    """A plate with a hole: outer and inner (along, up) loops of equal length, extruded `depth`."""
    n=len(outer);vv=[];ff=[]
    for b in (-depth/2,depth/2):
        vv+=[frame(a,b,c) for a,c in outer]+[frame(a,b,c) for a,c in inner]
    O0,I0,O1,I1=0,n,2*n,3*n
    for i in range(n):
        j=(i+1)%n
        ff+=[(O0+i,O0+j,I0+j,I0+i),(O1+i,I1+i,I1+j,O1+j),(O0+i,O1+i,O1+j,O0+j),(I0+i,I0+j,I1+j,I1+i)]
    return mesh(name,vv,ff,material)

def h_chock(name,x,z,width=1.33,height=.85,depth=.55,yaw=0.):
    """Closed (Panama) fairlead; `yaw` runs its width along the deck edge so the opening faces outboard."""
    X,Y=h_pt(x,z);f=h_frame((X,Y,h_deck(z)),yaw)
    w=width/2;outer=[(-w,0),(w,0),(w,height*.62),(w*.66,height),(-w*.66,height),(-w,height*.62)]
    inner=[(-w*.55,height*.24),(w*.55,height*.24),(w*.55,height*.55),(w*.36,height*.72),(-w*.36,height*.72),(-w*.55,height*.55)]
    h_ring_face(name,outer,inner,f,depth,'naval')
    h_box(name+' base plate',f(0,0,.03),yaw,(width+.3,depth+.25,.06),'edge')

def h_bitts(name,x,z,yaw=0.,span=1.35,r=.29,height=.9,deck=None):
    """Double mooring bitts on a base plate; `yaw` turns the pair's axis from fore-and-aft."""
    X,Y=h_pt(x,z);zz=h_deck(z) if deck is None else deck;f=h_frame((X,Y,zz),yaw)
    h_box(name+' base plate',f(0,0,.05),yaw,(span+2*r+.45,2*r+.4,.10),'edge')
    for a in (-span/2,span/2):
        cyl(name+' post',f(a,0,.1+(height-.2)/2),r,height-.2,vertices=10)
        cyl(name+' cap',f(a,0,height-.06),r+.07,.12,vertices=10)

def h_hatch(name,x,z,w,d,yaw=0.,wheel=False,height=.42):
    X,Y=h_pt(x,z);zz=h_deck(z);f=h_frame((X,Y,zz),yaw)
    h_box(name+' coaming',f(0,0,height/2),yaw,(w,d,height),'naval')
    h_box(name+' cover',f(0,0,height+.035),yaw,(w+.08,d+.08,.07),'roof')
    if wheel:
        rod(name+' spindle',f(0,0,height+.07),f(0,0,height+.2),.03,'edge',vertices=6)
        cyl(name+' handwheel',f(0,0,height+.21),.2,.035,'edge',vertices=10)
    else:
        for a in (-w*.3,w*.3):rod(name+' dog',f(a,d/2+.02,height*.7),f(a,d/2+.07,height*.7),.03,'edge',vertices=5)

def h_mushroom(name,x,z,r=.5,height=.9):
    X,Y=h_pt(x,z);zz=h_deck(z)
    cyl(name+' coaming',(X,Y,zz+height*.4),r*.62,height*.8,vertices=12)
    cyl(name+' cap',(X,Y,zz+height*.88),r,height*.2,vertices=12,r2=r*.62)

def h_trunk(name,x,z,r=.8,height=1.8):
    """Tall eight-sided ventilation trunk with a banded shoulder and a flat cap."""
    X,Y=h_pt(x,z);zz=h_deck(z)
    cyl(name+' trunk',(X,Y,zz+height/2-.05),r,height-.1,vertices=8)
    cyl(name+' band',(X,Y,zz+height*.55),r+.035,.07,'edge',vertices=8)
    cyl(name+' cap',(X,Y,zz+height-.04),r+.06,.09,'roof',vertices=8)

def h_reel(name,x,z,r=.62,length=1.1,yaw=0.,deck=None):
    """Cable/hawser reel on A-frame standards, drum axis across `yaw`."""
    X,Y=h_pt(x,z);zz=h_deck(z) if deck is None else deck;f=h_frame((X,Y,zz),yaw);hub=r+.16
    for b in (-length/2,length/2):
        rod(name+' cheek',f(0,b-.03,hub),f(0,b+.03,hub),r,'naval',vertices=12)
        for a in (-r*.55,r*.55):rod(name+' standard',f(a,b+math.copysign(.09,b),.02),f(0,b+math.copysign(.09,b),hub),.045,'naval',vertices=5)
        h_box(name+' skid',f(0,b+math.copysign(.09,b),.04),yaw,(r*1.4,.1,.08),'edge')
    rod(name+' drum',f(0,-length/2,hub),f(0,length/2,hub),r*.74,'canvas',vertices=12)
    rod(name+' axle',f(0,-length/2-.14,hub),f(0,length/2+.14,hub),.05,'edge',vertices=6)

def h_raft(name,x,z,yaw=0.,length=3.05,beam=2.0):
    """Carley life raft: a rounded float ring round a slatted floor, stowed on the deck."""
    X,Y=h_pt(x,z);zz=h_deck(z);f=h_frame((X,Y,zz),yaw);t=.18
    a,b=length/2-t,beam/2-t;loop=[]
    for i in range(12):
        ang=i*math.tau/12;ca,sa=math.cos(ang),math.sin(ang)
        loop.append((a*math.copysign(abs(ca)**.7,ca),b*math.copysign(abs(sa)**.7,sa)))
    tube_path(name+' float',[f(u,v,t) for u,v in loop],t,'canvas',5,True)
    platform(name+' grating',[f(u*.86,v*.8,0)[:2] for u,v in loop],zz+.14,.04,'edge')
    h_box(name+' stores',f(-a*.3,0,.22),yaw,(.5,.35,.16),'canvas')
    rod(name+' paddle',f(-a*.6,-b*.45,.17),f(a*.55,b*.25,.17),.03,'canvas',vertices=4)

def h_locker(name,x,z,size,yaw=0.,deck=None):
    X,Y=h_pt(x,z);locker(name,X,Y,h_deck(z) if deck is None else deck,size,yaw)

def h_gusset(name,top,base,out,width=.05):
    """Triangular stiffener standing against a wall: `top` and `base` on the wall, `out` on the deck."""
    t,b,o=Vector(top),Vector(base),Vector(out);side=(o-b).cross(t-b)
    side=side.normalized()*width/2 if side.length>1e-6 else Vector((width/2,0,0))
    vv=[tuple(p+side*s) for s in (-1,1) for p in (t,b,o)]
    return mesh(name,vv,[(0,1,2),(5,4,3),(0,3,4,1),(1,4,5,2),(2,5,3,0)],'naval')

def h_strip(name,p0,p1,wdir,width,thick,material='naval'):
    """Flat bar from p0 to p1, `width` across in the plane of `wdir`, `thick` normal to that plane."""
    p0,p1=Vector(p0),Vector(p1);d=(p1-p0).normalized();w=Vector(wdir);w=(w-d*w.dot(d)).normalized()*width/2
    t=d.cross(w).normalized()*thick/2
    vv=[tuple(p+sw*w+st*t) for st in (-1,1) for p in (p0,p1) for sw in (-1,1)]
    return mesh(name,vv,[(0,1,3,2),(4,6,7,5),(0,2,6,4),(1,5,7,3),(0,4,5,1),(2,3,7,6)],material)

def h_ribbon(name,outer,inner,top,thick,material='roof'):
    """Flat strip between two equal-length plan polylines, top at `top` (ledges and walkways)."""
    n=len(outer);vv=[(x,y,z) for z in (top-thick,top) for ring in (outer,inner) for x,y in ring];ff=[]
    for i in range(n-1):
        ob,ib,ot,it=i,n+i,2*n+i,3*n+i
        ff+=[(ot,ot+1,it+1,it),(ob,ib,ib+1,ob+1),(ob,ob+1,ot+1,ot),(ib,it,it+1,ib+1)]
    ff+=[(0,2*n,3*n,n),(n-1,2*n-1,4*n-1,3*n-1)]
    return mesh(name,vv,ff,material)

def h_ring_wall(name,cx,cy,z0,r,height,seg=18,gap=None,t=.11):
    """Faceted splinter tub, outer face at radius r; `gap` (a0, a1) authoring angles stay open."""
    if gap:return shell_wall(name,circle(cx,cy,r,seg,gap[1],gap[0]+math.tau),z0,height,t)
    return shell_wall(name,circle(cx,cy,r,seg),z0,height,t,closed=True)

def h_tub_locker(cx,cy,ang_deg,rad,z,size=(1.1,.5,.78)):
    """Ready-use locker standing against a tub's inner wall, clear of the mount's crew platform."""
    a=math.radians(ang_deg);locker('Tub ready-use locker',cx+rad*math.cos(a),cy+rad*math.sin(a),z,size,a+math.pi/2)

def h_install(mount_id,build,collection='Light AA'):
    """Build one AA mount's installation under its own assembly and skip aa.py's generic tub."""
    global ASSEMBLY,COL
    saved=ASSEMBLY,COL;ASSEMBLY=mount_id;COL=collections[collection]
    build();ASSEMBLY,COL=saved;AA_INSTALLED.add(mount_id)

SIDES=(-1,1)  # runtime x sign: -1 port, +1 starboard

# ---------------------------------------------------------------------------------------------
# Deck-edge guard rails. One path runs from the bow bulwark down the starboard edge, round the
# stern and up the port edge; tubs that reach the edge and the bow bulwark interrupt it.
# ---------------------------------------------------------------------------------------------
BULWARK_X=130.2   # authoring x where the solid bow bulwark begins (reference z -130.2)
RAIL_END_X=130.0  # the deck rail stops just short of the bulwark's after end
h_edge_pts=[(s['station']-H['length']/2,s['points'][-1][0]-.12,s['points'][-1][1]) for s in H['sections'] if s['points'][-1][0]>.5]
h_path=[(x,-w,z) for x,w,z in reversed(h_edge_pts)]+[(-135.05,0,deckz(-135.05))]+[(x,w,z) for x,w,z in h_edge_pts]
h_cuts=[]
for sgn in SIDES:
    for mid,r in [('bofors-aft-deck',2.78),('bofors-stern',2.8)]:
        p=mount_point(mid+('-port' if sgn<0 else '-starboard'));h_cuts.append((p[0],p[1],r))
def h_runs(path,circles,xmax):
    runs=[];cur=[]
    for a,b in zip(path,path[1:]):
        a,b=Vector(a),Vector(b);d=b-a;ts={0.,1.}
        for cx,cy,r in circles:
            dx,dy=a.x-cx,a.y-cy;aa=d.x**2+d.y**2;bb=2*(dx*d.x+dy*d.y);cc=dx*dx+dy*dy-r*r;disc=bb*bb-4*aa*cc
            if aa>0 and disc>0:
                for t in [(-bb-math.sqrt(disc))/(2*aa),(-bb+math.sqrt(disc))/(2*aa)]:
                    if 0<t<1:ts.add(t)
        if (a.x-xmax)*(b.x-xmax)<0:ts.add((xmax-a.x)/(b.x-a.x))
        ts=sorted(ts)
        for lo,hi in zip(ts,ts[1:]):
            m_=a.lerp(b,(lo+hi)/2)
            if m_.x>xmax or any((m_.x-cx)**2+(m_.y-cy)**2<r*r for cx,cy,r in circles):
                if len(cur)>1:runs.append(cur)
                cur=[]
            else:
                if not cur:cur=[a.lerp(b,lo)]
                cur.append(a.lerp(b,hi))
    if len(cur)>1:runs.append(cur)
    return runs
for run in h_runs(h_path,h_cuts,RAIL_END_X):
    lengths=[0.]
    for a,b in zip(run,run[1:]):lengths.append(lengths[-1]+(b-a).length)
    count=max(1,math.ceil(lengths[-1]/2.8))
    for i in range(count+1):
        s_=lengths[-1]*i/count;k=max(0,min(len(run)-2,next((j for j in range(len(run)-1) if lengths[j+1]>=s_),len(run)-2)))
        seg=max(1e-6,lengths[k+1]-lengths[k]);p=run[k].lerp(run[k+1],(s_-lengths[k])/seg)
        rod('Deck rail stanchion',p,p+Vector((0,0,1.0)),.028,'naval',vertices=5)
        if i%4==2 and 0<i<count:
            inward=Vector((0,-math.copysign(1,p.y) if abs(p.y)>.5 else 0,0))
            if abs(p.y)<=.5:inward=Vector((1,0,0))
            rod('Deck rail stay',p+Vector((0,0,.55)),p+inward*.5+Vector((0,0,.02)),.02,'naval',vertices=4)
    for dz,r in [(.36,.013),(.68,.013),(1.0,.019)]:
        tube_path('Deck guard rail',[tuple(p+Vector((0,0,dz))) for p in run],r,'edge',4)

# ---------------------------------------------------------------------------------------------
# Forecastle: solid bow bulwark and jack staff, hawse pipes and anchors, cable, stoppers,
# wildcats, capstans, brake stands, bitts, fairleads, hatches, ventilators, lockers, reels.
# ---------------------------------------------------------------------------------------------
xs=[130.2,131.0,132.0,133.0,133.8,134.4,134.85]
# The bulwark overhangs the flare on a ledge, forming the rounded cap round the stem.
h_over=lambda x:.22*min(1.,(x-BULWARK_X)/.8)
h_bw=[(x,-(loft_breadth(H,x,deckz(x)-.02)+h_over(x)-.03)) for x in xs]+[(135.38,0.)]+[(x,loft_breadth(H,x,deckz(x)-.02)+h_over(x)-.03) for x in reversed(xs)]
h_in=[(x,-(loft_breadth(H,x,deckz(x)-.02)-.06)) for x in xs]+[(135.1,0.)]+[(x,loft_breadth(H,x,deckz(x)-.02)-.06) for x in reversed(xs)]
shell_wall('Bow bulwark',h_bw,9.62,11.32-9.62,.10,material='hullgray',coping=.04)
h_ribbon('Bow bulwark ledge',h_bw,h_in,9.66,.12,'hullgray')
f=h_frame((134.86,0,9.02),math.pi/2)
h_ring_face('Bullnose',[(.4*math.cos(i*math.tau/10),.56*math.sin(i*math.tau/10)) for i in range(10)],
            [(.2*math.cos(i*math.tau/10),.36*math.sin(i*math.tau/10)) for i in range(10)],f,.3,'hullgray')
rod('Jack staff',(134.75,0,11.3),(134.75,0,16.4),.07,'naval',r2=.035,vertices=8)
rod('Jack staff heel',(134.75,0,deckz(134.75)),(134.75,0,11.32),.09,'naval',vertices=8)
rod('Jack staff brace',(134.75,0,12.3),(133.7,0,deckz(133.7)),.035,'naval',vertices=5)
for sgn in SIDES:h_locker('Bow stores locker',sgn*1.9,-131.05,(.78,1.49,.95))

# Hawse pipes: deck bolsters and the hull-side anchor pockets with stockless anchors.
for sgn in SIDES:
    X,Y=h_pt(sgn*1.2,-129.25);zz=h_deck(-129.25)
    cyl('Hawse pipe bolster',(X,Y,zz+.1),.62,.2,'edge',vertices=12,r2=.5)
    cyl('Hawse pipe mouth',(X,Y,zz+.205),.36,.02,'dark',vertices=12)
    # Anchor pocket: a round bolster standing proud of the flared bow, facing outboard and forward.
    z0=-131.6;y0=8.5;w0=loft_breadth(H,-z0,y0)
    n=Vector((sgn*1.,-.25,-.5)).normalized()                            # runtime outward axis
    c=Vector((sgn*w0,y0,z0))
    up=(Vector((0,1,0))-n*n.y).normalized();fw=n.cross(up)
    def rt(p):return (-p.z,-p.x,p.y)
    def loop(o,r,k=14):return [rt(o+(up*math.cos(i*math.tau/k)+fw*math.sin(i*math.tau/k))*r) for i in range(k)]
    h_loft('Anchor pocket bolster',[loop(c-n*.9,.95),loop(c+n*.24,.95),loop(c+n*.3,.74)],'hullgray')
    h_loft('Anchor pocket recess',[loop(c+n*.2,.68),loop(c+n*.31,.68)],'dark')
    tube_path('Anchor pocket lip',loop(c+n*.3,.86),.1,'hullgray',5,True)
    # Stockless anchor housed in the pocket: shank into the pipe, crown below, flukes against the hull.
    head=c+n*.55-up*.62;top=c+n*.1+up*.25
    rod('Anchor shank',rt(head),rt(top),.16,'edge',vertices=6)
    rod('Anchor crown',rt(head-fw*.6),rt(head+fw*.6),.2,'edge',vertices=6)
    for s_ in (-1,1):
        tri=[head+fw*s_*.3-up*.06,head+fw*s_*.88-up*.06,head+fw*s_*.72+up*1.05+n*.02]
        vv=[rt(q+n*d) for d in (-.07,.07) for q in tri]
        mesh('Anchor fluke',vv,[(0,1,2),(5,4,3),(0,3,4,1),(1,4,5,2),(2,5,3,0)],'edge')

# Cable: studded links from each hawse pipe aft to its wildcat, flat and on edge alternately.
for sgn in SIDES:
    a=Vector((*h_pt(sgn*1.2,-128.7),h_deck(-128.7)+.1));b=Vector((*h_pt(sgn*1.2,-101.7),h_deck(-101.7)+.1))
    n_=max(2,int((a-b).length/.45));yaw=math.atan2((b-a).y,(b-a).x);hexa=[(-.35,0),(-.21,.22),(.21,.22),(.35,0),(.21,-.22),(-.21,-.22)]
    for i in range(n_):
        p=a.lerp(b,(i+.5)/n_);f=h_frame((p.x,p.y,p.z-.1),yaw)
        if i%2:h_loft('Cable link',[[f(u,v,c_) for u,v in hexa] for c_ in (.02,.11)],'edge')
        else:h_extrude('Cable link',[(u*.9,.13+v*.45) for u,v in hexa],f,.08,'edge')
    for zc in (-125.1,-119.2,-112.4):
        X,Y=h_pt(sgn*1.2,zc);zz=h_deck(zc)
        h_box('Chain stopper pad',(X,Y+sgn*.55,zz+.06),0,(.5,.3,.12),'edge')
        rod('Chain stopper bar',(X-.35,Y+sgn*.55,zz+.12),(X+.25,Y-sgn*.1,zz+.22),.05,'naval',vertices=5)
        rod('Chain stopper hook',(X+.25,Y-sgn*.1,zz+.22),(X+.45,Y-sgn*.25,zz+.12),.04,'edge',vertices=5)

# Wildcats on a stepped bed with chain-pipe hoods, capstans, brake stands.
for sgn in SIDES:
    X,Y=h_pt(sgn*1.2,-100.5);zz=h_deck(-100.5)
    h_box('Wildcat bed',(X+.3,Y,zz+.06),0,(3.4,2.5,.12),'edge')
    h_box('Wildcat bed step',(X,Y,zz+.17),0,(2.5,2.2,.12),'naval')
    cyl('Wildcat drum',(X,Y,zz+.52),.95,.62,vertices=12)
    cyl('Wildcat whelps',(X,Y,zz+.45),1.02,.16,'edge',vertices=12)
    cyl('Wildcat cap',(X,Y,zz+.88),1.18,.1,'naval',vertices=12)
    f=h_frame((X+1.75,Y-sgn*.35,zz+.12),0)
    h_extrude('Chain pipe hood',[(-.75,0),(.65,0),(.35,.72),(-.55,.72)],f,.62,'naval')
    X,Y=h_pt(sgn*3.31,-100.49);zz=h_deck(-100.49)
    h_box('Capstan base',(X,Y,zz+.05),0,(1.9,1.9,.1),'edge')
    cyl('Capstan foot',(X,Y,zz+.2),.82,.2,vertices=12,r2=.66)
    cyl('Capstan barrel',(X,Y,zz+.62),.62,.64,vertices=12,r2=.66)
    cyl('Capstan head',(X,Y,zz+1.02),.74,.16,vertices=12)
    cyl('Capstan crown',(X,Y,zz+1.16),.7,.12,vertices=12,r2=.25)
    for x_,z_ in [(sgn*1.72,-97.56),(sgn*.54,-96.7)]:
        X,Y=h_pt(x_,z_);zz=h_deck(z_)
        for k in range(3):
            ang=k*math.tau/3;rod('Brake stand foot',(X+.3*math.cos(ang),Y+.3*math.sin(ang),zz),(X,Y,zz+.35),.03,'naval',vertices=4)
        rod('Brake stand column',(X,Y,zz+.3),(X,Y,zz+1.09),.055,'naval',vertices=6)
        F.ring('Brake handwheel',(X,Y,zz+1.07),.28,.025,segments=10)
        for ang in (0,math.pi/2):rod('Brake handwheel spoke',(X-.28*math.cos(ang),Y-.28*math.sin(ang),zz+1.07),(X+.28*math.cos(ang),Y+.28*math.sin(ang),zz+1.07),.018,'edge',vertices=4)

# Mooring: bitts and closed fairleads at the reference stations (runtime x, z), both sides.
for x_,z_,yaw in [(2.93,-125.19,0),(4.97,-102.82,0),(9.75,-67.5,.12),(15.05,-16.57,0),(15.68,35.4,0),(15.17,70.31,-.05),(13.8,94.14,-.08),(1.39,126.74,0)]:
    for sgn in SIDES:h_bitts('Mooring bitts',sgn*x_,z_,-sgn*yaw)
for z_,w_ in [(-120.19,1.64),(-108.39,1.33),(-98.67,1.33),(-72.6,1.33),(-63.25,1.33),(-32.1,1.33),(-22.2,1.33),(-10.65,1.33),
              (11.5,1.33),(29.1,1.33),(41.1,1.33),(64.9,1.33),(75.95,1.33),(88.56,1.33),(99.87,1.33),(124.86,1.33)]:
    e1,e2=h_edge(z_-.5),h_edge(z_+.5)
    for sgn in SIDES:
        yaw=math.atan2(sgn*(e2-e1),1.)  # along the deck edge toward the bow (authoring +X is -z)
        h_chock('Closed chock',sgn*(h_edge(z_)-.42),z_,w_,yaw=yaw)
for sgn in SIDES:h_chock('Stern chock',sgn*1.4,134.55,1.33,yaw=math.pi/2)

# Hatches (runtime x, z, width across, length fore-and-aft, handwheel).
for x_,z_,w,d,wh in [(3.64,-81.35,1.2,1.45,0),(-3.64,-81.35,1.2,1.45,0),(.78,-95.35,1.02,1.25,0),(1.91,-114.93,.88,1.09,0),
                     (-2.12,-122.24,.88,1.09,0),(-.72,-91.11,1.03,1.53,1),(1.86,-104.96,1.35,.92,1),
                     (1.22,76.52,1.18,1.42,0),(.87,86.68,1.53,1.28,0),(-2.96,87.1,1.18,1.41,0),(-1.09,99.8,1.34,1.13,0),
                     (-3.73,121.0,1.48,1.24,0),(-2.35,124.12,1.59,1.9,0),(-.23,126.01,1.0,1.23,0),(.72,97.6,1.01,1.51,1),
                     (-2.7,105.08,1.01,1.51,1),(6.99,110.2,1.07,.89,0),(-3.7,120.0,.86,.91,0)]:
    h_hatch('Deck hatch',x_,z_,d,w,0.,bool(wh))
h_hatch('Aircraft stores hatch',1.52,101.7,4.2,1.5,0.,False,.3)

# Ventilators: mushroom heads, tall trunks, low vent heads (runtime x, z, radius, height).
for x_,z_,r,hgt in [(1.97,-91.49,.31,.86),(2.37,-89.3,.58,.85),(-4.0,-73.07,.74,1.04),(5.03,-73.0,.74,1.04),
                    (-8.17,79.31,.28,.78),(.79,95.72,.82,1.2),(-10.14,69.53,.38,.39),(-5.51,71.13,.33,.51),(8.28,56.2,.67,.98),(-8.05,56.2,.67,.98),(-10.55,61.14,.85,1.26),(10.57,61.14,.85,1.26)]:
    h_mushroom('Mushroom ventilator',x_,z_,r,hgt)
for x_,z_,r,hgt in [(-.6,-92.76,.66,1.51),(-6.11,77.09,.86,1.95),(4.09,78.5,1.0,1.97),(-3.73,100.53,1.0,1.81),(2.59,124.77,.81,1.84),
                    (-4.64,124.9,.5,1.38),(5.5,126.1,.5,1.38),(5.45,127.75,.52,1.54),(-5.35,127.75,.44,1.21)]:
    h_trunk('Ventilation trunk',x_,z_,r,hgt)

# Reels, fire-hose racks, ready-use lockers, paravanes and boat winches.
for x_,z_,r,ln in [(-2.26,-73.05,.55,1.1),(2.84,-73.15,.55,1.1),(3.86,-72.4,.55,1.1),(-5.33,-71.99,.55,1.1),(5.72,76.31,.8,1.4),(-3.73,77.91,.8,1.4)]:
    h_reel('Hawser reel',x_,z_,r,ln,0.)
# Cable jacks: low trestles across the forecastle ahead of turret 1.
for z_ in (-73.83,-73.41):
    X,Y=h_pt(0,z_);zz=h_deck(z_)
    h_box('Cable jack beam',(X,Y,zz+.4),0,(.3,4.4,.16),'naval')
    for yy in (-1.9,0,1.9):rod('Cable jack leg',(X,Y+yy,zz),(X,Y+yy,zz+.33),.07,'naval',vertices=6)
for x_,z_ in [(0,-74.8),(2.18,-74.8),(-2.18,-74.8)]:
    X,Y=h_pt(x_,z_);hose_reel('Fire hose rack',X,Y,h_deck(z_),math.pi/2)
for sgn in SIDES:
    h_locker('Ready-use locker',sgn*3.76,-89.93,(1.39,1.76,1.19),sgn*.45)
    for z_ in (-82.75,-81.06):h_locker('Ready-use locker',sgn*2.3,z_,(1.69,.93,.8))
    h_locker('Director stores cabinet',sgn*4.05,-83.95,(.4,.35,.9))
    # Paravane on its deck chocks.
    X,Y=h_pt(sgn*5.24,-82.34);zz=h_deck(-82.34)+.45
    rod('Paravane body',(X-1.1,Y,zz),(X+.9,Y,zz),.22,'naval',vertices=8)
    rod('Paravane nose',(X+.9,Y,zz),(X+1.5,Y,zz),.22,'naval',r2=.05,vertices=8)
    rod('Paravane tail',(X-1.1,Y,zz),(X-1.55,Y,zz),.22,'naval',r2=.1,vertices=8)
    for ang in (0,math.pi/2):h_box('Paravane fin',(X-1.3,Y,zz),0,(.5,.85 if ang==0 else .04,.04 if ang==0 else .85),'naval')
    for dx in (-.6,.5):h_box('Paravane chock',(X+dx,Y,zz-.3),0,(.18,.6,.3),'edge')
    # Boat winches abreast turret 3.
    X,Y=h_pt(sgn*10.64,72.13);zz=h_deck(72.13)
    h_box('Boat winch bed',(X,Y,zz+.06),0,(3.0,1.9,.12),'edge')
    h_box('Boat winch motor',(X+.8,Y,zz+.45),0,(1.1,.9,.7),'naval')
    rod('Boat winch barrel',(X-.2,Y-.75,zz+.55),(X-.2,Y+.75,zz+.55),.32,'naval',vertices=10)
    for s_ in (-1,1):rod('Boat winch warping head',(X-.2,Y+s_*.75,zz+.55),(X-.2,Y+s_*1.05,zz+.55),.28,'naval',vertices=10,r2=.2)
h_locker('Ready-use locker',.86,87.82,(.62,1.38,.8))
# Boat winches at the main-deck edge abreast the funnels (the boats and davits are HOUSE's).
for sgn,z_ in [(1,7.03),(-1,7.34)]:
    X,Y=h_pt(sgn*15.1,z_);zz=h_deck(z_)
    h_box('Boat winch base',(X,Y,zz+.25),0,(1.05,.95,.5),'naval')
    rod('Boat winch motor',(X-.5,Y,zz+.62),(X+.45,Y,zz+.62),.28,'naval',vertices=10)
    cyl('Boat winch gypsy',(X,Y,zz+1.12),.3,.62,'naval',vertices=10,r2=.36)
    cyl('Boat winch gypsy cap',(X,Y,zz+1.46),.4,.08,'edge',vertices=10)
X,Y=h_pt(-.65,93.15);zz=h_deck(93.15)
cyl('Capstan foot',(X,Y,zz+.15),.72,.3,vertices=12,r2=.6);cyl('Capstan barrel',(X,Y,zz+.62),.56,.64,vertices=12,r2=.6)
cyl('Capstan head',(X,Y,zz+1.02),.68,.16,vertices=12);cyl('Capstan crown',(X,Y,zz+1.14),.64,.1,vertices=12,r2=.22)

# Life rafts stowed on the quarterdeck beside the catapults.
for x_,z_ in [(11.3,104.12),(10.9,106.35),(10.4,108.54),(10.0,110.78),(8.0,118.95),(7.42,121.2)]:
    for sgn in SIDES:h_raft('Carley raft',sgn*x_,z_,math.pi/2-sgn*.15)

# Stern: navigation and signal lights on a short post, crane control stand.
X,Y=h_pt(0,134.7);zz=h_deck(134.7)
rod('Signal lamp post',(X,Y,zz),(X,Y,zz+2.4),.05,'naval',vertices=6)
cyl('Signal lamp',(X,Y,zz+2.5),.1,.2,'edge',vertices=8)
for dz in (1.35,1.62):h_box('Stern running light',(X+.08,Y,zz+dz),0,(.14,.5,.18),'edge')
X,Y=h_pt(2.24,133.8);zz=h_deck(133.8)
rod('Crane control column',(X,Y,zz),(X,Y,zz+.8),.08,'naval',vertices=6)
F.ring('Crane control wheel',(X,Y,zz+.88),.25,.025,'y',segments=10)

# ---------------------------------------------------------------------------------------------
# Hull shell: stowed accommodation ladders and boat booms, both sides.
# ---------------------------------------------------------------------------------------------
for sgn in SIDES:
    for z0,z1 in [(-15.0,-5.9),(51.3,60.4)]:
        w=max(h_edge(z0,5.9),h_edge(z1,5.9))+.42
        a=Vector((*h_pt(sgn*w,z0),0));b=Vector((*h_pt(sgn*w,z1),0))
        for yy in (5.0,6.95):tube_path('Accommodation ladder stringer',[tuple(a+Vector((0,0,yy))),tuple(b+Vector((0,0,yy)))],.07,'naval',4)
        n_=int((a-b).length/.55)
        for i in range(1,n_):
            p=a.lerp(b,i/n_);rod('Accommodation ladder tread',tuple(p+Vector((0,0,5.0))),tuple(p+Vector((0,0,6.95))),.03,'naval',vertices=4)
        for t in (.1,.9):
            p=a.lerp(b,t);inn=Vector((*h_pt(sgn*(w-.46),0),0));inn.x=p.x
            rod('Ladder stowage bracket',tuple(p+Vector((0,0,5.0))),tuple(inn+Vector((0,0,5.0))),.05,'edge',vertices=5)
        # Davit at the ladder's forward end.
        p=a;dav=Vector((*h_pt(sgn*(w-.5),0),0));dav.x=p.x
        rod('Ladder davit',tuple(dav+Vector((0,0,h_deck(-p.x)))),tuple(dav+Vector((0,0,h_deck(-p.x)+1.6))),.05,'naval',vertices=6)
        rod('Ladder davit arm',tuple(dav+Vector((0,0,h_deck(-p.x)+1.6))),tuple(p+Vector((0,0,7.0))),.035,'naval',vertices=5)
    for z0,z1,yy in [(-76.1,-60.4,5.62),(103.8,119.2,5.55)]:
        e0,e1=h_edge(z0,yy)+.28,h_edge(z1,yy)+.28
        a=(*h_pt(sgn*e0,z0),yy);b=(*h_pt(sgn*e1,z1),yy)
        rod('Boat boom',a,b,.12,'naval',vertices=8)
        for t in (.08,.37,.66,.94):
            p=Vector(a).lerp(Vector(b),t);zc=-p.x;hull_w=h_edge(zc,yy)
            rod('Boat boom bracket',tuple(p),(p.x,-sgn*(hull_w-.05),yy),.06,'edge',vertices=5)

# ---------------------------------------------------------------------------------------------
# Main-deck light AA installations (each builds under its mount's assembly, then is marked installed).
# ---------------------------------------------------------------------------------------------
def h_bow_bofors(sgn):
    mid='bofors-bow-'+('port' if sgn<0 else 'starboard');cx,cy,gz=mount_point(mid)
    z0=h_deck(-83.9)-.06
    gap=(math.radians(92),math.radians(114)) if sgn>0 else (math.radians(-114),math.radians(-92))
    h_ring_wall('Bofors tub splinter plating',cx,cy,z0,2.75,8.15-z0,20,gap,.15)
    # Director tower on the tub's inboard quarter.
    dx,dy=84.62,-sgn*2.52;base=h_deck(-84.62)-.05
    cyl('Mk.51 director tower',(dx,dy,(base+8.4)/2),.74,8.4-base,vertices=10)
    platform('Mk.51 director platform',circle(dx,dy,.98,14),8.52,.12,'roof')
    lgap=(math.pi/2-.45,math.pi/2+.45) if sgn>0 else (-math.pi/2-.45,-math.pi/2+.45)
    h_ring_wall('Mk.51 director tub',dx,dy,8.4,.98,.62,14,lgap,.07)
    Fittings(helpers,materials,COL).ladder('Mk.51 tower ladder',(dx,dy+sgn*.8,base+.05),(dx,dy+sgn*.8,9.05),.42,normal='y')
    for zz in (base+.5,8.2):rod('Ladder standoff',(dx,dy+sgn*.8,zz),(dx,dy+sgn*.7,zz),.02,'edge',vertices=4)
    h_tub_locker(cx,cy,sgn*-40,2.28,z0+.06)
for sgn in SIDES:h_install('bofors-bow-'+('port' if sgn<0 else 'starboard'),lambda sgn=sgn:h_bow_bofors(sgn))

COL=collections['Masts and directors'];ASSEMBLY='hull'
for sgn in SIDES:mk51('Mk.51 director AD_'+('1' if sgn<0 else '2'),84.62,-sgn*2.52,8.52,0)
for sgn in SIDES:mk51('Mk.51 director AD_'+('35' if sgn<0 else '36'),-126.94,-sgn*3.78,6.66,math.pi)
COL=collections['Deck fittings'];ASSEMBLY='hull'

# Forward 20 mm group abreast turret 2: one shield along the forecastle edge (outer face, starboard).
H_FORE_SHIELD=[(12.76,-33.36),(13.4,-33.4),(14.54,-34.36),(14.46,-35.94),(10.3,-44.0),(9.8,-44.24),(9.3,-44.28),(7.26,-43.24)]
def h_fore_oerlikons(sgn):
    pts=[h_pt(sgn*x,z) for x,z in H_FORE_SHIELD]
    if sgn<0:pts=list(reversed(pts))
    z0=h_deck(-38.9)-.04;top=h_deck(-38.9)+1.2
    shell_wall('20 mm gallery splinter shield',pts,z0,top-z0,.08)
    # Outboard stiffeners and N-braces on the long face.
    a,b=Vector((*h_pt(sgn*14.46,-35.94),0)),Vector((*h_pt(sgn*10.3,-44.0),0))
    out=Vector((-(b-a).y,(b-a).x,0)).normalized()*(-sgn)
    for i in range(7):
        p=a.lerp(b,(i+.5)/7)+out*.05
        h_box('Shield stiffener',(p.x,p.y,z0+(top-z0)/2),math.atan2((b-a).y,(b-a).x),(.07,.1,top-z0),'naval')
        if i in (2,4):
            q=a.lerp(b,(i+1.5)/7)+out*.07
            rod('Shield diagonal brace',(p.x,p.y,top-.12),(q.x,q.y,z0+.12),.04,'naval',vertices=4)
    yaw=math.atan2((b-a).y,(b-a).x)
    for x_,z_ in [(11.17,-41.3),(9.38,-40.1),(13.1,-37.7),(11.43,-36.6)]:
        X,Y=h_pt(sgn*x_,z_);locker('20 mm ready-use locker',X,Y,h_deck(z_),(1.2,.62,.8),yaw)
    inward=-out
    for t in (.82,.42):
        q=a.lerp(b,t)+inward*.3;zz=h_deck(-q.x)
        for k in (-1,1):
            r_=q+(b-a).normalized()*k*.15;rod('Spare barrel canister',(r_.x,r_.y,zz),(r_.x,r_.y,zz+1.12),.1,'naval',vertices=6)
        rod('Canister strap',tuple(q-(b-a).normalized()*.3+Vector((0,0,zz+.8))),tuple(q+(b-a).normalized()*.3+Vector((0,0,zz+.8))),.03,'edge',vertices=4)
for sgn in SIDES:
    ids=['oerlikon-fore-%d-%s'%(i,'port' if sgn<0 else 'starboard') for i in (1,2,3)]
    h_install(ids[0],lambda sgn=sgn:h_fore_oerlikons(sgn));AA_INSTALLED.update(ids)

def h_aft_deck_bofors(sgn):
    mid='bofors-aft-deck-'+('port' if sgn<0 else 'starboard');cx,cy,gz=mount_point(mid)
    gap=(math.radians(79),math.radians(98)) if sgn>0 else (math.radians(-98),math.radians(-79))
    z0=h_deck(49.0)-.06
    h_ring_wall('Bofors tub splinter plating',cx,cy,z0,2.72,7.1-z0,20,gap,.15)
    h_tub_locker(cx,cy,sgn*35,2.25,z0+.06)
for sgn in SIDES:h_install('bofors-aft-deck-'+('port' if sgn<0 else 'starboard'),lambda sgn=sgn:h_aft_deck_bofors(sgn))

# After 20 mm pair in a three-sided shield open to the deckhouse, with outboard gussets.
H_AFT_SHIELD=[(11.08,68.75),(13.5,68.7),(14.18,68.1),(14.2,63.0),(13.2,62.3),(11.25,62.9)]
def h_aft_oerlikons(sgn):
    pts=[h_pt(sgn*x,z) for x,z in H_AFT_SHIELD]
    if sgn<0:pts=list(reversed(pts))
    z0=h_deck(65.5)-.04;top=h_deck(65.5)+1.12
    shell_wall('20 mm splinter shield',pts,z0,top-z0,.08)
    for z_ in (63.4,64.6,65.8,67.0,68.1):
        X,Y=h_pt(sgn*14.24,z_);X2,Y2=h_pt(sgn*14.62,z_)
        h_gusset('Shield gusset',(X,Y,top-.1),(X,Y,z0+.04),(X2,Y2,z0+.04))
    for z_ in (64.26,65.96,67.67):h_locker('20 mm ready-use locker',sgn*11.2,z_,(1.38,.63,.8))
    for x_,z_ in [(13.95,64.6),(13.95,66.5)]:
        X,Y=h_pt(sgn*x_,z_);zz=h_deck(z_)
        rod('Spare barrel tube',(X-.75,Y,zz+.3),(X+.75,Y,zz+.3),.1,'naval',vertices=6)
        for k in (-.5,.5):h_box('Barrel tube cradle',(X+k,Y,zz+.12),0,(.1,.3,.24),'edge')
for sgn in SIDES:
    ids=['oerlikon-aft-%d-%s'%(i,'port' if sgn<0 else 'starboard') for i in (1,2)]
    h_install(ids[0],lambda sgn=sgn:h_aft_oerlikons(sgn));AA_INSTALLED.update(ids)

def h_stern_bofors(sgn):
    mid='bofors-stern-'+('port' if sgn<0 else 'starboard');cx,cy,gz=mount_point(mid);r=2.75
    h_ring_wall('Bofors sponson tub',cx,cy,4.85,r,7.0-4.85,22,None,.15)
    cyl('Bofors sponson cone',(cx,cy,(2.7+4.86)/2),.12,4.86-2.7,'hullgray',vertices=22,r2=r)
    # Tub floor over the part that overhangs the hull (inboard, the weather deck is the floor).
    arc=[];ri=r-.1
    for i in range(72):
        ang=i*math.tau/72;px,py=cx+ri*math.cos(ang),cy+ri*math.sin(ang)
        arc.append((ang,px,py,abs(py)>loft_breadth(H,px,deckz(px)-.02)-.01))
    k=next(i for i in range(72) if arc[i][3] and not arc[i-1][3])
    out=[]
    for j in range(72):
        e=arc[(k+j)%72]
        if not e[3]:break
        out.append((e[1],e[2]))
    x0,x1=out[-1][0],out[0][0];edge=[]
    for t in [i/8 for i in range(9)]:
        x=x0+(x1-x0)*t;edge.append((x,math.copysign(loft_breadth(H,x,deckz(x)-.02)-.02,cy)))
    platform('Bofors sponson floor',out+edge,gz,.1,'roof')
    # Director tub on its pedestal just forward and inboard.
    dx,dy=-126.94,-sgn*3.78;base=h_deck(126.94)-.05
    cyl('Mk.51 director pedestal',(dx,dy,(base+6.55)/2),1.08,6.55-base,vertices=16)
    platform('Mk.51 director deck',circle(dx,dy,1.13,16),6.66,.11,'roof')
    h_ring_wall('Mk.51 director tub',dx,dy,6.6,1.15,1.1,16,None,.08)
    Fittings(helpers,materials,COL).ladder('Director tub ladder',(dx+1.22,dy,base+.05),(dx+1.22,dy,7.7),.42,normal='x')
for sgn in SIDES:h_install('bofors-stern-'+('port' if sgn<0 else 'starboard'),lambda sgn=sgn:h_stern_bofors(sgn))

def h_turret3_bofors():
    """Raised D-shaped tub on turret 3's rear roof; it trains with the turret (parented to main-3.yaw)."""
    before=set(scene.objects);gz=mount('bofors-turret-3')['position'][1]
    parent_mount=mount('main-3');roof=parent_mount['position'][1]+parent_mount['weapon']['gunhouseSize'][2]
    cX=-60.1;r=3.2;xf=-57.15
    D_=[(cX+r*math.cos(a),r*math.sin(a)) for a in [math.pi/2+i*math.pi/12 for i in range(13)]]+[(cX+.4,-3.25),(xf,-3.25),(xf,3.25),(cX+.4,3.25)]
    pedestal=[(xf,-3.25),(xf,3.25),(-60.25,3.25),(-60.25,-3.25)]
    prism('Bofors tub pedestal',pedestal,roof-.1,gz-.1-(roof-.1),'naval')
    platform('Bofors tub floor',D_,gz,.12,'roof')
    shell_wall('Bofors tub splinter plating',D_,gz-.12,1.32,.1,closed=True)
    for yy in (-2.2,0,2.2):knee('Tub floor bracket',(-62.2,yy,gz-.12),(-60.25,yy,gz-.12),gz-.12-roof,col=None)
    Fittings(helpers,materials,COL).ladder('Tub ladder',(xf+.08,1.6,roof),(xf+.08,1.6,gz+1.2),.42,normal='x')
    parent=next(o for o in scene.objects if o.get('nodeId')=='main-3.yaw')
    bpy.context.view_layer.update()
    for obj in set(scene.objects)-before:
        if obj.parent is None:
            world=obj.matrix_world.copy();obj.parent=parent;obj.matrix_parent_inverse=Matrix.Identity(4);obj.matrix_world=world
h_install('bofors-turret-3',h_turret3_bofors)

# ---------------------------------------------------------------------------------------------
# Aircraft handling: two turntable catapults splayed 5 degrees outboard, and the stern crane.
# ---------------------------------------------------------------------------------------------
COL=collections['Aircraft handling'];ASSEMBLY='aircraft-handling';F=Fittings(helpers,materials,COL)
for sgn in SIDES:
    A_=Vector(h_pt(sgn*7.95,124.0));B_=Vector(h_pt(sgn*9.8,103.0));u=(B_-A_).normalized();yaw=math.atan2(u.y,u.x)
    O=Vector(h_pt(sgn*8.89,113.3));zz=h_deck(113.3);f=h_frame((O.x,O.y,0),yaw)
    cyl('Catapult turntable pedestal',(O.x,O.y,(zz+6.9)/2),1.55,6.9-zz,vertices=20)
    cyl('Catapult turntable foot ring',(O.x,O.y,zz+.08),1.9,.16,'edge',vertices=20)
    cyl('Catapult training race',(O.x,O.y,6.97),1.75,.14,'edge',vertices=20)
    h_box('Catapult pivot housing',f(0,0,7.0),yaw,(2.2,1.3,.3),'naval')
    L0,L1,hw=-10.7,10.3,.52;along=Vector((math.cos(yaw),math.sin(yaw),0))
    for b in (-hw,hw):
        # Plate girder side: top and bottom flange strips and a Warren web of wide flat bars.
        for c in (7.22,7.88):h_strip('Catapult girder flange',f(L0,b,c),f(L1,b,c),(0,0,1),.24,.05)
        nodes=[f(L0+(L1-L0)*i/14,b,7.28 if i%2==0 else 7.82) for i in range(15)]
        for p0,p1 in zip(nodes,nodes[1:]):h_strip('Catapult girder web',p0,p1,tuple(along),.34,.04)
        for p0 in nodes[1::2]:h_strip('Catapult girder post',(p0[0],p0[1],7.12),(p0[0],p0[1],7.98),tuple(along),.12,.04)
        h_strip('Catapult girder end plate',f(L0,b,7.1),f(L0,b,8.0),tuple(along),.5,.045)
        h_strip('Catapult girder end plate',f(L1,b,7.1),f(L1,b,8.0),tuple(along),.5,.045)
    for i in range(0,15,2):
        a_=L0+(L1-L0)*i/14;rod('Catapult cross frame',f(a_,-hw,7.98),f(a_,hw,7.98),.035,'naval',vertices=4)
    h_box('Catapult bottom plate',f((L0+L1)/2,0,7.1),yaw,(L1-L0,1.04,.04),'naval')
    h_box('Catapult track deck',f((L0+L1)/2,0,8.03),yaw,(L1-L0,1.04,.05),'roof')
    for b in (-.28,.28):h_box('Catapult car rail',f((L0+L1)/2,b,8.1),yaw,(L1-L0,.08,.09),'edge')
    h_box('Catapult car',f(7.6,0,8.24),yaw,(2.3,1.0,.3),'naval')
    for b in (-.35,.35):rod('Catapult cradle arm',f(7.0,b,8.38),f(8.0,b,8.75),.04,'edge',vertices=5)
    h_box('Catapult firing cylinder',f(-1.2,0,7.55),yaw,(6.5,.5,.5),'edge')
    for b in (-hw-.05,hw+.05):
        F.ring('Catapult training handwheel',f(.9,b,7.62),.26,.025,'y' if abs(math.cos(yaw))>.7 else 'x',segments=10)
        rod('Handwheel spindle',f(.9,math.copysign(hw,b),7.62),f(.9,b,7.62),.03,'edge',vertices=5)
    # Walkways with guard rails along both sides, and the after loading platform.
    for wb in (-1.0,1.0):
        platform('Catapult walkway',[f(a_,b_,0)[:2] for a_,b_ in [(-6,wb-.3),(9.5,wb-.3),(9.5,wb+.3),(-6,wb+.3)]],7.12,.05,'roof')
        edge_b=wb+math.copysign(.28,wb)
        for a_ in (-5.6,-1.5,2.5,6.5,9.3):
            rod('Walkway bracket',f(a_,wb,7.07),f(a_,math.copysign(.5,wb),7.07),.03,'naval',vertices=4)
            rod('Walkway stanchion',f(a_,edge_b,7.12),f(a_,edge_b,8.05),.02,'naval',vertices=4)
        for c in (7.6,8.05):tube_path('Walkway rail',[f(-5.6,edge_b,c),f(9.3,edge_b,c)],.014,'edge',4)
    platform('Catapult loading platform',[f(a_,b_,0)[:2] for a_,b_ in [(L0-.3,-1.15),(L0+3.3,-1.15),(L0+3.3,1.15),(L0-.3,1.15)]],7.1,.06,'roof')
    for a_,b_ in [(L0-.2,-1.05),(L0-.2,1.05),(L0+3.2,-1.05),(L0+3.2,1.05)]:
        rod('Loading platform stanchion',f(a_,b_,7.1),f(a_,b_,8.05),.022,'naval',vertices=4)
    tube_path('Loading platform rail',[f(L0+3.2,-1.05,8.05),f(L0-.2,-1.05,8.05),f(L0-.2,1.05,8.05),f(L0+3.2,1.05,8.05)],.016,'edge',4)
    for b_ in (-.9,.9):
        p=f(L0+.2,b_,0);rod('Loading platform post',(p[0],p[1],h_deck(-p[0])),(p[0],p[1],7.05),.05,'naval',vertices=6)

# Stern crane: tapered lattice post leaning forward, a fish-belly boom, backstay strut and stays.
cz=h_deck(132.0)
post_base=[(-131.4+dx_,dy_) for dx_,dy_ in [(.55,.55),(.55,-.55),(-.55,-.55),(-.55,.55)]]
post_top=[(-130.35+dx_,dy_) for dx_,dy_ in [(.22,.25),(.22,-.25),(-.22,-.25),(-.22,.25)]]
cyl('Crane pedestal',(-131.4,0,cz+.35),1.0,.7,'naval',vertices=16)
cyl('Crane slewing ring',(-131.4,0,cz+.76),.92,.12,'edge',vertices=16)
pb=cz+.82;pt=14.65
for (x0,y0),(x1,y1) in zip(post_base,post_top):tube_path('Crane post chord',[(x0,y0,pb),(x1,y1,pt)],.085,'naval',4)
for i in range(4):
    (x0,y0),(x1,y1)=post_base[i],post_top[i];(x2,y2),(x3,y3)=post_base[(i+1)%4],post_top[(i+1)%4]
    zig=[]
    for k in range(13):
        t=k/12;a_=(x0+(x1-x0)*t,y0+(y1-y0)*t,pb+(pt-pb)*t);b_=(x2+(x3-x2)*t,y2+(y3-y2)*t,pb+(pt-pb)*t)
        zig.append(a_ if k%2==0 else b_)
    tube_path('Crane post lattice',zig,.045,'naval',4)
tip=(-121.9,0,15.25);root=(-130.35,0,14.75)
for yy in (-.28,.28):tube_path('Crane boom upper chord',[(root[0],yy,root[2]),(tip[0],yy*.4,tip[2])],.075,'naval',4)
belly=[(-129.4,0,13.45),(-127.0,0,13.95),(-124.5,0,14.55),(-122.2,0,15.05)]
tube_path('Crane boom lower chord',[(-130.2,0,14.4)]+belly+[tip],.075,'naval',4)
h_lower=[(-130.2,14.4)]+[(p[0],p[2]) for p in belly]+[(tip[0],tip[2])]
def h_lower_z(x):
    for (a,za),(b,zb) in zip(h_lower,h_lower[1:]):
        if a<=x<=b:return za+(zb-za)*(x-a)/(b-a)
    return h_lower[-1][1]
for yy in (-.28,.28):
    zig=[]
    for k in range(11):
        t=k/10;ux=root[0]+(tip[0]-root[0])*t
        zig.append((ux,yy*(1-.6*t),root[2]+(tip[2]-root[2])*t) if k%2==0 else (ux,0,h_lower_z(ux)))
    tube_path('Crane boom lattice',zig,.04,'naval',4)
h_box('Crane boom head',(-121.9,0,15.0),0,(.7,.36,.6),'naval')
rod('Crane head sheave',(-121.75,-.12,14.75),(-121.75,.12,14.75),.3,'edge',vertices=12)
rod('Crane hoist wire',(-121.75,0,14.45),(-121.75,0,13.6),.018,'edge',vertices=4)
F.ring('Crane hook',(-121.75,0,13.45),.14,.035,'y',segments=10)
rod('Crane hook block',(-121.75,0,13.62),(-121.75,0,13.9),.1,'edge',vertices=6)
for yy in (-.45,.45):rod('Crane backstay strut',(-132.9,yy,cz+.05),(-134.2,yy*.3,10.0),.075,'naval',vertices=6)
h_box('Crane luffing winch',(-134.15,0,10.1),0,(.7,.8,.6),'naval')
for yy in (-.12,.12):rod('Crane backstay',(-134.1,yy,10.35),(-130.4,yy,14.7),.022,'edge',vertices=4)
rod('Crane topping lift',(-130.3,0,14.8),(-125.0,0,14.62),.02,'edge',vertices=4)

# ---------------------------------------------------------------------------------------------
# Underwater: twin skegs, four shafts with bossings and V struts, 4- and 5-bladed screws, twin rudders.
# ---------------------------------------------------------------------------------------------
COL=collections['Underwater fittings'];ASSEMBLY='hull'
def h_blades(name,x,y,z,radius,count):
    for j in range(count):
        a=j*math.tau/count+.3;yy,zz=math.cos(a),math.sin(a)
        vv=[(x+.10,y+yy*.4,z+zz*.4),(x-.20,y+yy*radius-zz*.55,z+zz*radius+yy*.55),(x+.17,y+yy*radius*.98+zz*.42,z+zz*radius*.98-yy*.42),(x+.32,y+yy*.55,z+zz*.55)]
        vv=vv+[(p[0]+.075,p[1],p[2]) for p in vv]
        mesh(name+' blade',vv,[(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,7,4,0)],'bronze')
for sgn in SIDES:
    Y=-sgn*3.5
    stations=[(78,-7.25,.22),(85,-8.2,.55),(92,-8.85,.7),(100,-8.9,.75),(106,-8.9,.65),(107.9,-8.1,.5),(109.1,-6.9,.4),(110.2,-5.2,.3),(110.8,-3.4,.22)]
    rings=[]
    for z_,yb,t in stations:
        rings.append([(-z_,Y-t,-1.2),(-z_,Y-t,yb+t),(-z_,Y,yb),(-z_,Y+t,yb+t),(-z_,Y+t,-1.2)])
    h_loft('Shaft skeg',rings,'antifouling')
    # Inner shaft out of the skeg, 5-bladed screw.
    x,y,z=-110.2,-sgn*3.58,-6.4
    rod('Inner shaft',(-108.6,y,z),(x,y,z),.24,'antifouling',vertices=10)
    rod('Propeller hub',(x-.55,y,z),(x+.55,y,z),.46,'bronze',r2=.26,vertices=12)
    h_blades('Inner screw',x,y,z,2.55,5)
    # Outer shaft on a bossing and V strut, 4-bladed screw.
    x,y,z=-101.5,-sgn*10.0,-5.97
    rod('Outer shaft',(-80.0,y,z+.05),(-95.6,y,z),.26,'antifouling',vertices=10)
    rod('Shaft bossing',(-95.6,y,z),(-101.0,y,z),.5,'antifouling',r2=.5,vertices=12)
    rod('Bossing fairing',(-94.6,y,z),(-95.6,y,z),.26,'antifouling',r2=.5,vertices=12)
    rod('Propeller hub',(x-.55,y,z),(x+.55,y,z),.48,'bronze',r2=.26,vertices=12)
    h_blades('Outer screw',x,y,z,2.72,4)
    rod('Shaft exit fairing',(-80.0,y,z+.05),(-83.2,y,z+.03),.62,'antifouling',r2=.26,vertices=10)
    for yt in (-2.9,-.9):
        wt=loft_breadth(H,-97.8,yt)-.15
        rod('Shaft strut arm',(-97.8,y,z+.2),(-97.8,-sgn*wt,yt),.14,'antifouling',vertices=6)
    # Twin rudders abaft the inner screws.
    def foil(z0,z1,yy):
        c=z1-z0;return [(-(z0+c*u),-sgn*3.5+sgn*t*v,yy) for u,v in [(0,0),(.08,1),(.35,1.15),(.7,.6),(1,0),(.7,-.6),(.35,-1.15),(.08,-1)] for t in [.34]]
    h_loft('Rudder',[foil(113.7,120.2,-2.1),foil(115.6,118.8,-8.9)],'antifouling')
    rod('Rudder stock',(-116.6,-sgn*3.5,-2.2),(-116.6,-sgn*3.5,.4),.22,'antifouling',vertices=10)
