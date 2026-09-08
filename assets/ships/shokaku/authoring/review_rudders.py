"""Sample retained tandem rudder yaw joints against the actual fixed exterior.

Stocks are intended hinge interfaces. Surface-carrier steering does not yet
animate these retained joints in normal play; this checks their authored range.
"""
import bpy,json,math
from pathlib import Path
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[1]
D=json.loads((ROOT/'../../../public/models/shokaku.json').resolve().read_text())
assert bpy.context.scene.get('definitionHash')==D['contentHash']
OUT=ROOT.parents[2]/'.build/ships/shokaku'/('geometry-'+D['contentHash'][:8]);OUT.mkdir(parents=True,exist_ok=True)
pivots=[bpy.data.objects['rudder-'+id+'.yaw'] for id in ['aft','forward']]
fins=[next(o for o in p.children if o.name.startswith('Rounded balanced rudder')) for p in pivots]
cache={}
for o in bpy.context.scene.objects:
    if o.type!='MESH' or o.get('exportRole')=='simulation':continue
    o.data.calc_loop_triangles()
    cache[o.name]=([v.co.copy() for v in o.data.vertices],[tuple(t.vertices) for t in o.data.loop_triangles])
def tree(objects):
    verts=[];faces=[];names=[]
    for o in objects:
        vs,ts=cache[o.name];n=len(verts);verts.extend(o.matrix_world@v for v in vs)
        faces.extend(tuple(n+i for i in t) for t in ts);names.extend([o.name]*len(ts))
    return BVHTree.FromPolygons(verts,faces,all_triangles=True),names
exclude={o.name for p in pivots for o in p.children_recursive}
fixed=tree([o for o in bpy.context.scene.objects if o.name in cache and o.name not in exclude])
angles=sorted(set([-35,35]+list(range(-30,31,5))));rows=[]
for p,fin in zip(pivots,fins):
    pairs={}
    for a in angles:
        p.rotation_euler.z=math.radians(a);bpy.context.view_layer.update();t=tree([fin])
        for i,j in t[0].overlap(fixed[0]):pairs.setdefault(fixed[1][j],a)
    p.rotation_euler.z=0;bpy.context.view_layer.update()
    rows.append({'joint':p.name,'anglesDeg':angles,'clashes':[{'mesh':name,'firstAngleDeg':a} for name,a in pairs.items()]})
neighbors=[]
for a in angles:
    pivots[0].rotation_euler.z=math.radians(a)
    for b in angles:
        pivots[1].rotation_euler.z=math.radians(b);bpy.context.view_layer.update()
        if tree([fins[0]])[0].overlap(tree([fins[1]])[0]):neighbors.append([a,b])
for p in pivots:p.rotation_euler.z=0
bpy.context.view_layer.update()
r={'contentHash':D['contentHash'],'scope':__doc__,'rudders':rows,'independentNeighborPoses':len(angles)**2,'neighborClashes':neighbors,'result':'fail' if neighbors or any(r['clashes'] for r in rows) else 'sampled rudder sweep clear'}
(OUT/'rudders.json').write_text(json.dumps(r,indent=2)+'\n');print('RUDDER REVIEW',json.dumps(r),flush=True)
if r['result']=='fail':raise RuntimeError('Rudder intersects exterior geometry')
