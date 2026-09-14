"""Original low Type 96 twin/triple carriage for the approved Kongō fit.
The dimensions are independent interpretations; no source geometry is consumed.
"""
import bpy,math
from blender_barrels import barrel_layout

def create_mount(m,col,helpers,mats):
 mesh,cyl,rod,box=(helpers[k] for k in ['mesh','cyl','rod','box'])
 sp=m['weapon'];name=m['id'];gray,dark,steel=(mats[k] for k in ['naval','dark','edge'])
 def empty(suffix,parent=None,loc=(0,0,0)):
  o=bpy.data.objects.new(name+'.'+suffix,None);col.objects.link(o);o['nodeId']=o.name;o['assemblyId']=name;o.parent=parent;o.location=loc;return o
 def own(o,p):o.parent=p;o['assemblyId']=name;return o
 def cube(label,loc,size,p,mat=gray):return own(box(name+'.'+label,loc,size,mat,col),p)
 def bar(label,a,b,r,p,mat=steel,n=10,r2=None):return own(rod(name+'.'+label,a,b,r,mat,col,r2,n),p)
 def drum(label,loc,r,h,p,mat=gray,n=24):return own(cyl(name+'.'+label,loc,r,h,mat,col,n),p)
 def ring(label,center,r,p,axis='y',tube=.012):
  x,y,z=center
  def pt(a):return (x+r*math.cos(a),y,z+r*math.sin(a)) if axis=='y' else (x,y+r*math.cos(a),z+r*math.sin(a))
  for i in range(12):bar(label,pt(i*math.tau/12),pt((i+1)*math.tau/12),tube,p,n=5)
  for a in [0,math.pi/2,math.pi,3*math.pi/2]:bar(label+'-spoke',center,pt(a),tube*.65,p,n=5)
 a,z,c=m['position'];base=empty('base',loc=(-c,-a,z));yaw=empty('yaw',base)
 yaw.rotation_euler.z=-math.radians(m['bearingDeg'])
 drum('seat',(0,0,.04),sp['barbetteRadius'],.08,base,steel,32)
 drum('rotating-ring',(0,0,.12),sp['barbetteRadius']*.87,.12,yaw,gray,32)
 for i in range(12):
  a=i*math.tau/12;r=sp['barbetteRadius']*.91
  drum('bolt',(r*math.cos(a),r*math.sin(a),.091),.023,.027,base,steel,6)
 H=sp['pivotHeight'];T=sp['trunnionForward'];half=.57 if sp['barrelCount']==2 else .73
 cube('cross-bed',(T,0,.19),(.65,half*2,.13),yaw)
 intervals=[(-half,half)]
 for _,lateral,_ in barrel_layout(sp):
  intervals=[v for a,b in intervals for v in [(a,min(b,lateral-.10)),(max(a,lateral+.10),b)] if v[1]>v[0]]
 for a,b in intervals:bar('trunnion-shaft',(T,a,H),(T,b,H),.065,yaw,n=16)
 for sign in [-1,1]:
  yy=sign*half
  cube('cheek',(T,yy,H*.6),(.46,.14,H*.85),yaw)
  bar('bearing',(T,yy-.1,H),(T,yy+.1,H),.11,yaw,n=16)
  # Open lower fork preserves the breech's downward sweep.
  bar('fork',(T-.25,yy,.18),(T,yy,H-.16),.06,yaw,gray)
  sy=sign*(half+.18)
  bar('seat-arm',(T-.15,yy,.22),(-.60,sy,.22),.037,yaw)
  bar('seat-post',(-.60,sy,.22),(-.60,sy,.61),.038,yaw)
  cube('seat',(-.60,sy,.62),(.36,.32,.06),yaw,steel)
  cube('back',(-.77,sy,.74),(.05,.32,.24),yaw,steel)
  cube('footrest',(-.16,sy,.20),(.34,.27,.06),yaw)
  cube('gearbox',(T-.2,yy,.42),(.26,.22,.25),yaw)
  bar('wheel-shaft',(T-.2,yy,.48),(T-.2,sy,.48),.033,yaw)
  ring('handwheel',(T-.2,sy,.48),.17,yaw)
 for side,y,_ in barrel_layout(sp):
  elev=empty(side+'.elevation',yaw,(T,y,H));elev.rotation_euler.y=-math.radians(1)
  rec=empty(side+'.recoil',elev);L=sp['muzzleForward']-T
  bar('bearing-seat',(0,-.10,0),(0,.10,0),.075,elev,n=16)
  empty(side+'.muzzle',rec,(L,0,0))
  cube('cradle',(-.14,0,-.085),(.78,.18,.12),elev)
  cube('receiver',(-.31,0,0),(.68,.16,.18),rec,steel)
  cube('breech-cover',(-.60,0,.025),(.12,.19,.21),rec)
  bar('charging-handle',(-.45,-.08,.04),(-.45,-.21,.04),.017,rec)
  cube('magazine-well',(-.24,0,.135),(.25,.19,.09),rec)
  cube('magazine',(-.24,0,.34),(.25,.16,.34),rec,steel)
  cube('magazine-cap',(-.24,0,.53),(.28,.18,.04),rec)
  bar('barrel',(0,0,0),(L,0,0),.036,rec,n=16,r2=.024)
  for j in range(10):bar('cooling-fin',(.12+j*.042,0,0),(.136+j*.042,0,0),.043,rec,gray,n=12)
  bar('gas-cylinder',(-.1,0,-.09),(.68,0,-.09),.028,elev,gray,n=12)
  bar('flash-hider',(L-.1,0,0),(L,0,0),.027,rec,n=16,r2=.049)
  bar('bore',(L-.002,0,0),(L+.003,0,0),.0125,rec,dark,n=12)
  bar('sight-upright',(-.1,.12,.0),(-.1,.12,.28),.014,elev,gray)
  ring('ring-sight',(.05,.12,.28),.075,elev,axis='x',tube=.007)
 return yaw
