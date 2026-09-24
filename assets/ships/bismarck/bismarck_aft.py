"""Aft superstructure after the approved pgsb708 A fit: battery and control decks, the searchlight tower at the
mainmast foot (two searchlights in railed tubs, the 3 m night rangefinder GF 7 on top), the mainmast with its
pillared platform, lookout, crosstree, W/T spreader and gaff, the director house with the 10.5 m aft director,
the after night rangefinder tower (GF 9), 3.7 cm enclosures and tubs, 2 cm seatings, Carley floats, lockers,
ladders and the aerials to the foremast. The reference has no stern derrick.

Authored in the true blueprint frame: runtime (x, y, z) is Blender (-z, -x, y); W() converts a point and
plan() a footprint. Positions come from plan and profile sections of the reference, not from its meshes."""
from bismarck_kit import *
def W(x,y,z):return (-z,-x,y)
def plan(pts):return [(-z,-x) for x,z in pts]
def ring_pts(x,z,r,n,y=0):return [W(x+r*math.sin(math.tau*i/n),y,z+r*math.cos(math.tau*i/n)) for i in range(n)]
MAST_Z,TOWER_Z,DIRECTOR_Z,GF9_Z=20.72,27.2,36.92,47.21
M={m['id']:m for m in DEF['mounts']}
# These AA mounts stand on seats, enclosures and tubs built here; the seat carries the mount's assembly ID,
# so it is the gun's bearing interface rather than an obstacle for its sweep.
OWN=[f'{side}-aa-{n}' for side in ['starboard','port'] for n in ['37-3','37-4','20-4','20-5','20-6']]
own_foundations.update(OWN)
landmarks['mainmast-top']=W(0,52.15,20.47)
landmarks['aft-director']=W(0,17.1,DIRECTOR_Z)

# ---- small shared pieces -------------------------------------------------------------------------------------
def obox(name,c,n,w,h,d,mat,col=None):
 # A box whose local x is the wall normal n (Blender), w across the wall, h tall and d deep.
 ob=box(name,tuple(c),(d,w,h),mat,col or detailcol);ob.rotation_euler.z=math.atan2(n[1],n[0]);return ob
def grille(name,c,n,w,h):
 c=Vector(c);n=Vector(n).normalized();k=max(3,round(h/.15))
 obox(name+' frame',c+n*.03,n,w,h,.07,materials['naval'])
 obox(name+' dark recess',c+n*.066,n,w*.86,h*.82,.01,materials['dark'])
 for i in range(k):obox(name+' louvre',c+n*.08+Vector((0,0,-h*.36+i*h*.72/(k-1))),n,w*.9,.045,.05,materials['edge'])
def wall_door(name,c,n,w=.76,h=1.72):
 # c is the sill centre on the wall face.
 c=Vector(c);n=Vector(n).normalized();side=n.cross(Vector((0,0,1))).normalized()
 obox(name+' frame',c+n*.03+Vector((0,0,h/2)),n,w+.12,h+.1,.07,materials['edge'])
 obox(name+' panel',c+n*.075+Vector((0,0,h/2)),n,w,h,.04,materials['naval'])
 for dz in [.34,h-.34]:obox(name+' hinge',c+n*.1+side*(-w*.46)+Vector((0,0,dz)),n,.13,.13,.05,materials['edge'])
 ring(name+' dogging wheel',c+n*.12+side*(w*.2)+Vector((0,0,h*.53)),n,.1,.014,materials['edge'],10)
def window(name,c,n,w=.42,h=.42):
 c=Vector(c);n=Vector(n).normalized()
 obox(name+' frame',c+n*.02,n,w+.1,h+.1,.05,materials['edge'])
 obox(name+' glazing',c+n*.047,n,w,h,.01,materials['glass'])
def ladder_on(name,a,b,side,width=.44,step=.3,col=None):
 # Two rails and square rungs; side is the rung direction (Blender).
 a,b=Vector(a),Vector(b);side=Vector(side).normalized()*width/2;col=col or detailcol
 for s in [-1,1]:rod(name+' rail',a+side*s,b+side*s,.03,materials['light'],col,vertices=6)
 k=max(1,round((b-a).length/step))
 for i in range(1,k):
  p=a+(b-a)*(i/k);rod(name+' rung',p-side,p+side,.02,materials['edge'],col,vertices=4)
def bulwark(name,pts,h,col=None,thick=.045,rim=True,stiff=0):
 # A plate along an open polyline of Blender base points, solidified, with a rolled rim.
 col=col or supercol;n=len(pts)
 ob=mesh(name,[tuple(p) for p in pts]+[(x,y,z+h) for x,y,z in pts],[(i,i+1,n+i+1,n+i) for i in range(n-1)],materials['naval'],col)
 mod=ob.modifiers.new('Fabricated plate thickness','SOLIDIFY');mod.thickness=thick;mod.offset=0
 if rim:polyline(name+' rolled rim',[(x,y,z+h) for x,y,z in pts],.028,materials['edge'],col,False,5)
 if stiff:
  for a,b in zip(pts,pts[1:]):
   a,b=Vector(a),Vector(b);k=int((b-a).length/stiff)
   for i in range(k):
    p=a+(b-a)*((i+.5)/k);rod(name+' stiffener',p,p+Vector((0,0,h-.04)),.022,materials['edge'],col,vertices=4)
 return ob
def seat(mid,x,z,y0,y1,r=.55):
 # Training seat under a mount; it belongs to the mount's assembly (its bearing interface).
 ob=cyl(M[mid]['name']+' training seat',W(x,(y0+y1)/2,z),r,max(.02,y1-y0),materials['roof'],detailcol,20);ob['assemblyId']=mid;return ob
def locker(name,x,y,z,sx,sy,sz,yaw=0):
 # Ready-use box: sx across (runtime x), sz fore and aft, sy tall; standing on y.
 ob=box(name,W(x,y+sy/2,z),(sz,sx,sy),materials['naval'],detailcol);ob.rotation_euler.z=yaw
 lid=box(name+' lid',W(x,y+sy+.02,z),(sz+.05,sx+.05,.04),materials['edge'],detailcol);lid.rotation_euler.z=yaw
def lifebuoy(name,xwall,sign,y,z):
 # On a side wall at runtime x = xwall, facing outboard (sign 1 is starboard).
 ring(name,W(xwall+sign*.09,y,z),(0,-sign,0),.3,.07,materials['light'],14)
 rod(name+' hook',W(xwall,y+.34,z),W(xwall+sign*.12,y+.34,z),.02,materials['edge'],detailcol,vertices=4)
def carley_stack(name,x,z,y,layers=3):
 # Stowed floats: flat rounded buoyancy frames with slatted bottoms, two oars on top.
 for i in range(layers):
  yy=y+i*.47
  extrude(name+' float',plan([(x+xx,z+zz) for xx,zz in rounded_rect(0,0,1.84,1.78,.42,2)]),yy,.42,materials['canvas'],detailcol,.02)
  extrude(name+' grating',plan([(x+xx,z+zz) for xx,zz in rounded_rect(0,0,1.1,1.05,.1,1)]),yy+.42,.012,materials['wood'],detailcol)
 for dx in [-.28,.28]:rod(name+' oar',W(x+dx,y+layers*.47+.03,z-.85),W(x+dx,y+layers*.47+.03,z+.85),.03,materials['wood'],detailcol,vertices=5)
def night_rangefinder(name,x,z,base,axis):
 # Original compact 3 m night rangefinder (pgsb708 gf004): pedestal, saddle, transverse tube, end casings.
 cyl(name+' sole',W(x,base+.03,z),.46,.06,materials['edge'],detailcol,16)
 rod(name+' pedestal',W(x,base+.06,z),W(x,axis-.4,z),.2,materials['naval'],detailcol,.15,12)
 box(name+' saddle',W(x,axis-.33,z),(.5,.9,.14),materials['naval'],detailcol)
 rod(name+' optical tube',W(x-1.79,axis,z),W(x+1.79,axis,z),.17,materials['naval'],detailcol,vertices=16)
 box(name+' instrument body',W(x,axis-.1,z+.17),(.73,1.06,.49),materials['naval'],detailcol)
 for s in [-1,1]:
  box(name+' end casing',W(x+s*1.55,axis,z),(.54,.23,.39),materials['naval'],detailcol)
  rod(name+' objective',W(x+s*1.55,axis,z-.27),W(x+s*1.55,axis,z-.3),.1,materials['glass'],detailcol,vertices=10)
  rod(name+' collar',W(x+s*.62,axis,z),W(x+s*.74,axis,z),.21,materials['edge'],detailcol,vertices=12)
  rod(name+' eyepiece',W(x+s*.2,axis+.1,z+.42),W(x+s*.2,axis+.13,z+.56),.05,materials['dark'],detailcol,vertices=8)
 ring(name+' training handwheel',W(x+.45,axis-.28,z+.3),(0,-1,0),.13,.016,materials['edge'],10)

# ---- blueprint structures, drawn here instead of the generic blocks -------------------------------------------
def shell(s,top_mat=None,lower=0.0,bevel=.035,mat=None):
 pts=plan(s['footprint']);z0=s['baseY'];z1=z0+s['height']-lower
 ob=extrude(s['name'],pts,z0,z1-z0,materials[mat or s['material']],supercol,bevel)
 ob['assemblyId']='superstructure-'+s['id']
 if top_mat:
  ob.data.materials.append(materials[top_mat]);ob.data.polygons[1].material_index=1
 return ob,pts,z0,z1
def deck_edge(s,pts,z):polyline(s['id']+' deck edge',[(x,y,z+.012) for x,y in pts],.03,materials['roof'],supercol,True,6)
def side_point(pts,z,sign,y):
 # Runtime z station on the starboard (sign 1) or port wall: Blender point and outward normal.
 yy,normal=house_side(pts,-z,-sign);return Vector((-z,yy,y)),normal
def draw_battery_deck(s):
 # Teak-decked battery deckhouse; its footprint already matches the reference 02-level trace.
 ob,pts,z0,z1=shell(s,'deck');deck_edge(s,pts,z1)
 for sign in [1,-1]:
  for z in [27.6,30.9,38.6,41.8,43.3]:
   p,n=side_point(pts,z,sign,9.62);porthole('aft-battery-deck scuttle',p+n*.05,n,.16)
  for z,w,h in [(40.85,.62,.5),(42.6,.42,.42)]:
   p,n=side_point(pts,z,sign,9.62);grille('Aft battery deck ventilation grille',p,n,w,h)
  # Large louvred intake on the chamfered after corner, inside the 3.7 cm tub.
  p,n=side_point(pts,46.7,sign,9.5);grille('Aft battery deck after intake',p,n,2.6,1.6)
  p,n=side_point(pts,26.4,sign,z0+.05);wall_door('Aft battery deck door',p,n)
  lifebuoy('Aft battery deck lifebuoy',sign*8.05,sign,9.75,36.4 if sign<0 else 37.06)
  # Inclined ladder from the 01 deck, rising inboard between z 39.24 and 39.89.
  a,b=Vector(W(sign*9.4,8.36,39.56)),Vector(W(sign*8.08,10.66,39.56));ladder_on('Aft battery deck side ladder',a,b,(1,0,0),.62,.27,supercol)
  for zz in [39.25,39.87]:
   rod('Aft side ladder handrail',W(sign*9.4,9.3,zz),W(sign*8.1,11.55,zz),.022,materials['edge'],supercol,vertices=5)
   for xx,y0,y1 in [(9.4,8.36,9.32),(8.1,10.66,11.57)]:rod('Aft side ladder handrail post',W(sign*xx,y0,zz),W(sign*xx,y1,zz),.022,materials['edge'],supercol,vertices=5)
 # After face beside the rangefinder tower.
 for sign in [1,-1]:wall_door('Aft battery deck after door',Vector(W(sign*2.55,z0+.05,48.2)),Vector((-1,0,0)),.7,1.7)
def draw_control_deck(s):
 # The deck plate sits 2 cm under the blueprint top so the 2 cm guns' seats are their only bearing.
 ob,pts,z0,z1=shell(s,'deck',lower=.02);deck_edge(s,pts,z1)
 for sign in [1,-1]:
  for z,w,h in [(38.55,1.2,1.25),(31.45,1.0,1.0)]:
   p,n=side_point(pts,z,sign,11.75);grille('Aft control deck louvred ventilator',p,n,w,h)
  for z in [29.25,29.85,30.45]:
   p,n=side_point(pts,z,sign,11.95);window('Aft control deck square port',p,n,.34,.34)
  for z in [35.6,40.3]:
   p,n=side_point(pts,z,sign,11.85);porthole('aft-control-deck scuttle',p+n*.05,n,.15)
  p,n=side_point(pts,33.0,sign,z0+.05);wall_door('Aft control deck door',p,n)
def draw_director_platform(s):
 # Steel director platform on the control deck, fenced by a curved splinter bulwark round its front and wings.
 pts=plan(s['footprint'])
 ob=extrude(s['name'],pts,s['baseY'],s['height'],materials['roof'],supercol,.02);ob['assemblyId']='superstructure-'+s['id']
 top=s['baseY']+s['height']
 half=[(4.3,37.45),(4.41,37.23),(4.41,35.74),(4.51,35.6),(4.77,35.42),(4.89,35.23),(4.89,34.62),(4.77,34.42),(4.55,34.22),(4.2,34.16),(3.8,34.08),(2.85,33.97),(2.2,33.88),(1.1,33.8)]
 line=half+[(0,33.77)]+[(-x,z) for x,z in reversed(half)]
 bulwark('Aft director splinter bulwark',[W(x*.985,top,z+.015) for x,z in line],1.25,stiff=1.3)
 # Brackets carry the wing overhangs from the control deck wall.
 for sign in [1,-1]:
  for z in [34.45,35.3]:rod('Director platform wing bracket',W(sign*4.75,s['baseY']-.02,z),W(sign*4.07,s['baseY']-1.0,z),.06,materials['naval'],supercol,vertices=6)
def draw_director_house(s):
 ob,pts,z0,z1=shell(s)
 polyline(s['id']+' roof edge',[(x,y,z1+.01) for x,y in pts],.03,materials['edge'],supercol,True,6)
 for sign in [1,-1]:
  p,n=side_point(pts,38.3,sign,14.35);porthole('aft-director-house scuttle',p+n*.05,n,.15)
  p,n=side_point(pts,39.6,sign,13.95);grille('Director house vent',p,n,.45,.4)
 wall_door('Director house after door',Vector(W(-.62,z0+.02,40.9)),Vector((-1,0,0)),.7,1.65)
 ladder_on('Director house after ladder',W(.78,z0+.15,40.94),W(.78,z1+.9,40.94),(0,1,0),.44)
 rail('Director house roof',[W(.55,z1+.01,40.9),W(1.0,z1+.01,40.82),W(1.55,z1+.01,40.65)],.85,.9,False)
def draw_tower_base(s):
 # Searchlight tower base block between the hangar and the control deck; searchlight tubs over its ends.
 ob,pts,z0,z1=shell(s,'roof');deck_edge(s,pts,z1)
 for sign in [1,-1]:
  p,n=side_point(pts,26.35,sign,z0+.05);wall_door('Searchlight tower base door',p,n,.72,1.75)
  p,n=side_point(pts,28.05,sign,12.6);grille('Searchlight tower base vent',p,n,.55,.8)
  box('Searchlight tower loudspeaker',W(sign*5.02,13.55,TOWER_Z),(.36,.3,.5),materials['naval'],detailcol)
  wall_door('Searchlight tower base after door',Vector(W(sign*2.3,z0+.05,28.64)),Vector((-1,0,0)),.72,1.75)
def draw_searchlight_tower(s):
 top=s['baseY']+s['height'];X=-TOWER_Z
 ob=cyl(s['name'],(X,0,(s['baseY']+top)/2),1.42,top-s['baseY'],materials['naval'],supercol,32);ob['assemblyId']='superstructure-'+s['id']
 # Flared gallery with a railed rim, and the low round shield round the night rangefinder.
 rod('Searchlight tower gallery skirt',(X,0,top-.2),(X,0,top),1.44,materials['naval'],supercol,1.86,32)
 cyl('Searchlight tower gallery',(X,0,top+.06),1.88,.12,materials['roof'],supercol,32)
 rail('Searchlight tower gallery',ring_pts(0,TOWER_Z,1.84,20,top+.12),.9,1.45)
 vs=[];N=32
 for rr,zz in [(1.28,top+.12),(1.28,top+1.12),(1.22,top+1.12),(1.22,top+.12)]:vs.extend((X+rr*math.cos(math.tau*i/N),rr*math.sin(math.tau*i/N),zz) for i in range(N))
 mesh('Night rangefinder round shield',vs,[(j*N+i,j*N+(i+1)%N,((j+1)%4)*N+(i+1)%N,((j+1)%4)*N+i) for j in range(4) for i in range(N)],materials['naval'],supercol)
 ladder_on('Searchlight tower ladder',W(0,s['baseY']+.1,TOWER_Z+1.49),W(0,top-.25,TOWER_Z+1.49),(0,1,0),.46)
 for yy in [14.8,16.2,17.3]:rod('Tower ladder standoff',W(0,yy,TOWER_Z+1.49),W(0,yy,TOWER_Z+1.4),.03,materials['edge'],detailcol,vertices=4)
 wall_door('Searchlight tower door',Vector(W(1.1,s['baseY']+.02,TOWER_Z+.9)),Vector(W(1,0,.82))-Vector(W(0,0,0)),.62,1.6)
def draw_rangefinder_tower(s):
 top=s['baseY']+s['height']+.03;X=-GF9_Z
 ob=cyl(s['name'],(X,0,(s['baseY']+top)/2),1.48,top-s['baseY'],materials['naval'],supercol,32);ob['assemblyId']='superstructure-'+s['id']
 cyl('After rangefinder gallery',(X,0,top+.06),1.92,.12,materials['roof'],supercol,32)
 rod('After rangefinder gallery skirt',(X,0,top-.18),(X,0,top),1.5,materials['naval'],supercol,1.9,32)
 rail('After rangefinder gallery',ring_pts(0,GF9_Z,1.88,20,top+.12),.9,1.45)
 wall_door('After rangefinder tower door',Vector(W(0,8.36,GF9_Z+1.48)),Vector((-1,0,0)),.7,1.7)
 ladder_on('After rangefinder tower ladder',W(1.08,10.7,GF9_Z-1.05),W(1.08,top-.1,GF9_Z-1.05),Vector(W(1,0,1))-Vector(W(0,0,0)),.42)
def draw_mainmast_platform(s):
 ob=extrude(s['name'],plan(s['footprint']),s['baseY'],s['height'],materials['roof'],supercol,.02);ob['assemblyId']='superstructure-'+s['id']
structure_drawers.update({'aft-battery-deck':draw_battery_deck,'aft-control-deck':draw_control_deck,
 'aft-director-platform':draw_director_platform,'aft-director-house':draw_director_house,
 'aft-searchlight-tower-base':draw_tower_base,'aft-searchlight-tower':draw_searchlight_tower,
 'aft-night-rangefinder-tower':draw_rangefinder_tower,'mainmast-platform':draw_mainmast_platform})

# ---- region build --------------------------------------------------------------------------------------------
def rails_and_access():
 for sign in [1,-1]:
  x=lambda v:sign*v
  # Battery deck guardrails end at the 3.7 cm enclosures, the ladders and the rangefinder tower.
  rail('Aft battery deck',[W(x(5.0),10.672,28.75),W(x(5.0),10.672,32.3),W(x(6.4),10.672,32.3),W(x(7.5),10.672,34.35)],.9,1.5,False)
  # Caesar's depressed barrels sweep low over the after corner at full train; the rail stops short of it.
  rail('Aft battery deck',[W(x(4.54),10.672,47.45),W(x(3.55),10.672,48.18),W(x(1.16),10.672,48.18)],.9,1.5,False)
  # Control deck guardrails beside and abaft the director platform.
  rail('Aft control deck',[W(x(4.02),12.89,30.1),W(x(4.02),12.89,34.0)],.9,1.4,False)
  # The after corners stay open: the 2 cm guns there train over them.
  rail('Aft control deck',[W(x(4.02),12.89,37.65),W(x(4.02),12.89,40.1)],.9,1.2,False)
  # Steep stair from the battery deck to a side landing, and a ladder up to the searchlight tub.
  stairs('Searchlight tower stair',W(x(4.52),10.66,31.3),W(x(4.52),12.86,29.98),.66)
  box('Searchlight tower stair landing',W(x(4.62),12.8,29.42),(1.24,1.1,.12),materials['roof'],supercol)
  for zz in [28.95,29.9]:rod('Stair landing knee',W(x(5.1),12.74,zz),W(x(4.1),12.0,zz),.05,materials['naval'],supercol,vertices=6)
  ladder_on('Searchlight tub ladder',W(x(4.62),12.86,28.86),W(x(4.62),14.95,28.86),(0,1,0),.44)
  ladder_on('Searchlight tower base ladder',W(x(1.67),12.9,29.45),W(x(1.67),14.12,28.66),(0,1,0),.5)
  # Base block roof rails either side of the tower.
  for zz in [25.86,28.58]:rail('Searchlight tower base',[W(x(2.4),14.112,zz),W(x(1.35),14.112,zz)],.9,1.1,False)
 stairs('Aft centre stair',W(.3,10.66,44.4),W(.3,12.86,43.08),.66)
def searchlight_tower_fittings():
 for sign in [1,-1]:
  cx=sign*4.13;X,Y=W(cx,0,TOWER_Z)[:2]
  cyl('Searchlight tub floor',(X,Y,14.035),1.69,.11,materials['roof'],supercol,36)
  # Curved splinter shield round the outboard half, open aft to the ladder.
  arc=[W(cx+sign*1.66*math.cos(a),14.09,TOWER_Z+1.66*math.sin(a)) for a in [math.radians(d) for d in range(-110,66,11)]]
  bulwark('Searchlight tub shield',arc,.92,col=supercol)
  rail('Searchlight tub',[W(cx+sign*1.64*math.cos(a),15.01,TOWER_Z+1.64*math.sin(a)) for a in [math.radians(d) for d in range(-110,66,22)]],.42,1.2,False)
  for d in [-55,-20,20,55]:
   a=math.radians(d);rod('Searchlight tub bracket',W(cx+sign*1.6*math.cos(a),13.98,TOWER_Z+1.6*math.sin(a)),W(sign*4.85,13.1,TOWER_Z+1.2*math.sin(a)),.05,materials['naval'],supercol,vertices=6)
  cyl('Aft searchlight plinth',(X,Y,14.55),.58,.9,materials['naval'],detailcol,20)
  # Trained outboard and aft, as stowed in the reference.
  searchlight('Aft tower 1.5 m searchlight',X,Y,15.0,math.atan2(-sign*.62,-.63),.84)
 night_rangefinder('Aft night rangefinder GF 7',0,TOWER_Z,17.75,19.13)
def mainmast():
 X=-MAST_Z;support=SupportSurface([*hullcol.objects,*supercol.objects])
 foot=support.below(X,0,15.9)
 # Lower mast, topmast fidded at its head and the slender pole for the truck.
 rod('Mainmast lower mast',(X,0,foot-.05),(X,0,22.0),.55,materials['edge'],detailcol,vertices=18)
 rod('Mainmast lower mast',(X,0,22.0),(X,0,35.5),.55,materials['edge'],detailcol,.36,18)
 rod('Mainmast lower masthead',(X,0,35.5),(X,0,39.2),.31,materials['edge'],detailcol,.29,14)
 rod('Mainmast topmast',(X,0,38.6),(X,0,47.3),.17,materials['edge'],detailcol,.12,10)
 box('Mainmast truck band',(X+.12,0,47.15),(.42,.22,.3),materials['edge'],detailcol)
 rod('Mainmast pole',(-20.47,0,47.0),(-20.47,0,52.15),.075,materials['edge'],detailcol,.035,8)
 cyl('Mainmast collar',(X,0,foot+.15),.72,.3,materials['naval'],detailcol,18)
 # Enclosed lookout round the mast with the night recognition indicator on its roof.
 box('Mainmast lookout',W(0,30.09,20.78),(2.16,2.22,1.98),materials['naval'],detailcol)
 box('Mainmast lookout roof',W(0,31.1,20.78),(2.26,2.32,.06),materials['roof'],detailcol)
 for sign in [1,-1]:
  window('Mainmast lookout port',Vector(W(sign*.55,30.45,19.69)),Vector((1,0,0)),.5,.3)
  rod('Mainmast lookout knee',W(sign*1.0,29.12,20.0),W(sign*.3,27.9,20.5),.05,materials['naval'],detailcol,vertices=6)
  rod('Mainmast lookout knee',W(sign*1.0,29.12,21.6),W(sign*.3,27.9,21.0),.05,materials['naval'],detailcol,vertices=6)
 wall_door('Mainmast lookout door',Vector(W(1.11,29.2,21.1)),Vector(W(1,0,0))-Vector(W(0,0,0)),.6,1.55)
 rod('Night recognition indicator',W(0,31.84,21.9),W(0,31.84,22.02),.6,materials['naval'],detailcol,vertices=24)
 ring('Night recognition indicator rim',W(0,31.84,22.03),(-1,0,0),.55,.03,materials['edge'],20)
 rod('Night indicator post',W(0,31.1,21.95),W(0,31.3,21.95),.08,materials['edge'],detailcol,vertices=6)
 box('Mainmast masthead light',W(.3,35.44,20.42),(.24,.24,.33),materials['naval'],detailcol)
 # V-section crosstree, then the W/T spreader: short and long yards joined by struts, the inclined frame and gaff.
 vs=[W(x,35.43,20.34) for x in [-2.07,2.07]]+[W(x,35.43,21.12) for x in [-2.07,2.07]]+[W(x,34.72,20.73) for x in [-2.07,2.07]]
 mesh('Mainmast crosstree',vs,[(0,1,3,2),(0,4,5,1),(2,3,5,4),(0,2,4),(1,5,3)],materials['naval'],detailcol)
 rod('Crosstree bar',W(-2.05,35.73,21.35),W(2.05,35.73,21.35),.05,materials['edge'],detailcol,vertices=6)
 for sign in [1,-1]:
  rod('W/T long yard',W(0,38.35,25.02),W(sign*5.68,38.35,25.02),.15,materials['edge'],detailcol,.08,10)
  rod('W/T short yard',W(0,39.06,21.19),W(sign*3.12,39.06,21.19),.1,materials['edge'],detailcol,.06,8)
  rod('W/T spreader strut',W(sign*3.04,39.07,21.25),W(sign*5.56,38.41,24.95),.05,materials['edge'],detailcol,vertices=6)
  rod('W/T spreader boom',W(sign*.17,39.07,21.27),W(sign*.17,38.13,25.12),.06,materials['edge'],detailcol,vertices=6)
  rod('W/T inclined frame',W(sign*1.98,35.43,20.95),W(sign*3.02,38.28,24.95),.06,materials['edge'],detailcol,vertices=6)
  rod('W/T frame brace',W(sign*2.0,35.72,21.3),W(-sign*2.84,38.1,24.7),.03,materials['edge'],detailcol,vertices=5)
  rod('Signal yard',W(0,44.22,20.47),W(sign*2.3,44.22,20.47),.07,materials['edge'],detailcol,.04,8)
  rod('Signal yard lift',W(sign*2.27,44.25,20.5),W(sign*.12,45.85,20.62),.018,materials['dark'],detailcol,vertices=4)
 # Light flag grids hang under the W/T yards and the signal yard.
 for span,top,low,zz in [(5.62,38.26,37.52,25.02),(3.06,39.0,38.28,21.17),(2.25,44.16,43.44,20.47)]:
  polyline('Yard grid',[W(-span,top,zz),W(-span,low,zz),W(span,low,zz),W(span,top,zz)],.014,materials['edge'],vertices=4)
  for i in range(1,int(span/.7)*2):
   xx=-span+i*span/int(span/.7);rod('Yard grid bar',W(xx,low,zz),W(xx,top,zz),.01,materials['edge'],detailcol,vertices=3)
 rod('Mainmast gaff',W(0,35.43,20.95),W(0,40.69,28.99),.09,materials['edge'],detailcol,.05,8)
 for yy in [44.9,45.45]:box('Mainmast truck lights',W(0,yy,20.52),(.3,1.13,.24),materials['naval'],detailcol)
 # Ladders on the forward face of the lower mast and topmast.
 for a,b,off in [(16.25,29.1,.75),(31.12,35.3,.6),(39.2,44.1,.33)]:
  ladder_on('Mainmast ladder',W(0,a,MAST_Z-off),W(0,b,MAST_Z-off),(0,1,0),.42)
  for yy in [a+.4+i*1.6 for i in range(int((b-a-.4)/1.6)+1)]:rod('Mainmast ladder lug',W(0,yy,MAST_Z-off),W(0,yy,MAST_Z-off+.24),.03,materials['edge'],detailcol,vertices=4)
 # Shrouds to the platform bulwarks and backstays to the searchlight tower base.
 for sign in [1,-1]:
  for zz in [21.95,24.8]:rod('Mainmast shroud',W(sign*1.98,35.43,21.0),W(sign*4.42,17.56,zz),.018,materials['dark'],detailcol,vertices=4)
  rod('Mainmast backstay',W(0,45.8,20.75),W(sign*2.6,14.13,28.5),.016,materials['dark'],detailcol,vertices=4)
 return foot
def mainmast_platform(foot):
 s=structures['mainmast-platform'];floor=s['baseY']+s['height'];hangar=SupportSurface([*hullcol.objects,*supercol.objects])
 for sign in [1,-1]:
  x=lambda v:sign*v
  walls=[[(1.47,24.45),(1.47,23.43)],[(2.05,24.83),(1.47,24.45)],[(4.4,24.83),(2.05,24.83)],[(4.42,21.9),(4.42,24.83)],[(2.3,21.26),(4.42,21.9)],[(2.53,22.7),(2.53,21.33)],[(2.5,23.4),(4.38,23.4)]]
  for w in walls:bulwark('Mainmast platform bulwark',[W(x(a),floor,b) for a,b in w],1.35,col=supercol)
  # Pillars clear of the boats stowed beneath, knees to the mast.
  for zz in [21.55,24.5]:
   y0=hangar.below(W(x(1.35),0,zz)[0],W(x(1.35),0,zz)[1],s['baseY']-.1)
   rod('Mainmast platform pillar',W(x(1.35),y0-.02,zz),W(x(1.35),s['baseY']+.02,zz),.15,materials['naval'],supercol,vertices=10)
  for zz in [20.9,22.6]:rod('Mainmast platform knee',W(x(.5),s['baseY']-1.4,MAST_Z),W(x(3.2),s['baseY']+.01,zz),.06,materials['naval'],supercol,vertices=6)
  # Carley floats stowed upright on the after bulwark.
  pts=[W(x(3.25+xx),16.66+yy,25.12) for xx,yy in rounded_rect(0,0,1.62,1.58,.4,2)]
  polyline('Upright Carley float',pts,.14,materials['canvas'],detailcol,True,6)
  for yy in [-.35,0,.35]:box('Upright Carley float grating',W(x(3.25),16.66+yy,25.12),(.06,1.46,.05),materials['wood'],detailcol)
  box('Upright Carley float hook',W(x(3.25),17.52,24.98),(.3,.12,.12),materials['edge'],detailcol)
 # Small house on the mast's after side with the signal lamp gallery above.
 box('Mainmast house',W(0,floor+.95,21.75),(1.55,2.36,1.9),materials['naval'],supercol)
 box('Mainmast house roof',W(0,floor+1.93,21.75),(1.62,2.42,.06),materials['roof'],supercol)
 wall_door('Mainmast house door',Vector(W(0,floor+.02,22.53)),Vector((-1,0,0)),.66,1.6)
 half=[W(.85*math.sin(a),21.1,MAST_Z+.85*math.cos(a)) for a in [math.radians(d) for d in range(-90,91,15)]]
 mesh('Signal lamp gallery',[(-MAST_Z,0,21.1)]+half,[(0,i+1,i+2) for i in range(len(half)-1)],materials['roof'],detailcol)
 rail('Signal lamp gallery',half,.8,.9,False)
 for sign in [1,-1]:rod('Signal lamp gallery knee',W(sign*.55,21.08,MAST_Z+.55),W(sign*.25,20.3,MAST_Z+.25),.04,materials['naval'],detailcol,vertices=5)
 rod('Signal lamp column',W(0,21.12,21.4),W(0,21.55,21.4),.07,materials['edge'],detailcol,vertices=8)
 rod('Signal lamp',W(0,21.8,21.25),W(0,21.8,21.6),.22,materials['naval'],detailcol,vertices=16)
 rod('Signal lamp lens',W(0,21.8,21.6),W(0,21.8,21.63),.18,materials['glass'],detailcol,vertices=16)
def aft_director():
 # Original 10.5 m aft director after pgsb708 gf002: narrow hood with bowed ends, arm housings, a 10.5 m tube,
 # walkways behind the arms, a slatted panel on its after face and a pole mast with a small frame.
 X=-DIRECTOR_Z
 cyl('Aft director barbette',(X,0,15.58),1.1,.36,materials['naval'],detailcol,32)
 before=set(bpy.context.scene.objects)
 cyl('Aft director training base',(X,0,15.96),1.37,.4,materials['edge'],detailcol,36)
 hood=[(0,35.22),(.69,35.3),(1.22,35.45),(1.33,35.53),(1.37,35.66),(1.37,38.17),(1.33,38.29),(1.22,38.38),(.69,38.53),(0,38.61)]
 ring_=hood+[(-x,z) for x,z in reversed(hood[1:-1])]
 extrude('Aft director hood',plan(ring_),16.16,1.89,materials['naval'],detailcol,.03)
 extrude('Aft director crown edge',plan([(x*1.02,DIRECTOR_Z+(z-DIRECTOR_Z)*1.015) for x,z in ring_]),18.05,.08,materials['edge'],detailcol)
 polyline('Aft director plating joint',[(x,y,16.8) for x,y in plan(ring_)],.016,materials['edge'],closed=True)
 for sign in [1,-1]:
  box('Aft director arm housing',W(sign*1.745,17.13,36.91),(1.38,.79,1.26),materials['naval'],detailcol)
  rod('Aft director optical tube',W(sign*2.1,17.1,36.9),W(sign*4.9,17.1,36.9),.21,materials['naval'],detailcol,.19,18)
  for xx in [2.3,4.3]:rod('Aft director tube collar',W(sign*(xx-.07),17.1,36.9),W(sign*(xx+.07),17.1,36.9),.24,materials['edge'],detailcol,vertices=18)
  box('Aft director end housing',W(sign*5.2,17.1,36.94),(.52,.65,.44),materials['naval'],detailcol)
  rod('Aft director objective',W(sign*5.25,17.09,37.2),W(sign*5.25,17.09,37.24),.14,materials['glass'],detailcol,vertices=12)
  box('Aft director walkway',W(sign*3.93,16.42,37.2),(.47,3.35,.06),materials['edge'],detailcol)
  rod('Aft director walkway handrail',W(sign*2.26,17.42,37.4),W(sign*5.6,17.42,37.4),.02,materials['edge'],detailcol,vertices=5)
  for xx in [2.3,3.9,5.55]:rod('Aft director walkway stanchion',W(sign*xx,16.45,37.4),W(sign*xx,17.42,37.4),.02,materials['edge'],detailcol,vertices=4)
  rod('Aft director walkway bracket',W(sign*2.14,16.6,37.1),W(sign*3.2,16.4,37.2),.035,materials['naval'],detailcol,vertices=5)
  rod('Aft director walkway bracket',W(sign*3.9,16.39,37.0),W(sign*3.9,16.95,36.95),.03,materials['naval'],detailcol,vertices=4)
 # Slatted panel across the after face (the reference's rectangular slat panel), on three brackets.
 for i in range(8):box('Aft director after panel slat',W(-1.73+i*.494,17.44,39.53),(.3,.42,1.92),materials['naval'],detailcol)
 for yy in [16.5,18.38]:box('Aft director after panel rail',W(0,yy,39.53),(.34,3.96,.06),materials['edge'],detailcol)
 for xx,yy in [(-1.0,16.75),(1.0,16.75),(0,18.1)]:rod('Aft director panel bracket',W(xx,yy,38.55),W(xx,yy,39.4),.05,materials['edge'],detailcol,vertices=6)
 # Short pole mast with a small flag frame.
 rod('Aft director mast',W(0,18.08,DIRECTOR_Z-.02),W(0,19.4,DIRECTOR_Z-.02),.29,materials['edge'],detailcol,.27,14)
 rod('Aft director topmast',W(0,19.35,DIRECTOR_Z-.02),W(0,25.19,DIRECTOR_Z-.02),.16,materials['edge'],detailcol,.07,10)
 for sign in [1,-1]:rod('Aft director mast lift',W(sign*.09,24.64,36.77),W(sign*2.1,23.96,36.72),.016,materials['dark'],detailcol,vertices=4)
 rod('Aft director mast bar',W(-2.15,23.93,36.65),W(2.15,23.93,36.65),.04,materials['edge'],detailcol,vertices=6)
 polyline('Aft director mast frame',[W(-2.06,23.9,36.65),W(-2.06,23.15,36.65),W(2.06,23.15,36.65),W(2.06,23.9,36.65)],.02,materials['edge'])
 ladder_on('Aft director mast ladder',W(0,19.45,DIRECTOR_Z-.28),W(0,23.84,DIRECTOR_Z-.28),(0,1,0),.28)
 radar_pivot('fumo-aft.yaw',(X,0,15.76),set(bpy.context.scene.objects)-before)
def director_platform_fittings():
 for sign in [1,-1]:
  # Zeilsaeule night directors and target givers on the director platform.
  x=sign*2.61;z=36.53
  cyl('Night director base',W(x,13.12,z),.33,.14,materials['edge'],detailcol,12)
  rod('Night director column',W(x,13.19,z),W(x,13.5,z),.2,materials['naval'],detailcol,.16,10)
  box('Night director sight body',W(x,13.9,z),(.47,.56,.84),materials['naval'],detailcol)
  for s in [-1,1]:rod('Night director binocular',W(x+s*.18,14.47,z+.2),W(x+s*.18,14.47,z-.2),.12,materials['naval'],detailcol,vertices=8)
  x=sign*4.25;z=34.91
  cyl('Target giver base',W(x,13.12,z),.3,.14,materials['edge'],detailcol,12)
  rod('Target giver column',W(x,13.19,z),W(x,13.8,z),.12,materials['naval'],detailcol,vertices=8)
  box('Target giver head',W(x,14.1,z),(.6,.7,.6),materials['naval'],detailcol)
  rod('Target giver sight',W(x,14.5,z+.2),W(x,14.5,z-.35),.08,materials['naval'],detailcol,vertices=8)
  box('Director platform switch box',W(sign*3.8,13.4,37.35),(.2,.5,.6),materials['edge'],detailcol)
  # Stacked Carley floats on the control deck either side of the director platform.
  carley_stack('Aft Carley float stack',sign*3.07,38.48,12.9)
 carley_stack('Aft Carley float stack',-3.03,32.73,12.9)
def gun_positions():
 for sign,side in [(1,'starboard'),(-1,'port')]:
  # 3.7 cm pair on the battery deck in open three-sided enclosures.
  enc=[(4.95,34.93),(5.5,34.3),(7.57,34.3),(8.07,35.17),(8.07,39.0),(5.05,39.0),(4.79,39.21)]
  bulwark('Aft 3.7 cm enclosure splinter shield',[W(sign*x,10.66,z) for x,z in enc],.85,stiff=1.2)
  m=M[side+'-aa-37-3'];x,y,z=m['position'];seat(m['id'],x,z,10.66,y-.09)
  # 3.7 cm pair in round tubs on the 01 deck, running from the battery deck's chamfer to the rangefinder tower.
  tub=[(6.98,45.63),(7.99,46.97),(8.48,47.84),(8.65,48.7),(8.48,49.55),(8.0,50.27),(7.28,50.76),(6.42,50.93),(5.56,50.75),(4.02,50.26),(1.33,49.25),(.84,48.43)]
  bulwark('Aft 3.7 cm tub splinter shield',[W(sign*x,8.33,z) for x,z in tub],.92,stiff=1.2)
  m=M[side+'-aa-37-4'];x,y,z=m['position'];seat(m['id'],x,z,8.36,y)
  m=M[side+'-aa-20-4'];x,y,z=m['position'];seat(m['id'],x,z,12.87,y+.005,.5)
  m=M[side+'-aa-20-5'];x,y,z=m['position'];seat(m['id'],x,z,10.66,y+.005,.5)
  m=M[side+'-aa-20-6'];x,y,z=m['position'];floor=SupportSurface([*hullcol.objects]).below(-z,-x,y+.5);seat(m['id'],x,z,floor-.03,y+.005,.48)
 # Ready-use lockers from the reference layout.
 for sign in [1,-1]:
  x=lambda v:sign*v
  locker('Aft ready-use locker',x(5.85),10.66,33.66,.75,.6,1.08)
  locker('Aft ready-use locker',x(6.68),10.66,39.21,1.47,.42,.35)
  # Low lockers along the after chamfer, under Caesar's depressed barrels.
  for xx,zz in [(6.77,45.18),(5.86,45.84),(4.95,46.5)]:locker('Aft ready-use locker',x(xx),10.66,zz,.9,.4,1.05,-sign*math.radians(53))
  locker('Aft battery deck locker',x(2.72),10.66,43.41,1.47,1.2,.75)
  for zz in [41.89,42.99,44.1]:locker('Aft 01 deck locker',x(8.48),8.36,zz,.75,.6,1.0)
 locker('Aft control deck locker',.73,12.88,32.16,.75,1.2,1.4)
 locker('Aft control deck locker',-.04,12.88,32.22,.75,1.1,1.1)
 locker('Aft control deck locker',-3.61,12.88,30.65,.75,1.2,1.4)
def after_deck_fittings():
 # Cable reel beside the rangefinder tower, a small locker house to port and the stowed spars on chocks
 # abaft the 3.7 cm tubs.
 x,z=2.54,47.17
 for xx in [2.11,2.98]:
  rod('Cable reel flange',W(xx-.04,11.52,z),W(xx+.04,11.52,z),.77,materials['edge'],detailcol,vertices=20)
  box('Cable reel stand',W(xx+(.2 if xx>2.5 else -.2),11.13,z),(1.2,.1,.95),materials['naval'],detailcol)
 rod('Cable reel drum',W(2.15,11.52,z),W(2.94,11.52,z),.5,materials['rope'],detailcol,vertices=20)
 rod('Cable reel axle',W(1.7,11.52,z),W(3.4,11.52,z),.06,materials['edge'],detailcol,vertices=8)
 extrude('Aft locker house',plan([(-4.19,46.87),(-2.88,46.87),(-2.88,48.17),(-4.19,48.17)]),10.66,1.84,materials['naval'],supercol,.03)
 box('Aft locker house roof',W(-3.535,12.52,47.52),(1.38,1.39,.06),materials['roof'],supercol)
 wall_door('Aft locker house door',Vector(W(-2.88,10.7,47.52)),Vector((0,-1,0)),.66,1.6)
 for sign in [1,-1]:
  a,b=Vector(W(sign*1.78,8.8,49.9)),Vector(W(sign*6.12,8.8,51.42))
  rod('Stowed spar',a,b,.28,materials['naval'],detailcol,.2,12)
  for t in [.12,.5,.88]:
   p=a+(b-a)*t;ob=box('Stowed spar chock',(p.x,p.y,8.52),(.16,.62,.36),materials['edge'],detailcol);ob.rotation_euler.z=math.atan2((b-a).y,(b-a).x)
def aerials():
 # W/T aerials from the spreader's long yard to the foremast yard ends of the reference.
 for sign in [1,-1]:
  a=Vector(W(sign*5.62,38.35,25.02));b=Vector(W(sign*2.3,36.04,-6.7))
  polyline('Aerial span',[a+(b-a)*(i/16)-Vector((0,0,1.1*math.sin(math.pi*i/16))) for i in range(17)],.014,materials['dark'],vertices=4)
def build():
 # Region entry point, after the forward and midships regions (the hangar roof carries the mainmast).
 rails_and_access();searchlight_tower_fittings()
 foot=mainmast();mainmast_platform(foot)
 aft_director();director_platform_fittings();gun_positions();after_deck_fittings();aerials()
 night_rangefinder('After night rangefinder GF 9',0,GF9_Z,13.08,14.37)
def after_mounts():
 pass
