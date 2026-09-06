"""Inspect our original blade solids and conservative barrel/enclosure clearance.
Run from the repository root with local Blender after ship:build.
"""
import bpy,bmesh,json,math,hashlib
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
root=Path.cwd();s=root/'assets/ships/fletcher'
bpy.ops.wm.open_mainfile(filepath=str(s/'generated/source.blend'))
blades=[o for o in bpy.data.objects if o.type=='MESH' and o.name.startswith('propeller-') and '.blade-' in o.name]
rows=[]
for o in blades:
 bm=bmesh.new();bm.from_mesh(o.data);row={'name':o.name,'vertices':len(bm.verts),'boundaryEdges':sum(e.is_boundary for e in bm.edges),'nonManifoldEdges':sum(not e.is_manifold for e in bm.edges),'volumeM3':bm.calc_volume(signed=True)};bm.free()
 assert row['nonManifoldEdges']==0 and row['volumeM3']>0,row
 rows.append(row)
assert len(rows)==6
p=next(p for p in json.loads((root/'assets/parts/guns.json').read_text())['parts'] if p['id']=='us-5in38-mk30-single');m=p['gunhouseMesh'];bvh=BVHTree.FromPolygons(m['vertices'],[f['indices'] for f in m['faces']],all_triangles=True)
clearances=[]
for deg in [-15,0,40,85]:
 for recoil in [0,p['recoilM']]:
  distances=[];a=math.radians(deg)
  for i in range(100):
   x=1.49+(p['muzzleForward']-p['trunnionForward']-1.49)*i/99
   center=Vector((p['trunnionForward']+(x-recoil)*math.cos(a),0,p['pivotHeight']+(x-recoil)*math.sin(a)))
   # Conservative maximum barrel radius at every sample, including narrow muzzle.
   distances.append(bvh.find_nearest(center)[3]-.156)
  clearances.append({'elevationDeg':deg,'recoilM':recoil,'barrelSurfaceClearanceLowerBoundM':min(distances)})
assert min(x['barrelSurfaceClearanceLowerBoundM'] for x in clearances)>0,clearances
report={'recipeSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'sourceBlendSha256':hashlib.sha256((s/'generated/source.blend').read_bytes()).hexdigest(),'contentHash':json.loads((root/'public/models/fletcher.json').read_text())['contentHash'],'closedBlades':rows,'barrelClearanceSamples':clearances,'limits':'Original component only; sparse conservative barrel-radius samples. Not an all-fittings collision proof or historical certification.'}
(s/'reports/component-geometry-check.json').write_text(json.dumps(report,indent=2)+'\n')
print('COMPONENT CHECK',len(rows),'closed solid blades; minimum sampled barrel clearance',min(x['barrelSurfaceClearanceLowerBoundM'] for x in clearances))
