"""Original Yamato exterior reconstruction. All geometry is authored here, in metres.

Bow +X, port +Y, up +Z, trial waterline Z=0. The blueprint owns dimensions and
weapon placement. Reference configuration and remaining limits are in README.md.
No reference mesh or texture is imported. Run through `bun run ship:build yamato`.
"""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from yamato_kit import *
import yamato_citadel, yamato_tower, yamato_funnel, yamato_deck

# Hull and CPU hits share every original station, including the recurve.
hull=authored_hull(H,mesh,HULL,[hullgray,red])

# Main batteries retain all barrel pivots, recoil joints and sockets.
for mount in D['mounts']:
 if mount['partId']=='type89-127-yamato-twin':continue
 if mount['partId']=='type94-460-triple':
  # The reusable gun owns only its shallow bearing. This historical
  # installation supplies the fixed support up to its Y=2.15 m attachment.
  create_shared_mount(mount,GUNS,dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials)
  px,pz,py=mount['position'];x,y=-py,-px;bottom=deck(x);top=pz+2.15
  if top-bottom>.015:
   support=cyl(mount['id']+'.fixed-barbette-foundation',(x,y,(bottom+top)/2),mount['weapon']['barbetteRadius'],top-bottom,hullgray,GUNS,64)
   support['assemblyId']=mount['id']
  # Legacy gun_details creates rigid mantlets and duplicate service fittings.
  # Only secondary batteries continue through that original legacy path.
  continue
 create_gun_mount(mount,GUNS,dict(mesh=mesh,cyl=cyl,rod=rod,box=box),materials,deck)
 gun_finish=Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),dict(**materials,glass=glass),GUNS)
 gun_finish.gun_details(mount)

# Regions build in dependency order: supports sample what earlier regions made.
yamato_citadel.base()
yamato_tower.build()
yamato_funnel.build()
yamato_citadel.build()
yamato_deck.build()

# Original one-metre gilded bow chrysanthemum. Kure's 2026 museum renewal
# report corrects the former 1.5 m estimate using the 2016 wreck survey.
# Petal relief and the local bow bulwark are interpretations of retained photos;
# no photo pixels or external mesh enter this construction.
crestcol=group('10 Bow chrysanthemum')
gold=mat('Chrysanthemum gold leaf',(.83,.52,.105),.78,.34)
goldshadow=mat('Chrysanthemum recessed gold',(.36,.205,.037),.65,.42)
crest_x=L/2+.055;crest_z=deck(L/2)+.77
# A solid curved bulwark, seated through the existing forecastle deck, supports
# the ornament. Its return wings follow the authored sheer rather than floating
# a disc in front of the pointed stem.
outline=[]
for side,offsets in [(-1,[3.2,2.7,2.1,1.5,1.0,.6,.3,.12,0]),(1,[.12,.3,.6,1.0,1.5,2.1,2.7,3.2])]:
 for offset in offsets:
  x=L/2-offset;y=side*max(0,breadth(x)-.045)
  height=1.18+.32*math.exp(-offset*1.7)-.15*math.sin(offset*2)
  outline.append((x,y,deck(x)-.065,height))
v=[]
for x,y,z,h in outline:
 v.extend([(x,y,z),(x,y,z+h),(x-.075,y*.992,z),(x-.075,y*.992,z+h)])
fs=[]
for i in range(len(outline)-1):
 a=i*4;b=a+4
 fs.extend([(a,b,b+1,a+1),(a+2,a+3,b+3,b+2),(a+1,b+1,b+3,a+3),(a,a+2,b+2,b)])
fs.extend([(0,1,3,2),tuple((len(outline)-1)*4+j for j in [0,2,3,1])])
support=mesh('Crest bow bulwark',v,fs,hullgray,crestcol)
support['assemblyId']='bow-crest-support'
for a,b in zip(outline,outline[1:]):
 rim=rod('Bow bulwark rolled lip',(a[0],a[1],a[2]+a[3]),(b[0],b[1],b[2]+b[3]),.037,edge,crestcol,vertices=8)
 rim['assemblyId']='bow-crest-support'
back=rod('Chrysanthemum seated backing',(crest_x-.23,0,crest_z),(crest_x+.025,0,crest_z),.455,goldshadow,crestcol,vertices=64)
back['assemblyId']='bow-crest'

def crest_petal(name,angle,depth,finish,radial_center,radial_radius,tangent_radius):
 # Closed rounded relief, with a domed face and a flat back joined to the boss.
 n=32;vs=[]
 for scale,raised in [(1,0),(1,.018),(.70,depth*.78)]:
  for i in range(n):
   t=math.tau*i/n;r=radial_center+radial_radius*math.cos(t)*scale;w=tangent_radius*math.sin(t)*scale
   vs.append((crest_x+raised,r*math.sin(angle)+w*math.cos(angle),crest_z+r*math.cos(angle)-w*math.sin(angle)))
 vs.append((crest_x+depth,radial_center*math.sin(angle),crest_z+radial_center*math.cos(angle)))
 faces=[tuple(reversed(range(n)))]
 for j in range(2):
  for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
 faces.extend((2*n+i,2*n+(i+1)%n,3*n) for i in range(n))
 ob=mesh(name,vs,[tuple(reversed(face)) for face in faces],finish,crestcol,True);ob['assemblyId']='bow-crest'
 return ob
for i in range(16):
 crest_petal('Chrysanthemum rear petal %02d'%i,(i+.5)*math.tau/16,.055,goldshadow,.315,.18,.067)
 crest_petal('Chrysanthemum front petal %02d'%i,i*math.tau/16,.13,gold,.29,.21,.079)
hub=rod('Chrysanthemum central boss',(crest_x-.01,0,crest_z),(crest_x+.155,0,crest_z),.082,gold,crestcol,vertices=48,r2=.074)
hub['assemblyId']='bow-crest'
scene['definitionHash']=D['contentHash'];scene['configuration']=D['configuration']
scene['historicalAccuracy']='GameModels3D pjsb018 geometry comparison; not historical certification'
from blender_rig import create_flagstaffs
create_flagstaffs(D)
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'appearance'))
from surface import apply_appearance
apply_appearance(scene,dict(materials,teak=teak,underwater=red),Path(__file__).with_name('appearance.json'))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))
print('Authored Yamato:',len(scene.objects),'objects',flush=True)
