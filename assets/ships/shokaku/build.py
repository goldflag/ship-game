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
sys.path.insert(0,str(ROOT/'assets/ships/shokaku/authoring'))
from flight_deck import partition_polygon
sys.path.insert(0,str(ROOT/'assets/parts'))
from library import create_mount as shared_mount
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

def tub_wall(name,x,y,radius,bottom,top,col,segments=32,thickness=.06,arc=None):
    """One bulwark mesh: outer, inner and top faces of a circular (or partial) splinter tub."""
    a0,a1=arc or (0,math.tau);closed=arc is None;n=segments+(0 if closed else 1)
    angles=[a0+(a1-a0)*i/segments for i in range(n)]
    verts=[];faces=[]
    for a in angles:
        c,s=math.cos(a),math.sin(a)
        for r,h in [(radius,bottom),(radius,top),(radius-thickness,top),(radius-thickness,bottom)]:verts.append((x+r*c,y+r*s,h))
    for i in range(segments):
        j=(i+1)%n
        for k in range(3):faces.append((i*4+k,j*4+k,j*4+k+1,i*4+k+1))
    if not closed:
        for i in [0,n-1]:faces.append(tuple(i*4+k for k in (range(4) if i else reversed(range(4)))))
    o=mesh(name,verts,faces,M['naval'],col);return o
def prism(name,top_pts,top_z,bottom_pts,bottom_z,mat,col):
    """A lofted solid between two same-count outlines (a tapered web or pedestal)."""
    n=len(top_pts);verts=[(*p,bottom_z) for p in bottom_pts]+[(*p,top_z) for p in top_pts]
    faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    o=mesh(name,verts,faces,mat,col);bm=bmesh.new();bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();return o
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
        # Downturned trunk (pjsa108): an octagonal mouth rim, a dark recessed
        # opening behind a grille, and two struts from the hull to the trunk.
        v=s['surface']['vertices'];ring=[(-z,-x,y) for x,y,z in v[-8:]]
        x=-s['exhaust']['position'][2];depth=-.18
        for a,b in zip(ring,ring[1:]+ring[:1]):rod(s['id']+' mouth rim',a,b,.09,M['edge'],col,vertices=6)
        recess=[(px,py-depth,pz) for px,py,pz in ring]
        mesh(s['id']+' exhaust darkness',recess,[tuple(range(8)),tuple(reversed(range(8)))],M['dark'],col)
        ys=[p[2] for p in ring];zlo,zhi=min(ys)+.08,max(ys)-.08;yy=ring[0][1]-depth*.5
        for dx in range(-4,5):
            rod(s['id']+' mouth grille',(x+dx,yy,zlo+(.9 if abs(dx)>3.3 else 0)),(x+dx,yy,zhi-(.9 if abs(dx)>3.3 else 0)),.035,M['edge'],col,vertices=6)
        for zz in [10.4,10.95,11.5,12.05]:rod(s['id']+' horizontal grille',(x-4.3,yy,zz),(x+4.3,yy,zz),.03,M['edge'],col,vertices=6)
        funnel_support=SupportSurface([o])
        for dx in [-3.2,3.2]:
            foot=hull_support.along((x+dx,-20,7.2),(0,1,0),20)
            head=funnel_support.along((x+dx,-17.2,7.0),(0,0,1),10)
            rod(s['id']+' hull strut',foot,head,.13,M['naval'],col)

# pjsa108: a smoke duct along the hull side joins both trunks and runs on aft of the
# after funnel; a gallery on knees runs beneath the funnel mouths.
def octo_duct(name,x0,x1,y0,y1,z0,z1,c,col):
    oct_=[(y0,z0+c),(y0,z1-c),(y0-c*.7,z1),(y1+c,z1),(y1,z1-c),(y1,z0+c),(y1+c,z0),(y0-c*.7,z0)]
    verts=[(x,yy,zz) for x in [x0,x1] for yy,zz in oct_];n=8
    faces=[tuple(range(n)),tuple(reversed(range(n,2*n)))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    o=mesh(name,verts,faces,M['naval'],col);bm=bmesh.new();bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();return o
octo_duct('Funnel uptake duct',-18.9,11.5,-12.95,-16.2,11.25,13.75,.7,COL['Island'])
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
# Paint uses the actual authored skins, including individual plank gaps and
# faceted steel round-down, so no independently guessed height can hover.
bpy.context.view_layer.update()
paint_surfaces=[]
for support in list(COL['Flight deck'].objects):
    if support.type!='MESH' or not (support.name.startswith(('Longitudinal weathered wood planking','Steel flight-deck end')) or support.get('nodeId','').startswith('elevator-')):continue
    for face in support.data.polygons:
        ps=[support.matrix_world@support.data.vertices[i].co for i in face.vertices]
        normal=(ps[1]-ps[0]).cross(ps[2]-ps[0])
        if normal.length<1e-9 or normal.normalized().z<.8:continue
        shape=[[-p.y,-p.x] for p in ps]
        bounds=(min(p[0] for p in shape),max(p[0] for p in shape),min(p[1] for p in shape),max(p[1] for p in shape))
        owner=support.parent if support.parent and support.parent.get('nodeId','').endswith('.lift') else None
        paint_surfaces.append((shape,bounds,ps[0],normal,owner))

def paint(name, points, material=None, only_owner=None):
    """Clip a 0.5 mm coating to physical skins; retain each platform owner."""
    runtime=[[-y,0,-x] for x,y in points]
    bounds=(min(p[0] for p in runtime),max(p[0] for p in runtime),min(p[2] for p in runtime),max(p[2] for p in runtime))
    groups={}
    for shape,extent,origin,normal,owner in paint_surfaces:
        if only_owner is not None and owner!=only_owner:continue
        if bounds[1]<=extent[0] or bounds[0]>=extent[1] or bounds[3]<=extent[2] or bounds[2]>=extent[3]:continue
        _,part=partition_polygon(runtime,shape)
        verts=[]
        for y,_,z in part:
            x,yy=-z,-y
            height=origin.z-(normal.x*(x-origin.x)+normal.y*(yy-origin.y))/normal.z
            verts.append((x,yy,height+.0005))
        verts=[v for i,v in enumerate(verts) if i==0 or math.dist(v,verts[i-1])>1e-8]
        if len(verts)>1 and math.dist(verts[0],verts[-1])<1e-8:verts.pop()
        if len(verts)<3 or abs(sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(verts,verts[1:]+verts[:1])))<1e-10:continue
        vertices,faces=groups.setdefault(owner,([],[]));n=len(vertices)
        vertices.extend(verts);faces.append(tuple(range(n,n+len(verts))))
    for owner,(vertices,faces) in groups.items():
        o=mesh(name,vertices,faces,material or M['line'],COL['Flight deck'])
        if owner:o.parent=owner

for x in range(-119,109,6):
    if all(abs(x+sum(p[1] for p in s['footprint'])/len(s['footprint']))>7.3 for id,s in S.items() if id.startswith('elevator')):
        paint('Painted flight centerline',[(x-1.5,-.085),(x+1.5,-.085),(x+1.5,.085),(x-1.5,.085)])
for y in [-6.9,6.9]:paint('Landing guide line',[(-113.5,y-.05),(59.5,y-.05),(59.5,y+.05),(-113.5,y+.05)])
for y in range(-9,10,2):
    for a,b in [(-120.25,-120),(-120,-118.5),(-118.5,-111.75)]:
        paint('Afterdeck landing stripes',[(a,y-.315),(b,y-.315),(b,y+.315),(a,y+.315)])
for x in [-97,-88,-74,-64,-54,-44,-32,-10,2,13]:
    rod('Arresting cable',(x,-11.8,FD+.052),(x,11.8,FD+.052),.022,M['edge'],COL['Fittings'],vertices=6)
    for y in [-11.9,11.9]:
        box('Arrestor sheave bed',(x,y,FD-.04),(.52,.46,.12),M['naval'],COL['Fittings'])
        Fittings(helpers,M,COL['Fittings']).ring('Arrestor sheave',(x,y,FD+.025),.17,.035,'z')
for x in [19,26]:box('Stowed crash barrier sill',(x,0,FD+.042),(.17,23,.06),M['edge'],COL['Fittings'])
for id,s in S.items():
    if not id.startswith('elevator'):continue
    points=[(-z,-x) for x,z in s['footprint']]
    sign=1 if sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(points,points[1:]+points[:1]))>0 else -1
    for a,b in zip(points,points[1:]+points[:1]):
        length=math.dist(a,b);dx=-(b[1]-a[1])/length*sign*.024;dy=(b[0]-a[0])/length*sign*.024
        # A dark inset border depicts the seam without inventing a raised rod.
        # The complete coating belongs to the independently moving platform.
        paint('Lift perimeter seam',[a,b,(b[0]+dx,b[1]+dy),(a[0]+dx,a[1]+dy)],M['edge'],bpy.data.objects[id+'.lift'])

fit=Fittings(helpers,M,COL['Hangars'])
GY0,GY1,GZ=-13.0,-14.9,9.3
box('Funnel gallery deck',((-12.5+12.5)/2,(GY0+GY1)/2,GZ-.07),(25.0,abs(GY1-GY0),.14),M['steel-deck'],COL['Island'])
railing([(-12.5,GY1+.02),(12.5,GY1+.02)],GZ,'Funnel gallery',COL['Island'],.95)
for bx in range(-12,13,3):fit.col=COL['Island'];fit.knee('Funnel gallery knee',bx+.5,GY0,GY1+.2,GZ-.14,1.2)
fit.col=COL['Island'];fit.ladder('Funnel gallery ladder',(12.0,-13.35,GZ),(12.0,-13.35,10.0),.5)
fit.col=COL['Hangars']
for x in [103,109,114]:
    top=FD-.34;bottom=deck(x)
    for sign in [-1,1]:
        y=sign*min(5.0,loft_breadth(H,x,bottom)*.75)
        rod('Deck-end pillar',(x,y,bottom-.1),(x,y,top),.19,M['naval'],COL['Hangars'],vertices=10)
        rod('Deck-end diagonal',(x-2.0,y,bottom-.1),(x,y,top),.10,M['naval'],COL['Hangars'])
        fit.knee('Pierced overhang web',x,y,sign*9.2,top,2.0)
    box('Deck-end transverse girder',(x,0,top-.13),(.22,19,.28),M['naval'],COL['Hangars'])
# S02 and S10: an open upper boat deck and a lower quarterdeck under the flight-deck
# overhang. pjsa108: three tapered pylons with flared heads carry the aft end, and a
# plated bulkhead closes the hangar at the forward end of the quarterdeck.
def tapered(name,x,y,z0,z1,w0,d0,w1,d1,col,mat=None):
    """Rectangular column tapering from (w0 along x, d0 along y) at z0 to (w1,d1) at z1."""
    ring=lambda w,d:[(x-w/2,y-d/2),(x+w/2,y-d/2),(x+w/2,y+d/2),(x-w/2,y+d/2)]
    return prism(name,ring(w1,d1),z1,ring(w0,d0),z0,mat or M['naval'],col)
PX=-119.5;top=flight_level(PX)-.34
for py in [-6.5,0,6.5]:
    bottom=deck(PX)
    tapered('After flight-deck pylon',PX,py,bottom,12.6,1.3,.95,1.85,1.0,COL['Hangars'])
    tapered('After pylon flared head',PX,py,12.6,top,1.85,1.0,4.0,1.15,COL['Hangars'])
    box('After pylon foot plate',(PX,py,bottom+.04),(1.8,1.4,.08),M['naval'],COL['Hangars'])
box('After portal transverse girder',(PX,0,top-.25),(.6,27,.5),M['naval'],COL['Hangars'])
for sign in [-1,1]:fit.knee('After portal perforated knee',PX,sign*7.0,sign*13.4,top,2.0)
BX=-100.9;bottom=deck(BX);top=FD-.34
box('Hangar after bulkhead',(BX,0,(bottom+top)/2),(.3,22.8,top-bottom),M['naval'],COL['Hangars'])
box('After portal transverse girder',(BX,0,top-.25),(.6,27,.5),M['naval'],COL['Hangars'])
for sign in [-1,1]:
    fit.knee('After portal perforated knee',BX,sign*11.4,sign*13.4,top,2.0)
    fit.door('Hangar after bulkhead door',BX-.16,sign*3.2,bottom,.8,1.8)
    for yy in [6.0,8.6]:
        rod('After bulkhead scuttle',(BX-.2,sign*yy,bottom+1.6),(BX-.14,sign*yy,bottom+1.6),.14,M['dark'],COL['Hangars'],vertices=12)
    for xx in [BX-.2]:
        for zz in [bottom+.4,bottom+2.4,11.6,13.4]:box('After bulkhead stiffener',(xx,sign*1.5,zz),(.1,.1,.1),M['naval'],COL['Hangars']) if False else None
for x in [-123.2,-112,-104]:
    for sign in [-1,1]:
        y=sign*(5.8 if x<-120 else 8.7)
        rod('Boat-deck column',(x,y,deck(x)),(x,y,9.35),.095,M['naval'],COL['Hangars'],vertices=10)
    box('Boat-deck underside beam',(x,0,9.24),(.18,17.6 if x>-120 else 12,.22),M['naval'],COL['Hangars'])
boat_pts=[(-z,-x) for x,z in S['stern-boat-deck']['footprint']]
railing(boat_pts[:4],9.57,'Upper boat-deck guard',COL['Hangars'],.82)
railing(boat_pts[4:]+boat_pts[:1],9.57,'Upper boat-deck guard',COL['Hangars'],.82)
for sign in [-1,1]:
    pts=[(x,sign*loft_breadth(H,x,deck(x))) for x in [-128.70,-127.5,-126.6,-124,-119,-114,-108,-101]]
    for a,b in zip(pts,pts[1:]):
        for dz in [.35,.65,.92]:rod('Quarterdeck guard rail',(*a,deck(a[0])+dz),(*b,deck(b[0])+dz),.021,M['edge'],COL['Fittings'],vertices=6)
        rod('Quarterdeck guard stanchion',(*a,deck(a[0])),(*a,deck(a[0])+.92),.027,M['naval'],COL['Fittings'],vertices=8)
    fit.stairs('Stern boat-deck stair',(-124,sign*3.3,deck(-124)),(-119.2,sign*3.3,9.57),.72)
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

# The hull side rises flush to the upper hangar deck and the upper hangar side is
# flush with it (pjsa108), so the side gallery, webs and fittings sit on that wall.
hangar_outline=[(-z,-x) for x,z in S['upper-hangar']['footprint']]
def hangar_side(x,sign):
    hits=[]
    for (a,b),(c,d) in zip(hangar_outline,hangar_outline[1:]+hangar_outline[:1]):
        if min(a,c)<=x<=max(a,c) and a!=c:hits.append(b+(d-b)*(x-a)/(c-a))
    return max(h*sign for h in hits) if hits else 0
def mount_spans(sign,clear):
    return [(-m['position'][2]-clear,-m['position'][2]+clear) for m in D['mounts'] if m['weapon']['caliberM']>.1 and -m['position'][0]*sign>0]
def open_runs(a,b,blocked):
    runs=[(a,b)]
    for lo,hi in blocked:runs=[r for u,v in runs for r in [(u,min(v,lo)),(max(u,hi),v)] if r[1]-r[0]>1.0]
    return runs
for sign in [-1,1]:
    wall=13.0;y=sign*(wall+.675)
    blocked=mount_spans(sign,3.6)+([(-11.6,11.0),(31.0,46.5)] if sign<0 else [])
    for a,b in open_runs(-84,50,blocked):
        box('Hangar side gallery',((a+b)/2,y,10.0),(b-a,1.35,.15),M['steel-deck'],COL['Hangars'])
        railing([(a,y+sign*.65),(b,y+sign*.65)],10.08,'Hangar side gallery',COL['Hangars'],.95)
        for x in range(math.ceil(a+.5),int(b)+1,3):fit.knee('Hangar gallery knee',x,sign*wall,sign*(wall+1.3),9.93,1.2)
    for x in range(-94,93,6):
        side=hangar_side(x,sign)
        if side<12.9:continue
        fit.knee('Flight deck transverse web',x,sign*side,sign*13.95,FD-.35,1.4)
        box('Hangar shell vertical stiffener',(x,sign*(side+.03),12.2),(.07,.08,4.0),M['naval'],COL['Hangars'])
    for x in [-80,-65,-25,20,48]:
        if any(lo<x<hi for lo,hi in blocked):continue
        fit.door('Hangar access door',x,sign*13.03,10.1,.65,1.75)
        fit.vent('Hangar ventilation louver',x+2.1,sign*13.04,11.9,1.4,.75)

fit.col=COL['Armament']
for mount in D['mounts']:
    x,y,z=-mount['position'][2],-mount['position'][0],mount['position'][1]
    heavy=mount['weapon']['caliberM']>.1
    sign=1 if y>0 else -1;col=COL['Armament']
    if heavy and x>0:
        # Forward 12.7 cm pairs: rectangular platforms with chamfered outboard
        # corners, a 1 m splinter bulwark and knee brackets (pjsa108).
        inner=hangar_side(x,sign)-.05;outer=abs(y)+2.45;L2=3.0
        z-=.02  # the open twin's deck disc stands on its datum; 2 cm clear
        pts=[(x-L2,inner),(x+L2,inner),(x+L2,outer-1.1),(x+L2-1.1,outer),(x-L2+1.1,outer),(x-L2,outer-1.1)]
        poly(mount['id']+' sponson platform',[(px,sign*py) for px,py in pts],z-.25,z,M['naval'],col)
        rim=pts[1:]+[pts[0]]
        for (ax,ay),(bx,by) in zip(rim,rim[1:]):
            d=Vector((bx-ax,by-ay,0));nrm=Vector((d.y,-d.x,0)).normalized()*.06
            poly(mount['id']+' splinter bulwark',[(ax,sign*ay),(bx,sign*by),(bx-nrm.x,sign*(by-nrm.y)),(ax-nrm.x,sign*(ay-nrm.y))],z,z+1.0,M['naval'],col)
            rod(mount['id']+' bulwark cap',(ax,sign*ay,z+1.0),(bx,sign*by,z+1.0),.04,M['edge'],col,vertices=6)
        for dx in [-2.4,-.8,.8,2.4]:
            hull_side=loft_breadth(H,x+dx,z-2.0)
            fit.knee(mount['id']+' platform knee',x+dx,sign*(hull_side-.02),sign*(outer-.3),z-.25,max(.6,z-.25-(z-2.0)))
        box(mount['id']+' ready-use locker',(x-L2+.6,sign*(inner+.45),z+.38),(.75,.6,.76),M['naval'],col)
    elif heavy:
        # After 12.7 cm mounts: round tubs on a tapered pedestal web that fairs
        # into the hull side, with two diagonal struts (pjsa108).
        wall=hangar_side(x,sign) or 13.0
        if 'mod2' in mount['partId']:
            # The gas-shielded twin's turntable (r 3.31) is itself the platform: a
            # plain round floor just under it, no splinter tub.
            R=3.45;cyl(mount['id']+' sponson floor',(x,y,z-.14),R,.26,M['naval'],col,32)
        else:
            R=3.15;z-=.02  # the open twin's deck disc stands on its datum; 2 cm clear
            cyl(mount['id']+' sponson floor',(x,y,z-.13),R,.26,M['naval'],col,32)
            tub_wall(mount['id']+' splinter tub',x,y,R,z,z+.75,col)
        box(mount['id']+' tub neck',(x,sign*(wall+abs(y))/2,z-.16),(R*1.4,abs(y)-wall+.05,.24),M['naval'],col)
        foot=3.6;hb=loft_breadth(H,x,foot)
        top=[(x-2.0,sign*(wall-.04)),(x+2.0,sign*(wall-.04)),(x+1.5,sign*(abs(y)+.4*R)),(x-1.5,sign*(abs(y)+.4*R))]
        bottom=[(x-.75,sign*(hb-.04)),(x+.75,sign*(hb-.04)),(x+.45,sign*(hb+.35)),(x-.45,sign*(hb+.35))]
        prism(mount['id']+' sponson pedestal',top,z-.26,bottom,foot,M['naval'],col)
        for dx in [-1.9,1.9]:
            seat=hull_support.along((x+dx*.6,sign*(hb+4),6.2),(0,-sign,0),8)
            rod(mount['id']+' sponson strut',seat,(x+dx,sign*(abs(y)+.55*R),z-.26),.11,M['naval'],col)
        box(mount['id']+' ready-use locker',(x-R*.72,sign*(wall+.4),z+.38),(.75,.6,.76),M['naval'],col)
    else:
        # 25 mm triples in galleries below the flight-deck edge (pjsa108 hardpoints):
        # a flat seat and splinter tub (the smoke-shielded pair brings its own drum),
        # a gallery bridge to the hangar side and knee brackets on the flush wall.
        shielded='shielded' in mount['partId'];wall=hangar_side(x,sign) or 13.0
        # Open triples: an octagonal 1 m splinter tub beyond the muzzles' reach (pjsa108);
        # each tub stands on a tapered diagonal strut to the hull side.
        R=2.0 if shielded else 2.15;seg=24 if shielded else 8
        cyl(mount['id']+' sponson floor',(x,y,z-.14),R,.26,M['naval'],col,seg)
        if not shielded:
            o=tub_wall(mount['id']+' splinter tub',x,y,R,z,z+1.0,col,8)
        foot=7.6;hb=loft_breadth(H,x,foot)
        top=[(x-.45,sign*(abs(y)-.6)),(x+.45,sign*(abs(y)-.6)),(x+.3,sign*(abs(y)+.6)),(x-.3,sign*(abs(y)+.6))]
        bottom=[(x-.18,sign*(hb-.05)),(x+.18,sign*(hb-.05)),(x+.12,sign*(hb+.3)),(x-.12,sign*(hb+.3))]
        prism(mount['id']+' sponson strut',top,z-.27,bottom,foot,M['naval'],col)
        box(mount['id']+' gallery bridge',(x,sign*(wall+abs(y))/2,z-.15),(R*1.5,abs(y)-wall+.05,.28),M['naval'],col)
        for dx in [-R*.6,R*.6]:fit.knee(mount['id']+' gallery web',x+dx,sign*wall,sign*(abs(y)+R*.6),z-.28,1.8)
    shared_mount(mount,COL['Armament'],helpers,M)

light=sorted([m for m in D['mounts'] if m['weapon']['caliberM']<.1 and m['position'][0]<0],key=lambda m:m['position'][2])
for a,b in zip(light[::2],light[1::2]):
    xa,xb=-a['position'][2],-b['position'][2];zz=a['position'][1];y0=13.0;y1=abs(a['position'][0])-.4
    lo,hi=min(xa,xb),max(xa,xb)
    box('Port 25 mm gallery deck',((lo+hi)/2,(y0+y1)/2,zz-.165),(hi-lo,y1-y0,.28),M['steel-deck'],COL['Armament'])
    railing([(lo+1.6,y1+.02),(hi-1.6,y1+.02)],zz-.01,'Port 25 mm gallery',COL['Armament'],.95)
    for xx in [lo+2.0,(lo+hi)/2,hi-2.0]:fit.col=COL['Armament'];fit.knee('Port gallery knee',xx,y0,y1-.2,zz-.29,1.6)
fit.col=COL['Island']
# Distinct solid wing bulwarks and the upper windbreak replace uniform rail decks.
for id in ['bridge-walkway','navigation-wings','compass-platform','bridge-roof']:
    s_=S[id];pts=[(-z,-x) for x,z in s_['footprint']];z=s_['baseY']+s_['height']
    if id=='bridge-walkway':
        railing(pts+pts[:1],z,id,COL['Island'],.95)
    else:
        # pjsa108: solid splinter bulwarks on the wings, compass platform and roof.
        height=1.23 if id=='bridge-roof' else 1.1 if id=='navigation-wings' else 1.02
        edges=[]
        for a,b in zip(pts,pts[1:]+pts[:1]):
            cuts=[0,1]+[(x-a[0])/(b[0]-a[0]) for x in [36.0,44.0] if id=='navigation-wings' and abs(b[0]-a[0])>1e-6 and 0<(x-a[0])/(b[0]-a[0])<1]
            cuts=sorted(cuts)
            for t0,t1 in zip(cuts,cuts[1:]):
                edges.append(((a[0]+(b[0]-a[0])*t0,a[1]+(b[1]-a[1])*t0),(a[0]+(b[0]-a[0])*t1,a[1]+(b[1]-a[1])*t1)))
        for a,b in edges:
            # pjsa108: the navigation-wing deck has solid lookout bulwarks only at its
            # ends; the long sides between them carry rails.
            if id=='navigation-wings' and 36.0<(a[0]+b[0])/2<44.0:
                railing([a,b],z,id,COL['Island'],1.1);continue
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
        for x in [35.6,37.6,40.1,43.0]:
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
        for x in [35.6,39.0,43.4]:
            z=level['baseY'];wall=body.along((x,-13.35,z-.45),(0,side,0),10)
            end=-13.35+side*(2.9 if id!='compass-platform' else 2.65)
            if id=='bridge-walkway' and side>0:end=-10.75
            fit.knee('Island wing support knee',x,wall.y,end,z,.75)
    fit.stairs('Island access stair',(30.1,-13.35+side*2.55,14.75),(34.1,-13.35+side*2.55,17.06),.65)
    fit.stairs('Bridge upper stair',(33.0,-13.35+side*2.55,17.06),(36.0,-13.35+side*2.55,19.46),.55)
    fit.ladder('Compass bridge ladder',(36.0,-13.35+side*2.5,19.46),(36.0,-13.35+side*2.5,21.64),.52)
    body=SupportSurface([structure_meshes['air-control']])
    for z in [19.8,21.2]:
        seat=body.along((36.2,-13.35,z),(0,side,0),10)
        rod('Compass ladder standoff',(36.2,-13.35+side*2.5,z),seat,.035,M['naval'],COL['Island'])
# The island continues below the flight-deck edge. The launch sits under it,
# on a hull-braced gallery rather than being omitted or perched on the roof.
# Island fittings on the pjsa108 tier outlines: watertight doors on the outboard
# faces, voice pipes, ready lockers, flag lockers and life buoys on the bulwarks.
for id,zdoor in [('bridge-chartroom',36.3),('navigation-bridge',37.4)]:
    s_=S[id];body=SupportSurface([structure_meshes[id]])
    wall=body.along((zdoor,-13.0,s_['baseY']+1.0),(0,-1,0),10)
    fit.col=COL['Island'];fit.door('Island watertight door',zdoor,wall.y-.01,s_['baseY'],.7,1.75)
body=SupportSurface([structure_meshes['bridge-chartroom']])
for k,bx in enumerate([40.6,41.0,41.4]):
    wall=body.along((bx,-13.0,16.0),(0,-1,0),10)
    rod('Island voice pipe',(bx,wall.y-.07,14.75),(bx,wall.y-.07,19.3),.035,M['edge'],COL['Island'],vertices=8)
    for zz in [15.4,16.9+.08,18.3]:box('Voice pipe clip',(bx,wall.y-.035,zz),(.08,.07,.05),M['naval'],COL['Island'])
wings=S['navigation-wings']['baseY']+S['navigation-wings']['height']
compass=S['compass-platform']['baseY']+S['compass-platform']['height']
for bx,by,bz,size in [(31.6,-15.7,wings,(1.8,.55,.9)),(31.6,-11.0,wings,(1.8,.55,.9)),(45.9,-15.6,wings,(.7,.45,.8)),
                      (33.4,-15.6,compass,(.7,.45,.8)),(33.4,-11.1,compass,(.7,.45,.8)),(47.5,-15.8,S['bridge-walkway']['baseY']+S['bridge-walkway']['height'],(.9,.5,.8))]:
    box('Island ready locker',(bx,by,bz+size[2]/2),size,M['naval'],COL['Island'])
    box('Island locker lid',(bx,by,bz+size[2]+.02),(size[0]+.06,size[1]+.06,.04),M['roof'],COL['Island'])
for bx,by,bz in [(44.5,-16.33,wings+.55),(35.0,-16.18,compass+.5)]:
    fit.ring('Island life buoy',(bx,by-.06,bz),.32,.07,'y','canvas',16)
# The launch now sits outboard of the flush hangar side on the island gallery.
LY=-14.55
for x in [33.8,39.0,43.5]:
    for y in [-15.9,-14.0]:
        foot=hull_support.along((x,-20,6.0),(0,1,0),20)
        rod('Island launch-gallery brace',foot,(x,y,9.35),.11,M['naval'],COL['Island'])
fit.boat('Island motor launch',38.5,LY,9.76,9.3,1.85,True)
for x in [35.7,41.4]:
    rod('Island launch davit',(x,-15.95,9.60),(x,-15.95,12.50),.08,M['naval'],COL['Island'])
    rod('Island launch davit head',(x,-15.95,12.5),(x,LY,12.5),.08,M['naval'],COL['Island'])
    rod('Island launch fall',(x,LY,12.5),(x,LY,11.1),.019,M['edge'],COL['Island'])
    for side in [-1,1]:rod('Island launch sling',(x,LY,11.1),(x,LY+side*.75,10.63),.019,M['edge'],COL['Island'])
# Aft roof access and forward optical fittings on the open compass platform.
for x,y in [(42.6,-13.35)]:
    z=S['bridge-roof']['baseY']+S['bridge-roof']['height']
    cyl('Bridge optical pedestal',(x,y,z+.40),.19,.80,M['naval'],COL['Island'],20)
    box('Optical mounting fork',(x,y,z+.85),(.4,.44,.22),M['naval'],COL['Island'])
    for offset in [-.12,.12]:rod('Bridge binocular',(x-.3,y+offset,z+.95),(x+.3,y+offset,z+.95),.08,M['edge'],COL['Island'],vertices=16)
for module in D['modules']:
    if not module['id'].startswith('director-'):continue
    x,y,z=-module['center'][2],-module['center'][0],module['center'][1]
    if module['id']=='director-starboard-forward':
        cyl('Director platform',(x,y,z-.92),1.35,.22,M['naval'],COL['Island'],32)
        floor=S['bridge-roof']['baseY']+S['bridge-roof']['height']
        cyl('Island director support trunk',(x,y,(floor+z-.92)/2),.70,z-.92-floor,M['naval'],COL['Island'],28)
    else:
        # pjsa108: a round splinter tub on a tapered pedestal faired into the hull side.
        sg=1 if y>0 else -1;R=1.55;floor=z-.92;wall=13.0
        cyl('Director tub floor',(x,y,floor),R,.22,M['naval'],COL['Island'],24)
        tub_wall('Director splinter tub',x,y,R,floor+.11,floor+1.25,COL['Island'],24)
        box('Director tub neck',(x,sg*(wall+abs(y))/2,floor),(1.8,abs(y)-wall+.1,.22),M['naval'],COL['Island'])
        foot=6.2;hb=loft_breadth(H,x,foot)
        top=[(x-1.1,sg*(wall-.04)),(x+1.1,sg*(wall-.04)),(x+.8,sg*(abs(y)+.5)),(x-.8,sg*(abs(y)+.5))]
        bottom=[(x-.45,sg*(hb-.04)),(x+.45,sg*(hb-.04)),(x+.3,sg*(hb+.3)),(x-.3,sg*(hb+.3))]
        prism('Director pedestal',top,floor-.11,bottom,foot,M['naval'],COL['Island'])
        seat=hull_support.along((x,sg*(hb+4),8.0),(0,-sg,0),8)
        rod('Director tub strut',seat,(x,sg*(abs(y)+.9),floor-.1),.1,M['naval'],COL['Island'])
    cyl('Type 94 director pedestal',(x,y,z-.48),.48,.8,M['naval'],COL['Island'],24)
    cyl('Type 94 director enclosure',(x,y,z+.06),.80,.62,M['naval'],COL['Island'],24,r2=.7)
    rod('Type 94 optical baseline',(x,y-2.25,z+.23),(x,y+2.25,z+.23),.12,M['naval'],COL['Island'],vertices=16)
    for yy in [y-2.2,y+2.2]:box('Director prism hood',(x,yy,z+.23),(.48,.26,.34),M['naval'],COL['Island'])

# Island lookouts and signalling (pjsa108 positions): binoculars on pedestals
# inside the bulwarks, signal lamps, a searchlight sponson forward of the island
# and deck-edge lights along the flight deck.
def binocular(name,x,y,z,yaw,col):
    rod(name+' pedestal',(x,y,z),(x,y,z+.95),.06,M['naval'],col,vertices=8)
    o=box(name+' yoke',(x,y,z+1.02),(.16,.3,.14),M['naval'],col);o.rotation_euler.z=yaw
    d=Vector((math.cos(yaw),math.sin(yaw),0));side=Vector((-d.y,d.x,0))*.09
    for k in [-1,1]:
        c=Vector((x,y,z+1.1))+side*k
        rod(name+' barrel',c-d*.24,c+d*.26,.055,M['edge'],col,vertices=8)
roof=S['bridge-roof']['baseY']+S['bridge-roof']['height']
for bx,by in [(40.51,-11.64),(43.94,-11.85),(40.52,-14.96),(38.7,-11.64),(44.49,-13.28),(42.34,-14.96),(42.35,-11.64),(43.94,-14.74),(38.68,-14.96)]:
    ctr=Vector((42,-13.35));yaw=math.atan2(by-ctr.y,bx-ctr.x)
    binocular('Bridge roof binocular',bx,by,roof,yaw,COL['Island'])
compass=S['compass-platform']['baseY']+S['compass-platform']['height']
wings=S['navigation-wings']['baseY']+S['navigation-wings']['height']
walk=S['bridge-walkway']['baseY']+S['bridge-walkway']['height']
for bx,by,bz in [(33.76,-12.37,compass),(34.76,-14.66,compass),(32.31,-11.78,wings),(32.46,-14.68,wings),(47.7,-12.1,walk),(47.7,-14.5,walk)]:
    binocular('Island lookout binocular',bx,by,bz,0 if bx>40 else math.pi,COL['Island'])
for bx,by,bz in [(44.23,-15.7,wings),(35.94,-11.91,roof)]:
    rod('Signal lamp post',(bx,by,bz),(bx,by,bz+.9),.05,M['naval'],COL['Island'],vertices=8)
    cyl('Signal lamp housing',(bx,by,bz+1.12),.2,.42,M['naval'],COL['Island'],12)
    rod('Signal lamp lens',(bx,by+(-.2 if by<-13.35 else .2),bz+1.14),(bx,by+(-.24 if by<-13.35 else .24),bz+1.14),.14,M['glass'],COL['Island'],vertices=12)
SX,SY,SZ=51.49,-16.99,12.55
cyl('Searchlight sponson',(SX,SY,SZ-.1),1.15,.2,M['naval'],COL['Island'],20)
tub_wall('Searchlight sponson bulwark',SX,SY,1.15,SZ,SZ+.9,COL['Island'],20,arc=(math.pi*.1,math.pi*1.9))
box('Searchlight sponson bridge',(SX,(SY-12.98)/2,SZ-.1),(1.6,abs(SY+12.98),.2),M['naval'],COL['Island'])
for dx in [-.6,.6]:fit.knee('Searchlight sponson knee',SX+dx,-12.98,SY+.4,SZ-.2,1.3)
cyl('Searchlight pedestal',(SX,SY,SZ+.35),.22,.7,M['naval'],COL['Island'],12)
o=rod('Searchlight drum',(SX,SY+.35,SZ+1.05),(SX,SY-.45,SZ+1.05),.42,M['naval'],COL['Island'],vertices=16)
rod('Searchlight lens',(SX,SY-.45,SZ+1.05),(SX,SY-.48,SZ+1.05),.36,M['glass'],COL['Island'],vertices=16)
for dx in [-.44,.44]:rod('Searchlight trunnion arm',(SX+dx,SY,SZ+.7),(SX+dx,SY,SZ+1.05),.04,M['edge'],COL['Island'],vertices=6)
def deck_edge(x):
    hits=[]
    for (a,b),(c,d) in zip(outline,outline[1:]+outline[:1]):
        if min(a,c)<=x<=max(a,c) and a!=c:hits.append(b+(d-b)*(x-a)/(c-a))
    return min(hits),max(hits)
for zr in [-97.4,-81.82,-64.11,-40.92,-18.8,-2.46,13.69,26.48,41.09,53.45,68.18,81.1,92.77,105.85]:
    x=-(zr+.749);lo,hi=deck_edge(x)
    for yy in [lo+.25,hi-.25]:
        if -60<x<-20 and yy<0:continue
        cyl('Deck-edge light',(x,yy,FD+.05),.09,.1,M['glass'],COL['Flight deck'],8)
# Safety nets (pjsa108): hinged net panels on outrigger booms around the aft round-down
# and along both ends' deck edges, drooping outboard.
def net_panels(points):
    verts=[];faces=[]
    for (ax,ay),(bx,by) in zip(points,points[1:]):
        L=math.dist((ax,ay),(bx,by));n=max(1,round(L/2.2))
        dx,dy=(bx-ax)/L,(by-ay)/L;nx,ny=dy,-dx
        cx,cy=(ax+bx)/2,(ay+by)/2
        if nx*cx+ny*cy<0:nx,ny=-nx,-ny
        for i in range(n):
            u0,u1=i/n,(i+1)/n
            p0=(ax+(bx-ax)*u0,ay+(by-ay)*u0);p1=(ax+(bx-ax)*u1,ay+(by-ay)*u1)
            z0=flight_level(p0[0])-.22;z1=flight_level(p1[0])-.22
            q0=(p0[0]+nx*1.9,p0[1]+ny*1.9,z0-.42);q1=(p1[0]+nx*1.9,p1[1]+ny*1.9,z1-.42)
            m=len(verts);verts.extend([(*p0,z0),(*p1,z1),q1,q0,((p0[0]+p1[0])/2+nx*1.0,(p0[1]+p1[1])/2+ny*1.0,(z0+z1)/2-.36)])
            faces.extend([(m,m+1,m+4),(m+1,m+2,m+4),(m+2,m+3,m+4),(m+3,m,m+4)])
            rod('Safety-net boom',(*p0,z0+.02),q0,.035,M['naval'],COL['Fittings'],vertices=6)
            rod('Safety-net outer rail',q0,q1,.025,M['edge'],COL['Fittings'],vertices=6)
        rod('Safety-net boom',(bx,by,flight_level(bx)-.2),(bx+nx*1.9,by+ny*1.9,flight_level(bx)-.64),.035,M['naval'],COL['Fittings'],vertices=6)
    o=mesh('Safety net panels',verts,faces+[tuple(reversed(f)) for f in faces],M['dark'],COL['Fittings'])
edge=[p for p in outline]
aft=[p for p in outline if p[0]<-108.9];fore=[p for p in outline if p[0]>99.9]
def edge_run(x0,x1,sign):
    pts=[];lo,hi=deck_edge(x0),deck_edge(x1)
    return [(x,(deck_edge(x)[1] if sign>0 else deck_edge(x)[0])+sign*.02) for x in [x0,(x0+x1)/2,x1]]
ring=[(x,y) for x,y in outline if x<-108.5]
ring.sort(key=lambda p:math.atan2(p[1],-(p[0]+117)))
net_panels([(-109,deck_edge(-109)[0]-.02)]+ring+[(-109,deck_edge(-109)[1]+.02)])
for sign in [-1,1]:net_panels(edge_run(101,116.6,sign))
MX,MY=27.3,-13.35
for dx,dy in [(-1.3,-1.1),(-1.3,1.1),(1.3,0)]:rod('Tripod mast leg',(MX+dx,MY+dy,FD),(MX,MY,25.7),.15,M['naval'],COL['Island'],r2=.09)
rod('Mast topmast',(MX,MY,25.3),(MX,MY,33.9),.09,M['naval'],COL['Island'],r2=.035)
fit.ladder('Mast ladder',(MX-.3,MY,FD),(MX-.3,MY,31.5),.48)
for z in [FD+.3,18,21,24,27,30,31.4]:
    rod('Mast ladder spacer',(MX-.3,MY,z),(MX,MY,z),.035,M['naval'],COL['Island'])
for z,width in [(26.6,7.7),(30.8,4.8)]:
    rod('Signal yard',(MX,MY-width/2,z),(MX,MY+width/2,z),.063,M['naval'],COL['Island'])
    for sign in [-1,1]:rod('Signal yard stay',(MX,MY,z+2),(MX,MY+sign*width/2,z),.014,M['edge'],COL['Island'],vertices=4)
# Folding wireless masts: square lattice towers (pjsa108). The four with a reference
# counterpart stand at its positions; the fold IDs keep the original stations.
RADIO={(-80,15.5):-79.25,(-65,15.5):-65,(-48,15.5):-46.6,(-32,15.5):-32,(-65,-18.0):-63.6,(-34,-18.0):-33.4}
for (key,y),x in RADIO.items():
    pivot=empty('radio-'+str(int(key))+('-port' if y>0 else '-starboard')+'.fold',(x,y,FD-.4),COL['Island'])
    rod('Radio mast gallery seat',(x,math.copysign(12.98,y),13.0),(x,y,FD-.4),.10,M['naval'],COL['Island'])
    rod('Radio mast hinge cross-seat',(x-.4,y,FD-.4),(x+.4,y,FD-.4),.075,M['naval'],COL['Island'])
    before=set(scene.objects)
    def corner(h,i):
        w=.36*(1-h/12.0);return Vector(((1 if i in (0,1) else -1)*w,(1 if i in (0,3) else -1)*w,h))
    box('Radio mast heel plate',(0,0,.05),(.95,.95,.1),M['naval'],COL['Island'])
    box('Radio mast cap plate',(0,0,8.4),(.34,.34,.08),M['naval'],COL['Island'])
    for i in range(4):rod('Radio mast chord',corner(0,i),corner(8.4,i),.04,M['naval'],COL['Island'],vertices=6)
    levels=[0,1.4,2.8,4.2,5.6,7.0,8.4]
    for h0,h1 in zip(levels,levels[1:]):
        for i in range(4):
            j=(i+1)%4
            rod('Radio mast lacing',corner(h0,i),corner(h1,j),.017,M['edge'],COL['Island'],vertices=4)
            rod('Radio mast batten',corner(h1,i),corner(h1,j),.017,M['edge'],COL['Island'],vertices=4)
    rod('Radio topmast',(0,0,8.2),(0,0,10.2),.05,M['naval'],COL['Island'],r2=.03,vertices=8)
    rod('Radio mast yard',(-1.4,0,8.9),(1.4,0,8.9),.03,M['naval'],COL['Island'],vertices=6)
    for world_z in [23.0,23.8,24.15]:
        h=world_z-(FD-.4)
        rod('Aerial attachment crossbar',(-.5,0,h),(.5,0,h),.021,M['naval'],COL['Island'],vertices=6)
    for o in set(scene.objects)-before:o.parent=pivot;o['assemblyId']=pivot.name
for y,keys in [(15.5,[-80,-65,-48,-32]),(-18.0,[-65,-34])]:
    xs=[RADIO[(k,y)] for k in keys]
    for x0,x1 in zip(xs,xs[1:]):
        for z in [23.0,23.8,24.15]:rod('Wireless aerial',(x0,y,z),(x1,y,z),.013,M['edge'],COL['Island'],vertices=4)

fit.col=COL['Fittings']
# Scuttles: one recessed glass disc and one rim annulus each, merged per side
# (the old tube-and-ring scuttles spent most of the hull's triangles).
for sign in [-1,1]:
    verts=[];faces=[];mats=[]
    for x in range(-120,121,4):
        for z in [1.6,3.6,5.5,8.1]:
            if z>deck(x)-.35:continue
            if sign<0 and -16<x<16 and z>5:continue  # funnel uptakes
            y=sign*loft_breadth(H,x,z)
            n=len(verts);ring=[(math.cos(i*math.tau/8),math.sin(i*math.tau/8)) for i in range(8)]
            verts.extend((x+.12*c,y+sign*.012,z+.12*s_) for c,s_ in ring)
            verts.extend((x+r*c,y+sign*.028,z+r*s_) for r in [.12,.155] for c,s_ in ring)
            disc=tuple(range(n,n+8));faces.append(tuple(reversed(disc)) if sign>0 else disc);mats.append(0)
            for i in range(8):
                j=(i+1)%8;q=(n+8+i,n+8+j,n+16+j,n+16+i);faces.append(q if sign>0 else tuple(reversed(q)));mats.append(1)
    o=mesh('Hull scuttles',verts,faces,M['dark'],COL['Hull']);o.data.materials.append(M['naval'])
    for f,mi in zip(o.data.polygons,mats):f.material_index=mi
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
    # The forward pair stowed on the old open ledge beside an inset hangar; the flush
    # hangar side (pjsa108) leaves no such ledge, so only the stern boats remain.
    # pjsa108 stowage: a covered motor boat each side on the quarterdeck in davits, and
    # three on chocks on the upper boat deck.
    for x,length,y,base,davits in [(-108.05,11.2,sign*7.4,deck(-108.05),True),(-112.6,11.2,sign*4.25,9.57,False)]+([(-112.6,11.2,0,9.57,False)] if sign>0 else []):
        z=base+.16;fit.boat('Ship boat',x,y,z,length,2.0,length>10)
        for fx in [-.3,-.05,.22]:box('Boat chock',(x+length*fx,y,base+.08),(.3,1.5,.16),M['naval'],COL['Fittings'])
        if not davits:continue
        for fx in [-.27,.26]:
            dx=length*fx;hy=y+sign*1.3;top=base+2.55
            rod('Boat davit',(x+dx,hy,base),(x+dx,hy,top),.09,M['naval'],COL['Fittings'])
            rod('Davit head',(x+dx,hy,top),(x+dx,y,top-.15),.08,M['naval'],COL['Fittings'])
            rod('Boat fall',(x+dx,y,top-.15),(x+dx,y,z+1.4),.021,M['edge'],COL['Fittings'],vertices=6)
            beam=lerp([(-.32,.89),(-.13,1),(.12,.96),(.33,.76)],fx)
            sheer=lerp([(-.32,.12),(-.13,0),(.12,.04),(.33,.18)],fx)
            for side in [-1,1]:
                rod('Boat lifting bridle',(x+dx,y,z+1.4),(x+dx,y+side*beam,z+.75+sheer),.019,M['edge'],COL['Fittings'],vertices=6)

# Stern gear (pjsa108): a stern anchor in a hawse on each quarter, electric warping
# winches and rope reels on the quarterdeck.
def rope_reel(name,x,y,z,col,radius=.42,length=.9):
    box(name+' stand',(x,y,z+.28),(.5,length+.1,.56),M['naval'],col)
    rod(name+' drum',(x,y-length/2,z+radius+.3),(x,y+length/2,z+radius+.3),radius*.75,M['canvas'],col,vertices=14)
    for sy in [-1,1]:rod(name+' cheek',(x,y+sy*length/2-.03,z+radius+.3),(x,y+sy*length/2+.03,z+radius+.3),radius,M['naval'],col,vertices=16)
for sign in [-1,1]:
    x=-118.0;zz=4.45;y=sign*loft_breadth(H,x,zz)
    rod('Stern anchor hawse',(x,y-sign*.18,zz),(x,y+sign*.12,zz),.24,M['edge'],COL['Fittings'],vertices=16)
    rod('Stern anchor shank',(x,y+sign*.12,zz-.1),(x+.9,y+sign*.12,zz-1.3),.1,M['edge'],COL['Fittings'])
    rod('Stern anchor crown',(x+.55,y+sign*.12,zz-1.5),(x+1.3,y+sign*.12,zz-1.5),.12,M['edge'],COL['Fittings'])
    for dx in [.5,1.3]:box('Stern anchor fluke',(x+dx,y+sign*.14,zz-1.25),(.36,.18,.46),M['edge'],COL['Fittings'])
    wx=-124.4;wz=deck(wx);wy=sign*2.2
    box('Electric warping winch',(wx,wy,wz+.4),(1.2,.9,.8),M['naval'],COL['Fittings'])
    rod('Warping winch drum',(wx,wy-.75,wz+.62),(wx,wy+.75,wz+.62),.26,M['edge'],COL['Fittings'],vertices=14)
    for dy in [-.78,.78]:rod('Warping head',(wx,wy+dy-.1,wz+.62),(wx,wy+dy+.1,wz+.62),.32,M['edge'],COL['Fittings'],vertices=14)
    rope_reel('Stern rope reel',-126.4,sign*1.25,deck(-126.4),COL['Fittings'])
    rope_reel('Quarterdeck rope reel',-115.0,sign*2.0,deck(-115.0),COL['Fittings'])
# Small fittings at the reference's level (pjsa108 positions where it has them):
# forecastle reels, fairleads and roller fairleads, fire-hose racks and life buoys
# on the hangar front, life buoys on the after bulkhead, gallery lockers, wall hose
# reels and deck winches along the hangar sides.
def hose_rack(name,x,y,z,facing,col):
    """Wall-mounted fire-hose reel; facing is the outward unit vector (dx,dy)."""
    fx,fy=facing
    box(name+' back plate',(x+fx*.03,y+fy*.03,z),(.9 if fy else .06,.06 if fy else .9,1.1),M['naval'],col)
    c=(x+fx*.28,y+fy*.28,z+.05)
    rod(name+' reel',(c[0]-fx*.14,c[1]-fy*.14,c[2]),(c[0]+fx*.14,c[1]+fy*.14,c[2]),.34,M['canvas'],col,vertices=16)
    rod(name+' reel axle',(x+fx*.06,y+fy*.06,c[2]),(c[0]+fx*.16,c[1]+fy*.16,c[2]),.05,M['edge'],col,vertices=8)
    rod(name+' nozzle',(c[0],c[1],c[2]-.34),(c[0],c[1],c[2]-.62),.035,M['bronze'],col,vertices=8)
fc=COL['Fittings'];fit.col=fc
for sign in [-1,1]:
    for bx,by in [(102.9,6.5),(100.4,8.1)]:rope_reel('Forecastle rope reel',bx,sign*by,deck(bx),fc)
    for bx,by in [(105.1,9.3)]:
        zz=deck(bx);box('Forecastle fairlead base',(bx,sign*by,zz+.08),(1.0,.5,.16),M['naval'],fc)
        for dx in [-.25,.25]:cyl('Fairlead roller',(bx+dx,sign*by,zz+.34),.13,.36,M['edge'],fc,12)
    bx=126.2;zz=deck(bx);box('Roller fairlead base',(bx,sign*4.4,zz+.1),(.7,.6,.2),M['naval'],fc)
    rod('Roller fairlead roller',(bx,sign*4.4-.25,zz+.36),(bx,sign*4.4+.25,zz+.36),.12,M['edge'],fc,vertices=12)
    for bx2,by2 in [(109.6,8.5)]:
        zz=deck(bx2);box('Bollard bed',(bx2,sign*by2,zz+.09),(1.0,.7,.18),M['naval'],fc)
        for dx in [-.28,.28]:cyl('Mooring bollard',(bx2+dx,sign*by2,zz+.36),.17,.54,M['edge'],fc,16)
    # hangar front wall (z = -99.3) and its chamfers
    hose_rack('Hangar front fire-hose rack',99.25,sign*4.0,11.6,(1,0),fc)
    # after bulkhead life buoys and buoy boxes on the quarterdeck
    box('Life-buoy locker',(-119.8,sign*7.3,deck(-119.8)+.4),(.7,.5,.8),M['naval'],fc)
for sign,xs,wx in [(1,[-45,-27,-8,8,24,40],[24.9,38.8]),(-1,[-70,-45,-25,20,28],[36.4])]:
    for bx in xs:
        box('Gallery ready locker',(bx,sign*13.3,10.4),(.9,.5,.8),M['naval'],COL['Hangars'])
        box('Gallery locker lid',(bx,sign*13.3,10.82),(.96,.56,.04),M['roof'],COL['Hangars'])
        hose_rack('Hangar side fire-hose rack',bx+1.4,sign*13.0,11.2,(0,sign),COL['Hangars'])
    for bx in wx:
        box('Gallery deck winch',(bx,sign*13.8,10.35),(1.0,.7,.7),M['naval'],COL['Hangars'])
        rod('Gallery winch drum',(bx-.7,sign*13.8,10.5),(bx+.7,sign*13.8,10.5),.2,M['edge'],COL['Hangars'],vertices=12)
for sign in [-1,1]:
    for kind,x,y in [('inner',-106,3.6),('outer',-96,7.0)]:
        y*=sign;z=-6.2
        # The finer afterbody run (pjsa108) needs the shafts to reach further in to enter it.
        run,inset=(20,.8) if kind=='inner' else (23,.7)
        rod('Propeller shaft',(x,y,z),(x+run,y*inset,z+1.1),.22,M['edge'],COL['Underwater'],vertices=20)
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
