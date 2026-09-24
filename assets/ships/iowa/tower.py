"""Fore tower: the 03 level beside the tower with its 20 mm sponsons, the Mk.37 side-director sponsons and their
supports, the tower platform, gallery and foretop, the Mk.38 and side Mk.37 directors, Mk.51 directors AD_11-14,
and the foremast with its SK-2 and SG radars.

Region: the tower from the 03 level up (runtime z -11..+8), the foremast and its rigging. Levels, outlines and
fittings are measured from plan/elevation sections and matched renders of the approved GameModels3D Iowa;
all geometry is independently authored. Executed in build.py's scope after forward.py.
"""
import bmesh
COL=collections['Superstructure'];structures={s['id']:s for s in D['structures']}
SIDES=(-1,1)
MASTS=collections['Masts and directors']

def P(x,y,z):
    """Runtime point (x starboard, y up, z aft) to authoring (bow, port, up)."""
    return (-z,-x,y)

def Q(x,z):
    return (-z,-x)

def bar(name,a,b,r,material='naval',sides=4,r2=None):
    """Uncapped low-sided strut for braces, rungs and wires (cheaper than rod)."""
    a,b=Vector(a),Vector(b);d=(b-a).normalized();r2=r if r2 is None else r2
    up=Vector((0,0,1)) if abs(d.z)<.95 else Vector((1,0,0))
    u=d.cross(up).normalized();w=d.cross(u).normalized();vv=[]
    for p,rr in [(a,r),(b,r2)]:
        for k in range(sides):
            t=k*math.tau/sides;vv.append(tuple(p+(u*math.cos(t)+w*math.sin(t))*rr))
    return mesh(name,vv,[(k,(k+1)%sides,sides+(k+1)%sides,sides+k) for k in range(sides)],material)

def ladder(name,a,b,width=.42,across='x',pitch=.3):
    """Vertical or inclined ladder; `across` is the authoring axis its rungs run along."""
    a,b=Vector(a),Vector(b);half=Vector((width/2,0,0)) if across=='x' else Vector((0,width/2,0))
    for k in (-1,1):bar(name+' stringer',a+half*k,b+half*k,.028,'edge',4)
    n=max(2,math.ceil((b-a).length/pitch))
    for i in range(n+1):
        p=a.lerp(b,i/n);bar(name+' rung',p-half,p+half,.018,'edge',3)

def disc(name,center,normal,r,n=8,material='dark'):
    """Flat n-gon facing `normal` (lightening hole, blanking plate)."""
    c=Vector(center);d=Vector(normal).normalized();up=Vector((0,0,1)) if abs(d.z)<.95 else Vector((1,0,0))
    u=d.cross(up).normalized();w=d.cross(u).normalized()
    return mesh(name,[tuple(c+(u*math.cos(k*math.tau/n)+w*math.sin(k*math.tau/n))*r) for k in range(n)],[tuple(range(n))],material)

def outward(o):
    bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
    return o

def extrude_x(name,section,x0,x1,material='naval'):
    """Prism of a runtime (z, y) cross-section between runtime x0 and x1."""
    n=len(section);vv=[P(x,y,z) for x in (x0,x1) for z,y in section]
    ff=[tuple(range(n)),tuple(reversed(range(n,2*n)))]+[(i,i+n,(i+1)%n+n,(i+1)%n) for i in range(n)]
    return outward(mesh(name,vv,ff,material))

def ribs(name,path,y0,y1,centre,every=1,r=.04):
    """Vertical flat-bar stiffeners outside a bulwark (runtime x, z path; pushed away from `centre`)."""
    for (ax,az),(bx_,bz) in list(zip(path,path[1:]))[::every]:
        mx,mz=(ax+bx_)/2,(az+bz)/2;d=Vector((mx-centre[0],mz-centre[1],0))
        if d.length<1e-6:continue
        d.normalize();bar(name,P(mx+d.x*.07,y0,mz+d.y*.07),P(mx+d.x*.07,y1,mz+d.y*.07),r,'naval',4)

def densify(path,step):
    """Points along a runtime (x, z) polyline at most `step` apart."""
    out=[path[0]]
    for a,b in zip(path,path[1:]):
        n=max(1,math.ceil(math.dist(a,b)/step))
        out.extend((a[0]+(b[0]-a[0])*i/n,a[1]+(b[1]-a[1])*i/n) for i in range(1,n+1))
    return out

def step_irons(name,x,z,y0,y1,normal_z,pitch=.3):
    """U-shaped step irons up a wall facing runtime `normal_z` (+1 aft, -1 forward)."""
    for i in range(max(1,int((y1-y0)/pitch))+1):
        y=y0+i*pitch
        tube_path(name,[P(x-.18,y,z),P(x-.18,y,z+normal_z*.13),P(x+.18,y,z+normal_z*.13),P(x+.18,y,z)],.016,'edge',3)

def lookout(name,x,z,y,bearing):
    """Lookout or target-designator station: pedestal, sight body and binocular barrels."""
    bx,by=Q(x,z);before=set(scene.objects)
    cyl(name+' pedestal',(bx,by,y+.55),.08,1.1,'naval',vertices=8)
    box(name+' sight body',(bx+.05,by,y+1.2),(.42,.36,.22),'naval')
    for k in (-1,1):rod(name+' binocular',(bx-.14,by+k*.12,y+1.36),(bx+.3,by+k*.12,y+1.36),.06,'edge',vertices=8)
    box(name+' shoulder rest',(bx-.3,by,y+1.2),(.08,.46,.14),'edge')
    _turned(before,bx,by,y,bearing)

def light(name,x,z,y,r=.48,bearing=0,pedestal=.6):
    """Searchlight on a raised pedestal: fork, trunnions, drum, lens and lamp house."""
    bx,by=Q(x,z);before=set(scene.objects)
    cyl(name+' pedestal',(bx,by,y+pedestal/2),.24,pedestal,'naval',vertices=10)
    y0=y+pedestal
    for k in (-1,1):box(name+' fork',(bx,by+k*(r+.07),y0+.42),(.12,.09,.84))
    rod(name+' trunnion',(bx,by-r-.12,y0+.78),(bx,by+r+.12,y0+.78),.05,'edge',vertices=6)
    rod(name+' drum',(bx-.28,by,y0+.78),(bx+.3,by,y0+.78),r,'naval',vertices=14)
    rod(name+' lens',(bx+.3,by,y0+.78),(bx+.32,by,y0+.78),r*.86,'glass',vertices=14)
    rod(name+' lamp house',(bx-.28,by,y0+.78),(bx-.5,by,y0+.78),r*.72,'naval',vertices=10,r2=r*.45)
    _turned(before,bx,by,y,bearing)

def spider(name,centre,axis,r=1.25,spokes=8):
    """Starburst ECM/IFF antenna: hub and radial dipoles in the plane normal to `axis` (authoring)."""
    c=Vector(centre);d=Vector(axis).normalized();up=Vector((0,0,1)) if abs(d.z)<.95 else Vector((1,0,0))
    u=d.cross(up).normalized();w=d.cross(u).normalized()
    rod(name+' hub',tuple(c-d*.08),tuple(c+d*.08),.09,'edge',vertices=8)
    for k in range(spokes):
        t=k*math.tau/spokes;bar(name+' dipole',c,c+(u*math.cos(t)+w*math.sin(t))*r,.016,'edge',3)

# ---------------------------------------------------------------------------------------------------------
# 03 level beside the tower (blueprint tower-03-deck): the 20 mm sponsons with their splinter shields, ready-use
# lockers, spare-barrel tubes, flag bags and signal lamps; the walkway beside the funnel and its ladders.
# ---------------------------------------------------------------------------------------------------------
ASSEMBLY='tower-03-deck';D3=12.95
def wall03(z):return 7.45+(z+4)/8.05*.2
for s in SIDES:
    spon=[(7.35,4.05),(8.1,4.2),(8.7,4.0),(9.05,3.65),(9.16,3.3),(8.04,-1.6),(7.56,-2.94),(7.35,-2.94)]
    platform('03 level 20 mm sponson deck',[Q(s*x,z) for x,z in spon],D3,.14)
    shield=[(6.7,4.0),(7.9,4.0),(8.45,3.92),(8.85,3.72),(9.08,3.3),(7.98,-1.55),(7.62,-1.82),(7.2,-1.9)]
    path=[Q(s*x,z) for x,z in shield]
    shell_wall('20 mm splinter shield',path if s>0 else path[::-1],D3,1.0,.05)
    for t in (.12,.37,.62,.87):
        x=9.08+(7.98-9.08)*t;z=3.3+(-1.55-3.3)*t;bar('Splinter shield stiffener',P(s*(x+.07),D3-.1,z),P(s*(x+.07),D3+.96,z),.04,'naval',4)
    for z in (3.0,1.4,-.2,-1.3):
        edge=8.04+(z+1.6)/4.9*1.12
        knee('20 mm sponson knee',P(s*(edge-.18),D3-.14,z),P(s*wall03(z),D3-.14,z),1.2)
    # Spare barrel tube strapped diagonally to the outside of the shield.
    rod('20 mm spare barrel tube',P(s*8.93,D3+.1,2.05),P(s*8.66,D3+.85,.86),.09,'naval',vertices=8)
    for t in (.25,.75):
        p=Vector(P(s*8.93,D3+.1,2.05)).lerp(Vector(P(s*8.66,D3+.85,.86)),t)
        rod('Spare barrel clamp',tuple(p),tuple(p+Vector((0,s*.1,0))),.11,'edge',vertices=8)
    for x in (4.37,5.77):
        bx,by=Q(s*x,1.345);locker('20 mm ready-use locker',bx,by,D3,(1.36,.62,.74),math.pi/2)
    # Flag bags on the forward 03 deck, canvas-covered.
    x0,x1=sorted((s*3.7,s*7.3))
    extrude_x('Flag bag',[(-3.87,D3),(-2.92,D3),(-2.92,13.98),(-3.87,14.52)],x0,x1)
    extrude_x('Flag bag cover',[(-3.93,14.5),(-2.88,13.95),(-2.88,14.02),(-3.93,14.58)],x0,x1,'canvas')
    for x in (4.9,6.1):bar('Flag bag divider',P(s*x,14.0,-3.9),P(s*x,14.55,-3.9),.03,'edge',4)
    bar('Signal lamp post',P(s*7.42,D3,-2.78),P(s*7.42,14.25,-2.78),.045,'naval',6)
    rod('Signal lamp',P(s*7.25,14.42,-2.78),P(s*7.72,14.42,-2.78),.17,'naval',vertices=12)
    rod('Signal lamp shutter',P(s*7.72,14.42,-2.78),P(s*7.74,14.42,-2.78),.15,'glass',vertices=12)
    rail('03 level edge rail',[Q(s*7.3,-1.95),Q(s*7.47,-2.94),Q(s*7.35,-4.0)],D3,.95)
    # Walkway beside the funnel, on posts from the 02 deck, with the ladders up from the 02 deck and on to the
    # director sponson.
    strip=[(2.3,4.0),(3.8,4.0),(3.8,7.88),(1.25,7.88),(1.9,7.3),(2.3,6.3)]
    platform('03 level walkway beside the funnel',[Q(s*x,z) for x,z in strip],D3,.12)
    for z in (5.9,7.75):bar('Walkway post',P(s*3.68,11.05,z),P(s*3.68,D3-.12,z),.06,'naval',6)
    rail('Walkway rail',[Q(s*3.8,4.06),Q(s*3.8,7.88),Q(s*1.4,7.88)],D3,.9)
    ladder('02 to 03 inclined ladder',P(s*3.15,11.05,7.05),P(s*3.15,D3,6.05),.6,across='y')

# ---------------------------------------------------------------------------------------------------------
# Mk.37 side-director sponsons (blueprint tower-sponson-*): two-lobed splinter bulwark around the director
# column, plate girders with lightening holes and bracing down to the 03 deck, an intermediate landing, the
# walkway forward along the tower side, a searchlight and a Mk.51 on the lobes.
# ---------------------------------------------------------------------------------------------------------
SPY=17.5
for s in SIDES:
    side='starboard' if s>0 else 'port'
    ASSEMBLY='tower-sponson-'+side;COL=collections['Superstructure']
    edge=[(3.46,-.7),(6.5,-1.3),(7.2,-1.0),(7.6,.1),(7.45,1.0),(7.2,1.4),(6.3,2.14),(5.7,2.64),(6.8,4.1),(7.4,5.2),(7.64,5.9),
          (7.64,6.4),(7.4,7.0),(6.9,7.44),(6.5,7.6),(5.4,7.8),(2.6,7.92),(1.3,7.92)]
    path=[Q(s*x,z) for x,z in edge]
    shell_wall('Director sponson splinter bulwark',path[::-1] if s>0 else path,SPY,1.1,.05)
    ribs('Bulwark stiffener',[(s*x,z) for x,z in edge[1:6]],SPY-.15,SPY+1.06,(s*5.8,.4))
    ribs('Bulwark stiffener',[(s*x,z) for x,z in edge[8:16]],SPY-.15,SPY+1.06,(s*6.0,6.0))
    rail('Director sponson walkway rail',[Q(s*3.46,-6.3),Q(s*3.46,-.75)],SPY,.95)
    for z in (-5.8,-3.8,-1.8):knee('Walkway knee',P(s*3.3,SPY-.15,z),P(s*2.49,SPY-.15,z),.9)
    # Plate girders carry the sponson from the 03 deck, with bracing to the lobes.
    for z,face in ((1.75,-1),(4.06,1)):
        box('Director sponson girder',P(s*4.5,(D3+SPY-.15)/2,z),(.06,4.2,SPY-.15-D3))
        for x in (3.4,4.5,5.7):disc('Girder lightening hole',P(s*x,15.9,z+face*.035),(-face,0,0),.3)
    for a,b in [((6.58,15.3,1.8),(6.58,17.3,4.0)),((6.58,17.3,1.8),(6.58,15.3,4.0)),((6.9,17.33,6.9),(6.45,D3,4.05)),
                ((4.6,17.33,7.7),(3.65,15.25,5.0)),((6.9,17.33,-.8),(6.58,15.25,1.8)),((4.9,17.33,-.9),(4.4,15.25,1.8)),
                ((7.0,17.35,4.5),(7.0,15.25,4.5))]:
        bar('Director sponson strut',P(s*a[0],a[1],a[2]),P(s*b[0],b[1],b[2]),.065,'naval',6)
    land=[(2.35,1.75),(6.6,1.75),(6.6,4.06),(7.7,4.06),(7.7,5.0),(3.6,5.0),(3.6,7.2),(1.95,7.2),(2.35,6.2)]
    platform('Director sponson landing',[Q(s*x,z) for x,z in land],15.25,.1)
    rail('Landing rail',[Q(s*x,z) for x,z in [(6.6,4.1),(7.7,4.1),(7.7,5.0),(3.6,5.0),(3.6,7.2),(2.05,7.2)]],15.25,.95)
    ladder('Director sponson ladder',P(s*2.85,D3,5.55),P(s*2.85,SPY,4.6),.6,across='y')
    light('Director sponson searchlight',s*6.42,5.96,SPY,.48,-s*math.radians(65))
    # Director column and lower trunk; the Mk.37 head sits on the column.
    ASSEMBLY='director-secondary-'+side;COL=MASTS
    m=next(m for m in D['modules'] if m['id']==ASSEMBLY);cx,cy=Q(m['center'][0],m['center'][2]);base=m['center'][1]-m['size'][1]/2
    cyl('Mk.37 director column',(cx,cy,(SPY-.15+base)/2),1.38,base-SPY+.15,'naval',vertices=12)
    for y in (18.95,19.95):tube_path('Director column band',[(cx+1.41*math.cos(k*math.tau/12),cy+1.41*math.sin(k*math.tau/12),y) for k in range(12)],.03,'naval',3,True)
    cyl('Mk.37 director trunk',(cx+.05,cy,(D3+SPY)/2),.35,SPY-D3,'naval',vertices=8)
    director_details(m,base)
    ASSEMBLY='tower-mk51-directors'
    mk51('Mk.51 director',*Q(s*6.82,-.18),SPY,-s*math.pi/2)
COL=collections['Superstructure']

# ---------------------------------------------------------------------------------------------------------
# Tower base sides: Mk.51 tubs AD_11/12 on brackets, doors, scuttles, louvres, pipe runs and ladders.
# ---------------------------------------------------------------------------------------------------------
for s in SIDES:
    ASSEMBLY='tower-base';COL=collections['Superstructure'];n=(0,-s);Y=19.88
    arc=[(3.45+.85*math.cos(t),-5.05+.85*math.sin(t)) for t in [math.pi/2-k*math.pi/8 for k in range(9)]]
    tub_outline=[(2.42,-4.2)]+arc+[(2.42,-5.9)]
    platform('Mk.51 tub floor',[Q(s*x,z) for x,z in tub_outline],Y,.12)
    path=[Q(s*x,z) for x,z in tub_outline]
    shell_wall('Mk.51 tub splinter shield',path if s>0 else path[::-1],Y,1.17,.045)
    ribs('Tub stiffener',[(s*x,z) for x,z in arc],Y-.12,Y+1.14,(s*3.3,-5.05),every=2)
    for z in (-4.55,-5.55):knee('Mk.51 tub bracket',P(s*4.05,Y-.12,z),P(s*2.49,Y-.12,z),1.25)
    for z,y in [(-2.3,D3),(-3.1,SPY)]:door('Tower watertight door',*Q(s*2.49,z),y,n,.72,1.78)
    for z,y in [(-1.0,21.4),(-2.6,21.4),(-5.6,15.2)]:porthole('Tower scuttle',*Q(s*2.49,z),y,n,.17)
    louvre('Tower ventilation louvre',*Q(s*2.52,-4.3),14.0,n,1.0,.7)
    ladder('Tower side ladder',P(s*2.64,D3,-.3),P(s*2.64,SPY-.15,-.3),.42,across='x')
    ladder('Tower platform ladder',P(s*2.64,SPY,-1.5),P(s*2.64,24.55,-1.5),.42,across='x')
    tube_path('Tower pipe run',[P(s*2.57,D3,-3.45),P(s*2.57,22.6,-3.45),P(s*2.57,23.1,-2.7),P(s*2.57,24.35,-2.7)],.05,'naval',6)
    tube_path('Tower pipe run',[P(s*2.57,SPY,-6.1),P(s*2.57,23.8,-6.1),P(s*2.57,24.35,-6.6)],.04,'naval',6)
    tube_path('Tower pipe run',[P(s*2.56,23.35,-.9),P(s*2.56,23.35,-7.6)],.045,'naval',6)
    tube_path('Tower pipe drop',[P(s*2.56,23.35,-2.1),P(s*2.56,SPY+1.2,-2.1)],.035,'naval',6)
    tube_path('Tower pipe drop',[P(s*2.56,23.35,-6.8),P(s*2.56,18.2,-6.8)],.035,'naval',6)
    for y in (15.0,19.0,22.0):
        for z in (-3.45,-6.1):
            if y>SPY or z>-6:bar('Pipe clip',P(s*2.49,y,z),P(s*2.6,y,z),.07,'edge',4)
    louvre('Tower ventilation louvre',*Q(s*2.52,-1.2),14.2,n,1.0,.7)
    hose_reel('Fire hose reel',*Q(s*2.78,-1.3),D3,-s*math.pi/2)
    extinguisher_rack('CO2 bottles',*Q(s*2.62,-2.2),SPY,-s*math.pi/2)
    door('Tower-upper door',*Q(s*2.27,-3.7),24.54,n,.66,1.72)
    ASSEMBLY='tower-mk51-directors';COL=MASTS
    mk51('Mk.51 director',*Q(s*3.51,-5.06),Y,-s*math.pi/2)
COL=collections['Superstructure']

# ---------------------------------------------------------------------------------------------------------
# Tower platform (24.54 m): deep splinter bulwark on a chamfered outline, brackets, pelorus and designators, bell.
# ---------------------------------------------------------------------------------------------------------
ASSEMBLY='tower-platform';Y=24.54
bw=[(2.15,-2.05),(2.55,-2.05),(3.35,-5.6),(3.3,-8.7),(1.3,-11.2),(-1.3,-11.2),(-3.3,-8.7),(-3.35,-5.6),(-2.55,-2.05),(-2.15,-2.05)]
# A smooth, deep plate skirts the platform edge below the deck as in the reference.
shell_wall('Tower platform splinter bulwark',[Q(x,z) for x,z in bw],Y-.32,1.47,.06)
for s in SIDES:
    bar('Speaker bracket',P(s*1.37,Y-.13,-8.45),P(s*1.37,24.1,-8.45),.03,'edge',4)
    rod('Loudspeaker',P(s*1.37,24.05,-8.4),P(s*1.37,23.78,-8.62),.08,'naval',vertices=10,r2=.2)
for s in SIDES:
    for z,edge in [(-4.0,3.0),(-6.0,3.33),(-7.8,3.3)]:knee('Tower platform knee',P(s*(edge-.12),Y-.13,z),P(s*2.49,Y-.13,z),.9)
    lookout('Target designator',s*1.97,-9.35,Y,s*math.radians(-20))
    cyl('Pelorus stand',Q(s*2.9,-8.42)+(Y+.5,),.09,1.0,'naval',vertices=8)
    cyl('Pelorus bowl',Q(s*2.9,-8.42)+(Y+1.08,),.21,.16,'naval',vertices=12)
    bar('Pelorus sight vane',P(s*2.9,Y+1.16,-8.62),P(s*2.9,Y+1.36,-8.22),.02,'edge',4)
for x in (-1.2,0,1.2):knee('Tower platform bow bracket',P(x,Y-.32,-10.95),P(x,Y-.32,-8.21),1.3)
bx,by=Q(1.38,-10.52);locker('Ready-use locker',bx,by,Y,(1.0,.9,.68),math.pi/2)
bar('Bell bracket',P(0,Y-.13,-9.1),P(0,23.9,-9.1),.05,'naval',6)
cyl('Ship\'s bell',Q(0,-9.1)+(23.42,),.36,.82,'bronze',vertices=14,r2=.2)
rod('Bell crown',P(0,23.83,-9.1),P(0,23.95,-9.1),.12,'bronze',vertices=8)
ASSEMBLY='tower-upper'
# Faceted half-round lookout bay on the tower front, roof at 27.02 m with a guard rail.
bay=[(1.5*math.sin(math.radians(a)),-8.2-1.12*math.cos(math.radians(a))) for a in (90,59,28,0,-28,-59,-90)]
platform('Tower forward lookout bay',[Q(x,z) for x,z in bay+[(-1.4,-7.9),(1.4,-7.9)]],27.02,27.02-Y,'naval')
rail('Lookout bay rail',[Q(x,z) for x,z in bay],27.02,.9,1.3)
bar('Signal lamp post',P(0,27.02,-9.0),P(0,27.95,-9.0),.05,'naval',6)
rod('Signal lamp',P(0,28.2,-8.95),P(0,28.2,-9.5),.2,'naval',vertices=12)
rod('Signal lamp shutter',P(0,28.2,-9.5),P(0,28.2,-9.52),.17,'glass',vertices=12)

# ---------------------------------------------------------------------------------------------------------
# Upper tower: after gallery (29.45 m) wrapping the tower with the starboard and port landings, the forward
# platform with the jammer, observation slits, access ladders and conduits.
# ---------------------------------------------------------------------------------------------------------
ASSEMBLY='tower-upper';GY=29.45
outer=[(1.9,-7.75),(3.1,-7.75),(3.1,-4.1),(2.55,-3.8),(2.45,-3.0),(1.85,-1.65),(1.2,-.9),(.55,-.25),(0,.05),(-.55,-.25),(-1.2,-.9),
       (-1.85,-1.65),(-2.45,-3.0),(-3.1,-3.0),(-3.1,-4.6),(-1.95,-4.6)]
inner=[(-1.93,-3.68),(-1.5,-2.78),(-.9,-2.05),(0,-1.78),(.9,-2.05),(1.5,-2.78),(1.88,-3.68),(1.93,-7.55)]
platform('Tower after gallery',[Q(x,z) for x,z in outer+inner],GY,.12)
rail('Tower gallery rail',[Q(x,z) for x,z in outer[1:]],GY,.95,1.4)
for top,wall_ in [((2.95,-5.5),(2.02,-5.5)),((2.95,-7.2),(2.0,-7.2)),((0,-.15),(0,-1.62)),((1.45,-1.25),(1.03,-2.0)),
                  ((-1.45,-1.25),(-1.03,-2.0)),((-2.95,-3.8),(-1.98,-3.8))]:
    knee('Gallery knee',P(top[0],GY-.12,top[1]),P(wall_[0],GY-.12,wall_[1]),.9)
fwd=[(1.1,-8.1),(1.1,-10.0),(.65,-10.45),(-.65,-10.45),(-1.1,-10.0),(-1.1,-8.1)]
platform('Tower forward platform',[Q(x,z) for x,z in fwd],GY+.05,.12)
rail('Tower forward platform rail',[Q(x,z) for x,z in [(1.1,-8.25)]+fwd[1:5]+[(-1.1,-8.25)]],GY+.05,.95,1.2)
for x in (-.7,.7):knee('Forward platform knee',P(x,GY-.07,-10.2),P(x,GY-.07,-8.21),1.1)
box('Jammer cabinet',P(0,GY+.5,-9.8),(.7,1.1,.9))
rod('Jammer horn',P(0,GY+1.1,-10.05),P(0,GY+1.1,-10.4),.12,'naval',vertices=8,r2=.2)
# Small mesh antenna on a post at the platform's port fore corner.
bar('Antenna post',P(-.75,GY+.05,-10.1),P(-.75,GY+1.25,-10.1),.04,'naval',6)
for k in range(5):
    y=GY+.9+k*.3;bar('Antenna frame',P(-.2,y,-10.25),P(-1.3,y,-10.25),.012,'edge',3)
for k in range(5):
    x=-.2-k*.275;bar('Antenna frame',P(x,GY+.9,-10.25),P(x,GY+2.1,-10.25),.012,'edge',3)
for s in SIDES:
    for y in [27.95,31.43]:
        xw=2.29-(y-24.532)/7.608*.38
        for z in ([-4.4,-5.9,-7.2] if y<30 else [-6.2,-7.2]):
            box('Tower observation coaming',P(s*xw,y,z),(.73,.065,.34))
            box('Tower observation slit',P(s*(xw+.038),y,z),(.55,.025,.15),'glass')
    ladder('Upper tower access',P(s*2.36,Y,-6.6),P(s*1.99,32.06,-6.6),.42,across='x')
    for z in (-5.0,-5.3):
        xw=lambda y:2.29-(y-24.532)/7.608*.38+.06
        tube_path('Tower-upper conduit',[P(s*xw(24.6),24.6,z),P(s*xw(32.0),32.0,z)],.04,'naval',6)
    bar('Siren bracket',P(s*2.02,30.3,-6.95),P(s*2.4,30.3,-6.95),.03,'edge',4)
    rod('Siren',P(s*2.4,30.3,-6.75),P(s*2.4,30.3,-7.25),.13,'naval',vertices=10,r2=.2)
step_irons('Tower step irons',.9,-8.21,27.35,29.2,-1)
step_irons('Tower step irons',.9,-8.2,29.8,31.9,-1)

# ---------------------------------------------------------------------------------------------------------
# Foretop (32.24 m): bulwark on brackets, sky lookouts, target designators and the ECM antennas.
# ---------------------------------------------------------------------------------------------------------
ASSEMBLY='tower-crown';Y=32.24
crown=structures['tower-crown']['footprint']
shell_wall('Foretop splinter bulwark',[Q(x,z) for x,z in crown][::-1],Y,.96,.055,closed=True)
platform('Running light shelf',[Q(x,z) for x,z in [(.6,-10.55),(.32,-11.78),(-.32,-11.78),(-.6,-10.55)]],Y,.18)
box('Masthead running light',P(0,Y+.17,-11.55),(.32,.86,.3),'naval')
rod('Running light lens',P(0,Y+.19,-11.71),P(0,Y+.19,-11.74),.1,'glass',vertices=8)
ribs('Foretop stiffener',crown,Y-.18,Y+.92,(0,-6.2),every=2)
for top,wall_ in [((2.75,-4.2),(1.87,-4.2)),((2.75,-6.0),(1.91,-6.0)),((3.55,-7.7),(1.88,-7.7)),((.9,-10.35),(.9,-8.19)),((1.7,-10.2),(1.7,-8.01))]:
    for s in SIDES:knee('Foretop bracket',P(s*top[0],Y-.18,top[1]),P(s*wall_[0],Y-.18,wall_[1]),1.3)
knee('Foretop bracket',P(0,Y-.18,-1.8),P(0,Y-.18,-2.2),.8)
for s in SIDES:
    lookout('Sky lookout',s*2.04,-3.7,Y,-s*math.radians(60))
    lookout('Sky lookout',s*1.63,-9.88,Y,-s*math.radians(25))
    lookout('Target designator',s*3.1,-7.6,Y,-s*math.radians(80))
    bar('ECM antenna bracket',P(s*2.9,32.1,-4.57),P(s*3.8,32.0,-4.57),.05,'naval',6)
    spider('ECM antenna',P(s*3.85,32.0,-4.57),(0,1,0),1.2)
    bar('Fighting light outrigger',P(s*3.7,32.5,-7.6),P(s*5.55,32.5,-7.6),.05,'naval',6)
    bar('Fighting light outrigger stay',P(s*3.7,33.15,-7.6),P(s*5.4,32.55,-7.6),.025,'edge',4)
    box('Fighting light',P(s*5.55,32.8,-7.6),(.36,.3,.5),'naval')
    rod('Fighting light lens',P(s*5.55,32.85,-7.78),P(s*5.55,32.85,-7.86),.11,'glass',vertices=8)

# ---------------------------------------------------------------------------------------------------------
# Director column seams and access ladder; the Mk.38 main director head sits on the column.
# ---------------------------------------------------------------------------------------------------------
ASSEMBLY='tower-director-column'
for y in (33.55,34.66,35.75):
    rx=2.25-(y-32.14)/4.4435*.30;ry=1.85-(y-32.14)/4.4435*.20
    tube_path('Director column seam',[(6.55+rx*math.cos(k*math.tau/24),ry*math.sin(k*math.tau/24),y) for k in range(24)],.02,'edge',3,True)
ladder('Director column ladder',P(0,Y,-4.14),P(0,36.45,-4.42),.4,across='y')
for s in SIDES:
    bar('Column lamp bracket',P(s*1.62,35.05,-6.72),P(s*1.9,35.05,-6.72),.03,'edge',4)
    rod('Column fighting lamp',P(s*1.9,35.2,-6.72),P(s*1.9,34.85,-6.72),.12,'naval',vertices=10)
ASSEMBLY='director-main-forward';fire_control('director-main-forward')

# ---------------------------------------------------------------------------------------------------------
# Foremast: pole on the after gallery, radar platform with the rotating SK-2, topmast with the SG, signal yard.
# ---------------------------------------------------------------------------------------------------------
COL=MASTS;ASSEMBLY='foremast'
POLE_Z=-.83;TOP_Z=1.65;DISH_Z=-2.62;PLAT=38.9;YARD=(33.3,-1.85)
def foremast_x(z):
    """Authoring x of the foremast at height z: the lower pole, then the topmast above the radar platform."""
    return -POLE_Z if z<PLAT else -TOP_Z
def aftermast_x(z):return -36.4-1.1*(min(36.1,z)-11.43)/24.67
FOREMAST_YARD_TIPS=[P(s*6.9,YARD[0],YARD[1]) for s in SIDES]
FOREMAST_HEAD=P(0,46.3,TOP_Z)
rod('Foremast pole',P(0,GY,POLE_Z),P(0,PLAT-.25,POLE_Z),.24,'naval',r2=.19,vertices=10)
ladder('Foremast ladder',P(0,GY+.15,POLE_Z+.32),P(0,PLAT-.2,POLE_Z+.32),.38,across='y')
for y in (31.0,34.0,37.0):bar('Ladder standoff',P(0,y,POLE_Z+.15),P(0,y,POLE_Z+.32),.025,'naval',4)
bar('Foremast tower bracket',P(0,30.8,POLE_Z-.2),P(0,30.8,-1.95),.07,'naval',6)
bar('Foremast yard bracket',P(0,YARD[0],POLE_Z-.2),P(0,YARD[0],YARD[1]),.06,'naval',6)
for s in SIDES:
    bar('Foretop signal yard',P(0,YARD[0],YARD[1]),P(s*7.0,YARD[0],YARD[1]),.075,'naval',6,r2=.035)
    bar('Yard support',P(s*1.3,33.2,-1.72),P(s*1.3,YARD[0]-.05,YARD[1]),.04,'naval',4)
    bar('Yard lift',P(0,PLAT-.3,POLE_Z),P(s*6.9,YARD[0],YARD[1]),.013,'edge',3)
    bar('Wind vane post',P(s*6.6,YARD[0],YARD[1]),P(s*6.6,33.85,YARD[1]),.025,'edge',4)
    box('Wind instrument',P(s*6.6,33.9,YARD[1]),(.18,.12,.14),'naval')
    bar('IFF antenna',P(s*3.6,YARD[0],YARD[1]),P(s*3.6,34.4,YARD[1]),.02,'edge',4)
    bar('IFF antenna element',P(s*3.6,34.3,YARD[1]-.35),P(s*3.6,34.3,YARD[1]+.35),.015,'edge',3)
    # Signal halyards from the yard down to the flag bags on the 03 level.
    for a,b in [(2.5,3.9),(3.5,4.8),(4.5,5.8),(5.5,6.8)]:
        bar('Signal halyard',P(s*a,YARD[0],YARD[1]),P(s*b,14.35,-3.4),.008,'edge',3)
bar('ECM antenna arm',P(0,33.05,POLE_Z+.2),P(0,33.05,2.0),.05,'naval',6)
for s in SIDES:bar('Foremast backstay',P(0,PLAT-.5,POLE_Z),P(s*2.3,24.6,.15),.013,'edge',3)
spider('After ECM antenna',P(0,33.05,2.05),(1,0,0),1.2)
# Radar platform: rounded after end round the topmast, a narrow neck over the pole, forward end under the SK-2.
aft=[(math.sin(a),1.65+math.cos(a)) for a in [math.radians(90-k*22.5) for k in range(9)]]
front=[(-1.45*math.cos(b),DISH_Z-1.45*math.sin(b)) for b in [k*math.pi/8 for k in range(9)]]
platform('Radar platform',[Q(x,z) for x,z in aft+[(-1.0,0.0)]+front+[(1.0,0.0)]],PLAT,.25)
rail('Radar platform rail',[Q(1.0,-.3),Q(1.0,1.65)]+[Q(x,z) for x,z in aft[1:-1]]+[Q(-1.0,1.65),Q(-1.0,-.3)],PLAT,.9,1.3)
for x,z in [(.85,1.3),(-.85,1.3),(1.0,-2.4),(-1.0,-2.4),(0,-3.7)]:
    bar('Radar platform strut',P(0,37.2,POLE_Z),P(x,PLAT-.25,z),.06,'naval',6)
bar('Signal yard',P(-2.45,PLAT-.3,.43),P(2.45,PLAT-.3,.43),.05,'naval',6)
for s in SIDES:bar('Platform after spar',P(s*.6,PLAT-.1,2.45),P(0,PLAT-.1,3.6),.04,'naval',4)
for s in SIDES:bar('Signal yard stay',P(s*2.4,PLAT-.3,.43),P(s*4.6,YARD[0],YARD[1]),.01,'edge',3)
SKB=39.45
cyl('SK-2 pedestal',Q(0,DISH_Z)+((PLAT+SKB)/2,),.56,SKB-PLAT,'naval',vertices=8,r2=.5)
cyl('SK-2 training ring',Q(0,DISH_Z)+(SKB-.04,),.6,.08,'edge',vertices=16)
# SK-2 reflector (5.8 m), mount and feed rotate on the stable radar-search.yaw joint.
ASSEMBLY='radar-search';before=set(scene.objects)
ax=-DISH_Z;apex=ax+.33;R=2.9;depth=.85;cz=42.3;segs=20;rings=[0,.4,.75,1.0]
def dish_point(rho,phi,back):return (apex-(.07 if back else 0)+depth*(rho/R)**2,rho*math.cos(phi),cz+rho*math.sin(phi))
vv=[];ff=[]
for back in (False,True):
    start=len(vv);vv.append(dish_point(0,0,back))
    for f in rings[1:]:vv.extend(dish_point(f*R,k*math.tau/segs,back) for k in range(segs))
    ring=lambda i,k:start+1+(i-1)*segs+k%segs
    for k in range(segs):
        tri=(start,ring(1,k),ring(1,k+1));ff.append(tri if not back else tri[::-1])
        for i in range(1,len(rings)-1):
            quad=(ring(i,k),ring(i+1,k),ring(i+1,k+1),ring(i,k+1));ff.append(quad if not back else quad[::-1])
front_rim=[1+(len(rings)-2)*segs+k for k in range(segs)];half=len(vv)//2
for k in range(segs):ff.append((front_rim[k],front_rim[k]+half,front_rim[(k+1)%segs]+half,front_rim[(k+1)%segs]))
mesh('SK-2 reflector',vv,ff,'naval')
for k in range(8):
    phi=k*math.tau/8;tube_path('SK-2 reflector rib',[tuple(Vector(dish_point(f*R,phi,True))-Vector((.04,0,0))) for f in (0,.5,1.0)],.035,'naval',3)
cyl('SK-2 rotating base',(ax,0,SKB+.12),.5,.24,'naval',vertices=12)
box('SK-2 mount column',(ax-.05,0,(SKB+.24+41.35)/2),(.56,.8,41.35-SKB-.24),'naval')
box('SK-2 mount head',(ax-.07,0,41.5),(.62,.95,.36),'naval')
for f in (1,-1):
    bar('SK-2 back brace',(ax+.2,f*.35,41.6),dish_point(1.5,f*math.pi/2,True),.05,'naval',4)
    bar('SK-2 back brace',(ax+.2,f*.35,41.6),dish_point(1.7,f*math.pi/4,True),.045,'naval',4)
bar('SK-2 back brace',(ax+.2,0,41.6),dish_point(0,0,True),.06,'naval',6)
tube_path('SK-2 reflector back ring',[tuple(Vector(dish_point(.72*R,k*math.tau/16,True))-Vector((.04,0,0))) for k in range(16)],.035,'naval',3,True)
feed=Vector((ax+2.28,0,cz))
bar('SK-2 feed',dish_point(0,0,False),feed,.07,'edge',6)
box('SK-2 feed head',tuple(feed+Vector((.08,0,0))),(.18,.55,.2),'naval')
bar('SK-2 feed dipole',tuple(feed+Vector((.15,0,-.4))),tuple(feed+Vector((.15,0,.4))),.02,'edge',4)
radar_pivot('radar-search.yaw',(ax,0,SKB),set(scene.objects)-before)
# Topmast with its ladder, SG radar platform, gaff and the TBS antenna on a whip abaft the SG.
ASSEMBLY='foremast'
rod('Foremast topmast',P(0,PLAT,TOP_Z),P(0,46.55,TOP_Z),.15,'naval',r2=.1,vertices=8)
ladder('Topmast ladder',P(0,PLAT+.1,TOP_Z-.6),P(0,45.85,TOP_Z-.6),.34,across='y')
for y in (40.5,42.5,44.5):bar('Ladder standoff',P(0,y,TOP_Z-.12),P(0,y,TOP_Z-.6),.022,'naval',4)
for s in SIDES:bar('Topmast shroud',P(0,45.3,TOP_Z),P(s*.98,PLAT+.02,1.3),.013,'edge',3)
bar('Topmast gaff',P(0,44.8,.3),P(0,44.8,3.1),.045,'naval',6)
bar('Topmast crosstree',P(-.9,44.6,TOP_Z),P(.9,44.6,TOP_Z),.04,'naval',6)
platform('SG radar platform',[Q(x,z) for x,z in circle(0,TOP_Z,.8,10)],45.9,.08)
rail('SG platform rail',[Q(x,z) for x,z in circle(0,TOP_Z,.8,10)],45.9,.85,1.3,closed=True)
for x,z in [(.7,TOP_Z),(-.7,TOP_Z)]:bar('SG platform knee',P(0,45.2,TOP_Z),P(x,45.82,z),.04,'naval',4)
cyl('SG radar pedestal',Q(0,TOP_Z)+(46.8,),.2,.5,'naval',vertices=10)
sv=[];sf=[]
for off in (0,.045):
    for y in (47.04,47.7):
        for k in range(7):
            v=-.64+k*.64/3;sv.append(P(v,y,TOP_Z+.18-.2*(v/.64)**2+off))
for k in range(6):
    sf.append((k,k+1,8+k,7+k));sf.append((14+k,21+k,22+k,15+k))
sf+=[(0,7,21,14),(6,20,27,13)]+[(k,14+k,15+k,k+1) for k in range(6)]+[(7+k,8+k,22+k,21+k) for k in range(6)]
outward(mesh('SG reflector',sv,sf,'naval'))
bar('SG feed',P(0,47.3,TOP_Z),P(0,47.3,TOP_Z-.45),.03,'edge',4)
bar('Whip bracket',P(0,46.3,TOP_Z),P(0,46.3,2.35),.04,'naval',4)
rod('TBS whip',P(0,46.3,2.35),P(0,50.7,2.35),.04,'edge',r2=.015,vertices=6)
for k in range(4):
    a=k*math.pi/2;bar('TBS radial',P(0,48.3,2.35),P(1.25*math.cos(a),48.0,2.35+1.25*math.sin(a)),.012,'edge',3)

AA_INSTALLED.update(['oerlikon-bridge-port','oerlikon-bridge-starboard'])
COL=collections['Superstructure']
