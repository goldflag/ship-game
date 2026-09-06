"""U-570, captured August–September 1941. Independently authored original geometry.

Datums and uncertainty: references/sources.json, modeling-spec.json and
reports/discrepancies.md. Historical scans are NEVER textures or mesh inputs.
Blender +X bow, +Y port, +Z up; common export preserves joint/socket IDs.
Local Blender recipe: all production inputs are the compiled blueprint and this
file plus the shared component recipes. authoring/generate_blueprint.py writes
versioned stations; no hidden, unhashed helper is imported by this build.
"""
import bpy, bmesh, json, math, os, sys
from pathlib import Path
from mathutils import Vector
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'scripts/ships'))
from blender_components import create_gun_mount
out = Path(os.environ['SHIP_OUTPUT'])
definition = json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'; scene.unit_settings.scale_length = 1
col = bpy.data.collections.new('U-570 original 1941 assemblies'); scene.collection.children.link(col)
colors = {'naval':(.36,.40,.41,1), 'roof':(.23,.27,.28,1), 'edge':(.12,.15,.16,1),
          'hullgray':(.31,.35,.36,1), 'canvas':(.39,.40,.35,1), 'dark':(.017,.023,.024,1),
          'underwater':(.105,.13,.14,1), 'deck':(.22,.235,.215,1), 'bronze':(.38,.28,.12,1),
          'wood':(.28,.25,.20,1), 'glass':(.05,.13,.15,1)}
materials = {}
for key, color in colors.items():
    m = bpy.data.materials.new('VIIC '+key); m.diffuse_color = color; m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']; bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = .76 if key != 'bronze' else .38
    bsdf.inputs['Metallic'].default_value = .08 if key != 'bronze' else .72
    materials[key] = m

def mesh(name, vertices, faces, material, collection=col, smooth=False):
    data = bpy.data.meshes.new(name); data.from_pydata(vertices, [], faces); data.update()
    obj = bpy.data.objects.new(name, data); collection.objects.link(obj)
    if material: data.materials.append(material)
    for p in data.polygons: p.use_smooth = smooth
    obj['assemblyId'] = name.split('.')[0]
    return obj

def finish(obj, name, material, collection):
    obj.name = name
    for c in list(obj.users_collection): c.objects.unlink(obj)
    collection.objects.link(obj); obj.data.materials.append(material)
    obj['assemblyId'] = name.split('.')[0]
    return obj

def cyl(name, loc, radius, depth, material, collection=col, vertices=24, r2=None):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius,
        radius2=radius if r2 is None else r2, depth=max(.001,depth), location=loc)
    obj = finish(bpy.context.object, name, material, collection)
    for p in obj.data.polygons: p.use_smooth = len(p.vertices)==4
    return obj

def rod(name, a, b, r, material, collection=col, r2=None, vertices=12):
    a,b = Vector(a),Vector(b)
    obj = cyl(name, (a+b)/2, r, (b-a).length, material, collection, vertices, r2)
    obj.rotation_euler = (b-a).to_track_quat('Z','Y').to_euler()
    return obj

def box(name, loc, dim, material, collection=col, bev=.015):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj=bpy.context.object; obj.scale=dim
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bev:
        mod=obj.modifiers.new('Manufactured edge','BEVEL'); mod.width=min(bev,min(dim)*.2);mod.segments=2
    return finish(obj,name,material,collection)

def empty(name, loc):
    obj=bpy.data.objects.new(name,None);col.objects.link(obj);obj.location=loc
    obj['nodeId']=name;obj['assemblyId']=name.split('.')[0]
    return obj

def attach(obj,parent):
    bpy.context.view_layer.update();world=obj.matrix_world.copy();obj.parent=parent;obj.matrix_world=world

def landmark(name, loc): return empty('landmark.'+name,loc)

def interp(table, s):
    for (a,va),(b,vb) in zip(table,table[1:]):
        if a<=s<=b:return va+(vb-va)*(s-a)/(b-a)
    return table[0][1] if s<table[0][0] else table[-1][1]

h=definition['hull'];half=h['length']/2
sections=h['sections']
deckz=lambda x:interp(h['deckHeights'],x+half)
deckwidth=lambda x:interp([[s['station'],s['points'][-1][0]] for s in sections],x+half)

def surface_width(x,z):
    return interp([[s['station'],interp([[y,w] for w,y in s['points'][1:]],z)] for s in sections],x+half)

# Closed external envelope with circular bilges, external saddle shoulders,
# trapezoidal casing and flat keel. End caps are fans, avoiding skinny ngon ears.
v=[]
for s in sections:
    pts=s['points']; ring=pts+[[-w,z] for w,z in reversed(pts[1:])]
    v.extend([(s['station']-half,w,z) for w,z in ring])
n=len(ring); f=[]
for i in range(len(sections)-1):
    for j in range(n):f.append((i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j))
for i in (0,len(sections)-1):
    center=len(v);s=sections[i];v.append((s['station']-half,0,(s['points'][0][1]+s['points'][-1][1])/2))
    for j in range(n):f.append((center,i*n+j,i*n+(j+1)%n))
hull=mesh('hull.envelope',v,f,materials['hullgray'],smooth=True);hull['nodeId']='hull.surface'
bm=bmesh.new();bm.from_mesh(hull.data)
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
# Split the real skin at Y=0 (Blender Z) for a clean paint boundary.
bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.0000001,plane_co=(0,0,0),plane_no=(0,0,1),clear_inner=False,clear_outer=False)
# Tiny stern cap intersections must weld before GLB float32 triangulation.
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0001)
bmesh.ops.triangulate(bm,faces=list(bm.faces))
bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=.000001)
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(hull.data);bm.free()
hull.data.materials.append(materials['underwater'])
for face in hull.data.polygons:
    z=sum(hull.data.vertices[i].co.z for i in face.vertices)/len(face.vertices)
    face.material_index=1 if z<0 else 0
# Thin original strips distinguish the upper saddle boundary from the casing.
for side in (-1,1):
    for i in range(75):
        x=-18+i*.5; z=.39
        rod('saddle-tanks.top-seam',(x,side*(surface_width(x,z)+.007),z),
            (x+.5,side*(surface_width(x+.5,z)+.007),z),.014,materials['edge'],vertices=6)
# Planked free-flooding deck. Rectangular slots are inset dark faces; count is
# an explicit visual approximation of ONI photographs 1–3, not a yard pattern.
v=[]
for s in sections:
    x=s['station']-half;w=s['points'][-1][0]
    v += [(x,-w,deckz(x)+.012),(x,w,deckz(x)+.012)]
mesh('deck.timber',v,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(len(sections)-1)],materials['deck'])
slotv=[];slotf=[]
for i in range(128):
    x=-32+i*.5
    for lane in range(-10,11):
        y=lane*.145
        if abs(y)+.024<min(deckwidth(x-.16),deckwidth(x+.16))-.035 and not(-2<x<6.15 and abs(y)<1.1):
            k=len(slotv);slotv.extend([(a,b,deckz(a)+.021) for a,b in [(x-.17,y-.021),(x+.17,y-.021),(x+.17,y+.021),(x-.17,y+.021)]])
            slotf.append((k,k+1,k+2,k+3))
mesh('deck.drainage',slotv,slotf,materials['dark'])
# Flood ports follow the actual local skin, so none float outside the round body.
for side in (-1,1):
    for i in range(118):
        x=-31.8+i*.54
        z=deckz(x)-(.28 if abs(x)>19 else .22)
        rx,rz=(.19,.105) if abs(x)>20 else (.205,.055)
        verts=[]
        for j in range(16):
            a=j*math.tau/16;px=x+rx*math.cos(a);pz=z+rz*math.sin(a)
            verts.append((px,side*(surface_width(px,pz)+.008),pz))
        mesh('casing.free-flood-port',verts,[tuple(range(16))],materials['dark'])
# Two long external torpedo stowage covers, loading hatches and deck fittings.
for x in (-16.4,17.9):
    z=deckz(x)
    box('deck.external-torpedo-cover',(x,0,z+.046),(6.95,.79,.07),materials['roof'])
    for t in range(12):
        px=x-3.15+t*.56;rod('deck.cover-seam',(px,-.38,deckz(px)+.085),(px,.38,deckz(px)+.085),.009,materials['edge'],vertices=6)
    for px in (x-3.1,x+3.1):rod('deck.cover-handle',(px,-.12,deckz(px)+.12),(px,.12,deckz(px)+.12),.025,materials['edge'])
for x,offset in [(-22.1,0),(12.7,.40)]:
    z=deckz(x);cyl('deck.loading-coaming',(x,offset,z+.10),.52,.18,materials['hullgray'],vertices=40)
    cyl('deck.loading-hatch',(x,offset,z+.21),.44,.05,materials['roof'],vertices=40)
    rod('deck.hatch-hinge',(x-.4,offset-.25,z+.23),(x-.4,offset+.25,z+.23),.04,materials['edge'])
    rod('deck.hatch-handle',(x-.14,offset,z+.26),(x+.14,offset,z+.26),.028,materials['edge'])
for x,y in [(-4.6,0),(25.0,0)]:
    cyl('deck.marker-buoy',(x,y,deckz(x)+.055),.38,.09,materials['hullgray'],vertices=32)
for x in (-29.7,28.3):
    box('deck.bollard-base',(x,0,deckz(x)+.045),(.48,.52,.07),materials['edge'])
    for y in (-.17,.17):
        cyl('deck.bollard',(x,y,deckz(x)+.21),.08,.30,materials['edge'])
        cyl('deck.bollard-cap',(x,y,deckz(x)+.36),.105,.035,materials['edge'])
cyl('deck.capstan',(26.1,0,deckz(26.1)+.17),.25,.30,materials['hullgray'],vertices=24)
# Open tower: substantial walls share blueprint triangles with CPU plating.
for s in definition['structures']:
    if s.get('surface'):
        vv=[(-z,-x,y) for x,y,z in s['surface']['vertices']]
        mesh(s['id']+'.fairing',vv,s['surface']['triangles'],materials[s['material']],smooth=True)
    else:
        p=[(-z,-x) for x,z in s['footprint']];n=len(p)
        vv=[(x,y,z) for z in (s['baseY'],s['baseY']+s['height']) for x,y in p]
        mesh(s['id']+'.deck',vv,[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)]+[tuple(range(n,2*n))],materials[s['material']])
wall=definition['structures'][0]['surface']['vertices'];n=len(wall)//3
upper=[(-z,-x,y) for x,y,z in wall[2*n:]]
for i,a in enumerate(upper):rod('bridge.wind-deflector-lip',a,upper[(i+1)%n],.045,materials['naval'])
# Wooden lining, forward voicepipe, compass repeater and watertight access.
for side in (-1,1):
    for i in range(18):box('bridge.wood-lining',(1.05+i*.19,side*.95,3.98),(.13,.04,.68),materials['wood'],bev=0)
    rod('bridge.voicepipe',(4.28,side*.52,3.58),(4.28,side*.52,4.39),.048,materials['edge'])
    rod('bridge.voicepipe-mouth',(4.28,side*.52,4.39),(4.12,side*.52,4.39),.064,materials['naval'])
cyl('bridge.access-hatch',(2.45,0,3.60),.34,.11,materials['edge'])
cyl('bridge.compass-pedestal',(4.32,0,3.87),.12,.62,materials['naval'])
cyl('bridge.compass-bowl',(4.32,0,4.23),.23,.18,materials['edge'])
# Early single C/30 basket, not a late-war enlarged wintergarten.
AA=-.83;FLOOR=3.10
cyl('wintergarten.platform',(AA,0,FLOOR),1.30,.08,materials['roof'],vertices=48)
# Tall C/30 foundation in the captured profile; catalog assembly starts above it.
cyl('wintergarten.gun-foundation',(AA,0,3.465),.235,.65,materials['hullgray'],vertices=24,r2=.18)
for i in range(25):
    a=math.radians(56)+i*math.radians(248)/24
    # Arc opens toward the bridge (+X).
    base=(AA+math.cos(a)*1.28,math.sin(a)*1.28,FLOOR+.04)
    top=(AA+math.cos(a)*1.70,math.sin(a)*1.70,4.08)
    rod('wintergarten.stanchion',base,top,.024,materials['edge'])
    if i:
        rod('wintergarten.top-rail',previous,top,.027,materials['edge'])
        mid=tuple((a+b)/2 for a,b in zip(base,top));rod('wintergarten.middle-rail',previous_mid,mid,.021,materials['edge'])
    previous=top;previous_mid=tuple((a+b)/2 for a,b in zip(base,top))
for side in (-1,1):
    for x in (-1.30,-.25):rod('wintergarten.bracket',(x,side*.48,1.50),(x,side*1.05,FLOOR-.04),.065,materials['naval'])
    rod('tower.air-intake',(.18,side*.74,1.50),(.18,side*.74,3.49),.13,materials['hullgray'])
    for z in (1.65,1.95,2.25,2.55,2.85):rod('tower.ladder-rung',(-.18,side*.45,z),(-.18,side*.83,z),.025,materials['edge'])
# The raised attack-scope eye uses the same 14.612 m above-keel datum as camera.
for x,height,label in [(1.285,9.8495,'attack'),(3.695,7.14,'observation')]:
    cyl('periscopes.'+label+'-gland',(x,0,4.36),.23,1.52,materials['hullgray'],vertices=32,r2=.15)
    rod('periscopes.'+label+'-lower',(x,0,4.72),(x,0,5.74),.125,materials['hullgray'],r2=.075)
    rod('periscopes.'+label+'-shaft',(x,0,5.74),(x,0,height-.12),.058,materials['edge'],r2=.039)
    cyl('periscopes.'+label+'-head',(x,0,height-.045),.055,.17,materials['naval'],vertices=20)
    rod('periscopes.'+label+'-lens',(x+.049,0,height),(x+.058,0,height),.026,materials['glass'],vertices=16)
    landmark(label+'-scope-eye',(x,0,height))
# Loop location is interpreted from the general plan; exact bracket remains open.
for i in range(40):
    a,b=i*math.tau/40,(i+1)*math.tau/40
    rod('antenna.direction-finder',(3.18,.61+math.sin(a)*.29,5.07+math.cos(a)*.29),(3.18,.61+math.sin(b)*.29,5.07+math.cos(b)*.29),.021,materials['edge'])
rod('antenna.loop-stem',(3.18,.61,4.58),(3.18,.61,4.80),.041,materials['edge'])
# Central removable rails and aerials visible in the September survey photos.
for side in (-1,1):
    prev=None
    for x in [-11,-9.2,-7.4,-5.6,-3.8,-2,0,2,4,6,8,10.0]:
        y=side*(deckwidth(x)-.10);z=deckz(x)
        rod('rails.stanchion',(x,y,z),(x,y,z+.83),.023,materials['edge'])
        if prev:
            rod('rails.top',prev,(x,y,z+.83),.016,materials['edge'])
            rod('rails.lower',(prev[0],prev[1],prev[2]-.43),(x,y,z+.40),.014,materials['edge'])
        prev=(x,y,z+.83)
for end in (-31.8,31.0):
    anchor=(end,0,deckz(end)+.58)
    rod('rigging.end-post',(end,0,deckz(end)),anchor,.027,materials['edge'])
    for side in (-1,1):
        top=(.30 if end<0 else 4.30,side*.85,4.72)
        mid=tuple((a+b)/2 for a,b in zip(anchor,top));mid=(mid[0],mid[1],mid[2]-.18)
        rod('rigging.aerial',anchor,mid,.009,materials['dark'],vertices=6)
        rod('rigging.aerial',mid,top,.009,materials['dark'],vertices=6)
        for f in (.30,.36,.42):
            pos=Vector(anchor).lerp(Vector(top),f)
            rod('rigging.insulator',pos,pos+Vector((.14,0,0)),.038,materials['roof'],vertices=8)
# ONI explicitly: net cutters on the class drawing were NOT fitted to U-570.
# Twin submerged planes, shafts, screws and rudders. Each moving part stays
# on its stable joint; fixed shaft brackets/guards never rotate with the screw.
for side in (-1,1):
    label='port' if side>0 else 'starboard'
    for prefix,x,y,z,span,chord in [('bow-plane',25.65,1.20,-1.55,1.87,1.72),('stern-plane',-26.50,.72,-1.40,1.74,1.42)]:
        y*=side;pivot=empty(prefix+'-'+label+'.pivot',(x,y,z));landmark(prefix+'-'+label,(x,y,z))
        # Rounded trapezoid planform, thin symmetric foil section.
        plan=[(-chord*.55,0),(chord*.46,0),(chord*.37,span*.80),(chord*.16,span),(-chord*.29,span),(-chord*.68,span*.71)]
        vv=[(x+dx,y+side*dy,z+dz) for dz in (-.047,.047) for dx,dy in plan];n=len(plan)
        blade=mesh(prefix+'-'+label+'.blade',vv,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)],materials['underwater']);attach(blade,pivot)
        rod(prefix+'-'+label+'.fixed-guard',(x+chord*.62,side*.55,z),(x+chord*.55,y+side*(span+.15),z),.055,materials['underwater'])
        rod(prefix+'-'+label+'.guard-return',(x+chord*.55,y+side*(span+.15),z),(x-chord*.83,side*.55,z),.045,materials['underwater'])
    px,py,pz=-27.40,side*1.1176,-2.4412
    rod('shafts.'+label,(-17.2,side*.88,-2.12),(px+.22,py,pz),.080,materials['edge'])
    for a in [(-24.85,side*.49,-1.55),(-24.85,side*.20,-2.97)]:
        rod('shaft-brackets.'+label,a,(-25.85,side*1.105,-2.40),.085,materials['underwater'])
    rod('shaft-brackets.'+label+'-bearing',(-25.60,side*1.10,-2.40),(-26.14,side*1.11,-2.415),.145,materials['underwater'])
    screw=empty('propeller-'+label+'.pivot',(px,py,pz));landmark('propeller-'+label,(px,py,pz))
    hub=rod('propeller-'+label+'.hub',(px+.28,py,pz),(px-.43,py,pz),.155,materials['bronze'],r2=.038);attach(hub,screw)
    # Manual: three blades, 1.620 m diameter, 1.540 m pitch; handed pair.
    for blade_i in range(3):
        vv=[];rows=12;cols=8
        for surface in (-1,1):
            for ri in range(rows+1):
                r=.13+.68*ri/rows
                width=.025+.29*math.sin(math.pi*(ri/rows)*.91)**.8
                for ci in range(cols+1):
                    u=(ci/cols-.5)*2;theta=blade_i*math.tau/3+side*(.28*(ri/rows)+u*width/max(.15,r))
                    pitch=side*u*width*1.54/(math.tau*r)
                    vv.append((px+pitch+surface*.012,py+r*math.cos(theta),pz+r*math.sin(theta)))
        ff=[];count=(rows+1)*(cols+1)
        for layer in range(2):
            for i in range(rows):
                for j in range(cols):
                    a=layer*count+i*(cols+1)+j;ff.append((a,a+1,a+cols+2,a+cols+1))
        for edge in [[i*(cols+1) for i in range(rows+1)],[i*(cols+1)+cols for i in range(rows+1)],list(range(cols+1)),[rows*(cols+1)+i for i in range(cols+1)]]:
            for a,b in zip(edge,edge[1:]):ff.append((a,b,b+count,a+count))
        blade=mesh('propeller-'+label+'.swept-blade',vv,ff,materials['bronze'],smooth=True);attach(blade,screw)
    rudder=empty('rudder-'+label+'.pivot',(-30.05,side*.6223,-1.75));landmark('rudder-'+label,(-30.05,side*.6223,-1.75))
    outline=[(-29.59,-.87),(-30.66,-1.03),(-31.0,-1.23),(-30.89,-3.10),(-30.65,-3.2893),(-29.63,-3.20),(-29.43,-2.77)]
    vv=[(x,side*.6223+dy,z) for dy in (-.06,.06) for x,z in outline];n=len(outline)
    blade=mesh('rudder-'+label+'.blade',vv,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)],materials['underwater']);attach(blade,rudder)
    rod('rudders.fixed-stock',(-30.05,side*.6223,-.63),(-30.05,side*.6223,-1.20),.073,materials['underwater'])
# Aft keel spur and rudder protection in docking-plan profile.
outline=[(-31.00,-3.32),(-27.60,-4.15),(-25.65,-3.69),(-22.0,-3.17),(-24.40,-2.90),(-27.65,-3.96),(-30.80,-3.16)]
n=len(outline);vv=[(x,y,z) for y in (-.065,.065) for x,z in outline]
mesh('stern-keel.spur',vv,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)],materials['underwater'])
# Preserve combat muzzle frames. Dark mouths indicate unanimated shutters.
for tube in definition['torpedoTubes']:
    x,y,z=tube['position'];pos=(-z,-x,y);d=1 if tube['bearingDeg']==0 else -1
    socket=empty(tube['id']+'.muzzle',pos);socket.rotation_euler.z=-math.radians(tube['bearingDeg'])
    rod(tube['id']+'.rim',(pos[0]-.15*d,pos[1],pos[2]),pos,.30,materials['edge'],vertices=32)
    rod(tube['id']+'.mouth',pos,(pos[0]+.008*d,pos[1],pos[2]),.2665,materials['dark'],vertices=32)
for mount in definition['mounts']:
    create_gun_mount(mount,col,dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,deckz)
landmark('bridge-lip',(3.3,0,4.60375))
landmark('saddle-maximum',(0,3.076575,-.82))
scene['definitionHash']=definition['contentHash']
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
