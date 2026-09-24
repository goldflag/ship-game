"""Main, secondary and AA mounts on their shared joint and socket contract, with their foundations."""
from bismarck_kit import *
def batteries():
 # All ten active batteries retain the shared original joint and socket contract.
 for mount in DEF['mounts']:
  if mount['partId']=='sk-c34-380-twin':create_library_mount(mount,gunscol,dict(helpers,deck_height=deckz),materials)
  elif mount['weapon']['caliberM']>.13:create_gun_mount(mount,gunscol,helpers,materials,deckz)
 # Secondary gunhouse fabrication follows its existing yaw rig.
 for mount in DEF['mounts']:
  if mount['weapon']['caliberM']<=.13 or mount['partId']=='sk-c34-380-twin':continue
  yaw=bpy.data.objects[mount['id']+'.yaw'];w=mount['weapon'];L,W,T=w['gunhouseSize']
  def mounted(ob):ob.parent=yaw;ob.matrix_parent_inverse=Matrix.Identity(4);ob['assemblyId']=mount['id'];return ob
  # The secondary's rear roof ridge, sloping roof and near-vertical walls are
  # catalog facets. These small original fittings are carried by the same yaw.
  mounted(box('Secondary rear access hatch',(-3.92,0,1.12),(.07,.78,1.18),materials['edge'],gunscol))
  mounted(box('Secondary rear hatch inset',(-3.97,0,1.12),(.035,.63,1.02),materials['naval'],gunscol))
  for yy in [-1.25,-.73]:mounted(rod('Secondary rear ladder rail',(-3.94,yy,.3),(-3.86,yy,2.20),.025,materials['edge'],gunscol,vertices=6))
  for zz in [.42+i*.26 for i in range(7)]:mounted(rod('Secondary rear ladder rung',(-3.94+.08*(zz-.3)/1.9, -1.25,zz),(-3.94+.08*(zz-.3)/1.9,-.73,zz),.022,materials['edge'],gunscol,vertices=6))
  for sign in [-1,1]:
   mounted(box('Secondary covered sight',(-.25,sign*2.32,1.52),(.63,.12,.32),materials['naval'],gunscol))
   mounted(box('Secondary sight glass',(.075,sign*2.32,1.52),(.026,.085,.14),materials['dark'],gunscol))
   for xx in [-2.7,-.6,1.2]:
    yy=sign*(2.15+(xx+3.9)*.4/5.9)
    mounted(box('Secondary drain',(xx,yy,.39),(.22,.05,.065),materials['dark'],gunscol))
  for a,b in zip([(-3.82,0,2.20),(-1.2,0,2.62),(1.95,0,2.10)], [(-1.2,0,2.62),(1.95,0,2.10),(2.55,0,1.87)]):mounted(rod('Secondary roof seam',a,b,.018,materials['edge'],gunscol,vertices=5))
  mounted(cyl('Secondary observation periscope',(-1.18,0,2.76),.095,.34,materials['naval'],gunscol,16))
  mounted(box('Secondary periscope head',(-1.12,0,2.94),(.26,.23,.15),materials['edge'],gunscol))
  for side in ['left','right']:
   parent=bpy.data.objects[mount['id']+'.'+side+'.recoil']
   for old in list(parent.children):
    if 'canvas mantlet' in old.name:bpy.data.objects.remove(old,do_unlink=True)
   vs=[];n=24;rings=[(-.38,.35),(-.16,.39),(.12,.34),(.48,.29),(.85,.235),(1.10,.208)]
   for xx,rr in rings:
    for i in range(n):
     a=math.tau*i/n;wrinkle=1+.055*math.cos(a*7+xx*10);vs.append((xx,rr*math.cos(a)*wrinkle,rr*.94*math.sin(a)*wrinkle))
   boot=mesh('Secondary pleated blast bag',vs,[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(rings)-1) for i in range(n)],materials['canvas'],gunscol,True)
   boot.parent=parent;boot.matrix_parent_inverse=Matrix.Identity(4);boot['assemblyId']=mount['id']
# Existing original AA geometry now uses the same blueprint joints as other guns.
# The two upper quad fittings retain their original decorative geometry.
aa_support=None
def aa_mount(name,x,y,z,caliber,bearing=0,quad=False,mount=None):
 # Foundations use the authored deck edges. Outboard sponsons span back to a
 # wall with knees; a light gun is never left floating beside a narrowed house.
 # A region that builds this mount's own tub or pedestal lists it in own_foundations.
 # Seats stop 5 mm under the lowest rotating part (the 3.7 cm mounting sole hangs 0.10 m
 # below its pivot), so a training mount never sweeps through its own foundation.
 seat=z-(.105 if mount and mount['partId']=='flak-37-bismarck-1941' else .005)
 if mount is not None and mount['id'] in own_foundations:pass
 elif z>deckz(x)+.8:
  candidates=[]
  for s in DEF['structures']:
   pts=[(-zz,-xx) for xx,zz in s['footprint']];top=s['baseY']+s['height']
   if top<=z+.07 and top>z-4 and min(v[0] for v in pts)<x<max(v[0] for v in pts):
    wall,_=house_side(pts,x,1 if y>0 else -1);candidates.append((z-top+max(0,abs(y)-abs(wall))*.12,top,wall))
  if candidates:
   _,top,wall=min(candidates);r=.95 if caliber>.025 or quad else .65
   if seat-top>.005:cyl(name+' supported foundation',(x,y,(top+seat)/2),r,seat-top,materials['roof'],detailcol,24)
   if abs(y)+r>abs(wall):
    sign=1 if y>0 else -1;outer=y+sign*r;inner=wall-sign*.35
    box(name+' sponson deck',(x,(inner+outer)/2,seat-.11),(2*r,abs(outer-inner),.22),materials['roof'],detailcol)
    for dx in [-r*.64,r*.64]:rod(name+' sponson knee',(x+dx,outer-sign*.08,seat-.19),(x+dx,wall-sign*.2,top-1.05),.065,materials['naval'],detailcol,vertices=8)
 else:
  floor=aa_support.below(x,y,z)
  if seat-floor>.005:cyl(name+' deck seating',(x,y,(floor+seat)/2),1.50 if caliber>.08 else .76 if caliber>.025 else .42,seat-floor,materials['naval'],detailcol,24)
 if mount and mount['partId']=='flak-37-bismarck-1941':
  create_library_mount(mount,detailcol,helpers,materials)
  return
 before=set(bpy.data.objects);heavy=caliber>.08;medium=caliber>.025
 radius=1.50 if heavy else .76 if medium or quad else .42
 cyl(name+' deck ring',(0,0,.10),radius,.2,materials['edge'],detailcol,28)
 cyl(name+' pedestal',(0,0,.25 if heavy else .53),radius*.48,.30 if heavy else .86,materials['naval'],detailcol,20)
 axisz=1.63 if heavy else 1.30;length=4.70 if heavy else 2.22 if medium else 1.45
 # Cast saddle, bearing axle and barrel slide make a continuous carriage.
 fork_y=.80 if heavy else .45;fork_z=.43 if heavy else .65
 rod(name+' carriage crosshead',(0,-fork_y,.43 if heavy else .76),(0,fork_y,.43 if heavy else .76),.07 if heavy else .13,materials['naval'],detailcol,vertices=12)
 if heavy:
  # Outboard bearing stubs leave the twin receivers an open lowering well.
  for sign in [-1,1]:rod(name+' trunnion axle',(.12,sign*.60,axisz),(.12,sign*.82,axisz),.12,materials['edge'],detailcol,vertices=12)
 else:rod(name+' trunnion axle',(.12,-.52,axisz),(.12,.52,axisz),.12,materials['edge'],detailcol,vertices=12)
 if heavy:
  # Open-backed sloped shield, rather than a solid rectangular box.
  cross=[(-1.25,.58),(1.28,.58),(1.17,1.95),(.63,2.44),(-1.12,2.44)]
  vs=[(xx,yy,zz) for yy in [-1.47,1.47] for xx,zz in cross]
  mesh(name+' side shield',vs,[(0,1,2,3,4),(5,9,8,7,6)],materials['naval'],detailcol)
  # Two continuous gun slots cross the front, brow and overhead plate. The
  # barrels pass through all three planes as the carriage elevates to 80 deg.
  for low,high in [(-1.47,-.70),(-.12,.12),(.70,1.47)]:
   for a,b in zip(cross[1:4],cross[2:5]):
    mesh(name+' slotted shield plate',[(a[0],low,a[1]),(a[0],high,a[1]),(b[0],high,b[1]),(b[0],low,b[1])],[(0,1,2,3)],materials['naval'],detailcol)
  sill_x=1.28-(.70-.58)*.11/(1.95-.58)
  mesh(name+' shield lower sill',[(1.28,-1.47,.58),(1.28,1.47,.58),(sill_x,1.47,.70),(sill_x,-1.47,.70)],[(0,1,2,3)],materials['naval'],detailcol)
  for yy in [-1.05,1.05]:box(name+' loading deck',(-.3,yy,.515),(2.3,.84,.13),materials['roof'],detailcol)
 count=4 if quad else 2 if heavy or medium else 1
 barrel_groups=[]
 for i in range(count):
  barrel_before=set(bpy.data.objects)
  yy=(i%2-.5)*(.80 if heavy else .55) if count>1 else 0;zz=axisz+(i//2)*.34
  elev=math.radians(1) if mount else .18 if heavy else .40 if quad else .28;start=Vector((.12,yy,zz));direction=Vector((math.cos(elev),0,math.sin(elev)))
  rod(name+' receiver',start-direction*.8,start+direction*.5,.21 if heavy else .10,materials['naval'],detailcol,vertices=12)
  rod(name+' tapered barrel',start+direction*.3,start+direction*length,caliber*.78,materials['edge'],detailcol,caliber*.46,12)
  rod(name+' muzzle opening',start+direction*(length+.002),start+direction*(length+.035),caliber*.35,materials['dark'],detailcol,vertices=12)
  rod(name+' recoil cylinder',start+Vector((0,0,-.24)),start+direction*1.05+Vector((0,0,-.24)),.105 if heavy else .048,materials['naval'],detailcol,vertices=10)
  for a in (0,.65):rod(name+' recoil slide collar',start+direction*a,start+direction*a+Vector((0,0,-.24)),.09 if heavy else .055,materials['naval'],detailcol,vertices=10)
  if not heavy:box(name+' feed magazine',tuple(start+Vector((-.22,0,.14))),(.32,.24,.25),materials['dark'],detailcol)
  barrel_groups.append((yy,zz,elev,set(bpy.data.objects)-barrel_before))
 for sign in [-1,1]:
  rod(name+' trunnion',(0,sign*fork_y,fork_z),(0,sign*fork_y,axisz),.14 if heavy else .075,materials['naval'],detailcol,vertices=10)
  rod(name+' bearing cheek',(0,sign*fork_y,axisz),(.12,sign*fork_y,axisz),.14 if heavy else .08,materials['naval'],detailcol,vertices=10)
  cyl(name+' crew seat',(-.65,sign*(1.04 if heavy else .55),.72),.23,.11,materials['roof'],detailcol,16)
  rod(name+' seat support',(-.65,sign*(1.04 if heavy else .55),.2),(-.65,sign*(1.04 if heavy else .55),.68),.05,materials['edge'],detailcol,vertices=6)
  rod(name+' seat outrigger',(0,0,.40),(-.65,sign*(1.04 if heavy else .55),.40),.06,materials['naval'],detailcol,vertices=8)
  ring(name+' handwheel',(-.34,sign*(.83 if heavy else .45),1.14),(0,1,0),.22 if heavy else .13,.025,n=14)
  rod(name+' handwheel shaft',(0,sign*fork_y,1.14),(-.34,sign*(.83 if heavy else .45),1.14),.035,materials['edge'],detailcol,vertices=8)
  for a in range(3):rod(name+' handwheel spoke',(-.34,sign*(.83 if heavy else .45),1.14),(-.34+(.22 if heavy else .13)*math.cos(a*math.tau/3),sign*(.83 if heavy else .45),1.14+(.22 if heavy else .13)*math.sin(a*math.tau/3)),.018,materials['edge'],detailcol,vertices=6)
 rod(name+' sight bracket',(0,0,.43 if heavy else .65),(-.35,0,axisz+.5),.035,materials['edge'],detailcol,vertices=6)
 ring(name+' ring sight',(-.35,0,axisz+.54),(1,0,0),.11,.015,n=12)
 # Assemble in the local mount frame, then place the complete hierarchy.
 pieces=set(bpy.data.objects)-before
 # Snapshot once: refreshing the whole ship for each parent change is quadratic.
 bpy.context.view_layer.update()
 piece_matrices={ob:ob.matrix_world.copy() for ob in pieces}
 def joint(suffix,loc=(0,0,0),rotation=(0,0,0)):
  ob=bpy.data.objects.new(mount['id']+'.'+suffix,None);detailcol.objects.link(ob)
  ob.location=loc;ob.rotation_euler=rotation;ob['nodeId']=ob.name;ob['assemblyId']=mount['id'];return ob
 def attach(ob,parent,frame=Matrix.Identity(4)):
  ob.parent=parent;ob.matrix_parent_inverse=Matrix.Identity(4)
  ob.matrix_basis=frame.inverted()@piece_matrices[ob]
 if mount:
  pivot=joint('yaw')
  sides=['center'] if count==1 else ['left','right']
  # Authoring +Y is runtime -X, so the higher Y barrel is the left axis.
  for side,(yy,zz,elev,barrels) in zip(sides,sorted(barrel_groups,reverse=True,key=lambda v:v[0])):
   pitch=joint(side+'.elevation',(.12,yy,zz),(0,-elev,0));pitch.parent=pivot
   pitch_frame=Matrix.Translation((.12,yy,zz))@Matrix.Rotation(-elev,4,'Y')
   recoil=joint(side+'.recoil');recoil.parent=pitch
   muzzle=joint(side+'.muzzle',(length,0,0));muzzle.parent=recoil
   for ob in barrels:attach(ob,recoil,pitch_frame)
  for ob in pieces:
   ob['assemblyId']=mount['id']
   if ob.parent is None:attach(ob,pivot)
 else:
  pivot=bpy.data.objects.new(name+' visual mount',None);detailcol.objects.link(pivot)
  for ob in pieces:ob.parent=pivot;ob.matrix_parent_inverse=Matrix.Identity(4)
 pivot.location=(x,y,z);pivot.rotation_euler.z=bearing
def aa_mounts():
 global aa_support
 aa_support=SupportSurface([*hullcol.objects,*supercol.objects])
 for mount in DEF['mounts']:
  if mount['weapon']['caliberM']<=.13:
   a,b,c=mount['position'];aa_mount(mount['name'],-c,-a,b,mount['weapon']['caliberM'],bearing=-math.radians(mount['bearingDeg']),mount=mount)
