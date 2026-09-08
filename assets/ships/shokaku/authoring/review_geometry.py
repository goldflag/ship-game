"""Exact-source triangle intersection review. This is evidence, not a certificate.

Run Blender with generated/source.blend and --python this file. Samples moving
assemblies against all fixed exterior meshes; separate neighboring poses and
internal mechanism interfaces still require review. No geometry is changed.
"""
import bpy, json, math, os
from pathlib import Path
from collections import Counter
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parents[1]
D=json.loads((ROOT/'../../../public/models/shokaku.json').resolve().read_text())
scene=bpy.context.scene
assert scene.get('definitionHash')==D['contentHash'], 'Stale source'
OUT=ROOT/'reports'/('geometry-'+D['contentHash'][:8]);OUT.mkdir(exist_ok=True)
deps=bpy.context.evaluated_depsgraph_get()
cache={}
for obj in scene.objects:
    if obj.type!='MESH' or obj.get('exportRole')=='simulation':continue
    evaluated=obj.evaluated_get(deps);data=evaluated.to_mesh();data.calc_loop_triangles()
    cache[obj.name]=([v.co.copy() for v in data.vertices],[tuple(t.vertices) for t in data.loop_triangles])
    evaluated.to_mesh_clear()

def objects_below(root):
    return [o for o in root.children_recursive if o.name in cache]
def tree(objects):
    vertices=[];faces=[];names=[]
    for o in objects:
        vs,fs=cache[o.name];offset=len(vertices)
        vertices.extend(o.matrix_world@v for v in vs)
        faces.extend(tuple(offset+i for i in f) for f in fs)
        names.extend([o.name]*len(fs))
    return BVHTree.FromPolygons(vertices,faces,all_triangles=True),names
def bounds(objects):
    points=[o.matrix_world@Vector(p) for o in objects for p in o.bound_box]
    return [[min(p[i] for p in points) for i in range(3)],[max(p[i] for p in points) for i in range(3)]]
def intersections(a,b):
    return Counter((a[1][i],b[1][j]) for i,j in a[0].overlap(b[0]))
def pose(m,train,elev,recoil):
    yaw=bpy.data.objects[m['id']+'.yaw'];yaw.rotation_euler.z=-math.radians(m['bearingDeg']+train)
    for o in yaw.children_recursive:
        if o.name.endswith('.elevation'):o.rotation_euler.y=-math.radians(elev)
        if o.name.endswith('.recoil'):o.location.x=-m['weapon']['recoilM']*recoil
    bpy.context.view_layer.update()

moving={m['id']:objects_below(bpy.data.objects[m['id']+'.yaw']) for m in D['mounts']}
moving_names={o.name for v in moving.values() for o in v}
static=[o for o in scene.objects if o.name in cache and o.name not in moving_names]
static_tree=tree(static)
rows=[]
for m in D['mounts']:
    w=m['weapon'];train=w['traverseDeg'];lo,hi=w['elevationMinDeg'],w['elevationMaxDeg']
    # 10 degree steps plus exact endpoints; three recoil positions.
    trains=sorted(set([-train,0,train]+list(range(math.ceil(-train/10)*10,math.floor(train/10)*10+1,10))))
    elevations=sorted(set([lo,hi]+list(range(math.ceil(lo/10)*10,math.floor(hi/10)*10+1,10))))
    clashes={};samples=0
    for t in trains:
        for e in elevations:
            for r in [0,.5,1]:
                pose(m,t,e,r);pairs=intersections(tree(moving[m['id']]),static_tree);samples+=1
                for (a,b),n in pairs.items():
                    # Roller/base contact is the intended bearing interface.
                    if b==m['id']+'.foundation' and any(k in a for k in ['roller-path','rotating-pedestal']):continue
                    key=a+' | '+b
                    if key not in clashes:clashes[key]={'meshes':[a,b],'firstPose':[t,e,r],'samples':0,'maxTrianglePairs':0}
                    row=clashes[key];row['samples']+=1;row['maxTrianglePairs']=max(n,row['maxTrianglePairs'])
    pose(m,0,1,0)
    row={'mount':m['id'],'samples':samples,'clashes':list(clashes.values())};rows.append(row)
    (OUT/'static-sweep.json').write_text(json.dumps({'contentHash':D['contentHash'],'scope':'All moving mount meshes vs all fixed exterior meshes. Triangle surface intersections; intended roller/base contact excluded. This does not establish internal or neighboring clearance.','result':'fail' if any(r['clashes'] for r in rows) else 'sampled static sweep clear','mounts':rows},indent=2)+'\n')
    print(m['id'],samples,'poses',len(clashes),'mesh pairs',flush=True)

# Fixed close-ups supplement the common orthographic review. Cameras do not
# persist into source.blend or authoring inputs.
scene.render.engine='BLENDER_WORKBENCH';scene.display.shading.light='STUDIO'
scene.display.shading.studiolight_rotate_z=.7;scene.display.shading.color_type='MATERIAL'
scene.display.shading.show_shadows=True;scene.display.shading.show_cavity=True
scene.display.shading.cavity_type='BOTH';scene.display.shading.background_type='WORLD'
scene.world.color=(.12,.14,.16)
scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
views=[('open127-quarter',(72,7,19),(75.7,14.8,14),13),('open127-rear',(76,22,17),(75.7,14.8,14),10),
 ('triple25-quarter',(-8,9,18),(-11.5,16.15,14.8),7),('gas-hood',(-49,-29,20),(-55.7,-16.05,14),15),
 ('island',(70,-50,33),(38,-13.35,20),36),('bow-profile',(110,-75,8),(114,0,4),35),
 ('underwater-stern',(-136,-25,-12),(-104,0,-4),55)]
for name,location,target,scale in views:
    data=bpy.data.cameras.new(name);cam=bpy.data.objects.new(name,data);scene.collection.objects.link(cam)
    cam.location=location;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
    data.type='ORTHO';data.ortho_scale=scale;scene.camera=cam
    scene.render.resolution_x=1200;scene.render.resolution_y=900;scene.render.filepath=str(OUT/(name+'.png'))
    bpy.ops.render.render(write_still=True)
(OUT/'cameras.json').write_text(json.dumps({'contentHash':D['contentHash'],'views':views},indent=2)+'\n')
