"""Black-box regression for overlapping island walking surfaces in source or GLB.

Triangle intersection area is measured in the horizontal plane. Shared edges
have zero area; opposite-facing bearing/ceiling contacts are not duplicate top
skins. Tests every structure crossing the four island deck-top elevations,
including the flight deck where it meets the lower gallery. Hidden hangar
ceilings, flight-deck markings and fittings at other heights are outside scope.
No pair exclusions or material/depth-bias assumptions.
"""
import bpy,json,sys,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
D=json.loads((ROOT/'../../../public/models/shokaku.json').resolve().read_text())
mode='source';up=2;horizontal=(0,1)
if '--glb' in args:
    path=Path(args[args.index('--glb')+1]);raw=path.read_bytes();length,kind=struct.unpack_from('<II',raw,12)
    doc=json.loads(raw[20:20+length]);mode='glb'
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(path.resolve()))
    # Blender's glTF importer converts glTF Y-up into Blender Z-up.
    up=2;horizontal=(0,1)
    hashes=[]
    def collect(v):
        if isinstance(v,dict):
            for k,x in v.items():
                if k in ['contentHash','definitionHash'] and isinstance(x,str):hashes.append(x)
                collect(x)
        elif isinstance(v,list):
            for x in v:collect(x)
    collect(doc)
    assert D['contentHash'] in hashes, 'GLB hash missing or stale'
    content_hash=D['contentHash']
else:
    content_hash=bpy.context.scene.get('definitionHash')
    assert content_hash, 'Source scene has no definition hash'
    if '--out' not in args:assert content_hash==D['contentHash'], 'Source hash is stale; use --out for retained baseline evidence'

ids={s['id']+'.surface' for s in D['structures']};rows=[]
decks=['bridge-walkway','navigation-wings','compass-platform','bridge-roof']
levels=[s['baseY']+s['height'] for s in D['structures'] if s['id'] in decks]
assert len(levels)==len(decks), 'Definition is missing an island deck'
for o in bpy.context.scene.objects:
    if o.type!='MESH':continue
    # Source meshes have nodeId directly; exported primitives inherit a node.
    owner=o
    while owner and owner.get('nodeId') not in ids:owner=owner.parent
    if not owner:continue
    o.data.calc_loop_triangles()
    for tri in o.data.loop_triangles:
        pts=[o.matrix_world@o.data.vertices[i].co for i in tri.vertices]
        n=(pts[1]-pts[0]).cross(pts[2]-pts[0])
        if n.length<1e-9 or n.normalized()[up]<.9999:continue
        if max(p[up] for p in pts)-min(p[up] for p in pts)>.0001:continue
        if not any(abs(pts[0][up]-z)<.001 for z in levels):continue
        ps=[(p[horizontal[0]],p[horizontal[1]]) for p in pts]
        rows.append({'id':owner['nodeId'],'mesh':o.name,'triangle':tri.index,'z':sum(p[up] for p in pts)/3,'pts':ps,'bounds':(min(p[0] for p in ps),min(p[1] for p in ps),max(p[0] for p in ps),max(p[1] for p in ps))})

def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
def area(poly):return abs(sum(a[0]*b[1]-a[1]*b[0] for a,b in zip(poly,poly[1:]+poly[:1])))/2 if len(poly)>2 else 0
def overlap(a,b):
    # Clip one triangle against the other's three half-planes.
    polygon=a;sign=1 if cross(*b)>0 else -1
    for u,v in zip(b,b[1:]+b[:1]):
        out=[]
        for p,q in zip(polygon,polygon[1:]+polygon[:1]):
            cp=sign*cross(u,v,p);cq=sign*cross(u,v,q)
            if cp>=-1e-9:out.append(p)
            if (cp>=0)!=(cq>=0):
                t=cp/(cp-cq);out.append((p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])))
        polygon=out
        if len(polygon)<3:return 0
    return area(polygon)

rows.sort(key=lambda r:r['z']);pairs={}
for i,a in enumerate(rows):
    for b in rows[i+1:]:
        if b['z']-a['z']>.001:break
        aa=a['bounds'];bb=b['bounds']
        if aa[2]<=bb[0]+1e-7 or bb[2]<=aa[0]+1e-7 or aa[3]<=bb[1]+1e-7 or bb[3]<=aa[1]+1e-7:continue
        shared=overlap(a['pts'],b['pts'])
        if shared<.00001:continue
        key=tuple(sorted([a['id'],b['id']]))
        row=pairs.setdefault(key,{'surfaces':list(key),'heightM':a['z'],'overlapAreaM2':0,'trianglePairs':0})
        row['overlapAreaM2']+=shared;row['trianglePairs']+=1
missing=sorted({id+'.surface' for id in decks}-{row['id'] for row in rows})
r={'contentHash':content_hash,'mode':mode,'scope':__doc__,'deckHeightsM':levels,'horizontalTriangles':len(rows),'missingDeckSurfaces':missing,'coplanarToleranceM':.001,'minimumOverlapAreaM2':.00001,'overlaps':list(pairs.values()),'result':'fail' if pairs or missing else 'pass'}
out=Path(args[args.index('--out')+1]) if '--out' in args else ROOT.parents[2]/'.build/ships/shokaku'/('geometry-'+content_hash[:8])/('decks-'+mode+'.json')
out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(r,indent=2)+'\n');print('DECK_REVIEW',json.dumps(r),flush=True)
if missing:raise RuntimeError('Missing island deck surfaces: '+', '.join(missing))
if pairs:raise RuntimeError('Coplanar overlapping deck surfaces')
