"""AA citadel: central shelter deck, 12.7 cm towers and tubs, every 25 mm mount with its drum or tub."""
from yamato_kit import *
import bmesh

# Shelter deck top measured on pjsb018; the outer 12.7 cm towers finish flush with it.
SHELTER=11.46


def base():
 # Blueprint outlines: tower plinth forward, one lobe per outer 12.7 cm tower,
 # and a lower after step under the aft director and the closed 25 mm drums.
 structure('central-shelter');structure('after-shelter')


def frame(x,y,z,deg):
 c,s=math.cos(math.radians(deg)),math.sin(math.radians(deg))
 return lambda a,b,h:(x+a*c-b*s,y+a*s+b*c,z+h)
LOCAL=frame(0,0,0,0)

def smooth(o,angle=35):
 o.data.shade_smooth();o.data.set_sharp_from_angle(angle=math.radians(angle));return o

def outward(o):
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();return o

def obox(name,P,a,b,h,da,db,dh,material,col):
 v=[P(a+i*da/2,b+j*db/2,h+k*dh/2) for k in (-1,1) for j,i in ((-1,-1),(-1,1),(1,1),(1,-1))]
 return mesh(name,v,[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],material,col)

def lathe(name,prof,x,y,material,col,n=24,cap=True):
 # Surface of revolution from (radius, z) pairs, bottom to top; the last ring is capped.
 v=[(x+r*math.cos(i*math.tau/n),y+r*math.sin(i*math.tau/n),z) for r,z in prof for i in range(n)]
 f=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(prof)-1) for i in range(n)]
 if cap:f.append(tuple(range(len(v)-n,len(v))))
 return smooth(mesh(name,v,f,material,col))

def hood(name,P,rings,material,col):
 # Closed loft through plan outlines (CCW in the mount frame); h may vary per vertex.
 n=len(rings[0][0]);v=[]
 for pts,h in rings:v.extend(P(a,b,h[i] if isinstance(h,list) else h) for i,(a,b) in enumerate(pts))
 f=[tuple(reversed(range(n)))]+[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(rings)-1) for i in range(n)]+[tuple(range(len(v)-n,len(v)))]
 return mesh(name,v,f,material,col)

def rib(name,P,b,ca,ch,ra,rh,material,col,t=.24,k=5,d=.3):
 # Curved slot divider: a quarter-ellipse bar from the front sill over the roof.
 v=[]
 for i in range(k+1):
  u=math.pi/2*i/k
  for e in (0,d):
   for s in (-t/2,t/2):v.append(P(ca+(ra-e)*math.cos(u),b+s,ch+(rh-e)*math.sin(u)))
 f=[(0,1,3,2),(4*k,4*k+2,4*k+3,4*k+1)]
 for i in range(k):
  o=4*i;q=o+4;f+=[(o,q,q+1,o+1),(o+2,o+3,q+3,q+2),(o,o+2,q+2,q),(o+1,q+1,q+3,o+3)]
 return outward(mesh(name,v,f,material,col))

def torus(name,c,R,r,axis,material,col,n=24,m=4):
 # One mesh for a rail ring or a life buoy; axis is the ring normal.
 v=[]
 for i in range(n):
  t=i*math.tau/n
  for j in range(m):
   p=j*math.tau/m+math.pi/m;rr=R+r*math.cos(p);w=r*math.sin(p)
   u,vv=rr*math.cos(t),rr*math.sin(t)
   v.append((c[0]+u,c[1]+vv,c[2]+w) if axis=='z' else (c[0]+u,c[1]+w,c[2]+vv) if axis=='y' else (c[0]+w,c[1]+u,c[2]+vv))
 f=[(i*m+j,i*m+(j+1)%m,((i+1)%n)*m+(j+1)%m,((i+1)%n)*m+j) for i in range(n) for j in range(m)]
 return outward(mesh(name,v,f,material,col))

def posts(name,pts,z0,z1,material,col,w=.05):
 # Square stanchions merged into one mesh.
 v=[];f=[]
 for x,y in pts:
  o=len(v);v+=[(x+i*w/2,y+j*w/2,z) for z in (z0,z1) for i,j in ((-1,-1),(1,-1),(1,1),(-1,1))]
  f+=[(o+i,o+(i+1)%4,o+4+(i+1)%4,o+4+i) for i in range(4)]
 return mesh(name,v,f,material,col)


def closed25(id,P,late=False):
 # Type 96 triple in its closed splinter housing: round back, flat face and a
 # deep three-gun slot that runs back over the roof.
 R,af,w,an=1.8,1.25,1.1,-.35
 def plan(R,af,an):
  tf=math.acos(af/R)
  return [(an,w),(af,w)]+[(R*math.cos(t),R*math.sin(t)) for t in (tf+(math.tau-2*tf)*i/10 for i in range(11))]+[(af,-w),(an,-w)]
 top=.4 if late else .3
 hood(id+' splinter housing',P,[(plan(R,af,an),-.28),(plan(R,af,an),1.0),(plan(R-.1,1.15,an-.15),1.32),(plan(R-top,1.2-top,an-.35),1.52)],naval,AA)
 obox(id+' slot apron',P,(af+an)/2,0,.1,af-an,2*w,.76,naval,AA)
 obox(id+' triple cradle',P,an+.3,0,.78,.62,2*w-.12,.46,edge,AA)
 for b in (-w/3,w/3):rib(id+' slot divider',P,b,an-.3,.48,af-an+.3,1.04,naval,AA)
 for b in (-.74,0,.74):rod(id+' 25 mm barrel',P(an+.2,b,.86),P(af+.5,b,1.02),.062,edge,AA,r2=.045,vertices=8)

def light25(id,P):
 # Open Type 96 triple: pedestal, cradle, three barrels with top magazines, layer seats.
 x,y,z=P(0,0,0);cyl(id+' pedestal',(x,y,z+.42),.3,.84,naval,AA,10)
 obox(id+' cradle',P,0,0,1.02,.95,.9,.36,naval,AA)
 for b in (-.55,.55):obox(id+' side frame',P,-.05,b,.95,1.0,.07,.7,naval,AA)
 for b in (-.25,0,.25):
  rod(id+' 25 mm barrel',P(-.35,b,1.08),P(1.8,b,1.46),.052,edge,AA,r2=.04,vertices=8)
  obox(id+' magazine',P,.05,b,1.34,.32,.1,.26,naval,AA)
 for b in (-.78,.78):
  obox(id+' layer seat',P,-.55,b,.62,.34,.3,.07,naval,AA)
  obox(id+' seat post',P,-.55,b,.3,.06,.06,.6,edge,AA)
 rod(id+' sight bar',P(.35,-.7,1.35),P(.35,.7,1.35),.025,edge,AA,vertices=6)

def single25(id,P):
 x,y,z=P(0,0,0)
 lathe(id+' pedestal',[(.4,z),(.4,z+.06),(.2,z+.12),(.12,z+.82),(.17,z+.9)],x,y,naval,AA,10)
 obox(id+' cradle',P,0,0,1.0,.55,.22,.26,naval,AA)
 rod(id+' 25 mm barrel',P(-.45,0,1.0),P(1.45,0,1.34),.05,edge,AA,r2=.04,vertices=8)
 obox(id+' magazine',P,.05,0,1.24,.32,.09,.26,naval,AA)
 obox(id+' shoulder rest',P,-.55,-.22,.98,.12,.3,.22,edge,AA)


def build():
 aa_support=SupportSurface([*HULL.objects,*SUPER.objects,*FUNNEL.objects,*GUNS.objects])
 # Twelve Type 89 twins at the reference hardpoints. Outer mod A mounts are
 # hooded on round towers flush with the shelter deck; the inner open mounts
 # stand in walled tubs on cones or columns.
 def aa127(mount,shield):
  id=mount['id'];w=mount['weapon'];px,pz,py=mount['position'];x,y,z=-py,-px,pz
  before=set(scene.objects)
  if shield:
   deck=SHELTER-z
   cyl(id+' turntable',(0,0,deck+.1),3.0,.2,roof,AA,32)
   base=[(1.45,-2.2),(1.45,2.2),(.6,2.95),(-.9,3.0),(-1.9,2.35),(-2.9,1.4),(-3.35,.8),(-3.35,-.8),(-2.9,-1.4),(-1.9,-2.35),(-.9,-3.0),(.6,-2.95)]
   top=[(1.4,-1.7),(1.4,1.7),(.5,2.05),(-.9,2.1),(-1.8,1.5),(-2.5,.8),(-2.75,.45),(-2.75,-.45),(-2.5,-.8),(-1.8,-1.5),(-.9,-2.1),(.5,-2.05)]
   roofh=[3.35,3.35,3.8,3.9,3.45,2.95,2.75,2.75,2.95,3.45,3.9,3.8]
   # A convex middle ring rounds the hood between its low walls and the roof.
   mid=[(a+(c-a)*.4,b+(d-b)*.4) for (a,b),(c,d) in zip(base,top)]
   hood(id+' rounded blast shield',LOCAL,[(base,deck+.2),(base,deck+.95),(mid,[deck+.95+(h-deck-.95)*.75 for h in roofh]),(top,roofh)],naval,AA)
   obox(id+' gun slot',LOCAL,1.46,0,(deck+.5+3.3)/2,.04,1.9,3.3-deck-.5,dark,AA)
   for b in (-.95,0,.95):
    pts=[(1.47,3.3),(.6,3.78),(-.4,3.96),(-1.2,3.93)]
    for (a0,h0),(a1,h1) in zip(pts,pts[1:]):rod(id+' slot band',(a0,b,h0),(a1,b,h1),.07,edge,AA,vertices=6)
   # Guard rail round the open front of the turntable; it trains with the hood.
   arc=[(2.9*math.cos(math.radians(t)),2.9*math.sin(math.radians(t))) for t in range(-72,73,24)]
   for p,q in zip(arc,arc[1:]):rod(id+' turntable rail',(*p,deck+1.15),(*q,deck+1.15),.03,edge,AA,vertices=6)
   posts(id+' turntable stanchion',arc[::2],deck+.2,deck+1.15,edge,AA)
  else:
   floor=.14
   cyl(id+' pedestal',(0,0,floor+.55),.55,1.1,naval,AA,12)
   cyl(id+' base ring',(0,0,floor+.15),1.0,.3,roof,AA,16)
   obox(id+' carriage',LOCAL,0,0,1.55+floor,1.8,2.0,.6,naval,AA)
   rod(id+' trunnion axle',(w['trunnionForward'],-1.3,w['pivotHeight']),(w['trunnionForward'],1.3,w['pivotHeight']),.21,edge,AA,vertices=12)
   plate=[(-1.1,1.2),(1.0,1.2),(1.0,2.5),(.5,3.0),(-.4,3.15),(-1.1,2.7)]
   for b in (-1.3,1.3):
    v=[(a,b+s,h) for s in (-.06,.06) for a,h in plate];n=len(plate)
    outward(mesh(id+' trunnion shield',v,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],naval,AA))
   obox(id+' fuze setter',LOCAL,-.7,1.95,floor+.75,1.0,.7,1.3,naval,AA)
  frame=set(scene.objects)-before;barrels=[]
  direction=Vector((math.cos(math.radians(1)),0,math.sin(math.radians(1))))
  for b in (w['barrelSpacing']/2,-w['barrelSpacing']/2):
   start=Vector((w['trunnionForward'],b,w['pivotHeight']));tip=start+direction*(w['muzzleForward']-w['trunnionForward'])
   group=[rod(id+' 127 mm barrel',start,tip,.13,edge,AA,r2=.1,vertices=12)]
   if not shield:group.append(rod(id+' breech',start-direction*1.4,start+direction*.2,.26,naval,AA,vertices=10))
   barrels.append(group)
  articulate_aa(mount,AA,frame,barrels)
  # Fixed supports stay outside the gun hierarchy.
  if shield:
   # The tower rim stands 4 cm proud of the shelter deck it merges with.
   floor=aa_support.below(x,y,SHELTER-1);top=SHELTER+.04
   tower=cyl('Raised HA sponson',(x,y,(floor+top)/2),3.33,top-floor,naval,SUPER,32)
   tower['assemblyId']=id
  else:
   floor=z+.14;foot=aa_support.below(x,y,floor-.3);R=3.08;h=floor-foot
   prof=[(.45,foot),(.85,floor-1.0)] if h>1.5 else [(.9,foot),(.9,floor-.9)] if h>.9 else [(1.65,foot)]
   tub=lathe('Open HA mount tub',prof+[(R,floor-.06),(R+.05,floor+1.45),(R-.01,floor+1.45),(R-.01,floor)],x,y,naval,AA,32)
   tub['assemblyId']=id
 for mount in D['mounts']:
  if mount['partId']=='type89-127-yamato-twin':aa127(mount,int(mount['id'].rsplit('-',1)[1])<=3)

 # Every 25 mm mount of the 1945 fit at the pjsb018 hardpoints (port values,
 # mirrored). Closed mounts ride drums; open mounts stand in tubs.
 support=SupportSurface([*HULL.objects,*SUPER.objects,*FUNNEL.objects,*AA.objects,*GUNS.objects])
 closed=[('bridge',1.13,10.58,10.12,2.05,False),('bridge',-1.05,14.86,9.61,2.05,True),
  ('edge',-4.26,18.51,9.17,1.92,False),('edge',-10.02,18.55,9.17,1.92,True),('edge',-15.77,18.59,9.17,1.92,True),
  ('edge',-21.52,18.61,9.17,1.92,True),('edge',-27.27,18.6,9.17,1.92,False),
  ('after',-32.14,14.66,9.7,2.04,False),('after',-34.51,11.29,10.74,2.06,False),('after',-36.34,7.64,11.72,2.07,False),
  ('quarter',-96.39,16.4,9.44,1.88,False),('quarter',-101.01,15.3,9.44,1.88,False)]
 light=[(19.69,10.03,8.34,90),(11.48,8.22,8.55,90),(6.36,8.94,8.53,90),(3.3,5.0,13.86,90),(-.13,7.72,13.21,90),
  (-33.59,4.45,18.13,90),(-41.22,10.78,8.53,90),(-42.11,2.22,18.29,180),(-47.06,9.8,8.53,90),
  (-73.04,11.57,8.39,90),(-78.15,6.91,8.39,90),(-128.92,2.51,8.28,180)]
 single=[(35.44,9.87,7.54,45),(32.64,11.47,7.71,45),(-126.41,4.88,6.0,135)]
 def owned(id,make):
  before=set(scene.objects);make()
  for ob in set(scene.objects)-before:ob['assemblyId']=id
 for side in (1,-1):
  tag='port' if side==1 else 'starboard'
  counts={}
  for kind,x,y,z,r,late in closed:
   y*=side;counts[kind]=counts.get(kind,0)+1;id=f'aa-{kind}-{tag}-{counts[kind]}'
   def make(x=x,y=y,z=z,r=r,late=late,id=id):
    floor=support.below(x,y,z-.02)
    # Drums overhanging the hull side finish in a conical skirt, as on pjsb018.
    lathe('25 mm mount drum',[(.85,floor-1.0),(.95,floor-.6),(r,floor-.08),(r,z-.06),(r+.05,z-.06),(r+.05,z)],x,y,naval,AA,20)
    closed25(id,frame(x,y,z,side*90),late)
   owned(id,make)
  for i,(x,y,z,deg) in enumerate(light):
   y*=side;id=f'aa-open-{tag}-{i+1}'
   def make(x=x,y=y,z=z,deg=deg,id=id):
    floor=support.below(x,y,z+.3)
    if z-floor<.3:
     z=floor;o=[(x+1.8*math.cos(math.pi/8+k*math.pi/4),y+1.8*math.sin(math.pi/8+k*math.pi/4)) for k in range(8)]
     perimeter_band(id+' splinter tub',o,z,.88,naval,AA,.06)
    else:
     # Raised tubs: conical underside on a column to the structure below.
     stem=.5 if x<-120 else .3
     prof=[(stem,floor),(stem,z-1.2),(2.0,z-.05)] if z-floor>1.3 else [(1.0,floor),(2.0,z-.05)]
     lathe(id+' raised tub',prof+[(2.03,z+.9),(1.97,z+.9),(1.97,z)],x,y,naval,AA,20)
    light25(id,frame(x,y,z,side*deg if deg!=180 else 180))
   owned(id,make)
  for i,(x,y,z,deg) in enumerate(single):
   y*=side;id=f'aa-single-{tag}-{i+1}'
   owned(id,lambda x=x,y=y,deg=deg,id=id:single25(id,frame(x,y,support.below(x,y,8.5 if x>0 else 6.6),side*deg)))

 # Shelter-deck doors and vents on the flat faces between the tower lobes;
 # life buoys hang on the deck-edge rail beside the end drums.
 fit=Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),fm,SUPER)
 for side in [-1,1]:
  fit.door('Shelter access',-10.4,side*12.1,8.515)
  fit.vent('Shelter ventilation',-12.5,side*12.1,9.9,1.6,1.1)
  fit.vent('Shelter ventilation',-21.1,side*15.1,9.9,2.2,1.1)
  fit.door('Shelter access',-1.3,side*7.1,8.515)
  for x,y in [(3.3,18.7),(-32.93,18.9)]:
   torus('Life buoy',(x,side*y,9.12),.33,.075,'y',edge,AA,16,6)
   box('Life buoy bracket',(x,side*(y-.06),8.8),(.08,.05,.62),edge,AA)
