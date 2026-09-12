"""Synchronize pagoda and after-tower CPU plates with the original recipe. Run before ship:compile.

This writes ordinary version 1 structures to blueprint.json; it reads no reference
geometry and does not require Blender. Glazing is deliberately not armored.
"""
import sys,json,math
from pathlib import Path
root=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(root/'assets/ships/kongo/authoring'))
import superstructure,aftertower,foundations,forward_gallery
records=[]
surfaces=[]
def prism(name,outline,z0,z1,material=None,topscale=1):
 records.append((name,outline,z0,z1,topscale))
def mesh(name,vertices,faces,*args,**kwargs):
 if name in ['bridge.conning-roof','bridge.rear-shell','bridge.rear-opening-frame','aftertower.base','aftertower.director-wall'] or name.startswith('bridge.side-director-support-'):
  surfaces.append((name,vertices,faces))
def rect(x0,x1,y0,y1,c=.4):return [(x0,y0+c),(x0+c,y0),(x1-c,y0),(x1,y0+c),(x1,y1-c),(x1-c,y1),(x0+c,y1),(x0,y1-c)]
def oval(x,y,rx,ry,n=32):return [(x+rx*math.cos(i*math.tau/n),y+ry*math.sin(i*math.tau/n)) for i in range(n)]
def cyl(name,loc,radius,depth,material,*args,vertices=32,**kwargs):
 if name.startswith('aftertower.director-'):
  x,y,z=loc;prism(name,oval(x,y,radius,radius,vertices),z-depth/2,z+depth/2,material)
noop=lambda *a,**k:None
h={k:noop for k in ['mesh','rod','cyl','box','rail','shield']};h.update(prism=prism,mesh=mesh,cyl=cyl,rect=rect,oval=oval)
for recipe in [foundations,superstructure,aftertower]:
 recipe.create(h,{k:k for k in ['naval','dark','glass','edge','canvas','bronze']})
p=root/'assets/ships/kongo/blueprint.json';d=json.loads(p.read_text())
d['viewpoints']['bridge']=[0,22.08,-36.0]
next(module for module in d['modules'] if module['id']=='director-aft')['center']=[0,19.5,13.88]
# Glazing remains a free shell path. Preserve separate sill/roof solids and
# thin decks, rather than erecting a solid prism through each open gallery.
keep=['lower','stair-core','middle-room','rear-core','conning','conning-roof','lower-observation',
      'navigation-floor','navigation-sill','navigation-roof','compass-deck','compass-room-sill','compass-room-roof',
      'lower-upper-gallery','upper-observation-room-sill','upper-observation-room-roof','middle-gallery',
      'upper-watch-room-sill','upper-watch-room-roof','upper-gallery','upper-aft-shelter','highest-watch-room-sill',
      'highest-watch-room-roof','director-deck','lower-aft-walk','navigation-aft-walk']
old_ids={'bridge-lower','bridge-trunk','after-tower','bridge-foundation','uptakes'}
d['structures']=[s for s in d['structures'] if s['id'] not in old_ids and not s['id'].startswith(('pagoda-','after-tower-','forward-aa-gallery-'))]
for name,outline,z0,z1,topscale in records:
 suffix=name.removeprefix('bridge.')
 aft=name.startswith('aftertower.')
 foundation_id={'foundation.bridge':'bridge-foundation','uptakes.deckhouse':'uptakes'}.get(name)
 if not name.startswith('bridge.') and not aft and not foundation_id:continue
 if not aft and not foundation_id and suffix not in keep and not suffix.endswith('-hip') and not (suffix.startswith(('forward-director-', 'side-rangefinder-', 'side-director-')) and suffix.endswith(('-housing','-column','-deck','-foot','-seat'))):continue
 id=foundation_id or (('after-tower-'+name.removeprefix('aftertower.')) if aft else ('bridge-lower' if suffix=='lower' else 'bridge-trunk' if suffix=='rear-core' else 'pagoda-'+suffix))
 if any(x['id']==id for x in d['structures']):id+='-'+str(sum(x['id'].startswith(id) for x in d['structures']))
 label={'bridge-foundation':'Bridge and No. 2 turret foundation','uptakes':'Forward funnel deckhouse','after-tower-foot':'Rear funnel and aft tower foundation'}.get(id)
 structure=dict(id=id,name=label or ('After tower '+name.removeprefix('aftertower.') if aft else 'Pagoda '+suffix).replace('-',' '),footprint=[[-y,-x] for x,y in outline],baseY=z0,height=round(z1-z0,6),material='naval')
 if topscale!=1:
  n=len(outline);cx=sum(x for x,y in outline)/n;cy=sum(y for x,y in outline)/n
  vertices=[(x,y,z0) for x,y in outline]+[(cx+(x-cx)*topscale,cy+(y-cy)*topscale,z1) for x,y in outline]
  faces=[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]+[tuple(reversed(range(n))),tuple(range(n,2*n))]
  structure['surface']=dict(vertices=[[-y,z,-x] for x,y,z in vertices],triangles=[[f[0],f[i],f[i+1]] for f in faces for i in range(1,len(f)-1)])
 d['structures'].append(structure)
# Batch all facets of the small director into one contact surface. Separate
# per-facet structures multiply broad-phase work without changing contact shape.
merged=[];batches={}
for name,vertices,faces in surfaces:
 if name!='aftertower.director-wall' and not name.startswith('bridge.side-director-support-'):
  merged.append((name,vertices,faces));continue
 batch_vertices,batch_faces=batches.setdefault(name,([],[]))
 offset=len(batch_vertices);batch_vertices.extend(vertices)
 batch_faces.extend(tuple(offset+i for i in face) for face in faces)
merged.extend((name,vertices,faces) for name,(vertices,faces) in batches.items())
# Append the new crown surface without renumbering existing plating IDs.
merged.sort(key=lambda record:record[0]=='bridge.conning-roof')
# Preserve the physical metal around the apertures without filling their openings.
for index,(name,vertices,faces) in enumerate(merged):
 runtime=[[-y,z,-x] for x,y,z in vertices];xs=[p[0] for p in runtime];ys=[p[1] for p in runtime];zs=[p[2] for p in runtime]
 x0,x1=min(xs),max(xs);z0,z1=min(zs),max(zs)
 id='after-tower' if name=='aftertower.base' else 'after-tower-director-wall' if name.startswith('aftertower.') else f'pagoda-rear-plating-{index:02}'
 label='After director plating' if name.startswith('aftertower.') else 'Pagoda rear mast plating'
 if name=='bridge.conning-roof':
  id='pagoda-conning-roof';label='Conning station roof'
 if name.startswith('bridge.side-director-support-'):
  side='starboard' if name.endswith('--1') else 'port'
  id='pagoda-side-director-support-'+side;label='Side director framing '+side
 d['structures'].append(dict(id=id,name=label,
  footprint=[[x0,z0],[x1,z0],[x1,z1],[x0,z1]],baseY=min(ys),height=max(ys)-min(ys),material='naval',
  surface=dict(vertices=runtime,triangles=[[f[0],f[i],f[i+1]] for f in faces for i in range(1,len(f)-1)])))
# Forward AA deck and webs are ship contact geometry, including all six holes.
# Keep their IDs independent of the existing pagoda surface enumeration.
gallery_surfaces={}
def gallery_mesh(name,vertices,faces,*args,**kwargs):
 key=name.removeprefix('aa.forward-high.')
 vs,fs=gallery_surfaces.setdefault(key,([],[]));offset=len(vs)
 vs.extend(vertices);fs.extend(tuple(offset+i for i in f) for f in faces)
def gallery_deck(name,outline,z0,z1,*args,**kwargs):
 d['structures'].append(dict(id='forward-aa-gallery-deck',name='Forward AA gallery deck',
  footprint=[[-y,-x] for x,y in outline],baseY=z0,height=round(z1-z0,6),material='naval'))
forward_gallery.create(dict(mesh=gallery_mesh,prism=gallery_deck,rod=noop,box=noop),{k:k for k in ['naval','edge']})
for key,(vertices,faces) in gallery_surfaces.items():
 runtime=[[-y,z,-x] for x,y,z in vertices]
 xs,ys,zs=zip(*runtime)
 d['structures'].append(dict(id='forward-aa-gallery-'+key,name='Forward AA gallery '+key,
  footprint=[[min(xs),min(zs)],[max(xs),min(zs)],[max(xs),max(zs)],[min(xs),max(zs)]],
  baseY=min(ys),height=max(ys)-min(ys),material='naval',
  surface=dict(vertices=runtime,triangles=[[f[0],f[i],f[i+1]] for f in faces for i in range(1,len(f)-1)])))
p.write_text(json.dumps(d,indent=2)+'\n')
print(len(d['structures']),'structures; bridge eye',d['viewpoints']['bridge'])
