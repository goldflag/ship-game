"""Render the actual published GLB in exactly the reference cameras."""
import bpy, hashlib, json, math, os, sys
from pathlib import Path
from mathutils import Matrix
sys.path.insert(0,str(Path(__file__).resolve().parent))
from render_views import render_views
root=Path(__file__).resolve().parents[2];ship=os.environ.get('REFERENCE_SHIP','bismarck')
source=root/'assets/ships'/ship;model=root/'public/models'/(ship+'.glb')
definition=json.loads((root/'public/models'/(ship+'.json')).read_text())
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(model))
for ob in list(bpy.context.scene.objects):
 if not ob.parent:ob.matrix_world=Matrix.Rotation(-math.pi/2,4,'Z')@ob.matrix_world
main={m['id'] for m in definition['mounts'] if m['battery']=='main'}
for ob in bpy.context.scene.objects:
 assembly=ob.get('assemblyId','')
 ob['referenceRole']='main' if assembly in main else 'hull-superstructure' if assembly.startswith('hull') or assembly.startswith('superstructure') else 'fittings'
planpath=source/'references/capture-plan.json';plan=json.loads(planpath.read_text())
out=source/'generated/comparison/authored'
captures=render_views(plan,out,[o for o in bpy.context.scene.objects if o.type=='MESH'],{'id':ship,'contentHash':definition['contentHash'],'modelSha256':hashlib.sha256(model.read_bytes()).hexdigest()})
(out/'manifest.json').write_text(json.dumps({'schemaVersion':1,'contentHash':definition['contentHash'],'modelSha256':hashlib.sha256(model.read_bytes()).hexdigest(),'capturePlanSha256':hashlib.sha256(planpath.read_bytes()).hexdigest(),'captures':captures},indent=2)+'\n')
