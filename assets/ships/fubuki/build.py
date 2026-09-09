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
width=lambda x:interp(h['halfBreadths'],x+half)
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
for station,w in h['halfBreadths']:
 x=station-half;z=deckz(x)+.01;vs += [(x,-w,z),(x,0,z+.005),(x,w,z)]
mesh('deck.main',vs,[(i*3+j,i*3+j+1,(i+1)*3+j+1,(i+1)*3+j) for i in range(len(h['halfBreadths'])-1) for j in range(2)],materials['deck'])
for lo,hi in [(20.35,49.2),(-48.5,-28),(4.5,17.7),(-9.7,1.5)]:
 xs=[lo]+[s-half for s,w in h['halfBreadths'] if lo<s-half<hi]+[hi]
 vs=[(x,sign*max(.01,width(x)-.26),deckz(x)+.018) for x in xs for sign in [-1,1]]
 mesh('deck.linoleum',vs,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(len(xs)-1)],materials['linoleum'])
 for x in [lo+i*1.85 for i in range(int((hi-lo)/1.85)+1)]:rod('deck.retaining-strip',(x,-width(x)+.26,deckz(x)+.027),(x,width(x)-.26,deckz(x)+.027),.012,materials['bronze'],vertices=5)
# Lifelines and hull-side apertures, with the foregun sweep lowered.
for sign in [-1,1]:
 pts=[(s-half,sign*max(.02,w-.08),deckz(s-half)+.065) for s,w in h['halfBreadths'] if .6<s<h['length']-.6]
 # Lifelines fold down across the foregun training sweep, as in the reference.
 for a,b in zip(pts,pts[1:]):
  low=any(36<p[0]<48 for p in [a,b])
  rails('rails.perimeter',[a,b],.13 if low else .85,spacing=2.0)
 tube_path('hull.deck-edge',pts,.034,materials['edge'],sides=6)
 for x in list(range(23,53,3))+list(range(-53,-38,3)):
  portlight('hull.portlight',(x,sign*shell_width(x,deckz(x)-.68),deckz(x)-.68),(0,sign,0),.105)
 for x in range(25,51,4):portlight('hull.lower-portlight',(x,sign*shell_width(x,2.5),2.5),(0,sign,0),.105)
# Definition-owned superstructure, tapered and rounded at its recognisable forward face.
for s in definition['structures']:
 if 'funnel' in s['id']:continue
 outline=[(-z,-x) for x,z in s['footprint']];base=s['baseY'];top=base+s['height']
 obj=prism(s['id']+'.walls',outline,base,top)
 tube_path(s['id']+'.roof-edge',[(x,y,top+.025) for x,y in outline],.04,materials['edge'],closed=True)
 if s['id'] in ['wheelhouse','bridge-upper']:
  # Window panes follow each actual wall segment, with visible mullions and sill.
  for a,b in zip(outline,outline[1:]+outline[:1]):
   va,vb=Vector(a),Vector(b);length=(vb-va).length;steps=max(1,round(length/.53));normal=Vector(((vb-va).y,-(vb-va).x)).normalized()
   for j in range(steps):
    aa=va.lerp(vb,(j+.08)/steps)+normal*.016;bb=va.lerp(vb,(j+.92)/steps)+normal*.016
    mesh(s['id']+'.window',[(aa.x,aa.y,top-.87),(bb.x,bb.y,top-.87),(bb.x,bb.y,top-.16),(aa.x,aa.y,top-.16)],[(0,1,2,3)],materials['glass'])
    rod(s['id']+'.mullion',(aa.x,aa.y,top-.9),(aa.x,aa.y,top-.12),.024,materials['naval'],vertices=6)
   tube_path(s['id']+'.sill',[(va.x,va.y,top-.92),(vb.x,vb.y,top-.92)],.04,materials['naval'])
 elif s['id']=='bridge-lower':
  for side in [-1,1]:
   for x in [24,26.1,28]:
    for z in [6.2,8.0]:
     w=2.1 if x<=27.3 else 2.1*math.sqrt(max(0,1-((x-27.3)/2.05)**2))
     normal=Vector((max(0,x-27.3)/2.05**2,side*w/2.1**2,0)).normalized()
     portlight('bridge.portlight',(x,side*w,z),normal,.16)
 else:
  x0=min(x for x,y in outline);x1=max(x for x,y in outline);w=max(abs(y) for x,y in outline)
  for side in [-1,1]:
   if top-base>1.3:door(s['id']+'.door',(x0+x1)/2,side*(w+.015),base+.1,side,h=min(1.65,top-base-.18))
# Bridge overhang knees follow the actual curved walls at both ends.
def structure_width(id,x):
 outline=[(-z,-a) for a,z in next(s for s in definition['structures'] if s['id']==id)['footprint']]
 return max(abs(y0+(y1-y0)*(x-x0)/(x1-x0)) for (x0,y0),(x1,y1) in zip(outline,outline[1:]+outline[:1]) if min(x0,x1)<=x<=max(x0,x1) and abs(x1-x0)>1e-8)

for side in [-1,1]:
 for x in [24.8,27.2,28.6]:rod('bridge.wing-knee',(x,side*(structure_width('bridge-lower',x)-.025),8.6),(x,side*(structure_width('wheelhouse',x)-.025),10.03),.075,materials['naval'])
 ladder('bridge.after-ladder',(22.4,side*1.55,5.6),(22.4,side*1.55,12.7),.42)
 # Running lights attached to wheelhouse wings.
 box('bridge.navigation-light',(27.8,side*3.16,10.35),(.22,.17,.3),materials['edge'])
# Supported open AA platforms.
def platform(name,outline,z,supports,shield=True):
 prism(name+'.deck',outline,z-.14,z)
 for x,y,base in supports:
  cyl(name+'.column',(x,y,(base+z-.14)/2),.21,z-.14-base,materials['naval'],vertices=20)
  for side in [-1,1]:rod(name+'.knee',(x,y, z-.95),(x,y+side*.75,z-.12),.055,materials['naval'])
 if shield:bulwark(name,outline,z,.73,thick=.055)
 else:rails(name+'.rails',[(x,y,z) for x,y in outline],.85,closed=True)
platform('bridge-aa',[(29.4,-1.7),(32.0,-1.7),(32.8,-.9),(32.8,.9),(32,1.7),(29.4,1.7)],8.331,[(31,0,deckz(31))])
platform('mid-aa',outline_rect(-21.116,-17.041,-3.978,3.978,.5),6.861,[(-19.1,-2.6,3.39),(-19.1,2.6,3.39)])
platform('13mm-aa',outline_rect(1.4,4.2,-2.25,2.25,.3),8.139,[(2.7,-1.2,3.43),(2.7,1.2,3.43)],False)
bulwark('aft-aa-upper',outline_rect(-33.5,-29,-1.93,1.13,.3),6.1575,.69)
bulwark('aft-aa-lower',outline_rect(-37.15,-33.6,-1.93,1.13,.3),5.538,.67)
for name,x,z in [('bridge-aa',31,8.33),('13mm-aa',2.7,8.139)]:ladder(name+'.access',(x-1,-1.45,deckz(x)),(x-1,-1.45,z),.5)
# Midships access is at the port rim, outside the gun and torpedo envelopes.
for dx in [-.25,.25]:rod('mid-aa.access-rail',(-19.1+dx,3.92,3.4),(-19.1+dx,3.92,7.50),.026,materials['edge'])
for i in range(13):rod('mid-aa.access-rung',(-19.35,3.92,3.4+i*.288),(-18.85,3.92,3.4+i*.288),.023,materials['naval'])
# Funnel jackets, bands, sloping open mouths, caps and external steam pipes.
for s in [s for s in definition['structures'] if 'funnel' in s['id']]:
 name=s['id'];surface=s['surface'];vs=[(-z,-x,y) for x,y,z in surface['vertices']];N=40
 obj=mesh(name+'.jacket',vs,surface['triangles'],materials['naval'],smooth=True)
 obj.data.materials.append(materials['dark'])
 for face in obj.data.polygons:
  if min(vs[i][2] for i in face.vertices)>s['baseY']+s['height']-2:face.material_index=1
 mod=obj.modifiers.new('Uptake jacket thickness','SOLIDIFY');mod.thickness=.05
 for k in [1,2,3]:tube_path(name+'.seam',vs[k*N:(k+1)*N],.023,materials['edge'],sides=8,closed=True)
 rim=[Vector(p) for p in vs[-N:]];center=sum(rim,Vector())/N
 throat=[center+(p-center)*.92-Vector((0,0,.68)) for p in rim]
 mesh(name+'.dark-throat',throat,[tuple(range(N))],materials['dark'])
 for offset in [-.65,0,.65]:
  # Arched cap ribs sit on the actual rim at both ends.
  a=rim[int((.25+offset*.12)*N)%N];b=rim[int((.75-offset*.12)*N)%N]
  tube_path(name+'.cap-rib',[a.lerp(b,j/16)+Vector((0,0,.25*math.sin(j*math.pi/16))) for j in range(17)],.022,materials['edge'])
 for k in [0,20]:
  bottom=Vector(vs[k]);top=Vector(vs[-N+k]);delta=(top-center).normalized()*.11
  pipe=[bottom+delta,top+delta+Vector((0,0,.4))]
  tube_path(name+'.steam-pipe',pipe,.075,materials['naval'],sides=12)
  for t in [.2,.55,.85]:rod(name+'.pipe-bracket',bottom.lerp(top,t),bottom.lerp(top,t)+delta,.027,materials['edge'])
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
