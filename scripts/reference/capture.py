"""Load GameModels3D visual geometry ONLY in an isolated, disposable reference scene.

No raw geometry, derived sections, or attachment transforms leave this stage.
Only raster captures, source hashes and camera/registration metadata are retained.
"""
import bpy, copy, gzip, hashlib, json, os, sys
from pathlib import Path
from mathutils import Matrix, Vector
sys.path.insert(0,str(Path(__file__).resolve().parent))
from render_views import render_views

root=Path(__file__).resolve().parents[2]
ship=os.environ.get('REFERENCE_SHIP','bismarck')
cache=root/'.build/reference-cache'/ship
out=root/'assets/ships'/ship/'references/gamemodels3d'
manifest=json.loads((cache/'manifest.json').read_text())
planpath=root/'assets/ships'/ship/'references/capture-plan.json'
plan=json.loads(planpath.read_text())
scheme=json.loads((cache/'scheme.json').read_text())
if hashlib.sha256((cache/'scheme.json').read_bytes()).hexdigest()!=manifest['schemeSha256']:raise ValueError('Stale reference scene graph')
files={f['path']:f for f in manifest['files']}
scenegraph={'nodes':copy.deepcopy(scheme['A_Hull'])}
def child_items(node):
    children=node.get('nodes',{})
    return enumerate(children) if isinstance(children,list) else children.items()
def find(node,key):
    for name,child in child_items(node):
        if name==key:return child
        match=find(child,key)
        if match is not None:return match
for component,items in scheme.items():
    if component=='A_Hull' or not isinstance(items,dict):continue
    for name,payload in items.items():
        target=find(scenegraph,name)
        if target is None:continue
        target.update({k:copy.deepcopy(v) for k,v in payload.items() if k!='transform'})
        if payload.get('transform',{}).get('rotation'):
            a=Matrix(target.get('transform',{}).get('matrix',Matrix.Identity(4))).transposed()
            r=Matrix(payload['transform']['rotation']).transposed()
            target['transform']={'matrix':[list(row) for row in (a@r).transposed()]}

bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0
# A single whole-model registration is reviewed in the per-vessel capture plan.
s=plan['registration']['uniformScale']
if not isinstance(s,(int,float)) or not 0<s<1000:raise ValueError('Invalid reference registration scale')
basis=Matrix(((0,0,s,0),(-s,0,0,0),(0,s,0,0),(0,0,0,1)))
objects=[]
def walk(name,node,parent):
    local=Matrix(node.get('transform',{}).get('matrix',Matrix.Identity(4))).transposed()
    world=parent@local
    path=node.get('visual')
    if isinstance(path,str) and not files[path].get('omitted'):
        data=(cache/'models'/(path+'.model')).read_bytes()
        if hashlib.sha256(data).hexdigest()!=files[path]['sha256']:raise ValueError('Corrupt reference cache: '+path)
        model=json.loads(gzip.decompress(data))
        for part,g in model['geometry'].items():
            pos=g['position'];ids=g['index']
            vertices=[tuple(basis@world@Vector(pos[i:i+3])) for i in range(0,len(pos),3)]
            mesh=bpy.data.meshes.new(str(name));mesh.from_pydata(vertices,[],[list(reversed(ids[i:i+3])) if (basis@world).determinant()<0 else ids[i:i+3] for i in range(0,len(ids),3)]);mesh.update()
            ob=bpy.data.objects.new(str(name)+' '+part,mesh);bpy.context.scene.collection.objects.link(ob)
            ob['referenceRole']='main' if '/gun/main/' in path else 'hull-superstructure' if '/ship/' in path else 'fittings'
            ob['referenceOnly']=True;objects.append(ob)
    for n,c in child_items(node):walk(n,c,world)
walk('root',scenegraph,Matrix.Identity(4))
print('REFERENCE OBJECTS',len(objects),flush=True)
source={'id':manifest['sourceId'],'gameVersion':manifest['gameVersion'],'manifestSha256':hashlib.sha256((cache/'manifest.json').read_bytes()).hexdigest()}
captures=render_views(plan,out,objects,source)
manifest.update({'captures':captures,'capturePlanSha256':hashlib.sha256(planpath.read_bytes()).hexdigest(),'captureRecipeSha256':hashlib.sha256(Path(__file__).read_bytes()+Path(__file__).with_name('render_views.py').read_bytes()).hexdigest(),'registration':{**plan['registration'],'matrix':[list(row) for row in basis],'historicallyVerified':False},'limitations':['Optional empty components are recorded in files.', 'Hull and superstructure may be fused in the reference chunks. Hull-only close-ups use camera framing; no geometry-derived sections or shape measurements are exported.']})
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('REFERENCE CAPTURE COMPLETE',len(captures),flush=True)
