"""Original CV-6 deck construction, revision 1; run after author.py in Blender.

Replays our retained slab/opening/camber recipe into versioned blueprint faces.
Production builds consume these faces directly; no generated model is an input.
"""
import bpy, bmesh, json, math
from pathlib import Path

path=Path(__file__).resolve().parents[1]/'enterprise-cv6/blueprint.json'
b=json.loads(path.read_text());structures={s['id']:s for s in b['structures']}
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)

def prism(s,extra=0):
    points=[(-z,-x) for x,z in s['footprint']];n=len(points)
    v=[(x,y,z) for z in [s['baseY']-extra,s['baseY']+s['height']+extra] for x,y in points]
    f=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    mesh=bpy.data.meshes.new(s['id']);mesh.from_pydata(v,[],f);mesh.update()
    obj=bpy.data.objects.new(s['id'],mesh);bpy.context.collection.objects.link(obj)
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
    return obj

flight=prism(structures['flight-deck'])
for id,s in structures.items():
    if not id.startswith('elevator'):continue
    cutter=prism(s,1)
    bpy.context.view_layer.objects.active=flight
    mod=flight.modifiers.new('Original opening '+id,'BOOLEAN');mod.operation='DIFFERENCE';mod.solver='EXACT';mod.object=cutter
    bpy.ops.object.modifier_apply(modifier=mod.name);bpy.data.objects.remove(cutter,do_unlink=True)

for id in ['flight-deck','elevator-forward','elevator-middle','elevator-aft']:
    s=structures[id];obj=flight if id=='flight-deck' else prism(s)
    bm=bmesh.new();bm.from_mesh(obj.data)
    for y in range(math.floor(min(v.co.y for v in bm.verts))+1,math.ceil(max(v.co.y for v in bm.verts))):
        bmesh.ops.bisect_plane(bm,geom=[*bm.verts,*bm.edges,*bm.faces],dist=.000001,plane_co=(0,y,0),plane_no=(0,1,0))
    for v in bm.verts:v.co.z-=(4/12*.3048)*(v.co.y/(46*.3048))**2
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001)
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(obj.data);bm.free()
    s['surface']={'vertices':[[-v.co.y,v.co.z,-v.co.x] for v in obj.data.vertices],'triangles':[list(p.vertices) for p in obj.data.polygons]}
    assert len(s['surface']['vertices'])<=2048 and len(s['surface']['triangles'])<=4096
    print(id,len(s['surface']['vertices']),'vertices',len(s['surface']['triangles']),'triangles')
path.write_text(json.dumps(b,indent=2)+'\n')
