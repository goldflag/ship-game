"""AA citadel: central shelter deck, galleries, 12.7 cm and 25 mm mounts, HA directors."""
from yamato_kit import *


def base():
 rounded('Central shelter deck',-19,0,8.515,55,21.5,2.285,naval,SUPER)


def build():
 # Heavy AA uses blueprint joints; 25 mm fittings retain visual assembly ownership.
 # Counts, detailed positions and performance remain under review.
 def blast_shield(name,x,y,z,length,width,height,bearing):
  # Rounded blast hoods, as photographed on the museum model. The roof curves
  # in the firing direction; the basic geometry is not a conical gun tub.
  ang=math.radians(bearing)
  profile=[(-.5,0),(.5,0),(.5,.34),(.47,.61),(.37,.83),(.19,.97),(-.06,1),(-.35,.97),(-.5,.84)]
  v=[]
  for side in (-1,1):
   for a,h in profile:
    b=side*width/2;v.append((x+a*length*math.cos(ang)-b*math.sin(ang),y+a*length*math.sin(ang)+b*math.cos(ang),z+h*height))
  n=len(profile);fs=[tuple(reversed(range(n))),tuple(range(n,n*2))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
  return mesh(name,v,fs,naval,AA)

 def aa25(id,x,y,z,shield=True,bearing=90):
  before=set(scene.objects);ang=math.radians(bearing)
  def pt(a,b,h):return (x+a*math.cos(ang)-b*math.sin(ang),y+a*math.sin(ang)+b*math.cos(ang),z+h)
  cyl(id+' base',(x,y,z+.18),1.42,.36,roof,AA,20)
  if shield:
   blast_shield(id+' rounded shield',x,y,z+.25,2.65,2.5,1.95,bearing)
   for b in (-.24,0,.24):
    for a,aa,h,hh in [(.18,.66,1.96,1.83),(.66,1.08,1.83,1.48),(1.08,1.23,1.48,1.02)]:
     rod(id+' gun slot',pt(a,b,h+.25),pt(aa,b,hh+.25),.07,dark,AA,vertices=8)
  else:
   cyl(id+' pedestal',(x,y,z+.63),.26,.95,naval,AA,12)
   rounded(id+' seat',x-.45*math.cos(ang),y-.45*math.sin(ang),z+.45,1.3,1.6,.28,naval,AA)
   # Triple cradle joins the three breeches to the pedestal. Each barrel used
   # to be an isolated pair of rods above the top of the stand.
   rod(id+' trunnion axle',pt(0,-.42,1.30),pt(0,.42,1.30),.14,edge,AA,vertices=12)
   for b in [-.38,.38]:rod(id+' carriage cheek',pt(0,b,.70),pt(0,b,1.30),.11,naval,AA,vertices=10)
   rod(id+' carriage crosshead',pt(0,-.38,.78),pt(0,.38,.78),.12,naval,AA,vertices=10)
  for b in (-.24,0,.24):
   rod(id+' breech',pt(-.25,b,1.3),pt(.55,b,1.48),.14,naval,AA,vertices=8)
   rod(id+' 25 mm barrel',pt(.45,b,1.45),pt(2.05,b,1.86),.055,edge,AA,r2=.038,vertices=8)
  for ob in set(scene.objects)-before:ob['assemblyId']=id

 def aa127(mount,shield):
  id=mount['id'];w=mount['weapon'];px,pz,py=mount['position'];x,y,z=-py,-px,pz
  platform=cyl(id+' platform',(x,y,z+.2),2.35,.4,roof,AA,32);platform['assemblyId']=id
  before=set(scene.objects)
  cyl(id+' pivot',(0,0,.65),.85,.9,naval,AA,24)
  if shield:
   blast_shield(id+' rounded blast shield',0,0,.35,4.5,4.1,2.65,0)
  else:
   rod(id+' saddle',(0,-1.3,.9),(0,1.3,.9),.22,naval,AA,vertices=12)
   rod(id+' trunnion axle',(w['trunnionForward'],-1.3,w['pivotHeight']),(w['trunnionForward'],1.3,w['pivotHeight']),.21,edge,AA,vertices=12)
   for b in (-1.3,1.3):
    box(id+' trunnion shield',(.15,b,1.4),(1.8,.12,2.1),naval,AA)
  frame=set(scene.objects)-before;barrels=[]
  direction=Vector((math.cos(math.radians(1)),0,math.sin(math.radians(1))))
  for b in (w['barrelSpacing']/2,-w['barrelSpacing']/2):
   start=Vector((w['trunnionForward'],b,w['pivotHeight']));tip=start+direction*(w['muzzleForward']-w['trunnionForward'])
   barrels.append([
    rod(id+' breech',start-direction*1.55,start+direction*.2,.28,naval,AA,vertices=12),
    rod(id+' 127 mm barrel',start,tip,.17,edge,AA,r2=.1,vertices=12),
   ])
  articulate_aa(mount,AA,frame,barrels)
 # Build the galleries before sampling foundations; a gun must not raycast its
 # own platform as the support beneath it.
 for side in (-1,1):
  structure(f'aa-gallery-{side}',AA)
 aa_support=SupportSurface([*HULL.objects,*SUPER.objects,*AA.objects,*GUNS.objects])
 def aa_foundation(name,x,y,top,radius):
  floor=aa_support.below(x,y,top)
  if top-floor>.015:
   return cyl(name,(x,y,(floor+top)/2),radius,top-floor+.02,naval,AA,24)
 for mount in D['mounts']:
  if mount['partId']=='type89-127-yamato-twin':
   # Lower mounts have blast hoods; upper mounts retain their repaired supports.
   shield=int(mount['id'].rsplit('-',1)[1])<=3
   px,pz,py=mount['position']
   if shield:
    cyl('Raised HA sponson',(-py,-px,pz-2.55),3.05,5.1,naval,SUPER,28)
   else:
    foundation=aa_foundation('Open HA mount raised foundation',-py,-px,pz,2.35)
    if foundation:foundation['assemblyId']=mount['id']
   aa127(mount,shield)
 for side in (-1,1):
  # Dense outer rows and the curved ends of the AA citadel.
  for i,(xx,yy,zz) in enumerate([(-7.8,18,9),(-13.4,18.5,9),(-19,18.5,9),(-24.6,18.5,9),(-30.2,18.5,9),(-35.5,15.8,10),(-39,12.3,11),(-41,8.5,11.4),(0,14.8,10),(.4,10.5,11.4),(-.3,6.9,12.1),(-37.7,5.5,13.3)]):
   aa_foundation('25 mm gallery base',xx,side*yy,zz,1.6)
   aa25(f'aa-citadel-{side}-{i+1}',xx,side*yy,zz,True,side*90)
  for i,(xx,yy) in enumerate([(-50,10.7),(-45,13.0),(-40,14.2),(18,11.0),(26,12.0),(36,10.6),(-72,10.5)]):
   aa_foundation('Deck 25 mm foundation',xx,side*yy,deck(xx)+.12,1.40)
   aa25(f'aa-deck-{side}-{i+1}',xx,side*yy,deck(xx)+.12,False,side*90)
  for i,xx in enumerate((-105,-98)):
   rounded('Quarterdeck AA sponson',xx,side*12.5,5.7,5.5,7.0,.90,naval,AFT)
   aa25(f'aa-quarter-{side}-{i+1}',xx,side*14.4,6.6,True,side*90)
  aa25(f'aa-stern-{side}',-127,side*3.4,5.8,False,180)
  for i,xx in enumerate((-33,-17)):
   aa_foundation('Upper 25 mm foundation',xx,side*4.2,18.3,1.4)
   aa25(f'aa-upper-{side}-{i+1}',xx,side*4.2,18.3,False,side*90)
  for m in D['mounts'][1:3]:
   # Roof mounts move with the main gunhouse, independently of the barrels.
   mx=-m['position'][2];rear=math.cos(math.radians(m['bearingDeg']));before=set(scene.objects)
   aa_foundation('Turret roof 25 mm plinth',mx-4.4*rear,side*4,m['position'][1]+6.75,1.40)
   aa25(f'aa-roof-{m["id"]}-{side}',mx-4.4*rear,side*4,m['position'][1]+6.75,False,side*90)
   bpy.context.view_layer.update();yaw=bpy.data.objects[m['id']+'.yaw']
   for ob in set(scene.objects)-before:
    world=ob.matrix_world.copy();ob.parent=yaw;ob.matrix_world=world
 # Six single 25 mm fittings, separate authored assemblies.
 for i,(x,y) in enumerate([(-119,-4),(-119,4),(-93,-9),(-93,9),(-53,-5),(-53,5)]):
  z=deck(x);cyl(f'aa-single-{i+1} pedestal',(x,y,z+.6),.15,1.2,naval,AA,12)
  rod(f'aa-single-{i+1} barrel',(x,y,z+1.2),(x+1.35,y,z+1.7),.048,edge,AA,vertices=8)
 fit=Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),fm,SUPER)
 for side in [-1,1]:
  for x,z,w in [(-9,9.7,2.3),(-18,9.7,2.2),(-27,9.7,2.2),(-36,9.7,1.8)]:fit.vent('Shelter ventilation',x,side*(6.5 if x==-3 else 10.8),z,w,1.25)
  for x in [-12,-34]:fit.door('Shelter access',x,side*10.8,8.7)
  for x in [-32,-26,-20,-14,-8]:fit.knee('AA gallery bracket',x,side*16.5,side*20.1,8.5,1.2)
