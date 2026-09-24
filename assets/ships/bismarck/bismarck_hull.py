"""Hull loft, deck fittings, mooring and anchor gear, scuttles, rails, staffs and underwater appendages."""
from bismarck_kit import *
def loft():
 # Closed original hull with a separate material boundary on the weather deck.
 sections=H['sections'];vs=[];fs=[];n=2*len(sections[0]['points'])-1
 for section in sections:
  s=section['station'];pts=section['points'];outline=pts+[[-w,z] for w,z in reversed(pts[1:])];vs.extend((s-H['length']/2,w,z) for w,z in outline)
 for i in range(len(sections)-1):
  for j in range(n):fs.append((i*n+j,i*n+(j+1)%n,(i+1)*n+(j+1)%n,(i+1)*n+j))
 ob=mesh('Independently lofted hull',vs,fs,None,hullcol,True);ob['nodeId']='hull.surface';ob['assemblyId']='hull'
 for k in ['hullgray','oxide','boot','deck']:ob.data.materials.append(materials[k])
 for i,p in enumerate(ob.data.polygons):
  p.material_index=3 if i%n==len(sections[0]['points'])-1 else 1 if p.center.z<-1.3 else 2 if p.center.z<.1 else 0
  if p.material_index==3:p.use_smooth=False
 bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.000001);bmesh.ops.dissolve_degenerate(bm,edges=list(bm.edges),dist=.000001);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free();ob.data.update()
def staffs():
 # Stern flagstaff, bow jackstaff and rigged stern boat-handling derrick.
 for x,top in [(-123,15.5),(124,11.5)]:rod('Ensign or jack staff',(x,0,deckz(x)),(x-.3,0,top),.08,materials['edge'],detailcol,.025,10)
def deck_fittings(aa_support):
 # Mooring machinery, proper stockless anchors, hatch coamings and hull scuttles.
 def bollard(name,x,y,z):
  box(name+' sole',(x,y,z+.06),(1.35,.58,.12),materials['edge'],detailcol)
  for dx in [-.42,.42]:
   cyl(name+' post',(x+dx,y,z+.4),.18,.66,materials['edge'],detailcol,16)
   cyl(name+' head',(x+dx,y,z+.75),.24,.12,materials['naval'],detailcol,16)
 def capstan(name,x,y,z,r=.58):
  cyl(name+' foundation',(x,y,z+.12),r*1.4,.24,materials['naval'],detailcol,24)
  cyl(name+' drum',(x,y,z+.55),r*.72,.76,materials['edge'],detailcol,24)
  for zz in [.25,.68,.94]:cyl(name+' flange',(x,y,z+zz),r,.12,materials['edge'],detailcol,28)
  cyl(name+' crown',(x,y,z+1.05),r*.78,.12,materials['light'],detailcol,24)
 for sign in [-1,1]:
  for x in [-119,-108,-93,-61,54,91,108,120]:
   yy=sign*(width(x)-1.25);bollard('Double mooring bitt',x,yy,deckz(x)+.005)
   # Rolled oval fairlead at the sheer, separate from the inboard bitt.
   p=Vector((x+.9,sign*(width(x+.9)-.16),deckz(x+.9)+.4));ring('Deck edge fairlead',p,(0,1,0),.27,.09,materials['edge'],18)
  for x in [99.5,107.5]:capstan('Anchor windlass',x,sign*2.7,deckz(x)+.08,.66)
  # Paired chains lead across deck to the side hawse fittings. Interlocked rings
  # are confined to visible anchor runs to keep the playable mesh budget bounded.
  start=Vector((99.5,sign*2.7,deckz(99.5)+.23));end=Vector((119,sign*3.0,deckz(119)+.18));axis=(end-start).normalized()
  for i in range(66):
   p=start+(end-start)*(i/65);normal=Vector((0,0,1)) if i%2==0 else Vector((0,1,0));ring('Anchor chain link',p,normal,.12,.032,materials['dark'],10)
  for xx in [102,114]:box('Chain stopper',(xx,sign*2.9,deckz(xx)+.26),(.56,.6,.38),materials['edge'],detailcol)
  x=117.2;zz=deckz(x)-1.5;yy=sign*(side_width(x,zz)+.09)
  rod('Hawse recess',(x,yy,zz),(x,yy+sign*.025,zz),.53,materials['dark'],detailcol,vertices=24)
  ring('Hawse steel rim',(x,yy+sign*.04,zz),(0,sign,0),.55,.11,materials['naval'],24)
  rod('Anchor shank',(x,yy+sign*.25,zz-.12),(x-.65,yy+sign*.29,zz-2.50),.13,materials['edge'],detailcol,vertices=12)
  crown=Vector((x-.65,yy+sign*.29,zz-2.45));rod('Anchor crown',crown+Vector((-.62,0,0)),crown+Vector((.62,0,0)),.19,materials['edge'],detailcol,vertices=12)
  for dx in [-1,1]:
   a=crown+Vector((dx*.48,0,0));b=crown+Vector((dx*1.03,sign*.22,.98));rod('Anchor arm',a,b,.16,materials['edge'],detailcol,.11,10)
   verts=[tuple(b+Vector((u,v,w))) for u,v,w in [(-.3,-.16,0),(.3,-.16,0),(.18,.17,.55),(-.18,.17,.55),(-.3,-.05,0),(.3,-.05,0),(.18,.24,.55),(-.18,.24,.55)]]
   mesh('Anchor fluke',verts,[(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)],materials['edge'],detailcol)
  capstan('After mooring capstan',-111,sign*2.4,deckz(-111)+.005,.47)
  # Two rows follow the actual loft surface, avoiding detached square scuttles.
  for x in range(-107,112,3):
   for z in [2.7,4.63]:
    if abs(x)<85 and z<3.0:continue
    if width(x)<2:continue
    yy=sign*(side_width(x,z)+.034);porthole('Hull round scuttle',(x,yy,z),(0,sign,0),.145)
  # Deck edge rails interpolate the blueprint sheer at every original station.
  pts=[(x,sign*(width(x)-.22),deckz(x)+.035) for x in [-122.5+i*2 for i in range(123)] if width(x)>.5]
  rail('Weather deck safety rail',pts,.98,2.0,False)
  # Subtle rubbing strip, much thinner than the silhouette-defining hull.
  pts=[(x,sign*(side_width(x,deckz(x)-.32)+.024),deckz(x)-.32) for x in range(-120,123,2)]
  polyline('Sheer strake edge',pts,.028,materials['edge'],vertices=5)
 for x,y in [(83,0),(91,0),(112,0),(120,0),(-91,0),(-101,0),(-115,0),(57,8),(57,-8),(-64,8),(-64,-8),(1,14),(1,-14),(-47,12),(-47,-12)]:hatch('Weather deck hatch',x,y,deckz(x)+.005,1.35,.95)
 for sign in [-1,1]:
  for x in [-103,-87,-52,48,61,86,113]:
   y=sign*min(width(x)-2.2,7.8);z=deckz(x)
   cyl('Mushroom vent stem',(x,y,z+.32),.18,.64,materials['naval'],detailcol,16)
   cyl('Mushroom vent hood',(x,y,z+.69),.34,.22,materials['naval'],detailcol,20)
  for x,y,z in [(30,9,9.4),(6,13,5.8),(-14,13,5.8),(-40,9.5,5.8),(-53,8.5,5.8)]:
   y*=sign;z=aa_support.below(x,y,z+3);box('Ready ammunition locker',(x,y,z+.62),(1.05,.64,1.24),materials['naval'],detailcol)
   box('Ammunition locker lid',(x,y,z+1.28),(1.1,.69,.08),materials['roof'],detailcol)
   rod('Locker handle',(x-.12,y+sign*.34,z+.8),(x+.12,y+sign*.34,z+.8),.022,materials['dark'],detailcol,vertices=6)
  for x,y,z in [(-42,7.9,9.4)]:
   y*=sign;z=aa_support.below(x,y,z+4)+.09;pts=[(xx,yy,z+.3) for xx,yy in rounded_rect(x,y,2.55,1.28,.56,5)];polyline('Carley float buoyant tube',pts,.17,materials['canvas'],closed=True,vertices=8)
   for xx in [-.85,-.45,0,.45,.85]:rod('Carley float floor',(x+xx,y-.52,z+.22),(x+xx,y+.52,z+.22),.033,materials['wood'],detailcol,vertices=6)
   for xx in [-.75,.75]:box('Carley float cradle',(x+xx,y,z+.025),(.12,1.12,.22),materials['edge'],detailcol)
  for x,y in [(80,5),(-97,5)]:
   y*=sign;z=deckz(x)+.55
   rod('Hose reel axle',(x,y-.55,z),(x,y+.55,z),.11,materials['edge'],detailcol,vertices=12)
   for yy in [-.38,.38]:rod('Hose reel flange',(x,y+yy-.035,z),(x,y+yy+.035,z),.53,materials['edge'],detailcol,vertices=24)
   rod('Hose drum',(x,y-.34,z),(x,y+.34,z),.37,materials['rope'],detailcol,vertices=24)
   for yy in [-.45,.45]:box('Reel support',(x,y+yy,z-.30),(.18,.12,.55),materials['naval'],detailcol)
def underwater():
 # Original three-bladed screws: broad paddle outlines, reduced rake, helical
 # pitch and thick roots into rounded bosses. Silhouettes were reviewed against
 # approved GameModels3D pgsb708 A_Hull; the source loading datum is unverified.
 # These visual shafts do not move the blueprint's machinery or combat sockets.
 def screw_boss(x,y,z):
  rows=[(1.16,.30),(.83,.59),(.34,.73),(-.34,.72),(-.85,.61),(-1.18,.39),(-1.34,.08)]
  vs=[(x+dx,y+r*math.cos(math.tau*i/32),z+r*math.sin(math.tau*i/32)) for dx,r in rows for i in range(32)]
  fs=[tuple(reversed(range(32))),tuple(range((len(rows)-1)*32,len(rows)*32))]
  fs.extend((j*32+i,j*32+(i+1)%32,(j+1)*32+(i+1)%32,(j+1)*32+i) for j in range(len(rows)-1) for i in range(32))
  return mesh('Propeller boss',vs,[tuple(reversed(f)) for f in fs],materials['bronze'],undercol,True)
 def shaft_bracket(name,a,b,chord=.72):
  # Closed foil strut: a wide axial chord and a narrow rounded trailing edge.
  a,b=Vector(a),Vector(b);radial=(b-a).normalized();side=radial.cross(Vector((1,0,0))).normalized()
  profile=[(-.52,0),(-.36,.10),(.16,.12),(.48,.04),(.54,0),(.48,-.04),(.16,-.12),(-.36,-.10)]
  vs=[p+Vector((u*chord,0,0))+side*v for p in [a,b] for u,v in profile];n=len(profile)
  fs=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
  return mesh(name,vs,[tuple(reversed(f)) for f in fs],materials['oxide'],undercol,True)
 for y,xend in [(-6,-100),(0,-106),(6,-100)]:
  z=-6.8
  rod('Propeller shaft',(-69,y,-6.0),(xend+.6,y,z),.24,materials['edge'],undercol,vertices=24)
  rod('Shaft stern bearing',(xend+2.15,y,z+.08),(xend+.80,y,z+.02),.43,materials['oxide'],undercol,.36,24)
  screw_boss(xend,y,z)
  # Bearing struts penetrate the actual lofted counter, including the center
  # installation. Their upper feet are sampled from the hull, not free points.
  for sign in [-1,1]:
   bx=xend+2.1;by=y+sign*1.15;profile=section_at(bx);hits=[]
   for (wa,za),(wb,zb) in zip(profile,profile[1:]):
    if min(wa,wb)<=abs(by)<=max(wa,wb) and abs(wb-wa)>1e-6:hits.append(za+(zb-za)*(abs(by)-wa)/(wb-wa))
   foot=min(hits) if hits else -2.6
   shaft_bracket('Shaft A bracket',(bx,y,z+.05),(bx+.25,by,foot+.14),.94)
  for angle in [math.pi/2,math.pi/2+math.tau/3,math.pi/2+2*math.tau/3]:
   # Radial radius, tangential sweep, half chord. Sparse original controls are
   # interpolated for a continuous rounded edge without a pinched angular tip.
   controls=[(.55,-.08,.30),(.82,-.08,.52),(1.15,-.03,.79),(1.55,.03,1.02),(1.95,.07,1.02),(2.20,.06,.80),(2.35,.02,.44),(2.40,0,.035)]
   rows=[]
   for a,b in zip(controls,controls[1:]):
    for step in range(3):
     t=step/3;rows.append(tuple(u+(v-u)*t for u,v in zip(a,b)))
   rows.append(controls[-1]);cols=9;vs=[]
   for face in [-1,1]:
    for r,sweep,w in rows:
     pitch=math.atan2(3.6,math.tau*r)
     for i in range(cols):
      q=-1+2*i/(cols-1);chord=q*w;tangent=sweep+chord*math.cos(pitch)
      thickness=(.012+.105*(1-r/2.6))*math.sqrt(max(0,1-q*q))+.008
      axial=chord*math.sin(pitch)+.035*(r-.55)+face*thickness
      vs.append((xend+axial,y+r*math.cos(angle)-tangent*math.sin(angle),z+r*math.sin(angle)+tangent*math.cos(angle)))
   n=len(rows)*cols;fs=[]
   for face in [0,1]:
    for j in range(len(rows)-1):
     for i in range(cols-1):
      ids=(face*n+j*cols+i,face*n+j*cols+i+1,face*n+(j+1)*cols+i+1,face*n+(j+1)*cols+i);fs.append(ids if face else tuple(reversed(ids)))
   boundary=list(range(cols))+[j*cols+cols-1 for j in range(1,len(rows))]+list(range(n-2,n-cols-1,-1))+[j*cols for j in reversed(range(1,len(rows)-1))]
   fs.extend((a,b,b+n,a+n) for a,b in zip(boundary,boundary[1:]+boundary[:1]))
   blade=mesh('Twisted screw blade',vs,fs,materials['bronze'],undercol,True)
   bm=bmesh.new();bm.from_mesh(blade.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(blade.data);bm.free()
 for y in [-3,3]:
  pts=[(-113.6,y),(-112.8,y-.20),(-109.7,y-.28),(-109.0,y-.14),(-109.0,y+.14),(-109.7,y+.28),(-112.8,y+.20)]
  extrude('Foil-section balanced rudder',pts,-5.8,3.75,materials['oxide'],undercol,.06)
  rod('Rudder stock',(-110.4,y,-5.5),(-110.4,y,-1.8),.19,materials['edge'],undercol,vertices=20)
 for sign in [-1,1]:
  stations=[-49,-44,-32,-16,0,16,32,41,46];vs=[]
  for x in stations:
   z=-6.35;w=side_width(x,z);extension=.05 if x in [stations[0],stations[-1]] else .82
   vs.extend([(x,sign*w,z),(x,sign*(w+extension),z-.45),(x,sign*(w+extension),z-.52),(x,sign*w,z-.07)])
  fs=[(i*4+j,i*4+(j+1)%4,(i+1)*4+(j+1)%4,(i+1)*4+j) for i in range(len(stations)-1) for j in range(4)]+[(3,2,1,0),tuple(range((len(stations)-1)*4,len(stations)*4))]
  mesh('Closed tapered bilge keel',vs,fs,materials['oxide'],undercol)
