"""Neutral-pose physical contact graph, independent of scene parenting.

Triangle intersections or <=20 mm surface proximity count as contact. The
proximity allowance covers export precision and thin painted/bolted details.
Every disconnected island requires visual inspection; this is not a sole pass.
"""
import bpy,json,math,re
from pathlib import Path
from mathutils.bvhtree import BVHTree
ROOT=Path(__file__).resolve().parents[1]
D=json.loads((ROOT/'../../../public/models/shokaku.json').resolve().read_text())
assert bpy.context.scene.get('definitionHash')==D['contentHash']
OUT=ROOT/'reports'/('geometry-'+D['contentHash'][:8]);OUT.mkdir(exist_ok=True)
deps=bpy.context.evaluated_depsgraph_get();rows=[];epsilon=.02
for o in bpy.context.scene.objects:
    if o.type!='MESH' or o.get('exportRole')=='simulation':continue
    e=o.evaluated_get(deps);m=e.to_mesh();m.calc_loop_triangles()
    vs=[o.matrix_world@v.co for v in m.vertices];fs=[tuple(t.vertices) for t in m.loop_triangles];e.to_mesh_clear()
    lo=[min(v[i] for v in vs) for i in range(3)];hi=[max(v[i] for v in vs) for i in range(3)]
    rows.append({'name':o.name,'vertices':vs,'tree':BVHTree.FromPolygons(vs,fs,all_triangles=True),'lo':lo,'hi':hi})
rows.sort(key=lambda row:row['lo'][0]);parents=list(range(len(rows)))
def root(i):
    while i!=parents[i]:parents[i]=parents[parents[i]];i=parents[i]
    return i
def contact(a,b):
    if a['tree'].overlap(b['tree']):return True
    for u,v in [(a,b),(b,a)]:
        for p in u['vertices']:
            if any(p[k]<v['lo'][k]-epsilon or p[k]>v['hi'][k]+epsilon for k in range(3)):continue
            hit=v['tree'].find_nearest(p,epsilon)
            if hit[0] is not None:return True
    return False
active=[];tested=0;contacts=0
for i,a in enumerate(rows):
    active=[j for j in active if rows[j]['hi'][0]+epsilon>=a['lo'][0]]
    for j in active:
        if root(i)==root(j):continue
        b=rows[j]
        if any(a['hi'][k]+epsilon<b['lo'][k] or b['hi'][k]+epsilon<a['lo'][k] for k in [1,2]):continue
        tested+=1
        if contact(a,b):parents[root(i)]=root(j);contacts+=1
    active.append(i)
    if i%2000==0:print(i,len(rows),'objects checked',flush=True)
groups={}
for i,row in enumerate(rows):groups.setdefault(root(i),[]).append(row['name'])
ordered=sorted(groups.values(),key=len,reverse=True)
report={'contentHash':D['contentHash'],'method':__doc__,'objects':len(rows),'candidatePairsTested':tested,'contactEdges':contacts,'components':len(ordered),'largestComponentObjects':len(ordered[0]),'disconnected':ordered[1:],'result':'review disconnected components' if len(ordered)>1 else 'neutral contact graph connected'}
(OUT/'attachments.json').write_text(json.dumps(report,indent=2)+'\n')
print('ATTACHMENT GRAPH',len(ordered),'components; largest',len(ordered[0]),flush=True)
for names in ordered[1:][:35]:print(names[:8],flush=True)
