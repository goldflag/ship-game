"""Regression check for glass over opaque walls in the actual Blender output.

Run against source.blend. Samples pane interiors against opaque island triangles,
independently of recipe implementation; coplanar underlying walls must fail.
Optional --out PATH preserves a before-build failure as well as after evidence.
"""
import bpy,json,sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

island=bpy.data.collections.get('Island');vertices=[];triangles=[];panes=[]
for o in island.objects:
    if o.type!='MESH':continue
    o.data.calc_loop_triangles();matrix=o.matrix_world
    for polygon in o.data.polygons:
        material=o.data.materials[polygon.material_index] if o.data.materials else None
        if material and material.name=='glass' and (o.get('nodeId') in ['navigation-bridge.surface','air-control.surface'] or o.name.startswith('Bridge window')):
            points=[matrix@o.data.vertices[i].co for i in polygon.vertices]
            panes.append((o.name,polygon.index,points))
    for tri in o.data.loop_triangles:
        material=o.data.materials[tri.material_index] if o.data.materials else None
        if material and material.name=='glass':continue
        n=len(vertices);vertices.extend(matrix@o.data.vertices[i].co for i in tri.vertices);triangles.append((n,n+1,n+2))
opaque=BVHTree.FromPolygons(vertices,triangles,all_triangles=True)
rows=[]
for name,index,points in panes:
    center=sum(points,Vector())/len(points);samples=[center]+[center.lerp(p,.55) for p in points]
    gap=min(opaque.find_nearest(p)[3] for p in samples)
    rows.append({'object':name,'face':index,'minimumInteriorClearanceM':gap})
result={'contentHash':bpy.context.scene.get('definitionHash'),'scope':'Superstructure glazing; existing ship-boat window components are a separate asset.', 'method':'Pane-center and four inset-corner distances to all opaque island triangles; 1 mm detects coincident walls. Recess/jamb intersections at pane edges are intentional and not sampled. Actual game camera captures separately verify appearance.','panes':len(rows),'coplanar':sum(r['minimumInteriorClearanceM']<.001 for r in rows),'minimumInteriorClearanceM':min((r['minimumInteriorClearanceM'] for r in rows),default=0),'rows':rows}
result['result']='pass' if rows and result['coplanar']==0 and result['minimumInteriorClearanceM']>.02 else 'fail'
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
out=Path(args[args.index('--out')+1]) if '--out' in args else Path(__file__).resolve().parents[4]/'.build/ships/shokaku'/('geometry-'+result['contentHash'][:8])/'windows.json'
out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,indent=2)+'\n')
print('WINDOW_REVIEW',json.dumps({k:v for k,v in result.items() if k!='rows'}),flush=True)
if result['result']!='pass':raise RuntimeError('Glass competes with opaque island geometry')
