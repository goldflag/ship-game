"""Funnel, searchlight towers, aft director tower, mainmast, Type 13 radar and aerials."""
from yamato_kit import *


def build():
 # Aft director stands ahead of the after 15.5 cm turret.
 rounded('Aft director foundation',-39,0,10.8,9,10,4.6,naval,SUPER)
 cyl('Aft director column',(-38.6,0,18.1),2.4,5.5,naval,SUPER,32)
 cyl('Aft director upper housing',(-38.6,0,22.8),2.05,3.9,naval,SUPER,32)
 rod('10 metre aft rangefinder',(-38.6,-5,20.1),(-38.6,5,20.1),.42,naval,SUPER,vertices=16)
 rounded('Aft fire control head',-38.6,0,24.6,2.5,2.7,1.0,naval,SUPER)

 # Narrow capsule uptake and raked rim from the approved model comparison.
 # Derive shell bands and fittings from the same original blueprint rings.
 fverts=S['funnel-jacket']['surface']['vertices']
 frings=[[(-z,-x,y) for x,y,z in fverts[i:i+48]] for i in range(0,len(fverts),48)]
 structure('funnel-jacket',FUNNEL)
 cap=frings[-1];mesh('Funnel smoke opening',[(x,y,z-.14) for x,y,z in cap],[tuple(range(48))],dark,FUNNEL)
 for row in frings[1:]:
  for i in range(48):rod('Funnel shell band',row[i],row[(i+1)%48],.045,edge,FUNNEL,vertices=6)
 for j in (3,9,15,21,27,33,39,45):
  for a,b in zip(frings[1:],frings[2:]):rod('Funnel stiffener',a[j],b[j],.070,edge,FUNNEL,vertices=7)
 for y in (-1.4,-.7,0,.7,1.4):
  extent=2.466+1.894*math.sqrt(1-(y/1.894)**2)
  rod('Funnel cap grille',(-23.3-extent,y,29.45-.15*extent),(-23.3+extent,y,29.45+.15*extent),.035,edge,FUNNEL,vertices=6)
 funnel_support=SupportSurface(FUNNEL.objects)
 for side in (-1,1):
  # Bent external steam lines follow the rake on the narrow capsule shell.
  for offset in (-2.0,0,2.0):
   route=[(-19.1+offset,side*3.18,15.0),(-20.7+offset,side*2.60,19.5),(-21.7+offset,side*2.08,23.5),(-23.1+offset,side*2.08,28.8)]
   for a,b in zip(route,route[1:]):rod('Funnel steam line',a,b,.10,edge,FUNNEL,vertices=12)
   for x,y,z in route[1:]:
    foot=funnel_support.along((x,y,z),(0,-side,0),8)
    rod('Steam pipe clamp',foot,(x,y,z),.052,edge,FUNNEL,vertices=8)

 # Auxiliary directors, searchlights and Type 89 dual-purpose mounts.
 def light(name,x,y,z,bearing):
  a=math.radians(bearing)
  def pt(f,s,h):return (x+f*math.cos(a)-s*math.sin(a),y+f*math.sin(a)+s*math.cos(a),z+h)
  cyl(name+' stand',(x,y,z+.4),.26,.8,naval,SUPER,16)
  rod(name+' casing',pt(-.48,0,1.4),pt(.48,0,1.4),.85,naval,SUPER,vertices=32)
  rod(name+' 150 cm reflector',pt(.49,0,1.4),pt(.51,0,1.4),.75,glass,SUPER,vertices=32)
  for s in (-.97,.97):
   rod(name+' cradle',pt(0,s,.25),pt(0,s,1.4),.07,edge,SUPER,vertices=8)
   rod(name+' axle',pt(0,s,1.4),pt(0,s*.78,1.4),.12,edge,SUPER,vertices=12)
  rod(name+' reflector horizontal brace',pt(.53,-.75,1.4),pt(.53,.75,1.4),.018,edge,SUPER,vertices=6)
  rod(name+' reflector vertical brace',pt(.53,0,.65),pt(.53,0,2.15),.018,edge,SUPER,vertices=6)
 searchlight_support=SupportSurface([*HULL.objects,*SUPER.objects])
 for side in (-1,1):
  # Museum searchlight article explicitly describes three 150 cm lights per side.
  for xx,zz in [(-16.0,18.2),(-23.5,20.1),(-31.0,20.1)]:
   # The museum photograph shows a lower forward station and two raised tubs.
   cy=side*6.1
   outline=[(xx+1.8*math.cos(i*math.tau/24),cy+1.8*math.sin(i*math.tau/24)) for i in range(24)]
   floor=searchlight_support.below(xx,cy,zz-2.6)
   cyl('Searchlight lower pedestal',(xx,cy,(floor+zz-2.0)/2),.76,zz-2.0-floor+.02,naval,SUPER,24)
   cyl('Searchlight gallery support',(xx,cy,zz-1.0),.75,2.0,naval,SUPER,20,r2=1.8)
   prism('Searchlight gallery deck',outline,zz,zz+.18,roof,SUPER)
   perimeter_band('Searchlight gallery bulwark',outline,zz+.18,.7,naval,SUPER)
   light('150 cm searchlight',xx,cy,zz+.18,side*90)
 for side in (-1,1):ha_director(-38.85,side*6.24,15.07,searchlight_support)
 # Tripod mainmast and open radar aerials. Sizes are interpreted from elevations.
 for a in [(-28,-3.8,16),(-28,3.8,16),(-35,0,14)]:rod('Tripod mast leg',a,(-37,0,39.6),.24,edge,MAST,r2=.13,vertices=12)
 rod('Mainmast yard',(-34.5,-12,33),(-34.5,12,33),.12,edge,MAST,vertices=10)
 for z in (24,29,34):
  t=(z-16)/(39.6-16);xx=-28-9*t;yy=3.8*(1-t)
  rod('Mast cross brace',(xx,-yy,z),(xx,yy,z),.1,edge,MAST,vertices=8)
 # The aft signal outrigger is a braced extension of the tripod, as shown in
 # the retained 1945 elevation; its dimensions remain interpreted.
 rod('Signal spar upper stay',(-37,0,39.6),(-43,0,36),.12,edge,MAST,vertices=8)
 rod('Signal spar lower brace',(-36.1,0,28),(-43,0,36),.12,edge,MAST,vertices=8)
 rod('Signal spar',(-43,-7,36),(-43,7,36),.075,wire,MAST,vertices=8)
 for side in (-1,1):
  for y in (2,4,6,8,10):rod('Signal halyard',(-34.5,side*y,33),(-29,side*5.8,16.4),.015,wire,MAST,vertices=5)
  for a,b in [((-37,0,39.6),(-1.76,0,39.4)),((-1.76,0,39.4),(128,0,12.0)),((-43,side*7,36),(-128,side*2,10.5))]:rod('Aerial wire',a,b,.018,wire,MAST,vertices=5)
 for side in (-1,1):
  for z in (30,33):rod('Type 13 mounting arm',(-35-2*(z-14)/25.6,0,z),(-35.5,0,z),.08,edge,MAST,vertices=8)
  rod('Type 13 aerial spine',(-35.5,0,29.8),(-35.5,0,34.2),.07,edge,MAST,vertices=8)
  for z in (30,31,32,33,34):rod('Type 13 aerial dipole',(-35.5,-.85,z),(-35.5,.85,z),.038,edge,MAST,vertices=6)
 fit=Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),fm,SUPER)
 for side in [-1,1]:
  # Raised directors have sight slits and split hoods instead of blank drums.
  for dx in [-.65,.65]:
   yy=2.05*math.sqrt(1-(dx/2.05)**2)
   box('Director optical slit',(-38.6+dx,side*(yy-.035),23),(.38,.12,.20),glass,SUPER)
 fit.col=FUNNEL
 for side in [-1,1]:
  fit.ladder('Funnel inspection ladder',(-19.6,side*2.88,17),(-23.25,side*2.02,29.7),.58)
  for x in [-21.5,-17.2]:
   fit.vent('Funnel base air intake',x,side*3.60,13.4,2.0,1.7)
