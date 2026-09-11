"""Original Hsienyang/Gleaves Hull A reconstruction from approved visual inspection.

Blender metres: +X bow, +Y port, +Z up. No source-model geometry or textures
are read by this recipe. Blueprint sections and original controls own the mesh.
"""
import bpy, bmesh, json, math, os, sys
from pathlib import Path
from mathutils import Vector, Matrix
from array import array
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'scripts/ships'))
sys.path.insert(0,str(ROOT/'assets/parts'))
from library import create_mount
from blender_rig import radar_pivot
out=Path(os.environ['SHIP_OUTPUT'])
definition=json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
col=bpy.data.collections.new('Hsienyang original assemblies');scene.collection.children.link(col)
materials={}
colors={'naval':(.09,.14,.16,1),'hullgray':(.085,.13,.15,1),'roof':(.10,.15,.17,1),'deck':(.105,.069,.057,1),'edge':(.08,.12,.14,1),'canvas':(.40,.41,.36,1),'dark':(.022,.029,.031,1),'glass':(.034,.061,.064,1),'underwater':(.18,.049,.027,1),'bronze':(.36,.26,.105,1),'rope':(.28,.25,.18,1),'white':(.7,.72,.7,1),'wood':(.22,.13,.07,1),'wear':(.18,.23,.25,1)}
for key,color in colors.items():
    mat=bpy.data.materials.new('Hsienyang '+key);mat.diffuse_color=color;mat.use_nodes=True
    bsdf=mat.node_tree.nodes['Principled BSDF'];bsdf.inputs['Base Color'].default_value=color;bsdf.inputs['Roughness'].default_value=.77;bsdf.inputs['Metallic'].default_value=.12 if key!='bronze' else .65
    materials[key]=mat

def mesh(name, vertices, faces, material, collection=col, smooth=False):
    data = bpy.data.meshes.new(name); data.from_pydata(vertices, [], faces); data.update()
    obj = bpy.data.objects.new(name, data); collection.objects.link(obj)
    if material: data.materials.append(material)
    for p in data.polygons: p.use_smooth = smooth
    obj['assemblyId'] = name.split('.')[0]
    return obj

def cyl(name, loc, radius, depth, material, collection=col, vertices=24, r2=None):
    r2 = radius if r2 is None else r2; depth = max(.001,depth)
    vs = [(r*math.cos(i*math.tau/vertices),r*math.sin(i*math.tau/vertices),z)
          for z,r in [(-depth/2,radius),(depth/2,r2)] for i in range(vertices)]
    fs = [(i,(i+1)%vertices,vertices+(i+1)%vertices,vertices+i) for i in range(vertices)]
    fs += [tuple(reversed(range(vertices))),tuple(range(vertices,vertices*2))]
    o = mesh(name,vs,fs,material,collection,True); o.location=loc
    o.data.polygons[-1].use_smooth=False; o.data.polygons[-2].use_smooth=False
    return o

def rod(name, a, b, r, material, collection=col, r2=None, vertices=10):
    a,b = Vector(a),Vector(b)
    o = cyl(name,(a+b)/2,r,(b-a).length,material,collection,vertices,r2)
    o.rotation_euler = (b-a).to_track_quat('Z','Y').to_euler()
    return o

def box(name, loc, dim, material, collection=col, bev=.035):
    x,y,z = (d/2 for d in dim)
    vs=[(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]
    o=mesh(name,vs,[(3,2,1,0),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7),(4,5,6,7)],material,collection)
    o.location=loc
    if bev:
        mod=o.modifiers.new('Manufactured edge radius','BEVEL'); mod.width=min(bev,min(dim)*.24); mod.segments=2
    return o

def empty(name,loc):
    o=bpy.data.objects.new(name,None);col.objects.link(o);o.location=loc
    o['nodeId']=name;o['assemblyId']=name.split('.')[0];return o

def attach(obj,parent):
    bpy.context.view_layer.update(); world=obj.matrix_world.copy()
    obj.parent=parent;obj.matrix_parent_inverse=Matrix.Identity(4);obj.matrix_world=world

def local(obj,parent,assembly=None):
    obj.parent=parent;obj.matrix_parent_inverse=Matrix.Identity(4)
    if assembly:obj['assemblyId']=assembly
    return obj

def tube_path(name,points,r,mat,sides=8,closed=False):
    pts=[Vector(p) for p in points];verts=[];n=len(pts)
    for i,p in enumerate(pts):
        delta=pts[(i+1)%n]-pts[(i-1)%n] if closed else pts[min(i+1,n-1)]-pts[max(i-1,0)]
        q=delta.to_track_quat('Z','Y')
        verts += [p+q@Vector((r*math.cos(j*math.tau/sides),r*math.sin(j*math.tau/sides),0)) for j in range(sides)]
    faces=[]
    for i in range(n if closed else n-1):
        k=(i+1)%n
        faces += [(i*sides+j,i*sides+(j+1)%sides,k*sides+(j+1)%sides,k*sides+j) for j in range(sides)]
    if not closed:faces += [tuple(reversed(range(sides))),tuple((n-1)*sides+j for j in range(sides))]
    return mesh(name,verts,faces,mat,smooth=True)

def outline_oval(cx,cy,rx,ry,n=48):return [(cx+rx*math.cos(i*math.tau/n),cy+ry*math.sin(i*math.tau/n)) for i in range(n)]
def outline_rect(x0,x1,y0,y1,c=.18):return [(x0,y0+c),(x0+c,y0),(x1-c,y0),(x1,y0+c),(x1,y1-c),(x1-c,y1),(x0+c,y1),(x0,y1-c)]

def prism(name,outline,z0,z1,mat=materials['naval'],roof=True):
    n=len(outline);vs=[(x,y,z) for z in [z0,z1] for x,y in outline]
    faces=[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]+[tuple(reversed(range(n)))]
    if roof:faces += [tuple(range(n,2*n))]
    o=mesh(name,vs,faces,mat)
    if roof:
        o.data.materials.append(materials['deck']);o.data.polygons[-1].material_index=1
    return o

def bulwark(name,outline,z,height=.85,thick=.065,closed=True):
    # Visible shell thickness and a rolled upper edge, with openings left as real openings.
    n=len(outline);center=Vector((sum(p[0] for p in outline)/n,sum(p[1] for p in outline)/n))
    inside=[]
    for p in outline:
        p=Vector(p);inside.append(tuple(p+(center-p).normalized()*thick))
    verts=[(x,y,zz) for shape,zz in [(outline,z),(outline,z+height),(inside,z+height),(inside,z)] for x,y in shape]
    faces=[]
    for i in range(n if closed else n-1):
        j=(i+1)%n
        faces.extend([(i,j,n+j,n+i),(n+i,n+j,2*n+j,2*n+i),(2*n+i,2*n+j,3*n+j,3*n+i)])
    mesh(name+'.plating',verts,faces,materials['naval'])
    tube_path(name+'.cap',[(x,y,z+height+.01) for x,y in outline],.034,materials['edge'],closed=closed)
    for i in range(0,n,max(1,n//12)):
        x,y=inside[i];rod(name+'.stiffener',(x,y,z+.07),(x,y,z+height-.035),.028,materials['edge'],vertices=6)

def rails(name,points,height=.94,closed=False,spacing=1.8):
    dense=[]
    count=len(points) if closed else len(points)-1
    for i in range(count):
        a,b=Vector(points[i]),Vector(points[(i+1)%len(points)]);steps=max(1,math.ceil((b-a).length/spacing))
        dense += [tuple(a.lerp(b,j/steps)) for j in range(steps)]
    if not closed:dense.append(points[-1])
    for p in dense:rod(name+'.stanchion',p,(p[0],p[1],p[2]+height),.024,materials['edge'],vertices=6)
    for dz in [.31,.63,height]:tube_path(name+'.lifeline',[(x,y,z+dz) for x,y,z in dense],.010 if dz<height else .017,materials['edge'],sides=6,closed=closed)

def access_gap(points,x_limit,y_min,y_max,closed=False):
    # Split a railing or bulwark at a real ladder landing, retaining all other edges.
    dense=[]
    for a,b in zip(points,points[1:]+([points[0]] if closed else [])):
        a,b=Vector(a),Vector(b);cuts=[0.0]
        if abs(b.y-a.y)>1e-6:
            for y in [y_min,y_max]:
                t=(y-a.y)/(b.y-a.y)
                if 0<t<1 and a.lerp(b,t).x<x_limit:cuts.append(t)
        dense += [tuple(a.lerp(b,t)) for t in sorted(cuts)]
    if not closed:dense.append(points[-1])
    edges=list(zip(dense,dense[1:]+([dense[0]] if closed else [])))
    valid=lambda e:not ((e[0][0]+e[1][0])/2<x_limit and y_min<(e[0][1]+e[1][1])/2<y_max)
    if closed:
        gap=next((i for i,e in enumerate(edges) if not valid(e)),None)
        if gap is None:return [dense+[dense[0]]]
        edges=edges[gap+1:]+edges[:gap+1]
    pieces=[];piece=[]
    for a,b in edges:
        if valid((a,b)):
            if not piece:piece=[a]
            piece.append(b)
        elif piece:pieces.append(piece);piece=[]
    if piece:pieces.append(piece)
    return pieces

def ladder(name,a,b,w=.55):
    a,b=Vector(a),Vector(b);n=max(2,math.ceil((b-a).length/.29))
    for side in [-1,1]:rod(name+'.rail',a+Vector((0,side*w/2,0)),b+Vector((0,side*w/2,0))+(b-a).normalized()*.65,.026,materials['edge'],vertices=8)
    for i in range(n+1):
        p=a.lerp(b,i/n);rod(name+'.rung',p+Vector((0,-w/2,0)),p+Vector((0,w/2,0)),.023,materials['naval'],vertices=8)

def stairs(name,a,b,w=.70,rail_range=(0,1),rail_height=.8):
    a,b=Vector(a),Vector(b);n=max(2,math.ceil((b.z-a.z)/.23))
    for side in [-1,1]:
        offset=Vector((0,side*w/2,0));rod(name+'.stringer',a+offset,b+offset,.06,materials['edge'])
        lo,hi=rail_range
        rod(name+'.handrail',a.lerp(b,lo)+offset+Vector((0,0,rail_height)),a.lerp(b,hi)+offset+Vector((0,0,rail_height)),.026,materials['naval'])
        for t in [lo,(lo+hi)/2,hi]:
            p=a.lerp(b,t)+offset;rod(name+'.post',p,p+Vector((0,0,rail_height)),.025,materials['naval'])
    for i in range(n+1):
        p=a.lerp(b,i/n);box(name+'.tread',p,(abs(b.x-a.x)/n+.06,w,.055),materials['roof'],bev=.006)

def portlight(name,center,normal,r=.18):
    p=Vector(center);v=Vector(normal)
    rod(name+'.rim',p-v*.012,p+v*.045,r,materials['edge'],vertices=20)
    rod(name+'.glass',p+v*.046,p+v*.055,r*.76,materials['glass'],vertices=20)
    # Rain eyebrow remains visible in close views.
    tangent=Vector((-v.y,v.x,0));up=Vector((0,0,1))
    tube_path(name+'.eyebrow',[p+v*.075+tangent*(r*1.08*math.cos(i*math.pi/10))+up*(r*1.08*math.sin(i*math.pi/10)) for i in range(11)],.018,materials['naval'],sides=6)

def door(name,x,y,z,side=1,w=.66,h=1.55):
    box(name+'.frame',(x,y-side*.035,z+h/2),(w,.12,h),materials['edge'],bev=.025)
    outline=[(x-w/2,z+.12),(x-w/2+.12,z),(x+w/2-.12,z),(x+w/2,z+.12),(x+w/2,z+h-.12),(x+w/2-.12,z+h),(x-w/2+.12,z+h),(x-w/2,z+h-.12)]
    o=mesh(name+'.gasket',[(a,y,b) for a,b in outline],[tuple(range(8))],materials['dark'])
    mesh(name+'.leaf',[(x+(a-x)*.92,y+side*.028,z+h/2+(b-z-h/2)*.97) for a,b in outline],[tuple(range(8))],materials['naval'])
    for dz in [.35,1.15]:
        rod(name+'.hinge',(x-w/2+.06,y+side*.075,z+dz-.1),(x-w/2+.06,y+side*.075,z+dz+.1),.028,materials['edge'])
        box(name+'.dog',(x+w*.33,y+side*.065,z+dz),(.14,.06,.035),materials['edge'],bev=.005)
    rod(name+'.handle',(x+w*.28,y+side*.12,z+.72),(x+w*.28,y+side*.12,z+.9),.021,materials['edge'])
    for dz in [.72,.90]:rod(name+'.handle-foot',(x+w*.28,y+side*.025,z+dz),(x+w*.28,y+side*.12,z+dz),.020,materials['edge'])

def locker(name,loc,dim=(.62,.5,.72)):
    x,y,z=loc;box(name+'.box',loc,dim,materials['naval'])
    box(name+'.lid',(x,y,z+dim[2]/2+.024),(dim[0]+.035,dim[1]+.035,.045),materials['roof'],bev=.012)
    for xx in [-.18,.18]:box(name+'.latch',(x+xx,y-dim[1]/2-.018,z+.1),(.045,.04,.11),materials['edge'],bev=.006)

h=definition['hull'];half=h['length']/2

def interp(table,s):
    for (a,u),(b,v) in zip(table,table[1:]):
        if a<=s<=b:return u+(v-u)*(s-a)/(b-a)
    return table[0][1] if s<table[0][0] else table[-1][1]
width=lambda x:interp(h['halfBreadths'],x+half)
deckz=lambda x:interp(h['deckHeights'],x+half)

def hull_breadth_at(x,z):
    station=x+half
    for a,b in zip(h['sections'],h['sections'][1:]):
        if a['station']<=station<=b['station']:
            t=(station-a['station'])/(b['station']-a['station'])
            pts=[(w+(v-w)*t,y+(q-y)*t) for (w,y),(v,q) in zip(a['points'],b['points'])]
            for (w,y),(v,q) in zip(pts,pts[1:]):
                if y<=z<=q:return w+(v-w)*(z-y)/max(.00001,q-y)
    return width(x)

def hull_height_at(x,y):
    # Author-owned hull only: seat shaft-strut roots inside the curved afterbody.
    station=x+half
    for a,b in zip(h['sections'],h['sections'][1:]):
        if a['station']<=station<=b['station']:
            t=(station-a['station'])/(b['station']-a['station'])
            pts=[(w+(v-w)*t,z+(q-z)*t) for (w,z),(v,q) in zip(a['points'],b['points'])]
            for (w,z),(v,q) in zip(pts,pts[1:]):
                if w<=abs(y)<=v:return z+(q-z)*(abs(y)-w)/max(.00001,v-w)
    raise ValueError('Shaft strut falls outside original hull')

# Blueprint station hull: deep raked stem, flared forebody, flat floor and rounded transom.
verts=[]
for section in h['sections']:
    pts=section['points'];ring=pts+[[-w,z] for w,z in reversed(pts[1:])]
    verts += [(section['station']-half,w,z) for w,z in ring]
n=len(ring);faces=[]
for i in range(len(h['sections'])-1):
    faces += [(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for j in range(n)]
faces += [tuple(reversed(range(n))),tuple((len(h['sections'])-1)*n+j for j in range(n))]
hull=mesh('hull.envelope',verts,faces,materials['hullgray'],smooth=True);hull['nodeId']='hull.surface'
# A cambered steel deck, separate from the hull's closed CPU surface.
verts=[]
for s,w in h['halfBreadths']:
    x=s-half;z=deckz(x)+.018
    verts += [(x,-w,z),(x,0,z+.07),(x,w,z)]
mesh('deck.main',verts,[(i*3+j,i*3+j+1,(i+1)*3+j+1,(i+1)*3+j) for i in range(len(h['halfBreadths'])-1) for j in range(2)],materials['deck'])
# Each major structural footprint is shared with CPU obstruction and inspection.
structures={s['id']:s for s in definition['structures']}
for s in definition['structures']:
    if 'funnel' in s['id']:continue
    outline=[(-z,-x) for x,z in s['footprint']]
    if s['id']=='machinery-aft-casing':
        # The after end leans forward and inward beneath the torpedo platform.
        # Blueprint owns the lower wall footprint; this measured taper owns
        # the roof, keeping CPU obstruction bounds outside the visible shell.
        roof_outline=[(x+.3015,y-math.copysign(.6045,y)) if x<-13 else (x,y) for x,y in outline]
        n=len(outline)
        walls=mesh(s['id']+'.walls',[(x,y,s['baseY']) for x,y in outline]+[(x,y,s['baseY']+s['height']) for x,y in roof_outline],[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]+[tuple(reversed(range(n))),tuple(range(n,2*n))],materials['naval'])
        walls.data.materials.append(materials['deck']);walls.data.polygons[-1].material_index=1
        outline=roof_outline
    else:
        prism(s['id']+'.walls',outline,s['baseY'],s['baseY']+s['height'])
    tube_path(s['id']+'.edge',[(x,y,s['baseY']+s['height']+.015) for x,y in outline],.035,materials['edge'],closed=True)
# The approved model has a narrow after machinery trunk, not a full-width
# extension beside the deck-level single AA. Keep the existing equipment datums
# seated on the lower roof through fixed foundations.
aft_machinery=structures['machinery-aft-casing']
machinery_aft_top=aft_machinery['baseY']+aft_machinery['height']
prism('machinery.aft-funnel-foundation',outline_oval(-5.6,0,1.40,1.13),machinery_aft_top,5.01)
cyl('machinery.aft-torpedo-foundation',(-12.29,0,(machinery_aft_top+5.01)/2),1.04,5.01-machinery_aft_top,materials['naval'],vertices=48)
# The after gun deck overhangs a narrower casing. Its lobes support both twins;
# it is not a pair of small isolated tubs on a full-width rectangular house.
aft_deck=structures['aft-gun-deck'];aft_top=aft_deck['baseY']+aft_deck['height']
aft_outline=[(-z,-x) for x,z in aft_deck['footprint']]
aft_port=sorted((x,y) for x,y in aft_outline if y>0)
for side in [-1,1]:
    arc=[(x,y) for x,y in aft_outline if -24.071<=x<=-18.679 and side*y>0]
    arc.sort(key=lambda p:p[0])
    bulwark('after.aa-screen',arc,aft_top,1.298,closed=False)
    for x in [-23.1,-21.5,-19.6,-25.6,-27.8,-30.8]:
        outer=min(4.70,interp(aft_port,x)-.065)
        # Closed plate with its flange seated inside the overhanging roof edge.
        vs=[(x+dx,side*y,z) for dx in [-.035,.035] for y,z in [(2.374,3.78),(outer,4.479),(2.374,4.479)]]
        mesh('after.deck-knee',vs,[(2,1,0),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)],materials['naval'])
        rod('after.deck-knee-flange',(x,side*2.374,3.78),(x,side*outer,4.479),.043,materials['edge'])
    for x in [-22.7,-20.4]:
        rod('after.aa-column',(x,side*4.35,deckz(x)),(x,side*4.35,4.479),.070,materials['naval'])
    # The source's two raised, empty lookout platforms have open rail guards.
    platform=outline_oval(-18.0,side*1.18,1.01,1.01,40)
    prism('after.lookout-platform',platform,5.76,5.812)
    for x,y in outline_oval(-18.0,side*1.18,1.01,1.01,8):
        rod('after.lookout-guard.stanchion',(x,y,5.812),(x,y,6.752),.024,materials['edge'],vertices=6)
    for dz in [.31,.63,.94]:
        tube_path('after.lookout-guard.lifeline',[(x,y,5.812+dz) for x,y in platform],.017 if dz==.94 else .010,materials['edge'],sides=6,closed=True)
    for x in [-18.65,-17.35]:
        rod('after.lookout-column',(x,side*1.18,aft_top),(x,side*1.18,5.76),.075,materials['naval'])
    rails('after.deck-rail',[(-34.86,side*1.08,aft_top),(-31.32,side*3.12,aft_top),(-27.5,side*3.12,aft_top)],.86)
# Rounded bridge wings: deck plates with substantial knees, open inboard access.
wing_edge=[(13.85,3.987),(13.893,4.193),(14.004,4.348),(14.188,4.431),(14.405,4.452),(14.44,4.437),(15.5,4.354),(17.744,4.242),(18.8,4.153),(19.3,4.09),(19.72,3.885),(20.5,3.39),(21.13,2.687)]
for side in [-1,1]:
    wing=[(13.85,side*.025)]+[(x,side*y) for x,y in wing_edge]+[(21.13,side*2.0),(15.95,side*2.0),(15.95,side*.025)]
    prism('bridge-wing.deck',wing,10.275,10.377)
    bulwark('bridge-wing.shield',[(x,side*y) for x,y in wing_edge[7:]]+[(21.13,side*2.0)],10.377,1.096,closed=False)
    rail_path=[(13.85,side*.45,10.377)]+[(x,side*y,10.377) for x,y in wing_edge[:8]]
    for segment in access_gap(rail_path,14.1,-.72,.60):rails('bridge-wing.aft-rail',segment,.94)
    for x in [14.494,15.476,16.538,17.313,18.103,18.877,19.669]:
        outer=interp(wing_edge,x)-.07
        box('bridge-wing.floor-beam',(x,side*(2.20+outer)/2,10.19),(.10,outer-2.20,.183),materials['edge'],bev=.005)
        if x in [14.494,16.538,18.103,19.669]:
            a,b=Vector((x,side*3.15,7.23)),Vector((x,side*3.65,10.10))
            o=box('bridge-wing.strut',(a+b)/2,(.10,.10,(b-a).length),materials['edge'],bev=.006)
            o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
            box('bridge-wing.strut-foot',a,(.20,.25,.075),materials['edge'],bev=.008)
            # The bracket foot is riveted to the forecastle side, below its roof.
            box('bridge-wing.strut-root',(x,side*3.06,7.23),(.20,.28,.15),materials['naval'],bev=.008)
    for y in [0,1.20,2.41,3.66]:
        box('bridge-wing.aft-longitudinal',(15.1,side*y,10.19),(2.35,.10,.183),materials['edge'],bev=.005)
    # Elevated single-AA shoulder alongside the second main gun.
    aa=outline_oval(23.85,side*2.76,1.5,1.2,40)
    prism('forward-aa.platform',aa,7.23,7.36)
    bulwark('forward-aa.screen',aa,7.36,.75)
    for xx in [22.8,24.8]:rod('forward-aa.support',(xx,side*2.8,5.3),(xx,side*2.8,7.24),.12,materials['naval'])
# The pilothouse's rounded ends and window seats use the same blueprint outline.
pilot_outline=[(-z,-x) for x,z in structures['pilot-house']['footprint']]
prism('bridge.pilot-floor',pilot_outline,10.275,10.377)
for i in range(11):
    a=-math.pi/2+i*math.pi/10
    normal=Vector((math.cos(a)/2.455,math.sin(a)/2.456,0)).normalized()
    portlight('bridge.portlight',(20.066+2.461*math.cos(a),2.462*math.sin(a),12.11),normal,.18)
for side in [-1,1]:
    for x in [17.0,18.4,19.4]:portlight('bridge.side-light',(x,side*2.462,12.11),(0,side,0),.18)
upper=[(-z,-x) for x,z in structures['pilot-house']['footprint']]
flying=[(18.687+(x-18.687)*1.016,y*1.024) for x,y in upper]
prism('bridge.flying-deck',flying,12.73,12.766)
for segment in access_gap([(x,y,0) for x,y in flying],15.25,.28,.80,closed=True):
    bulwark('bridge.flying-screen',[(x,y) for x,y,z in segment],12.766,.818,closed=False)
# A shallow projecting weather ledge follows the curved front above the windows.
visor=[]
for r,z in [(1.002,12.73),(1.105,12.55)]:
    visor += [(20.066+2.455*r*math.cos(-math.pi/2+i*math.pi/32),2.456*r*math.sin(-math.pi/2+i*math.pi/32),z) for i in range(33)]
mesh('bridge.window-visor',visor,[(i,i+1,34+i,33+i) for i in range(32)],materials['naval'])
# Original bridge fittings reconstructed from inspected approved-source views.
# Dimensions and installation datums are independent parameters, never imported meshes.
def bridge_outfit(side):
    # Separate light shelf on each lower bridge side, including its inboard arms.
    shelf=[(18.09,side*3.38),(19.68,side*3.38),(19.68,side*3.97),(18.09,side*3.97)]
    prism('bridge.light-shelf',shelf,8.731,8.751)
    for x in [18.104,19.668]:
        box('bridge.light-shelf-arm',(x,side*3.18,8.716),(.06,1.58,.055),materials['edge'],bev=.006)
        rod('bridge.light-shelf-knee',(x,side*2.45,8.34),(x,side*3.94,8.716),.030,materials['edge'],vertices=8)
    # Running-light screens: open forward, with a long inboard backplate.
    x,y,z=18.2595,side*3.5625,8.751
    box('bridge.running-light-back',(x+.675,y,z+.20),(1.35,.022,.40),materials['naval'],bev=.004)
    box('bridge.running-light-aft',(x,y+side*.20,z+.20),(.024,.40,.40),materials['naval'],bev=.004)
    box('bridge.running-light-floor',(x+.675,y+side*.20,z+.012),(1.35,.40,.024),materials['naval'],bev=.004)
    cyl('bridge.running-light',(x+.25,y+side*.21,z+.15),.085,.25,materials['glass'],vertices=16)
    cyl('bridge.running-light-cap',(x+.25,y+side*.21,z+.29),.105,.035,materials['edge'],vertices=16)
    # Source pelorus stands on a raised, braced triangular wing platform.
    px,py,pz=19.3575,side*3.738,10.7445
    plan=[(18.70,side*3.20),(20.00,side*3.39),(19.78,side*4.13),(18.70,side*4.19)]
    prism('bridge.pelorus-platform',plan,pz-.045,pz)
    for x,y in [plan[0],plan[1],plan[2]]:
        rod('bridge.pelorus-leg',(x,y,10.377),(x,y,pz-.04),.037,materials['edge'],vertices=8)
    cyl('bridge.pelorus-foot',(px,py,pz+.045),.235,.09,materials['naval'],vertices=6)
    cyl('bridge.pelorus-column',(px,py,pz+.48),.105,.81,materials['naval'],vertices=8,r2=.095)
    cyl('bridge.pelorus-neck',(px,py,pz+.91),.10,.15,materials['naval'],vertices=8,r2=.055)
    cyl('bridge.pelorus-hood',(px,py,pz+1.12),.22,.29,materials['naval'],vertices=6)
    cyl('bridge.pelorus-hood-top',(px,py,pz+1.31),.22,.09,materials['roof'],vertices=6,r2=.135)
    # Signal lamp on its shield-mounted shelf, with yoke, trunnions and shutter.
    x,y,z=17.8425,side*4.176,11.8935
    box('bridge.lamp-shelf',(x+.16,y,z-.018),(.49,.15,.045),materials['naval'],bev=.007)
    for dx in [0,.30]:rod('bridge.lamp-shelf-knee',(x+dx,y,11.46),(x+dx,y,z-.04),.026,materials['edge'],vertices=8)
    cyl('bridge.lamp-stem',(x,y,z+.09),.025,.18,materials['edge'],vertices=12)
    tube_path('bridge.lamp-yoke',[(x-.17,y,z+.35),(x-.17,y,z+.21),(x-.10,y,z+.16),(x+.10,y,z+.16),(x+.17,y,z+.21),(x+.17,y,z+.35)],.025,materials['naval'],sides=8)
    rod('bridge.lamp-body',(x,y-side*.155,z+.40),(x,y+side*.12,z+.40),.19,materials['naval'],vertices=16)
    rod('bridge.lamp-lens',(x,y+side*.121,z+.40),(x,y+side*.135,z+.40),.158,materials['glass'],vertices=20)
    for dz in [-.10,-.05,0,.05,.10]:
        halfspan=math.sqrt(.153**2-dz**2)
        box('bridge.lamp-shutter',(x,y+side*.143,z+.40+dz),(halfspan*2,.022,.012),materials['edge'],bev=.002)
    rod('bridge.lamp-trunnion',(x-.20,y,z+.35),(x+.20,y,z+.35),.039,materials['edge'],vertices=12)
    # Wing speaking tube, clamped to the inside of its screen.
    x,y,z=18.4965,side*3.9795,10.377
    tube_path('bridge.voice-tube',[(x,y,z),(x,y,z+1.31),(x,y-side*.05,z+1.40),(x,y-side*.11,z+1.41)],.025,materials['naval'],sides=10)
    rod('bridge.voice-mouth',(x,y-side*.11,z+1.41),(x,y-side*.15,z+1.41),.065,materials['edge'],vertices=12,r2=.075)
    for dz in [.50,1.0]:rod('bridge.voice-clamp',(x,y,z+dz),(x,side*4.16,z+dz),.022,materials['edge'],vertices=8)
    # Telephone's backplate sits against the wing screen, with a separate receiver.
    x,y,z=18.8925,side*4.164,11.2575
    box('bridge.telephone',(x,y-side*.05,z),(.20,.13,.30),materials['naval'],bev=.015)
    tube_path('bridge.telephone-receiver',[(x-.11,y-side*.15,z-.08),(x-.13,y-side*.16,z+.03),(x-.10,y-side*.15,z+.13)],.026,materials['dark'],sides=8)
    # Small outboard flying-deck standing platforms, with three guarded sides.
    platform=[(19.64,side*2.43),(20.60,side*2.43),(20.60,side*3.063),(19.64,side*3.063)]
    prism('bridge.flying-platform',platform,12.72,12.766)
    rails('bridge.flying-platform-guard',[(x,y,12.766) for x,y in platform[1:]+platform[:1]],.85,spacing=.7)
    for x in [19.68,20.55]:
        rod('bridge.flying-platform-knee',(x,side*2.44,12.38),(x,side*3.03,12.70),.035,materials['edge'],vertices=8)
    # Sky lookout: fixed octagonal foot, chair, U-shaped guard and binocular head.
    origin=Vector((16.311,side*1.9215,12.708));rot=Matrix.Rotation(side*math.pi/2,3,'Z')
    def p(x,y,z):return origin+rot@Vector((x,y,z))
    def b(name,loc,dim,mat=materials['naval'],bev=.012):
        o=box('bridge.lookout-'+name,p(*loc),dim,mat,bev=bev);o.rotation_euler=rot.to_euler();return o
    cyl('bridge.lookout-foot',p(0,0,.12),.23,.24,materials['naval'],vertices=8)
    b('column',(0,0,.70),(.08,.07,.96))
    rod('bridge.lookout-seat-arm',p(0,0,.40),p(-.44,0,.40),.028,materials['edge'],vertices=8)
    b('seat',(-.43,0,.47),(.34,.34,.035),materials['roof'])
    b('back-stem',(-.59,0,.61),(.05,.045,.29))
    tube_path('bridge.lookout-seat-back',[p(-.57,-.16,.73),p(-.62,-.08,.71),p(-.64,0,.70),p(-.62,.08,.71),p(-.57,.16,.73)],.027,materials['naval'],sides=8)
    tube_path('bridge.lookout-guard',[p(-.65,-.38,.94),p(-.43,-.38,1.08),p(.05,-.38,1.08),p(.12,0,1.08),p(.05,.38,1.08),p(-.43,.38,1.08),p(-.65,.38,.94)],.024,materials['edge'],sides=8)
    for sign in [-1,1]:rod('bridge.lookout-guard-brace',p(0,0,.90),p(-.35,sign*.38,1.08),.021,materials['edge'],vertices=8)
    b('instrument-table',(0,0,1.11),(.36,.31,.025),materials['roof'])
    b('optical-stem',(-.025,0,1.30),(.035,.035,.35))
    for yy in [-.071,.071]:
        b('binocular',(.008,yy,1.485),(.40,.12,.125),materials['naval'],bev=.025)
        rod('bridge.lookout-eyepiece',p(-.20,yy,1.485),p(-.25,yy,1.485),.036,materials['dark'],vertices=12)
        rod('bridge.lookout-lens',p(.209,yy,1.485),p(.218,yy,1.485),.046,materials['glass'],vertices=12)
for side in [-1,1]:bridge_outfit(side)
# The aft ladder is offset on the pilothouse, with short brackets to the curved wall.
ladder('bridge.pilot-ladder',(14.73,.535,10.377),(14.84,.535,12.766),.41)
for z in [10.52,11.55,12.55]:
    for y in [.33,.74]:rod('bridge.pilot-ladder-standoff',(14.76,y,z),(14.98,y,z),.023,materials['edge'],vertices=8)
# A door on the aft wall below the upper access ladder; rotate the authored side-door construction.
old=set(col.objects);door('bridge.pilot-door',0,0,10.40,1,w=.69,h=1.84)
rotation=Matrix.Rotation(math.pi/2,4,'Z');translation=Matrix.Translation((14.84,-.54,0))
bpy.context.view_layer.update()
for o in set(col.objects)-old:o.matrix_world=translation@rotation@o.matrix_world
# Central lower access is a vertical ladder beside the mast, offset diagonally
# in plan. Its landing has an open well and a short step onto the aft walkway.
for lo,hi,y0,y1 in [(13.73,13.89,-.716,.611),(13.33,13.73,-.716,-.60),(13.33,13.73,0,.611)]:
    prism('bridge.lower-landing',[(lo,y0),(hi,y0),(hi,y1),(lo,y1)],10.277,10.377)
ladder_a=Vector((13.30,-.187,deckz(13.30)+.025));ladder_b=Vector((13.558,-.494,deckz(13.558)+.025))
for a in [ladder_a,ladder_b]:
    rod('bridge.lower-ladder-rail',a,(a.x,a.y,11.0),.024,materials['edge'],vertices=8)
    box('bridge.lower-ladder-foot',a,(.15,.15,.055),materials['edge'],bev=.007)
    rod('bridge.lower-ladder-tab',(a.x,a.y,10.29),(13.80,a.y,10.29),.026,materials['edge'],vertices=8)
for i in range(20):
    bottom=max(ladder_a.z,ladder_b.z)+.08;z=bottom+i*(10.35-bottom)/19
    rod('bridge.lower-ladder-rung',(ladder_a.x,ladder_a.y,z),(ladder_b.x,ladder_b.y,z),.019,materials['naval'],vertices=8)
# Front light carried by a projecting flying-deck shelf.
box('bridge.front-light-shelf',(22.61,0,12.75),(.55,1.0,.035),materials['naval'],bev=.005)
for y in [-.30,0,.30]:
    box('bridge.front-light',(22.72,y,12.91),(.23,.17,.29),materials['naval'],bev=.020)
    box('bridge.front-light-glass',(22.842,y,12.91),(.015,.13,.20),materials['glass'],bev=.004)

# Original Mk37 mod2 enclosure, reconstructed from inspected principal planes.
# Local dimensions are authored here; source meshes never enter this recipe.
dcx,dbase=18.0,14.646
cyl('director.base',(dcx,0,(12.73+dbase)/2),1.493,dbase-12.73,materials['naval'],vertices=64)
cyl('director.race',(dcx,0,dbase+.050),1.548,.100,materials['edge'],vertices=64)
# Bottom plan, vertical front, then two distinct face slopes and the flat rear roof.
plan=[(-1.408,-1.410),(.191,-1.410),(1.411,-1.145),(1.411,1.145),(.191,1.410),(-1.408,1.410)]
base=[(dcx+x,y,dbase+.101) for x,y in plan]
# Profile break at x=.94 distinguishes the steep lower face from the shallow roof.
for side in [-1,1]:
    def halfwidth(x):return 1.410 if x<=.191 else 1.410-(x-.191)*(.265/1.220)
    for polygon in [[(-1.408,.101),(.191,.101),(.191,2.064),(-1.408,2.064)],[(.191,.101),(1.411,.101),(1.411,1.085),(.94,1.608),(.191,2.064)]]:
        mesh('director.side',[(dcx+x,side*halfwidth(x),dbase+z) for x,z in polygon],[tuple(range(len(polygon)))],materials['naval'])
mesh('director.floor',base,[tuple(reversed(range(6)))],materials['naval'])
tube_path('director.bottom-flange',[(dcx+x*1.02,y*1.02,dbase+.18) for x,y in plan],.023,materials['edge'],closed=True)
mesh('director.back',[(dcx-1.408,y,dbase+z) for y,z in [(-1.410,.101),(1.410,.101),(1.410,2.064),(-1.410,2.064)]],[(0,1,2,3)],materials['naval'])
mesh('director.front',[(dcx+1.411,y,dbase+z) for y,z in [(-1.145,.101),(1.145,.101),(1.145,1.085),(-1.145,1.085)]],[(0,1,2,3)],materials['naval'])
mesh('director.roof',[(dcx+x,y,dbase+2.064) for x,y in [(-1.408,-1.410),(.191,-1.410),(.191,1.410),(-1.408,1.410)]],[(0,1,2,3)],materials['naval'])
mesh('director.lower-face',[(dcx+x,y,dbase+z) for x,y,z in [(1.411,-1.145,1.085),(1.411,1.145,1.085),(.94,1.247,1.608),(.94,-1.247,1.608)]],[(0,1,2,3)],materials['naval'])
def director_roof_point(x,u):
    return Vector((dcx+x,u*(1.410-(x-.191)*(.163/.749))/1.410,dbase+2.064-(x-.191)*(.456/.749)))
# Three real open hatches in the sloped face: panel cells stop at their reveals.
xs=[.191,.35,.71,.94];us=[-1.410,-.89,-.51,-.19,.19,.51,.89,1.410]
for i,(a,b) in enumerate(zip(xs,xs[1:])):
    for j,(c,d) in enumerate(zip(us,us[1:])):
        if i==1 and j in [1,3,5]:continue
        mesh('director.upper-face',[director_roof_point(x,u) for x,u in [(a,c),(b,c),(b,d),(a,d)]],[(0,1,2,3)],materials['naval'])
for u in [-.70,0,.70]:
    opening=[director_roof_point(x,v) for x,v in [(.35,u-.19),(.71,u-.19),(.71,u+.19),(.35,u+.19)]]
    tube_path('director.hatch-coaming',opening,.025,materials['edge'],closed=True)
    inner=[p-Vector((0,0,.085)) for p in opening]
    mesh('director.hatch-reveal',opening+inner,[(i,(i+1)%4,4+(i+1)%4,4+i) for i in range(4)],materials['dark'])
    # Raised lids are hinged directly to the aft edge of each coaming.
    seat=director_roof_point(.35,u);hinge=seat+Vector((0,0,.158))
    for dy in [-.235,.235]:
        box('director.hatch-hinge-foot',seat+Vector((0,dy,.074)),(.12,.075,.17),materials['naval'],bev=.012)
    rod('director.hatch-hinge',hinge+Vector((0,-.25,0)),hinge+Vector((0,.25,0)),.032,materials['edge'])
    lid=[hinge+Vector((dx,dy,dz)) for dx,dy,dz in [(0,-.22,0),(0,.22,0),(.14,.22,.47),(.14,-.22,.47)]]
    o=mesh('director.open-hatch-lid',lid,[(0,1,2,3)],materials['naval']);o.modifiers.new('Lid thickness','SOLIDIFY').thickness=.025
    tube_path('director.hatch-lid-rim',lid,.020,materials['edge'],closed=True)
# Two glazed sight ports seated on the steeper front slope.
for y in [-.43,.43]:
    pts=[]
    for x,dy in [(1.08,-.145),(1.33,-.145),(1.33,.145),(1.08,.145)]:
        z=1.085+(1.411-x)*(.523/.471)
        pts.append((dcx+x+.012,y+dy,dbase+z+.012))
    mesh('director.front-glass',pts,[(0,1,2,3)],materials['glass'])
    tube_path('director.front-glass-rim',pts,.023,materials['edge'],closed=True)
# The small offset optical sight is carried by a bolted foot on the lower slope.
box('director.sight-foot',(dcx+1.02,-.74,dbase+1.565),(.15,.17,.10),materials['naval'],bev=.014)
cyl('director.sight-swivel',(dcx+1.02,-.74,dbase+1.67),.070,.13,materials['edge'],vertices=16)
box('director.sight-stem',(dcx+1.00,-.74,dbase+1.78),(.095,.085,.20),materials['naval'],bev=.01)
box('director.sight-head',(dcx+.99,-.74,dbase+1.905),(.30,.24,.17),materials['naval'],bev=.025)
box('director.sight-glass',(dcx+1.142,-.74,dbase+1.905),(.012,.16,.08),materials['glass'],bev=.008)
rod('director.sight-axis',(dcx+.97,-.92,dbase+1.83),(dcx+.97,-.56,dbase+1.83),.025,materials['edge'])
for lo,hi in [(-1.23,-.90),(-.60,1.23)]:
    rod('director.front-grab',(dcx+.94,lo,dbase+1.66),(dcx+.94,hi,dbase+1.66),.016,materials['edge'])
    for y in [lo,hi]:rod('director.front-grab-foot',(dcx+.94,y,dbase+1.607),(dcx+.94,y,dbase+1.66),.017,materials['edge'])
# Visible side rangefinder covers taper from tall cloth boots to the optical ends.
for side in [-1,1]:
    rings=[];n=32
    profiles=[(1.408,.276,.711,1.312,True),(1.47,.276,.711,1.312,True),(1.65,.255,.54,1.19,False),(1.82,.20,.42,1.14,False),(2.12,.14,.17,1.292,False),(2.30,.125,.125,1.292,False)]
    for y,rx,rz,cz,square in profiles:
        for i in range(n):
            t=i*math.tau/n;fold=1+.035*math.cos(t*12) if y<2.18 else 1
            a,b=math.cos(t),math.sin(t)
            if square:a,b=math.copysign(abs(a)**.25,a),math.copysign(abs(b)**.25,b);fold=1
            rings.append((dcx-.51+rx*a*fold,side*y,dbase+cz+rz*b*fold))
    mesh('director.rangefinder-cover',rings,[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(len(profiles)-1) for i in range(n)],materials['naval'],smooth=True)
    rod('director.rangefinder-end',(dcx-.51,side*2.22,dbase+1.292),(dcx-.51,side*2.439,dbase+1.292),.126,materials['naval'],vertices=24)
    rod('director.rangefinder-glass',(dcx-.51,side*2.439,dbase+1.292),(dcx-.51,side*2.445,dbase+1.292),.076,materials['glass'],vertices=20)
    # Side access ladder and fixed stand-off fastenings.
    for x in [dcx-.06,dcx+.18]:
        rod('director.side-ladder',(x,side*1.50,dbase+.47),(x,side*1.50,dbase+1.87),.018,materials['edge'])
        for z in [.50,1.82]:rod('director.ladder-standoff',(x,side*1.40,dbase+z),(x,side*1.50,dbase+z),.020,materials['edge'])
    for i in range(6):rod('director.side-rung',(dcx-.06,side*1.50,dbase+.50+i*.26),(dcx+.18,side*1.50,dbase+.50+i*.26),.018,materials['edge'])
    # Paired rows of hand steps follow the cylindrical pedestal, with real returns.
    angle=side*.72;normal=Vector((math.cos(angle),math.sin(angle),0));tangent=Vector((-math.sin(angle),math.cos(angle),0))
    for z in [12.98,13.30,13.62,13.94,14.26]:
        p=Vector((dcx,0,z))+normal*1.49
        tube_path('director.pedestal-step',[p-tangent*.19,p-tangent*.19+normal*.12,p+tangent*.19+normal*.12,p+tangent*.19],.019,materials['edge'])
    # Flat roof grab rail above the rangefinder and two aft service lids.
    tube_path('director.roof-grab',[(dcx-.84,side*1.32,dbase+2.064),(dcx-.84,side*1.32,dbase+2.14),(dcx-.24,side*1.32,dbase+2.14),(dcx-.24,side*1.32,dbase+2.064)],.016,materials['edge'])
    box('director.roof-service-lid',(dcx-.90,side*.43,dbase+2.086),(.49,.41,.044),materials['naval'],bev=.025)
    rod('director.roof-lid-hinge',(dcx-1.16,side*.43-.20,dbase+2.11),(dcx-1.16,side*.43+.20,dbase+2.11),.023,materials['edge'])
box('director.rear-cabinet',(dcx-1.67,0,dbase+1.189),(.542,.608,1.102),materials['naval'])
# The source carries no radar atop this enclosure; the SC2/SG fit stays on the mast.

# Slim round-section, raked funnels are a defining feature of this configuration.
for s in definition['structures']:
    if 'funnel' not in s['id']:continue
    name=s['id'];cx=-sum(p[1] for p in s['footprint'])/len(s['footprint']);base=s['baseY'];height=s['height'];n=48
    def ring(t,r=1):return [(cx-height*.12*t+1.36*r*math.cos(i*math.tau/n),1.1*r*math.sin(i*math.tau/n),base+height*t+.23*math.cos(i*math.tau/n)*t) for i in range(n)]
    rings=[ring(t,r) for t,r in [(0,1.36),(.12,1.03),(.90,1),(1,1.05)]]
    casing=mesh(name+'.casing',sum(rings,[]),[(k*n+j,k*n+(j+1)%n,(k+1)*n+(j+1)%n,(k+1)*n+j) for k in range(3) for j in range(n)],materials['naval'],smooth=True)
    casing.data.materials.append(materials['dark'])
    for face in casing.data.polygons:
        if face.index>=2*n:face.material_index=1
    mesh(name+'.inner-liner',ring(1,1.05)+ring(1,.91)+ring(.87,.91),[(j,(j+1)%n,n+(j+1)%n,n+j) for j in range(n)]+[(n+j,n+(j+1)%n,2*n+(j+1)%n,2*n+j) for j in range(n)]+[tuple(range(2*n,3*n))],materials['dark'],smooth=True)
    for t in [.12,.5,.94,1]:tube_path(name+'.band',ring(t,1.015 if t<1 else 1.06),.039,materials['edge'],closed=True)
    ladder(name+'.ladder',(cx+1.40,0,base+.8),(cx-height*.12+1.44,0,base+height+.1),.42)
# Raked foremast, braced maintenance platforms and the approved SC2/SG fit.
# Dimensions are independently reconstructed against the pzsd108 A-model views.
rod('mast.fore',(14.75,0,2.48),(12.12,0,25.347),.22,materials['naval'],r2=.09,vertices=20)
rod('mast.yard',(12.2,-3.24,22.79),(12.2,3.24,22.79),.068,materials['edge'])
for side in [-1,1]:
    rod('mast.yard-brace',(12.28,0,24.1),(12.2,side*3.24,22.79),.025,materials['edge'])
    # Standing rigging and halyards terminate on explicit deck fittings.
    anchor=Vector((17.944,side*2.82,12.725))
    box('bridge.shroud-outrigger',(18.095,side*2.64,12.70),(.43,.43,.045),materials['naval'],bev=.007)
    rod('bridge.shroud-outrigger-knee',(18.10,side*2.44,12.37),anchor,.025,materials['edge'],vertices=8)
    rod('rigging.forward-shroud',(12.24,side*.27,22.79),anchor,.010,materials['dark'],vertices=6)
    aft_anchor=Vector((-4.3,side*2.55,5.01))
    box('rigging.aft-shroud-foot',aft_anchor,(.20,.18,.06),materials['edge'],bev=.008)
    rod('rigging.aft-shroud',(12.28,side*.08,22.79),aft_anchor,.010,materials['dark'],vertices=6)
    for lower_y,upper_y in [(1.80,.52),(2.17,1.0),(2.55,1.75),(2.92,2.48),(3.20,3.18)]:
        rod('rigging.halyard',(12.20,side*upper_y,22.79),(13.81,side*lower_y,11.457),.009,materials['rope'],vertices=5)
        rod('bridge.halyard-post',(13.86,side*lower_y,10.277),(13.81,side*lower_y,11.50),.022,materials['edge'],vertices=8)
        rod('bridge.halyard-cleat',(13.78,side*(lower_y-.065),11.43),(13.78,side*(lower_y+.065),11.43),.013,materials['edge'],vertices=6)
        rod('bridge.halyard-cleat-foot',(13.78,side*lower_y,11.43),(13.81,side*lower_y,11.43),.019,materials['edge'],vertices=8)
    rod('bridge.halyard-rack',(13.81,side*1.30,11.45),(13.81,side*3.40,11.45),.024,materials['edge'],vertices=8)
    # Circular aerials and their posts are seated on the ends of the yard.
    y=side*3.12
    rod('mast.iff-post',(12.2,y,22.79),(12.2,y,23.805),.020,materials['edge'])
    tube_path('mast.iff-ring',[(12.2+.37*math.cos(a*math.tau/20),y+.37*math.sin(a*math.tau/20),23.45) for a in range(20)],.018,materials['edge'],closed=True)
    for a in range(4):rod('mast.iff-spoke',(12.2,y,23.58),(12.2+.37*math.cos(a*math.tau/4),y+.37*math.sin(a*math.tau/4),23.45),.013,materials['edge'])
    for z,x,reach in [(19.06,12.94,1.31),(20.5,12.77,.65),(22.04,12.59,.65)]:
        rod('mast.light-arm',(x,0,z),(x,side*reach,z),.033,materials['naval'])
        rod('mast.light-brace',(x+.08,0,z-.35),(x,side*reach,z),.023,materials['edge'])
        cyl('mast.signal-light',(x,side*reach,z+.17),.074,.28,materials['edge'],vertices=16)
        cyl('mast.light-cap',(x,side*reach,z+.325),.081,.04,materials['naval'],vertices=16)
# The source's upper access ladder runs aft of the mast to the antenna
# platform; putting it forward fouls the SG reflector during rotation.
ladder('mast.ladder',(13.81,0,7.75),(11.88,0,24.66),.32)
for z in [8.2,10.2,12.2,14.2,16.2,18.2,20.2,22.2,24.2]:
    mx=14.75-(z-2.48)*2.63/(25.347-2.48)
    lx=13.81-(z-7.75)*1.93/(24.66-7.75)
    for side in [-1,1]:rod('mast.ladder-standoff',(mx,0,z),(lx,side*.16,z),.026,materials['edge'])
# Aft antenna platform has an actual plate and diagonal roots at the mast.
platform=[(12.27,-.32),(9.55,-.43),(9.3,-.22),(9.3,.22),(9.55,.43),(12.27,.32)]
prism('mast.antenna-platform',platform,24.66,24.79)
for side in [-1,1]:rod('mast.platform-strut',(12.38,side*.09,23.55),(9.55,side*.36,24.70),.052,materials['edge'])
rod('mast.aerial-staff',(9.55,0,24.75),(9.48,0,29.32),.064,materials['naval'],r2=.028)
for z,span in [(25.58,1.18),(26.18,2.44),(29.23,.90)]:
    rod('mast.aerial-yard',(9.55,-span/2,z),(9.55,span/2,z),.025,materials['edge'])
    for side in [-1,1]:rod('mast.aerial-tip',(9.55,side*span/2,z-.11),(9.55,side*span/2,z+.13),.015,materials['edge'])
for side in [-1,1]:rod('mast.aerial-brace',(9.55,0,25.3),(9.55,side*1.15,26.18),.026,materials['edge'])
rod('mast.aerial-stay',(10.03,0,24.79),(9.55,0,26.18),.023,materials['edge'])
# Small crossed TBS aerial behind the mast, carried by a triangular bracket.
rod('mast.tbs-arm',(12.44,0,23.08),(11.22,0,23.08),.031,materials['edge'])
rod('mast.tbs-brace',(12.37,0,23.6),(11.22,0,23.08),.021,materials['edge'])
rod('mast.tbs-post',(11.22,0,23.08),(11.22,0,24.04),.012,materials['edge'])
for a in [0,math.pi/2]:rod('mast.tbs-cross',(11.22-.48*math.cos(a),-.48*math.sin(a),23.52),(11.22+.48*math.cos(a),.48*math.sin(a),23.52),.006,materials['edge'],vertices=6)

# SC2: fixed drive pedestal, rotating stepped reflector, feed bars and back truss.
cyl('radar-sc2.fixed-flange',(12.12,0,25.37),.24,.05,materials['edge'],vertices=24)
cyl('radar-sc2.fixed-drive',(12.12,0,25.60),.17,.44,materials['naval'],vertices=24)
moving=set(col.objects)
cyl('radar-sc2.rotating-race',(12.12,0,25.845),.18,.065,materials['edge'],vertices=24)
outline=[(-1.945,25.95),(1.945,25.95),(1.945,27.14),(1.28,27.14),(1.28,27.54),(-1.28,27.54),(-1.28,27.14),(-1.945,27.14)]
def scx(y):return 12.84+.16*(y/1.945)**2
tube_path('radar-sc2.frame',[(scx(y),y,z) for y,z in outline],.027,materials['naval'],sides=8,closed=True)
for i in range(29):
    y=-1.90+i*3.80/28;top=27.53 if abs(y)<1.28 else 27.13
    rod('radar-sc2.grid-upright',(scx(y),y,25.96),(scx(y),y,top),.007,materials['edge'],vertices=6)
for i in range(11):
    z=25.98+i*.111
    tube_path('radar-sc2.grid-cross',[(scx(y),y,z) for y in [-1.94,-1.3,-.65,0,.65,1.3,1.94]],.006,materials['edge'],sides=5)
for y in [-1.28,-.64,0,.64,1.28]:rod('radar-sc2.stiffener',(scx(y)-.02,y,25.95),(scx(y)-.02,y,27.54 if abs(y)<1.3 else 27.14),.020,materials['naval'])
for y in [-1.72,-.86,0,.86,1.72]:
    rod('radar-sc2.feed-arm',(scx(y),y,26.63),(13.015,y,26.63),.023,materials['naval'])
    rod('radar-sc2.feed-dipole',(13.015,y,26.42),(13.015,y,26.89),.014,materials['edge'])
for y,z in [(-1.94,25.96),(1.94,25.96),(-1.28,27.52),(1.28,27.52)]:
    rod('radar-sc2.back-brace',(scx(y),y,z),(11.50,0,26.36),.023,materials['edge'])
rod('radar-sc2.kingpost',(12.12,0,25.85),(12.12,0,26.42),.063,materials['edge'])
rod('radar-sc2.back-cross',(11.50,0,26.36),(12.90,0,26.36),.027,materials['edge'])
radar_pivot('radar-sc2.yaw',(12.12,0,25.8465),list(set(col.objects)-moving))

# SG: forward platform, fixed motor casing and shallow curved rotating reflector.
prism('mast.sg-platform',[(12.24,-.22),(13.26,-.28),(13.39,0),(13.26,.28),(12.24,.22)],23.85,23.925)
for side in [-1,1]:rod('mast.sg-platform-brace',(12.42,side*.08,23.48),(13.16,side*.22,23.85),.035,materials['edge'])
cyl('radar-sg.fixed-flange',(13.03,0,23.95),.26,.06,materials['edge'],vertices=24)
cyl('radar-sg.motor',(13.03,0,24.16),.20,.36,materials['naval'],vertices=24)
cyl('radar-sg.spindle',(13.03,0,24.38),.083,.19,materials['edge'],vertices=20)
for a in range(8):
    x=13.03+.21*math.cos(a*math.tau/8);y=.21*math.sin(a*math.tau/8)
    rod('radar-sg.motor-rib',(x,y,24.03),(x,y,24.30),.020,materials['edge'])
moving=set(col.objects)
cyl('radar-sg.race',(13.03,0,24.4245),.22,.12,materials['edge'],vertices=24)
rod('radar-sg.reflector-post',(13.03,0,24.46),(13.03,0,24.82),.048,materials['naval'])
def sgx(y):return 12.64+.60*(y/.64)**2
vv=[];ny=25
for dx in [-.009,.009]:
    for z in [24.61,25.14]:
        for i in range(ny):
            y=-.64+1.28*i/(ny-1);rounding=.055*(abs(y)/.64)**12
            vv.append((sgx(y)+dx,y,z+rounding*(1 if z<24.8 else -1)))
ff=[]
for i in range(ny-1):ff += [(i,i+1,ny+i+1,ny+i),(2*ny+i,3*ny+i,3*ny+i+1,2*ny+i+1),(i,2*ny+i,2*ny+i+1,i+1),(ny+i,ny+i+1,3*ny+i+1,3*ny+i)]
ff += [(0,ny,3*ny,2*ny),(ny-1,3*ny-1,4*ny-1,2*ny-1)]
mesh('radar-sg.reflector',vv,ff,materials['naval'],smooth=True)
for z in [24.61,25.14]:tube_path('radar-sg.reflector-rim',[(sgx(y),y,z+.055*(abs(y)/.64)**12*(1 if z<24.8 else -1)) for y in [-.64+i*1.28/24 for i in range(25)]],.017,materials['edge'],sides=6)
for y in [-.55,0,.55]:rod('radar-sg.back-rib',(sgx(y)-.015,y,24.64),(sgx(y)-.015,y,25.11),.016,materials['edge'])
for y in [-.48,.48]:rod('radar-sg.dish-brace',(13.03,0,24.68),(sgx(y),y,24.86),.022,materials['edge'])
radar_pivot('radar-sg.yaw',(13.03,0,24.4245),list(set(col.objects)-moving))
rod('mast.aft',(-22.8,0,aft_top),(-23.5,0,12.75),.08,materials['edge'],r2=.025)
rod('mast.aft-yard',(-23.3,-1.5,10.2),(-23.3,1.5,10.2),.032,materials['edge'])
rod('rigging.main-aerial',(12.2,0,25),(-23.5,0,12.6),.011,materials['dark'],vertices=6)
# Installed original catalog geometry, with fixed supports down to actual decks.
for m in definition['mounts']:
    if m['battery']!='main':continue
    a,z,c=m['position'];x,y=-c,-a
    support=next((s['baseY']+s['height'] for s in definition['structures'] if s['id']==('forward-deckhouse' if m['id']=='gun-2' else 'aft-deckhouse')),None) if m['id'] in ['gun-2','gun-3'] else deckz(x)
    top=z-.48
    if top>support:cyl(m['id']+'.deck-foundation',(x,y,(support+top)/2),1.30,top-support,materials['naval'],vertices=48)
    create_mount(m,col,dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials)
# Light AA foundations and open access shields, each fixed to a real deck.
for m in definition['mounts']:
    if m['battery']=='main':continue
    a,z,c=m['position'];x,y=-c,-a;side=1 if y>0 else -1
    if x<0 and m['id'] not in ['oerlikon-7','oerlikon-8']:
        shape=outline_oval(x,y,1.45,1.12,40)
        prism(m['id']+'.platform',shape,z-.12,z,materials['roof'])
        arc=[(x+1.45*math.cos(i*math.pi/24),y+side*1.12*math.sin(i*math.pi/24)) for i in range(25)]
        bulwark(m['id']+'.screen',arc,z,.75,closed=False)
        # Plate knees attach the overhang to the deckhouse face / main deck.
        foot=deckz(x)+.06
        for dx in [-.9,.9]:
            rod(m['id']+'.platform-leg',(x+dx,y,foot),(x+dx,y,z-.08),.065,materials['naval'])
            rod(m['id']+'.platform-knee',(x+dx,y-side*.65,foot),(x+dx,y+side*.65,z-.10),.06,materials['edge'])
    create_mount(m,col,dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials)
    for dx in [-1.05,1.05]:
        # Compact ammunition lockers clear the mount's swept shoulder-rest envelope.
        locker(m['id']+'.ready-locker',(x+dx,y-side*.84,z+.32),(.51,.42,.64))

# Two original Mk14 quintuple banks. Fixed rings support the complete rotating
# saddle; independent yaw owners retain the ten muzzle sockets on publication.
for launcher in definition['torpedoLaunchers']:
    a,z,c=launcher['position'];x,y=-c,-a;name=launcher['id']
    cyl(name+'.fixed-ring',(x,y,z+.10),1.29,.20,materials['edge'],vertices=64)
    for i in range(28):
        t=i*math.tau/28;cyl(name+'.ring-bolt',(x+1.19*math.cos(t),y+1.19*math.sin(t),z+.22),.027,.04,materials['wear'],vertices=6)
    pivot=empty(name+'.yaw',(x,y,z));before=set(col.objects)
    cyl(name+'.rotating-race',(x,y,z+.27),1.13,.17,materials['naval'],vertices=48)
    for dx in [-2.75,-.6,1.65]:
        box(name+'.saddle-beam',(x+dx,y,z+.45),(.23,3.27,.30),materials['edge'])
        for yy in [-1.05,1.05]:rod(name+'.saddle-brace',(x,y+yy,z+.32),(x+dx,y+yy,z+.47),.064,materials['naval'])
    for tube in [t for t in definition['torpedoTubes'] if t['launcherId']==name]:
        a,b,c=tube['position'];m=Vector((-c,-a,b));rear=m-Vector((6.50,0,0))
        rod(name+'.tube',rear,m,.304,materials['naval'],vertices=32)
        for dx in [.10,1.65,3.30,5.00,6.38]:
            p=m-Vector((dx,0,0));rod(name+'.tube-band',p-Vector((.034,0,0)),p+Vector((.034,0,0)),.321,materials['edge'],vertices=24)
        # Hinged circular covers, gasket, dogs, hinges and longitudinal air lines.
        for end,direction in [(m,1),(rear,-1)]:
            rod(name+'.end-ring',end-Vector((.018,0,0)),end+Vector((.035,0,0)),.322,materials['edge'],vertices=32)
            rod(name+'.end-door',end+Vector((direction*.036,0,0)),end+Vector((direction*.054,0,0)),.286,materials['naval'],vertices=24)
            for k in range(8):
                t=k*math.tau/8;p=end+Vector((direction*.065,.29*math.cos(t),.29*math.sin(t)))
                box(name+'.cover-dog',p,(.043,.045,.07),materials['edge'],bev=.008)
            tube_path(name+'.cover-handle',[end+Vector((direction*.073,-.10,.13)),end+Vector((direction*.12,-.10,.13)),end+Vector((direction*.12,.10,.13)),end+Vector((direction*.073,.10,.13))],.016,materials['edge'])
        for yy,dz in [(.28,.13),(-.28,.13)]:rod(name+'.air-line',rear+Vector((.25,yy,dz)),m+Vector((-.25,yy,dz)),.022,materials['edge'],vertices=8)
        for dx in [-2.8,-1.3,.2,1.7,2.8]:
            box(name+'.rail-shoe',(x+dx,m.y,m.z+.31),(.11,.31,.08),materials['naval'],bev=.007)
        rod(name+'.upper-rail',rear+Vector((.3,0,.36)),m+Vector((-.25,0,.36)),.029,materials['edge'])
        socket=empty(tube['id']+'.muzzle',m);attach(socket,pivot)
    # The source has an open trainer forward and a taller enclosed trainer aft.
    tx=x-2.35
    prism(name+'.trainer-platform',outline_rect(tx-.72,tx+.68,-.71,.71,.15),z+.39,z+.53,materials['roof'])
    for side in [-1,1]:rod(name+'.platform-support',(x-1.8,side*.62,z+.42),(tx+.58,side*.62,z+.44),.068,materials['edge'])
    if name=='torpedo-aft':
        cyl(name+'.trainer-cabin',(tx,0,z+1.53),.64,2.0,materials['naval'],vertices=40)
        cyl(name+'.trainer-roof',(tx,0,z+2.56),.67,.07,materials['roof'],vertices=40)
        for side in [-1,1]:portlight(name+'.trainer-window',(tx,side*.647,z+2.13),(0,side,0),.13)
        door(name+'.trainer-door',tx,-.642,z+.58,-1,w=.51,h=1.45)
    else:
        arc=[(tx+.66*math.cos(t*math.pi/24),.66*math.sin(t*math.pi/24)) for t in range(49)]
        bulwark(name+'.trainer-screen',arc,z+.53,1.20,closed=False)
        cyl(name+'.sight-pedestal',(tx-.2,0,z+1.10),.105,1.15,materials['edge'],vertices=16)
        box(name+'.sight-head',(tx-.20,0,z+1.83),(.38,.21,.22),materials['naval'])
    ladder(name+'.trainer-ladder',(tx+.61,0,z+.04),(tx+.61,0,z+.53),.38)
    for yy in [-.42,.42]:
        tube_path(name+'.trainer-wheel',[(tx-.10+.20*math.cos(i*math.tau/24),yy,z+1.05+.20*math.sin(i*math.tau/24)) for i in range(24)],.018,materials['edge'],closed=True)
        rod(name+'.wheel-shaft',(tx-.10,0,z+1.05),(tx-.10,yy,z+1.05),.035,materials['edge'])
    for piece in set(col.objects)-before:
        if piece.type=='MESH':attach(piece,pivot)

# Stern roller tracks and two K-guns, using original fleet drum construction.
def charge(name,center,axis='Y'):
    p=Vector(center);v=Vector((0,.34,0) if axis=='Y' else (.34,0,0))
    rod(name+'.drum',p-v,p+v,.245,materials['naval'],vertices=24)
    for t in [-1,1]:
        q=p+v*t*.90;rod(name+'.rim',q-v*.05,q+v*.05,.264,materials['edge'],vertices=24)
    rod(name+'.hydrostatic-plug',p+v,p+v*1.08,.065,materials['bronze'],vertices=12)
for launcher in definition['depthChargeLaunchers']:
    a,z,c=launcher['position'];x,y=-c,-a;name=launcher['id'];empty(name+'.release',(x,y,z))
    if 'rack' in name:
        for side in [-1,1]:
            yy=y+side*.41
            box(name+'.angle-track',(x+2.40,yy,z-.24),(5.15,.07,.16),materials['edge'],bev=.008)
            rod(name+'.upper-guard',(x-.13,yy,z+.30),(x+4.94,yy,z+.30),.029,materials['naval'])
            for dx in [.3,1.75,3.2,4.7]:rod(name+'.leg',(x+dx,yy,deckz(x+dx)),(x+dx,yy,z+.31),.032,materials['edge'])
        for i in range(8):charge(name,(x+.15+i*.61,y,z+.035))
        for i in range(23):rod(name+'.roller',(x+i*.22,y-.39,z-.21),(x+i*.22,y+.39,z-.21),.038,materials['wear'],vertices=10)
        box(name+'.stop-gate',(x-.12,y,z+.12),(.045,.83,.09),materials['naval'])
    else:
        side=1 if y>0 else -1;floor=deckz(x)
        cyl(name+'.foot',(x,y,floor+.06),.29,.12,materials['edge'],vertices=24)
        rod(name+'.mortar',(x,y,floor+.13),(x,y+side*.25,z-.15),.105,materials['naval'],vertices=20)
        box(name+'.cradle',(x,y,z-.03),(.58,.38,.13),materials['edge'])
        charge(name,(x,y,z+.22),'X')
        for dx in [-.4,.4]:rod(name+'.brace',(x+dx,y,floor+.10),(x,y,z-.03),.032,materials['edge'])
        charge(name+'.ready',(x+.78,y-side*.32,floor+.34),'X')
        box(name+'.ready-chock',(x+.78,y-side*.32,floor+.10),(.76,.56,.11),materials['edge'])

# Original boats, davits and life floats, positioned against the approved views.
for side in [-1,1]:
    cx,cy,z=9.9,side*4.15,4.62;L=6.7;B=1.58
    stations=[(-L/2,.02,.43),(-L*.4,.48,.12),(-L*.25,.83,-.20),(0,1,-.30),(L*.25,.83,-.12),(L*.4,.46,.16),(L/2,.02,.48)]
    vs=[]
    for dx,w,k in stations:
        for yy,zz in [(-w*B/2,.49),(-w*B*.43,.08),(0,k),(w*B*.43,.08),(w*B/2,.49)]:vs.append((cx+dx,cy+yy,z+zz))
    fs=[(i*5+j,(i+1)*5+j,(i+1)*5+j+1,i*5+j+1) for i in range(6) for j in range(4)]
    boat=mesh('boats.whaleboat',vs,fs,materials['naval'],smooth=True)
    mod=boat.modifiers.new('Original boat skin','SOLIDIFY');mod.thickness=.045
    for sign in [-1,1]:tube_path('boats.gunwale',[(cx+dx,cy+sign*w*B/2,z+.49) for dx,w,k in stations],.043,materials['edge'])
    for dx in [-2,-.8,.6,1.85]:
        breadth=interp([(a,w) for a,w,k in stations],dx)*B
        box('boats.thwart',(cx+dx,cy,z+.32),(.25,breadth*.92,.07),materials['wood'])
    box('boats.floor',(cx,cy,z+.015),(3.7,.74,.06),materials['wood'])
    for dx in [-2.1,2.1]:
        x=cx+dx;y=side*3.55;head=7.32
        tube_path('boats.davit',[(x,y,deckz(x)),(x,y,head-.45),(x,side*3.8,head),(x,side*4.35,head)],.085,materials['naval'],sides=12)
        cyl('boats.davit-foot',(x,y,deckz(x)+.10),.20,.20,materials['edge'])
        rod('boats.block-pin',(x-.08,side*4.35,head),(x+.08,side*4.35,head),.09,materials['edge'],vertices=16)
        rod('boats.fall',(x,side*4.35,head-.08),(x,cy,z+.65),.013,materials['rope'],vertices=6)
        breadth=interp([(a,w) for a,w,k in stations],dx)*B/2
        for sign in [-1,1]:rod('boats.lifting-bridle',(x,cy,z+.65),(x,cy+sign*breadth,z+.49),.018,materials['rope'])
        # Resting keel chocks and lashings carry the boat independently of its falls.
        box('boats.chock',(x,cy,z-.12),(.22,1.0,.23),materials['wood'])
        rod('boats.chock-bracket',(x,side*3.0,3.6),(x,cy,z-.19),.07,materials['edge'])
        for sign in [-1,1]:rod('boats.chock-strap',(x,cy+sign*.46,z-.02),(x,cy+sign*breadth,z+.51),.021,materials['rope'])

def life_float(name,origin,rotation):
    # Original capsule and outfit. Approved model: 3.108 x 1.719 x .342 m.
    # Installation supplies its measured datum and orientation.
    origin=Vector(origin)
    def p(x,y,z):return origin+rotation@Vector((x,y,z))
    outline=[]
    for cx,start in [(.6945,-math.pi/2),(-.6945,math.pi/2)]:
        outline += [(cx+.6885*math.cos(start+i*math.pi/16),.6885*math.sin(start+i*math.pi/16)) for i in range(17)]
    tube_path(name+'.float',[p(x,y,.171) for x,y in outline],.171,materials['canvas'],sides=12,closed=True)
    # Recessed floor seats inside the ring, carrying the crossed paddles and
    # lashed supply blocks visible in the approved source's top view.
    inner=[]
    for cx,start in [(.6945,-math.pi/2),(-.6945,math.pi/2)]:
        inner += [Vector((cx+.5485*math.cos(start+i*math.pi/16),.5485*math.sin(start+i*math.pi/16))) for i in range(17)]
    tube_path(name+'.floor-edge',[p(q.x,q.y,.072) for q in inner],.018,materials['rope'],sides=6,closed=True)
    for slope in [-1,1]:
        for step in range(-24,25):
            c=step*.075;ends=[]
            for a,b in zip(inner,inner[1:]+inner[:1]):
                da=a.x+slope*a.y-c;db=b.x+slope*b.y-c
                if da*db<0:ends.append(a.lerp(b,da/(da-db)))
            if len(ends)==2:
                a,b=ends;rod(name+'.floor-lattice',p(a.x,a.y,.074),p(b.x,b.y,.074),.012,materials['rope'],vertices=6)
    for cx,cy,L,W,H in [(0,-.395,.50,.23,.23),(0,-.19,.43,.18,.18)]:
        o=box(name+'.supply',p(cx,cy,.095+H/2),(L,W,H),materials['canvas'],bev=.025)
        o.rotation_euler=rotation.to_euler()
    for x in [-.063,.075]:
        tube_path(name+'.supply-lashing',[p(x,-.52,.10),p(x,-.52,.33),p(x,-.28,.33),p(x,-.09,.275),p(x,-.09,.10)],.009,materials['rope'],sides=6)
    for sign in [-1,1]:
        a=Vector((-.61,sign*.29));b=Vector((.57,-sign*.16))
        if sign<0:a,b=b,a
        v=(b-a).normalized();n=Vector((-v.y,v.x))
        rod(name+'.paddle-shaft',p(a.x,a.y,.098),p(b.x,b.y,.098),.012,materials['wood'],vertices=8)
        blade=[a+v*.02+n*.035,a-v*.02+n*.07,a-v*.25+n*.055,a-v*.29,a-v*.25-n*.055,a-v*.02-n*.07,a+v*.02-n*.035]
        o=mesh(name+'.paddle-blade',[p(q.x,q.y,.098) for q in blade],[tuple(range(len(blade)))],materials['wood'])
        o.modifiers.new('Paddle thickness','SOLIDIFY').thickness=.014
    # Fine wrapping bands sit on the flotation tube and retain a separate
    # authored mesh; no source mesh or texture is an input to this recipe.
    for i,(x,y) in enumerate(outline):
        prev=Vector(outline[(i-1)%len(outline)]);nxt=Vector(outline[(i+1)%len(outline)])
        tangent=(nxt-prev).normalized();normal=Vector((-tangent.y,tangent.x))
        tube_path(name+'.wrapping',[p(x+normal.x*.172*math.cos(a),y+normal.y*.172*math.cos(a),.171+.172*math.sin(a)) for a in [j*math.tau/12 for j in range(12)]],.006,materials['rope'],sides=5,closed=True)

def aft_float_rack(side):
    # The outer X-frame reaches the deck; sloping bearers support the lower
    # float across its width and seat beneath the inboard roof edge.
    def beam(name,a,b,width=.09,depth=.05):
        a,b=Vector(a),Vector(b)
        o=box('floats.aft-rack.'+name,(a+b)/2,(width,depth,(b-a).length),materials['edge'],bev=.008)
        o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    x1,x2=-26.64,-24.99
    low=deckz(-25.82)+.04
    for x in [x1,x2]:
        box('floats.aft-rack.foot',(x,side*5.03,low-.025),(.22,.20,.045),materials['edge'],bev=.005)
        beam('leg',(x,side*5.03,low),(x,side*5.03,4.179))
        beam('bearer',(x,side*3.08,4.468),(x,side*5.03,4.149),.09,.07)
    y,top=side*5.03,4.129
    beam('top-tie',(x1,y,top-.035),(x2,y,top-.035),.10,.06)
    beam('bottom-tie',(x1,y,low+.07),(x2,y,low+.07),.09,.06)
    for a,b in [(x1,x2),(x2,x1)]:beam('cross-brace',(a,y,low+.10),(b,y,top-.10),.10,.035)
    box('floats.aft-rack.gusset',((x1+x2)/2,y,(low+top)/2),(.22,.065,.22),materials['edge'],bev=.005)

for side in [-1,1]:
    bridge_rotation=Matrix.Rotation(-side*math.radians(48.874),3,'X')
    bridge_origin=Vector((19.068,3.8445 if side>0 else -3.849,7.395 if side>0 else 7.3995))
    life_float('floats.bridge',bridge_origin,bridge_rotation)
    boat_rotation=Matrix.Rotation(-side*math.radians(3.20),3,'Z')@Matrix.Rotation(side*math.radians(80),3,'X')
    boat_origin=Vector((13.167,side*4.761,3.1275))
    life_float('floats.boat',boat_origin,boat_rotation)
    for dx in [-.72,.72]:
        # Seated cradles behind each inclined float; brackets lead to the
        # forehouse bulkhead or deck, without moving the measured float datum.
        o=box('floats.bridge.cradle',bridge_origin+bridge_rotation@Vector((dx,0,-.035)),(.09,1.55,.07),materials['edge'],bev=.008)
        o.rotation_euler=bridge_rotation.to_euler()
        for local_y,root_z in [(-side*.70,7.30),(side*.70,6.65)]:
            seat=bridge_origin+bridge_rotation@Vector((dx,local_y,-.07))
            rod('floats.bridge.knee',(19.068+dx,side*3.0,root_z),seat,.045,materials['edge'],vertices=8)
        center=boat_origin+boat_rotation@Vector((dx,0,-.03))
        o=box('floats.boat.cradle',center,(.08,1.54,.06),materials['edge'],bev=.006);o.rotation_euler=boat_rotation.to_euler()
        foot=Vector((center.x,side*4.30,deckz(center.x)+.025))
        box('floats.boat.foot',foot,(.20,.20,.05),materials['edge'],bev=.006)
        rod('floats.boat.knee',foot,center,.037,materials['edge'],vertices=8)
    for z in [4.344,4.6905]:life_float('floats.aft',(-25.7265,side*4.0335,z),Matrix.Rotation(-side*math.radians(9.28),3,'X'))
    aft_float_rack(side)
    # Vertical ladders, stair runs and doors stay clear of main-gun sweeps.
    if side<0:
        # Source grab rails stop below the upper landing (4.713 m), leaving
        # the torpedo bank clear. Full-height generic stair rails are too tall.
        stairs('machinery.aft-stairs',(-14.30,-1.705,2.24),(-12.20,-1.705,machinery_aft_top),.65,rail_range=(.252,.828),rail_height=.338)
    stairs('bridge.stairs',(13.5,side*2.18,5.08),(16.0,side*2.18,7.37),.54)
    ladder('after.house-ladder',(-34.95,side*.55,2.24),(-34.95,side*.55,aft_top),.48)
    for z in [2.45,3.35,4.35]:
        for dy in [-.24,.24]:
            rod('after.house-ladder.standoff',(-34.95,side*.55+dy,z),(-34.87,side*.55+dy,z),.026,materials['edge'],vertices=8)
    for x,y,z in [(26.8,3.015,5.18),(19.4,3.015,5.10),(-29.0,2.389,2.29),(-24.5,2.389,2.29),(-10.0,1.605,2.29),(4.0,3.035,2.34)]:
        door('access.door',x,side*y,z,side)
    for x in [-12,-9,-2,2,5,10]:portlight('machinery.portlight',(x,side*(1.606 if x<-4.53 else 3.036),4.42),(0,side,0),.13)
    for x in [-30,-27,-24]:portlight('after.portlight',(x,side*2.389,3.94),(0,side,0),.13)
    for x in [18,21,25,28]:portlight('forehouse.portlight',(x,side*3.025,7.10),(0,side,0),.14)
    # Hoses and extinguishers fastened to bulkheads.
    for x,y,z in [(25.0,3.04,6.12),(-29.5,2.40,3.25),(-10.5,1.62,3.25)]:
        y*=side
        for r in [.16,.22,.28]:tube_path('fire.hose',[(x+r*math.cos(i*math.tau/24),y+side*.08,z+r*math.sin(i*math.tau/24)) for i in range(24)],.030,materials['canvas'],sides=8,closed=True)
        box('fire.hose-rack',(x,y,z+.31),(.53,.21,.07),materials['edge'])
        cyl('fire.extinguisher',(x+.55,y+side*.13,z-.08),.10,.65,materials['underwater'],vertices=16)
        for dz in [-.30,.12]:
            box('fire.extinguisher-clamp',(x+.55,y+side*.15,z+dz),(.24,.08,.035),materials['edge'])
            box('fire.extinguisher-bracket',(x+.55,y+side*.045,z+dz),(.08,.16,.035),materials['edge'])
    # Hull apertures follow the local hull surface, including the raised forecastle.
    for x in [-40,-34,-29,-22,-16,-10,-4,2,8,14,20,26,32,37,42]:
        z=deckz(x)-.63;yy=hull_breadth_at(x,z)
        portlight('hull.portlight',(x,side*(yy+.007),z),(0,side,0),.11)
    for x in [-48,-43,-35,32,40,47]:
        y=side*width(x)*.67;z=deckz(x)+.05
        box('mooring.bitt-foot',(x,y,z+.07),(.86,.41,.12),materials['edge'])
        for dx in [-.25,.25]:
            cyl('mooring.bitt',(x+dx,y,z+.29),.105,.39,materials['naval'],vertices=16)
            cyl('mooring.bitt-cap',(x+dx,y,z+.50),.15,.05,materials['edge'],vertices=16)
        yy=side*(width(x)-.10)
        tube_path('mooring.fairlead',[(x-.28,yy,z+.05),(x-.25,yy,z+.30),(x+.25,yy,z+.30),(x+.28,yy,z+.05)],.069,materials['edge'],sides=10)
    # Reels have raised feet, winding and separate flanges.
    for x,y in [(-43,2.45),(-32.5,3.65),(30.7,3.35)]:
        y*=side;z=deckz(x)+.42
        for dx in [-.40,.40]:box('reel.stand',(x+dx,y,z-.15),(.10,.52,.50),materials['naval'])
        rod('reel.cable',(x-.35,y,z),(x+.35,y,z),.21,materials['rope'],vertices=24)
        for dx in [-.36,.36]:rod('reel.flange',(x+dx-.02,y,z),(x+dx+.02,y,z),.29,materials['edge'],vertices=24)
    for x in [-7.4,7.0]:
        y=side*(1.61 if x<-4.53 else 3.04)
        box('ventilation.intake',(x,y,3.55),(1.15,.09,1.52),materials['edge'])
        for i in range(12):box('ventilation.louver',(x,y+side*.06,2.9+i*.115),(1.05,.12,.039),materials['naval'],bev=.004)
    for x in [-3.5,11.3]:
        y=side*2.10;z=5.01
        cyl('ventilation.neck',(x,y,z+.32),.21,.64,materials['naval'],vertices=20)
        tube_path('ventilation.cowl',[(x,y,z+.55),(x-.15,y,z+.75),(x-.42,y,z+.72)],.22,materials['naval'],sides=14)
        rod('ventilation.opening',(x-.42,y,z+.72),(x-.44,y,z+.72),.18,materials['dark'],vertices=20)
# Ground tackle follows the source's paired foredeck leads.
for side in [-1,1]:
    x,y=44.8,side*.82;z=deckz(x)
    cyl('anchor.capstan-foot',(x,y,z+.11),.39,.21,materials['edge'],vertices=28)
    cyl('anchor.capstan',(x,y,z+.33),.25,.31,materials['naval'],vertices=24)
    cyl('anchor.capstan-head',(x,y,z+.51),.35,.06,materials['edge'],vertices=24)
    for i in range(30):
        xx=45.1+i*.135;yy=side*(.82+.15*(xx-45.1));zz=deckz(xx)+.09
        pts=[(xx+.095*math.cos(j*math.tau/12),yy+.052*math.sin(j*math.tau/12)*(1 if i%2 else .25),zz+.052*math.sin(j*math.tau/12)*(0 if i%2 else 1)) for j in range(12)]
        tube_path('anchor.chain-link',pts,.017,materials['edge'],sides=6,closed=True)
    xx=49.1;zz=4.84;yy=side*(hull_breadth_at(xx,zz)+.04)
    rod('anchor.hawse',(xx,yy-side*.08,zz),(xx,yy+side*.12,zz),.25,materials['edge'],vertices=24)
    rod('anchor.shank',(xx,yy+side*.14,zz-.1),(xx-.28,yy+side*.14,zz-.89),.084,materials['edge'],vertices=12)
    rod('anchor.crown',(xx-.58,yy+side*.14,zz-.86),(xx+.08,yy+side*.14,zz-.99),.095,materials['edge'])
    for dx in [-.57,.01]:
        vs=[(xx+dx,yy+side*.09,zz-.94),(xx+dx+.12,yy+side*.30,zz-.43),(xx+dx+.36,yy+side*.08,zz-.9)]
        o=mesh('anchor.fluke',vs,[(0,1,2)],materials['edge']);mod=o.modifiers.new('Cast fluke thickness','SOLIDIFY');mod.thickness=.07
for x in [-45,-40,40,49.6]:
    z=deckz(x);box('deck.hatch-foot',(x,0,z+.09),(.92,.70,.16),materials['edge'])
    box('deck.hatch',(x,0,z+.20),(.98,.76,.07),materials['naval'])
rod('mast.jackstaff',(52.8,0,5.96),(52.9,0,8.15),.024,materials['edge'],r2=.016)
rod('mast.stern-staff',(-52.6,0,2.63),(-53.0,0,5.05),.028,materials['edge'],r2=.018)

# Twin shafts with socketed A-brackets and original handed three-bladed screws.
for side in [-1,1]:
    label='port' if side>0 else 'starboard';y=side*2.48
    shaftz=lambda x:-3.18+(x+48.15)*.55/19.15
    rod('shaft.'+label,(-29,y,shaftz(-29)),(-48.15,y,-3.18),.14,materials['edge'],vertices=24)
    rod('shaft.fairing',(-30,y,shaftz(-30)),(-36,y,shaftz(-36)),.28,materials['underwater'],r2=.18,vertices=24)
    for x in [-40.0,-46.7]:
        rod('shaft.bearing',(x-.52,y,shaftz(x-.52)),(x+.52,y,shaftz(x+.52)),.235,materials['underwater'],vertices=24)
        for ty in [y,side*.9]:
            root=hull_height_at(x+.15,ty)+.12
            rod('shaft.a-bracket',(x,y,shaftz(x)),(x+.15,ty,root),.10,materials['underwater'],vertices=12,r2=.14)
    pivot=empty('propeller-'+label+'.pivot',(-48.15,y,-3.18))
    pivot.rotation_euler.y=-math.atan2(.55,19.15)
    local(rod('propeller.hub',(-.57,0,0),(.42,0,0),.26,materials['bronze'],vertices=32,r2=.20),pivot)
    local(rod('propeller.cap',(-.57,0,0),(-.78,0,0),.26,materials['bronze'],vertices=32,r2=.025),pivot)
    for blade in range(3):
        angle=math.pi/2+blade*math.tau/3;nr,nc=25,15;vs=[]
        for face in [-1,1]:
            for i in range(nr):
                r=.20+1.38*i/(nr-1);t=(r-.20)/1.38
                chord=.24+1.02*math.sin(math.pi*t)**.7 if t<.999 else .016
                pitch=math.atan2(2.8,math.tau*r)
                for j in range(nc):
                    u=-math.cos(math.pi*j/(nc-1));tangent=u*chord/2+.11*t*t
                    thick=(.006+.085*(1-t)**1.2)*math.sqrt(max(0,1-u*u))+.004
                    xx=-tangent*math.sin(pitch)+.035*chord*(1-u*u)+face*thick/2*math.cos(pitch)
                    across=tangent*math.cos(pitch)+face*thick/2*math.sin(pitch)
                    vs.append((xx,side*(r*math.cos(angle)-across*math.sin(angle)),r*math.sin(angle)+across*math.cos(angle)))
        stride=nr*nc;fs=[]
        for i in range(nr-1):
            for j in range(nc-1):
                k=i*nc+j;fs += [(k,k+nc,k+nc+1,k+1),(stride+k,stride+k+1,stride+k+nc+1,stride+k+nc)]
        edge=list(range(nc))+[k*nc+nc-1 for k in range(1,nr)]+[(nr-1)*nc+j for j in range(nc-2,-1,-1)]+[k*nc for k in range(nr-2,0,-1)]
        fs += [(n,edge[(j+1)%len(edge)],stride+edge[(j+1)%len(edge)],stride+n) for j,n in enumerate(edge)]
        local(mesh('propeller-'+label+'.blade',vs,fs,materials['bronze'],smooth=True),pivot)
# Single centreline rudder is joined to the sternpost; foil section and tapered tip.
pivot=empty('rudder.pivot',(-51.05,0,-.8))
rod('rudder.stock',(-51.05,0,-1.3),(-51.05,0,deckz(-51.05)-.2),.15,materials['edge'],vertices=24)
vs=[];n=24
for z,cx,chord,thickness in [(-.15,0,1.8,.20),(-1.1,-.12,2.35,.19),(-3.4,-.2,2.1,.12),(-3.7,-.1,1.65,.055)]:
    for j in range(n):
        a=j*math.tau/n;vs.append((cx+chord*.5*math.cos(a),thickness*math.sin(a),z))
fs=[(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for i in range(3) for j in range(n)]+[tuple(reversed(range(n))),tuple(3*n+j for j in range(n))]
local(mesh('rudder.foil',vs,fs,materials['underwater'],smooth=True),pivot)

# Permanent rail attachments and waterway along the deck edge.
for side in [-1,1]:
    pts=[(s-half,side*max(.02,w-.14),deckz(s-half)+.06) for s,w in h['halfBreadths'] if .9<s<h['length']-.9]
    rails('rails.perimeter',pts,.85,spacing=2.2)
    tube_path('hull.waterway',[(x,y,z-.02) for x,y,z in pts],.043,materials['edge'],sides=8)
bm=bmesh.new();bm.from_mesh(hull.data)
for height in [-.20,.12]:
    bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.00001,plane_co=(0,0,height),plane_no=(0,0,1),clear_inner=False,clear_outer=False)
bm.to_mesh(hull.data);bm.free()
# Underwater finish follows authored hull elevations, with no imported texture.
for o in [hull]:
    o.data.materials.append(materials['underwater']);o.data.materials.append(materials['dark'])
    for p in o.data.polygons:
        z=sum(o.data.vertices[v].co.z for v in p.vertices)/len(p.vertices)
        p.material_index=1 if z<-.20 else (2 if z<.12 else 0)
for o in col.objects:
    if o.type=='MESH':
        bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
# Deterministic original paint tiles. Image textures have an explicit glTF path;
# no procedural-only shader or reference texture is silently lost on export.
import numpy as np
# Reuse the same metric UVs for shared finishes; a second full-mesh UV layer
# would exceed this detailed model's export budget.
paint_keys=['naval','hullgray','roof','deck','underwater','edge','wood']
rng=np.random.default_rng(194608)
for key in paint_keys:
    n=512;u,v=np.meshgrid(np.arange(n)/n,np.arange(n)/n)
    fine=rng.random((n,n))-.5
    # Periodic interpolated noise avoids square patches and regular corrugations.
    grid=rng.random((17,17))-.5;grid[-1,:]=grid[0,:];grid[:,-1]=grid[:,0]
    axis=np.linspace(0,1,17)
    rows=np.array([np.interp(np.arange(n)/n,axis,row) for row in grid])
    coarse=np.array([np.interp(np.arange(n)/n,axis,col) for col in rows.T]).T
    weather=.012*fine+.045*coarse
    base=np.array(colors[key][:3]);base=np.where(base<.0031308,base*12.92,1.055*base**(1/2.4)-.055)
    rgb=np.clip(base[None,None,:]+weather[:,:,None],0,1)
    if key in ['naval','hullgray']:
        streak=np.zeros((n,n))
        for _ in range(19):
            x,y=rng.random(2);width=rng.uniform(.001,.004);length=rng.uniform(.04,.3)
            dx=np.minimum(np.abs(u-x),1-np.abs(u-x));dy=np.mod(v-y,1)
            streak+=np.exp(-(dx/width)**2)*np.maximum(0,1-dy/length)**2*rng.uniform(.025,.12)
        streak=np.clip(streak,0,.2)
        rgb=rgb*(1-streak[:,:,None])+np.array([.29,.18,.10])[None,None,:]*streak[:,:,None]
    if key=='deck':
        seams=(np.mod(u*11,1)<.018)*.025+(np.mod(v*7,1)<.016)*.020
        rgb=np.maximum(0,rgb-seams[:,:,None])
    pixels=np.concatenate([rgb,np.ones((n,n,1))],axis=2).astype(np.float32)
    img=bpy.data.images.new('Hsienyang original '+key+' paint',width=n,height=n,alpha=True)
    img.pixels.foreach_set(pixels.ravel());img.filepath_raw=str(out/('paint-'+key+'.png'));img.file_format='PNG';img.save();img.pack()
    nodes=materials[key].node_tree.nodes;tex=nodes.new('ShaderNodeTexImage');tex.image=img;tex.extension='REPEAT'
    mapping=nodes.new('ShaderNodeUVMap');mapping.uv_map='Original paint metres'
    materials[key].node_tree.links.new(mapping.outputs['UV'],tex.inputs['Vector'])
    materials[key].node_tree.links.new(tex.outputs['Color'],nodes['Principled BSDF'].inputs['Base Color'])
    nodes['Principled BSDF'].inputs['Roughness'].default_value=.84
# Consistent world-scale face projections retain readable weathering on small parts.
paint_names={materials[k].name for k in paint_keys}
for obj in scene.objects:
    # Every mesh needs the same UV layer: exporter batches painted and unpainted
    # fittings together, and the active mesh determines the batch's UV layout.
    if obj.type!='MESH':continue
    uv=obj.data.uv_layers.new(name='Original paint metres')
    uv.active_render=True
    for poly in obj.data.polygons:
        normal=poly.normal;axis=max(range(3),key=lambda i:abs(normal[i]));coords=[i for i in range(3) if i!=axis]
        for li in poly.loop_indices:
            co=obj.data.vertices[obj.data.loops[li].vertex_index].co+obj.location
            uv.data[li].uv=(co[coords[0]]/5.7,co[coords[1]]/5.7)

scene['definitionHash']=definition['contentHash'];scene['authoringRevision']=2
sys.path.insert(0,str(ROOT/'assets/ships/appearance'))
from surface import apply_appearance
apply_appearance(scene,materials,Path(__file__).with_name('appearance.json'))
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
print('GLEAVES original reconstruction',len(col.objects),'objects')
