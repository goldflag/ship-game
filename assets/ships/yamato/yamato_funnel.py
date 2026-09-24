"""Funnel, its casing deckhouse, searchlight platforms, aft director tower, mainmast, Type 13 radar and aerials."""
from yamato_kit import *
import bmesh


def closed(o):
 bm=bmesh.new();bm.from_mesh(o.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();return o

def loft(name,rings,material,col,caps=(True,True)):
 # Closed rings of equal length, bottom to top; one mesh instead of rods.
 n=len(rings[0]);v=[p for r in rings for p in r]
 fs=[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(len(rings)-1) for i in range(n)]
 if caps[0]:fs.append(tuple(reversed(range(n))))
 if caps[1]:fs.append(tuple(range((len(rings)-1)*n,len(rings)*n)))
 return closed(mesh(name,v,fs,material,col))

def tube(name,path,radius,material,col,sides=8):
 # Swept pipe with parallel-transported frames, so bends stay round and cheap.
 path=[Vector(p) for p in path];radii=radius if isinstance(radius,list) else [radius]*len(path)
 t=[(path[min(i+1,len(path)-1)]-path[max(i-1,0)]).normalized() for i in range(len(path))]
 u=t[0].cross(Vector((0,0,1)) if abs(t[0].z)<.9 else Vector((1,0,0))).normalized();v=[]
 for i,p in enumerate(path):
  u=(u-t[i]*u.dot(t[i])).normalized();w=t[i].cross(u)
  v.extend(p+(u*math.cos(a)+w*math.sin(a))*radii[i] for a in (k*math.tau/sides for k in range(sides)))
 n=sides;fs=[(k*n+i,k*n+(i+1)%n,(k+1)*n+(i+1)%n,(k+1)*n+i) for k in range(len(path)-1) for i in range(n)]
 fs+=[tuple(reversed(range(n))),tuple(range(len(v)-n,len(v)))]
 o=mesh(name,[tuple(p) for p in v],fs,material,col)
 for f in o.data.polygons[:-2]:f.use_smooth=True
 return o

def bars(name,segments,w,material,col,h=None):
 # Square-section bars merged into one mesh: gratings, lattices and rails.
 v=[];fs=[];h=h or w
 for a,b in segments:
  a,b=Vector(a),Vector(b);d=(b-a).normalized()
  s=d.cross(Vector((0,0,1)) if abs(d.z)<.9 else Vector((1,0,0))).normalized()*w/2;up=d.cross(s).normalized()*h/2
  k=len(v);v.extend(tuple(p+q) for p in (a,b) for q in (s+up,-s+up,-s-up,s-up))
  fs.extend((k+i,k+(i+1)%4,k+4+(i+1)%4,k+4+i) for i in range(4))
 return mesh(name,v,fs,material,col)

def offset(ring,d):
 # Outward offset of a closed anticlockwise plan outline.
 out=[]
 for i,(x,y,*z) in enumerate(ring):
  a,b=ring[i-1],ring[(i+1)%len(ring)];nx,ny=b[1]-a[1],a[0]-b[0];l=math.hypot(nx,ny)
  out.append((x+nx/l*d,y+ny/l*d,*z))
 return out

def hull2(points):
 # Convex hull of plan points, anticlockwise.
 pts=sorted(set(points))
 def half(ps):
  h=[]
  for p in ps:
   while len(h)>1 and (h[-1][0]-h[-2][0])*(p[1]-h[-2][1])-(h[-1][1]-h[-2][1])*(p[0]-h[-2][0])<=0:h.pop()
   h.append(p)
  return h
 return half(pts)[:-1]+half(pts[::-1])[:-1]

def circle(x,y,r,n=24):return [(x+r*math.cos(i*math.tau/n),y+r*math.sin(i*math.tau/n)) for i in range(n)]


def build():
 fverts=S['funnel-jacket']['surface']['vertices']
 frings=[[(-z,-x,y) for x,y,z in fverts[i:i+48]] for i in range(0,len(fverts),48)]
 structure('funnel-jacket',FUNNEL)

 # Casing deckhouse under the funnel, mainmast and searchlights: 5 m a side
 # as sectioned from the reference, scalloped clear of the open 12.7 cm tubs
 # (No. 6 full height, No. 5 only above its raised tub floor).
 def arc(cx,cy,r,yf,ya,n=12):
  a0,a1=math.atan2(yf-cy,math.sqrt(r*r-(yf-cy)**2)),math.atan2(ya-cy,-math.sqrt(r*r-(ya-cy)**2))
  return [(cx+r*math.cos(a),cy+r*math.sin(a)) for a in (a0+(a1-a0)*i/n for i in range(n+1))]
 def casing_outline(port):
  port=[(-14,5.0)]+port+[(-35.4,5.4),(-35.9,4.9)];return [(x,-y) for x,y in reversed(port)]+port
 no6=arc(-31.2,6.745,3.645,5.0,5.4)
 prism('Funnel casing deckhouse',casing_outline(no6),10.75,14.3,naval,FUNNEL)
 upper=casing_outline(arc(-22.66,6.91,3.25,5.0,5.0)+no6)
 prism('Funnel casing deckhouse',upper,14.3,16.3,naval,FUNNEL)
 prism('Funnel casing deckhouse roof',upper,16.3,16.4,roof,FUNNEL)
 fit=Fittings(dict(mesh=mesh,cyl=cyl,rod=rod,box=box),fm,FUNNEL)
 for side in (-1,1):
  for x in (-21.5,-17.4):fit.vent('Funnel base air intake',x,side*5.0,12.8,2.0,1.7)

 # Lower skirt: the capsule offset 0.57 m and raked, cut by the collar plane.
 def rake(ring,z,d):return [(x-.29*(z-23.5),y,z) for x,y,_ in offset(ring,d)]
 def cut(ring,d,lift):
  return [(x-.29*(zz-23.5),y,zz) for x,y,_ in offset(ring,d) for zz in [(24.45+lift-.3014*(x+33.765))/.9126]]
 base=frings[5]
 loft('Funnel lower skirt',[rake(base,17.6,.57),cut(base,.57,0)],naval,FUNNEL)
 # Walkway collar a little above the skirt, which pipes pass behind.
 loft('Funnel walkway collar',[cut(base,.92,.55),cut(base,.92,.7)],roof,FUNNEL)
 def ring_at(z):
  r=[]
  for i in range(48):
   for a,b in zip(frings,frings[1:]):
    if a[i][2]<=z<=b[i][2]:t=(z-a[i][2])/(b[i][2]-a[i][2]);r.append((a[i][0]+(b[i][0]-a[i][0])*t,a[i][1]+(b[i][1]-a[i][1])*t,z));break
  return r
 for name,ring,z in [('Funnel shell band',ring_at,26.0),('Funnel shell band',ring_at,27.4),('Funnel skirt band',lambda z:rake(base,z,.57),19.9)]:
  lo,hi=ring(z-.06),ring(z+.06)
  loft(name,[lo,offset(lo,.04),offset(hi,.04),hi],edge,FUNNEL,(False,False))

 # Raked cap: rim lip, grating, three domed rain covers and a guard rail.
 cap=frings[-1];mesh('Funnel smoke opening',[(x,y,z-.3) for x,y,z in cap],[tuple(range(48))],dark,FUNNEL)
 loft('Funnel cap rim',[cap,offset(cap,.2),[(x,y,z-.15) for x,y,z in offset(cap,.2)],[(x,y,z-.15) for x,y,z in cap]],edge,FUNNEL,(False,False))
 zc=lambda x:29.45+.15*(x+23.3)-.1
 def half(x):
  c=min(max(x,-25.77),-20.83);return math.sqrt(max(0,1.9**2-(x-c)**2))
 g=[]
 for y in (-.9,0,.9):
  e=math.sqrt(1.9**2-y*y);g.append(((-25.77-e,y,zc(-25.77-e)),(-20.83+e,y,zc(-20.83+e))))
 for k in range(12):
  x=-27.25+k*.72;g.append(((x,-half(x),zc(x)),(x,half(x),zc(x))))
 bars('Funnel cap grating',g,.06,edge,FUNNEL,.12)
 bars('Funnel cap beam',[((x,-1.9,zc(x)),(x,1.9,zc(x))) for x in (-24.8,-22.55)],.2,naval,FUNNEL,.3)
 ribs=[]
 for x0,x1 in [(-27.3,-24.8),(-24.8,-22.55),(-22.55,-19.35)]:
  for y in (-.9,0,.9):
   p=[(x0+(x1-x0)*i/6,y,zc(x0+(x1-x0)*i/6)+.42*math.sin(math.pi*i/6)*(1-(y/2.2)**2)) for i in range(7)]
   ribs+=list(zip(p,p[1:]))
 bars('Funnel rain cover rib',ribs,.07,edge,FUNNEL)
 rail=[(x,y,z+.95) for x,y,z in offset(cap,.12)[::2]]
 tube('Funnel cap guard rail',rail+[rail[0]],.03,edge,FUNNEL,5)
 bars('Funnel cap rail stanchion',[((x,y,z),(x,y,z+.95)) for x,y,z in offset(cap,.12)[::4]],.05,edge,FUNNEL)

 # Seven external steam pipes a side rise with the rake and finish in
 # swan necks turned aft; two jog forward low down. Measured on the reference.
 for side in (-1,1):
  for x26,y,top,jog in [(-27.0,.72,27.55,None),(-26.27,1.62,28.05,None),(-24.62,2.13,27.85,None),(-22.63,2.13,28.05,None),
                        (-21.3,2.13,28.65,(24.7,25.9,.93)),(-20.1,2.05,29.2,(25.3,26.2,.35)),(-18.6,1.5,29.05,None)]:
   def at(z):
    j=0 if not jog else jog[2] if z<=jog[0] else 0 if z>=jog[1] else jog[2]*(jog[1]-z)/(jog[1]-jog[0])
    return Vector((x26-.29*(z-26.5)+j,side*y,z))
   z0=(24.45-.3014*(at(24).x+26.95))-.15;zb=z0+1.15;zn=top-.55
   zr=sorted([(z0,.2),(zn,.2)]+[(z+d,rr) for z in (zb,zn-.9) for d,rr in ((-.08,.2),(-.07,.245),(.07,.245),(.08,.2))]+[(z,.2) for z in (jog[:2] if jog else ())])
   path=[at(z) for z,_ in zr];r=[rr for _,rr in zr]
   n0=path[-1];path+=[n0+Vector((-.1,0,.25)),n0+Vector((-.3,0,.43)),n0+Vector((-.58,0,.5))];r+=[.2,.2,.25]
   tube('Funnel steam pipe',path,r,edge,FUNNEL,10)
 # One inspection ladder climbs the forward face from the collar to the cap.
 lx=lambda z:-17.1-.25*(z-23.0)
 bars('Funnel inspection ladder rung',[((lx(z),-.3,z),(lx(z),.3,z)) for z in [22.5+.3*i for i in range(25)]],.035,edge,FUNNEL)
 bars('Funnel inspection ladder stringer',[((lx(22.1),y,22.1),(lx(30.0),y,30.0)) for y in (-.3,.3)],.05,edge,FUNNEL)
 # Searchlights at the reference stations: two 150 cm lights a side on raised
 # tubs against the skirt, one forward on a bracketed tub, and a 4.5 m
 # rangefinder tower abaft them.
 def light(name,x,y,z,bearing):
  a=math.radians(bearing)
  def pt(f,s,h):return (x+f*math.cos(a)-s*math.sin(a),y+f*math.sin(a)+s*math.cos(a),z+h)
  cyl(name+' stand',(x,y,z+.38),.36,.76,naval,SUPER,16)
  rod(name+' yoke',pt(0,-1.12,.72),pt(0,1.12,.72),.1,edge,SUPER,vertices=8)
  rod(name+' casing',pt(-.62,0,1.85),pt(.56,0,1.85),.95,naval,SUPER,vertices=24)
  rod(name+' 150 cm reflector',pt(.57,0,1.85),pt(.59,0,1.85),.75,glass,SUPER,vertices=24)
  rod(name+' lamp house',pt(-.2,0,2.75),pt(-.2,0,3.0),.22,naval,SUPER,vertices=10)
  for s in (-1.12,1.12):
   rod(name+' cradle',pt(0,s,.72),pt(0,s,1.85),.09,edge,SUPER,vertices=8)
   rod(name+' axle',pt(0,s,1.85),pt(0,s*.9,1.85),.14,edge,SUPER,vertices=10)
  rod(name+' reflector horizontal brace',pt(.61,-.75,1.85),pt(.61,.75,1.85),.018,edge,SUPER,vertices=6)
  rod(name+' reflector vertical brace',pt(.61,0,1.1),pt(.61,0,2.6),.018,edge,SUPER,vertices=6)
 casing=SupportSurface([*HULL.objects,*SUPER.objects,*FUNNEL.objects])
 for side in (-1,1):
  yy=side*4.15
  for xx in (-25.15,-20.16):
   # Round tubs on goblet supports; the inboard rim meets the skirt.
   tub=circle(xx,yy,1.85,28)
   prism('Searchlight gallery deck',tub,18.9,19.05,roof,SUPER)
   perimeter_band('Searchlight gallery bulwark',tub,19.05,.8,naval,SUPER)
   cyl('Searchlight gallery support',(xx,yy,18.35),.6,1.1,naval,SUPER,24,r2=1.85)
   floor=casing.below(xx,yy,17.5)
   cyl('Searchlight lower pedestal',(xx,yy,(floor+17.82)/2),.5,17.82-floor,naval,SUPER,16,r2=.6)
  # Type 95 directors stand between the lights on trunks braced to the skirt,
  # kept above the open 12.7 cm tub below them.
  cyl('HA director trunk',(-22.66,side*3.75,19.43),.95,4.27,naval,SUPER,20)
  loft('HA director trunk bracket',[[(x,y,16.35) for x,y in circle(-22.66,side*3.05,.45,16)],[(x,y,17.3) for x,y in circle(-22.66,side*3.75,.95,16)]],naval,SUPER)
 for side in (-1,1):
  # Forward light on a bracketed tub off the deckhouse edge.
  xx,yy=-15.04,side*5.22
  cyl('Forward searchlight tub',(xx,yy,15.55),.45,1.7,naval,SUPER,20,r2=1.5)
  tub=circle(xx,yy,1.5,20)
  perimeter_band('Forward searchlight tub bulwark',tub,16.4,.8,naval,SUPER)
  # 4.5 m rangefinder drum overhanging the scallop above the 12.7 cm mount.
  xx,yy=-29.19,side*4.39
  cyl('Rangefinder tower',(xx,yy,18.25),1.4,1.9,naval,SUPER,24)
  loft('Rangefinder tower skirt',[[(x,y,16.35) for x,y in circle(xx,side*3.0,.6,16)],[(x,y,17.3) for x,y in circle(xx,yy,1.4,16)]],naval,SUPER)
  cyl('4.5 m rangefinder pedestal',(xx,yy,19.5),.75,.6,naval,SUPER,16)
  rounded('4.5 m rangefinder housing',xx,yy,19.8,1.6,1.9,1.3,naval,SUPER,.35)
  rod('4.5 m rangefinder',(xx-2.3,yy,20.65),(xx+2.3,yy,20.65),.3,naval,SUPER,vertices=12)
  for s in (-1,1):
   box('4.5 m rangefinder hood',(xx+s*2.3,yy,20.65),(.42,.72,.72),naval,SUPER)
   box('4.5 m rangefinder window',(xx+s*2.52,yy,20.65),(.04,.34,.22),glass,SUPER)
  # Seat for the raised 25 mm tub abaft it, bracketed off the casing roof.
  loft('After 25 mm platform bracket',[[(x,y,16.35) for x,y in circle(-33.6,side*3.5,.45,16)],[(x,y,17.85) for x,y in circle(-33.6,side*4.45,1.2,16)]],naval,SUPER)
  cyl('After 25 mm platform',(-33.6,side*4.45,17.95),1.2,.2,roof,SUPER,24)
 for side in (-1,1):
  for xx in (-25.15,-20.16):light('150 cm searchlight',xx,side*4.15,19.05,side*90)
  light('150 cm searchlight',-15.04,side*5.22,16.4,side*90)
 support=SupportSurface([*HULL.objects,*SUPER.objects,*FUNNEL.objects])
 for side in (-1,1):ha_director(-22.66,side*3.75,21.57,support,compact=True)

 # Aft director tower: tapered trunk, forward platform lobe carrying two
 # Type 98 sights, and the Type 98 housing with its 10 m rangefinder arms.
 rounded('Aft director foundation',-39,0,10.8,9,10,4.6,naval,SUPER)
 cyl('Aft director column',(-38.6,0,18.25),2.4,5.8,naval,SUPER,32,r2=1.95)
 lobe=hull2([p for c in [(-38.6,0,1.6),(-37.9,2.6,1.1),(-37.9,-2.6,1.1),(-36.5,0,.9)] for p in circle(*c,20)])
 loft('Aft director platform',[[(-38.4+(x+38.4)*.45,y*.45,16.4) for x,y in lobe],[(x,y,18.3) for x,y in lobe],[(x,y,21.1) for x,y in lobe]],naval,SUPER)
 prail=[(x,y,22.0) for x,y,_ in offset([(x,y,0) for x,y in lobe[::2]],-.1)]
 tube('Aft director platform rail',prail+[prail[0]],.03,edge,SUPER,5)
 bars('Aft director platform stanchion',[((x,y,21.1),(x,y,22.0)) for x,y,_ in prail[::2]],.05,edge,SUPER)
 for side in (-1,1):
  cyl('Type 98 sight pedestal',(-37.83,side*2.84,21.22),.2,.25,naval,SUPER,12)
  rounded('Type 98 sight',-37.83,side*2.84,21.34,.56,.56,.38,naval,SUPER,.4)
  box('Type 98 sight window',(-37.56,side*2.84,21.6),(.04,.36,.1),glass,SUPER)
 body=[(-36.55,-2.1),(-36.55,2.1)]+[(-39.35+2.1*math.cos(a),2.1*math.sin(a)) for a in (math.pi/2+i*math.pi/12 for i in range(13))]
 prism('Aft director upper housing',body,21.0,23.8,naval,SUPER)
 prism('Aft director housing roof',body,23.8,23.88,roof,SUPER)
 cyl('Aft fire control head',(-39.0,0,24.7),1.7,1.64,naval,SUPER,32)
 cyl('Aft fire control head dome',(-39.0,0,25.66),1.7,.28,naval,SUPER,32,r2=1.25)
 for side in (-1,1):
  rod('10 metre aft rangefinder',(-37.7,side*2.0,22.85),(-37.7,side*4.95,22.85),.52,naval,SUPER,r2=.38,vertices=16)
  box('10 metre rangefinder hood',(-37.7,side*5.25,22.85),(.8,.64,1.0),naval,SUPER)
  box('10 metre rangefinder window',(-37.28,side*5.25,22.95),(.04,.4,.3),glass,SUPER)
  a=math.radians(side*22)
  box('Director optical slit',(-39.0+1.69*math.cos(a),1.69*math.sin(a),24.95),(.12,.38,.20),glass,SUPER)
  box('Aft director port',(-36.53,side*1.0,22.75),(.06,.8,.7),glass,SUPER)
 rail=[(x,y,24.8) for x,y,_ in offset([(x,y,0) for x,y in body],-.1)]
 tube('Aft director guard rail',rail+[rail[0]],.03,edge,SUPER,5)
 bars('Aft director rail stanchion',[((x,y,23.88),(x,y,24.8)) for x,y,_ in rail[::2]],.05,edge,SUPER)
 for side in (-1,1):ha_director(-38.85,side*6.24,15.07,support)

 # Mainmast: a single pole raked aft from a stepped foot on the deckhouse,
 # a pair of lattice outriggers spread aft as the signal yard, W trusses,
 # a lamp platform and twin Type 13 ladders beside the pole.
 foot=[(-31.1,16.35),(-28.75,16.35),(-29.4,18.7),(-31.1,18.7)]
 closed(mesh('Mainmast foot house',[(x,y,z) for y in (-1.5,1.5) for x,z in foot],[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],naval,MAST))
 rod('Mainmast post',(-31.2,0,18.6),(-31.2,0,22.85),.23,edge,MAST,vertices=12)
 for side in (-1,1):rod('Mainmast side post',(-30.5,side*1.1,18.6),(-30.95,side*.35,22.9),.14,edge,MAST,vertices=8)
 closed(mesh('Mainmast step',[(x,y,z) for y in (-.55,.55) for x,z in [(-31.55,22.75),(-30.3,22.75),(-30.55,23.7),(-31.4,23.7)]],[(0,1,2,3),(7,6,5,4),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],edge,MAST))
 pole=lambda z:(-31.0-.306*(z-23.5),0,z)
 rod('Mainmast pole',pole(23.5),pole(42.5),.24,edge,MAST,r2=.13,vertices=12)
 rod('Masthead truck',pole(42.5),pole(42.8),.1,edge,MAST,vertices=8)
 cyl('Masthead lamp',pole(42.89),.1,.18,glass,MAST,8)
 cyl('Running light',(pole(42.18)[0]+.17,0,42.18),.07,.18,glass,MAST,8)
 arm=lambda z,s,o=0:(-31.4-.803*(z-24)+o,s*(.35+.46*(z-24)),z)
 lat=[]
 for side in (-1,1):
  rod('Signal outrigger',arm(23.8,side),arm(38.95,side),.17,edge,MAST,r2=.12,vertices=8)
  rod('Signal outrigger chord',arm(25,side,.35),arm(38.6,side,.3),.08,edge,MAST,vertices=6)
  zs=[25+i*1.36 for i in range(11)]
  lat+=[(arm(a,side,.33),arm(b,side)) for a,b in zip(zs,zs[1:])]
  lat+=[(arm(28.9,side),pole(31.8)),(pole(31.8),arm(35.0,side)),(arm(35.1,side),pole(35.1))]
  cyl('Signal outrigger lamp',(*arm(38.95,side)[:2],39.1),.1,.3,glass,MAST,8)
 bars('Mainmast truss',lat,.09,edge,MAST)
 rounded('Signal lamp platform',-32.05,0,25.15,2.3,5.3,.15,roof,MAST,.25)
 bars('Signal lamp platform rail',[((x,s*2.6,25.3),(x,s*2.6,26.2)) for x in (-33.1,-32.05,-31.0) for s in (-1,1)]+[((-33.1,s*2.6,26.2),(-31.0,s*2.6,26.2)) for s in (-1,1)],.04,edge,MAST)
 for side in (-1,1):
  cyl('Signal lamp stand',(-32.27,side*.6,25.75),.08,.9,edge,MAST,8)
  rod('Signal lamp',(-32.55,side*.6,26.48),(-31.95,side*.6,26.48),.3,naval,MAST,vertices=12)
  cyl('Signal lamp small',(-35.38,side*1.26,28.94),.07,.18,glass,MAST,8)
  rod('Signal lamp small bracket',(-35.38,side*1.26,28.85),arm(28.85,side),.03,edge,MAST,vertices=5)
  # Type 13 air-search ladders: two side by side on the platform, stayed to the pole.
  y0,y1=side*.5,side*2.5;xx=-31.35;rungs=[25.5+i*.44 for i in range(11)]
  g=[((xx+f,y,25.3),(xx+f,y,30.0)) for y in (y0,y1) for f in (-.33,.33)]+[((xx+f,y0,z),(xx+f,y1,z)) for z in rungs for f in (-.33,.33)]
  for i,(a,b) in enumerate(zip(rungs,rungs[1:])):
   lo,hi=(y0,y1) if i%2 else (y1,y0);f0,f1=(-.33,.33) if i%2 else (.33,-.33)
   g+=[((xx+f,lo,a),(xx+f,hi,b)) for f in (-.33,.33)]+[((xx+f0,y,a),(xx+f1,y,b)) for y in (y0,y1)]
  bars('Type 13 aerial',g,.06,edge,MAST)
  rod('Type 13 mounting arm',pole(29.9),(xx,side*1.5,29.9),.06,edge,MAST,vertices=8)
  rod('Type 13 mounting arm',pole(29.9),(xx,y1,29.9),.05,edge,MAST,vertices=6)
 for side in (-1,1):
  tip=arm(38.9,side)
  for dst in [(-38.4,side*3.0,21.1),(-40.4,side*1.6,23.88)]:rod('Signal halyard',tip,dst,.015,wire,MAST,vertices=5)
  rod('Aerial wire',tip,(-128,side*2,10.5),.018,wire,MAST,vertices=5)
 for a,b in [(pole(42.4),(-1.76,0,39.4)),((-1.76,0,39.4),(128,0,12.0))]:rod('Aerial wire',a,b,.018,wire,MAST,vertices=5)
