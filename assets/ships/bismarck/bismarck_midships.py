"""Midships: funnel casing, cap and galleries with their searchlights, hangars, boats and boat platforms,
aircraft cranes, the transverse catapult, and the funnel-platform 20 mm and 105 mm AA foundations.

Everything here is authored in the true blueprint frame (Blender x = -runtime z). pgsb708 A supplies the target
shapes; the geometry is original construction.
"""
from bismarck_kit import *
def B(x,y,z):
 # Runtime (x starboard, y up, z aft) to the recipe frame.
 return (-z,-x,y)
# ---------------------------------------------------------------- funnel
CAP_X=-2.01  # recipe x of the raked inner cap's centre (runtime z 2.01)
def cap_top(x):
 # The inner cap's mouth is one inclined plane: 25.0 m at its forward lip, 23.43 m aft.
 return 25.0+(23.43-25.0)*(-x+2.33)/(6.35+2.33)
def jacket_rings():
 V=[B(*v) for v in structures['funnel-jacket']['surface']['vertices']]
 return [V[i:i+64] for i in range(0,len(V),64)]
def band_at(rings,zz,step=2):
 pts=[]
 for i in range(0,64,step):
  for a,b in zip(rings,rings[1:]):
   if a[i][2]<=zz<=b[i][2] and b[i][2]>a[i][2]:
    t=(zz-a[i][2])/(b[i][2]-a[i][2]);pts.append(tuple(a[i][k]+(b[i][k]-a[i][k])*t for k in range(3)));break
 return pts
def stadium(front,aft,hw,n):
 # n points evenly spaced along a stadium path (recipe frame, bow +x), semicircular ends of radius hw.
 straight=(front-hw)-(aft+hw);per=2*straight+2*math.pi*hw;out=[]
 for i in range(n):
  s=per*i/n
  if s<straight:out.append((aft+hw+s,hw));continue
  s-=straight
  if s<math.pi*hw:a=s/hw;out.append((front-hw+hw*math.sin(a),hw*math.cos(a)));continue
  s-=math.pi*hw
  if s<straight:out.append((front-hw-s,-hw));continue
  a=(s-straight)/hw;out.append((aft+hw-hw*math.sin(a),-hw*math.cos(a)))
 return out
def wall_ladder(name,x,y,z0,z1,width=.44):
 # Vertical ladder against a side wall: rails spaced fore and aft, rungs every 0.3 m.
 for dx in [-width/2,width/2]:rod(name+' rail',(x+dx,y,z0),(x+dx,y,z1),.03,materials['light'],detailcol,vertices=5)
 for i in range(1,int((z1-z0)/.3)+1):
  zz=z0+i*.3;rod(name+' rung',(x-width/2,y,zz),(x+width/2,y,zz),.018,materials['edge'],detailcol,vertices=4)
def funnel_casing():
 rings=jacket_rings();casing=rings[:7];rim=rings[7];mouth=rings[9]
 # Rolled lip round the casing top and a ring of short cowl ventilators on the flat ledge inside it.
 polyline('Funnel casing rolled rim',rim[::2],.065,materials['edge'],supercol,True,6)
 for x,y in stadium(2.94,-6.96,2.36,34):
  cyl('Funnel ledge cowl',(x,y,23.41),.15,.62,materials['naval'],supercol,6)
  cyl('Funnel ledge cowl cap',(x,y,23.74),.19,.05,materials['edge'],supercol,6)
 # Raked inner cap: rolled mouth, plate thickness, sooted inner wall and the uptake below.
 polyline('Funnel cap rolled mouth',mouth[::2],.045,materials['edge'],supercol,True,6)
 inner=[(CAP_X+(x-CAP_X)*.957,y*.94,z-.03) for x,y,z in mouth];N=64
 mesh('Funnel cap plate thickness',mouth+inner,[(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)],materials['edge'],supercol)
 mesh('Funnel cap inner wall',inner+[(x,y,z-1.4) for x,y,z in inner],[(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)],materials['dark'],supercol)
 mesh('Recessed uptake darkness',[(x,y,z-1.37) for x,y,z in inner],[tuple(reversed(range(N)))],materials['dark'],supercol)
 # Open protective grating in the plane of the mouth: four transverse and two longitudinal bars.
 def chord(xx):
  hits=[]
  for a,b in zip(inner,inner[1:]+inner[:1]):
   if min(a[0],b[0])<=xx<=max(a[0],b[0]) and abs(a[0]-b[0])>1e-4:hits.append(a[1]+(b[1]-a[1])*(xx-a[0])/(b[0]-a[0]))
  return (min(hits),max(hits)) if len(hits)>=2 else None
 for xx in [1.15,-.85,-2.95,-5.05]:
  c=chord(xx)
  if c:rod('Funnel cap grating bar',(xx,c[0],cap_top(xx)-.1),(xx,c[1],cap_top(xx)-.1),.035,materials['edge'],supercol,vertices=6)
 for yy in [-.58,.58]:
  a,b=-6.2,2.2;rod('Funnel cap grating stringer',(a,yy,cap_top(a)-.14),(b,yy,cap_top(b)-.14),.04,materials['edge'],supercol,vertices=6)
 # Horizontal plating beads follow the casing, including its swept forward foot.
 for zz in [13.3,15.2,19.4,21.1,22.55]:
  polyline('Funnel plating bead',band_at(casing,zz),.028,materials['edge'],supercol,True,4)
 # Steam pipes up the after face, bent aft over the rim; they rise from the 01 deck through the gallery.
 for yy in [-.9,.9]:
  polyline('Funnel steam pipe',[(-7.36,yy,8.3),(-7.36,yy,23.05),(-7.5,yy,23.55),(-7.56,yy,24.25)],.085,materials['light'],supercol,vertices=8)
  for zz in [11.2,14.6,20.2]:rod('Steam pipe clip',(-7.36,yy,zz),(-7.05,yy*.95,zz),.03,materials['edge'],supercol,vertices=5)
 # Sirens on the after and forward faces (pgsb708 GM009 positions).
 for x,y,z in [B(-.17,21.01,7.66),B(-1.95,21.32,-3.29)]:
  sign=1 if x<0 else -1
  rod('Funnel siren bracket',(x+sign*.3,y,z-.35),(x,y,z-.35),.03,materials['edge'],supercol,vertices=5)
  rod('Funnel siren trumpet',(x,y,z-.55),(x,y,z+.55),.07,materials['naval'],supercol,.14,8)
 # Side ladders from the searchlight gallery to the rim, and after ladders from the 01 deck to the gallery.
 for sign in [-1,1]:
  wall_ladder('Funnel casing ladder',-2.3,sign*2.84,17.62,23.08)
  wall_ladder('Funnel after ladder',-6.85,sign*1.75,8.3,17.44)
  # Louvred fan-room intakes on the uptake base.
  for xx in [-2.4,-4.9]:vent('Funnel fan room intake',(xx,sign*2.83,10.05),(1.4,.14,1.25),sign)
 # The fan house is continuous with the side hangars below their eaves.
 for sign in [-1,1]:
  box('Hangar and fan house filler',(-(-10.9+.6)/2*-1 if False else 5.15,sign*2.97,9.75),(11.5,.5,2.9),materials['naval'],supercol)
def funnel_gallery():
 # Searchlight gallery wrapping the after end of the casing, with round lobes for the after searchlights.
 c=(3.76,7.42);r=1.9;stb=[(2.05,8.3)]
 a0=math.atan2(8.3-c[1],2.05-c[0])
 for i in range(1,15):
  a=a0-(a0+math.radians(22))*i/14;stb.append((c[0]+r*math.cos(a),c[1]+r*math.sin(a)))
 stb+=[(6.2,4.0),(6.25,1.6),(5.85,.83)]
 outline=stb+[(-x,z) for x,z in reversed(stb)]
 pts=[(-z,-x) for x,z in outline];top=17.62
 extrude('Funnel searchlight gallery',pts,top-.18,.18,materials['roof'],supercol)
 edge=[(-z,-x,top+.005) for x,z in [(5.85,.83)]+list(reversed(stb))+[(-x,z) for x,z in stb]+[(-5.85,.83)]]
 rail('Funnel searchlight gallery',edge,.9,1.5,False,col=supercol)
 rings=jacket_rings()
 for x,z in [(5.85,1.3),(6.2,2.7),(6.2,4.0),(5.66,7.1),(4.9,8.9),(3.3,9.2),(1.4,8.3),(-1.4,8.3),(-3.3,9.2),(-4.9,8.9),(-5.66,7.1),(-6.2,4.0),(-6.2,2.7),(-5.85,1.3)]:
  p=Vector((-z,-x,top-.2));w=min(rings[4],key=lambda q:(q[0]-p.x)**2+(q[1]-p.y)**2)
  rod('Gallery bracket',p,Vector((w[0],w[1],16.3)),.07,materials['naval'],supercol,vertices=6)
 for sign in [-1,1]:
  rod('Gallery lobe column',B(sign*3.9,8.3,7.9),B(sign*3.9,top-.18,7.9),.14,materials['naval'],supercol,vertices=10)
def searchlight_housing(name,x,y,sign):
 # pgsb708's forward searchlights stand in deep spherical housings on the casing sides: a 4 m bowl
 # (16.8-19.5 m) with a raised hood round its inboard half. The bowl's inboard edge enters the casing.
 n=24;prof=[(16.8,.35),(16.95,1.0),(17.3,1.5),(17.85,1.85),(18.55,2.0),(19.5,2.0)]
 vs=[(x+r*math.cos(math.tau*i/n),y+r*math.sin(math.tau*i/n),z) for z,r in prof for i in range(n)]
 fs=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(prof)-1) for i in range(n)]+[tuple(reversed(range(n)))]
 mesh(name+' bowl',vs,fs,materials['naval'],supercol,True)
 polyline(name+' rolled rim',[(x+2.02*math.cos(math.tau*i/n),y+2.02*math.sin(math.tau*i/n),19.5) for i in range(n)],.045,materials['edge'],supercol,True,5)
 cyl(name+' floor',(x,y,18.55),1.97,.1,materials['roof'],supercol,n)
 # Hood: the inboard half of the sphere above the rim, up to 55 degrees.
 m=12;hood=[]
 for j,e in enumerate([0,.35,.62,.82,.96]):
  for i in range(m+1):
   az=-sign*math.pi/2+math.radians(-100+200*i/m)
   hood.append((x+2.0*math.cos(e)*math.cos(az),y+2.0*math.cos(e)*math.sin(az),19.5+2.0*math.sin(e)))
 mesh(name+' hood',hood,[(j*(m+1)+i,j*(m+1)+i+1,(j+1)*(m+1)+i+1,(j+1)*(m+1)+i) for j in range(4) for i in range(m)],materials['naval'],supercol,True)
 for dx in [-.7,.7]:rod(name+' bracket',(x+dx,y,16.9),(x+dx,sign*2.62,15.6),.07,materials['naval'],supercol,vertices=6)
def funnel_searchlights():
 for sign in [-1,1]:
  x,y,_=B(sign*4.06,0,-1.45)
  searchlight_housing('Funnel forward searchlight housing',x,y,-sign)
  searchlight('Funnel forward 1.5 m searchlight',x,y,18.6,-sign*1.25)
  x,y,_=B(sign*3.76,0,7.42)
  searchlight('Funnel after 1.5 m searchlight',x,y,17.62,-sign*2.15)
# ---------------------------------------------------------------- hangars
HANGAR_EAVE=11.4;HANGAR_RIDGE=13.06
def draw_side_hangar(s):
 # pgsb708's single hangars have vertical walls to the eaves and a pitched roof over their middle.
 pts=[(-z,-x) for x,z in s['footprint']];x0=min(p[0] for p in pts);x1=max(p[0] for p in pts)
 y0=min(p[1] for p in pts);y1=max(p[1] for p in pts);ym=(y0+y1)/2
 ob=extrude(s['name'],pts,s['baseY'],HANGAR_EAVE-s['baseY'],materials['naval'],supercol,.035);ob['assemblyId']='superstructure-'+s['id']
 prof=[(y0-.12,HANGAR_EAVE-.02),(ym,HANGAR_RIDGE),(y1+.12,HANGAR_EAVE-.02)]
 vs=[(x,y,z) for x in [x0-.1,x1+.1] for y,z in prof]
 roof=mesh(s['name']+' pitched roof',vs,[(0,3,4,1),(1,4,5,2)],materials['roof'],supercol);roof['assemblyId']='superstructure-'+s['id']
 mod=roof.modifiers.new('Roof plate thickness','SOLIDIFY');mod.thickness=.08
 for x in [x0,x1]:
  gable=mesh(s['name']+' gable end',[(x,y0,HANGAR_EAVE),(x,ym,HANGAR_RIDGE-.03),(x,y1,HANGAR_EAVE)],[(0,1,2)],materials['naval'],supercol);gable['assemblyId']='superstructure-'+s['id']
 polyline(s['id']+' ridge',[(x0-.1,ym,HANGAR_RIDGE+.03),(x1+.1,ym,HANGAR_RIDGE+.03)],.05,materials['edge'],supercol)
 for x in [x0+2.2,x0+5.2,x0+8.2]:polyline(s['id']+' roof seam',[(x,y0-.1,HANGAR_EAVE+.02),(x,ym,HANGAR_RIDGE+.02),(x,y1+.1,HANGAR_EAVE+.02)],.022,materials['edge'])
 sign=1 if ym>0 else -1;wall=y1 if sign>0 else y0
 for x in [x0+2.3,x0+5.0,x0+7.7]:porthole(s['id']+' scuttle',(x,wall+sign*.05,10.35),(0,sign,0),.16)
 door(s['id']+' watertight door',x1-1.3,wall+sign*.05,8.43,sign)
for _sid in ['hangar-port','hangar-starboard']:structure_drawers[_sid]=draw_side_hangar
def hangars():
 # The double hangar keeps its forward folding doors; its sides carry ventilation.
 name,x,y,length,breadth,base='Double hangar',-20.9,0,9.82,11.4,13.15
 xx=x+length/2+.035;floor=8.4;doorheight=base-floor-.12;leaves=12;opening=breadth-.65
 for i in range(leaves):
  yy=y-opening/2+opening*(i+.5)/leaves
  box(name+' folding door',(xx,yy,floor+doorheight/2),(.10,opening/leaves-.035,doorheight),materials['naval'],detailcol)
  for dz in [.65,2.1,3.55]:box(name+' door stiffener',(xx+.065,yy,floor+dz),(.07,opening/leaves-.13,.055),materials['edge'],detailcol)
 rod(name+' door track',(xx,y-opening/2-.1,floor+doorheight+.1),(xx,y+opening/2+.1,floor+doorheight+.1),.075,materials['edge'],detailcol,vertices=8)
 for sign in [-1,1]:vent(name+' ventilation',(x,y+sign*(breadth/2+.035),base-1.15),(1.8,.12,1.1),sign)
# ---------------------------------------------------------------- boat platforms
def draw_gig_platform(s):
 # Open boat skid deck on beams: the admiral's gig rides on it above the 150 mm turret, whose gunhouse
 # sweeps beneath its outer half. Supports stand only inboard of that swept circle or at its ends.
 pts=[(-z,-x) for x,z in s['footprint']];x0=min(p[0] for p in pts);x1=max(p[0] for p in pts)
 y0=min(p[1] for p in pts);y1=max(p[1] for p in pts);top=s['baseY']+s['height']
 sign=1 if y0>0 else -1;inner=y0 if sign>0 else y1;outer=y1 if sign>0 else y0
 deck=box(s['name'],((x0+x1)/2,(y0+y1)/2,top-.06),(x1-x0,y1-y0,.12),materials['roof'],supercol);deck['assemblyId']='superstructure-'+s['id']
 for f in [.2,.55,.9]:
  yy=inner+(outer-inner)*f;box(s['id']+' stringer',((x0+x1)/2,yy,top-.2),(x1-x0,.16,.16),materials['naval'],supercol)
 n=8
 for i in range(n+1):
  x=x0+.15+(x1-x0-.3)*i/n;box(s['id']+' deck beam',(x,(y0+y1)/2,top-.33),(.16,y1-y0,.22),materials['naval'],supercol)
  # Knees tie each beam to the hangar wall.
  rod(s['id']+' wall knee',(x,inner+sign*.05,top-1.5),(x,inner+sign*1.6,top-.42),.06,materials['naval'],supercol,vertices=6)
 for x in [x0+.25,x1-.25]:
  foot=deckz(x)
  rod(s['id']+' end pillar',(x,outer-sign*.25,8.3),(x,outer-sign*.25,top-.42),.1,materials['naval'],supercol,vertices=8)
 rail(s['id']+' guard',[(x0,outer,top+.005),(x1,outer,top+.005)],.9,1.55,False,col=supercol)
for _sid in ['forward-port-gig-shelf','forward-starboard-gig-shelf']:structure_drawers[_sid]=draw_gig_platform
boat_support=None
def boat(name,x,y,z,length,breadth,cabin=False,yaw=0,keel=None,support_surface=None):
 before=set(bpy.data.objects)
 # Seat the keel consistently above the actual roof, including raised platforms.
 z=boat_support.below(x,y,z+5)+.40 if keel is None else keel
 # Original pgsb708 visual interpretation: fine raked stem, flared topsides,
 # narrower rounded transom and visibly hollow timber interior. The closed
 # double skin gives an actual gunwale thickness rather than an open mesh rim.
 stations=[(-.50,.33,.24),(-.46,.63,.13),(-.36,.86,.04),(-.20,.97,0),(0,1,0),(.18,.94,.035),(.32,.74,.10),(.42,.44,.21),(.48,.15,.34),(.50,0,.40)]
 depth=breadth*.38
 def shape(t):
  for (a,wa,sa),(b,wb,sb) in zip(stations,stations[1:]):
   if a<=t<=b:
    f=(t-a)/(b-a);return (wa+(wb-wa)*f)*breadth/2,sa+(sb-sa)*f
  return 0,.4
 vs=[]
 for t,w,sheer in stations:
  xx=x+t*length;half=w*breadth/2
  # Continuous outer-to-inner section across both gunwales and bottom.
  vs.extend([(xx,y,z+sheer),(xx,y+half*.55,z+depth*.17+sheer),(xx,y+half*.84,z+depth*.55+sheer),(xx,y+half,z+depth+sheer),(xx,y+max(0,half-.065),z+depth+sheer-.035),(xx,y+max(0,half*.79-.045),z+depth*.55+sheer),(xx,y+max(0,half*.46-.035),z+depth*.26+sheer),(xx,y,z+depth*.20+sheer),(xx,y-max(0,half*.46-.035),z+depth*.26+sheer),(xx,y-max(0,half*.79-.045),z+depth*.55+sheer),(xx,y-max(0,half-.065),z+depth+sheer-.035),(xx,y-half,z+depth+sheer),(xx,y-half*.84,z+depth*.55+sheer),(xx,y-half*.55,z+depth*.17+sheer)])
 n=14;fs=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(stations)-1) for i in range(n)]
 fs.extend([tuple(reversed(range(n))),tuple(range((len(stations)-1)*n,len(stations)*n))])
 mesh(name+' closed clinker hull',vs,fs,materials['naval'] if cabin else materials['wood'],detailcol,True)
 gunwale=[(x+t*length,y+w*breadth/2,z+depth+sheer) for t,w,sheer in stations]+[(x+t*length,y-w*breadth/2,z+depth+sheer) for t,w,sheer in reversed(stations)]
 polyline(name+' rolled gunwale',gunwale,.045,materials['light'],closed=True,vertices=8)
 for sign in [-1,1]:
  for frac,spread in [(.32,.67),(.58,.85),(.80,.94)]:
   polyline(name+' plank lap',[(x+t*length,y+sign*w*breadth*.5*spread,z+depth*frac+sheer) for t,w,sheer in stations],.013,materials['edge'] if cabin else materials['wood'],vertices=5)
 # Floorboards fit the taper, with ribs tying floor and gunwale into one shell.
 for yy in [-.22,-.11,0,.11,.22]:
  box(name+' floorboard',(x-length*.02,y+yy*breadth,z+depth*.38),(length*.68,breadth*.102,.045),materials['wood'],detailcol)
 for t in [-.35,-.25,-.12,.02,.16,.29,.39]:
  half,sheer=shape(t);xx=x+t*length
  pts=[(xx,y-half+.055,z+depth+sheer-.04),(xx,y-half*.79,z+depth*.55+sheer),(xx,y-half*.46,z+depth*.26+sheer),(xx,y,z+depth*.21+sheer),(xx,y+half*.46,z+depth*.26+sheer),(xx,y+half*.79,z+depth*.55+sheer),(xx,y+half-.055,z+depth+sheer-.04)]
  polyline(name+' internal rib',pts,.027,materials['wood'],vertices=6)
 # Fine foredeck and transom capping boards close the extremities.
 for ta,tb in [(-.50,-.38),(.37,.50)]:
  cut=[(t,w,sh) for t,w,sh in stations if ta<=t<=tb]
  outline=[(x+t*length,y+w*breadth/2,z+depth+sh-.035) for t,w,sh in cut]+[(x+t*length,y-w*breadth/2,z+depth+sh-.035) for t,w,sh in reversed(cut)]
  mesh(name+' end deck',outline,[tuple(range(len(outline)))],materials['deck'],detailcol)
 # All cradle feet raycast original support surfaces; their arms meet the hull.
 for t in [-.27,.25]:
  xx=x+length*t;half,sheer=shape(t)
  box(name+' cradle crossbeam',(xx,y,z-.03),(.23,breadth*.83,.12),materials['edge'],detailcol)
  for sign in [-1,1]:
   yy=y+sign*breadth*.28;foot=Vector((xx-x,yy-y,0));foot.rotate(Matrix.Rotation(yaw,3,'Z'));floor=(support_surface or boat_support).below(x+foot.x,y+foot.y,z+.025)
   box(name+' cradle leg',(xx,yy,(floor+z+.02)/2),(.21,.20,max(.04,z+.04-floor)),materials['edge'],detailcol)
   rod(name+' fitted cradle arm',(xx,y,z-.01),(xx,y+sign*half*.85,z+depth*.55+sheer),.057,materials['edge'],detailcol,vertices=8)
 if cabin:
  # Long low after cabin, shallow sloped wheelhouse and a flush forward deck.
  outline=[(x+t*length,y+w*breadth*.49) for t,w,sh in stations]+[(x+t*length,y-w*breadth*.49) for t,w,sh in reversed(stations)]
  extrude(name+' launch deck',outline,z+depth-.015,.06,materials['deck'],detailcol)
  gig='gig' in name.lower();cabx=x-length*(.08 if gig else .13);cabbase=z+depth+.045;cabheight=.90 if gig else .95;cablength=length*(.32 if gig else .43)
  pts=rounded_rect(cabx,y,cablength,breadth*.67,.20,3)
  extrude(name+' cabin sides',pts,cabbase,cabheight,materials['naval'],detailcol,.025)
  roof=rounded_rect(cabx,y,cablength+.20,breadth*.71,.22,3)
  n=len(roof);ridge=[(a,b*.88+y*.12,cabbase+cabheight+.16) for a,b in roof]
  mesh(name+' cambered cabin roof',[(a,b,cabbase+cabheight) for a,b in roof]+ridge,[tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],materials['canvas'],detailcol)
  for sign in [-1,1]:
   for t in [-.155,-.055,.065,.155]:
    xx=cabx+cablength*t/.43;yy=y+sign*breadth*.339
    box(name+' framed cabin port',(xx,yy,cabbase+.48),(length*.074,.045,.42),materials['edge'],detailcol)
    box(name+' cabin glazing',(xx,yy+sign*.027,cabbase+.48),(length*.060,.025,.32),materials['glass'],detailcol)
   box(name+' windscreen frame',(cabx+cablength*.505,y+sign*breadth*.16,cabbase+.49),(.045,breadth*.27,.45),materials['edge'],detailcol)
   box(name+' windscreen',(cabx+cablength*.505+.027,y+sign*breadth*.16,cabbase+.49),(.020,breadth*.23,.35),materials['glass'],detailcol)
  hatch(name+' cabin hatch',cabx-length*.10,y,cabbase+cabheight+.17,.78,.62)
  for t in [-.43,.35]:
   for sign in [-1,1]:rod(name+' cleat',(x+length*t-.14,y+sign*breadth*.21,z+depth+.20),(x+length*t+.14,y+sign*breadth*.21,z+depth+.20),.024,materials['edge'],detailcol,vertices=8)
 else:
  for t in [-.29,-.12,.06,.23,.34]:
   half,sheer=shape(t);xx=x+length*t;seat=z+depth*.82+sheer
   box(name+' rowing thwart',(xx,y,seat),(.24,2*half*.91,.08),materials['deck'],detailcol)
   for sign in [-1,1]:
    rod(name+' seat knee',(xx,y+sign*half*.67,seat-.03),(xx,y+sign*half*.82,seat-.25),.035,materials['wood'],detailcol,vertices=6)
    rod(name+' rowlock socket',(xx,y+sign*half,z+depth+sheer-.025),(xx,y+sign*half,z+depth+sheer+.095),.025,materials['edge'],detailcol,vertices=8)
  for sign in [-1,1]:
   yy=y+sign*breadth*.21;zz=z+depth*.87+.09
   rod(name+' stowed oar shaft',(x-length*.33,yy,zz),(x+length*.23,yy,zz),.025,materials['wood'],detailcol,vertices=8)
   extrude(name+' shaped oar blade',[(x-length*.43,yy-.075),(x-length*.43,yy+.075),(x-length*.35,yy+.095),(x-length*.30,yy+.025),(x-length*.30,yy-.025),(x-length*.35,yy-.095)],zz-.015,.030,materials['wood'],detailcol)
 # Rotate the original boat and cradle together; all cradle feet use world support.
 if yaw:
  transform=Matrix.Translation((x,y,0))@Matrix.Rotation(yaw,4,'Z')@Matrix.Translation((-x,-y,0))
  bpy.context.view_layer.update()
  for ob in set(bpy.data.objects)-before:ob.matrix_world=transform@ob.matrix_world
 return set(bpy.data.objects)-before
def boats():
 global boat_support
 boat_support=SupportSurface([*hullcol.objects,*supercol.objects])
 # The approved A fit has asymmetric forward stowage: two nested port cutters over the port hangar,
 # the captain's gig over the starboard hangar, and the admiral's gigs on the outboard skid decks.
 for yy in [4.06,6.38]:
  cutter=boat('Port cutter',5.97,yy,12.63,8.70,2.07,False,keel=12.66)
  boat('Nested port longboat',6.0,yy,13.54,6.31,1.65,False,keel=13.56,support_surface=SupportSurface(list(cutter)))
 boat('Starboard captain gig',6.31,-3.88,12.39,9.21,2.56,True,keel=12.52)
 for sign in [-1,1]:
  boat('Admiral gig',6.85,sign*9.30,10.83,11.14,2.67,True,keel=10.83)
  boat('Outer aft motor launch',-21.95,sign*6.86,11.6,11.54,3.00,True,keel=11.60)
  boat('Inner aft motor launch',-19.56,sign*2.91,13.59,11.54,3.00,True,yaw=-sign*math.radians(13.846),keel=13.59)
# ---------------------------------------------------------------- aircraft cranes
def crane(sign):
 # pgsb708 GM900: a slewing machinery base on the main deck at the ship's side, a rear gantry with the
 # topping-sheave housing, and a tapered box-girder A-jib stowed rising forward and inboard to the tower.
 bx,by,_=B(sign*13.3,0,5.8);deck=SupportSurface([*hullcol.objects]).below(bx,by,9.0)
 yaw=sign*-math.atan2(8.75,11.9)
 R=Matrix.Rotation(yaw,3,'Z')
 def L(u,v,w):return tuple(Vector((bx,by,deck))+R@Vector((u,v,w)))
 def lbox(name,u,v,w,su,sv,sw,mat='naval'):
  ob=box(name,L(u,v,w),(su,sv,sw),materials[mat],detailcol);ob.rotation_euler.z=yaw;return ob
 lbox('Aircraft crane slewing plinth',0,0,.18,4.1,3.5,.36,'edge')
 for v in [-1.25,1.25]:
  # Trapezoidal side cheeks, taller at the rear under the gantry.
  cheek=[(-2.15,.36),(1.65,.36),(1.65,2.45),(.2,2.75),(-2.15,3.1)]
  vs=[L(u,v+dv,w) for dv in [-.13,.13] for u,w in cheek];n=len(cheek)
  mesh('Aircraft crane side cheek',vs,[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],materials['naval'],detailcol)
 lbox('Aircraft crane machinery house',-.35,0,1.25,2.6,2.24,1.8)
 lbox('Aircraft crane motor casing',-1.55,0,2.35,1.0,1.3,.8,'edge')
 rod('Aircraft crane winch drum',L(.55,-1.12,1.25),L(.55,1.12,1.25),.58,materials['edge'],detailcol,vertices=16)
 for v in [-.95,.95]:rod('Aircraft crane drum flange',L(.55,v-.05,1.25),L(.55,v+.05,1.25),.72,materials['naval'],detailcol,vertices=16)
 rod('Aircraft crane slewing column',L(.1,0,2.1),L(.1,0,3.3),.32,materials['naval'],detailcol,vertices=10)
 # Rear gantry and topping-sheave housing.
 for v in [-.85,.85]:rod('Aircraft crane gantry post',L(-2.0,v,2.9),L(-2.0,v,4.25),.12,materials['naval'],detailcol,vertices=8)
 rod('Aircraft crane sheave housing',L(-2.0,-1.0,4.25),L(-2.0,1.0,4.25),.52,materials['naval'],detailcol,vertices=8)
 rod('Aircraft crane spreader',L(-1.25,-1.35,4.45),L(-1.25,1.35,4.45),.08,materials['edge'],detailcol,vertices=6)
 for v in [-1.35,1.35]:rod('Aircraft crane spreader stay',L(-1.25,v,4.45),L(-2.0,v*.7,4.25),.05,materials['edge'],detailcol,vertices=5)
 ladder('Aircraft crane base ladder',L(-2.3,.6,.36),L(-2.3,.6,3.1),.42)
 # Jib: two box legs hinged at the base front, converging on the head sheaves.
 foot=Vector((1.35,0,2.55));head=Vector((1.35+14.77,0,16.05))
 def leg(t,side):
  spread=1.45+(0.26-1.45)*t;p=foot+(head-foot)*t;return L(p.x,side*spread,p.z)
 for side in [-1,1]:
  rod('Aircraft crane jib box girder',leg(0,side),leg(1,side),.30,materials['naval'],detailcol,.19,vertices=4)
  rod('Aircraft crane jib foot pin',L(foot.x,side*1.2,foot.z),L(foot.x,side*1.75,foot.z),.16,materials['edge'],detailcol,vertices=8)
 for t in [.2,.43,.64]:rod('Aircraft crane jib diaphragm',leg(t,-1),leg(t,1),.17,materials['naval'],detailcol,vertices=4)
 t=.8;rod('Aircraft crane jib spreader',leg(t,-1)+(Vector(leg(t,-1))-Vector(leg(t,1)))*.3,leg(t,1)+(Vector(leg(t,1))-Vector(leg(t,-1)))*.3,.09,materials['edge'],detailcol,vertices=6)
 hp=Vector(L(head.x+.25,0,head.z+.15))
 rod('Aircraft crane head block',L(head.x-.4,0,head.z),L(head.x+.35,0,head.z+.15),.3,materials['naval'],detailcol,vertices=8)
 for side in [-.28,.28]:rod('Aircraft crane head sheave',L(head.x+.3,side-.06,head.z+.15),L(head.x+.3,side+.06,head.z+.15),.45,materials['edge'],detailcol,vertices=14)
 hook=hp-Vector((0,0,2.1))
 for side in [-.1,.1]:rod('Aircraft crane fall',hp+Vector((0,side,-.3)),hook+Vector((0,side,.35)),.018,materials['dark'],detailcol,vertices=5)
 cyl('Aircraft crane hook block',tuple(hook+Vector((0,0,.2))),.2,.42,materials['edge'],detailcol,10)
 ring('Aircraft crane hook',tuple(hook-Vector((0,0,.12))),(math.sin(yaw),-math.cos(yaw),0),.13,.035,materials['edge'],10)
 # Topping lift from the gantry sheaves to the jib spreader, and the hoist from the winch drum to the head.
 for v in [-.5,0,.5]:rod('Aircraft crane topping lift',L(-2.0,v,4.25),Vector(L(0,0,0))*0+Vector(leg(.8,-1))*(.5-v)+Vector(leg(.8,1))*(.5+v),.018,materials['dark'],detailcol,vertices=5)
 for v in [-.2,.2]:rod('Aircraft crane hoist rope',L(.55,v,1.8),L(head.x+.1,v,head.z-.1),.018,materials['dark'],detailcol,vertices=5)
def cranes():
 for sign in [-1,1]:crane(sign)
# ---------------------------------------------------------------- catapult
def catapult():
 # pgsb708 gc001: a transverse lattice-girder catapult (34 m over both halves, 1.5 m wide, 0.95 m deep) lying
 # in the trough of the 01 deckhouse, on the deckhouse spine amidships and on pillars to the main deck.
 x0,x1=-9.85,-11.2;y1=17.0;zb,zt=7.62,8.45;bays=20
 for x in [x0,x1]:
  for z in [zb,zt]:rod('Catapult chord',(x,-y1,z),(x,y1,z),.075,materials['edge'],detailcol,vertices=6)
  for i in range(bays+1):
   y=-y1+2*y1*i/bays;rod('Catapult web post',(x,y,zb),(x,y,zt),.04,materials['naval'],detailcol,vertices=4)
   if i<bays:
    y2=-y1+2*y1*(i+1)/bays
    rod('Catapult web diagonal',(x,y,zb),(x,y2,zt),.035,materials['naval'],detailcol,vertices=4)
    rod('Catapult web diagonal',(x,y,zt),(x,y2,zb),.035,materials['naval'],detailcol,vertices=4)
 for i in range(bays+1):
  y=-y1+2*y1*i/bays;rod('Catapult cross member',(x0,y,zt),(x1,y,zt),.045,materials['naval'],detailcol,vertices=4)
  rod('Catapult bottom cross member',(x0,y,zb),(x1,y,zb),.04,materials['naval'],detailcol,vertices=4)
 for x in [-10.2,-10.85]:rod('Catapult trolley rail',(x,-y1,zt+.1),(x,y1,zt+.1),.05,materials['light'],detailcol,vertices=6)
 for y in [-y1,y1]:box('Catapult end buffer',(-10.525,y,(zb+zt)/2),(1.45,.2,.95),materials['naval'],detailcol)
 # Pillars to the main deck outboard of the deckhouse.
 for sign in [-1,1]:
  for yy in [13.3,15.5]:
   for x in [x0,x1]:
    foot=deckz(x)
    top=(x,sign*yy,zb)
    rod('Catapult support pillar',(x,sign*(yy+(.5 if yy>14 else 0)),foot),top,.09,materials['naval'],detailcol,vertices=8)
  # Launch carriage stowed on each half: a flat trolley with two A-frame cradle trestles.
  c=sign*8.55
  box('Catapult launch carriage',(-10.525,c,zt+.24),(1.35,3.0,.16),materials['roof'],detailcol)
  for x in [-10.0,-11.05]:
   apex=(x,c-sign*1.35,10.65)
   rod('Catapult cradle trestle',(x,c-sign*1.4,zt+.32),apex,.05,materials['edge'],detailcol,vertices=6)
   rod('Catapult cradle trestle',(x,c+sign*1.35,zt+.32),apex,.05,materials['edge'],detailcol,vertices=6)
  rod('Catapult cradle crosshead',(-10.0,c-sign*1.35,10.65),(-11.05,c-sign*1.35,10.65),.055,materials['edge'],detailcol,vertices=6)
  for y in [c-sign*1.0,c+sign*1.0]:
   rod('Catapult carriage wheel',(-10.2,y,zt+.12),(-10.85,y,zt+.12),.11,materials['edge'],detailcol,vertices=10)
# ---------------------------------------------------------------- AA foundations
own_foundations.update({'starboard-aa-20-3','port-aa-20-3'})
def aa_seats():
 for m in DEF['mounts']:
  if m['id'] in ('starboard-aa-20-3','port-aa-20-3'):
   x,y,z=B(*m['position']);cyl(m['id']+' gallery seat',(x,y,(17.62+z)/2+.01),.55,z-17.62+.02,materials['edge'],detailcol,16)
def build():
 # Region entry point, after the forward region.
 funnel_casing();funnel_gallery();funnel_searchlights();hangars();boats();cranes();catapult()
 landmarks['funnel-cap']=(CAP_X,0,24.09)
def after_mounts():
 aa_seats()
