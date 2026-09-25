"""Decks and hull fittings: planking and rails, ground tackle, hull-side details, aircraft deck, screws and rudders.

Every hull-dependent position derives from deck(x), breadth(x) and loft_breadth so the
fittings follow later loft refits. Repeated small parts are merged into one mesh each
(Batch) and rails are single swept tubes: a rod per span costs caps and draw calls.
"""
import bmesh
from yamato_kit import *


class Batch:
 # One mesh for many repeated pieces; bars omit caps where they enter a surface.
 def __init__(s):s.v=[];s.f=[]
 def add(s,v,f):
  o=len(s.v);s.v+=[tuple(p) for p in v];s.f+=[tuple(i+o for i in q) for q in f]
 def bar(s,a,b,r,sides=4,r2=None,cap=False):
  a,b=Vector(a),Vector(b);n,m=frame(b-a);v=[]
  for p,rr in ((a,r),(b,r if r2 is None else r2)):
   v+=[p+(n*math.cos((k+.5)*math.tau/sides)+m*math.sin((k+.5)*math.tau/sides))*rr for k in range(sides)]
  f=[(k,(k+1)%sides,(k+1)%sides+sides,k+sides) for k in range(sides)]
  if cap:f+=[tuple(reversed(range(sides))),tuple(range(sides,2*sides))]
  s.add(v,f)
 def disc(s,c,normal,r,sides=6):
  n,m=frame(Vector(normal));c=Vector(c)
  s.add([c+(n*math.cos(k*math.tau/sides)+m*math.sin(k*math.tau/sides))*r for k in range(sides)],[tuple(range(sides))])
 def post(s,x,y,z,r,h,sides=8):
  # Upright cylinder with a top only; its foot is buried in whatever it stands on.
  s.add([(x+r*math.cos(k*math.tau/sides),y+r*math.sin(k*math.tau/sides),zz) for zz in (z-.05,z+h) for k in range(sides)],
   [(k,(k+1)%sides,(k+1)%sides+sides,k+sides) for k in range(sides)]+[tuple(range(sides,2*sides))])
 def block(s,c,dim,yaw=0):
  cx,cy,cz=c;a,b,h=[d/2 for d in dim];cs,sn=math.cos(yaw),math.sin(yaw)
  s.add([(cx+x*cs-y*sn,cy+x*sn+y*cs,cz+z) for z in (-h,h) for x,y in ((-a,-b),(a,-b),(a,b),(-a,b))],
   [(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
 def emit(s,name,material,col,smooth=False):
  if not s.v:return None
  o=mesh(name,s.v,s.f,material,col,smooth);bm=bmesh.new();bm.from_mesh(o.data)
  bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();return o


def frame(t):
 t=Vector(t).normalized();n=t.cross(Vector((0,0,1)))
 if n.length<1e-4:n=Vector((1,0,0))
 n.normalize();return n,t.cross(n)


def tube(name,pts,r,material,col,sides=3):
 # A continuous swept rail or wire: one ring per sample instead of a rod per span.
 v=[];f=[];pts=[Vector(p) for p in pts]
 for i,p in enumerate(pts):
  n,m=frame(pts[min(i+1,len(pts)-1)]-pts[max(i-1,0)])
  v+=[p+(n*math.cos((k+.5)*math.tau/sides)+m*math.sin((k+.5)*math.tau/sides))*r for k in range(sides)]
 for i in range(len(pts)-1):
  f+=[(i*sides+k,i*sides+(k+1)%sides,(i+1)*sides+(k+1)%sides,(i+1)*sides+k) for k in range(sides)]
 return mesh(name,v,f,material,col)


def lathe(name,x,y,z,profile,material,col,sides=16):
 # Radius/height profile revolved about a vertical axis, closed on top.
 v=[(x+r*math.cos(k*math.tau/sides),y+r*math.sin(k*math.tau/sides),z+h) for r,h in profile for k in range(sides)]
 f=[(j*sides+k,j*sides+(k+1)%sides,(j+1)*sides+(k+1)%sides,(j+1)*sides+k) for j in range(len(profile)-1) for k in range(sides)]
 return mesh(name,v,f+[tuple(range((len(profile)-1)*sides,len(profile)*sides))],material,col)


def strip(batch,pts,width,height):
 # Flush deck strip (rail track or seam) that follows the deck: top and both sides.
 for a,b in zip(pts,pts[1:]):
  a,b=Vector(a),Vector(b);n,_=frame(b-a);n=Vector((n.x,n.y,0)).normalized()*width/2
  batch.add([a-n,b-n,b+n,a+n,a-n+Vector((0,0,height)),b-n+Vector((0,0,height)),b+n+Vector((0,0,height)),a+n+Vector((0,0,height))],[(4,5,6,7),(0,1,5,4),(2,3,7,6)])


def on_deck(points,lift=0,step=2.0):
 # Resample a plan polyline and lift it onto the deck.
 out=[]
 for (xa,ya),(xb,yb) in zip(points,points[1:]):
  n=max(1,math.ceil(math.hypot(xb-xa,yb-ya)/step))
  out+=[(xa+(xb-xa)*i/n,ya+(yb-ya)*i/n) for i in range(n)]
 out.append(points[-1]);return [(x,y,deck(x)+lift) for x,y in out]


def side_point(x,z,side,out=0):
 return Vector((x,side*(loft_breadth(H,x,z)+out),z))


def chain(batch,pts,z_of,link=.56,width=.34,bar=.048):
 # Alternate flat and upright oval links, each a six-bar ring, laid along a plan path.
 pts=[Vector((x,y,0)) for x,y in pts];lengths=[(b-a).length for a,b in zip(pts,pts[1:])]
 pitch=link*.74;n=int(sum(lengths)/pitch)
 for i in range(n):
  s=i*pitch;j=0
  while j<len(lengths)-1 and s>lengths[j]:s-=lengths[j];j+=1
  t=(pts[j+1]-pts[j]).normalized();c=pts[j]+t*min(s,lengths[j]);side,_=frame(t)
  up=Vector((0,0,1)) if i%2 else side;c.z=z_of(c.x)+(width/2 if i%2 else bar)
  ring=[c+t*math.cos(k*math.tau/6)*link/2+up*math.sin(k*math.tau/6)*width/2 for k in range(6)]
  for a,b in zip(ring,ring[1:]+ring[:1]):batch.bar(a,b,bar,3)


def bottom(x):
 # Centreline underside of the loft; keelHeights is the gameplay keel, not the fine run aft.
 st=x+L/2;S=H['sections']
 for a,b in zip(S,S[1:]):
  if a['station']<=st<=b['station']:
   t=(st-a['station'])/(b['station']-a['station']);return a['points'][0][1]*(1-t)+b['points'][0][1]*t
 return S[-1]['points'][0][1]


def inside(x,y,z,margin=.5):
 return z>bottom(x)+.05 and z<deck(x) and loft_breadth(H,x,z)>abs(y)+margin


def lens(pieces,t_left,t_right,name,material,col):
 # Convex x-z outlines with a thickness per vertex (number or function of x), each fanned from its centre.
 th=lambda t,x:t(x) if callable(t) else t;v=[];fs=[]
 for pts in pieces:
  n=len(pts);o=len(v)
  v+=[(x,-th(t_right,x),z) for x,z in pts]+[(x,th(t_left,x),z) for x,z in pts]
  cx=sum(x for x,z in pts)/n;cz=sum(z for x,z in pts)/n;v+=[(cx,-th(t_right,cx),cz),(cx,th(t_left,cx),cz)]
  fs+=[tuple(o+k for k in f) for f in [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]+[(2*n,(i+1)%n,i) for i in range(n)]+[(2*n+1,n+i,n+(i+1)%n) for i in range(n)]]
 o=mesh(name,v,fs,material,col);bm=bmesh.new();bm.from_mesh(o.data)
 bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();return o


def build():
 hull=next(o for o in HULL.objects if o.get('nodeId')=='hull.surface')
 support=SupportSurface([hull])
 # Deck planks are an original material; steel strips and ends are separate meshes.
 for sa,sb in zip(stations,stations[1:]):
  a,b=sa-L/2,sb-L/2;wa,wb=breadth(a),breadth(b);za,zb=deck(a)+.035,deck(b)+.035
  material=teak if -69<(a+b)/2<85 else roof
  mesh('Deck surface',[(a,-wa,za),(b,-wb,zb),(b,wb,zb),(a,wa,za)],[(0,1,2,3)],material,DECK)
  for side in (-1,1):
   mesh('Steel deck margin',[(a,side*wa,za+.02),(b,side*wb,zb+.02),(b,side*max(0,wb-.55),zb+.02),(a,side*max(0,wa-.55),za+.02)],[(0,1,2,3)],roof,DECK)

 # Guard rails round the whole weather deck. Runs break at the quarterdeck step and
 # where the catapult sponsons and the bow crest bulwark take the deck edge.
 xs=[];last=None
 for s in stations:
  x=s-L/2
  if x>L/2-3.2:break
  if last is None or x-last>=2 or abs(deck(x)-deck(last))>.25 or abs(breadth(x)-breadth(last))>.5:xs.append(x);last=x
 xs.append(L/2-3.2);gaps=[(-117.4,-112.8)]
 runs=[[]]
 for x in xs:
  if any(a<x<b for a,b in gaps) or (runs[-1] and abs(deck(x)-deck(runs[-1][-1]))>1.2):
   if runs[-1]:runs.append([])
   if any(a<x<b for a,b in gaps):continue
  runs[-1].append(x)
 stanchions=Batch()
 for run in [r for r in runs if len(r)>1]:
  for side in (-1,1):
   line=[(x,side*max(0,breadth(x)-.15),deck(x)+.035) for x in run]
   for h in (.45,.95):tube('Deck guard wire',[(x,y,z+h) for x,y,z in line],.016,wire,DECK)
   # The gunwale bar reads the deck edge from the side, as in the reference.
   tube('Deck-edge gunwale bar',[(x,side*(breadth(x)+.04),deck(x)-.08) for x in run],.1,hullgray,HULL,4)
   d=0
   for (xa,ya,za),(xb,yb,zb) in zip(line,line[1:]):
    seg=math.dist((xa,ya),(xb,yb))
    while d<=seg:
     t=d/seg if seg else 0;p=(xa+(xb-xa)*t,ya+(yb-ya)*t,za+(zb-za)*t);stanchions.bar(p,(p[0],p[1],p[2]+.97),.028,3);d+=2.2
    d-=seg
 stanchions.emit('Rail stanchion',edge,DECK)

 # Forecastle ground tackle. Plan positions follow the pjsb018 forecastle; heights ride the sheer.
 links=Batch();fittings=Batch()
 for side in (-1,1):
  wx,wy=94.6,side*3.0;z=deck(wx)
  rounded('Windlass bed plate',wx+1.3,side*2.35,z,4.2,1.9,.12,roof,DECK,cut=.45)
  lathe('Windlass gypsy',wx,wy,z+.1,[(1.12,0),(1.12,.14),(.92,.18),(.92,.56),(1.02,.6),(1.02,.7),(.55,.78),(.35,.95)],naval,DECK,20)
  rod('Windlass brake wheel',(wx-.2,side*4.25,z+.62),(wx-.2,side*4.37,z+.62),.42,edge,DECK,vertices=14)
  rod('Windlass brake shaft',(wx-.2,side*3.9,z+.62),(wx-.2,side*4.3,z+.62),.09,edge,DECK,vertices=8)
  # The cable comes off the gypsy to the navel pipe that leads down to the locker.
  lathe('Chain pipe',97.6,side*1.5,deck(97.6),[(.45,-.05),(.45,.22),(.32,.26)],hullgray,DECK,14)
  chain(links,[(wx+.2,side*2.1),(97.4,side*1.62)],lambda x:deck(x)+.02)
  # Working cable: out over the gypsy, in to the bridle, out through the stopper to the hawse.
  path=[(wx+.5,side*3.95),(104.75,side*4.1),(110.9,side*3.05),(119.0,side*4.1),(123.9,side*4.0)]
  chain(links,path,lambda x:deck(x)+.02)
  box('Chain stopper',(119.35,side*4.0,deck(119.35)+.3),(.7,.55,.42),naval,DECK)
  for dy in (-1.3,1.1):
   fittings.bar((119.3,side*4.0,deck(119.3)+.3),(117.2,side*(4.0+dy),deck(117.2)+.08),.04,4)
   fittings.post(117.2,side*(4.0+dy),deck(117.2),.1,.12,6)
  # Oval hawse bell mouth on deck; its dark throat takes the cable.
  hx,hy=124.6,side*4.0;o=[];i=[]
  for k in range(14):
   a=k*math.tau/14;x=hx+1.45*math.cos(a);y=hy+.62*math.sin(a);o.append((x,y,deck(x)+.16));o.append((x,y,deck(x)-.08))
   x=hx+.85*math.cos(a);y=hy+.28*math.sin(a);i.append((x,y,deck(x)+.3));i.append((x,y,deck(x)+.14))
  f=[]
  for k in range(14):
   j=(k+1)%14;f+=[(2*k,2*j,2*j+1,2*k+1),(28+2*k+1,28+2*j+1,28+2*j,28+2*k),(2*k,28+2*k,28+2*j,2*j)]
  mesh('Hawse bell mouth',o+i,f,hullgray,DECK)
  mesh('Hawse throat',[i[2*k+1] for k in range(14)],[tuple(range(14))],dark,DECK)
  # Stowed stockless bower anchor lying on the bow flare below its hull hawse.
  top=side_point(125.8,8.72,side,.12);crown=side_point(126.5,7.55,side,.28)
  rod('Hawse hull lip',top-Vector((0,side*.12,0)),top+Vector((0,side*.1,0)),.44,hullgray,DECK,vertices=14)
  rod('Anchor shank',top,crown,.15,edge,DECK,vertices=8)
  rod('Anchor crown',crown-Vector((.75,0,0)),crown+Vector((.75,0,0)),.2,edge,DECK,vertices=8)
  for dx in (-1,1):
   base=crown+Vector((dx*.72,0,0));tip=side_point(126.5+dx*1.25,8.45,side,.2);root=side_point(126.5+dx*.55,7.95,side,.22)
   mesh('Anchor fluke',[tuple(base),tuple(tip),tuple(root),tuple(base+Vector((0,side*.16,0))),tuple(tip+Vector((0,side*.1,0))),tuple(root+Vector((0,side*.14,0)))],
    [(0,1,2),(5,4,3),(0,3,4,1),(1,4,5,2),(2,5,3,0)],edge,DECK)
  # Roller fairleads and closed chocks on the deck edge; leadsman platforms at the bow.
  for x in (117.96,):
   y=side*(breadth(x)-.3);z=deck(x)
   box('Roller fairlead base',(x,y,z+.06),(1.13,.6,.12),roof,DECK)
   for dx in (-.3,.3):cyl('Roller fairlead roller',(x+dx,y,z+.37),.15,.55,edge,DECK,12)
   box('Roller fairlead cheek',(x,y+side*.25,z+.3),(1.0,.06,.5),naval,DECK)
  for x in (110.0,113.1,86.0,73.0,40.0,-60.0,-84.0,-108.0,-126.0):
   y=side*(breadth(x)-.3);z=deck(x)
   fittings.block((x,y,z+.1),(1.0,.36,.2))
   for dx in (-.34,.34):fittings.bar((x+dx,y,z+.15),(x+dx*.75,y,z+.55),.1,5,r2=.07,cap=True)
  x=127.3;y=side*(breadth(x)-.4);z=deck(x)
  box('Leadsman platform',(x,y,z+.1),(1.16,1.25,.1),roof,DECK)
  tube('Leadsman platform rail',[(x-.55,y-side*.3,z+.15),(x-.55,y+side*.6,z+1.0),(x+.55,y+side*.6,z+1.0),(x+.55,y-side*.3,z+.15)],.025,edge,DECK,4)
  fittings.bar((x,y+side*.55,z+.05),side_point(x,z-1.1,side,.02),.05,4)

 # Bollard pairs: deck-edge pairs, the centre pair at the stem and the stern pairs.
 bollards=Batch();beds=Batch()
 pairs=[(105.15,6.1),(121.9,1.1),(64.2,None),(47.0,None),(-57.0,None),(-78.0,None),(-110.95,5.0),(-120.55,7.5)]
 for x,y0 in pairs:
  for side in (-1,1):
   y=side*(y0 if y0 else breadth(x)-2.2);z=deck(x)
   beds.block((x,y,z+.07),(2.4,.9,.14))
   for dx in (-.7,.7):bollards.post(x+dx,y,z+.1,.27,.72,10);bollards.post(x+dx,y,z+.78,.34,.08,10)
 bollards.emit('Mooring bollard',edge,DECK);beds.emit('Bollard bed',roof,DECK)
 fittings.emit('Deck-edge chock',edge,DECK);links.emit('Bower anchor chain',edge,DECK)
 tube('Chain cable bridle',[(110.9,-3.0,deck(110.9)+.1),(110.9,3.0,deck(110.9)+.1)],.05,edge,DECK,4)

 # Centre capstan on its raised plate, the forecastle companion house and the deck strip.
 rounded('Capstan deck plate',102.6,-.8,deck(102.6),4.5,4.4,.06,roof,DECK,cut=.25)
 lathe('Forecastle capstan',102.6,-.8,deck(102.6)+.06,[(.95,0),(.95,.16),(.62,.2),(.55,.55),(.66,.8),(.66,.95),(.3,1.02)],naval,DECK,16)
 z=deck(89.9);rounded('Forecastle companion house',89.9,-1.6,z,2.25,3.8,1.75,naval,DECK,cut=.15)
 box('Forecastle companion house roof',(89.9,-1.6,z+1.8),(2.45,4.0,.1),roof,DECK)
 box('Forecastle companion door',(91.04,-1.6,z+.85),(.08,.9,1.6),edge,DECK)
 box('Forecastle companion window',(91.04,-2.85,z+1.25),(.06,.8,.5),glass,DECK)
 rounded('Deck access hatch',88.3,4.1,deck(88.3),1.6,1.0,.18,roof,DECK)
 # pjsb018 has no tall breakwater here, only a low steel strip in a flat chevron.
 w=breadth(88.1)-.1;strip_b=Batch()
 strip(strip_b,on_deck([(88.1,-w),(90,-5.25),(90,5.25),(88.1,w)],0,1.0),.12,.18);strip_b.emit('Forecastle deck strip',naval,DECK)
 rod('Jack staff',(130,0,deck(130)),(130,0,deck(130)+4.5),.065,edge,MAST,r2=.035,vertices=8)
 rod('Jack staff',(-130.6,0,deck(-130.6)),(-132.0,0,deck(-130.6)+10.0),.08,edge,MAST,r2=.04,vertices=8)

 # Scattered deck gear kept from the earlier fit, now with light geometry.
 for side in (-1,1):
  for x in (-60,-52,-43,-31,-17,12,23,61):
   y=side*min(10,breadth(x)-1.6);z=deck(x)
   rounded('Ventilator',x,y,z,1.3,.9,.8,naval,DECK)
   box('Ventilator grille',(x+.66,y,z+.5),(.025,.72,.42),dark,DECK)
  for x in (59,76,-57,-75):
   y=side*min(12,breadth(x)-2);z=deck(x)
   for dy in (-.62,.62):box('Mooring line reel foot',(x,y+dy,z+.36),(.16,.12,.72),naval,DECK)
   rod('Mooring line reel drum',(x,y-.58,z+.72),(x,y+.58,z+.72),.44,canvas,DECK,vertices=12)
   for dy in (-.58,.58):rod('Mooring line reel cheek',(x,y+dy-.03,z+.72),(x,y+dy+.03,z+.72),.6,naval,DECK,vertices=12)
  x=-62;z=deck(x)
  rounded('Companionway coaming',x,side*3.0,z,1.5,1.1,1.3,naval,DECK)
  box('Deck trunk access leaf',(x,side*3.57,z+.65),(.7,.06,1.1),edge,DECK)
 for x,y in [(87,0),(58,-5),(58,5),(-57,6),(-59,-6),(20,9)]:rounded('Deck access hatch',x,y,deck(x)-.02,2.1,1.3,.26,roof,DECK)

 # Hull sides: belt-top and plating strakes, risers, boom crutches, scuttles, footholds and life buoys.
 risers=Batch();scuttles=Batch()
 sheer=[(-70,2.9),(-54,4.8),(-30,5.9),(0,6.0),(24,5.2),(36,4.7),(60,4.85),(82,5.5),(100,6.4),(111,7.3)]
 for side in (-1,1):
  tube('Side plating strake',[side_point(x,interp(sheer,x),side,.02) for x in range(-70,112,3)],.07,hullgray,HULL,4)
  tube('Belt top strake',[side_point(x,3.15,side,.02) for x in range(-66,67,4)],.07,hullgray,HULL,4)
  for x in (-51.8,-35.5,-29.5,-18.7,-7.9,4.4,16.3,24.2,34.0,46.0):
   top=min(4.8,interp(sheer,x)-.4)
   risers.bar(side_point(x,.8,side,.05),side_point(x,top,side,.05),.13,4,cap=True)
  for x in (-91.9,-76.2,62.0):risers.bar(side_point(x,.75,side,.05),side_point(x,2.1,side,.05),.13,4,cap=True)
  for x in (-55,-47,-39,4,12,32,43,70,79,87):
   z=deck(x);a=side_point(x,z-.25,side,.03);b=side_point(x,z-1.25,side,.35)
   risers.bar(a,b,.06,4);risers.bar(b,side_point(x+1.4,z-1.1,side,.3),.06,4)
  for i in range(92):
   x=-119+i*2.65;z=min(deck(x)-1.45,5.9)
   if -74<x<62 and i%3:continue
   if loft_breadth(H,x,z)<1:continue
   p=side_point(x,z,side,.015);scuttles.disc(p,(0,side,0),.13,6)
  for xf,n in ((115.4,18),(-118.2,14)):
   for k in range(n):
    z=deck(xf)-.6-k*.28;p=side_point(xf,z,side,.1);risers.bar(p-Vector((.18,0,0)),p+Vector((.18,0,0)),.025,3)
  for x,z in ((75.31,7.93),(-82.47,3.29)):
   c=side_point(x,min(z,deck(x)-.7),side,.1);ring=[c+Vector((math.cos(k*math.tau/10)*.38,0,math.sin(k*math.tau/10)*.38)) for k in range(11)]
   tube('Life buoy',ring,.075,canvas,HULL,4)
 # The quarterdeck rubbing strake wraps round the stern at one height to the recess.
 wrap=[side_point(x,5.25,1,.02) for x in range(-104,-131,-2)]
 wrap=wrap+[Vector((-L/2+.35,0,5.25))]+[Vector((p.x,-p.y,p.z)) for p in reversed(wrap)]
 tube('Quarterdeck rubbing strake',wrap,.09,hullgray,HULL,4)
 risers.emit('Hull side fitting',edge,HULL);scuttles.emit('Hull scuttle',glass,HULL)

 # Aft recess under the overhanging deck edge: inclined knees carry the overhang.
 knees=Batch()
 for side in (-1,1):
  for i in range(22):
   x=-103+i*1.55;edge_y=breadth(x);z=deck(x);wall=loft_breadth(H,x,z-2.4)
   if edge_y-wall<1.2:continue
   knees.bar((x,side*(wall-.05),z-2.4),(x,side*(edge_y-.3),z-.12),.07,4)
 knees.emit('Deck overhang knee',naval,AFT)

 # Stern aircraft deck: Type 2 catapults on sponson pedestals, the centreline crane,
 # the hangar well and flush transfer rails, all following the quarterdeck step.
 upper=deck(-110);quarter=deck(-120)
 for side in (-1,1):
  px,py=-115.1,side*10.3;top=upper+.15
  lathe('Catapult pedestal',px,py,quarter-.9,[(.18,0),(1.75,2.25),(1.75,top-quarter+.9)],naval,AFT,24)
  cyl('Catapult turntable',(px,py,top+.12),1.7,.25,roof,AFT,24)
  a=Vector((-122.1,side*9.75,top+.25));b=Vector((-102.5,side*11.45,top+.25));t=(b-a).normalized();n=Vector((-t.y,t.x,0))
  lattice=Batch();zt=1.5
  for u in (-1,1):
   for h in (0,zt):tube('Catapult longeron',[a+n*u*.9+Vector((0,0,h)),b+n*u*.7+Vector((0,0,h))],.07,edge,AFT,4)
  for k in range(13):
   p=a.lerp(b,k/12);q=a.lerp(b,(k+1)/12);w=.9-.2*k/12;wq=.9-.2*(k+1)/12
   for u in (-1,1):
    lattice.bar(p+n*u*w,p+n*u*w+Vector((0,0,zt)),.045,4)
    if k<12:lattice.bar(p+n*u*w,q+n*u*wq+Vector((0,0,zt)),.04,4)
   lattice.bar(p-n*w,p+n*w,.04,4)
  lattice.emit('Catapult lattice',edge,AFT)
  yaw=math.atan2(t.y,t.x);c=a.lerp(b,.5)+Vector((0,0,zt+.05))
  deckplate=box('Catapult track deck',tuple(c),((b-a).length,1.5,.1),roof,AFT);deckplate.rotation_euler.z=yaw
  for u in (-.35,.35):
   r=box('Catapult track rail',tuple(c+n*u+Vector((0,0,.1))),((b-a).length,.12,.1),edge,AFT);r.rotation_euler.z=yaw
  sled=a.lerp(b,.3)+Vector((0,0,zt+.35));o=box('Catapult carriage',tuple(sled),(2.2,1.1,.5),naval,AFT);o.rotation_euler.z=yaw
  rod('Catapult launching cylinder',a.lerp(b,.12)+Vector((0,0,zt+.35)),a.lerp(b,.42)+Vector((0,0,zt+.35)),.26,naval,AFT,vertices=10)
  f=a.lerp(b,.4)+Vector((0,0,zt))
  for u in (-1,1):rod('Catapult A-frame',f+n*u*.7,f+Vector((0,0,2.0)),.07,edge,AFT,vertices=6)
  # The forward end rests on a deck trestle over the upper deck.
  e=a.lerp(b,.93);rounded('Catapult forward rest',e.x,e.y,deck(e.x),1.2,1.6,top+.25-deck(e.x),naval,AFT,cut=.3)
  # Stair from the quarterdeck to the catapult sponson.
  sa,sb=Vector((-118.7,side*7.5,quarter)),Vector((-115.9,side*8.9,top))
  Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),fm,AFT).stairs('Catapult access stair',sa,sb,.8)
  # The shared stair's handrails need their stanchions.
  sn=Vector((-(sb-sa).y,(sb-sa).x,0)).normalized()*.4;posts=Batch()
  for p in (sa,sa.lerp(sb,.5),sb):
   for u in (-1,1):posts.bar(p+sn*u,p+sn*u+Vector((0,0,.92)),.025,4)
  posts.emit('Catapult access stair stanchion',edge,AFT)
  # Life-buoy boxes and deck trestle rails.
  x=-118.0;y=side*(breadth(x)-.75);z=deck(x)
  rounded('Life-buoy box',x,y,z,1.2,1.1,1.45,naval,AFT,cut=.12)
  ring=[Vector((x+math.cos(k*math.tau/10)*.4,y+side*.58,z+.8+math.sin(k*math.tau/10)*.4)) for k in range(11)]
  tube('Life buoy',ring,.075,canvas,AFT,4)
  x,y=(-88.3,13.0) if side>0 else (-93.5,-12.4);z=deck(x);tr=Batch()
  for dx in (-1.4,1.4):
   for dy in (-.6,.6):tr.bar((x+dx,y+dy,z),(x+dx,y+dy,z+1.25),.05,4)
   tr.bar((x+dx,y-.6,z),(x+dx,y+.6,z+1.25),.04,4);tr.bar((x+dx,y+.6,z),(x+dx,y-.6,z+1.25),.04,4)
  for dy in (-.6,.6):tr.bar((x-1.45,y+dy,z+1.25),(x+1.45,y+dy,z+1.25),.06,4)
  tr.emit('Aircraft deck rail trestle',edge,AFT)
  # Stern anchor stowed against the hangar side.
  # Below the hangar's set-in upper side, on the full-breadth hull.
  x=-110.2;top=side_point(x,6.55,side,.2);crown=side_point(x,4.35,side,.3)
  rod('Stern anchor hawse',top-Vector((0,side*.15,0)),top+Vector((0,side*.08,0)),.4,hullgray,AFT,vertices=12)
  rod('Stern anchor shackle',top+Vector((0,side*.1,-.45)),top+Vector((0,side*.1,.2)),.09,edge,AFT,vertices=6)
  rod('Stern anchor shank',top+Vector((0,side*.1,-.35)),crown,.14,edge,AFT,r2=.2,vertices=8)
  o=box('Stern anchor crown',tuple(crown),(1.5,.34,.42),edge,AFT)
  for dx in (-1,1):
   b0=crown+Vector((dx*.7,0,-.1));tip=side_point(x+dx*.95,5.5,side,.28)
   mesh('Stern anchor fluke',[tuple(b0+Vector((0,-.14,0))),tuple(b0+Vector((0,.14,0))),tuple(tip+Vector((0,.1,0))),tuple(tip+Vector((0,-.1,0))),tuple(b0+Vector((-dx*.45,0,.1)))],
    [(0,1,2,3),(0,4,1),(1,4,2),(2,4,3),(3,4,0)],edge,AFT)
  # Machine-gun control stations flank the well on the upper deck.
  ha_director(-103.53,side*2.94,deck(-103.53),support)
 # Crane: pedestal on the quarterdeck, jib stowed forward over the well on the centreline.
 cx=-124.3;z=deck(cx)
 lathe('Aircraft crane pedestal',cx,0,z,[(1.1,0),(1.1,.12),(.68,.6),(.62,upper-z-.1),(.9,upper-z)],naval,AFT,20)
 rounded('Crane head',cx+.1,0,upper,4.0,3.4,.45,naval,AFT,cut=.45)
 rod('Aircraft crane winch drum',(cx+.9,-1.0,upper+.8),(cx+.9,1.0,upper+.8),.36,canvas,AFT,vertices=12)
 heel=Vector((cx+1.7,0,upper+.38));tip=Vector((-102.6,-1.16,upper+1.75));t=(tip-heel).normalized();n=Vector((-t.y,t.x,0))
 jib=Batch()
 for k in range(15):
  p=heel.lerp(tip,k/14);w=.85-.65*k/14;d=1.3-.85*k/14
  if k<14:
   q=heel.lerp(tip,(k+1)/14);wq=.85-.65*(k+1)/14;dq=1.3-.85*(k+1)/14
   for u in (-1,1):jib.bar(p+n*u*w,q+n*u*wq+Vector((0,0,dq)),.04,4);jib.bar(p+n*u*w+Vector((0,0,d)),q+n*u*wq,.04,4)
  jib.bar(p-n*w,p+n*w,.035,4);jib.bar(p-n*w+Vector((0,0,d)),p+n*w+Vector((0,0,d)),.035,4)
 jib.emit('Crane boom lattice',edge,AFT)
 for u in (-1,1):
  tube('Crane boom chord',[heel+n*u*.85,tip+n*u*.2],.12,edge,AFT,4)
  tube('Crane boom upper',[heel+n*u*.85+Vector((0,0,1.3)),tip+n*u*.2+Vector((0,0,.45))],.1,edge,AFT,4)
 tail=Vector((-128.2,0,upper+1.2))
 for u in (-1,1):tube('Crane tail',[Vector((cx,u*.5,upper+.45)),tail+Vector((0,u*.3,0))],.08,edge,AFT,4)
 sheave=heel.lerp(tip,.82)+Vector((0,0,.75))
 tube('Crane hoist',[tail,sheave,tip+Vector((0,0,.2)),tip+Vector((0,0,-1.1))],.03,wire,AFT,3)
 box('Crane hook block',tuple(tip+Vector((0,0,-1.25))),(.3,.2,.35),edge,AFT)
 # Hangar well: dark opening in the upper deck and in the step face, curbs on the quarterdeck.
 z=deck(-108.9)
 mesh('Aircraft lift hatch',[(-113.4,-4.2,z+.02),(-104.4,-4.2,z+.02),(-104.4,4.2,z+.02),(-113.4,4.2,z+.02)],[(0,1,2,3)],dark,AFT)
 mesh('Hangar well opening',[(-113.52,-4.2,quarter+.05),(-113.52,4.2,quarter+.05),(-113.52,4.2,upper-.05),(-113.52,-4.2,upper-.05)],[(0,1,2,3)],dark,AFT)
 curb=Batch()
 strip(curb,[(-113.4,-4.35,z),(-104.3,-4.35,z),(-104.3,4.35,z),(-113.4,4.35,z)],.18,.32)
 for side in (-1,1):strip(curb,on_deck([(-117.5,side*4.35),(-113.6,side*4.35)],0,2),.14,.12)
 curb.emit('Hangar well coaming',naval,AFT)
 lathe('After capstan',-121.0,1.0,quarter,[(.6,0),(.6,.1),(.42,.15),(.38,.55),(.46,.72),(.2,.8)],naval,AFT,14)
 rails=Batch();tables=Batch()
 for pts in ([(-110.8,9.0),(-66.0,-8.6)],[(-110.8,-9.0),(-66.0,8.6)],[(-99.3,-13.5),(-99.3,13.5)],
  [(-102.5,11.45),(-99.3,11.85),(-66,14.0)],[(-102.5,-11.45),(-99.3,-11.85),(-66,-14.0)],
  [(-126.0,5.1),(-113.8,5.9)],[(-126.0,-5.1),(-113.8,-5.9)],[(-125.0,6.6),(-114.8,8.2)],[(-125.0,-6.6),(-114.8,-8.2)]):
  # Each transfer track is a pair of rails.
  for off in (-.2,.2):
   (xa,ya),(xb,yb)=pts[0],pts[-1];l=math.hypot(xb-xa,yb-ya);nx,ny=-(yb-ya)/l*off,(xb-xa)/l*off
   strip(rails,on_deck([(x+nx,y+ny) for x,y in pts],0,2),.1,.06)
 for x,y in ((-99.3,11.85),(-99.3,-11.85),(-99.3,4.1),(-99.3,-4.1),(-88.1,0)):
  tables.add([(x+1.25*math.cos(k*math.tau/16),y+1.25*math.sin(k*math.tau/16),deck(x)+.04) for k in range(16)],[tuple(range(16))])
 rails.emit('Aircraft transfer rail',edge,AFT);tables.emit('Aircraft rail turntable',roof,AFT)

 # Underwater: centreline skeg, four screws on struts, tandem rudders and bilge keels.
 # The skeg runs aft of the fine V run: a deep fin ahead of the auxiliary rudder and
 # an arched fin between the rudders; the upper edge is buried in the loft.
 lens([[(-94,-10.4),(-104.4,-10.4)]+[(x,bottom(x)+.5) for x in (-104.4,-103,-101.5,-100,-98,-96,-94)],
  [(-111,-6.35),(-112.5,-6.25),(-116,-6.6),(-118.9,-7.3)]+[(x,bottom(x)+.5) for x in (-118.9,-117,-115,-113,-111)]],.3,.3,'Centreline skeg',red,UNDER)
 for side in (-1,1):
  for prop_index,(ex,yy,zz) in enumerate([(-100.01,10.94,-7.31),(-111.43,3.85,-7.39)]):
   yy*=side;tag=f'propeller-{"port" if side>0 else "starboard"}-{"outer" if prop_index==0 else "inner"}'
   # The shaft runs forward until it is buried in the hull's run.
   sx=ex+2
   while sx<ex+40 and not inside(sx,yy,zz+.02*(sx-ex)):sx+=1
   rod('Propeller shaft',(ex+1.4,yy,zz),(sx,yy,zz+.02*(sx-ex)),.34,edge,UNDER,vertices=12)
   rod('Shaft bossing',(sx-4,yy,zz+.02*(sx-ex-4)),(sx+.5,yy,zz+.02*(sx-ex+.5)),.34,hullgray,UNDER,r2=.75,vertices=12)
   # Streamlined A-bracket: an upright palm into the hull and an inboard leg to the skeg.
   bx=ex+2.3;p=Vector((bx,yy,zz+.05))
   up=support.along(p+Vector((0,0,.4)),(0,0,1),20);rod('Shaft support',p,up+Vector((0,0,.3)),.24,hullgray,UNDER,r2=.3,vertices=8)
   rod('Shaft support',p,support.along(p,(0,-side,1),25)+Vector((0,side*.2,.2)),.2,hullgray,UNDER,vertices=8)
   rod('Screw hub',(ex-1.1,yy,zz),(ex+1.4,yy,zz),.59,bronze,UNDER,r2=.28,vertices=14)
   # Kure Museum gives 5 m diameter. Rounded, pitched blades are independently
   # authored from the museum's stern view, with opposite handedness port/stbd.
   for k in range(3):
    a=k*math.tau/3+(.2 if side<0 else 0);v=[];fs=[];rows=12;cols=7
    for i in range(rows):
     t=i/(rows-1);rad=.4+2.1*t
     half_angle=.13+.42*math.sin(math.pi*t)**.7
     if i==rows-1:half_angle=0
     for j in range(cols):
      u=2*j/(cols-1)-1;theta=a+side*(.26*t+u*half_angle)
      v.append((ex+.18*t+side*u*(.45-.2*t)*math.sin(math.pi*t)**.5,yy+math.cos(theta)*rad,zz+math.sin(theta)*rad))
    for i in range(rows-1):
     for j in range(cols-1):
      q=i*cols+j;fs.append((q,q+1,q+1+cols,q+cols))
    o=mesh('Five metre three-bladed screw',v,fs,bronze,UNDER,True);o['assemblyId']=tag
    mod=o.modifiers.new('Cast blade thickness','SOLIDIFY');mod.thickness=.055
 # Balanced rudders in the pjsb018 profile: the main blade has a forward heel below
 # the skeg arch; each is two convex lens-section pieces with its stock into the hull.
 for name,pieces,stock_x in [
  ('Main rudder',[[(-124.75,-2.9),(-121.3,-2.8),(-119.2,-3.75),(-119.2,-7.0),(-124.6,-7.0)],[(-124.6,-7.0),(-115.75,-7.0),(-115.75,-9.1),(-116.2,-9.45),(-124.2,-9.45),(-124.6,-9.05)]],-121.2),
  ('Auxiliary rudder',[[(-108.5,-5.95),(-104.75,-5.95),(-104.75,-9.2),(-105.1,-9.5),(-108.2,-9.5),(-108.5,-9.1)]],-105.6)]:
  lead=max(x for p in pieces for x,z in p);trail=min(x for p in pieces for x,z in p)
  # Foil section: thickest a third back from the leading edge, thin at the trailing edge.
  foil=lambda x:.1+.32*math.sin(math.pi*min(1,(x-trail)/(lead-trail)*1.4))**.6
  o=lens(pieces,foil,foil,name,red,UNDER);o['assemblyId']=name.lower().replace(' ','-')
  ztop=max(z for p in pieces for x,z in p)
  stock=rod(name+' stock',(stock_x,0,ztop-.6),(stock_x,0,max(ztop,bottom(stock_x))+1.2),.26,hullgray,UNDER,vertices=12)
  stock['assemblyId']=name.lower().replace(' ','-')
 # Bilge keels ride the turn of the bilge along the loft, tapering at each end.
 for side in (-1,1):
  v=[];xs=list(range(-66,46,4))
  for i,x in enumerate(xs):
   w=min(1,(i+.5)/2,(len(xs)-i-.5)/2)*1.1;root=side_point(x,-8.1,side,-.05)
   v+=[tuple(root),tuple(root+Vector((0,side*.62*w,-.78*w)))]
  fs=[(2*i,2*i+2,2*i+3,2*i+1) for i in range(len(xs)-1)]
  o=mesh('Bilge keel',v,fs,red,UNDER);mod=o.modifiers.new('Plate thickness','SOLIDIFY');mod.thickness=.05
