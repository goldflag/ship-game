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
def flight_level(x):return 14.75-.62*max(0,min(1,(-118.5-x)/6.55))**2
helpers=dict(mesh=mesh,cyl=cyl,rod=rod,box=box)
def railing(points,z,name,col,height=1.0):
    for a,b in zip(points,points[1:]):
        for h in [.35,.68,height]:rod(name+' rail',(*a,z+h),(*b,z+h),.021,M['edge'],col,vertices=6)
        count=max(1,math.ceil(math.dist(a,b)/2.1))
        for i in range(count+1):
            x=a[0]+(b[0]-a[0])*i/count;y=a[1]+(b[1]-a[1])*i/count
            rod(name+' stanchion',(x,y,z),(x,y,z+height),.026,M['naval'],col,vertices=6)

def glazed_bridge(s,col):
    """Opaque wall panels stop at actual openings; glass is recessed in jambs.

    Never put a glass quad on a complete opaque wall: both survive GLB export
    and compete for the same depth. CPU structural glazing remains a hit surface.
    """
    pts=[(-z,-x) for x,z in s['footprint']];low=s['baseY'];high=low+s['height']
    verts=[];faces=[];materials=[];panes=0
    def face(points,material=0):
        n=len(verts);verts.extend(points);faces.append(tuple(range(n,n+len(points))));materials.append(material)
    face([(*p,low) for p in reversed(pts)]);face([(*p,high) for p in pts])
    signed=sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(pts,pts[1:]+pts[:1]))
    for a,b in zip(pts,pts[1:]+pts[:1]):
        length=math.dist(a,b);count=max(1,round(length/.76));dx=(b[0]-a[0])/length;dy=(b[1]-a[1])/length
        normal=Vector((dy,-dx,0))*(1 if signed>0 else -1)
        def point(t,z):return Vector((a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,z))
        for i in range(count):
            t0,t1=i/count,(i+1)/count
            # S02's glazing starts near profile x=3097 px (40.0 m);
            # the aft half of this room is solid with a single scuttle.
            if (point((t0+t1)/2,0).x<40.0) or length<.4:
                face([point(t0,low),point(t1,low),point(t1,high),point(t0,high)]);continue
            l=t0+.08/count;r=t1-.08/count;bottom=20.75;top=21.40
            face([point(t0,low),point(t1,low),point(t1,bottom),point(t0,bottom)])
            face([point(t0,top),point(t1,top),point(t1,high),point(t0,high)])
            face([point(t0,bottom),point(l,bottom),point(l,top),point(t0,top)])
            face([point(r,bottom),point(t1,bottom),point(t1,top),point(r,top)])
            outer=[point(l,bottom),point(r,bottom),point(r,top),point(l,top)]
            inner=[v-normal*.085 for v in outer]
            for j in range(4):face([outer[j],outer[(j+1)%4],inner[(j+1)%4],inner[j]])
            face(inner,1);panes+=1
            rod('Conning window rain hood',point(l,top+.055)+normal*.020,point(r,top+.055)+normal*.020,.032,M['naval'],col)
    o=mesh(s['name'],verts,faces,M['naval'],col);o.data.materials.append(M['glass'])
    for face_,material in zip(o.data.polygons,materials):face_.material_index=material
    o['nodeId']=s['id']+'.surface';o['assemblyId']=s['id'];o['windowPanelCount']=panes
    bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
    return o

authored_hull(H,mesh,COL['Hull'],[M['hullgray'],M['antifouling'],M['boot']],True)
hull_support=SupportSurface(list(COL['Hull'].objects))
S={s['id']:s for s in D['structures']};FD=S['flight-deck']['baseY']+S['flight-deck']['height']
structure_meshes={}
for s in D['structures']:
    col=COL['Flight deck'] if s['id'].startswith(('flight-','elevator')) else COL['Hangars'] if 'hangar' in s['id'] or s['id'].startswith('stern-') else COL['Island']
    o=glazed_bridge(s,col) if s['id']=='air-control' else authored_structure(s,mesh,M,col)
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
    # One fitted steel surface follows the actual aft round-down.
    cuts=[a]+[x for x in [-124,-122,-120,-118.5] if a<x<b]+[b]
    for u,v in zip(cuts,cuts[1:]):
        yl,yr=strip(u+.0001);zl,zr=strip(v-.0001)
        points=[(u,yl),(v,zl),(v,zr),(u,yr)]
        mesh('Steel flight-deck end',[(x,y,flight_level(x)+.016) for x,y in points],[(0,1,2,3)],M['steel-deck'],COL['Flight deck'])
for a,b in zip(outline,outline[1:]+outline[:1]):rod('Continuous deck edge girder',(*a,flight_level(a[0])-.20),(*b,flight_level(b[0])-.20),.16,M['naval'],COL['Hangars'])
for x in range(-119,109,6):
    if all(abs(x+sum(p[1] for p in s['footprint'])/len(s['footprint']))>7.3 for id,s in S.items() if id.startswith('elevator')):
        box('Painted flight centerline',(x,0,FD+.024),(3,.17,.015),M['line'],COL['Flight deck'])
for y in [-6.9,6.9]:box('Landing guide line',(-27,y,FD+.026),(173,.10,.012),M['line'],COL['Flight deck'])
for y in range(-9,10,2):
    for a,b in [(-120.25,-120),(-120,-118.5),(-118.5,-111.75)]:
        mesh('Afterdeck landing stripes',[(x,yy,flight_level(x)+.023) for x,yy in [(a,y-.315),(b,y-.315),(b,y+.315),(a,y+.315)]],[(0,1,2,3)],M['line'],COL['Flight deck'])
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
for x in [103,109,114]:
    top=FD-.34;bottom=deck(x)
    for sign in [-1,1]:
        y=sign*min(5.0,loft_breadth(H,x,bottom)*.75)
        rod('Deck-end pillar',(x,y,bottom-.1),(x,y,top),.19,M['naval'],COL['Hangars'],vertices=10)
        rod('Deck-end diagonal',(x-2.0,y,bottom-.1),(x,y,top),.10,M['naval'],COL['Hangars'])
        fit.knee('Pierced overhang web',x,y,sign*9.2,top,2.0)
    box('Deck-end transverse girder',(x,0,top-.13),(.22,19,.28),M['naval'],COL['Hangars'])
# S02 and S10: an open upper boat deck, a lower quarterdeck and a single
# deep aft flight-deck portal. All pillars seat on the loft or boat-deck beams.
for x in [-118.0,-101.0]:
    for sign in [-1,1]:
        y=sign*(7.45 if x<-110 else 8.6)
        bottom=deck(x);top=flight_level(x)-.34
        box('After flight-deck portal upright',(x,y,(bottom+top)/2),(.54,.60,top-bottom),M['naval'],COL['Hangars'])
        fit.knee('After portal perforated knee',x,y,sign*13.4,top,2.0)
    box('After portal transverse girder',(x,0,top-.25),(.6,27,.5),M['naval'],COL['Hangars'])
for x in [-123.2,-112,-104]:
    for sign in [-1,1]:
        y=sign*(5.8 if x<-120 else 7.3)
        rod('Boat-deck column',(x,y,deck(x)),(x,y,9.35),.095,M['naval'],COL['Hangars'],vertices=10)
    box('Boat-deck underside beam',(x,0,9.24),(.18,16,.22),M['naval'],COL['Hangars'])
boat_pts=[(-z,-x) for x,z in S['stern-boat-deck']['footprint']]
railing(boat_pts[:4],9.57,'Upper boat-deck guard',COL['Hangars'],.82)
railing(boat_pts[4:]+boat_pts[:1],9.57,'Upper boat-deck guard',COL['Hangars'],.82)
for sign in [-1,1]:
    pts=[(x,sign*loft_breadth(H,x,deck(x))) for x in [-128.70,-127.5,-126.6,-124,-119,-114,-108,-101]]
    for a,b in zip(pts,pts[1:]):
        for dz in [.35,.65,.92]:rod('Quarterdeck guard rail',(*a,deck(a[0])+dz),(*b,deck(b[0])+dz),.021,M['edge'],COL['Fittings'],vertices=6)
        rod('Quarterdeck guard stanchion',(*a,deck(a[0])),(*a,deck(a[0])+.92),.027,M['naval'],COL['Fittings'],vertices=8)
    fit.stairs('Stern boat-deck stair',(-122,sign*6.2,deck(-122)),(-117,sign*6.2,9.57),.72)
# Fixed stowed boat-handling derrick; placement follows the port-side S02 plan.
CX,CY=-78.9,11.9
cyl('Boat crane deck pedestal',(CX,CY,FD+.5),.43,1,M['naval'],COL['Fittings'],24)
rod('Boat crane kingpost',(CX,CY,FD+.5),(CX,CY,23.5),.16,M['naval'],COL['Fittings'],r2=.11)
heel=Vector((CX,CY,17.2));tip=Vector((-93.4,CY,25.55))
rod('Derrick heel pin',heel+Vector((0,-.34,0)),heel+Vector((0,.34,0)),.095,M['naval'],COL['Fittings'])
rod('Derrick tip sheave axle',tip+Vector((0,-.22,0)),tip+Vector((0,.22,0)),.09,M['naval'],COL['Fittings'])
for side in [-1,1]:
    rod('Derrick boom chord',heel+Vector((0,side*.25,0)),tip+Vector((0,side*.13,0)),.072,M['naval'],COL['Fittings'])
    for i in range(12):
        a=heel.lerp(tip,i/12);b=heel.lerp(tip,(i+1)/12)
        rod('Derrick lattice web',a+Vector((0,side*.25,0)),b+Vector((0,-side*.25,0)),.025,M['naval'],COL['Fittings'],vertices=6)
rod('Derrick topping lift',(CX,CY,23.5),tip,.020,M['edge'],COL['Fittings'],vertices=6)
rod('Derrick heel brace',(CX+1.8,CY,FD),(CX,CY,23.5),.08,M['naval'],COL['Fittings'])
rod('Derrick hoist fall',tip,tip+Vector((0,0,-2.1)),.018,M['edge'],COL['Fittings'],vertices=6)
fit.ring('Derrick hook',tuple(tip+Vector((0,0,-2.1))),.14,.045,'y','edge',16)

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
# Distinct solid wing bulwarks and the upper windbreak replace uniform rail decks.
for id in ['bridge-walkway','navigation-wings','compass-platform','bridge-roof']:
    s_=S[id];pts=[(-z,-x) for x,z in s_['footprint']];z=s_['baseY']+s_['height']
    if id in ['bridge-walkway','navigation-wings']:
        railing(pts+pts[:1],z,id,COL['Island'],.95 if id=='bridge-walkway' else 1.12)
    else:
        height=1.23 if id=='bridge-roof' else 1.02
        for a,b in zip(pts,pts[1:]+pts[:1]):
            delta=Vector((b[0]-a[0],b[1]-a[1],0));normal=Vector((delta.y,-delta.x,0)).normalized()*.045
            points=[a,b,(b[0]-normal.x,b[1]-normal.y),(a[0]-normal.x,a[1]-normal.y)]
            poly(id+' solid windbreak',points,z,z+height,M['naval'],COL['Island'])
            rod(id+' cap rail',(*a,z+height),(*b,z+height),.034,M['edge'],COL['Island'])
for id,deck_above in [('island-base','bridge-walkway'),('bridge-chartroom','navigation-wings'),('navigation-bridge','compass-platform')]:
    s_=S[id];support=SupportSurface([structure_meshes[id]])
    # Keep fittings on their floor-to-floor datum when the room's hidden roof
    # is seated under its deck plate instead of duplicating the walking skin.
    floor_above=S[deck_above]['baseY']+S[deck_above]['height']
    z=s_['baseY']+(floor_above-s_['baseY'])*.57
    for side in [-1,1]:
        for x in [34.8,37.1,40.1,43.0]:
            wall=support.along((x,-13.35,z),(0,side,0),10)
            rod('Island recessed scuttle',(x,wall.y-side*.055,z),(x,wall.y+side*.035,z),.135,M['dark'],COL['Island'],vertices=16)
            fit.ring('Island scuttle frame',(x,wall.y+side*.035,z),.15,.024,'y','naval',16)
support=SupportSurface([structure_meshes['air-control']])
for side in [-1,1]:
    x=38.5;z=21.18;wall=support.along((x,-13.35,z),(0,side,0),10)
    rod('Aft conning-room scuttle',(x,wall.y-side*.055,z),(x,wall.y+side*.035,z),.135,M['dark'],COL['Island'],vertices=16)
    fit.ring('Aft conning-room scuttle frame',(x,wall.y+side*.035,z),.15,.024,'y','naval',16)
for side in [-1,1]:
    for id,below in [('bridge-walkway','island-base'),('navigation-wings','bridge-chartroom'),('compass-platform','navigation-bridge')]:
        level=S[id];body=SupportSurface([structure_meshes[below]])
        for x in [34.8,39.0,43.6]:
            z=level['baseY'];wall=body.along((x,-13.35,z-.45),(0,side,0),10)
            end=-13.35+side*(2.9 if id!='compass-platform' else 2.65)
            if id=='bridge-walkway' and side>0:end=-10.75
            fit.knee('Island wing support knee',x,wall.y,end,z,.75)
    fit.stairs('Island access stair',(30.1,-13.35+side*2.55,14.75),(34.1,-13.35+side*2.55,17.06),.65)
    fit.stairs('Bridge upper stair',(33.0,-13.35+side*2.55,17.06),(36.0,-13.35+side*2.55,19.46),.55)
    fit.ladder('Compass bridge ladder',(36.0,-13.35+side*2.05,19.46),(36.0,-13.35+side*2.05,21.64),.52)
    body=SupportSurface([structure_meshes['air-control']])
    for z in [19.8,21.2]:
        seat=body.along((36.2,-13.35,z),(0,side,0),10)
        rod('Compass ladder standoff',(36.2,-13.35+side*2.05,z),seat,.035,M['naval'],COL['Island'])
    rod('Aft compass-roof stanchion',(34.6,-13.35+side*1.35,19.46),(34.6,-13.35+side*1.35,21.48),.075,M['naval'],COL['Island'])
# The island continues below the flight-deck edge. The launch sits under it,
# on a hull-braced gallery rather than being omitted or perched on the roof.
for x in [33.8,39.0,43.5]:
    for y in [-14.8,-11.8]:
        foot=hull_support.along((x,-20,5.25),(0,1,0),20)
        rod('Island launch-gallery brace',foot,(x,y,9.35),.11,M['naval'],COL['Island'])
fit.boat('Island motor launch',38.5,-13.4,9.76,9.3,1.85,True)
for x in [35.7,41.4]:
    rod('Island launch davit',(x,-15.6,9.60),(x,-15.6,12.50),.08,M['naval'],COL['Island'])
    rod('Island launch davit head',(x,-15.6,12.5),(x,-13.4,12.5),.08,M['naval'],COL['Island'])
    rod('Island launch fall',(x,-13.4,12.5),(x,-13.4,11.1),.019,M['edge'],COL['Island'])
    for side in [-1,1]:rod('Island launch sling',(x,-13.4,11.1),(x,-13.4+side*.75,10.63),.019,M['edge'],COL['Island'])
# Aft roof access and forward optical fittings on the open compass platform.
for x,y in [(42.6,-13.35)]:
    z=S['bridge-roof']['baseY']+S['bridge-roof']['height']
    cyl('Bridge optical pedestal',(x,y,z+.40),.19,.80,M['naval'],COL['Island'],20)
    box('Optical mounting fork',(x,y,z+.85),(.4,.44,.22),M['naval'],COL['Island'])
    for offset in [-.12,.12]:rod('Bridge binocular',(x-.3,y+offset,z+.95),(x+.3,y+offset,z+.95),.08,M['edge'],COL['Island'],vertices=16)
for module in D['modules']:
    if not module['id'].startswith('director-'):continue
    x,y,z=-module['center'][2],-module['center'][0],module['center'][1]
    cyl('Director platform',(x,y,z-.92),1.35,.22,M['naval'],COL['Island'],32)
    if module['id']=='director-starboard-forward':
        floor=S['bridge-roof']['baseY']+S['bridge-roof']['height']
        cyl('Island director support trunk',(x,y,(floor+z-.92)/2),.70,z-.92-floor,M['naval'],COL['Island'],28)
    else:
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
    for x,length,y,base in [(-110,11.2,sign*4.5,deck(-110)),(-109,11.2,sign*5.1,9.57),(58,9.0,sign*10.7,deck(58))]:
        # The original boat's own cradle has a 0.16 m under-keel foot.
        z=base+.16;fit.boat('Ship boat',x,y,z,length,2.0,length>10)
        for fx in [-.27,.26]:
            dx=length*fx
            rod('Boat davit',(x+dx,y-sign*1.25,base),(x+dx,y-sign*1.25,z+3),.09,M['naval'],COL['Fittings'])
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
# S02's tandem rudders have different, rounded and balanced side profiles.
# Manually authored outline landmarks replace the identical rectangular fins.
# Keep their stable yaw IDs. S02's apparent draft is deeper than the nominal
# 8.87 m condition: preserve each outline's shape and translate its tip to that
# draft, rather than stretching the drawing. Foil thickness remains estimated.
rudders=[('aft',315,[(230,671),(241,668),(260,674),(278,683),(293,683),(298,681),(298,679),(315,683),
    (315,731),(300,731),(300,743),(329,743),(349,735),(355,739),(354,754),(350,769),(340,780),
    (325,787),(307,790),(276,790),(259,786),(246,780),(238,770),(232,755),(230,741)]),
    ('forward',563,[(507,732),(512,729),(530,731),(563,731),(563,794),(534,794),(522,789),(513,780),(508,770)])]
scale=4667/257.5
for id,stock,profile in rudders:
    x=(stock-2371.5)/scale;z0=-5.6
    pivot=empty('rudder-'+id+'.yaw',(x,0,z0),COL['Underwater'])
    shift=-8.87-(625-max(py for px,py in profile))/scale
    points=[((px-stock)/scale,(625-py)/scale+shift-z0) for px,py in profile]
    # The reconstructed afterbody has no recovered offset table. Trim the
    # concealed fin crown to its actual keel envelope, including the most
    # forward point reached at +/-35 degrees and the estimated foil thickness.
    # This preserves the exposed rounded outline without letting a moving
    # rudder penetrate the faired hull at intermediate helm angles.
    shaped=[]
    for px,pz in points:
        forward=x+(px if px>=0 else px*math.cos(math.radians(35)))+.25*math.sin(math.radians(35))
        crown=lerp(H['keelHeights'],forward+H['length']/2)-.16-z0
        point=(px,min(pz,crown))
        if not shaped or math.dist(point,shaped[-1])>1e-6:shaped.append(point)
    points=shaped
    lo=min(p[0] for p in points);hi=max(p[0] for p in points);n=len(points)
    verts=[]
    for side in [-1,1]:
        for px,pz in points:
            t=(px-lo)/(hi-lo);thickness=.035+.21*math.sin(math.pi*t)**.6
            verts.append((px,side*thickness,pz))
    faces=[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    o=mesh('Rounded balanced rudder '+id,verts,faces,M['antifouling'],COL['Underwater']);o.parent=pivot;o['assemblyId']=pivot.name
    foot=hull_support.along((x,0,-12),(0,0,1),30)
    o=rod('Rudder stock',(0,0,-1.5),(0,0,foot.z-z0+.35),.22,M['edge'],COL['Underwater'],vertices=20);o.parent=pivot;o['assemblyId']=pivot.name
for kind in ['armor','modules','compartments','obstructions']:
    for v in D[kind]:
        x,y,z=v['center'];a,b,c=v['size'];o=box(kind+':'+v['id'],(-z,-x,y),(c,a,b),M['line'],COL['Simulation'])
        o['exportRole']='simulation';o.hide_render=True;o.hide_set(True);o.display_type='WIRE'
create_flagstaffs(D)
scene['definitionHash']=D['contentHash'];scene['configuration']=D['configuration']
scene['historicalAccuracy']='Qualified reconstruction; see reports/discrepancies.md'
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'appearance'))
from surface import apply_appearance
apply_appearance(scene,M,Path(__file__).with_name('appearance.json'))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))
print('SHOKAKU SOURCE',len(scene.objects),'objects',flush=True)
