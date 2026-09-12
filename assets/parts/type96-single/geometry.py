"""Original single Type 96, extracted from the Yukikaze authoring recipe."""
import bpy,math
from mathutils import Matrix,Vector

def create_mount(m,col,helpers,materials):
 mesh,cyl,rod,box=(helpers[k] for k in ['mesh','cyl','rod','box'])
 # Bind the recipe primitives to this component collection.
 raw=(mesh,cyl,rod,box)
 mesh=lambda name,vs,fs,mat,smooth=False:raw[0](name,vs,fs,mat,col,smooth)
 cyl=lambda name,loc,radius,depth,mat,vertices=24,r2=None:raw[1](name,loc,radius,depth,mat,col,vertices,r2)
 rod=lambda name,a,b,r,mat,r2=None,vertices=10:raw[2](name,a,b,r,mat,col,r2,vertices)
 box=lambda name,loc,dim,mat,bev=.035:raw[3](name,loc,dim,mat,col,bev)
 def empty(name,loc):
  o=bpy.data.objects.new(name,None);col.objects.link(o);o.location=loc;o['nodeId']=name;return o
 def local(o,parent,assembly):
  o.parent=parent;o.matrix_parent_inverse=Matrix.Identity(4);o['assemblyId']=assembly;return o
 def tube_path(name,points,r,mat,sides=8,closed=False):
  pts=[Vector(p) for p in points];vs=[];n=len(pts)
  for i,p in enumerate(pts):
   delta=pts[(i+1)%n]-pts[(i-1)%n] if closed else pts[min(i+1,n-1)]-pts[max(i-1,0)]
   q=delta.to_track_quat('Z','Y')
   vs += [p+q@Vector((r*math.cos(j*math.tau/sides),r*math.sin(j*math.tau/sides),0)) for j in range(sides)]
  fs=[]
  for i in range(n if closed else n-1):
   k=(i+1)%n;fs += [(i*sides+j,i*sides+(j+1)%sides,k*sides+(j+1)%sides,k*sides+j) for j in range(sides)]
  if not closed:fs += [tuple(reversed(range(sides))),tuple((n-1)*sides+j for j in range(sides))]
  return mesh(name,vs,fs,mat,True)
 name=m['id'];sp=m['weapon'];a,z,c=m['position'];base=empty(name+'.base',(-c,-a,z));yaw=empty(name+'.yaw',(0,0,0));yaw.parent=base;yaw.rotation_euler.z=-math.radians(m['bearingDeg'])
 def lc(o,p=yaw):return local(o,p,name)
 lc(cyl(name+'.foundation',(0,0,.07),sp['barbetteRadius'],.14,materials['edge'],vertices=32),base)
 # Source single mount: low pedestal and an open fork raked aft of its axis.
 trunnion=sp['trunnionForward'];pivot=sp['pivotHeight']
 kongo=sp['id']=='type96-25-kongo-single'
 # Distinct low fork and compact magazine in the approved Kongō model.
 fork_side=.137 if kongo else .17
 bearing_end=.172 if kongo else .24
 bearing_radius=.047 if kongo else .10
 lc(cyl(name+'.pedestal',(0,0,.48 if kongo else .45),.16,.70 if kongo else .64,materials['naval'],vertices=24,r2=.105))
 lc(box(name+'.saddle',(0,0,.80),(.19,.344,.08) if kongo else (.34,.40,.12),materials['naval']))
 for side in [-1,1]:
  profile=([(.094,.833),(-.10,.833),(trunnion-.047,pivot),
            (trunnion,pivot+.047),(trunnion+.047,pivot)] if kongo else
           [(.14,.77),(-.10,.77),(trunnion-.12,pivot-.06),(trunnion,pivot+.08),(trunnion+.13,pivot-.06)])
  vs=[(xx,side*fork_side+dy,zz) for dy in [-.035,.035] for xx,zz in profile];nn=len(profile)
  lc(mesh(name+'.open-fork',vs,[tuple(reversed(range(nn))),tuple(range(nn,2*nn))]+[(i,(i+1)%nn,(i+1)%nn+nn,i+nn) for i in range(nn)],materials['naval']))
  lc(rod(name+'.bearing',(trunnion,side*.10,pivot),(trunnion,side*bearing_end,pivot),bearing_radius,materials['edge'],vertices=20))
 lc(rod(name+'.trunnion-axle',(trunnion,-(.16 if kongo else .23),pivot),(trunnion,.16 if kongo else .23,pivot),.022 if kongo else .045,materials['edge']))
 for angle in [0,120,240]:
  theta=math.radians(angle);foot_radius=sp['barbetteRadius']*.29/.35
  vs=[(.12*math.cos(theta),.12*math.sin(theta),.16),(foot_radius*math.cos(theta),foot_radius*math.sin(theta),.16),(.10*math.cos(theta),.10*math.sin(theta),.42)]
  gusset=mesh(name+'.foot-gusset',vs,[(0,1,2)],materials['naval']);mod=gusset.modifiers.new('Gusset thickness','SOLIDIFY');mod.thickness=.022;lc(gusset,base)
 elev=empty(name+'.center.elevation',(trunnion,0,pivot));elev.parent=yaw;elev.rotation_euler.y=-math.radians(1)
 rec=empty(name+'.center.recoil',(0,0,0));rec.parent=elev
 muzzle=empty(name+'.center.muzzle',(sp['muzzleForward']-trunnion,0,0));muzzle.parent=rec
 lc(box(name+'.receiver',(-.32,0,0),(.72,.15,.18),materials['edge']),rec)
 lc(box(name+'.cradle',(-.13,0,-.10),(.74,.18,.10),materials['naval']),elev)
 lc(box(name+'.magazine-socket',(-.28,0,.13),(.28,.20,.10),materials['naval']),rec)
 lc(box(name+'.box-magazine',(-.28,0,.2965 if kongo else .37),(.27,.17,.253 if kongo else .40),materials['edge']),rec)
 lc(box(name+'.magazine-cap',(-.28,0,.434 if kongo else .58),(.30,.19,.022 if kongo else .04),materials['naval']),rec)
 lc(rod(name+'.gas-cylinder',(-.1,0,-.10),(.70,0,-.10),.032,materials['naval']),elev)
 length=sp['muzzleForward']-trunnion
 lc(rod(name+'.barrel',(0,0,0),(length,0,0),.041,materials['edge'],r2=.025,vertices=20),rec)
 for j in range(12):
  o=rod(name+'.cooling-ring',(.14+j*.04,0,0),(.155+j*.04,0,0),.047,materials['naval'],vertices=16);lc(o,rec)
 lc(rod(name+'.flash-hider',(length-.12,0,0),(length,0,0),.03,materials['edge'],r2=.055,vertices=20),rec)
 lc(rod(name+'.bore',(length-.002,0,0),(length+.002,0,0),.0125,materials['dark'],vertices=20),rec)
 for s in [-1,1]:
  lc(tube_path(name+'.shoulder-rest',[(-.45,s*.08,-.05),(-.64,s*.27,-.1),(-.67,s*.27,.08)],.018,materials['edge']),elev)
  lc(rod(name+'.charging-handle',(-.44,s*.08,.03),(-.48,s*.18,.07),.014,materials['naval']),rec)
 lc(rod(name+'.sight-bracket',(-.1,0,-.05),(-.1,.17,.31),.018,materials['naval']),elev)
 lc(tube_path(name+'.ring-sight',[(.13,.17+.10*math.cos(j*math.tau/24),.31+.10*math.sin(j*math.tau/24)) for j in range(24)],.009,materials['edge'],closed=True),elev)
 lc(rod(name+'.sight-rail',(-.35,.17,.31),(.13,.17,.31),.012,materials['edge']),elev)
 return yaw
