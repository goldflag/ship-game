"""Forward superstructure (FWD region): the bridge from the 02 deck (11.05 m) up.

Tiers, all measured on the approved GameModels3D Iowa (our runtime frame):
03-level deckhouse on the 02 deck (roof 12.95 m), bridge house around the conning
tower (roof = 15.2 m gallery deck), the flat-fronted navigation bridge and chart
house (roof 17.55 m) with the open bridge's flared splinter bulwark, conning tower
top (19.3 m), Mk.37 barbette to the director at 20.65 m, the 40 mm bridge tubs
(floor 18.17 m) and the Mk.57 pedestal (platform 19.64 m).

Executed in build.py's scope after every mount exists; uses details.py and the
build.py primitives. Runtime points [x, y, z] (x starboard, z aft) are converted
with P(); symmetric fittings loop over s = +1 (starboard) and -1 (port). Names
defined here must not shadow build.py/details.py globals (later region files use
them); path_rail is kept for midships.py.
"""
COL=collections['Superstructure'];F=Fittings(helpers,materials,COL)

def path_rail(name,path,z,height=.92):
    # Shared with midships.py (funnel walkway rails); kept unchanged from the foundation recipe.
    for a,b in zip(path,path[1:]):
        count=max(1,math.ceil(math.dist(a,b)/1.2))
        for i in range(count+1):
            t=i/count;x=a[0]+(b[0]-a[0])*t;y=a[1]+(b[1]-a[1])*t
            rod(name+' stanchion',(x,y,z),(x,y,z+height),.022,'naval',vertices=6)
        for dz in [height*.48,height]:rod(name+' wire',(*a,z+dz),(*b,z+dz),.014,'edge',vertices=4)

def P(x,y,z):return (-z,-x,y)
def A(x,z):return (-z,-x)
def N(nx,nz):
    l=math.hypot(nx,nz);return (-nz/l,-nx/l)
def lerp2(a,b,t):return (a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t)

def inward(path,inside):
    """Orient an authoring-plane path so its left side (details.py plate thickness) faces `inside`."""
    a,b=Vector((*path[0],0)),Vector((*path[1],0));d=b-a;left=Vector((-d.y,d.x,0))
    return path if left.dot(Vector((*inside,0))-a)>0 else list(reversed(path))

def bulwark(name,path,z,height,inside,lip=.30,flare=.13,t=.05,material='naval',closed=False):
    """Splinter bulwark with an outward-flared upper strake, one swept 6-point section.

    `path` is the outer face at deck level (authoring plane); `inside` is a point on
    the protected side. The upright plate rises height-lip, then the lip leans out by
    `flare`; the section is closed, so the plate has real thickness."""
    path=inward(path,inside);n=len(path)
    outer=path;inner=_offset_path(path,t,closed);lipo=_offset_path(path,-flare,closed);lipi=_offset_path(path,t-flare,closed)
    h0=height-lip
    rings=[[(x,y,z) for x,y in outer],[(x,y,z+h0) for x,y in outer],[(x,y,z+height) for x,y in lipo],
           [(x,y,z+height) for x,y in lipi],[(x,y,z+h0) for x,y in inner],[(x,y,z) for x,y in inner]]
    vv=[p for ring in rings for p in ring];ff=[]
    for i in range(n if closed else n-1):
        j=(i+1)%n
        for k in range(6):
            q=(k+1)%6;ff.append((k*n+i,k*n+j,q*n+j,q*n+i))
    if not closed:
        ff.append(tuple(k*n for k in reversed(range(6))));ff.append(tuple(k*n+n-1 for k in range(6)))
    return mesh(name,vv,ff,material)

def bar(name,a,b,w,h,material='naval'):
    """Straight rectangular member between two authoring points at the same height (beams, girders)."""
    a,b=Vector(a),Vector(b);d=b-a
    o=box(name,tuple((a+b)/2),(d.length,w,h),material);o.rotation_euler.z=math.atan2(d.y,d.x);return o

def post(name,x,y,z0,z1,w=.14,material='naval'):
    return box(name,(x,y,(z0+z1)/2),(w,w,z1-z0),material)

def ladder(name,a,b,width=.42,out=(1,0)):
    """Rung ladder from a to b (authoring points) with rungs across the wall normal `out`."""
    a,b=Vector(a),Vector(b);o=Vector((*out,0)).normalized();side=Vector((-o.y,o.x,0))*width/2
    for s in [-1,1]:rod(name+' stringer',a+side*s,b+side*s,.03,'edge',vertices=4)
    count=max(2,round((b-a).length/.32))
    for i in range(1,count):
        p=a.lerp(b,i/count);rod(name+' rung',p-side,p+side,.018,'edge',vertices=4)

def stair(name,foot,head,width=.70,rails=True):
    """Inclined ship's ladder: channel stringers, flat treads and handrails (authoring points)."""
    a,b=Vector(foot),Vector(head);d=b-a;flat=Vector((d.x,d.y,0));heading=math.atan2(d.y,d.x)
    side=Vector((-flat.y,flat.x,0)).normalized()*width/2
    for s in [-1,1]:bar(name+' stringer',a+side*s+Vector((0,0,.06)),b+side*s+Vector((0,0,.06)),.05,.16,'naval').rotation_euler.y=-math.atan2(d.z,flat.length)
    count=max(3,round(d.z/.24))
    for i in range(1,count):
        p=a.lerp(b,i/count);o=box(name+' tread',tuple(p),(.20,width-.08,.035),'roof');o.rotation_euler.z=heading
    if rails:
        for s in [-1,1]:
            tube_path(name+' handrail',[tuple(a+side*s*1.08+Vector((0,0,.9))),tuple(b+side*s*1.08+Vector((0,0,.9)))],.022,'naval',4)
            for t in [0.02,.98]:
                p=a.lerp(b,t)+side*s*1.08;rod(name+' rail stanchion',tuple(p),tuple(p+Vector((0,0,.9))),.02,'naval',vertices=4)

def scuttle(name,x,y,z,normal,r=.17):
    n=Vector((*normal,0)).normalized();p=Vector((x,y,z))
    rod(name+' rim',tuple(p-n*.01),tuple(p+n*.045),r,'edge',vertices=8)
    rod(name+' glass',tuple(p+n*.045),tuple(p+n*.052),r*.7,'glass',vertices=8)

def lamp(name,x,y,z,r,bearing=0,pedestal=.45):
    """Searchlight on a pedestal: `z` is the deck, `bearing` where the lens looks (radians about Z)."""
    before=set(scene.objects);h=z+pedestal+r+.08
    cyl(name+' pedestal',(x,y,z+pedestal/2),.11,pedestal,vertices=8,r2=.08)
    cyl(name+' training base',(x,y,z+pedestal+.03),.2,.06,'edge',vertices=8)
    for s in [-1,1]:box(name+' trunnion arm',(x,y+s*(r+.05),(z+pedestal+h)/2),(.1,.07,h-z-pedestal))
    rod(name+' drum',(x-r*.7,y,h),(x+r*.55,y,h),r,'naval',vertices=12,r2=r*.92)
    rod(name+' lens',(x+r*.55,y,h),(x+r*.6,y,h),r*.82,'glass',vertices=12)
    box(name+' ventilator',(x-r*.2,y,h+r+.04),(.16,.16,.1),'edge')
    _turned(before,x,y,z,bearing)

def pedestal_instrument(name,x,y,z,height=1.25,head=(.24,.24,.22),material='naval'):
    cyl(name+' base',(x,y,z+.03),.16,.06,'edge',vertices=8)
    cyl(name+' column',(x,y,z+height/2),.07,height,vertices=6)
    box(name+' head',(x,y,z+height+head[2]/2),head,material)

def net_basket(name,x,y,z,length,bearing):
    """Floater-net basket: a wire tray on low legs with the rolled net inside."""
    before=set(scene.objects)
    box(name+' tray',(x,y,z+.42),(length,.72,.08),'edge')
    for s in [-1,1]:box(name+' side',(x,y+s*.35,z+.58),(length,.04,.36),'edge')
    for s in [-1,1]:box(name+' end',(x+s*length/2,y,z+.58),(.04,.72,.36),'edge')
    rod(name+' rolled net',(x-length/2+.1,y,z+.66),(x+length/2-.1,y,z+.66),.27,'canvas',vertices=8)
    for s in [-1,1]:
        for e in [-1,1]:rod(name+' leg',(x+s*(length/2-.12),y+e*.3,z),(x+s*(length/2-.12),y+e*.3,z+.4),.025,'edge',vertices=4)
    _turned(before,x,y,z,bearing)

def periscope(name,x,y,z,r,height):
    cyl(name+' collar',(x,y,z+.14),r*1.45,.28,'naval',vertices=8)
    cyl(name+' tube',(x,y,z+.28+height/2),r,height,'naval',vertices=8)
    box(name+' head',(x+r*.2,y,z+.28+height+.12),(r*2.2,r*1.6,.24),'naval')
    box(name+' window',(x+r*1.32,y,z+.28+height+.12),(.02,r*1.1,.1),'glass')

structures={s['id']:s for s in D['structures']}

# ----------------------------------------------------------------------------------------------
# 03-level forward deckhouse (bridge-base): walls on the 02 deck, roof = 03 deck at 12.95 m.
ASSEMBLY='bridge-base';Z02=11.05;Z03=12.95
# The reference's conning tower foot is a sloped fairing: from the 02 deck edge at the bow it leans
# in to the tower itself at the 03 deck (sections at 10.0-12.8 m). The blueprint footprint is its
# mid-height section; the visible surface is lofted between the two measured rings.
import bmesh
fpp=structures['bridge-base']['footprint'];n=len(fpp);i=min(range(n),key=lambda k:fpp[k][1])
step=1 if fpp[(i+1)%n][0]>0 else -1;half=[]
while True:
    half.append(tuple(fpp[i]));i=(i+step)%n
    if fpp[i][0]<=1e-6:half.append(tuple(fpp[i]));break
tail=[p for p in half if p[1]>-23.99]
rings=[]
for nose in [[(0,-26.3),(.96,-26.27),(1.92,-26.08),(2.44,-25.85),(2.9,-25.5),(3.06,-25.0),(3.3,-24.4)],
             [(0,-25.8),(.8,-25.74),(1.5,-25.52),(2.1,-25.25),(2.5,-24.95),(2.78,-24.4),(3.0,-24.2)]]:
    h=nose+tail;rings.append(h+[(-x,z) for x,z in reversed(h) if x>1e-6])
m=len(rings[0]);vv=[(-z,-x,zz) for ring,zz in zip(rings,[Z02,Z03]) for x,z in ring]
ff=[tuple(reversed(range(m))),tuple(range(m,2*m))]+[(k,(k+1)%m,(k+1)%m+m,k+m) for k in range(m)]
obj=next(o for o in scene.objects if o.get('nodeId')=='bridge-base.surface')
data=bpy.data.meshes.new('bridge-base sloped conning foot');data.from_pydata(vv,[],ff);data.update()
bm=bmesh.new();bm.from_mesh(data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(data);bm.free()
for key in ['naval','roof']:data.materials.append(materials[key])
for face in data.polygons:face.material_index=1 if face.normal.z>.8 else 0
obj.data=data
for s in [1,-1]:
    # Guard rails along the open 03 deck edges: the bow diagonals and outboard sides, then the after part.
    inset=lambda pts:[A(s*(x-.14),z) for x,z in pts]
    rail('03 deck guard rail',inset([(3.9,-23.86),(6.9,-18.66),(7.5,-17.66),(7.5,-14.62)]),Z03,.95,1.8)
    rail('03 deck guard rail',inset([(7.5,-13.72),(6.72,-13.72)]),Z03,.95,1.8)
    # Inclined ladder from the 02 deck up the outboard wall to the 03 deck (reference, abreast turret 2's arc).
    stair('02 deck ladder',P(s*7.92,Z02,-16.25),P(s*7.92,Z03,-14.15),.62)
    # (the after rail stops short of the 20 mm position on the deck edge at z +2.73)
    rail('03 deck guard rail',inset([(7.47,-4.3),(7.5,-3.68),(7.6,-3.1),(7.63,1.1)]),Z03,.95,1.8)
    # Diagonal forward faces: scuttles and a ventilation louvre.
    a,b=(s*3.82,-23.98),(s*6.9,-18.72);n=N(s*5.26,-3.08)
    for t in [.2,.43]:
        x,z=lerp2(a,b,t);scuttle('03 deckhouse scuttle',*A(x,z),Z02+1.25,n)
    x,z=lerp2(a,b,.72);louvre('03 deckhouse louvre',*A(x,z),Z02+1.1,n,.9,.62)
    # Outboard side: a watertight door, scuttles and a fire-hose reel.
    door('03 deckhouse door',*A(s*7.5,-15.1),Z02,N(s,0),.66,1.62)
    for z in [-16.8,-14.0]:scuttle('03 deckhouse scuttle',*A(s*7.5,z),Z02+1.25,N(s,0))
    # After part, abreast the tower and forward funnel.
    door('03 deckhouse door',*A(s*7.62,-.6),Z02,N(s,0),.66,1.62)
    for z in [-2.6,.6]:scuttle('03 deckhouse scuttle',*A(s*(7.6 if z<0 else 7.65),z),Z02+1.25,N(s,0))
    hose_reel('03 deck hose reel',*A(s*6.95,-1.7),Z03,math.pi/2*s)
    locker('03 deck ready locker',*A(s*6.95,.5),Z03,(1.3,.62,.72),0)
    mushroom_vent('03 deck mushroom vent',*A(s*6.95,-.9),Z03,.24,.42)
    tube_path('03 deckhouse fire main riser',[P(s*7.7,Z02+.05,-1.27),P(s*7.7,Z03-.25,-1.27),P(s*7.4,Z03+.12,-1.27),P(s*7.1,Z03+.12,-1.27)],.05,'naval',6)
    cyl('Fire main hydrant',P(s*7.1,Z03+.3,-1.27),.08,.36,'naval',vertices=6)
    # Flag bag abaft the bridge, its signal lamp, and fire-fighting gear on the wall below.
    x0,x1=3.72,7.15;x,y=A(s*(x0+x1)/2,-3.4)
    box('Flag bag',(x,y,Z03+.5),(.92,x1-x0,1.0),'naval')
    o=box('Flag bag hood',(x-.12,y,Z03+1.12),(.78,x1-x0+.06,.08),'canvas');o.rotation_euler.x=0;o.rotation_euler.y=.35
    for xx in [x0+.5,(x0+x1)/2,x1-.5]:box('Flag bag divider',P(s*xx,Z03+.5,-2.93),(.04,.06,1.0),'edge')
    bar('Signal lamp bracket',P(s*7.1,13.86,-3.0),P(s*7.62,13.86,-2.8),.06,.06,'edge')
    cyl('Signal lamp',P(s*7.62,14.09,-2.8),.17,.4,'naval',vertices=8)
    box('Fire hose rack',P(s*7.61,12.16,-3.32),(.5,.1,.78),'canvas')
    for dz in [-.2,.2]:box('Hose rack bracket',P(s*7.6,12.58,-3.32+dz),(.05,.1,.06),'edge')
    cyl('Fire extinguisher',P(s*7.6,Z02+.3,-3.82),.09,.55,'white',vertices=8);box('Extinguisher strap',P(s*7.57,Z02+.42,-3.82),(.22,.05,.05),'edge')
    mushroom_vent('03 deck mushroom vent',*A(s*6.9,-16.9),Z03,.26,.46)
# Rung ladder up the conning tower's sloped foot from the 02 deck and on up the tower face,
# beside a cable trunk running up to the navigation bridge.
ladder('Conning foot ladder',P(.95,Z02,-26.38),P(.95,Z03,-25.8),.42,(1,0))
ladder('Conning tower ladder',P(.95,Z03,-25.8),P(.95,14.9,-25.8),.42,(1,0))
tube_path('Conning tower cable trunk',[P(-.55,Z02+.02,-26.4),P(-.55,Z03,-25.86),P(-.55,15.1,-25.86)],.07,'naval',6)

# ----------------------------------------------------------------------------------------------
# Bridge house and conning tower on the 03 deck (bridge-lower), roof = gallery deck at 15.2 m.
ASSEMBLY='bridge-lower';Z15=15.2
for s in [1,-1]:
    door('Bridge house door',*A(s*3.02,-17.75),Z03,N(s,0),.72,1.78)
    for z in [-12.6,-15.0,-16.3,-19.2]:scuttle('Bridge house scuttle',*A(s*3.02,z),Z03+1.45,N(s,0))
    # Signal lamps on brackets off the after faces of the conning tower cheeks.
    bar('Cheek signal lamp bracket',P(s*4.55,14.05,-20.3),P(s*4.84,14.05,-19.64),.07,.07,'edge')
    cyl('Cheek signal lamp',P(s*4.84,14.28,-19.64),.17,.36,'naval',vertices=8)
    # 03-deck fittings under the gallery: 600 mm searchlight, pelorus, ready-use boxes, floater nets.
    lamp('600 mm searchlight',*A(s*6.84,-15.4),Z03,.30,-s*math.pi/2,.55)
    pedestal_instrument('03 deck pelorus',*A(s*5.52,-17.9),Z03,1.18,(.3,.3,.26))
    locker('Ready-use box',*A(s*6.74,-14.05),Z03,(.31,.69,.40),0)
    net_basket('Floater net basket',*A(s*5.79,-19.0),Z03,2.06,math.atan2(-3.0*s,-5.24))
locker('Long ammunition box',*A(-3.28,-15.75),Z03,(2.7,.5,.5),0)
for x in [-1.3,1.3]:door('Bridge house after door',*A(x,-11.62),Z03,N(0,1),.72,1.78)

# ----------------------------------------------------------------------------------------------
# 15.2 m gallery deck (bridge-gallery): flared splinter bulwark, fascia, pillars, ladders.
ASSEMBLY='bridge-gallery'
for s in [1,-1]:
    edge=[(5.42,-18.0),(5.43,-17.98),(6.34,-14.72),(6.34,-11.16),(6.48,-10.95),(6.84,-10.78),(7.1,-10.44),(7.2,-8.3),(7.16,-7.9),(5.2,-7.9)]
    bulwark('Gallery splinter bulwark',[A(s*x,z) for x,z in edge],Z15,1.35,A(0,-14))
    rail('Gallery after rail',[A(s*5.1,-7.98),A(s*2.62,-7.98)],Z15,.95,1.3)
    # The deep fascia under the gallery edge where no 5-inch mount trains beneath it.
    shell_wall('Gallery fascia',inward([A(s*x,z) for x,z in [(4.8,-20.4),(6.34,-14.72),(6.34,-12.3)]],A(0,-14)),14.72,.42,.05,coping=0)
    for z in [-18.4,-15.9,-12.9]:
        x=6.34 if z>-14.72 else 4.8+(6.34-4.8)*(z+20.4)/5.68
        post('Gallery pillar',*A(s*(x-.32),z),Z03,15.14)
    # Beams under the forward overhang of the navigation bridge.
    for x in [.55,1.65]:bar('Overhang beam',P(s*x,14.98,-25.4 if x<1 else -24.9),P(s*x,14.98,-27.24),.12,.3)
    for z,xi,xo in [(-26.3,1.3,2.62),(-24.4,2.5,3.79),(-23.7,2.85,3.96)]:bar('Overhang beam',P(s*xi,14.98,z),P(s*(xo-.08),14.98,z),.12,.3)
    pedestal_instrument('Gallery repeater',*A(s*5.87,-13.9),Z15,1.1,(.3,.3,.28))
    # Transverse beams under the gallery where it overhangs the bridge house.
    for z in [-19.3,-17.9,-16.4,-14.9,-12.9]:
        xo=6.34 if z>-14.72 else 4.74+(6.34-4.74)*(z+20.52)/5.8
        bar('Gallery deck beam',P(s*3.03,14.98,z),P(s*(xo-.06),14.98,z),.12,.3)
    # Drain pipes from the gallery scuppers down the bridge house.
    tube_path('Gallery drain pipe',[P(s*3.1,15.1,-18.5),P(s*3.1,13.4,-18.5),P(s*3.1,13.1,-18.62),P(s*3.1,Z03+.02,-18.62)],.045,'naval',6)
    box('Running light screen',P(s*7.22,15.55,-8.8),(1.2,.06,.42))
    box('Running light',P(s*7.29,15.5,-8.4),(.26,.1,.22),'glass')
    # Ladder from the 03 deck up through a gallery hatch, then an inclined ladder to the open bridge.
    stair('Gallery hatch ladder',P(s*3.62,Z03,-14.35),P(s*3.62,Z15,-13.12),.62,rails=False)
    shell_wall('Gallery hatch coaming',[A(s*3.2,-12.95),A(s*4.05,-12.95),A(s*4.05,-13.95),A(s*3.2,-13.95)],Z15,.12,.05,True,coping=0)
    rail('Gallery hatch rail',[A(s*4.08,-13.9),A(s*4.08,-12.92),A(s*3.2,-12.92)],Z15,.95,1.0)
    stair('Open bridge ladder',P(s*3.5,Z15,-14.55),P(s*3.5,17.55,-16.35),.62)
    platform('Open bridge ladder landing',[A(s*3.0,-16.15),A(s*3.92,-16.15),A(s*3.92,-16.95),A(s*3.0,-16.95)],17.55,.08,'roof')
    knee('Landing knee',P(s*3.85,17.47,-16.55),P(s*3.03,17.47,-16.55),.7)

# ----------------------------------------------------------------------------------------------
# Navigation bridge and chart house (bridge-wing), the open bridge on its roof at 17.55 m.
ASSEMBLY='bridge-wing';Z17=17.55
outline=[(-4.12,-17.3),(-5.42,-18.0),(-4.94,-19.8),(-3.66,-24.92),(-2.28,-27.34),(2.28,-27.34),(3.66,-24.92),(4.94,-19.8),(5.42,-18.0),(4.12,-17.3)]
# The bulwark stands higher across the bridge front (18.91 m) than along the sides (18.53 m).
for s in [1,-1]:
    bulwark('Open bridge splinter bulwark',[A(s*x,z) for x,z in [(2.74,-26.54),(3.66,-24.92),(4.94,-19.8),(5.42,-18.0),(4.12,-17.3)]],Z17,.98,A(0,-22),lip=.26,flare=.10)
bulwark('Open bridge front windscreen',[A(x,z) for x,z in [(-2.8,-26.44),(-2.28,-27.34),(2.28,-27.34),(2.8,-26.44)]],Z17,1.36,A(0,-22),lip=.34,flare=.12)
# Drip moulding along the open-bridge deck line.
edge=inward([A(x,z) for x,z in outline[1:-1]],A(0,-22))
tube_path('Bridge deck moulding',[(x,y,Z17-.05) for x,y in _offset_path(edge,-.03,False)],.03,'naval',4)
for s in [1,-1]:
    # Mk.51 director tub in the after corner of the open bridge (AD_5 / AD_6).
    tub_wall=[(4.12,-17.3),(3.94,-17.4),(3.66,-18.2),(3.62,-18.6),(3.88,-19.06),(4.6,-19.38),(4.74,-19.64)]
    shell_wall('Mk.51 tub splinter plating',inward([A(s*x,z) for x,z in tub_wall],A(s*4.6,-18.3)),Z17,.98)
    mk51('Mk.51 director',*A(s*4.46,-18.44),Z17,-s*math.pi/2)
    # Target designator in its bulwark pocket, emergency box, chart house door and scuttles.
    x,y=A(s*3.79,-22.0);cyl('Target designator column',(x,y,Z17+.5),.09,1.0,vertices=6)
    box('Target designator sight',(x,y,Z17+1.18),(.5,.26,.3));box('Target designator window',(x+.26,y,Z17+1.2),(.02,.18,.1),'glass')
    for dy in [-.1,.1]:rod('Target designator binocular',(x+.05,y+dy,Z17+1.4),(x+.3,y+dy,Z17+1.4),.045,'edge',vertices=6)
    box('Emergency box',P(s*4.64,18.2,-19.74),(.26,.44,.3),'naval')
    a,b=(s*5.42,-18.0),(s*3.16,-16.86);x,z=lerp2(a,b,.5)
    door('Navigation bridge after door',*A(x,z),Z15,N(s*1.14,2.26),.72,1.78)
    for z in [-13.4,-15.2,-16.2]:scuttle('Chart house scuttle',*A(s*3.02,z),Z15+1.45,N(s,0))
    rail('Chart house roof rail',[A(s*2.9,-12.62),A(s*2.9,-16.1)],Z17,.95,1.2)
# Bridge instruments on the walkway ahead of the conning tower, and MC boxes on the bulwark.
pedestal_instrument('Open bridge pelorus',*A(0,-26.95),Z17,1.5,(.34,.34,.3))
for x in [-.67,.8]:pedestal_instrument('Bridge indicator',*A(x,-27.0),Z17,.98,(.3,.2,.28))
for x in [1.0,1.5,-1.9]:box('MC box',P(x,18.62,-27.24),(.12,.42,.36),'naval')
box('Bridge electrical panel',P(-2.35,18.05,-26.84),(.2,.44,.6),'naval')

# ----------------------------------------------------------------------------------------------
# Conning tower top (conning-top): periscopes and the Mk.27 radar stand on the 19.3 m roof.
ASSEMBLY='conning-top';Z19=19.3
periscope('Main periscope',*A(0,-24.29),Z19,.26,.62)
for x,z in [(-1.39,-24.10),(1.39,-24.10),(-1.62,-23.18),(1.62,-23.18)]:periscope('Periscope',*A(x,z),Z19,.13,.18)
x,y=A(0,-24.29)
for a in range(4):
    c,sn=math.cos(a*math.pi/2+math.pi/4),math.sin(a*math.pi/2+math.pi/4);t=(-sn*.025,c*.025)
    vv=[(x+c*r+e*t[0],y+sn*r+e*t[1],Z19+h) for e in [-1,1] for r,h in [(.3,0),(.72,0),(.3,.42)]]
    mesh('Periscope gusset',vv,[(0,1,2),(5,4,3),(0,3,4,1),(1,4,5,2),(2,5,3,0)],'naval')
box('Mk.27 radar stand',P(0,(Z19+20.47)/2,-22.62),(1.04,2.26,20.47-Z19))
x,y,z=P(0,20.47,-22.62)
cyl('Mk.27 pedestal',(x,y,z+.2),.14,.4,vertices=8)
for s in [-1,1]:box('Mk.27 yoke',(x,y+s*.3,z+.6),(.1,.06,.44),'edge')
rod('Mk.27 dish',(x-.06,y,z+.7),(x+.12,y,z+.7),.1,'naval',vertices=12,r2=.36)
rod('Mk.27 feed',(x+.12,y,z+.7),(x+.4,y,z+.7),.02,'edge',vertices=4)
for x,z in [(-1.14,-20.27),(1.14,-20.27)]:cyl('Aerial insulator',P(x,Z19+.18,z),.07,.36,'white',vertices=6)

# ----------------------------------------------------------------------------------------------
# Mk.37 barbette (bridge-director-platform), its ladders and ledge, and the forward searchlight.
ASSEMBLY='bridge-director-platform';cz=-16.98;R=1.39;Z20=20.652
for a in [2.35,-2.35]:
    x,y=A(R*math.sin(a),cz-R*math.cos(a));o=(x-A(0,cz)[0],y-A(0,cz)[1])
    ladder('Director barbette ladder',(x+o[0]*.08,y+o[1]*.08,Z17+.1),(x+o[0]*.08,y+o[1]*.08,Z20-.05),.42,o)
tube_path('Director barbette ledge rail',[P((R+.28)*math.sin(i*math.tau/16),19.55,cz-(R+.28)*math.cos(i*math.tau/16)) for i in range(16)],.024,'naval',4,True)
for i in range(4):
    a=i*math.tau/4+math.pi/4
    rod('Ledge rail bracket',P(R*math.sin(a),19.55,cz-R*math.cos(a)),P((R+.28)*math.sin(a),19.55,cz-(R+.28)*math.cos(a)),.02,'naval',vertices=4)
ASSEMBLY='bridge-wing'
sx,sz=0,-20.2;x,y=A(sx,sz)
cyl('Searchlight column',(x,y,(Z17+19.26)/2),.15,19.26-Z17,vertices=8)
platform('Searchlight platform',circle(x,y,1.15,12),19.38,.12,'roof')
bulwark('Searchlight splinter shield',circle(x,y,1.2,8,-math.pi*.62,math.pi*.62),19.38,.85,(x,y),lip=.45,flare=.32)
for s in [1,-1]:
    rod('Searchlight platform strut',P(s*.5,Z17,-19.4),P(s*.55,19.26,-20.0),.05,'naval',vertices=6)
    bar('Searchlight platform bracket',P(s*.4,19.2,-18.3),P(s*.4,19.2,-19.2),.1,.2)
searchlight('900 mm searchlight',x,y,19.38,.5)
ladder('Searchlight platform ladder',P(0,Z17,-18.86),P(0,19.9,-18.86),.4,N(0,1))

# ----------------------------------------------------------------------------------------------
# Mk.57 pedestal and its two director tubs at 19.64 m (fwd-mk57-pedestal).
ASSEMBLY='fwd-mk57-pedestal';Z57=19.64
half=[(.2,-13.74),(.76,-13.42),(1.0,-13.26),(2.16,-13.26),(2.48,-13.18),(2.9,-12.88),(3.22,-12.1),(2.47,-11.56),(2.04,-10.66),(1.44,-10.66),(1.16,-10.38)]
top=[A(x,z) for x,z in half]+[A(-x,z) for x,z in reversed(half)]
platform('Mk.57 platform',top,Z57,.12,'roof')
bulwark('Mk.57 tub splinter plating',[A(x,z) for x,z in [(1.16,-10.38),(1.44,-10.66),(2.04,-10.66),(2.47,-11.56),(3.22,-12.1),(2.9,-12.88),(2.48,-13.18),(2.16,-13.26),(1.0,-13.26),(.76,-13.42),(.2,-13.74),
    (-.2,-13.74),(-.76,-13.42),(-1.0,-13.26),(-2.16,-13.26),(-2.48,-13.18),(-2.9,-12.88),(-3.22,-12.1),(-2.47,-11.56),(-2.04,-10.66),(-1.44,-10.66),(-1.16,-10.38)]],Z57,.98,A(0,-12),lip=.2,flare=.06)
for s in [1,-1]:
    mk57('Mk.57 director',*A(s*1.96,-12.34),Z57,-s*math.pi/2)
    for z,xo in [(-11.0,2.1),(-12.9,2.6)]:knee('Mk.57 platform knee',P(s*xo,Z57-.12,z),P(s*1.22,Z57-.12,z),.9)
    ladder('Mk.57 pedestal ladder',P(s*1.27,Z17+.05,-9.9),P(s*1.27,Z57+.9,-9.9),.4,N(s,0))
rail('Mk.57 platform after rail',[A(-.95,-10.46),A(.95,-10.46)],Z57,.95,1.0)
for s in [1,-1]:mushroom_vent('Chart house roof vent',*A(s*1.75,-14.45),Z17,.26,.46)
x,y=A(0,-11.1)
rod('Direction finder mast',(x,y,Z57),(x,y,20.35),.035,'naval',vertices=6)
tube_path('Direction finder loop',[(x,y+.28*math.cos(i*math.tau/10),20.62+.28*math.sin(i*math.tau/10)) for i in range(10)],.025,'edge',4,True)

# ----------------------------------------------------------------------------------------------
# 40 mm bridge tubs (bridge-aa-*-platform): D-shaped floors cantilevered from the chart house,
# 1.37 m splinter plating, floor girders and two posts down to the gallery deck.
for s,id,mount_id in [(1,'bridge-aa-starboard-platform','bofors-bridge-starboard'),(-1,'bridge-aa-port-platform','bofors-bridge-port')]:
    ASSEMBLY=id;Z18=18.17
    ring=[(2.3,-11.3),(3.16,-12.18),(3.84,-12.46),(4.6,-12.58),(5.88,-12.34),(6.44,-12.02),(7.18,-11.4),(7.58,-10.6),(7.78,-9.92),(7.74,-9.0),(7.58,-8.44),(6.82,-7.28),(6.08,-6.78),(5.36,-6.54),(3.4,-6.45),(2.55,-6.45)]
    # The plating hangs below the floor as a skirt round the girders (reference beam view), except
    # on the outboard arc, which the forward 5-inch barrels pass under at high elevation.
    shell_wall('40 mm tub splinter plating',inward([A(s*x,z) for x,z in ring],A(s*5.1,-9.4)),17.98,1.56,.055)
    for arc in [ring[:6]+[(7.0,-11.55)],[(6.9,-7.35)]+ring[11:]]:
        shell_wall('40 mm tub skirt',inward([A(s*x,z) for x,z in arc],A(s*5.1,-9.4)),17.6,.38,.055,coping=0)
    for zz in [(-8.2,-9.35),(-10.45,-11.3)]:
        shell_wall('40 mm tub inboard plating',inward([A(s*2.33,zz[0]),A(s*2.33,zz[1])],A(s*5.1,-9.4)),Z18,1.37,.055)
    box('Tub access step',P(s*2.1,Z17+.155,-9.9),(.8,.36,.31),'naval')
    for z in [-8.24,-10.8]:
        bar('40 mm tub girder',P(s*2.55,17.83,z),P(s*6.3,17.83,z),.14,.3)
        post('40 mm tub post',*A(s*6.2,z),Z15,17.62)
    box('Emergency box',P(s*4.47,19.2,-6.63),(.2,.4,.3),'naval')
    x,y,zz=P(s*7.86,18.55,-9.46)
    box('Fighting light box',(x,y,zz),(.34,.12,.62),'naval')
    for dz in [-.2,0,.2]:rod('Fighting light',(x,y-s*.06,zz+dz),(x,y-s*.1,zz+dz),.07,'glass',vertices=6)
    AA_INSTALLED.add(mount_id)

# ----------------------------------------------------------------------------------------------
# Mk.37 forward director on its barbette (AD_7); the barbette is the blueprint structure, so no
# extra round foundation is added.
COL=collections['Masts and directors'];ASSEMBLY='director-secondary-forward'
director_details(next(m for m in D['modules'] if m['id']=='director-secondary-forward'),Z20)
COL=collections['Superstructure']
