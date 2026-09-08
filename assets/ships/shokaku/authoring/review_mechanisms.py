"""Mechanical interfaces and conservative independent-neighbor sweep bounds."""
import bpy,json,math
from pathlib import Path
from collections import Counter
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[1]
D=json.loads((ROOT/'../../../public/models/shokaku.json').resolve().read_text())
assert bpy.context.scene.get('definitionHash')==D['contentHash']
OUT=ROOT/'reports'/('geometry-'+D['contentHash'][:8]);OUT.mkdir(exist_ok=True)
deps=bpy.context.evaluated_depsgraph_get();cache={}
for m in D['mounts']:
    for o in bpy.data.objects[m['id']+'.yaw'].children_recursive:
        if o.type!='MESH':continue
        e=o.evaluated_get(deps);data=e.to_mesh();data.calc_loop_triangles()
        cache[o.name]=([v.co.copy() for v in data.vertices],[tuple(t.vertices) for t in data.loop_triangles]);e.to_mesh_clear()
def tree(objects):
    vertices=[];faces=[];owners=[]
    for o in objects:
        vs,fs=cache[o.name];offset=len(vertices)
        vertices.extend(o.matrix_world@v for v in vs);faces.extend(tuple(offset+i for i in f) for f in fs);owners.extend([o.name]*len(fs))
    return BVHTree.FromPolygons(vertices,faces,all_triangles=True),owners
def ancestor(o,suffix):
    while o:
        if o.name.endswith(suffix):return o
        o=o.parent
    return None
def label(name):return name.split('.',1)[1].split('.')[0]
bounds=[];records=[]
for m in D['mounts']:
    yaw=bpy.data.objects[m['id']+'.yaw'];moving=[o for o in yaw.children_recursive if o.name in cache]
    r=0
    for o in moving:
        elevation=ancestor(o,'.elevation');frame=elevation or yaw
        transform=frame.matrix_world.inverted()@o.matrix_world
        for v in cache[o.name][0]:
            p=transform@v
            if elevation:
                # Bounds ANY elevation and independent 0..maximum recoil,
                # including between samples. Rotating about yaw preserves r.
                reach=math.hypot(abs(p.x)+m['weapon']['recoilM'],p.z)
                radius=math.hypot(abs(elevation.location.x)+reach,abs(elevation.location.y)+abs(p.y))
            else:radius=math.hypot(p.x,p.y)
            r=max(r,radius)
    bounds.append({'mount':m['id'],'position':m['position'],'radiusM':r})
    # Each component variant has the same local mechanism, irrespective of
    # station. Check one of each; full ship placement is a separate sweep.
    if any(row['partId']==m['partId'] for row in records):continue
    rigid=[o for o in moving if not ancestor(o,'.elevation')];fixed=tree(rigid)
    axes=[o for o in yaw.children_recursive if o.name.endswith('.elevation')]
    clashes={};samples=0
    lo,hi=m['weapon']['elevationMinDeg'],m['weapon']['elevationMaxDeg']
    for e in sorted(set([lo,hi]+list(range(0,86,5)))):
        for recoil in [0,.5,1]:
            for index,axis in enumerate(axes):
                axis.rotation_euler.y=-math.radians(e)
                for o in axis.children_recursive:
                    if o.name.endswith('.recoil'):o.location.x=-recoil*m['weapon']['recoilM']
            bpy.context.view_layer.update();samples+=1
            for axis in axes:
                a=tree([o for o in axis.children_recursive if o.name in cache])
                for i,j in a[0].overlap(fixed[0]):
                    moving_name,fixed_name=a[1][i],fixed[1][j];x,y=label(moving_name),label(fixed_name)
                    if y in ['fixed-trunnion-shaft','trunnion-cap'] and x in ['elevating-bearing','cradle-slide','barrel-0']:continue
                    key=moving_name+' | '+fixed_name
                    if key not in clashes:clashes[key]={'meshes':[moving_name,fixed_name],'firstPose':[e,recoil],'trianglePairs':0}
                    clashes[key]['trianglePairs']+=1
    for axis in axes:
        axis.rotation_euler.y=-math.radians(1)
        for o in axis.children_recursive:
            if o.name.endswith('.recoil'):o.location.x=0
    bpy.context.view_layer.update()
    records.append({'partId':m['partId'],'mount':m['id'],'samples':samples,'interfacesExcluded':'Only trunnion shaft/caps against the elevating bearing, cradle and inner barrel collar.','clashes':list(clashes.values())})
    print(m['partId'],len(clashes),'interface pairs',flush=True)
neighbors=[]
for i,a in enumerate(bounds):
    for b in bounds[i+1:]:
        distance=math.hypot(a['position'][0]-b['position'][0],a['position'][2]-b['position'][2])
        neighbors.append({'a':a['mount'],'b':b['mount'],'guaranteedGapM':distance-a['radiusM']-b['radiusM']})
neighbors.sort(key=lambda r:r['guaranteedGapM'])
(OUT/'mechanisms.json').write_text(json.dumps({'contentHash':D['contentHash'],'scope':'Moving gun mechanisms against their yaw assembly. Fixed, intended trunnion-bearing intersections excluded. Surface intersections need inspection, including contained volumes.','result':'fail' if any(r['clashes'] for r in records) else 'sampled interfaces clear','variants':records},indent=2)+'\n')
(OUT/'neighbors.json').write_text(json.dumps({'contentHash':D['contentHash'],'method':'Conservative horizontal cylinders enclose every mesh vertex at ANY independent train, elevation and 0..maximum recoil. Positive cylinder gaps prove separation continuously, without relying on endpoint poses.','result':'pass' if neighbors[0]['guaranteedGapM']>0 else 'requires narrower pair sweep','bounds':bounds,'pairs':neighbors},indent=2)+'\n')
print('Minimum guaranteed neighbor gap',neighbors[0],flush=True)
