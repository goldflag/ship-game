"""Midships: funnels, the 03-level funnel AA block, its Bofors tubs and raised middle platforms,
the 20 mm galleries on the 02 wall, Mk.51 director tubs, funnel platforms and searchlights.

Region: runtime z +4..+35 m above the 02 deck (11.05 m). Executed in build.py's scope after
tower.py. Every measurement below is runtime [x, z] (x starboard, z aft) for the starboard
side and is mirrored to port; `mid_b` converts to authoring (bow +X, port +Y, up +Z).
Measured from sections of the approved GameModels3D Iowa (A_Hull); geometry is original.
"""
COL=collections['Superstructure'];F=Fittings(helpers,materials,COL);structures={s['id']:s for s in D['structures']}
MID_SIDES=[(1,'starboard'),(-1,'port')]

def mid_b(x,z):return (-z,-x)
def mid_b3(x,y,z):return (-z,-x,y)

def mid_wall(name,pts,base,tops,thickness=.07,closed=False,inside=None,coping=.03,material='naval'):
    """Splinter plating on runtime (x, z) points along its outer face, with per-point tops and bases.
    The plate thickens toward `inside` (a runtime point) and carries a rolled top edge."""
    path=[mid_b(x,z) for x,z in pts];n=len(path)
    tops=list(tops) if isinstance(tops,(list,tuple)) else [tops]*n
    bases=list(base) if isinstance(base,(list,tuple)) else [base]*n
    ring=path+([mid_b(*inside)] if inside is not None and not closed else [])
    if sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(ring,ring[1:]+ring[:1]))<0:
        path.reverse();tops.reverse();bases.reverse()
    inner=_offset_path(path,thickness,closed)
    vv=[(x,y,b) for (x,y),b in zip(path,bases)]+[(x,y,t) for (x,y),t in zip(path,tops)]+[(x,y,t) for (x,y),t in zip(inner,tops)]+[(x,y,b) for (x,y),b in zip(inner,bases)]
    ff=[]
    for i in range(n if closed else n-1):
        j=(i+1)%n
        for a,b in [(0,1),(1,2),(2,3),(3,0)]:ff.append((a*n+i,a*n+j,b*n+j,b*n+i))
    if not closed:ff.append((0,3*n,2*n,n));ff.append((n-1,2*n-1,3*n-1,4*n-1))
    obj=mesh(name,vv,ff,material)
    if coping:tube_path(name+' rolled edge',[(x,y,t) for (x,y),t in zip(_offset_path(path,thickness/2,closed),tops)],coping,'naval',5,closed)
    return obj

def mid_slab(name,pts,top,thickness=.14,material='roof'):
    return platform(name,[mid_b(x,z) for x,z in pts],top,thickness,material)

def mid_ladder(name,a,b,width=.42,normal='y',step=.30,to_wall=None):
    """Low-poly vertical or inclined ladder between authoring points a and b; `to_wall`
    (an authoring x, y offset) adds standoffs from both stringers to the wall behind."""
    a,b=Vector(a),Vector(b);side=Vector((0,width/2,0)) if normal=='x' else Vector((width/2,0,0))
    for sign in [-1,1]:rod(name+' stringer',a+side*sign,b+side*sign,.03,'edge',vertices=5)
    count=max(2,math.ceil((b-a).length/step))
    for i in range(1,count):
        p=a.lerp(b,i/count);rod(name+' rung',p-side,p+side,.02,'edge',vertices=4)
    if to_wall:
        w=Vector((*to_wall,0));stays=max(2,math.ceil((b-a).length/1.6))
        for i in range(stays):
            p=a.lerp(b,(i+.5)/stays)
            for sign in [-1,1]:rod(name+' standoff',p+side*sign,p+side*sign+w,.02,'edge',vertices=4)

def mid_d(cx,cz,r,flat,n=10):
    """D-shaped director tub outline: straight side at x=flat, round side away from it."""
    s=1 if cx>flat else -1
    return [(flat,cz-r)]+[(cx+s*r*math.cos(t),cz+r*math.sin(t)) for t in [-math.pi/2+math.pi*i/n for i in range(n+1)]]+[(flat,cz+r)]

def mid_mirror(pts,s):return [(s*x,z) for x,z in pts]

def mid_post(name,x,z,y0,y1,r=.09,vertices=8):
    rod(name,mid_b3(x,y0,z),mid_b3(x,y1,z),r,'naval',vertices=vertices)

def funnel_details(s,obj):
    global ASSEMBLY
    ASSEMBLY=s['id'];dx=0 if s['id']=='funnel-forward' else -24.70;dz=0 if dx==0 else -.60
    # Open the blueprint's exhaust closure for a recessed visual chimney.
    old=obj.data;last=len(s['surface']['vertices'])-42;verts=[tuple(v.co) for v in old.vertices]
    faces=[tuple(p.vertices) for p in old.polygons if not all(i>=last for i in p.vertices)]
    data=bpy.data.meshes.new(s['id']+' open hood');data.from_pydata(verts,[],faces);data.update()
    data.materials.append(materials['naval']);obj.data=data
    for p in data.polygons:p.use_smooth=True
    data.set_sharp_from_angle(angle=math.radians(38))
    n=64;vv=[]
    # The black lip is extruded normal to its raked plane, with an inner wall.
    for x,z,rx,ry in [(-4.16,27.792,2.175,1.65),(-4.56,28.5375,2.09,1.59),(-4.56,28.5375,1.94,1.44),(-4.16,26.94,1.94,1.44)]:
        vv.extend((x+rx*math.cos(i*math.tau/n)+dx,ry*math.sin(i*math.tau/n),z+.416*rx*math.cos(i*math.tau/n)+dz) for i in range(n))
    ff=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(3) for i in range(n)]
    ff.append(tuple(reversed(range(3*n,4*n))));mesh('Raked black funnel lip and recessed uptake',vv,ff,'dark',smooth=True)
    for along in [-1.35,-.45,.45,1.35]:
        half=1.43*math.sqrt(1-(along/1.94)**2);x=-4.56+along+dx;z=28.47+.416*along+dz
        box('Funnel uptake grating',(x,0,z),(.09,2*half,.095),'edge')
    rod('Funnel grating spine',(-6.48+dx,0,27.67+dz),(-2.64+dx,0,29.27+dz),.045,'edge',vertices=8)
    F=Fittings(helpers,materials,COL)
    # Service walkway follows the jacket at the hood shoulder.
    poly=[(dx-4.30+(-z-dx+4.30)*1.10,-x*1.20) for x,y,z in s['surface']['vertices'][126:168]]
    n=len(poly)
    # Annular plate instead of a disk through the uptake.
    vv=[(x,y,26.155+dz+zz) for zz in [-.055,.055] for ring in [poly,[(dx-4.30+(x-dx+4.30)*.84,y*.83) for x,y in poly]] for x,y in ring]
    ff=[]
    for i in range(n):
        j=(i+1)%n
        for a,b in [(0,n),(2*n,0),(n,3*n),(3*n,2*n)]:ff.append((a+i,a+j,b+j,b+i))
    mesh('Funnel annular service walkway',vv,ff,'roof')
    rail('Funnel walkway rail',poly,26.21+dz,.82,1.2,True)
    for i in range(0,n,3):
        x,y=poly[i];inner=Vector((dx-4.30+(x-dx+4.30)*.88,y*.82,25.17+dz));outer=Vector((x,y,26.10+dz));near=Vector((inner.x,inner.y,26.10+dz))
        tangent=Vector((-y,x-dx+4.30,0)).normalized()
        vv=[tuple(v+tangent*shift) for shift in [-.028,.028] for v in [inner,outer,near]]
        mesh('Funnel walkway plate knee',vv,[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)],'naval')
    for side in [-1,1]:
        F.ladder('Funnel jacket ladder',(-2.68+dx,side*2.56,13.0),(-2.68+dx,side*2.56,26.17+dz),.41)
        F.ladder('Funnel cap ladder',(-5.40+dx,side*2.31,26.21+dz),(-5.55+dx,side*1.96,27.44+dz),.37)
        for z in [26.3,27.2]:
            t=(z-26.21)/1.23;xx=-5.40-.15*t+dx;yy=2.31-.35*t
            rod('Funnel cap ladder shoe',(xx,side*1.75,z+dz),(xx,side*yy,z+dz),.028,'naval',vertices=6)
        for z in [14,18,22,25]:rod('Funnel ladder shoe',(-2.68+dx,side*2.30,z),(-2.68+dx,side*2.59,z),.030,'naval',vertices=6)
        # Two bent steam outlets emerge along the after edge of each hood.
        y=side*.63;path=[(-8.42+dx,y,12.0),(-8.42+dx,y,26.0+dz),(-8.61+dx,y,26.65+dz),(-8.83+dx,y,26.92+dz),(-9.12+dx,y,26.92+dz)]
        for a,b in zip(path,path[1:]):rod('Funnel gooseneck steam pipe',a,b,.104,'naval' if a[2]<25 else 'dark',vertices=12)
        for z in [15,20,24]:rod('Steam pipe bracket',(-7.72+dx,y,z),(-8.47+dx,y,z),.044,'naval',vertices=8)
        # Whistle and siren supply pipe beside the jacket ladder, clipped to the plating.
        x0,hw=(-6.3,2.40) if not dx else (-26.85,2.33)
        rod('Funnel whistle supply pipe',(x0,side*(hw+.06),13.0),(x0,side*(hw+.06),26.0+dz),.05,'naval',vertices=6)
        for z in [15.0,18.5,22.0,25.0]:rod('Supply pipe clip',(x0,side*(hw-.04),z),(x0,side*(hw+.10),z),.03,'edge',vertices=4)


for s in D['structures']:
    if s.get('exhaust'):
        funnel_details(s,next(o for o in scene.objects if o.get('nodeId')==s['id']+'.surface'))

# ---------------------------------------------------------------------------------------------
# 03-level funnel AA block: lobed Bofors tubs on the 13.85 m deck and splinter walls above the
# raised 15.26 m middle platforms. Tub walls are 1.65 m on the inboard, fore and aft faces and
# 1.15 m outboard, as sectioned; the raised platforms carry 2.13 m walls.
MID_FWD_TUB=[(2.49,18.61),(2.49,12.91),(6.12,12.91),(7.8,13.31),(8.46,13.81),(8.84,14.53),(9.06,15.35),(8.97,16.24),(8.48,17.48),(8.48,19.35),(7.9,19.62)]
MID_FWD_TOPS=[15.5,15.5,15.5,15.36,15.2,15.07,15.0,15.0,15.0,15.0,15.0]
MID_AFT_TUB=[(7.9,23.06),(8.44,23.47),(8.44,25.04),(9.06,26.22),(9.12,27.05),(8.89,27.86),(8.53,28.45),(8.01,28.99),(7.38,29.42),(6.68,29.52),(3.98,29.52),(3.98,28.75),(3.4,27.93),(3.12,26.87),(3.12,24.08)]
MID_AFT_TOPS=[15.0,15.0,15.0,15.0,15.0,15.0,15.0,15.12,15.3,15.5,15.5,15.5,15.5,15.5,15.5]
MID_FWD_LOBE=[(6.12,12.91),(7.8,13.31),(8.46,13.81),(8.84,14.53),(9.06,15.35),(8.97,16.24),(8.48,17.48),(8.47,14.2)]
MID_AFT_LOBE=[(8.44,25.04),(9.06,26.22),(9.12,27.05),(8.89,27.86),(8.53,28.45),(8.47,28.5)]
MID_DECK_TOP=13.848;MID_RAISED_TOP=15.2595;MID_RAISED_WALL=17.39;MID_WELL_TOP=13.0
for s,side in MID_SIDES:
    COL=collections['Superstructure'];ASSEMBLY='mid-aa-deck-'+side
    mid_wall('Forward Bofors tub splinter wall',mid_mirror(MID_FWD_TUB,s),MID_DECK_TOP,MID_FWD_TOPS,inside=(s*5.5,15.5))
    mid_wall('After Bofors tub splinter wall',mid_mirror(MID_AFT_TUB,s),MID_DECK_TOP,MID_AFT_TOPS,inside=(s*6.0,26.5))
    # Outboard lobes overhang the block wall on a plated floor with pierced knees.
    mid_slab('Forward tub lobe floor',mid_mirror(MID_FWD_LOBE,s),MID_DECK_TOP,.17)
    mid_slab('After tub lobe floor',mid_mirror(MID_AFT_LOBE,s),MID_DECK_TOP,.17)
    for x,z in [(8.9,14.6),(8.95,15.9),(8.95,26.3),(9.0,27.4)]:
        knee('Tub lobe knee',mid_b3(s*(x-.06),MID_DECK_TOP-.17,z),mid_b3(s*8.47,MID_DECK_TOP-.17,z),.85)
    # Plate stiffeners inside the tall inboard wall and a gun-deck edge strake along the block.
    tube_path('Block deck-edge strake',[mid_b3(s*8.5,MID_DECK_TOP-.08,z) for z in [14.25,18.4]],.035,'naval',4)
    tube_path('Block deck-edge strake',[mid_b3(s*8.5,MID_DECK_TOP-.08,z) for z in [24.6,29.5]],.035,'naval',4)
    for z in [14.2,15.6,17.0]:rod('Tub wall stiffener',mid_b3(s*2.58,MID_DECK_TOP,z),mid_b3(s*2.58,15.45,z),.035,'naval',vertices=4)
    for z in [25.1,26.3]:rod('Tub wall stiffener',mid_b3(s*3.21,MID_DECK_TOP,z),mid_b3(s*3.21,15.45,z),.035,'naval',vertices=4)
    # Ready-use 40 mm clip boxes hung on the inboard tub walls.
    box('Bofors clip box',(*mid_b(s*2.74,15.78),14.75),(.33,.36,.89),'naval')
    box('Bofors clip box',(*mid_b(s*3.36,26.03),14.75),(.33,.36,.89),'naval')
    # Access ladder from the 20 mm gallery up the block side and over the forward tub wall.
    mid_ladder('Gallery ladder',mid_b3(s*8.62,11.227,18.9),mid_b3(s*8.62,15.45,18.9),.40,'y',to_wall=(0,s*.15))
    # Access ladder up the forward face of the block from the 02 deck and over the tub wall.
    mid_ladder('Block access ladder',mid_b3(s*5.7,11.05,12.72),mid_b3(s*5.7,15.62,12.72),.42,'x',to_wall=(-.19,0))
    # Life-float net baskets hang on the forward tub wall.
    ASSEMBLY='mid-aa-deck-'+side
    for x0,x1 in [(2.55,4.05),(4.15,5.62)]:
        a,b=sorted([s*x0,s*x1])
        mid_wall('Floater net basket',[(a,12.18),(b,12.18),(b,12.90),(a,12.90)],14.22,15.02,.03,True,coping=.018)
        mid_slab('Floater net basket bottom',[(a,12.18),(b,12.18),(b,12.92),(a,12.92)],14.26,.04,'canvas')
        mid_slab('Floater net stowage',[(a+.05,12.23),(b-.05,12.23),(b-.05,12.81),(a+.05,12.81)],14.82,.5,'canvas')
    ASSEMBLY='mid-bofors-platform-'+side
    mid_oval=mid_mirror(structures['mid-bofors-platform-'+side]['footprint'],1)
    mid_wall('Raised Bofors platform splinter wall',mid_oval,MID_RAISED_TOP,MID_RAISED_WALL,.08,True)
    tube_path('Raised platform deck strake',[mid_b3(x,MID_RAISED_TOP-.06,z) for x,z in mid_oval],.035,'naval',4,True)
    tube_path('Raised platform wall stiffener',[mid_b3(x+(.03 if x>0 else -.03),16.35,z) for x,z in mid_oval],.03,'naval',4,True)
    # Rail on the exposed deck corner outside the after tub.
    rail('Deck corner rail',[mid_b(s*x,z) for x,z in [(8.45,28.6),(8.45,29.48),(6.75,29.48)]],MID_DECK_TOP,.95,1.0)
    # Step irons up the outboard face from the ledge.
    for i in range(9):
        y=14.25+i*.35
        tube_path('Step iron',[mid_b3(s*x,y,z) for x,z in [(8.40,21.14),(8.56,21.14),(8.56,21.54),(8.40,21.54)]],.018,'edge',4)
    # Narrow railed ledge outboard of the raised platform.
    mid_slab('Raised platform outboard ledge',mid_mirror([(8.47,20.05),(8.95,20.3),(8.95,22.4),(8.47,22.65)],s),MID_DECK_TOP,.17)
    rail('Ledge rail',[mid_b(s*x,z) for x,z in [(8.47,20.05),(8.93,20.3),(8.93,22.4),(8.47,22.65)]],MID_DECK_TOP,.95,1.2)
    for z in [20.4,22.25]:knee('Ledge knee',mid_b3(s*8.9,MID_DECK_TOP-.17,z),mid_b3(s*8.47,MID_DECK_TOP-.17,z),.6)
    # Ladders over the forward and after faces of the raised platform.
    for z,dz in [(18.61,-.16),(24.08,.16)]:
        mid_ladder('Raised platform ladder',mid_b3(s*4.4,MID_DECK_TOP,z+dz),mid_b3(s*4.4,MID_RAISED_WALL+.45,z+dz),.42,'x',to_wall=(dz,0))
    box('Bofors clip box',(*mid_b(s*2.74,21.3),MID_RAISED_TOP+.95),(.33,.36,.89),'naval')
for m in D['mounts']:
    if m['id'].startswith('bofors-funnel-'):AA_INSTALLED.add(m['id'])

# ---------------------------------------------------------------------------------------------
# Uptake well between the funnels (13.0 m): antenna lead-in trunks, lockers, casing walkway.
COL=collections['Superstructure'];ASSEMBLY='funnel-aa-base'
for x,z in [(.09,14.61),(.09,20.49)]:
    # Lattice lead-in towers with insulator caps.
    legs=[(x+dx,z+dz) for dx,dz in [(-.28,-.28),(.28,-.28),(.28,.28),(-.28,.28)]]
    for (ax,az),(bx,bz) in zip(legs,legs[1:]+legs[:1]):
        for y0,y1 in [(MID_WELL_TOP,14.4),(14.4,15.7)]:rod('Lead-in tower brace',mid_b3(ax,y0,az),mid_b3(bx,y1,bz),.018,'edge',vertices=4)
    for ax,az in legs:rod('Lead-in tower leg',mid_b3(ax,MID_WELL_TOP,az),mid_b3(x+(ax-x)*.55,15.72,z+(az-z)*.55),.03,'naval',vertices=5)
    cyl('Lead-in tower head',(*mid_b(x,z),15.8),.26,.16,'naval',vertices=6)
    cyl('Lead-in insulator',(*mid_b(x,z),16.0),.14,.26,'white',vertices=8,r2=.08)
for x,z in [(.61,16.04),(.05,17.99)]:
    cyl('Antenna trunk',(*mid_b(x,z),(MID_WELL_TOP+15.6)/2),.19,15.6-MID_WELL_TOP,'naval',vertices=8,r2=.16)
    cyl('Antenna trunk cap',(*mid_b(x,z),15.72),.24,.24,'naval',vertices=6,r2=.12)
    cyl('Trunk insulator',(*mid_b(x,z),15.98),.08,.3,'white',vertices=6)
for s,side in MID_SIDES:
    # Ready-use lockers on the 02 deck ahead of the block and beside the casing.
    for x in [4.63]:locker('Ready-use ammunition box',*mid_b(s*x,12.55),11.05,(1.39,.62,.8),-math.pi/2)
    locker('Ready-use ammunition box',*mid_b(s*2.76,9.6),11.05,(.86,.52,1.0),math.pi if s>0 else 0)
    # Funnel-base walkway at 13.0 m around the forward funnel with its rail.
    mid_slab('Forward funnel base walkway',mid_mirror([(2.49,4.1),(3.72,4.1),(3.72,7.75),(2.49,7.75)],s),MID_WELL_TOP,.22)
    rail('Funnel base walkway rail',[mid_b(s*x,z) for x,z in [(3.7,4.15),(3.7,7.73),(2.47,7.73),(2.47,12.85)]],MID_WELL_TOP,.95,1.3)
    # Vertical ladders from the 02 deck up the casing sides.
    mid_ladder('Casing ladder',mid_b3(s*2.62,11.05,11.2),mid_b3(s*2.62,13.9,11.2),.42,'y',to_wall=(0,s*.13))

# ---------------------------------------------------------------------------------------------
# 20 mm galleries: sponsons off the 02-level wall (x 8.5) with a 1.04 m splinter shield,
# knees to the wall, ready-use lockers and a spare-barrel case.
MID_GALLERY=[(8.47,13.55),(11.4,13.55),(11.4,20.27),(10.08,21.42),(8.47,21.42)];MID_GALLERY_TOP=11.227
for s,side in MID_SIDES:
    COL=collections['Superstructure'];ASSEMBLY='mid-aa-deck-'+side
    mid_slab('20 mm gallery deck',mid_mirror(MID_GALLERY,s),MID_GALLERY_TOP,.17)
    mid_wall('20 mm gallery splinter shield',mid_mirror(MID_GALLERY,s),MID_GALLERY_TOP-.17,12.28,.06,inside=(s*9.9,17.5))
    for z in [14.1,16.4,18.7,20.9]:
        knee('Gallery knee',mid_b3(s*(11.25 if z<20.2 else 10.2),MID_GALLERY_TOP-.17,z),mid_b3(s*8.5,MID_GALLERY_TOP-.17,z),1.25)
    for z in [15.39,17.78]:locker('20 mm ready-use locker',*mid_b(s*8.8,z),MID_GALLERY_TOP,(1.38,.6,.78),0 if s<0 else math.pi)
    # Tapered gusset ribs on the outboard face of the shield carry the gallery.
    for z in [14.3,16.2,18.1,19.9]:knee('Gallery gusset rib',mid_b3(s*11.56,12.2,z),mid_b3(s*11.41,12.2,z),1.5,.06)
    # Wall fittings on the block side above the gallery: emergency box and telephone.
    box('Emergency box',(*mid_b(s*8.55,14.52),12.73),(.40,.18,.30),'naval')
    box('Telephone box',(*mid_b(s*8.52,16.5),12.62),(.12,.10,.66),'naval')
    # Fire hose rack and fuel-oil hose on the block's after face and side.
    hose_reel('Fire hose reel',*mid_b(s*6.95,29.8),11.05,math.pi/2)
    for y in [11.62,11.8,11.98]:rod('Fuel-oil hose',mid_b3(s*8.57,y,23.07),mid_b3(s*8.57,y,25.42),.075,'canvas',vertices=6)
    for z in [23.5,24.25,25.0]:rod('Hose rack strap',mid_b3(s*8.5,11.52,z),mid_b3(s*8.5,12.08,z),.1,'edge',vertices=4)
    rod('Spare barrel case',mid_b3(s*11.49,11.0,16.98),mid_b3(s*11.49,12.18,18.25),.075,'naval',vertices=6)
    for k in [.25,.75]:rod('Spare barrel case clamp',mid_b3(s*11.40,11.0+1.18*k,16.98+1.27*k),mid_b3(s*11.58,11.0+1.18*k,16.98+1.27*k),.09,'edge',vertices=6)
for m in D['mounts']:
    if m['id'].startswith('oerlikon-high-'):AA_INSTALLED.add(m['id'])

# ---------------------------------------------------------------------------------------------
# Mk.51 directors (AD_17-26) in D-shaped splinter tubs: on the raised platforms' inboard
# corners, cantilevered over the well, on a column, and bracketed off the after funnel.
MID_MK51=[  # hardpoint x, floor y, z; tub (cx, cz, r, flat x) or outline; wall top
    (3.35,17.38,18.22,(3.22,18.23,.78,2.40),18.59),
    (1.99,18.55,22.87,(1.83,22.88,.78,2.51),19.65),
    (3.43,17.83,24.26,(3.34,24.27,.79,2.50),19.11),
    (3.27,18.80,30.75,(3.30,30.63,.82,2.20),20.00),
    (3.07,18.37,32.20,[(2.25,31.54),(3.25,31.56),(3.52,31.72),(3.65,31.92),(3.63,32.57),(3.45,32.82),(3.18,32.98),(2.62,33.07),(.75,33.14),(1.5,32.6)],19.45)]
for s,side in MID_SIDES:
    COL=collections['Masts and directors'];ASSEMBLY='mid-directors'
    for x,y,z,tub_shape,top in MID_MK51:
        outline=mid_d(*tub_shape) if isinstance(tub_shape,tuple) else tub_shape
        outline=mid_mirror(outline,s)
        mid_slab('Mk.51 tub floor',outline,y,.12)
        mid_wall('Mk.51 splinter tub',outline,y-.12,top,.05,True,coping=.025)
        mk51('Mk.51 director',*mid_b(s*x,z),y,-math.pi/2 if s>0 else math.pi/2)
        # Vertical stiffeners run down the round side and below the floor as brackets.
        if isinstance(tub_shape,tuple):
            cx,cz,r,flat=tub_shape;k=1 if cx>flat else -1
            for a in [-55,-18,18,55]:
                t=math.radians(a);px,pz=cx+k*(r+.03)*math.cos(t),cz+(r+.03)*math.sin(t)
                rod('Tub stiffener',mid_b3(s*px,y-.45,pz),mid_b3(s*px,top-.04,pz),.035,'naval',vertices=4)
    # AD_17/18 rests on the raised platform wall corner with two posts to the decks below.
    mid_post('Director tub post',s*2.72,18.22,MID_DECK_TOP,17.3,.08)
    mid_post('Director tub post',s*2.72,19.10,MID_RAISED_TOP,17.3,.08)
    # AD_19/20 hangs off the raised platform's inboard wall on posts and raking struts.
    for z in [22.53,23.2]:
        mid_post('Director bracket post',s*2.43,z,MID_RAISED_WALL,18.43,.07,6)
        rod('Director raking strut',mid_b3(s*1.42,18.43,z),mid_b3(s*2.45,16.6,z),.055,'naval',vertices=6)
    mid_ladder('Director tub ladder',mid_b3(s*2.75,MID_RAISED_TOP,23.28),mid_b3(s*2.75,19.95,23.28),.40,'y',to_wall=(0,s*.18))
    # AD_21/22 stands on a five-sided column from the well floor.
    mid_col=[mid_b(s*x,z) for x,z in [(3.44,24.83),(2.51,24.83),(2.51,23.71),(3.44,23.71),(3.68,24.28)]]
    platform('Director column',mid_col,17.72,17.72-MID_WELL_TOP,'naval')
    mid_ladder('Director column ladder',mid_b3(s*2.36,MID_WELL_TOP,24.27),mid_b3(s*2.36,19.5,24.27),.40,'y',to_wall=(0,-s*.15))
    mid_ladder('Director tub ladder',mid_b3(s*3.30,MID_RAISED_TOP,19.4),mid_b3(s*3.30,18.95,19.07),.40,'x')
    # AD_23-26 are bracketed off the after funnel jacket.
    for z,xo,xi,yy in [(30.15,3.9,2.38,18.68),(31.1,3.9,2.3,18.68),(32.0,3.55,1.98,18.25),(32.75,3.3,1.38,18.25)]:
        knee('Director tub knee',mid_b3(s*xo,yy,z),mid_b3(s*xi,yy,z),.6)
    mid_ladder('Director tub ladder',mid_b3(s*2.62,MID_WELL_TOP,31.55),mid_b3(s*2.62,20.2,31.55),.40,'y',to_wall=(0,s*.34))

# ---------------------------------------------------------------------------------------------
# Forward funnel: the 15.23 m walkway and the walled 17.58 m searchlight platform wrap its
# after end (aft of z 4.0; the Mk.37 platform forward of that is the fore tower's).
MID_LOW=[(7.73,4.06),(7.73,4.98),(3.61,4.98),(3.61,7.17),(2.43,7.2),(.94,10.31),(.58,10.72),(0,10.83)]
MID_UP=[(6.59,4.0),(7.39,5.2),(7.63,5.82),(7.64,6.44),(7.33,7.05),(6.93,7.41),(5.23,7.71),(2.55,7.93),(2.03,8.93),(.78,9.64),(.3,10.56),(0,10.77)]
def mid_both(half,z0):
    """Starboard half-outline plus its port mirror, closed across the funnel at z0."""
    return [(1.9,z0)]+half+[(-x,z) for x,z in reversed(half) if x>0]+[(-1.9,z0)]
COL=collections['Superstructure'];ASSEMBLY='funnel-forward'
mid_slab('Forward funnel lower platform',mid_both(MID_LOW,4.06),15.23,.19)
mid_slab('Forward funnel searchlight platform',mid_both(MID_UP,4.0),17.58,.21)
mid_low_rail=MID_LOW+[(-x,z) for x,z in reversed(MID_LOW) if x>0]
rail('Funnel platform rail',[mid_b(x,z) for x,z in mid_low_rail],15.23,1.0,1.4)
mid_tip=MID_UP[6:]+[(-x,z) for x,z in reversed(MID_UP[6:]) if x>0]
rail('Funnel platform rail',[mid_b(x,z) for x,z in mid_tip],17.58,1.0,1.4)
for s,side in MID_SIDES:
    mid_wall('Searchlight platform splinter wall',mid_mirror(MID_UP[:7],s),17.58,18.54,.06,inside=(s*6.0,6.0))
    # Plinth and 36-inch searchlight.
    box('Searchlight plinth',(*mid_b(s*6.42,6.02),17.85),(.70,.80,.54),'naval')
    searchlight('Forward funnel searchlight',*mid_b(s*6.42,6.02),18.12,.50,-math.pi/2 if s>0 else math.pi/2)
    # Posts and struts: lower platform to the decks below, upper platform to the lower.
    mid_post('Platform post',s*7.55,4.25,11.05,15.04,.07,6)
    mid_post('Platform post',s*7.55,4.8,11.05,15.04,.07,6)
    mid_post('Platform post',s*3.45,7.0,MID_WELL_TOP,15.04,.07,6)
    mid_post('Platform post',s*3.45,5.15,MID_WELL_TOP,15.04,.07,6)
    for x,z in [(5.33,5.4),(6.5,5.4),(6.5,6.95),(4.2,7.55)]:
        mid_post('Searchlight platform strut',s*x,z,15.23,17.37,.06,6)
    rod('Searchlight platform brace',mid_b3(s*7.5,15.3,4.6),mid_b3(s*7.2,17.37,6.6),.045,'naval',vertices=5)
    # Inclined ladder between the two levels.
    mid_ladder('Platform ladder',mid_b3(s*2.64,15.23,6.35),mid_b3(s*2.64,17.58,4.7),.52,'x')
mid_post('Platform post',0,10.45,MID_WELL_TOP,15.04,.07,6)
mid_post('Platform post',0,10.35,15.23,17.37,.07,6)
# Standard compass on the lower tip and pelorus on the upper.
cyl('Standard compass binnacle',(*mid_b(0,10.12),15.62),.18,.78,'naval',vertices=10)
cyl('Standard compass hood',(*mid_b(0,10.12),16.13),.24,.26,'naval',vertices=10,r2=.12)
cyl('Pelorus stand',(*mid_b(0,10.17),18.1),.11,1.04,'naval',vertices=8)
cyl('Pelorus head',(*mid_b(0,10.17),18.75),.2,.26,'edge',vertices=10)
rod('Pelorus sight vane',(*mid_b(0,9.97),18.92),(*mid_b(0,10.37),18.92),.02,'edge',vertices=4)

# ---------------------------------------------------------------------------------------------
# After funnel: flared searchlight sponsons at 23.1 m on the forward shoulders, each carried on
# a tapered bracket down to a small landing where the jacket ladder arrives.
def mid_loft(name,lower,upper,y0,y1,material='naval'):
    """Open plated band between two runtime outlines with equal point counts."""
    pb=[mid_b(x,z) for x,z in lower];pt=[mid_b(x,z) for x,z in upper];n=len(pb)
    return mesh(name,[(x,y,y0) for x,y in pb]+[(x,y,y1) for x,y in pt],[(i,(i+1)%n,n+(i+1)%n,n+i) for i in range(n)],material)
COL=collections['Superstructure'];ASSEMBLY='funnel-aft'
for s,side in MID_SIDES:
    mid_base=mid_mirror(mid_d(3.25,26.73,.9,2.2,10),s);mid_rim=mid_mirror(mid_d(3.25,26.73,1.28,2.2,10),s)
    mid_foot=mid_mirror(mid_d(3.0,26.8,.62,2.2,10),s)
    mid_slab('Searchlight sponson floor',mid_base,23.1,.14)
    mid_loft('Searchlight sponson flared plating',mid_base,mid_rim,22.96,24.02)
    tube_path('Sponson rolled rim',[(*mid_b(x,z),24.02) for x,z in mid_rim],.03,'naval',5,True)
    mid_loft('Searchlight sponson tapered bracket',mid_foot,mid_base,21.84,22.96)
    mid_slab('Sponson landing',mid_foot,21.84,.1)
    box('Searchlight plinth',(*mid_b(s*3.45,26.74),23.39),(.70,.80,.58),'naval')
    searchlight('After funnel searchlight',*mid_b(s*3.45,26.74),23.67,.50,-math.pi/2 if s>0 else math.pi/2)
    # Casing walkway aft of the block with a life-float net basket leaning on the funnel.
    mid_slab('Casing walkway',mid_mirror([(2.49,29.52),(3.15,29.52),(3.15,31.62),(2.49,31.62)],s),MID_WELL_TOP,.19)
    a,b=mid_b(s*4.05,29.72),mid_b(s*2.8,32.8)
    o=box('Floater net basket',((a[0]+b[0])/2,(a[1]+b[1])/2,13.27),(math.dist(a,b),.75,.97),'naval');o.rotation_euler.z=math.atan2(b[1]-a[1],b[0]-a[0])
    o=box('Floater net stowage',((a[0]+b[0])/2,(a[1]+b[1])/2,13.77),(math.dist(a,b)-.1,.65,.06),'canvas');o.rotation_euler.z=math.atan2(b[1]-a[1],b[0]-a[0])
    mid_post('Basket support',s*3.95,29.9,11.05,12.8,.05,5)
