"""Original Fubuki A exterior, authored in metres (+X bow, +Y port, +Z up).
Blueprint surfaces and original registered parts are the only geometry inputs.
"""
import bpy,bmesh,json,math,os,sys
from pathlib import Path
from mathutils import Vector,Matrix
from array import array
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'assets/parts'))
from library import create_mount
out=Path(os.environ['SHIP_OUTPUT']);definition=json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;scene.name='Fubuki original';scene.unit_settings.system='METRIC';scene.unit_settings.scale_length=1
col=bpy.data.collections.new('Fubuki original assemblies');scene.collection.children.link(col)
materials={}
colors={'naval':(.25,.28,.30,1),'hullgray':(.23,.26,.28,1),'roof':(.22,.25,.27,1),'deck':(.18,.21,.23,1),'edge':(.105,.13,.15,1),'canvas':(.43,.45,.42,1),'dark':(.018,.024,.027,1),'glass':(.045,.072,.08,1),'underwater':(.19,.115,.065,1),'bronze':(.34,.27,.13,1),'rope':(.27,.24,.18,1),'white':(.65,.64,.58,1),'wood':(.27,.19,.13,1),'wear':(.31,.33,.34,1),'linoleum':(.30,.125,.06,1)}
for key,color in colors.items():
 # Match the approved gray finish under the game's ocean lighting; hull paint is textured below.
 if key != 'hullgray':color=tuple(v*.4 for v in color[:3])+(color[3],)
 m=bpy.data.materials.new('Fubuki '+key);m.diffuse_color=color;m.use_nodes=True
 bs=m.node_tree.nodes['Principled BSDF'];bs.inputs['Base Color'].default_value=color;bs.inputs['Roughness'].default_value=.78;bs.inputs['Metallic'].default_value=.12
 materials[key]=m
exec(compile((Path(__file__).parent/'geometry.py').read_text(),'fubuki-primitives','exec'),globals())
h=definition['hull'];half=h['length']/2

def interp(table,s):
 for (a,u),(b,v) in zip(table,table[1:]):
  if a<=s<=b:return u+(v-u)*(s-a)/(b-a)
 return table[0][1] if s<table[0][0] else table[-1][1]
# Deck-edge half-breadths (the section point below the crown); the shell flares wider below the forecastle edge.
deck_edge=[(section['station'],section['points'][-2][0]) for section in h['sections']]
width=lambda x:interp(deck_edge,x+half)
deckz=lambda x:interp(h['deckHeights'],x+half)
def shell_width(x,z):
 rows=[]
 for section in h['sections']:
  pts=section['points'];hits=[]
  for (a,u),(b,v) in zip(pts,pts[1:]):
   if min(u,v)<=z<=max(u,v) and abs(v-u)>1e-8:hits.append(a+(b-a)*(z-u)/(v-u))
  rows.append((section['station']-half,max(hits,default=0)))
 return interp(rows,x)
# Station envelope and deck use the same surfaces as the CPU hit geometry.
vs=[]
for section in h['sections']:
 pts=section['points'];ring=pts+[[-w,z] for w,z in reversed(pts[1:])]
 vs.extend((section['station']-half,w,z) for w,z in ring)
n=len(ring);fs=[]
for i in range(len(h['sections'])-1):fs += [(i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j) for j in range(n)]
fs += [tuple(reversed(range(n))),tuple((len(h['sections'])-1)*n+j for j in range(n))]
hull=mesh('hull.envelope',vs,fs,materials['hullgray'],smooth=True);hull['nodeId']='hull.surface'
vs=[]
for station,w in deck_edge:
 x=station-half;z=deckz(x)+.01;vs += [(x,-w,z),(x,0,z+.005),(x,w,z)]
mesh('deck.main',vs,[(i*3+j,i*3+j+1,(i+1)*3+j+1,(i+1)*3+j) for i in range(len(deck_edge)-1) for j in range(2)],materials['deck'])
for lo,hi in [(20.35,49.2),(-48.5,-28),(4.5,17.7),(-9.7,1.5)]:
 xs=[lo]+[s-half for s,w in deck_edge if lo<s-half<hi]+[hi]
 vs=[(x,sign*max(.01,width(x)-.26),deckz(x)+.018) for x in xs for sign in [-1,1]]
 mesh('deck.linoleum',vs,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(len(xs)-1)],materials['linoleum'])
 for x in [lo+i*1.85 for i in range(int((hi-lo)/1.85)+1)]:rod('deck.retaining-strip',(x,-width(x)+.26,deckz(x)+.027),(x,width(x)-.26,deckz(x)+.027),.012,materials['bronze'],vertices=5)
# Lifelines and hull-side apertures, with the foregun sweep lowered.
for sign in [-1,1]:
 pts=[(s-half,sign*max(.02,w-.08),deckz(s-half)+.065) for s,w in deck_edge if .6<s<h['length']-.6]
 # Lifelines fold down across the foregun training sweep, as in the reference.
 for a,b in zip(pts,pts[1:]):
  low=any(36<p[0]<48 for p in [a,b])
  rails('rails.perimeter',[a,b],.13 if low else .85,spacing=2.0)
 tube_path('hull.deck-edge',pts,.034,materials['edge'],sides=6)
 for x in list(range(23,53,3))+list(range(-53,-38,3)):
  portlight('hull.portlight',(x,sign*shell_width(x,deckz(x)-.68),deckz(x)-.68),(0,sign,0),.105)
 for x in range(25,51,4):portlight('hull.lower-portlight',(x,sign*shell_width(x,2.5),2.5),(0,sign,0),.105)
# Definition-owned superstructure. A structure with a surface is drawn from it; the others are prisms.
def structure_outline(id):
 return [(-z,-x) for x,z in next(s for s in definition['structures'] if s['id']==id)['footprint']]
def wall_point(id,x,side):
 """Point and outward normal on the structure wall at forward position x on one side."""
 outline=structure_outline(id);best=None
 for (x0,y0),(x1,y1) in zip(outline,outline[1:]+outline[:1]):
  if min(x0,x1)<=x<=max(x0,x1) and abs(x1-x0)>1e-8:
   y=y0+(y1-y0)*(x-x0)/(x1-x0)
   if side*y>0 and (best is None or abs(y)>abs(best[0])):best=(y,Vector((y1-y0,-(x1-x0),0)).normalized())
 y,n=best
 if n.y*side<0:n=-n
 return y,n
def structure_width(id,x):return abs(wall_point(id,x,1)[0])
def windows(id,outline,z0,z1,skip_aft=None):
 # Window panes follow each actual wall segment, with visible mullions and sill.
 for a,b in zip(outline,outline[1:]+outline[:1]):
  va,vb=Vector(a),Vector(b);length=(vb-va).length
  if skip_aft is not None and max(va.x,vb.x)<skip_aft:continue
  steps=max(1,round(length/.53));normal=Vector(((vb-va).y,-(vb-va).x)).normalized()
  for j in range(steps):
   aa=va.lerp(vb,(j+.08)/steps)+normal*.016;bb=va.lerp(vb,(j+.92)/steps)+normal*.016
   mesh(id+'.window',[(aa.x,aa.y,z0),(bb.x,bb.y,z0),(bb.x,bb.y,z1),(aa.x,aa.y,z1)],[(0,1,2,3)],materials['glass'])
   rod(id+'.mullion',(aa.x,aa.y,z0-.03),(aa.x,aa.y,z1+.04),.024,materials['naval'],vertices=6)
  tube_path(id+'.sill',[(va.x,va.y,z0-.05),(vb.x,vb.y,z0-.05)],.04,materials['naval'])
for s in definition['structures']:
 if 'funnel' in s['id']:continue
 outline=[(-z,-x) for x,z in s['footprint']];base=s['baseY'];top=base+s['height']
 if s['id']=='bridge-upper':
  # Open upper bridge: plated deck inside plated bulwarks.
  prism(s['id']+'.deck',outline,base-.12,base+.02)
  bulwark(s['id'],outline,base+.02,top-base-.02,thick=.06)
  continue
 if 'surface' in s:
  surface=s['surface'];vs=[(-z,-x,y) for x,y,z in surface['vertices']]
  obj=mesh(s['id']+'.walls',vs,surface['triangles'],materials['naval'])
 else:
  obj=prism(s['id']+'.walls',outline,12.8 if s['id']=='bridge-compass' else base,top)
 tube_path(s['id']+'.roof-edge',[(x,y,top+.025) for x,y in outline],.04,materials['edge'],closed=True)
 if s['id']=='wheelhouse':windows(s['id'],outline,top-.87,top-.16,skip_aft=-24.2)
 elif s['id']=='bridge-compass':windows(s['id'],outline,13.66,14.1,skip_aft=-25.3)
 elif s['id']=='bridge-lower':
  for side in [-1,1]:
   for x in [23.4,25.2,27.0,28.6]:
    for z in [6.2,8.0]:
     y,n=wall_point('bridge-lower',x,side);portlight('bridge.portlight',(x,y,z),n,.16)
 elif s['id']!='fore-uptake':
  x0=min(x for x,y in outline);x1=max(x for x,y in outline);w=max(abs(y) for x,y in outline)
  for side in [-1,1]:
   if top-base>1.3:door(s['id']+'.door',(x0+x1)/2,side*(w+.015),base+.1,side,h=min(1.65,top-base-.18))
for side in [-1,1]:
 # Knees under the wheelhouse wings, from the lower bridge wall to the wing floor.
 for x in [25.85,26.95]:
  y,n=wall_point('bridge-lower',x,side);rod('bridge.wing-knee',(x,y-side*.02,9.1),(x,side*(structure_width('wheelhouse',x)-.1),10.04),.07,materials['naval'])
 ladder('bridge.after-ladder',(21.95,side*.55,5.42),(21.95,side*.55,12.75),.42)
 # Running lights on the forward wheelhouse facets.
 y,n=wall_point('wheelhouse',27.8,side)
 box('bridge.navigation-light',(27.8,y+side*.1,10.45),(.5,.2,.32),materials['edge'])
 # Signal lamp platforms beside the compass house.
 prism('bridge.signal-platform',[(24.2,side*1.19),(25.5,side*1.19),(25.5,side*2.6),(24.2,side*2.6)],13.0,13.08)
 for x in [24.35,25.4]:rod('bridge.signal-bracket',(x,side*1.19,12.78),(x,side*2.45,13.0),.035,materials['naval'])
 cyl('bridge.signal-lamp',(24.45,side*1.9,13.39),.2,.62,materials['naval'],vertices=16)
 rod('bridge.signal-lens',(24.65,side*1.9,13.5),(24.67,side*1.9,13.5),.15,materials['glass'],vertices=16)
# Supported open AA platforms.
def platform(name,outline,z,supports,shield=True):
 prism(name+'.deck',outline,z-.14,z)
 for x,y,base in supports:
  cyl(name+'.column',(x,y,(base+z-.14)/2),.21,z-.14-base,materials['naval'],vertices=20)
  for side in [-1,1]:rod(name+'.knee',(x,y, z-.95),(x,y+side*.75,z-.12),.055,materials['naval'])
 if shield:bulwark(name,outline,z,.73,thick=.055)
 else:rails(name+'.rails',[(x,y,z) for x,y in outline],.85,closed=True)
platform('bridge-aa',[(29.3,-1.95),(32.7,-1.95),(33.3,-1.35),(33.3,1.35),(32.7,1.95),(29.3,1.95)],8.331,[(30.9,0,deckz(30.9))])
platform('mid-aa',outline_rect(-21.116,-17.041,-3.978,3.978,.5),6.861,[(-19.1,-2.6,3.39),(-19.1,2.6,3.39)])
platform('13mm-aa',outline_rect(1.4,4.2,-2.25,2.25,.3),8.139,[(2.7,-1.2,3.43),(2.7,1.2,3.43)],False)
bulwark('aft-aa-upper',outline_rect(-33.5,-29,-1.93,1.13,.3),6.1575,.69)
bulwark('aft-aa-lower',outline_rect(-37.15,-33.6,-1.93,1.13,.3),5.538,.67)
for name,x,z in [('bridge-aa',31,8.33),('13mm-aa',2.7,8.139)]:ladder(name+'.access',(x-1,-1.45,deckz(x)),(x-1,-1.45,z),.5)
# Midships access is at the port rim, outside the gun and torpedo envelopes.
for dx in [-.25,.25]:rod('mid-aa.access-rail',(-19.1+dx,3.92,3.4),(-19.1+dx,3.92,7.50),.026,materials['edge'])
for i in range(13):rod('mid-aa.access-rung',(-19.35,3.92,3.4+i*.288),(-18.85,3.92,3.4+i*.288),.023,materials['naval'])
# Funnel jackets from the measured rings: bands, black cap band, open mouths, cap grating and steam pipes.
for s in [s for s in definition['structures'] if 'funnel' in s['id']]:
 name=s['id'];surface=s['surface'];vs=[(-z,-x,y) for x,y,z in surface['vertices']];N=40;R=len(vs)//N
 obj=mesh(name+'.jacket',vs,surface['triangles'],materials['naval'],smooth=True)
 obj.data.materials.append(materials['dark'])
 for face in obj.data.polygons:
  if min(face.vertices)>=(R-2)*N:face.material_index=1
 mod=obj.modifiers.new('Uptake jacket thickness','SOLIDIFY');mod.thickness=.05
 for k in range(1,R-1):tube_path(name+'.seam',vs[k*N:(k+1)*N],.023,materials['edge'],sides=8,closed=True)
 rim=[Vector(p) for p in vs[-N:]];center=sum(rim,Vector())/N
 band=[Vector(p) for p in vs[-2*N:-N]]
 # Cap: a slightly proud black band with a rolled lip at the rim.
 tube_path(name+'.cap-lip',[center+(p-center)*1.015 for p in rim],.04,materials['dark'],sides=8,closed=True)
 tube_path(name+'.cap-foot',band,.03,materials['dark'],sides=8,closed=True)
 throat=[center+(p-center)*.93-Vector((0,0,.55)) for p in rim]
 mesh(name+'.dark-throat',throat,[tuple(range(N))],materials['dark'])
 # Domed grating over the mouth: radial and ring bars.
 up=(center-sum(band,Vector())/N).normalized()
 apex=center+up*.35
 dome=lambda p,f:p.lerp(apex,f)+up*(.2*math.sin(f*math.pi/2))
 for k in range(0,N,5):tube_path(name+'.grating',[dome(rim[k],j/6) for j in range(7)],.018,materials['dark'],sides=5)
 for f in [.35,.7]:tube_path(name+'.grating-ring',[dome(p,f) for p in rim],.016,materials['dark'],sides=5,closed=True)
 # Steam pipes up the after quarters, clear of the jacket, on brackets.
 for k in [13,27]:
  bottom=Vector(vs[N+k]);top=Vector(vs[-N+k]);ofs=(Vector((top.x,top.y,0))-Vector((center.x,center.y,0))).normalized()*.16
  tube_path(name+'.steam-pipe',[bottom+ofs,top+ofs+Vector((0,0,.45))],.07,materials['naval'],sides=12)
  for t in [.2,.5,.8]:rod(name+'.pipe-bracket',bottom.lerp(top,t),bottom.lerp(top,t)+ofs,.025,materials['edge'])
 # Climbing rungs up the starboard side.
 bottom=Vector(vs[N+10]);top=Vector(vs[-2*N+10])
 ofs=(Vector((bottom.x,bottom.y,0))-Vector((center.x,center.y,0))).normalized();along=Vector((ofs.y,-ofs.x,0))
 for j in range(int((top-bottom).length/.4)):
  p=bottom.lerp(top,j*.4/(top-bottom).length)
  tube_path(name+'.rung',[p-along*.2-ofs*.02,p-along*.2+ofs*.13,p+along*.2+ofs*.13,p+along*.2-ofs*.02],.016,materials['edge'])
# Paired broad aft-side intake trunks with curved elbows and open forward mouths.
# Their feet meet the main deck beside each funnel jacket.
for name,x,cy,z,rad in [('fore-cowl',12.7,2.58,3.48,.55),('aft-cowl',2.15,1.65,5.04,.48),('search-cowl',-6.35,0,3.41,.56)]:
 for sign in ([-1,1] if cy else [1]):
  y=sign*cy;rise=4.20 if name=='fore-cowl' else 2.60
  pts=[(x,y,z),(x,y,z+rise-1.1)]
  pts += [(x-1.1+1.1*math.cos(a),y,z+rise-1.1+1.1*math.sin(a)) for a in [i*math.pi/2/16 for i in range(1,17)]]
  tube_path(name+'.intake',pts,rad,materials['naval'],sides=32)
  rod(name+'.mouth',pts[-1],(x-1.16,y,z+rise),rad*.90,materials['dark'],vertices=32)
  for dz in [.35,1.55]:
   tube_path(name+'.seam',[(x+rad*math.cos(a),y+rad*math.sin(a),z+dz) for a in [i*math.tau/32 for i in range(32)]],.022,materials['edge'],closed=True)
  for dz in [.55,1.0,1.45,1.9]:
   tube_path(name+'.rung',[(x+.55,y-rad*.7,z+dz),(x+.85,y-rad*.7,z+dz),(x+.85,y+rad*.7,z+dz),(x+.55,y+rad*.7,z+dz)],.022,materials['naval'])
# Narrow bilge keels blend into the lower shell, with tapered ends.
for sign in [-1,1]:
 vs=[]
 for x,spread in [(-25,0),(-23,.58),(9,.58),(12,0)]:
  z=-1.8;y=sign*(shell_width(x,z)-.025)
  vs += [(x,y,z),(x,y+sign*spread,z-.34)]
 ob=mesh('hull.bilge-keel',vs,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(3)],materials['underwater'])
 mod=ob.modifiers.new('Bilge keel plate','SOLIDIFY');mod.thickness=.045
# Gun installations: the shared builder owns mechanisms; the ship owns the seating.
helpers=dict(mesh=mesh,cyl=cyl,rod=rod,box=box)
for m in definition['mounts']:
 if m['battery']=='main':
  x=-m['position'][2];base=deckz(x)+.045;top=m['position'][1]
  cyl(m['id']+'.deck-seat',(x,0,(base+top)/2),1.67,max(.02,top-base),materials['naval'],vertices=48)
 create_mount(m,col,helpers,materials)
# Triple torpedo launchers with split tube bodies, hatches and independently yawing sockets.
exec(compile((Path(__file__).parent/'fittings.py').read_text(),'fubuki-fittings','exec'),globals())
# Original UV-painted hull; no source textures are incorporated.
wtex,htex=1024,256;pixels=array('f')
for j in range(htex):
 z=-3.3+j/(htex-1)*10
 for i in range(wtex):
  x=-half+i/(wtex-1)*h['length'];grain=(math.sin(i*12.99+j*78.233)*43758.5453)%1
  base=(.14,.09,.049) if z<-.2 else (.22,.25,.27)
  tide=.024*math.exp(-abs(z+.1)*4);streak=max(0,math.sin(x*3.9))**20*.022
  seam=.93 if i%29==0 or j%18==0 else 1
  pixels.extend([max(.005,c*seam+tide+(grain-.5)*.014-streak) for c in base]+[1])
paint=bpy.data.images.new('Fubuki original hull paint',width=wtex,height=htex,alpha=False);paint.colorspace_settings.name='Non-Color';paint.pixels.foreach_set(pixels);paint.pack()
mat=materials['hullgray'];node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=paint;node.extension='EXTEND';mat.node_tree.links.new(node.outputs['Color'],mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
bpy.context.view_layer.update()
for o in col.objects:
 if o.type!='MESH':continue
 if materials['hullgray'] in list(o.data.materials):
  uv=o.data.uv_layers.new(name='OriginalPaintUV')
  for p in o.data.polygons:
   for li in p.loop_indices:
    v=o.matrix_world@o.data.vertices[o.data.loops[li].vertex_index].co;uv.data[li].uv=((v.x+half)/h['length'],(v.z+3.3)/10)
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free()
scene['definitionHash']=definition['contentHash'];scene['authoringRevision']=1
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'appearance'))
from surface import apply_appearance
apply_appearance(scene,materials,Path(__file__).with_name('appearance.json'))
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
print('FUBUKI ORIGINAL',len(col.objects),'objects',flush=True)
