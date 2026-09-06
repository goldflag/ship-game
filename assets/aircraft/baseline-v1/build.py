"""Original parametric aircraft exteriors. Run through Blender MCP or aircraft:build.
Authoring: meters, +X nose, +Y port, +Z up. No third-party geometry/textures.
"""
import bpy
import math
import json
import os
import hashlib
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(os.environ.get('AIRCRAFT_ROOT', Path(__file__).resolve().parents[2]))
CATALOG = ROOT / 'assets/aircraft/catalog.json'
RECIPE = ROOT / 'assets/aircraft/build.py'
CAT = json.loads(CATALOG.read_text())
ID = os.environ['AIRCRAFT_ID']
SPEC = next(a for a in CAT['aircraft'] if a['id'] == ID)
G = SPEC['geometry']
OUT = Path(os.environ.get('AIRCRAFT_OUTPUT', ROOT / 'assets/aircraft' / ID / 'generated'))
OUT.mkdir(parents=True, exist_ok=True)
HASH = hashlib.sha256(CATALOG.read_bytes() + b'\0' + RECIPE.read_bytes()).hexdigest()
L, SPAN, R = SPEC['length'], SPEC['wingspan'], G['bodyRadius']

# A new scene preserves any interactive project already open in Blender.
scene = bpy.data.scenes.new('Aircraft ' + ID)
if bpy.context.window:
    bpy.context.window.scene = scene
scene.unit_settings.system = 'METRIC'
scene['aircraftId'] = ID
scene['contentHash'] = HASH
scene['schemaVersion'] = 1
scene['coordinateContract'] = '+X nose, +Y port, +Z up; exported +X starboard, +Y up, -Z nose'
collection = bpy.data.collections.new(ID)
scene.collection.children.link(collection)

def material(name, rgb, metal=0.0, rough=.48):
    m = bpy.data.materials.new(ID + '.' + name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*rgb, 1)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    return m

SCHEMES = {
    'japan-early': ((.53,.57,.43),(.64,.65,.52),(.40,.44,.34)),
    'japan-green': ((.055,.16,.105),(.59,.63,.54),(.08,.20,.135)),
    'us-early': ((.235,.35,.405),(.65,.69,.69),(.235,.35,.405)),
    'us-tricolor': ((.045,.10,.16),(.76,.79,.77),(.25,.37,.46)),
    'us-late': ((.025,.065,.11),(.035,.08,.13),(.025,.065,.11)),
}
upper, lower, side = SCHEMES[G['scheme']]
M = {
    'upper': material('airframe upper', upper),
    'lower': material('airframe underside', lower),
    'side': material('airframe sides', side),
    'frame': material('canopy frames', upper, .12),
    'glass': material('smoked blue canopy', (.075,.19,.235), .4, .17),
    'dark': material('cowling and anti glare', (.022,.028,.03), .12, .5),
    'black': material('rubber', (.012,.016,.020), 0, .78),
    'metal': material('brushed metal', (.34,.38,.4), .7, .27),
    'engine': material('engine steel', (.14,.17,.18), .6, .5),
    'line': material('panel seams', tuple(c*.55 for c in upper), .08, .65),
    'red': material('hinomaru red', (.59,.027,.025), 0, .6),
    'white': material('insignia white', (.86,.87,.8), 0, .55),
    'blue': material('insignia blue', (.014,.035,.10), 0, .55),
    'yellow': material('identification yellow', (.92,.57,.06), 0, .58),
    'brake': material('dive brake interior', (.38,.065,.045), 0, .65),
}

def empty(name, pos=(0,0,0), parent=None, **props):
    o = bpy.data.objects.new(name, None)
    collection.objects.link(o)
    o.location = pos
    o.empty_display_type = 'PLAIN_AXES'
    o.empty_display_size = .25
    o['nodeId'] = name
    for k,v in props.items(): o[k]=v
    if parent:
        o.parent = parent
        o.location = Vector(pos) - parent.location
    return o

root = empty('aircraft.root')
root['aircraftId']=ID
root['assemblyId']='airframe'
root['visualOnly']=True
root['restPose']='level flight attitude, landing gear extended'

def mesh(name, verts, faces, mat='upper', parent=None, smooth=True):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    o = bpy.data.objects.new(name, data)
    collection.objects.link(o)
    o.data.materials.append(M[mat] if isinstance(mat,str) else mat)
    p = parent or root
    o.parent = p
    o.location = -p.location
    o['assemblyId'] = p.get('nodeId','airframe')
    for f in data.polygons: f.use_smooth = smooth
    return o

def curve(name, points, radius=.012, mat='line', parent=None):
    # Tubular seam geometry exports without external textures.
    pts=[Vector(p) for p in points]
    verts=[]; faces=[]; n=6
    for i,p in enumerate(pts):
        d=(pts[min(i+1,len(pts)-1)]-pts[max(i-1,0)]).normalized()
        b=d.cross(Vector((0,0,1)))
        if b.length<.01:b=d.cross(Vector((0,1,0)))
        b.normalize(); c=d.cross(b).normalized()
        for j in range(n):verts.append(p+radius*(b*math.cos(j*2*math.pi/n)+c*math.sin(j*2*math.pi/n)))
    for i in range(len(pts)-1):
        for j in range(n):faces.append((i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j))
    return mesh(name,verts,faces,mat,parent)

def ellipsoid(name, center, scale, mat='upper', parent=None, segments=24, rings=12):
    v=[]; f=[]
    for i in range(rings+1):
        lat=math.pi*i/rings
        for j in range(segments):
            a=2*math.pi*j/segments
            v.append((center[0]+scale[0]*math.cos(lat), center[1]+scale[1]*math.sin(lat)*math.cos(a), center[2]+scale[2]*math.sin(lat)*math.sin(a)))
    for i in range(rings):
        for j in range(segments):f.append((i*segments+j,i*segments+(j+1)%segments,(i+1)*segments+(j+1)%segments,(i+1)*segments+j))
    return mesh(name,v,f,mat,parent)

def cylinder(name,a,b,r,mat='metal',parent=None,n=16,r2=None):
    a=Vector(a);b=Vector(b);d=(b-a).normalized()
    u=d.cross(Vector((0,0,1)))
    if u.length<.01:u=d.cross(Vector((0,1,0)))
    u.normalize();w=d.cross(u).normalized()
    v=[]
    for p,rad in [(a,r),(b,r if r2 is None else r2)]:
        for j in range(n):v.append(p+rad*(u*math.cos(j*math.tau/n)+w*math.sin(j*math.tau/n)))
    f=[tuple(reversed(range(n))),tuple(range(n,n*2))]
    for j in range(n):f.append((j,(j+1)%n,(j+1)%n+n,j+n))
    return mesh(name,v,f,mat,parent)

# Body: independent station loft with a raised tail cone and a shaped engine shoulder.
inline=G.get('engine')=='inline'
stations=[(-.5,.018,.22),(-.46,.16,.22),(-.40,.30,.18),(-.32,.46,.12),(-.22,.65,.055),(-.12,.83,.02),(0,.95,0),(.10,1.0,0),(.20,1.0,0),(.29,.97,0),(.36,.87,0),(.415,.76,.01),(.437,.70,.015)]
if inline:stations[-3:]=[(.36,.65,-.025),(.42,.40,-.015),(.461,.23,0)]
verts=[];faces=[];N=48
for x,r,z in stations:
    for j in range(N):
        a=math.tau*j/N
        verts.append((x*L,math.cos(a)*r*R,z+math.sin(a)*r*R*(1.15 if G.get('turret') else 1.04)))
for i in range(len(stations)-1):
    for j in range(N):faces.append((i*N+j,i*N+(j+1)%N,(i+1)*N+(j+1)%N,(i+1)*N+j))
faces.extend([tuple(reversed(range(N))),tuple((len(stations)-1)*N+j for j in range(N))])
body=mesh('fuselage loft',verts,faces)
body.data.materials.append(M['lower']);body.data.materials.append(M['side'])
for p in body.data.polygons:
    z=sum(body.data.vertices[i].co.z for i in p.vertices)/len(p.vertices)
    p.material_index=1 if z<-.24*R else (2 if abs(z)<.52*R else 0)
# Fine rings suggest removable skin panels, omitting the hidden lower arc.
for sx,sr,sz in stations[2:-2:2]:
    curve('fuselage panel seam',[(sx*L,math.cos(a)*sr*R*1.004,sz+math.sin(a)*sr*R*1.045) for a in [math.pi*k/32 for k in range(33)]],.006)

noseX=.447*L
if not inline:
    cowmat='dark' if SPEC['nation']=='Japan' else 'upper'
    cylinder('radial cowling',(.335*L,0,0),(noseX,0,0),R*.99,cowmat,n=48,r2=R*.91)
    cylinder('engine recess',(noseX+.003,0,0),(noseX+.018,0,0),R*.79,'dark',n=48)
    for i in range(14):
        a=i*math.tau/14
        c=(noseX+.027,math.cos(a)*R*.54,math.sin(a)*R*.54)
        cylinder('radial cylinder',c,(c[0]+.025,c[1]*1.26,c[2]*1.26),R*.115,'engine',n=8)
        for k in range(3):
            rr=R*(.44+k*.085)
            cylinder('cooling fin',(noseX+.02,math.cos(a)*rr,math.sin(a)*rr),(noseX+.065,math.cos(a)*rr,math.sin(a)*rr),R*.12,'metal',n=8)
    for i in range(20):
        a=i*math.tau/20
        curve('cowl flap',[(.334*L,math.cos(a)*R,math.sin(a)*R),(.31*L,math.cos(a)*R*1.025,math.sin(a)*R*1.025)],.012,cowmat)
else:
    for s in [-1,1]:
        for i in range(6):
            x=.27*L+i*.145
            cylinder('inline exhaust',(x,s*R*.66,.14),(x-.10,s*R*.83,.12),.048,'engine',n=10)
    ellipsoid('radiator scoop',(.19*L,0,-R*.79),(.78,.36,.23),'lower')
if G.get('exhaustStacks'):
    for s in [-1,1]:
        for i in range(5):
            cylinder('individual exhaust',(.31*L-i*.10,s*R*.86,-.20),(.28*L-i*.10,s*R*1.06,-.23),.05,'engine',n=10)
if G.get('chinIntake'):
    ellipsoid('chin air intake',(.36*L,0,-.66*R),(.70,.47,.34),'upper')
    ellipsoid('intake mouth',(.424*L,0,-.70*R),(.027,.32,.17),'dark')

# Cambered airfoils, with separate outer ailerons. Each type has a distinct planform.
wx=G['wingX']; wz=G.get('wingZ',-.35*R); half=SPAN/2

def wing_at(t,u,s):
    rootC=G['wingRoot']; tipC=G['wingTip']; shape=G['wingShape']
    if shape=='elliptical':
        chord=rootC*math.sqrt(max(.002,1-t*t))
        center=wx-.12*t
    else:
        chord=rootC+(tipC-rootC)*t
        if t>.91 and shape!='clipped':chord*=math.sqrt(max(.004,1-((t-.91)/.095)**2))
        if t>.97 and shape=='clipped':chord*=1-.25*(t-.97)/.03
        center=wx-.38*t
    if shape=='gull':
        z=wz+(-.73*t/.34 if t<.34 else -.73+(t-.34)*1.33)
    else:z=wz+.31*t
    thickness=5*.115*chord*(.2969*math.sqrt(max(u,0))-.126*u-.3516*u*u+.2843*u**3-.1036*u**4)
    return (center+chord*(.5-u),s*half*t,z),max(.004,thickness)

def wing_piece(name,s,lo,hi,umin,umax,parent=None):
    v=[];f=[];ns=18;nc=14
    for layer in [-1,1]:
        for i in range(ns+1):
            t=lo+(hi-lo)*i/ns
            for j in range(nc+1):
                u=umin+(umax-umin)*(1-math.cos(math.pi*j/nc))/2
                p,h=wing_at(t,u,s);v.append((p[0],p[1],p[2]+layer*h))
    row=nc+1;count=(ns+1)*row
    for layer in [0,1]:
        for i in range(ns):
            for j in range(nc):
                k=layer*count+i*row+j;face=(k,k+1,k+row+1,k+row)
                f.append(face if (layer==1)==(s==1) else face[::-1])
    for i in range(ns):
        for j in [0,nc]:
            k=i*row+j;f.append((k,k+row,k+row+count,k+count))
    for i in [0,ns]:
        for j in range(nc):
            k=i*row+j;f.append((k,k+count,k+count+1,k+1))
    o=mesh(name,v,f,'upper',parent)
    o.data.materials.append(M['lower'])
    for p in o.data.polygons:p.material_index=1 if all(i<count for i in p.vertices) else 0
    return o

for s,sideName in [(1,'port'),(-1,'starboard')]:
    p,_=wing_at(.54,.745,s)
    joint=empty('control.aileron.'+sideName,p,root,axis='spanwise',limitDegrees=18)
    wing_piece('inner wing '+sideName,s,0,.52,0,1)
    wing_piece('outer wing '+sideName,s,.52,1,0,.745)
    wing_piece('aileron '+sideName,s,.52,.98,.752,1,joint)
    wing_piece('tip trailing '+sideName,s,.98,1,.745,1)
    # Selected skin seams and trailing-edge hinge line.
    for t in [.26,.52,.74,.9]:
        pts=[]
        for j in range(15):
            p,h=wing_at(t,.08+.86*j/14,s);pts.append((p[0],p[1],p[2]+h+.008))
        curve('wing skin seam',pts,.006)
    pts=[]
    for i in range(24):
        p,h=wing_at(.53+i*.44/23,.748,s);pts.append((p[0],p[1],p[2]+h+.008))
    curve('aileron hinge',pts,.009)
    # Root walkway.
    for t in [.12,.15,.18]:
        pts=[]
        for j in range(15):
            p,h=wing_at(t,.36+.53*j/14,s);pts.append((p[0],p[1],p[2]+h+.009))
        curve('non slip walkway',pts,.047,'dark')
    if G['scheme']=='japan-green':
        band=[];bandFaces=[]
        for i in range(25):
            t=.17+i*.286/24
            for u in [.018,.13]:
                p,h=wing_at(t,u,s);band.append((p[0],p[1],p[2]+h+.012))
        for i in range(24):bandFaces.append((i*2,i*2+1,i*2+3,i*2+2))
        mesh('yellow leading edge band',band,bandFaces,'yellow',smooth=False)
    if G.get('corrugated'):
        for t in [.21+i*.033 for i in range(22)]:
            pts=[]
            for j in range(14):
                p,h=wing_at(t,.1+.79*j/13,s);pts.append((p[0],p[1],p[2]+h+.003))
            curve('corrugated wing rib',pts,.011,'upper')
    # Visible gun barrel stubs and ejection panel accents; exterior only.
    if SPEC['role'] in ['Fighter','Fighter-bomber'] or G.get('turret'):
        for i in range(3 if ID.startswith(('f6f','f4f','f4u')) else 1):
            t=.31+i*.043;p,h=wing_at(t,.015,s)
            cylinder('wing gun muzzle',p,(p[0]+.18,p[1],p[2]),.026,'dark',n=10)

# Thin rounded horizontal tail and separate elevators.
tailX=-.365*L;tailZ=.25;tailHalf=G['tailSpan']/2

def tail_piece(name,s,front,back,parent=None):
    v=[];f=[];ns=16
    for layer in [-1,1]:
        for i in range(ns+1):
            t=i/ns;c=1.50*(1-.54*t)*math.sqrt(max(.045,1-t**4))
            cx=tailX-.28*t
            for u in [front,back]:v.append((cx+c*(.5-u),s*tailHalf*t,tailZ+layer*.045*(1-.8*t)))
    count=(ns+1)*2
    for layer in [0,1]:
        for i in range(ns):
            k=layer*count+i*2;f.append((k,k+1,k+3,k+2))
    for i in range(ns):
        for j in [0,1]:k=i*2+j;f.append((k,k+2,k+2+count,k+count))
    f.extend([(0,1,count+1,count),(count-2,count-1,count*2-1,count*2-2)])
    return mesh(name,v,f,'upper',parent)
for s,n in [(1,'port'),(-1,'starboard')]:
    tail_piece('tailplane '+n,s,0,.65)
    ej=empty('control.elevator.'+n,(tailX-.225,s*.12,tailZ),root,axis='spanwise',limitDegrees=22)
    tail_piece('elevator '+n,s,.66,1,ej)

finH=G['finHeight']; finBase=-.45*L
# Curved sampled fin silhouette, with Jill's recognisable leading-edge sweep.
outline=[(finBase+.95,.20),(finBase+.90,.50),(finBase+(1.32 if G.get('finForward') else .53),finH*.79),(finBase+(1.28 if G.get('finForward') else .26),finH),(finBase+(.54 if G.get('finForward') else .04),finH*1.035),(finBase+(.29 if G.get('finForward') else -.21),finH*.87),(finBase-.33,.27)]

def extrude_xz(name,poly,width,mat='upper',parent=None):
    v=[(x,y,z) for y in [-width/2,width/2] for x,z in poly];n=len(poly)
    f=[tuple(reversed(range(n))),tuple(range(n,n*2))]
    for i in range(n):f.append((i,(i+1)%n,(i+1)%n+n,i+n))
    return mesh(name,v,f,mat,parent,False)
# Rudder split follows a diagonal hinge; enough separation to inspect motion.
finHingeTop=finBase+(.65 if G.get('finForward') else .15)
finpoly=[outline[0],outline[1],outline[2],outline[3],(finHingeTop,finH*.99),(finBase+.12,.24)]
extrude_xz('vertical stabilizer',finpoly,.115)
rj=empty('control.rudder',(finBase+.12,0,.25),root,axis='up',limitDegrees=25)
extrude_xz('rudder',[(finBase+.105,.25),(finHingeTop-.015,finH*.99),outline[4],outline[5],outline[6]],.095,'upper',rj)

# Framed greenhouse canopy: the long bomber cabins have additional bays.
cl=G['canopyLength'];cx=G['canopyX'];ch=G['canopyHeight'];base=R*.81
bayCount=8 if cl>3 else 5
canopyStations=[]
for i in range(bayCount+1):
    t=i/bayCount;x=cx+cl*(.5-t)
    arch=(math.sin(math.pi*(.08+.84*t)))**.35
    if i in [0,bayCount]:arch*=.63
    canopyStations.append((x,R*.53*arch,base,ch*arch))
v=[];f=[];arcs=12
for x,w,z,h in canopyStations:
    for j in range(arcs+1):
        a=math.pi*j/arcs;v.append((x,w*math.cos(a),z+h*math.sin(a)))
for i in range(bayCount):
    for j in range(arcs):
        k=i*(arcs+1)+j;f.append((k,k+1,k+arcs+2,k+arcs+1))
f.extend([tuple(reversed(range(arcs+1))),tuple(bayCount*(arcs+1)+j for j in range(arcs+1))])
mesh('cockpit glazing',v,f,'glass',smooth=False)
for x,w,z,h in canopyStations:
    curve('canopy hoop',[(x,w*math.cos(math.pi*j/arcs),z+h*math.sin(math.pi*j/arcs)) for j in range(arcs+1)],.026,'frame')
for j in [0,3,6,9,12]:
    a=math.pi*j/arcs
    curve('canopy longeron',[(x,w*math.cos(a),z+h*math.sin(a)) for x,w,z,h in canopyStations],.023,'frame')
# Antenna mast, aerial, and aft gun position on multi-seat models.
mast=(cx-.35*cl,0,base+ch*.8)
curve('radio mast',[mast,(mast[0]-.12,0,mast[2]+.51)],.027,'dark')
curve('aerial wire',[(mast[0]-.12,0,mast[2]+.51),(finBase+.25,0,finH*.84)],.005,'dark')
if G.get('turret'):
    tj=empty('turret.yaw',(cx-cl*.66,0,base+.10),root,axis='up')
    ellipsoid('dorsal turret glazing',(cx-cl*.66,0,base+.11),(.61,.59,.55),'glass',tj)
    curve('turret arch',[(cx-cl*.66+.6*math.cos(math.pi*j/24),0,base+.11+.55*math.sin(math.pi*j/24)) for j in range(25)],.028,'frame',tj)
    cylinder('turret gun',(cx-cl*.66-.24,0,base+.38),(cx-cl*.66-1.23,0,base+.59),.037,'dark',tj)
elif cl>3:
    cylinder('rear defensive gun',(cx-cl*.42,0,base+.17),(cx-cl*.42-.80,0,base+.40),.029,'dark')

# Organic propeller blades, independent rotor and yellow tip segments.
prop=empty('propeller.spin',(.463*L,0,0),root,axis='forward',continuous=True)
pr=G.get('propRadius',min(1.90,SPAN*.128)); blades=G.get('propBlades',3)
cylinder('propeller hub',(.451*L,0,0),(.484*L,0,0),.16,'metal',prop,n=24)
for b in range(blades):
    a=b*math.tau/blades+.28
    v=[];f=[]
    shape=[(.14,.085),(.28,.13),(.50,.16),(.72,.145),(.91,.093),(1,.025)]
    for sideSign in [-1,1]:
        for t,width in shape:
            rr=pr*t
            for e in [-1,1]:
                yy=rr;zz=e*width+(t-.2)*.13
                v.append((.463*L+sideSign*.018+e*.065*(1-t),yy*math.cos(a)-zz*math.sin(a),yy*math.sin(a)+zz*math.cos(a)))
    count=len(shape)*2
    for layer in [0,1]:
        for i in range(len(shape)-1):
            k=layer*count+i*2;f.append((k,k+1,k+3,k+2))
    for i in range(len(shape)-1):
        for j in [0,1]:k=i*2+j;f.append((k,k+2,k+2+count,k+count))
    f.extend([(0,1,count+1,count),(count-2,count-1,count*2-1,count*2-2)])
    blade=mesh('propeller blade',v,f,'dark',prop)
    blade.data.materials.append(M['yellow'])
    for p in blade.data.polygons:
        rr=sum(math.hypot(blade.data.vertices[i].co.y,blade.data.vertices[i].co.z) for i in p.vertices)/len(p.vertices)
        if rr>pr*.89:p.material_index=1
if G.get('spinner'):
    # Truncated rear hemisphere ends at the declared nose datum.
    ellipsoid('spinner',(.471*L,0,0),(.029*L,.25,.25),'upper' if SPEC['nation']=='Japan' else 'metal',prop)
else:
    ellipsoid('propeller cap',(.483*L,0,0),(.017*L,.14,.14),'metal',prop)

# Landing gear (neutral flight attitude, extended; deck socket at main tyre tangent).
wheelZ=-max(pr+.16,R+1.12);wheelRadius=.29 if SPEC['role']=='Fighter' else .36
for s,n in [(1,'port'),(-1,'starboard')]:
    gy=(.69 if G.get('narrowGear') else (2.12 if G['wingShape']=='gull' else SPAN*.145))*s
    gx=wx+.37
    gearZ=wing_at(abs(gy)/half,.40,s)[0][2]
    mount=(gx,gy,gearZ)
    gj=empty('gear.'+n,mount,root,axis='forward',fixed=bool(G.get('fixedGear')))
    wheel=(gx+.17,gy,wheelZ+wheelRadius)
    cylinder('main oleo',mount,wheel,.067,'metal',gj)
    cylinder('gear brace',(gx-.45,gy*.62,gearZ),(wheel[0],wheel[1],wheel[2]+.18),.036,'engine',gj)
    cylinder('tyre',(wheel[0],gy-.115,wheel[2]),(wheel[0],gy+.115,wheel[2]),wheelRadius,'black',gj,n=32)
    for sy in [-1,1]:
        cylinder('wheel hub',(wheel[0],gy+sy*.118,wheel[2]),(wheel[0],gy+sy*.123,wheel[2]),wheelRadius*.50,'metal',gj,n=20)
    if G.get('fixedGear'):
        ellipsoid('fixed wheel spat',(wheel[0]+.015,gy,wheel[2]+.14),(.63,.245,.40),'upper',gj)
        extrude_xz('spat landing leg',[(gx-.22,wz),(gx+.16,wz),(gx+.40,wheel[2]+.18),(gx-.30,wheel[2]+.18)],.10,'upper',gj).location.y+=gy
    elif not G.get('narrowGear'):
        p=[(gx-.18,gy+s*.10,gearZ-.10),(gx+.22,gy+s*.10,gearZ-.10),(wheel[0]+.20,gy+s*.15,wheel[2]+.12),(wheel[0]-.18,gy+s*.15,wheel[2]+.12)]
        mesh('gear door',p,[(0,1,2,3)],'lower',gj,False)
tj=empty('gear.tail',(-.40*L,0,.15),root,axis='spanwise',fixed=bool(G.get('fixedGear')))
cylinder('tail oleo',(-.40*L,0,.15),(-.415*L,0,-.71),.045,'metal',tj)
cylinder('tail tyre',(-.415*L,-.09,-.78),(-.415*L,.09,-.78),.17,'black',tj,n=24)
hook=empty('arrestor.hook',(-.34*L,0,-.25),root,axis='spanwise')
curve('arrestor hook',[(-.34*L,0,-.25),(-.48*L,0,-.40),(-.486*L,0,-.52),(-.47*L,0,-.55)],.035,'metal',hook)
empty('socket.deck',(wx+.54,0,wheelZ),root)
empty('socket.payload',(-.03*L,0,-R*.95),root)
# Ordnance intentionally sockets only: a clean exterior library suitable for future loadouts.
if G.get('payload')=='internal':
    for s in [-1,1]:
        curve('bomb bay door seam',[(-.18*L,s*.23,-R*.99),(.12*L,s*.23,-R*1.075)],.012,'dark')
    curve('bay centerline',[(-.18*L,0,-R*1.035),(.12*L,0,-R*1.14)],.011,'dark')

# Geometric national markings conform to the actual wing, avoiding decal texture dependencies.
def patch(name, points, mat):
    return mesh(name,points,[tuple(range(len(points)))],mat,smooth=False)

def badge(center,U,V,r,nation,project=None,bars=False):
    c=Vector(center);U=Vector(U);V=Vector(V)
    def pts(coords,depth=0):
        out=[]
        for x,y in coords:
            if project:out.append(project(x,y,depth))
            else:out.append(c+U*x+V*y+U.cross(V)*depth)
        return out
    def filled(name,coords,mat,depth):
        # Subdivide in decal coordinates BEFORE projecting onto the curved skin.
        vv=[];ff=[];sub=6
        for j in range(len(coords)):
            a=coords[j];b=coords[(j+1)%len(coords)];lookup={}
            for u in range(sub+1):
                for v in range(sub+1-u):
                    lookup[u,v]=len(vv);vv.append((a[0]*u/sub+b[0]*v/sub,a[1]*u/sub+b[1]*v/sub))
            for u in range(sub):
                for v in range(sub-u):
                    ff.append((lookup[u,v],lookup[u+1,v],lookup[u,v+1]))
                    if u+v<sub-1:ff.append((lookup[u+1,v],lookup[u+1,v+1],lookup[u,v+1]))
        mesh(name,pts(vv,depth),ff,mat,smooth=False)
    if bars:
        filled('insignia blue bars',[(-r*1.72,-r*.40),(r*1.72,-r*.40),(r*1.72,r*.40),(-r*1.72,r*.40)],'blue',.004)
        filled('insignia white bars',[(-r*1.59,-r*.28),(r*1.59,-r*.28),(r*1.59,r*.28),(-r*1.59,r*.28)],'white',.012)
    # Concentric triangles conform to cambered skins; a single ngon cuts into them.
    disk=[(0,0)]
    for ring in range(1,7):
        disk.extend([(r*ring/6*math.cos(j*math.tau/64),r*ring/6*math.sin(j*math.tau/64)) for j in range(64)])
    faces=[(0,1+j,1+(j+1)%64) for j in range(64)]
    for ring in range(5):
        a=1+ring*64;b=a+64
        for j in range(64):faces.append((a+j,b+j,b+(j+1)%64,a+(j+1)%64))
    mesh('national roundel',pts(disk,.025),faces,'red' if nation=='Japan' else 'blue',smooth=False)
    if nation!='Japan':
        star=[]
        for j in range(10):
            a=math.pi/2+j*math.pi/5;rr=r*(.90 if j%2==0 else .35)
            star.append((rr*math.cos(a),rr*math.sin(a)))
        # Fan triangles avoid the concave ngon ambiguities of some glTF triangulators.
        filled('white star',star,'white',.042)

for s in [-1,1]:
    t=.72;center,h=wing_at(t,.43,s);rad=.46 if SPAN<13 else .57
    def project(x,y,depth,s=s,center=center):
        tt=abs(center[1]+y)/half
        front,_=wing_at(tt,0,s);back,_=wing_at(tt,1,s)
        xx=center[0]+x;u=(front[0]-xx)/max(.01,front[0]-back[0])
        p,hh=wing_at(tt,max(0,min(1,u)),s)
        return (xx,center[1]+y,p[2]+hh+.013+depth)
    if SPEC['nation']=='Japan' or G['scheme']=='us-early' or s==1:
        badge(center,(1,0,0),(0,1,0),rad,SPEC['nation'],lambda x,y,d: project(y,x,d),G['scheme'] in ['us-late','us-tricolor'])
    if SPEC['nation']=='Japan' or G['scheme']=='us-early' or s==-1:
        def underside_project(x,y,depth,s=s,center=center):
            tt=abs(center[1]+y)/half
            front,_=wing_at(tt,0,s);back,_=wing_at(tt,1,s)
            xx=center[0]+x;u=(front[0]-xx)/max(.01,front[0]-back[0])
            p,hh=wing_at(tt,max(0,min(1,u)),s)
            return (xx,center[1]+y,p[2]-hh-.013-depth)
        badge(center,(1,0,0),(0,-1,0),rad,SPEC['nation'],lambda x,y,d: underside_project(y,x,d),G['scheme'] in ['us-late','us-tricolor'])
    # Fuselage decals follow a conservative analytic radius over a short tail section.
    bx=-.245*L;br=R*.60
    def fuselage_project(x,y,depth,s=s,bx=bx):
        xx=bx+x
        for i in range(len(stations)-1):
            a,b=stations[i],stations[i+1]
            if a[0]*L<=xx<=b[0]*L:
                t=(xx/L-a[0])/(b[0]-a[0]);rr=(a[1]+t*(b[1]-a[1]))*R;zz=a[2]+t*(b[2]-a[2]);break
        else:rr=br;zz=.1
        z=.13+y;yy=math.sqrt(max(.01,rr*rr-(z-zz)**2/1.04**2))
        return (xx,s*(yy+.014+depth),z)
    badge((bx,s*br,.13),(1,0,0),(0,0,1),R*.42,SPEC['nation'],fuselage_project,G['scheme'] in ['us-late','us-tricolor'])

# Perforated dive brakes are real framed geometry with open holes (no false dot texture).
if G.get('diveBrakes'):
    for s,n in [(1,'port'),(-1,'starboard')]:
        dj=empty('diveBrake.'+n,(wx-G['wingRoot']*.36,s*SPAN*.17,wz),root,axis='spanwise',limitDegrees=45)
        # Narrow strips form a perforation grid just above the inner trailing edge.
        for i in range(15):
            t=.18+i*.019
            p,h=wing_at(t,.80,s);q,hq=wing_at(t,.965,s)
            curve('brake rib',[(p[0],p[1],p[2]+h+.025),(q[0],q[1],q[2]+hq+.025)],.018,'brake',dj)
        for u in [.80,.855,.91,.965]:
            pts=[]
            for i in range(15):
                p,h=wing_at(.18+i*.019,u,s);pts.append((p[0],p[1],p[2]+h+.025))
            curve('brake cross rib',pts,.020,'upper',dj)

# Consolidate static detail per rigid owner; never merge independent moving parts.
bpy.context.view_layer.update()
buckets={}
for o in list(collection.objects):
    if o.type=='MESH':buckets.setdefault(o.parent,[]).append(o)
for parent,objects in buckets.items():
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.join()
    joined=bpy.context.object;joined.name=parent.get('nodeId','airframe')+'.mesh';joined['assemblyId']=parent.get('nodeId','airframe')
# Recalculate all exterior normals consistently before export.
for o in list(collection.objects):
    if o.type=='MESH':
        bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.mesh.normals_make_consistent(inside=False);bpy.ops.object.mode_set(mode='OBJECT')

# Authoring source remains in the documented Blender frame.
scene.world=bpy.data.worlds.new(ID+' studio world');scene.world.color=(.055,.072,.09)
scene.render.engine='BLENDER_WORKBENCH'
scene.display.shading.light='STUDIO'
scene.display.shading.studiolight_rotate_z=.5
scene.display.shading.color_type='MATERIAL'
scene.display.shading.show_shadows=True
scene.display.shading.show_cavity=True
scene.display.shading.cavity_type='BOTH'
scene.display.shading.curvature_ridge_factor=1.25
scene.display.shading.curvature_valley_factor=1.0
scene.display.shading.background_type='WORLD'
scene.view_settings.view_transform='Standard'
scene.render.image_settings.file_format='PNG'
scene.render.resolution_percentage=100
scene.render.film_transparent=False
scene.camera=None
bpy.data.libraries.write(str(OUT/'source.blend'), {scene}, fake_user=True, compress=True)

if os.environ.get('AIRCRAFT_REVIEW','1')=='1':
    folder=OUT/'review';folder.mkdir(exist_ok=True)
    scale=max(L,SPAN);target=Vector((0,0,0))
    views=[('quarter',(scale*.9,-scale*1.3,scale*.83),scale*1.15),('top',(0,0,scale*2),scale*1.12),('side',(0,-scale*2,0),L*1.14),('front',(scale*2,0,0),SPAN*1.12),('rear',(-scale*2,0,0),SPAN*1.12),('articulated',(scale*.9,-scale*1.3,scale*.83),scale*1.15)]
    cameraData=bpy.data.cameras.new(ID+' review camera');camera=bpy.data.objects.new(ID+' review camera',cameraData);collection.objects.link(camera)
    cameraData.type='ORTHO';scene.camera=camera
    record=[]
    for name,location,ortho in views:
        if name=='articulated':
            prop.rotation_euler.x=.7;rj.rotation_euler.z=math.radians(24)
            for o in collection.objects:
                nid=o.get('nodeId','')
                if nid.startswith('control.elevator'):o.rotation_euler.y=math.radians(20)
                if nid.startswith('control.aileron'):o.rotation_euler.x=0;o.rotation_euler.y=math.radians(16 if nid.endswith('port') else -16)
                if nid.startswith('gear.') and not o.get('fixed'):o.rotation_euler.x=math.radians(62 if nid.endswith('port') else -62)
                if nid.startswith('diveBrake.'):o.rotation_euler.y=math.radians(40)
        camera.location=location;camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();cameraData.ortho_scale=ortho
        if name=='top':camera.rotation_euler=(0,0,math.pi/2)
        scene.render.resolution_x=1200;scene.render.resolution_y=900
        scene.render.filepath=str(folder/(name+'.png'));bpy.ops.render.render(write_still=True)
        record.append({'name':name,'location':list(location),'target':list(target),'scale':ortho,'size':[1200,900]})
    for o in collection.objects:
        if o.type=='EMPTY':o.rotation_euler=(0,0,0)
    bpy.data.objects.remove(camera,do_unlink=True)
    (folder/'cameras.json').write_text(json.dumps({'aircraftId':ID,'contentHash':HASH,'projection':'orthographic','authoringAxes':CAT['authoringAxes'],'views':record},indent=2)+'\n')

# Same basis transform as scripts/ships/export.py: (-sourceY, sourceZ, -sourceX).
bpy.context.view_layer.update()
rotation=Matrix.Rotation(math.pi/2,4,'Z');inverse=rotation.inverted()
frames={o:o.matrix_local.copy() for o in collection.objects}
for o in collection.objects:
    if o.type=='MESH':o.data.transform(rotation)
for o,frame in frames.items():
    o.matrix_parent_inverse=Matrix.Identity(4);o.matrix_local=rotation@frame@inverse
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT')
for o in collection.objects:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'model.glb'),export_format='GLB',use_selection=True,use_active_scene=True,export_yup=True,export_extras=True,export_animations=False,export_cameras=False,export_lights=False,export_apply=True)
# Restore authoring coordinates in the live MCP scene for subsequent inspection.
for o in collection.objects:
    if o.type=='MESH':o.data.transform(inverse)
for o,frame in frames.items():o.matrix_parent_inverse=Matrix.Identity(4);o.matrix_local=frame
bpy.context.view_layer.update()
# Friendly current viewport, if invoked through MCP.
if bpy.context.screen:
    from mathutils import Quaternion
    for area in bpy.context.screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active;space.shading.type='SOLID';space.shading.color_type='MATERIAL';space.overlay.show_overlays=False
            space.region_3d.view_distance=max(L,SPAN)*1.35
            space.region_3d.view_location=(0,0,0)
            space.region_3d.view_rotation=Vector((1,-1.4,.9)).to_track_quat('Z','Y')
(OUT/'authoring.json').write_text(json.dumps({'schemaVersion':1,'aircraftId':ID,'contentHash':HASH,'method':os.environ.get('AIRCRAFT_METHOD','local-blender'),'blenderVersion':bpy.app.version_string,'originalGeometry':True,'restPose':root['restPose'],'triangleBudget':40000},indent=2)+'\n')
print('AIRCRAFT_BUILT '+ID+' '+str(OUT),flush=True)
