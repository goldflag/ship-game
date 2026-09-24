"""Midships: funnel details and its searchlights, hangars, boats, aircraft cranes and catapult."""
from bismarck_kit import *
def funnel_details():
 # Runs inside legacy_frame(): authored 2 m forward, shifted back by the caller.
 # Funnel: a flared uptake foot, nearly straight-sided oblong jacket, projecting
 # collar and smaller raked cap. Profiles come from the authored blueprint rings.
 fx=-.6;N=64
 verts=[(-z+2,-x,y) for x,y,z in structures['funnel-jacket']['surface']['vertices']]
 jacket_rings=[verts[i:i+N] for i in range(0,len(verts),N)]
 outer=jacket_rings[-1];inner=[(fx+(x-fx)*.945,y*.9,z-.05) for x,y,z in outer]
 mesh('Funnel cap thickness',outer+inner,[(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)],materials['edge'],supercol)
 mesh('Funnel cap inner wall',inner+[(x,y,z-1.3) for x,y,z in inner],[(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)],materials['dark'],supercol)
 mesh('Recessed uptake darkness',[(x,y,z-1.27) for x,y,z in inner],[tuple(reversed(range(N)))],materials['dark'],supercol)
 polyline('Funnel cap rolled lip',outer,.045,materials['light'],supercol,True,8)
 for xx in [-4.8,-3.3,-1.8,-.3,1.2,2.7,4.1]:
  hits=[]
  for a,b in zip(outer,outer[1:]+outer[:1]):
   if min(a[0],b[0])<=xx<=max(a[0],b[0]) and abs(a[0]-b[0])>.0001:hits.append(a[1]+(b[1]-a[1])*(xx-a[0])/(b[0]-a[0]))
  if len(hits)>=2:rod('Funnel transverse cap grating',(xx,min(hits),24.3+.16*(xx-fx)),(xx,max(hits),24.3+.16*(xx-fx)),.035,materials['edge'],supercol,vertices=6)
 for yy in [-1.25,0,1.25]:
  hits=[]
  for a,b in zip(outer,outer[1:]+outer[:1]):
   if min(a[1],b[1])<=yy<=max(a[1],b[1]) and abs(a[1]-b[1])>.0001:hits.append(a[0]+(b[0]-a[0])*(yy-a[1])/(b[1]-a[1]))
  if len(hits)>=2:
   a,b=min(hits),max(hits);rod('Funnel longitudinal cap grating',(a,yy,24.3+.16*(a-fx)),(b,yy,24.3+.16*(b-fx)),.038,materials['edge'],supercol,vertices=6)
 for zz in [13.7,16.2,19.1,21.3,22.65]:
  pts=[]
  for i in range(N):
   a,b=next((a[i],b[i]) for a,b in zip(jacket_rings,jacket_rings[1:]) if a[i][2]<=zz<=b[i][2])
   t=(zz-a[2])/(b[2]-a[2]);pts.append(tuple(a[k]+(b[k]-a[k])*t for k in range(3)))
  polyline('Funnel plating collar',pts,.032,materials['edge'],supercol,True)
 # Standing cowl ventilators follow the horizontal collar, outside the smaller cap.
 for i in range(0,N,2):
  x,y,z=jacket_rings[-3][i]
  cyl('Funnel collar ventilator',(x,y,23.51),.105,.62,materials['naval'],supercol,10)
  cyl('Funnel ventilator crown',(x,y,23.83),.12,.035,materials['edge'],supercol,10)
 for sign in [-1,1]:
  for zz,length,w,yy in [(14.55,11.6,1.0,3.6),(17.45,12.2,2.6,4.4)]:
   pts=rounded_rect(fx-.6,sign*yy,length,w,.45,5);extrude('Funnel gallery',pts,zz,.2,materials['roof'],supercol)
   rail('Funnel gallery',[(x,y,zz+.2) for x,y in pts],.87,1.35,col=supercol)
   for xx in [-5.2,-2.8,-.3,2.2]:rod('Funnel gallery knee',(xx,sign*(yy+w*.44),zz),(xx,sign*2.65,zz-1.15),.065,materials['naval'],supercol,vertices=6)
  for xx in [-5.7,-5.25]:
   polyline('Funnel steam pipe',[(xx,sign*2.55,12),(xx,sign*2.55,20.1),(xx+.18,sign*2.7,22.5)],.065,materials['light'],supercol,vertices=8)
  stairs('Funnel gallery access',(-5.5,sign*4.0,14.75),(-2.4,sign*4.0,17.65),.6)
  ladder('Funnel upper ladder',(-3.8,sign*3.02,17.7),(-3.8,sign*3.02,22.95),.45)
  for xx in [-4.5,.7]:vent('Funnel lower uptake grille',(xx,sign*3.77,10.3),(1.5,.15,1.3),sign)

def funnel_searchlights():
 for sign in [-1,1]:
  for xx,yy,zz,bearing in [(1.45,4.3,18.7,sign*1.25),(-7.7,3.8,17.7,sign*2.15)]:
   searchlight_cup('Funnel searchlight',xx,sign*yy,zz,deep=xx>0)
   searchlight('Funnel 1.5 m searchlight',xx,sign*yy,zz+.08,bearing)
def hangars():
 # Aircraft hangar roof camber and folding leaves follow the approved model.
 # The eaves and door sills follow the raised blueprint decks.
 for name,x,y,length,breadth,base in [('Port single hangar',6.0,5.55,11.8,4.6,12.1),('Starboard single hangar',6.0,-5.55,11.8,4.6,12.1),('Double hangar',-20.9,0,9.82,11.4,13.15)]:
  rise=.15 if breadth<7 else .12
  arc=[(y+breadth*(i/16-.5),base+rise*math.sin(math.pi*i/16)) for i in range(17)]
  roofvs=[(xx,yy,zz) for xx in [x-length/2,x+length/2] for yy,zz in arc]
  if breadth<7:mesh(name+' curved roof',roofvs,[(i,i+1,i+18,i+17) for i in range(16)]+[tuple(reversed(range(17))),tuple(range(17,34))],materials['roof'],supercol,True)
  for xx in ([x-length/2+.15,x,x+length/2-.15] if breadth<7 else []):polyline(name+' roof seam',[(xx,yy,zz+.025) for yy,zz in arc],.028,materials['edge'])
  # The double hangar opens forward; the side hangars open aft onto handling deck.
  xx=x+(length/2+.035)*(1 if breadth>7 else -1);floor=8.4;doorheight=base-floor-.12
  leaves=12 if breadth>7 else 6;opening=breadth-.65
  for i in range(leaves):
   yy=y-opening/2+opening*(i+.5)/leaves
   box(name+' folding door',(xx,yy,floor+doorheight/2),(.10,opening/leaves-.035,doorheight),materials['naval'],detailcol)
   for dz in [.65,2.1,3.55]:box(name+' door stiffener',(xx+(.065 if breadth>7 else -.065),yy,floor+dz),(.07,opening/leaves-.13,.055),materials['edge'],detailcol)
  rod(name+' door track',(xx,y-opening/2-.1,floor+doorheight+.1),(xx,y+opening/2+.1,floor+doorheight+.1),.075,materials['edge'],detailcol,vertices=8)
  for sign in [-1,1]:vent(name+' ventilation',(x, y+sign*(breadth/2+.035),base-1.15),(1.8,.12,1.1),sign)
 # An aft cross-gallery carries the center searchlight and joins the side galleries.
 extrude('Funnel aft cross gallery',rounded_rect(-8.15,0,2.3,9.7,.4,3),17.65,.18,materials['roof'],supercol)
 rail('Funnel aft cross gallery',[(-9.28,-4.4,17.83),(-9.28,4.4,17.83)],.88,1.6,False)
 for sign in [-1,1]:rod('Cross gallery bracket',(-9.1,sign*3,17.63),(-7.4,sign*3,16.1),.075,materials['naval'],supercol,vertices=6)
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
 # The approved A fit has asymmetric forward stowage: two nested port cutters,
 # a starboard captain's gig, and two lower outboard admiral's gigs.
 for yy in [4.06,6.38]:
  cutter=boat('Port cutter',5.97,yy,12.63,8.70,2.07,False,keel=12.63)
  boat('Nested port longboat',6.0,yy,13.54,6.31,1.65,False,keel=13.54,support_surface=SupportSurface(list(cutter)))
 boat('Starboard captain gig',6.31,-3.88,12.39,9.21,2.56,True,keel=12.39)
 for sign in [-1,1]:
  boat('Admiral gig',6.85,sign*9.30,10.83,11.14,2.67,True,keel=10.83)
  boat('Outer aft motor launch',-21.95,sign*6.86,11.6,11.54,3.00,True,keel=11.60)
  boat('Inner aft motor launch',-19.56,sign*2.91,13.59,11.54,3.00,True,yaw=-sign*math.radians(13.846),keel=13.59)
def truss(name,a,b,width,depth):
 a,b=Vector(a),Vector(b);axis=(b-a).normalized();side=axis.cross(Vector((0,0,1))).normalized()*width/2;up=axis.cross(side).normalized()*depth/2
 corners=[side+up,-side+up,-side-up,side-up]
 for j in range(4):rod(name+' end cross member',b+corners[j],b+corners[(j+1)%4],.055,materials['edge'],detailcol,vertices=8)
 for offset in corners:rod(name+' chord',a+offset,b+offset,.055,materials['edge'],detailcol,vertices=8)
 bays=max(3,math.ceil((b-a).length/1.6))
 for i in range(bays):
  lo=a+(b-a)*(i/bays);hi=a+(b-a)*((i+1)/bays)
  for j in range(4):
   k=(j+1)%4;rod(name+' cross member',lo+corners[j],lo+corners[k],.035,materials['naval'],detailcol,vertices=6)
   rod(name+' diagonal',lo+corners[j if i%2==0 else k],hi+corners[k if i%2==0 else j],.03,materials['naval'],detailcol,vertices=6)
def cranes_and_catapult():
 for sign in [-1,1]:
  base=Vector((-6.5,sign*9.7,8.4));heel=base+Vector((0,0,2.2));tip=Vector((7.2,sign*6.6,22.0))
  cyl('Aircraft crane foundation',base+Vector((0,0,.28)),1.05,.56,materials['edge'],detailcol,32)
  cyl('Aircraft crane pedestal',base+Vector((0,0,1.4)),.78,2.45,materials['naval'],detailcol,32)
  cyl('Aircraft crane bearing',heel,1.04,.27,materials['edge'],detailcol,32)
  box('Aircraft crane winch housing',heel+Vector((-.65,0,.75)),(2.4,1.7,1.55),materials['naval'],detailcol)
  box('Aircraft crane operator window',heel+Vector((-.4,sign*.862,.94)),(1.1,.035,.55),materials['glass'],detailcol)
  truss('Aircraft crane lattice boom',heel,tip,.95,1.05)
  rod('Crane tip sheave axle',tip+Vector((0,-.55,0)),tip+Vector((0,.55,0)),.09,materials['edge'],detailcol,vertices=10)
  apex=heel+Vector((-.9,0,4.5));truss('Aircraft crane kingpost',heel+Vector((-1,0,.5)),apex,.65,.65)
  rod('Crane kingpost cable pin',apex+Vector((0,-.36,0)),apex+Vector((0,.36,0)),.09,materials['edge'],detailcol,vertices=10)
  for off in [-.28,.28]:
   rod('Crane topping cable',apex+Vector((0,off,0)),tip+Vector((0,off,0)),.021,materials['dark'],detailcol,vertices=6)
   rod('Crane hoisting cable',heel+Vector((-.6,off,1.8)),tip+Vector((0,off,-.13)),.018,materials['dark'],detailcol,vertices=5)
  rod('Crane suspended cable',tip,tip-Vector((0,0,1.85)),.024,materials['dark'],detailcol,vertices=6)
  ring('Crane sheave',tip,(0,1,0),.19,.045,materials['edge'],16)
  ring('Crane hook',tip-Vector((0,0,1.98)),(0,1,0),.14,.035,materials['edge'],12)
  ladder('Crane pedestal access',base+Vector((-.88,0,.1)),heel+Vector((-.88,0,.5)),.48)
 # Transverse catapult with two rails, open web and launch trolley.
 catapult_before=set(bpy.data.objects)
 for xx in [-9.9,-8.2]:
  rod('Catapult longitudinal rail',(xx,-14,6.82),(xx,14,6.82),.09,materials['light'],detailcol,vertices=8)
  box('Catapult girder',(xx,0,6.43),(.17,28,.48),materials['edge'],detailcol)
  for yy in [-13+i*1.3 for i in range(21)]:
   rod('Catapult web',(xx,yy-.58,6.23),(xx,yy+.58,6.69),.04,materials['naval'],detailcol,vertices=6)
 for yy in [-13.5,-9,-4.5,0,4.5,9,13.5]:box('Catapult sleeper',(-9.05,yy,6.45),(2.18,.22,.22),materials['naval'],detailcol)
 box('Catapult trolley',(-9.05,0,7.0),(2.35,2.3,.24),materials['roof'],detailcol)
 for yy in [-.9,.9]:
  for xx in [-9.9,-8.2]:rod('Trolley wheel',(xx-.10,yy,6.92),(xx+.10,yy,6.92),.20,materials['edge'],detailcol,vertices=16)

 for ob in set(bpy.data.objects)-catapult_before:ob.location.z+=2.65
