"""01 and 02 deckhouse levels: their walls (scuttles, doors, wall and inclined ladders, fire-fighting gear, bottle
racks, pipes), the 01 deck surface (boats, rafts, lockers, vents, reels), the 01/02 edge rails, and the 01-level
AA installations: the 20 mm gallery and wing sponsons, the forward 40 mm tubs and their Mk.51 director towers.

Positions are measured from the approved reference (sections, tread flights, rung columns and fitting bounds)
in our runtime frame (+x starboard, +y up, -z bow) and mirrored where the reference is symmetric.
Executed in build.py's scope after aft.py.
"""
DM=structure('deckhouse-main');DS=structure('deckhouse-secondary')
Y01=structure_top('deckhouse-main');Y02=structure_top('deckhouse-secondary')
FP01=[tuple(p) for p in DM['footprint']];FP02=[tuple(p) for p in DS['footprint']]
SIDES=[1,-1]

def R(x,y,z):
    """Runtime point (x starboard, y up, z aft) to an authoring Vector."""
    return Vector((-z,-x,y))
def RD(x,z):
    """Runtime horizontal direction to an authoring Vector."""
    return Vector((-z,-x,0))
def P2(x,z):return (-z,-x)
def main_deck(z):return deckz(-z)
def deck_edge(z):return loft_breadth(H,-z,main_deck(z)-.02)

def wall_x(fp,z,s):
    """Outermost wall crossing of a runtime footprint at z on side s: (|x|, outward runtime normal (nx, nz))."""
    best=None
    for a,b in zip(fp,fp[1:]+fp[:1]):
        if (a[1]-z)*(b[1]-z)<=0 and abs(b[1]-a[1])>1e-6 and a[0]*s>0 and b[0]*s>0:
            t=(z-a[1])/(b[1]-a[1]);x=a[0]+(b[0]-a[0])*t
            if best is None or abs(x)>best[0]:
                dx,dz=b[0]-a[0],b[1]-a[1];L=math.hypot(dx,dz);n=(dz/L,-dx/L)
                if n[0]*s<0:n=(-n[0],-n[1])
                best=(abs(x),n)
    return best

def frame_at(fp,z,s):
    """Foot of a wall at runtime z on side s: point, outward and along-wall authoring vectors."""
    x,n=wall_x(fp,z,s);p=R(s*x,0,z);out=RD(n[0],n[1]).normalized();along=Vector((0,0,1)).cross(out)
    return p,out,along
def at01(z,s):return frame_at(FP01,z,s)
def at02(z,s):return frame_at(FP02,z,s)

class Batch:
    """Many small oriented boxes and faces collected into one mesh per material."""
    def __init__(self,name,col=None):self.name=name;self.col=col;self.data={}
    def add(self,mat,vv,ff):
        V,Fs=self.data.setdefault(mat,([],[]));o=len(V);V.extend(tuple(v) for v in vv);Fs.extend(tuple(o+i for i in f) for f in ff)
    def box(self,c,u,v,w,mat='naval',skip=()):
        """Oriented box: centre c and half-axis vectors u, v, w."""
        c,u,v,w=Vector(c),Vector(u),Vector(v),Vector(w)
        if u.cross(v).dot(w)<0:u=-u
        vv=[c+sx*u+sy*v+sz*w for sx,sy,sz in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
        faces={'-w':(3,2,1,0),'+w':(4,5,6,7),'-v':(0,1,5,4),'+u':(1,2,6,5),'+v':(2,3,7,6),'-u':(3,0,4,7)}
        self.add(mat,vv,[f for k,f in faces.items() if k not in skip])
    def bar(self,a,b,width,depth,mat='naval',up=None):
        """Rectangular bar from a to b; `depth` lies along `up` (default world Z, or X for a vertical bar)."""
        a,b=Vector(a),Vector(b);d=b-a;L=d.length
        if L<1e-6:return
        t=d/L;up=Vector(up) if up is not None else (Vector((0,0,1)) if abs(t.z)<.9 else Vector((1,0,0)))
        side=t.cross(up).normalized();up=side.cross(t).normalized()
        self.box((a+b)/2,t*L/2,side*width/2,up*depth/2,mat)
    def flush(self):
        for mat,(V,Fs) in self.data.items():
            if Fs:mesh(self.name,V,Fs,mat,self.col)
        self.data={}

def staple_ladder(name,p,out,along,y0,y1,width=.42):
    """Vertical wall ladder: flat side stringers on stand-offs and rungs every 0.3 m."""
    b=Batch(name);p=Vector((p.x,p.y,0));f=p+out*.14
    for k in [-1,1]:b.bar(f+along*k*width/2+Vector((0,0,y0)),f+along*k*width/2+Vector((0,0,y1)),.05,.016,'edge',up=out)
    z=y0+.28
    while z<y1-.08:
        b.bar(f-along*width/2+Vector((0,0,z)),f+along*width/2+Vector((0,0,z)),.03,.03,'edge');z+=.3
    for k in [-1,1]:
        for z in [y0+.35,y1-.25]:b.bar(p+out*.01+along*k*width/2+Vector((0,0,z)),f+along*k*width/2+Vector((0,0,z)),.05,.04,'edge')
    b.flush()

def incline_ladder(name,bottom,top,width=.66,rails=(1,1),ext=.45):
    """Inclined ladder between runtime points: flat stringers, treads, handrails on three posts."""
    b=Batch(name);a=R(*bottom);c=R(*top);d=c-a
    run=Vector((d.x,d.y,0)).normalized();side=run.cross(Vector((0,0,1))).normalized()*width/2
    for k in [-1,1]:b.bar(a+side*k,c+side*k,.26,.05,'naval',up=side.cross(d).normalized())
    n=max(3,round(d.z/.26))
    for i in range(1,n):b.box(a.lerp(c,i/n),side*.96,run*.12,Vector((0,0,.022)),'roof')
    b.flush()
    for k,on in zip([-1,1],rails):
        if not on:continue
        o=side*k*1.08;h=Vector((0,0,.95))
        tube_path(name+' handrail',[a+o+h,c+o+h]+([c+o+h+run*ext] if ext else []),.022,'edge',5)
        for q in [a,a.lerp(c,.5),c]:rod(name+' handrail post',q+o,q+o+h,.02,'naval',vertices=5)

def post_rail(name,path,y,height=.98,spacing=1.5,courses=3):
    """Deck-edge guard rail along a runtime polyline [(x, z), ...] standing on height y."""
    if len(path)<2:return
    pts=[R(x,y,z) for x,z in path];b=Batch(name)
    for i,(a,c) in enumerate(zip(pts,pts[1:])):
        count=max(1,math.ceil((c-a).length/spacing))
        for j in range(count+(1 if i==len(pts)-2 else 0)):
            b.box(a.lerp(c,j/count)+Vector((0,0,height/2)),Vector((.022,0,0)),Vector((0,.022,0)),Vector((0,0,height/2)),'naval',skip=('-w',))
    b.flush()
    for k in range(courses):
        dz=height*(k+1)/courses
        tube_path(name+' wire',[q+Vector((0,0,dz)) for q in pts],.012 if k<courses-1 else .019,'edge',4)

def rail_cut(path,keep):
    """Split a runtime polyline into sub-paths where keep(x, z) holds (sampled every 0.2 m)."""
    out=[];cur=[]
    for (x0,z0),(x1,z1) in zip(path,path[1:]):
        n=max(1,math.ceil(math.hypot(x1-x0,z1-z0)/.2))
        for i in range(n+1):
            if i==0 and cur:continue
            x=x0+(x1-x0)*i/n;z=z0+(z1-z0)*i/n
            if keep(x,z):cur.append((x,z))
            else:
                if len(cur)>1:out.append(cur)
                cur=[]
    if len(cur)>1:out.append(cur)
    simple=[]
    for p in out:
        q=[p[0]]
        for a,b,c in zip(p,p[1:],p[2:]):
            if abs((b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]))>1e-5:q.append(b)
        q.append(p[-1]);simple.append(q)
    return simple

SECONDARY=[m for m in D['mounts'] if m['battery']=='secondary']
def clear_of_5inch(x,z,top,radius=3.75):
    """True when a fitting whose top is `top` stays clear of every 5-inch gunhouse sweep (corner radius ~3.55 m)."""
    return all(top<m['position'][1]-.02 or math.hypot(x-m['position'][0],z-m['position'][2])>radius for m in SECONDARY)

def bottles(name,p,out,along,y,count=3):
    """Upright CO2 or acetylene bottles strapped to a wall."""
    for i in range(count):
        q=p+out*.14+along*(i-(count-1)/2)*.235
        cyl(name+' bottle',(q.x,q.y,y+.78),.105,1.56,'naval',vertices=6)
        cyl(name+' valve',(q.x,q.y,y+1.62),.04,.12,'edge',vertices=4)
    b=Batch(name+' strap')
    for z in [.55,1.25]:b.bar(p+out*.03-along*(count*.235/2+.03)+Vector((0,0,y+z)),p+out*.03+along*(count*.235/2+.03)+Vector((0,0,y+z)),.04,.05,'edge')
    b.flush()

def hose_rack(name,p,out,along,y):
    """Fire hose rack (hose flaked under a hood on a wall bracket) above a deck hydrant."""
    b=Batch(name);c=p+out*.13+Vector((0,0,y+.95))
    b.box(c,along*.36,out*.12,Vector((0,0,.42)),'canvas')
    b.box(c+out*.03+Vector((0,0,.47)),along*.4,out*.16,Vector((0,0,.05)),'naval')
    b.flush();q=p+out*.14
    cyl(name+' hydrant',(q.x,q.y,y+.24),.06,.48,'naval',vertices=6)
    rod(name+' hydrant outlet',(q.x,q.y,y+.42),tuple(q+out*.14+Vector((0,0,.42))),.035,'edge',vertices=5)

def life_ring(name,p,out,along,y):
    """Life buoy hung on a wall (low-poly ring) with its bracket."""
    c=p+out*.1+Vector((0,0,y));vv=[];ff=[];n=10;k=4;R0=.28;r=.07
    for i in range(n):
        a=i*math.tau/n;radial=along*math.cos(a)+Vector((0,0,math.sin(a)))
        for j in range(k):
            t=j*math.tau/k;vv.append(c+radial*(R0+r*math.cos(t))+out*r*math.sin(t))
    for i in range(n):
        for j in range(k):ff.append((i*k+j,((i+1)%n)*k+j,((i+1)%n)*k+(j+1)%k,i*k+(j+1)%k))
    mesh(name,vv,ff,'white',smooth=True)
    b=Batch(name+' bracket');b.bar(p+Vector((0,0,y+R0)),c+Vector((0,0,R0+.02)),.06,.05,'edge');b.flush()

def scuttle(name,p,out,y):
    q=p+Vector((0,0,y));al=Vector((0,0,1)).cross(out)
    rod(name+' rim',tuple(q-out*.01),tuple(q+out*.045),.18,'edge',vertices=8)
    mesh(name+' glass',[q+out*.047+(al*math.cos(i*math.tau/8)+Vector((0,0,math.sin(i*math.tau/8))))*.125 for i in range(8)],[tuple(range(8))],'glass')

def wt_door(name,p,out,along,y,width=.7,height=1.7):
    """Watertight door: frame, leaf, two dog bars and a handle."""
    b=Batch(name);c=p+Vector((0,0,y+height/2))
    b.box(c+out*.025,along*(width/2+.07),out*.025,Vector((0,0,height/2+.07)),'edge')
    b.box(c+out*.065,along*width/2,out*.02,Vector((0,0,height/2)),'naval')
    for z in [-.55,.55]:b.box(c+out*.09+Vector((0,0,z)),along*width*.4,out*.012,Vector((0,0,.025)),'edge')
    b.box(c+out*.1+along*width*.3,along*.03,out*.03,Vector((0,0,.12)),'edge')
    b.flush()

def carley(name,cx,cz,y,length,beam,angle=0):
    """Carley float: a rounded buoyancy tube around a slatted floor, on two chocks. Runtime centre; `angle`
    turns the long axis from fore-and-aft toward starboard."""
    dl=(math.sin(angle),math.cos(angle));ds=(math.cos(angle),-math.sin(angle));n=16;r=.2
    def at(u,v,h):return R(cx+dl[0]*u+ds[0]*v,h,cz+dl[1]*u+ds[1]*v)
    ring=[]
    for i in range(n):
        a=i*math.tau/n;cu,su=math.cos(a),math.sin(a)
        u=math.copysign(abs(cu)**.45,cu)*(length/2-r);v=math.copysign(abs(su)**.45,su)*(beam/2-r)
        ring.append((u,v))
    tube_path(name+' buoyancy tube',[at(u,v,y+.16+r) for u,v in ring],r,'naval',5,True)
    platform(name+' slatted floor',[tuple(at(u*.9,v*.8,0))[:2] for u,v in ring],y+.24,.04,'canvas')
    b=Batch(name+' chocks')
    for f in [-.28,.28]:b.box(at(f*length,0,y+.08),RD(*ds)*beam*.5,RD(*dl)*.1,Vector((0,0,.08)),'edge')
    b.flush()

# ---------------------------------------------------------------------------------------------------------------
# 20 mm gallery sponsons (oerlikon-deck-1..5, oerlikon-wing-1/2): decks flush with the 01 deck, splinter plating
# with outside stiffeners, under-deck beams and girders, pillars to the main deck, ready-use lockers, spare barrel
# tubes and floater net baskets.
COL=collections['Light AA'];ASSEMBLY='house-aa'
def sponson(name,s,path,z0,z1,top,beams,girders,pillars,stiff,shield_top=9.5):
    """path: runtime outer plating path [(|x|, z)] from the after inboard end to the forward inboard end."""
    wall=[(wall_x(FP01,z,s)[0]+.004,z) for z in [z0+(z1-z0)*i/24 for i in range(25)]]
    outline=path[1:-1]+wall
    platform(name+' deck',[P2(s*x,z) for x,z in outline],top,.14,'roof')
    pp=[P2(s*x,z) for x,z in path]
    if s<0:pp=list(reversed(pp))
    shell_wall(name+' splinter plating',pp,top-.25,shield_top-top+.25,.07)
    b=Batch(name+' framing')
    for x,z,nx,nz in stiff:
        o=RD(s*nx,nz);p=R(s*x,0,z);al=Vector((0,0,1)).cross(o)
        base=[p+Vector((0,0,top-.22)),p+o*.24+Vector((0,0,top-.22)),p+o*.07+Vector((0,0,shield_top-.05)),p+Vector((0,0,shield_top-.05))]
        vv=[q+al*k*.03 for k in [-1,1] for q in base]
        b.add('naval',vv,[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3)])
    for x0,x1,z in beams:b.box(R(s*(x0+x1)/2,top-.26,z),RD(s*(x1-x0)/2,0),Vector((.04,0,0)),Vector((0,0,.12)),'naval')
    for x,za,zb in girders:b.box(R(s*x,top-.28,(za+zb)/2),RD(0,(zb-za)/2),Vector((0,.05,0)),Vector((0,0,.14)),'naval')
    b.flush()
    for x,z in pillars:
        rod(name+' pillar',R(s*x,main_deck(z),z),R(s*x,top-.38,z),.075,'naval',vertices=6)
        cyl(name+' pillar foot',tuple(R(s*x,main_deck(z)+.02,z)),.14,.04,'edge',vertices=6)

def locker_at(name,x,z,s,y,size=(1.38,.63,.8)):
    p=R(s*x,0,z);locker(name,p.x,p.y,y,size,0)

def floater_basket(name,s,x0,x1,z0,z1,y0,y1,post=None):
    """Floater net basket: a sloped-sided trough of netting hung outboard, with top bars and a support post."""
    b=Batch(name);sec=[(x0,y1),(x1,y1),(x1-.12,y0),(x0+.06,y0)]
    vv=[R(s*x,y,z) for z in [z0,z1] for x,y in sec]
    b.add('canvas',vv,[(3,2,1,0),(4,5,6,7),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)])
    for z in [z0+.12,(z0+z1)/2,z1-.12]:
        b.bar(R(s*(x0-.02),y1+.03,z),R(s*(x1+.03),y1+.03,z),.05,.05,'edge')
        b.bar(R(s*(x1+.02),y1,z),R(s*(x1-.1),y0-.03,z),.05,.05,'edge')
    b.flush()
    if post is not None:rod(name+' post',R(s*(x1-.2),main_deck(post),post),R(s*(x1-.2),y0,post),.05,'naval',vertices=6)

def spare_barrel_tube(name,s,x,a,b):
    """Stowage tube for spare 20 mm barrels clipped diagonally to the plating: a=(y, z), b=(y, z)."""
    rod(name,R(s*x,a[0],a[1]),R(s*x,b[0],b[1]),.075,'naval',vertices=6)
    for t in [.2,.8]:
        y=a[0]+(b[0]-a[0])*t;z=a[1]+(b[1]-a[1])*t
        rod(name+' clip',R(s*(x-.1),y,z),R(s*(x+.1),y,z),.09,'edge',vertices=6)

deck_top=max(mount('oerlikon-deck-1-starboard')['position'][1],Y01)
wing_top=max(mount('oerlikon-wing-1-starboard')['position'][1],Y01)
for s in SIDES:
    # Midships 20 mm gallery: z 5.25..20.2 from the 01 wall out to plating at x 14.75.
    z0,z1=5.25,20.2
    path=[(11.0,z1),(14.4,z1),(14.75,z1-.35),(14.75,z0+.35),(14.4,z0),(11.0,z0)]
    stiff=[(14.75,5.67+1.19*i,1,0) for i in range(13)]+[(x,z0,0,-1) for x in [12.65,13.99]]+[(x,z1,0,1) for x in [12.65,13.99]]
    beams=[(wall_x(FP01,z,s)[0],14.68,z) for z in [5.9+1.19*i for i in range(13)]]
    sponson('20 mm gallery',s,path,z0,z1,deck_top,beams,[(12.62,z0+.1,z1-.1),(13.95,z0+.1,z1-.1)],
            [(14.45,z) for z in [6.33,8.67,11.1,14.67,17.07,19.5]],stiff)
    for z in [8.4,9.83,12.49,14.83,17.16,19.42]:locker_at('20 mm ready-use locker',11.51,z,s,Y01)
    spare_barrel_tube('Spare barrel tube',s,14.58,(8.62,7.62),(9.4,8.98))
    spare_barrel_tube('Spare barrel tube',s,14.58,(8.62,16.2),(9.4,17.6))
    floater_basket('Floater net basket',s,14.76,15.5,5.66,9.09,8.38,9.26,post=8.85)
    floater_basket('Floater net basket',s,14.76,15.5,16.34,19.77,8.38,9.26,post=16.6)
    # Forward wing gallery: z -14.13..-7.97, plating at x 16.0 with chamfered corners.
    z0,z1=-14.13,-7.97
    path=[(13.1,z1),(15.42,z1),(16.0,z1-.61),(16.0,z0+.63),(15.42,z0),(13.1,z0)]
    sponson('20 mm wing gallery',s,path,z0,z1,wing_top,[(13.2,15.93,z) for z in [-9.0,-10.3,-11.7,-13.0]],
            [(14.0,z0+.1,z1-.1),(15.08,z0+.1,z1-.1)],[(15.08,-8.95),(15.08,-13.08)],[(16.0,z,1,0) for z in [-8.97,-10.32,-11.71,-13.05]])
    for z in [-13.0,-11.27,-9.47]:locker_at('20 mm ready-use locker',13.26,z,s,Y01)
    spare_barrel_tube('Spare barrel tube',s,16.1,(8.35,-10.3),(9.4,-11.6))
    b=Batch('Emergency box');b.box(R(s*14.41,9.27,-8.14),RD(s*.2,0),Vector((.1,0,0)),Vector((0,0,.15)),'naval');b.flush()
    floater_basket('Floater net basket',s,13.0,13.94,-17.56,-14.12,8.3,9.16)
for m in D['mounts']:
    if m['id'].startswith(('oerlikon-deck-','oerlikon-wing-')):AA_INSTALLED.add(m['id'])

# Forward 40 mm tubs beside the bridge: plating 1.0 m high outboard rising to 1.5 m inboard, open toward the
# Mk.51 director tower that closes the tub; the tub deck overhangs the 01 wall on knees.
def tub_ring(name,cx,cz,s,r,y0,height_at,t=.08,n=36,gap=None):
    """Ring of splinter plating (runtime centre) whose top follows height_at(angle); `gap` = (a0, a1) left open.
    Angle 0 points outboard, pi inboard."""
    if gap:
        a0,a1=gap;span=(a0-a1)%math.tau;angles=[a1+span*i/n for i in range(n+1)]
    else:angles=[i*math.tau/n for i in range(n)]
    vv=[];ff=[]
    for a in angles:
        h=height_at(a)
        for rr,yy in [(r,y0),(r,h),(r-t,h),(r-t,y0)]:vv.append(R(cx+s*rr*math.cos(a),yy,cz+rr*math.sin(a)))
    m=len(angles)
    for i in range(m if not gap else m-1):
        j=(i+1)%m
        for k in range(4):ff.append((i*4+k,j*4+k,j*4+(k+1)%4,i*4+(k+1)%4))
    if gap:ff+=[(3,2,1,0),((m-1)*4,(m-1)*4+1,(m-1)*4+2,(m-1)*4+3)]
    mesh(name,vv,ff,'naval')
    tube_path(name+' rolled edge',[R(cx+s*(r-t/2)*math.cos(a),height_at(a)+.01,cz+(r-t/2)*math.sin(a)) for a in angles],.028,'naval',4,not gap)

for s in SIDES:
    m=mount('bofors-forward-wing-starboard' if s>0 else 'bofors-forward-wing-port');cx,cy,cz=m['position'];r=2.62
    platform('40 mm tub deck',[P2(cx+s*(r-.04)*math.cos(i*math.tau/32),cz+(r-.04)*math.sin(i*math.tau/32)) for i in range(32)],cy,.26,'roof')
    tub_ring('40 mm tub splinter plating',cx,cz,s,r,cy-.3,lambda a,cy=cy:cy+1.0+.5*(1-math.cos(a))/2,gap=(math.pi-.4,math.pi+.4))
    wx=wall_x(FP01,cz,s)[0]
    for a in [-.75,-.25,.25,.75]:
        zz=cz+(r-.15)*math.sin(a);top=R(cx+s*(r-.15)*math.cos(a),cy-.26,zz);w=R(s*(wx-.02),cy-.26,zz)
        if (top-w).length>.3:knee('40 mm tub knee',tuple(top),tuple(w),1.0)
    rod('40 mm tub drain',R(s*(wx+.06),cy-.3,cz-.9),R(s*(wx+.06),main_deck(cz)+.05,cz-.9),.04,'naval',vertices=6)
    AA_INSTALLED.add(m['id'])
    # Mk.51 director tower (AD_3 port / AD_4 starboard): plated cylinder from the 01 deck, platform at 9.92 m.
    dx,dy,dz=s*8.33,9.92,-19.92;rt=.83
    tub_ring('Mk.51 director tower',dx,dz,s,rt,Y01,lambda a:dy+1.03,t=.06,n=20)
    platform('Mk.51 director platform',[P2(dx+rt*.97*math.cos(i*math.tau/20),dz+rt*.97*math.sin(i*math.tau/20)) for i in range(20)],dy,.1,'roof')
    p=R(dx,0,dz);mk51('Mk.51 director AD_%d'%(4 if s>0 else 3),p.x,p.y,dy,-math.pi/2 if s>0 else math.pi/2)
    out=RD(s,0);staple_ladder('Mk.51 tower ladder',R(dx+s*rt,0,dz),out,Vector((0,0,1)).cross(out),Y01,dy+1.0)

# ---------------------------------------------------------------------------------------------------------------
# Boats: 26 ft motor whaleboats in radial davits outboard of the 20 mm gallery, on trestles over the main deck;
# Carley floats and a floater basket on the forward 01 deck; a spare seaplane float amidships.
COL=collections['Deck fittings'];ASSEMBLY='deckhouse-main'
def whaleboat(name,s,xc,z0,z1,keel,sheer,beam):
    L=z1-z0;stations=[0,.07,.2,.38,.62,.8,.93,1]
    half=[.03,.42,.83,1,1,.86,.45,.04];lift=[.45,.22,.06,0,0,.07,.24,.48]
    prof=[(0,0),(.42,.05),(.8,.24),(.97,.6),(1,1)];rows=[]
    for t,h,l in zip(stations,half,lift):
        z=z0+L*t;ring=[]
        for k in [-1,1]:
            for f,v in (list(reversed(prof)) if k<0 else prof[1:]):
                ring.append(R(s*xc+k*f*h*beam/2,keel+l*.35+v*(sheer+l-keel-l*.35),z))
        rows.append(ring)
    n=len(rows[0]);vv=[q for ring in rows for q in ring];ff=[]
    for j in range(len(rows)-1):
        for i in range(n-1):ff.append((j*n+i,j*n+i+1,(j+1)*n+i+1,(j+1)*n+i))
    mesh(name+' hull',vv,ff,'naval',smooth=True)
    for k in [0,n-1]:tube_path(name+' gunwale',[ring[k] for ring in rows],.04,'edge',4)
    b=Batch(name+' fittings')
    for t in [.25,.45]:b.box(R(s*xc,keel+.7*(sheer-keel),z0+L*t),RD(s*beam*.43,0),Vector((.11,0,0)),Vector((0,0,.03)),'canvas')
    b.box(R(s*xc,keel+.18,(z0+z1)/2),RD(0,L*.4),Vector((0,.3,0)),Vector((0,0,.03)),'roof')
    b.box(R(s*xc,keel+.5,z0+L*.64),RD(s*.36,0),RD(0,.7),Vector((0,0,.3)),'naval')
    b.box(R(s*xc,keel+.83,z0+L*.64),RD(s*.4,0),RD(0,.75),Vector((0,0,.03)),'roof')
    b.flush()

for s in SIDES:
    xc,z0,z1,keel,sheer,beam=15.82,8.76,16.7,7.08,8.18,1.96
    whaleboat('26 ft motor whaleboat',s,xc,z0,z1,keel,sheer,beam)
    b=Batch('Whaleboat trestle')
    for z in [10.7,14.7]:
        md=main_deck(z);outer=min(xc+.9,deck_edge(z)-.35)
        b.bar(R(s*(xc-.9),md,z),R(s*(xc-.35),keel+.1,z),.07,.07,'naval');b.bar(R(s*outer,md,z),R(s*(xc+.35),keel+.1,z),.07,.07,'naval')
        b.box(R(s*xc,keel+.06,z),RD(s*.6,0),Vector((.09,0,0)),Vector((0,0,.07)),'edge')
        for x in [xc-.9,outer]:b.box(R(s*x,md+.02,z),RD(s*.12,0),Vector((.12,0,0)),Vector((0,0,.02)),'edge')
    b.flush()
    # Radial davits, arms turned in over the boat's ends: foot abreast the boat, head over its centreline.
    for zf,zh in [(9.15,9.95),(16.1,15.3)]:
        md=main_deck(zf);top=9.45
        tube_path('Radial davit',[R(s*14.95,md,zf),R(s*14.95,md+2.3,zf),R(s*15.02,md+2.95,zf+(zh-zf)*.25),R(s*15.35,top,zf+(zh-zf)*.65),R(s*15.82,top-.05,zh)],.09,'naval',6)
        cyl('Davit foot',tuple(R(s*14.95,md+.06,zf)),.2,.12,'edge',vertices=6)
        rod('Davit fall',R(s*15.82,top-.1,zh),R(s*15.82,sheer+.45,zh),.018,'edge',vertices=4)
        rod('Davit fall block',R(s*15.82,sheer+.2,zh),R(s*15.82,sheer+.45,zh),.06,'edge',vertices=6)
    md=main_deck(7.2);b=Batch('Boat winch')
    b.box(R(s*15.1,md+.3,7.2),RD(s*.45,0),Vector((.3,0,0)),Vector((0,0,.3)),'naval');b.flush()
    rod('Boat winch drum',R(s*14.68,md+.85,7.2),R(s*15.52,md+.85,7.2),.22,'edge',vertices=8)
    for x in [14.66,15.5]:rod('Boat winch cheek',R(s*x,md+.85,7.2),R(s*(x+.04),md+.85,7.2),.33,'naval',vertices=8)
    # Carley floats on the forward 01 deck (athwartships ahead of the 40 mm tub, angled abaft it).
    carley('Carley float',s*11.1,-24.06,Y01,3.3,2.05,s*math.pi/2)
    carley('Carley float',s*11.45,-15.95,Y01,3.0,1.45,s*.835)
    # Spare seaplane float on chocks against the 02 wall.
    xc,z0,z1=9.37,17.08,23.46;L=z1-z0;vv=[];ff=[]
    st=[0,.06,.2,.45,.7,.9,1];hw=[.05,.28,.44,.45,.4,.25,.03];hh=[.08,.3,.4,.41,.38,.25,.05]
    for t,w,h in zip(st,hw,hh):
        z=z0+L*t;yc=Y01+.44+(.12 if t<.1 else 0)
        for a in range(6):ang=a*math.tau/6+math.pi/6;vv.append(R(s*(xc+w*math.cos(ang)),yc+h*math.sin(ang),z))
    for j in range(len(st)-1):
        for a in range(6):ff.append((j*6+a,j*6+(a+1)%6,(j+1)*6+(a+1)%6,(j+1)*6+a))
    ff+=[tuple(range(6))[::-1],tuple(range(len(st)*6-6,len(st)*6))]
    mesh('Spare seaplane float',vv,ff,'naval',smooth=True)
    b=Batch('Seaplane float chock')
    for z in [19.05,20.02,22.2]:b.box(R(s*xc,Y01+.1,z),RD(s*.46,0),Vector((.1,0,0)),Vector((0,0,.1)),'edge')
    b.flush()

# Forward 01 deck: mushroom ventilators, cable reels and a hatch.
def vent8(name,x,z,w=1.5,h=1.04):
    p=R(x,Y01,z);cyl(name+' trunk',(p.x,p.y,Y01+h*.42),w*.36,h*.84,'naval',vertices=8)
    cyl(name+' cap',(p.x,p.y,Y01+h*.92),w*.5,h*.16,'naval',vertices=8,r2=w*.34)
def cable_reel(name,x,z,w=1.6):
    p=R(x,Y01,z);ax=Vector((0,1,0));c=p+Vector((0,0,.95));side=ax.cross(Vector((0,0,1)))
    rod(name+' drum',c-ax*w*.4,c+ax*w*.4,.42,'canvas',vertices=10)
    for k in [-1,1]:rod(name+' flange',c+ax*k*w*.4,c+ax*k*(w*.4+.05),.62,'naval',vertices=12)
    b=Batch(name+' frame')
    for k in [-1,1]:
        for j in [-1,1]:b.bar(c+ax*k*(w*.4+.13)+Vector((0,0,.05)),p+ax*k*(w*.4+.13)+side*j*.55,.07,.07,'naval')
        b.box(p+Vector((0,0,.03))+ax*k*(w*.4+.13),side*.65,ax*.05,Vector((0,0,.03)),'edge')
    b.bar(c+ax*(w*.4+.13),c+ax*(w*.4+.45),.05,.05,'edge')
    b.flush()
vent8('Mushroom ventilator',-8.65,-28.52);vent8('Mushroom ventilator',6.42,-27.15);vent8('Mushroom ventilator',-8.62,-22.95)
vent8('Mushroom ventilator',-5.18,-33.52,.62,.72)
cable_reel('Cable reel',8.8,-26.42);cable_reel('Cable reel',-6.45,-24.3)
b=Batch('01 deck hatch');b.box(R(6.94,Y01+.2,-24.7),Vector((1.0,0,0)),Vector((0,.5,0)),Vector((0,0,.2)),'naval')
b.box(R(6.94,Y01+.43,-24.7),Vector((1.05,0,0)),Vector((0,.55,0)),Vector((0,0,.035)),'roof');b.flush()

# ---------------------------------------------------------------------------------------------------------------
# Guard rails on the exposed 01 and 02 deck edges (reference stanchion lines), kept out of the 5-inch sweeps,
# with openings at ladder heads; ladder landings.
COL=collections['Superstructure']
rails01=[[(12.92,-22.75),(12.92,-29.75),(8.52,-37.87),(8.0,-37.98),(6.6,-37.92)],
         [(8.5,-31.94),(7.18,-30.57),(5.56,-29.74),(3.8,-28.85),(1.37,-28.84)],
         [(12.26,-7.02),(12.28,-3.76),(11.76,-3.0)],
         [(12.09,30.25),(12.09,33.0),(12.0,38.36),(11.54,38.85),(8.85,43.52)]]
rails02=[[(9.08,-14.6),(9.3,-13.15)],
         [(10.0,-12.87),(10.54,-12.87),(10.54,-10.72),(10.6,-10.5),(10.6,-4.15),(9.52,-2.98),(8.7,-2.98),(8.36,-2.63),(8.36,6.48)]]
ladder_heads01=[-30.4,38.5];ladder_heads02=[-3.3]
for s in SIDES:
    ASSEMBLY='deckhouse-main'
    for path in rails01:
        for part in rail_cut(path,lambda x,z:clear_of_5inch(s*x,z,Y01+1.0) and all(abs(z-q)>.4 for q in ladder_heads01)):
            post_rail('01 deck rail',[(s*x,z) for x,z in part],Y01)
    # Landing abaft the after 5-inch sponson; its ladder runs down aft to the main deck.
    platform('01 ladder landing',[P2(s*x,z) for x,z in [(12.1,28.75),(13.1,28.75),(13.1,30.15),(12.1,30.15)]],Y01,.12,'roof')
    post_rail('01 landing rail',[(s*12.14,28.8),(s*13.05,28.8),(s*13.05,30.1)],Y01)
    knee('01 landing knee',tuple(R(s*13.0,Y01-.12,29.45)),tuple(R(s*12.2,Y01-.12,29.45)),.8)
    ASSEMBLY='deckhouse-secondary'
    for path in rails02:
        for part in rail_cut(path,lambda x,z:clear_of_5inch(s*x,z,Y02+1.0) and all(abs(z-q)>.4 for q in ladder_heads02)):
            post_rail('02 deck rail',[(s*x,z) for x,z in part],Y02)
    # 02 deck overhang where the forward 01-02 ladder lands (reference slab out to x 10.6).
    platform('02 deck overhang',[P2(s*x,z) for x,z in [(9.44,-12.95),(10.62,-12.95),(10.62,-10.72),(9.19,-10.72),(9.19,-12.56),(9.44,-12.6)]],Y02,.15,'roof')
    for z in [-12.7,-10.95]:knee('02 overhang knee',tuple(R(s*10.45,Y02-.15,z)),tuple(R(s*9.2,Y02-.15,z)),.9)
    for z0,z1,x0 in [(12.2,12.95,8.56),(29.1,30.85,8.6)]:
        platform('02 ladder landing',[P2(s*x,z) for x,z in [(x0,z0),(9.38,z0),(9.38,z1),(x0,z1)]],Y02,.12,'roof')
        knee('02 landing knee',tuple(R(s*9.3,Y02-.12,(z0+z1)/2)),tuple(R(s*(x0+.02),Y02-.12,(z0+z1)/2)),.7)

# ---------------------------------------------------------------------------------------------------------------
# Ladders: inclined ladders at the reference tread flights (main deck to 01, 01 to 02) and wall ladders at its
# rung columns.
for s in SIDES:
    out=1 if s>0 else 0;inn=1-out
    ASSEMBLY='deckhouse-main'
    incline_ladder('Inclined ladder',(s*12.75,main_deck(-6.3),-6.3),(s*12.75,Y01,-7.9))
    incline_ladder('Inclined ladder',(s*12.62,main_deck(31.8),31.8),(s*12.62,Y01,30.15),ext=0)
    incline_ladder('Inclined ladder',(s*7.62,main_deck(-39.5),-39.5),(s*7.62,Y01,-38.05),ext=0)
    ASSEMBLY='deckhouse-secondary'
    incline_ladder('Inclined ladder',(s*9.62,Y01,-14.25),(s*9.62,Y02,-12.75),rails=(out,inn))
    incline_ladder('Inclined ladder',(s*8.9,Y01,14.3),(s*8.9,Y02,12.8),rails=(inn,out),ext=0)
    incline_ladder('Inclined ladder',(s*8.95,Y01,27.6),(s*8.95,Y02,29.2),rails=(out,inn),ext=0)
    ASSEMBLY='deckhouse-main'
    for z,y1 in [(-30.4,Y01),(4.5,Y01),(38.5,Y01),(52.5,Y02)]:
        p,o,a=at01(z,s);staple_ladder('Wall ladder',p,o,a,main_deck(z),y1)
    ASSEMBLY='deckhouse-secondary'
    for z,y1 in [(-3.3,Y02),(21.75,Y02+1.1),(37.25,Y02)]:
        p,o,a=at02(z,s);staple_ladder('Wall ladder',p,o,a,Y01,y1)

# ---------------------------------------------------------------------------------------------------------------
# Wall fittings at the reference's fitting positions: bottle racks, fire hose racks and hydrants, hose reels, life
# buoys, stretchers, fenders, fuel hoses; watertight doors, scuttles and pipe runs.
ASSEMBLY='deckhouse-main'
for s,z in [(-1,-3.58),(-1,11.02),(-1,11.76),(-1,13.72),(1,15.28),(1,15.99),(1,19.51),(1,33.07),(1,33.81),(1,-.84)]:
    p,o,a=at01(z,s);bottles('CO2 bottle rack',p,o,a,main_deck(z))
ASSEMBLY='deckhouse-secondary'
for s,z in [(-1,3.4),(-1,4.1),(-1,5.6),(1,4.15),(1,5.6),(1,6.34)]:
    p,o,a=at02(z,s);bottles('CO2 bottle rack',p,o,a,Y01)
ASSEMBLY='deckhouse-main'
for s,z in [(-1,-33.37),(1,-31.72),(1,-2.76),(-1,5.75),(1,11.45),(1,32.0),(-1,35.37),(-1,51.44),(1,53.68)]:
    p,o,a=at01(z,s);hose_rack('Fire hose rack',p,o,a,main_deck(z))
for s,z in [(-1,-32.37),(1,-31.57)]:
    p,o,a=at01(z,s);c=p+o*.32+Vector((0,0,7.8))
    rod('Fire hose reel drum',c-a*.22,c+a*.22,.2,'canvas',vertices=8)
    for k in [-1,1]:rod('Fire hose reel cheek',c+a*k*.22,c+a*k*.25,.28,'naval',vertices=8)
    b=Batch('Fire hose reel bracket');b.bar(p+Vector((0,0,7.8)),c-a*.26,.06,.06,'naval');b.bar(p+Vector((0,0,7.8)),c+a*.26,.06,.06,'naval');b.flush()
for s,z,y in [(-1,-30.75,6.83),(1,-30.1,6.83),(1,-3.76,7.23),(1,35.3,6.85),(-1,41.65,6.84),(1,42.28,6.82),(-1,48.7,6.84)]:
    p,o,a=at01(z,s);life_ring('Life buoy',p,o,a,y)
for s,z in [(-1,7.42),(-1,8.13),(1,13.93)]:
    p,o,a=at01(z,s);md=main_deck(z);b=Batch('Stokes stretcher')
    b.box(p+o*.14+Vector((0,0,md+1.05)),a*.3,o*.1,Vector((0,0,1.02)),'canvas');b.box(p+o*.04+Vector((0,0,md+1.05)),a*.34,o*.04,Vector((0,0,1.06)),'edge');b.flush()
for s in SIDES:
    for x,z in [(11.86,21.22),(13.6,22.2)]:
        md=main_deck(z);p=R(s*x,md,z)
        cyl('Fender',(p.x,p.y,md+1.0),.42,1.7,'canvas',vertices=8)
        for y in [md+.08,md+1.92]:cyl('Fender end',(p.x,p.y,y),.3,.16,'canvas',vertices=8)
    ASSEMBLY='deckhouse-secondary'
    p,o,a=at02(42.2,s)
    for y in [Y01+.2,Y01+.64]:rod('Fuel oil hose',p+o*.33-a*1.02+Vector((0,0,y)),p+o*.33+a*1.02+Vector((0,0,y)),.17,'canvas',vertices=6)
    b=Batch('Fuel hose bracket')
    for k in [-.7,.7]:
        b.bar(p+a*k+o*.55+Vector((0,0,Y01)),p+a*k+o*.55+Vector((0,0,Y01+.85)),.06,.06,'naval')
        for y in [Y01+.02,Y01+.46]:b.bar(p+a*k+Vector((0,0,y)),p+o*.58+a*k+Vector((0,0,y)),.05,.05,'naval')
    b.flush()
    ASSEMBLY='deckhouse-main'
    for z in [-26.0,-4.9,27.9,45.5]:
        p,o,a=at01(z,s);wt_door('Watertight door',p,o,a,main_deck(z)+.02)
    for z in [-24.0,-12.0,-10.0,17.8,36.5,40.0]:
        p,o,a=at01(z,s);scuttle('Scuttle',p,o,7.65)
    ASSEMBLY='deckhouse-secondary'
    for z in [-9.5,16.5,24.5,34.0]:
        p,o,a=at02(z,s);scuttle('Scuttle',p,o,10.25)
    ASSEMBLY='deckhouse-main'
    # Fire main runs with bends on the forward 01 face; a curved spare-boom pair and a three-pipe bundle on
    # the flush after wall.
    for y in [7.1,8.15]:
        pts=[]
        for z in [-33.5,-35.0,-36.4]:
            p,o,a=at01(z,s);pts.append(p+o*.1+Vector((0,0,y)))
        pts.append(pts[-1]+(pts[-1]-pts[-2]).normalized()*.25+Vector((0,0,-.35)))
        tube_path('Fire main',pts,.05,'naval',6)
        b=Batch('Pipe clip')
        for q,z in zip(pts[:3],[-33.5,-35.0,-36.4]):o=at01(z,s)[1];b.bar(q-o*.11,q+o*.03,.05,.1,'edge')
        b.flush()
    for off,half in [(0,1.55),(.34,1.4)]:
        pts=[]
        for i in range(9):
            u=-1+i/4;z=46.9+u*half;p,o,a=at01(z,s);pts.append(p+o*.12+Vector((0,0,8.55-off+1.25*u*u)))
        tube_path('Spare boom',pts,.06,'naval',6)
        for u in [-.6,.6]:
            z=46.9+u*half;p,o,a=at01(z,s);b=Batch('Boom clip');b.bar(p+Vector((0,0,8.55-off+1.25*u*u)),p+o*.16+Vector((0,0,8.55-off+1.25*u*u)),.1,.14,'edge');b.flush()
    for y in [7.75,8.05,8.35]:
        pts=[]
        for z in [55.1,53.9,52.9]:
            p,o,a=at01(z,s);pts.append(p+o*.1+Vector((0,0,y)))
        pts.append(pts[-1]+(pts[-1]-pts[-2]).normalized()*.3+Vector((0,0,-.45)))
        tube_path('Pipe bundle',pts,.045,'naval',6)
    b=Batch('Pipe clip')
    for z in [54.6,53.4]:
        p,o,a=at01(z,s);b.bar(p+Vector((0,0,7.65)),p+o*.16+Vector((0,0,7.65)),.08,.06,'edge');b.bar(p+o*.13+Vector((0,0,7.62)),p+o*.13+Vector((0,0,8.42)),.08,.05,'edge')
    b.flush()
