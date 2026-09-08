"""Original Shokaku 1941 exterior. Blender metres: +X bow, +Y port, +Z up.

Only compiled blueprint data and original components enter this recipe.
References are retained separately; the common exporter changes basis once.
"""
from pathlib import Path
import bpy, bmesh, json, math, os, random, sys, importlib.util
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'scripts/ships'))
from blender_fidelity import authored_hull, authored_structure, loft_breadth, Fittings
from blender_rig import create_flagstaffs
from blender_supports import SupportSurface
spec=importlib.util.spec_from_file_location('ijn_guns',ROOT/'assets/parts/ijn-carrier-guns/geometry.py')
guns=importlib.util.module_from_spec(spec);spec.loader.exec_module(guns)
D=json.loads(Path(os.environ['SHIP_DEFINITION']).read_text());H=D['hull'];OUT=Path(os.environ['SHIP_OUTPUT'])
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
scene.world.color=(.08,.10,.12)
COL={}
for name in ['Hull','Hangars','Flight deck','Island','Armament','Fittings','Underwater','Simulation']:
    c=bpy.data.collections.new(name);scene.collection.children.link(c);COL[name]=c
palette={'naval':(.245,.263,.267,1),'hullgray':(.205,.225,.23,1),'roof':(.185,.206,.212,1),
 'edge':(.084,.10,.109,1),'dark':(.014,.019,.022,1),'canvas':(.58,.57,.49,1),
 'deck':(.49,.365,.215,1),'elevator':(.345,.33,.275,1),'steel-deck':(.18,.196,.2,1),
 'antifouling':(.29,.082,.062,1),'boot':(.034,.038,.040,1),'bronze':(.39,.27,.115,1),
 'glass':(.027,.07,.075,1),'line':(.76,.76,.65,1),'hangar':(.35,.365,.35,1),'raft':(.40,.38,.31,1)}
M={}
for key,color in palette.items():
    m=bpy.data.materials.new(key);m.diffuse_color=color;m.use_nodes=True
    p=m.node_tree.nodes['Principled BSDF'];p.inputs['Base Color'].default_value=color;p.inputs['Roughness'].default_value=.78
    if key in ['bronze','edge']:p.inputs['Metallic'].default_value=.45
    if key=='glass':p.inputs['Roughness'].default_value=.21
    M[key]=m
for i in range(7):
    m=bpy.data.materials.new('Original weathered deck timber '+str(i));m.use_nodes=True
    color=tuple(c*(.89+i*.035) for c in palette['deck'][:3])+(1,)
    m.diffuse_color=color;m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=color
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.9;M['plank'+str(i)]=m

def mesh(name,verts,faces,mat,col,smooth=False):
    data=bpy.data.meshes.new(name);data.from_pydata(verts,[],faces);data.update()
    o=bpy.data.objects.new(name,data);col.objects.link(o);o['assemblyId']=col.name.lower().replace(' ','-')
    if mat:data.materials.append(mat)
    for p in data.polygons:p.use_smooth=smooth
    return o
def box(name,loc,size,mat,col,bev=0):
    x,y,z=(v/2 for v in size)
    o=mesh(name,[(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)],
      [(0,3,2,1),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)],mat,col);o.location=loc;return o
def cyl(name,loc,radius,depth,mat,col,vertices=24,r2=None):
    top=radius if r2 is None else r2
    verts=[(r*math.cos(i*math.tau/vertices),r*math.sin(i*math.tau/vertices),z) for z,r in [(-depth/2,radius),(depth/2,top)] for i in range(vertices)]
    faces=[tuple(reversed(range(vertices))),tuple(range(vertices,vertices*2))]+[(i,(i+1)%vertices,(i+1)%vertices+vertices,i+vertices) for i in range(vertices)]
    o=mesh(name,verts,faces,mat,col,True);o.location=loc
    o.data.polygons[0].use_smooth=False;o.data.polygons[1].use_smooth=False;return o
def rod(name,a,b,r,mat,col,r2=None,vertices=8):
    a,b=Vector(a),Vector(b);o=cyl(name,(a+b)/2,r,max(.0001,(b-a).length),mat,col,vertices,r2)
    o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o
def poly(name,points,bottom,top,mat,col):
    n=len(points);return mesh(name,[(x,y,z) for z in [bottom,top] for x,y in points],
      [tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],mat,col)
def empty(id,loc,col):
    o=bpy.data.objects.new(id,None);col.objects.link(o);o.location=loc;o['nodeId']=id;o['assemblyId']=id;return o
def lerp(table,x):
    for (a,v),(b,w) in zip(table,table[1:]):
        if a<=x<=b:return v+(w-v)*(x-a)/(b-a)
    return table[0][1] if x<table[0][0] else table[-1][1]
def deck(x):return lerp(H['deckHeights'],x+H['length']/2)
helpers=dict(mesh=mesh,cyl=cyl,rod=rod,box=box)
def railing(points,z,name,col,height=1.0):
    for a,b in zip(points,points[1:]):
        for h in [.35,.68,height]:rod(name+' rail',(*a,z+h),(*b,z+h),.021,M['edge'],col,vertices=6)
        count=max(1,math.ceil(math.dist(a,b)/2.1))
        for i in range(count+1):
            x=a[0]+(b[0]-a[0])*i/count;y=a[1]+(b[1]-a[1])*i/count
            rod(name+' stanchion',(x,y,z),(x,y,z+height),.026,M['naval'],col,vertices=6)

authored_hull(H,mesh,COL['Hull'],[M['hullgray'],M['antifouling'],M['boot']],True)
hull_support=SupportSurface(list(COL['Hull'].objects))
S={s['id']:s for s in D['structures']};FD=S['flight-deck']['baseY']+S['flight-deck']['height']
structure_meshes={}
for s in D['structures']:
    col=COL['Flight deck'] if s['id'].startswith(('flight-','elevator')) else COL['Hangars'] if 'hangar' in s['id'] else COL['Island']
    o=authored_structure(s,mesh,M,col)
    structure_meshes[s['id']]=o
    if s['id'].startswith('elevator'):
        pivot=empty(s['id']+'.lift',(0,0,0),col);o.parent=pivot
    if s.get('exhaust'):
        x=-s['exhaust']['position'][2]
        rod(s['id']+' mouth-lip',(x-4.4,-19.4,12.85),(x+4.4,-19.4,12.85),.08,M['edge'],col)
        mesh(s['id']+' exhaust darkness',[(x-4.4,-19.28,12.05),(x+4.4,-19.28,12.05),(x+4.4,-19.28,13.62),(x-4.4,-19.28,13.62)],[(0,1,2,3)],M['dark'],col)
        for dx in range(-4,5):rod(s['id']+' mouth grille',(x+dx,-19.44,12.06),(x+dx,-19.44,13.6),.038,M['edge'],col)
        for z in [12.1,12.5,13,13.5]:rod(s['id']+' horizontal grille',(x-4.35,-19.45,z),(x+4.35,-19.45,z),.027,M['edge'],col)
        funnel_support=SupportSurface([o])
        for dx in [-3.6,3.6]:
            foot=hull_support.along((x+dx,-20,5.3),(0,1,0),20)
            head=funnel_support.along((x+dx,-17.3,10),(0,0,1),10)
            rod(s['id']+' hull brace',foot,head,.13,M['naval'],col)

outline=[(-z,-x) for x,z in S['flight-deck']['footprint']]
def span(y):
    hits=[]
    for (a,b),(c,d) in zip(outline,outline[1:]+outline[:1]):
        if min(b,d)<=y<max(b,d):hits.append(a+(c-a)*(y-b)/(d-b))
    return (min(hits),max(hits)) if hits else None
rng=random.Random(19411207);verts=[];faces=[];colors=[]
for i in range(165):
    y=-14.5+i*.176;y2=y+.17;aa=span(y);bb=span(y2)
    if not aa or not bb:continue
    x=max(-102,max(aa[0],bb[0]));end=min(101,min(aa[1],bb[1]))
    while x<end:
        next_x=min(end,x+6+rng.uniform(-1,1));intervals=[(x,next_x)]
        for id,s in S.items():
            if not id.startswith('elevator'):continue
            ps=[(-z,-xx) for xx,z in s['footprint']];xlo=min(p[0] for p in ps);xhi=max(p[0] for p in ps)
            if min(p[1] for p in ps)<y2 and max(p[1] for p in ps)>y:
                intervals=[v for a,b in intervals for v in [(a,min(b,xlo)),(max(a,xhi),b)] if v[1]>v[0]+.01]
        for a,b in intervals:
            n=len(verts);verts.extend([(a,y,FD+.003),(b-.012,y,FD+.003),(b-.012,y2,FD+.003),(a,y2,FD+.003)])
            faces.append((n,n+1,n+2,n+3));colors.append(rng.randrange(7))
        x=next_x+.004
o=mesh('Longitudinal weathered wood planking',verts,faces,None,COL['Flight deck'])
for i in range(7):o.data.materials.append(M['plank'+str(i)])
for face,index in zip(o.data.polygons,colors):face.material_index=index
for a,b in [(-125.05,-102),(101,117.15)]:
    def strip(x):
        hits=[]
        for (u,v),(w,z) in zip(outline,outline[1:]+outline[:1]):
            if min(u,w)<=x<=max(u,w) and u!=w:hits.append(v+(z-v)*(x-u)/(w-u))
        return min(hits),max(hits)
    ya,yb=strip(a+.001);yc,yd=strip(b-.001)
    poly('Steel flight-deck end',[(a,ya),(b,yc),(b,yd),(a,yb)],FD+.001,FD+.012,M['steel-deck'],COL['Flight deck'])
for a,b in zip(outline,outline[1:]+outline[:1]):rod('Continuous deck edge girder',(*a,FD-.20),(*b,FD-.20),.16,M['naval'],COL['Hangars'])
for x in range(-119,109,6):
    if all(abs(x+sum(p[1] for p in s['footprint'])/len(s['footprint']))>7.3 for id,s in S.items() if id.startswith('elevator')):
        box('Painted flight centerline',(x,0,FD+.024),(3,.17,.015),M['line'],COL['Flight deck'])
for y in [-6.9,6.9]:box('Landing guide line',(-27,y,FD+.026),(173,.10,.012),M['line'],COL['Flight deck'])
for y in range(-9,10,2):box('Afterdeck landing stripes',(-116,y,FD+.03),(8.5,.63,.014),M['line'],COL['Flight deck'])
for x in [-97,-88,-74,-64,-54,-44,-32,-10,2,13]:
    rod('Arresting cable',(x,-11.8,FD+.052),(x,11.8,FD+.052),.022,M['edge'],COL['Fittings'],vertices=6)
    for y in [-11.9,11.9]:
        box('Arrestor sheave bed',(x,y,FD-.04),(.52,.46,.12),M['naval'],COL['Fittings'])
        Fittings(helpers,M,COL['Fittings']).ring('Arrestor sheave',(x,y,FD+.025),.17,.035,'z')
for x in [19,26]:box('Stowed crash barrier sill',(x,0,FD+.042),(.17,23,.06),M['edge'],COL['Fittings'])
for id,s in S.items():
    if not id.startswith('elevator'):continue
    points=[(-z,-x) for x,z in s['footprint']]
    for a,b in zip(points,points[1:]+points[:1]):rod('Lift perimeter seam',(*a,FD+.041),(*b,FD+.041),.024,M['edge'],COL['Flight deck'],vertices=6)

fit=Fittings(helpers,M,COL['Hangars'])
for x in [-121,-115,-107,103,109,114]:
    top=FD-.34;bottom=deck(x)
    for sign in [-1,1]:
        y=sign*min(5.0,loft_breadth(H,x,bottom)*.75)
        rod('Deck-end pillar',(x,y,bottom-.1),(x,y,top),.19,M['naval'],COL['Hangars'],vertices=10)
        rod('Deck-end diagonal',(x-2.0,y,bottom-.1),(x,y,top),.10,M['naval'],COL['Hangars'])
        fit.knee('Pierced overhang web',x,y,sign*9.2,top,2.0)
    box('Deck-end transverse girder',(x,0,top-.13),(.22,19,.28),M['naval'],COL['Hangars'])
for sign in [-1,1]:
    y=sign*11.15
    box('Hangar maintenance walkway',(-4,y,10.0),(188,1.35,.15),M['steel-deck'],COL['Hangars'])
    railing([(-98,y+sign*.65),(90,y+sign*.65)],10.08,'Hangar walkway',COL['Hangars'],.88)
    for x in range(-94,93,6):
        fit.knee('Hangar walkway knee',x,sign*9.1,sign*11.8,9.96,1.35)
        fit.knee('Flight deck transverse web',x,sign*10.45,sign*13.9,FD-.35,1.4)
        box('Hangar shell vertical stiffener',(x,sign*10.51,12.12),(.07,.08,3.9),M['naval'],COL['Hangars'])
    for x in [-88,-65,-34,0,25,65,84]:
        fit.door('Hangar access door',x,sign*10.55,10.1,.65,1.75)
        fit.vent('Hangar ventilation louver',x+2.1,sign*10.56,11.9,1.4,.75)
    for x in [-95,-57,-25,15,80]:fit.ladder('External hangar ladder',(x,sign*11.55,6.0),(x,sign*11.55,10.0),.6)
    for a,b in [(-123,-109),(84,115)]:
        y=sign*(9.6 if a>0 else 10.4)
        for x in range(a,b,3):rod('Safety-net deck boom',(x,y,FD-.2),(x,y+sign*2,FD-.45),.045,M['naval'],COL['Fittings'])
        for offset in [.3,.8,1.3,1.8]:rod('Safety net longitudinal',(a,y+sign*offset,FD-.25-offset*.10),(b,y+sign*offset,FD-.25-offset*.10),.012,M['edge'],COL['Fittings'],vertices=4)
        for x in range(a,b):rod('Safety net crossline',(x,y,FD-.23),(x,y+sign*2,FD-.45),.011,M['edge'],COL['Fittings'],vertices=4)

for mount in D['mounts']:
    x,y,z=-mount['position'][2],-mount['position'][0],mount['position'][1]
    heavy=mount['weapon']['caliberM']>.1
    radius=3.15 if heavy else 1.95 if 'shielded' in mount['partId'] else 1.7
    sign=1 if y>0 else -1
    cyl(mount['id']+' sponson floor',(x,y,z-.13),radius,.26,M['naval'],COL['Armament'],48)
    inner=sign*10.2
    box(mount['id']+' gallery bridge',(x,(inner+y)/2,z-.16),(radius*1.65,abs(y-inner),.32),M['naval'],COL['Armament'])
    for dx in [-radius*.62,0,radius*.62]:
        start=(x+dx,sign*loft_breadth(H,x+dx,5.3),5.3)
        rod(mount['id']+' deep sponson brace',start,(x+dx,y,z-.24),.14 if heavy else .085,M['naval'],COL['Armament'])
        fit.col=COL['Armament'];fit.knee(mount['id']+' gallery web',x+dx,inner,y+sign*radius*.7,z-.26,2.15 if heavy else 1.5)
    for i in range(40):
        a=i*math.tau/40;b=(i+1)*math.tau/40
        poly(mount['id']+' splinter tub',[(x+radius*math.cos(a),y+radius*math.sin(a)),(x+radius*math.cos(b),y+radius*math.sin(b)),(x+(radius-.05)*math.cos(b),y+(radius-.05)*math.sin(b)),(x+(radius-.05)*math.cos(a),y+(radius-.05)*math.sin(a))],z,z+(.52 if heavy else .42),M['naval'],COL['Armament'])
    guns.create_mount(mount,COL['Armament'],helpers,M)
    box(mount['id']+' ready-use locker',(x-radius*.72,inner,z+.38),(.75,.6,.76),M['naval'],COL['Armament'])

fit.col=COL['Island']
for id in ['bridge-walkway','navigation-wings','compass-platform','bridge-roof']:
    s=S[id];pts=[(-z,-x) for x,z in s['footprint']];z=s['baseY']+s['height']
    railing(pts+pts[:1],z,id,COL['Island'],.78)
for id in ['navigation-bridge','air-control']:
    s=S[id];pts=[(-z,-x) for x,z in s['footprint']];z=s['baseY']+s['height']*.6
    for a,b in zip(pts,pts[1:]+pts[:1]):
        count=max(1,int(math.dist(a,b)/.8))
        for i in range(count):
            t0=(i+.13)/count;t1=(i+.85)/count
            aa=(a[0]+(b[0]-a[0])*t0,a[1]+(b[1]-a[1])*t0);bb=(a[0]+(b[0]-a[0])*t1,a[1]+(b[1]-a[1])*t1)
            mesh('Bridge window',[(aa[0],aa[1],z-.26),(bb[0],bb[1],z-.26),(bb[0],bb[1],z+.27),(aa[0],aa[1],z+.27)],[(0,1,2,3)],M['glass'],COL['Island'])
            rod('Window rain hood',(aa[0],aa[1],z+.3),(bb[0],bb[1],z+.3),.035,M['naval'],COL['Island'])
island_support=SupportSurface([structure_meshes['island-base']])
for sign in [-1,1]:
    yy=-13.35+sign*2.15
    for x in [33,39,44]:fit.knee('Bridge wing knee',x,yy,yy+sign*.85,18.76,1.15)
    fit.stairs('Island access stair',(29,yy,FD),(32.5,yy,16.9),.65)
    fit.ladder('Bridge upper ladder',(34,yy,16.9),(34,yy,20.8),.55)
    for x in [32,36,42,45]:
        wall=island_support.along((x,-13.35,FD+1),(0,sign,0),10)
        fit.door('Island access',x,wall.y,FD+.12,.65,1.7)
for x,y,z in [(35.5,-13.35,22.19)]:
    cyl('Bridge optical pedestal',(x,y,z+.42),.22,.84,M['naval'],COL['Island'],20)
    box('Optical mounting fork',(x,y,z+.91),(.45,.48,.24),M['naval'],COL['Island'])
    for offset in [-.12,.12]:rod('Bridge binocular',(x-.32,y+offset,z+1.02),(x+.3,y+offset,z+1.02),.09,M['edge'],COL['Island'],vertices=16)
for module in D['modules']:
    if not module['id'].startswith('director-'):continue
    x,y,z=-module['center'][2],-module['center'][0],module['center'][1]
    cyl('Director platform',(x,y,z-.92),1.35,.22,M['naval'],COL['Island'],32)
    if module['id']!='director-starboard-forward':
        for dx in [-.6,.6]:rod('Director gallery support',(x+dx,math.copysign(10.2,y),10.4),(x+dx,y,z-1.02),.09,M['naval'],COL['Island'])
    cyl('Type 94 director pedestal',(x,y,z-.48),.48,.8,M['naval'],COL['Island'],24)
    cyl('Type 94 director enclosure',(x,y,z+.06),.80,.62,M['naval'],COL['Island'],24,r2=.7)
    rod('Type 94 optical baseline',(x,y-2.25,z+.23),(x,y+2.25,z+.23),.12,M['naval'],COL['Island'],vertices=16)
    for yy in [y-2.2,y+2.2]:box('Director prism hood',(x,yy,z+.23),(.48,.26,.34),M['naval'],COL['Island'])

MX,MY=27.3,-13.35
for dx,dy in [(-1.3,-1.1),(-1.3,1.1),(1.3,0)]:rod('Tripod mast leg',(MX+dx,MY+dy,FD),(MX,MY,25.7),.15,M['naval'],COL['Island'],r2=.09)
rod('Mast topmast',(MX,MY,25.3),(MX,MY,33.9),.09,M['naval'],COL['Island'],r2=.035)
fit.ladder('Mast ladder',(MX-.3,MY,FD),(MX-.3,MY,31.5),.48)
for z in [FD+.3,18,21,24,27,30,31.4]:
    rod('Mast ladder spacer',(MX-.3,MY,z),(MX,MY,z),.035,M['naval'],COL['Island'])
for z,width in [(26.6,7.7),(30.8,4.8)]:
    rod('Signal yard',(MX,MY-width/2,z),(MX,MY+width/2,z),.063,M['naval'],COL['Island'])
    for sign in [-1,1]:rod('Signal yard stay',(MX,MY,z+2),(MX,MY+sign*width/2,z),.014,M['edge'],COL['Island'],vertices=4)
for x,y in [(-80,15.5),(-65,15.5),(-48,15.5),(-32,15.5),(-65,-18.0),(-34,-18.0)]:
    pivot=empty('radio-'+str(int(x))+('-port' if y>0 else '-starboard')+'.fold',(x,y,FD-.4),COL['Island'])
    rod('Radio mast gallery seat',(x,math.copysign(10,y),13.0),(x,y,FD-.4),.10,M['naval'],COL['Island'])
    rod('Radio mast hinge cross-seat',(x-.4,y,FD-.4),(x+.4,y,FD-.4),.075,M['naval'],COL['Island'])
    before=set(scene.objects)
    for dx in [-.28,.28]:rod('Radio mast chord',(dx,0,0),(0,0,9.8),.043,M['naval'],COL['Island'])
    for i in range(9):rod('Radio mast lacing',(-.28*(1-i/10),0,i),(.28*(1-(i+1)/10),0,i+1),.019,M['edge'],COL['Island'],vertices=6)
    for world_z in [23.0,23.8,24.15]:
        h=world_z-(FD-.4);half=.28*(1-h/9.8)
        rod('Aerial attachment crossbar',(-half,0,h),(half,0,h),.021,M['naval'],COL['Island'])
    for o in set(scene.objects)-before:o.parent=pivot;o['assemblyId']=pivot.name
for y,xs in [(15.5,[-80,-65,-48,-32]),(-18.0,[-65,-34])]:
    for x0,x1 in zip(xs,xs[1:]):
        for z in [23.0,23.8,24.15]:rod('Wireless aerial',(x0,y,z),(x1,y,z),.013,M['edge'],COL['Island'],vertices=4)

fit.col=COL['Fittings']
for x in range(-120,121,4):
    for z in [1.6,3.6,5.5,8.1]:
        if z>deck(x)-.35:continue
        for sign in [-1,1]:
            y=sign*(loft_breadth(H,x,z)+.005)
            rod('Recessed hull scuttle',(x,y-sign*.013,z),(x,y+sign*.013,z),.12,M['dark'],COL['Hull'],vertices=12)
            fit.col=COL['Hull'];fit.ring('Scuttle rim',(x,y,z),.129,.018,'y','naval',12)
for sign in [-1,1]:
    for x in [112,119,-116,-122]:
        z=deck(x);y=sign*min(2.5 if x>0 else 3.3,loft_breadth(H,x,z)*.60)
        box('Bollard bed',(x,y,z+.09),(1.0,.7,.18),M['naval'],COL['Fittings'])
        for dx in [-.28,.28]:cyl('Mooring bollard',(x+dx,y,z+.36),.17,.54,M['edge'],COL['Fittings'],16)
    z=deck(110);y=sign*3.2
    cyl('Anchor windlass',(110,y,z+.45),.5,.9,M['edge'],COL['Fittings'],24)
    rod('Anchor cable',(110,y,z+.12),(122,sign*1.1,deck(122)+.12),.065,M['edge'],COL['Fittings'])
    x=120;y=sign*loft_breadth(H,x,8.5)
    rod('Anchor hawse',(x,y-.16,8.5),(x,y+.16,8.5),.22,M['edge'],COL['Fittings'],vertices=20)
    rod('Stockless anchor shank',(x,y,8.5),(x-1.1,y,7.3),.11,M['edge'],COL['Fittings'])
    rod('Anchor crown',(x-1.4,y,7.1),(x-.4,y,7.1),.13,M['edge'],COL['Fittings'])
    for dx in [-1.35,-.5]:box('Anchor fluke',(x+dx,y,7.35),(.38,.19,.5),M['edge'],COL['Fittings'])
    fit.col=COL['Fittings']
    for x,length,y in [(-110,11.2,sign*4.0),(-99,9.0,sign*5.2),(58,9.0,sign*10.7)]:
        # The original boat's own cradle has a 0.16 m under-keel foot.
        z=deck(x)+.16;fit.boat('Ship boat',x,y,z,length,2.0,length>10)
        for fx in [-.27,.26]:
            dx=length*fx
            rod('Boat davit',(x+dx,y-sign*1.25,deck(x)),(x+dx,y-sign*1.25,z+3),.09,M['naval'],COL['Fittings'])
            rod('Davit head',(x+dx,y-sign*1.25,z+3),(x+dx,y,z+3),.09,M['naval'],COL['Fittings'])
            rod('Boat fall',(x+dx,y,z+3),(x+dx,y,z+1.4),.021,M['edge'],COL['Fittings'],vertices=6)
            beam=lerp([(-.32,.89),(-.13,1),(.12,.96),(.33,.76)],fx)
            sheer=lerp([(-.32,.12),(-.13,0),(.12,.04),(.33,.18)],fx)
            for side in [-1,1]:
                rod('Boat lifting bridle',(x+dx,y,z+1.4),(x+dx,y+side*beam,z+.75+sheer),.019,M['edge'],COL['Fittings'],vertices=6)

for sign in [-1,1]:
    for kind,x,y in [('inner',-106,3.6),('outer',-96,7.0)]:
        y*=sign;z=-6.2
        rod('Propeller shaft',(x,y,z),(x+17,y*.87,z+.9),.22,M['edge'],COL['Underwater'],vertices=20)
        for dy in [-.7,.7]:
            seat=hull_support.along((x+2,y+dy,-3.6),(0,-sign,.2),20)
            rod('Shaft A bracket',seat,(x+1,y,z),.15,M['naval'],COL['Underwater'])
        pivot=empty('propeller-'+kind+('-port' if sign>0 else '-starboard')+'.spin',(x,y,z),COL['Underwater'])
        hub=rod('Propeller hub',(-.6,0,0),(.6,0,0),.42,M['bronze'],COL['Underwater'],r2=.28,vertices=24);hub.parent=pivot
        for i in range(3):
            angle=i*math.tau/3;points=[(.25,-.18),(.9,-.45),(1.85,-.35),(2.1,.1),(1.7,.56),(.55,.3)]
            vs=[(t+.22*radius,radius*math.cos(angle)-offset*math.sin(angle),radius*math.sin(angle)+offset*math.cos(angle)) for t in [-.05,.05] for radius,offset in points]
            n=len(points);faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(j,(j+1)%n,(j+1)%n+n,j+n) for j in range(n)]
            o=mesh('Original propeller blade',vs,faces,M['bronze'],COL['Underwater'],True);o.parent=pivot
        for obj in pivot.children:obj['assemblyId']=pivot.name
    pts=[]
    for x in [-70,-50,-20,10,40,60]:
        y=sign*loft_breadth(H,x,-5.4);pts.extend([(x,y,-5.4),(x,y+sign*.65,-5.8)])
    mesh('Bilge keel',pts,[(i,i+1,i+3,i+2) for i in range(0,len(pts)-2,2)],M['antifouling'],COL['Underwater'])
for id,x in [('forward',-105),('aft',-119)]:
    pivot=empty('rudder-'+id+'.yaw',(x,0,-5.6),COL['Underwater'])
    o=poly('Balanced rudder',[(-2.8,-.24),(1.8,-.18),(2,.18),(-2.8,.24)],-2.3,2.3,M['antifouling'],COL['Underwater']);o.parent=pivot;o['assemblyId']=pivot.name
    o=rod('Rudder stock',(0,0,1.5),(0,0,6.5),.22,M['edge'],COL['Underwater'],vertices=20);o.parent=pivot;o['assemblyId']=pivot.name
for kind in ['armor','modules','compartments','obstructions']:
    for v in D[kind]:
        x,y,z=v['center'];a,b,c=v['size'];o=box(kind+':'+v['id'],(-z,-x,y),(c,a,b),M['line'],COL['Simulation'])
        o['exportRole']='simulation';o.hide_render=True;o.hide_set(True);o.display_type='WIRE'
create_flagstaffs(D)
scene['definitionHash']=D['contentHash'];scene['configuration']=D['configuration']
scene['historicalAccuracy']='Qualified reconstruction; see reports/discrepancies.md'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))
print('SHOKAKU SOURCE',len(scene.objects),'objects',flush=True)
