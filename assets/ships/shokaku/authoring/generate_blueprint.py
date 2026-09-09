"""Original Shokaku 1941 arrangement, transcribed into the common v1 contract.

Run explicitly, then author-stability and author-local-damage; builds read blueprint.json only.
S01 dimensions and S02 drawing coordinates are distinguished in sources.json.
Hidden offsets, compartment arrangement and gameplay tuning are reconstructions.
"""
import json, math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
L, DRAFT, FLIGHT = 257.5, 8.87, 14.75
def r(v): return round(v, 5)
def xyz(x,y,z): return [r(-y),r(z),r(-x)]
def lerp(table,x):
    for (a,v),(b,w) in zip(table,table[1:]):
        if a <= x <= b: return v+(w-v)*(x-a)/(b-a)
    return table[0][1] if x < table[0][0] else table[-1][1]

# Uniform longitudinal registration of S02: stern 38, bow 4705 px.
# No reference pixels or third-party geometry are read by the build recipe.
def px(p): return (p-38)/(4705-38)*L-L/2
# Rounded cruiser stern and rising afterbody: S02 profile/plan, corroborated
# by the 23 August 1941 photographs S10. Hidden transverse offsets remain fairing.
stations=[(-128.75,0,6.15,6.65),(-127.5,4.8,2.2,6.65),(-126.6,6.0,0,6.6),
 (-124,7.2,-.55,6.55),(-119,8.4,-1.9,6.45),(-110,10.2,-4.4,6.1),
 (-100,11.0,-6.4,5.9),(-90,11.7,-8.0,5.7),(-75,12.4,-8.87,5.55),
 (-60,12.8,-8.87,5.5),(-40,13,-8.87,5.5),(-20,13,-8.87,5.5),
 (0,13,-8.87,5.5),(20,13,-8.87,5.5),(40,12.95,-8.87,5.55),
 (60,12.5,-8.87,5.9),(75,11.4,-8.87,6.4),(85,10,-8.87,7.2),
 (95,8.05,-8.87,8.6),(105,5.7,-8.87,9.7),(113,3.7,-8.87,10.25),
 (118,2.1,-8.87,10.35),(121.2,1.05,-8.87,10.4),(122.7,.50,-8.80,10.45),
 (123.05,.36,-8.25,10.45),(123.15,.32,0,10.45),(123.52,.25,4.14,10.45),
 (124.40,.19,6.4,10.45),(125.89,.10,8.61,10.45),(127.76,.03,10.04,10.45),
 (128.75,0,10.43,10.45)]
sections=[]
for x,w,k,top in stations:
    # A common 17-point half-ring keeps CPU surfaces and Blender identical.
    # Bilge and flare are fair original estimates; no original offset table survives here.
    points=[]
    for t,q in [(0,0),(.02,.37),(.06,.63),(.13,.82),(.23,.94),(.36,.98),
                (.5,1),(.61,1),(.70,1),(.76,1),(.81,.997),(.855,.993),
                (.9,.99),(.94,.988),(.97,.985),(.99,.984),(1,.983)]:
        z=k+(top-k)*t
        width=w*q
        if x < -75 and z < 1.5:
            # Fine V-shaped afterbody above the four external shafts. The
            # initial broad U section incorrectly enclosed the screws.
            stern=lerp([(-128.75,.14),(-110,.17),(-96,.25),(-85,.5),(-75,1)],x)
            width*=stern+(1-stern)*max(0,min(1,(z+7.5)/9.0))**2
        if 118 <= x <= 123.05 and z < 0:
            # Submerged bulb is separate from the raked upper stem in the loft.
            width=max(width, max(0,1.5-abs(z+3.4)*.36)*(123.8-x)/5.8)
        points.append([r(width),r(z)])
    sections.append(dict(station=r(x+L/2),points=points))

structures=[]
def poly(id,name,points,base,height,material='naval',**extra):
    s=dict(id=id,name=name,footprint=[[r(-y),r(-x)] for x,y in points],baseY=r(base),height=r(height),material=material,**extra)
    structures.append(s);return s
def rect(id,name,x,y,length,width,base,height,material='naval',cut=0):
    a,b=x-length/2,x+length/2;c,d=y-width/2,y+width/2
    points=[(a+cut,c),(b-cut,c),(b,c+cut),(b,d-cut),(b-cut,d),(a+cut,d),(a,d-cut),(a,c+cut)] if cut else [(a,c),(b,c),(b,d),(a,d)]
    return poly(id,name,points,base,height,material)

# Flight deck length 242.2 m. The forward flare and island cut-in follow S02.
aft,fore=-125.05,117.15
outline=[(aft,-9.3),(aft+7.8,-14.05),(-40,-14.05),(-10,-14.5),
 (26,-14.5),(26,-10.7),(53,-10.7),(53,-13.7),(76,-12.3),
 (fore,-9.5),(fore,9.5),(76,12.3),(55,13.5),(38,14.5),
 (-48,14.5),(-100,14.1),(aft+7.8,14.05),(aft,9.3)]
def flight_level(x):return FLIGHT-.62*max(0,min(1,(-118.5-x)/6.55))**2
# A round-down at the stern is part of the physical surface, not a second skin.
fd=poly('flight-deck','Wood flight deck on steel girders',outline,FLIGHT-.96,.96,'deck')
def triangulate(points):
    ids=list(range(len(points)));result=[]
    area=sum(a[0]*b[1]-b[0]*a[1] for a,b in zip(points,points[1:]+points[:1]))
    sign=1 if area>0 else -1
    def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    while len(ids)>3:
        for j,k in enumerate(ids):
            a,b,c=ids[j-1],k,ids[(j+1)%len(ids)]
            if sign*cross(points[a],points[b],points[c])<=1e-9:continue
            if any(all(sign*cross(points[u],points[w],points[q])>=-1e-9 for u,w in [(a,b),(b,c),(c,a)]) for q in ids if q not in [a,b,c]):continue
            result.append([a,b,c]);ids.pop(j);break
        else:raise ValueError('Flight-deck triangulation failed')
    return result+[ids]
def clip_x(points,bound,keep_above):
    out=[]
    for a,b in zip(points,points[1:]+points[:1]):
        ia=a[0]>=bound if keep_above else a[0]<=bound
        ib=b[0]>=bound if keep_above else b[0]<=bound
        if ia:out.append(a)
        if ia!=ib:
            t=(bound-a[0])/(b[0]-a[0]);out.append((bound,a[1]+t*(b[1]-a[1])))
    return out
vertices=[];triangles=[]
# Cross-sections keep the central flight deck planar while only the round-down curves.
breaks=[aft,-124,-122,-120,-118.5,fore]
for lo,hi in zip(breaks,breaks[1:]):
    pts=clip_x(clip_x(outline,lo,True),hi,False)
    # Clipping at an existing corner can repeat the endpoint.
    pts=[q for i,q in enumerate(pts) if i==0 or math.dist(q,pts[i-1])>1e-7]
    if math.dist(pts[0],pts[-1])<1e-7:pts.pop()
    base=len(vertices);n=len(pts)
    vertices.extend(xyz(x,y,flight_level(x)-d) for d in [.34,0] for x,y in pts)
    faces=triangulate(pts)
    triangles.extend([base+c,base+b,base+a] for a,b,c in faces)
    triangles.extend([base+n+a,base+n+b,base+n+c] for a,b,c in faces)
for a,b in zip(outline,outline[1:]+outline[:1]):
    ts=[0,1]+[(x-a[0])/(b[0]-a[0]) for x in breaks[1:-1] if min(a[0],b[0])<x<max(a[0],b[0])]
    for t,u in zip(sorted(ts),sorted(ts)[1:]):
        p=(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t);q=(a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u);n=len(vertices)
        vertices.extend(xyz(x,y,flight_level(x)-d) for x,y,d in [(*p,.34),(*q,.34),(*q,0),(*p,0)])
        triangles.extend([[n,n+1,n+2],[n,n+2,n+3]])
fd['surface']=dict(vertices=vertices,triangles=triangles)
# Two enclosed hangars; end decks remain open under the overhangs.
rect('lower-hangar','Lower hangar casing',-5,0,180,19,5.3,4.7,cut=3)
rect('upper-hangar','Upper hangar casing',-1,0,200,21,10,4.41,cut=4)
rect('lower-hangar-floor','Lower hangar floor',-5,0,180,18.9,5.28,.14,'steel-deck',cut=3)
for id,x,length,width in [('forward',37.7,13,16),('middle',-20.4,13,12),('aft',-84.2,13,12)]:
    rect('elevator-'+id,'Aircraft elevator '+id,x,0,length,width,FLIGHT+.006,.025,'elevator',cut=1.1)

# S02 profile/plan and dated S10 photographs: compact lower body, projecting
# navigation wings, forward glazed conning room and an open upper platform.
# Each tier has its own footprint; do not substitute concentric chamfered boxes.
IY=-13.35
def island_shape(a,b,half,front=1.0,aft=.35,offset=0):
    y=IY+offset
    return [(a,y-half+aft),(a+aft,y-half),(b-front,y-half),
            (b-front*.35,y-half*.72),(b,y-half*.32),(b,y+half*.32),
            (b-front*.35,y+half*.72),(b-front,y+half),(a+aft,y+half),(a,y+half-aft)]
# S02 floor lines are at y=358,316,272 and233 px, not the tops of
# their railings/bulwarks. The latter had added a spurious half-deck.
poly('island-foundation','Island foundation gallery',island_shape(26.6,49.0,3.15,1.3,.5),FLIGHT-.4,.24,'naval')
# Room roofs meet the underside of the next plate. Extending them to its top
# produces two visible coplanar skins wherever the upper room steps back.
poly('island-base','Island lower bridge',island_shape(32.1,46.5,2.3,1.15,.25),12.25,2.34)
# Meet the existing flight-deck cutout at y=-10.7, without double-covering it.
walkway=[(x,y) for y,x in clip_x([(y,x) for x,y in island_shape(29.1,48.2,3.0,1.2,.4)],-10.7,False)]
poly('bridge-walkway','Flight-level signal gallery',walkway,14.59,.16,'steel-deck')
poly('bridge-chartroom','Chartroom and signal bridge',island_shape(34.1,45.45,2.25,1.1,.3),14.75,2.15)
poly('navigation-wings','Projecting navigation wings',island_shape(31.0,46.8,3.0,1.35,.35),16.90,.16,'steel-deck')
poly('navigation-bridge','Navigation bridge lower house',island_shape(34.1,45.1,2.10,1.1,.35),17.06,2.24)
poly('compass-platform','Compass bridge platform',island_shape(32.5,45.6,2.85,1.45,.55),19.30,.16,'steel-deck')
poly('air-control','Glazed conning and air-control bridge',island_shape(35.7,44.5,1.90,1.35,.5),19.46,2.02)
poly('bridge-roof','Open compass and signal platform',island_shape(34.0,45.0,2.05,1.35,1.25),21.48,.16,'steel-deck')
poly('island-boat-gallery','Launch gallery beneath the island',[(32.3,-10.2),(44.6,-10.2),(45.0,-12.0),(44.1,-16.1),(33.0,-16.1),(31.8,-14.0)],9.35,.25,'steel-deck')
# S02's open two-level after boat stowage below the flight-deck overhang.
poly('stern-boat-deck','Open after boat deck',[(-125.0,-5.4),(-122.9,-8.2),(-99.1,-9.9),(-98.5,-9),(-98.5,9),(-99.1,9.9),(-122.9,8.2),(-125.0,5.4)],9.35,.22,'steel-deck')

# Bent rectangular funnel shells, expressed as physical surfaces for CPU hits.
for id,x in [('forward',10.0),('after',-2.0)]:
    # S02 shows the funnel crowns below the flight deck. Account for the
    # 0.8 m half-depth of the casing, rather than putting its center on the roof.
    path=[(-10.25,10.4),(-12.2,12.0),(-14.0,13.0),(-16.0,13.3),(-18.2,13.1),(-19.4,12.85)]
    vertices=[]
    for i,(y,z) in enumerate(path):
        a=path[max(0,i-1)];b=path[min(len(path)-1,i+1)];dy,dz=b[0]-a[0],b[1]-a[1]
        norm=math.hypot(dy,dz);ny,nz=-dz/norm,dy/norm
        for dx,v in [(-4.4,-.8),(4.4,-.8),(4.4,.8),(-4.4,.8)]: vertices.append(xyz(x+dx,y+ny*v,z+nz*v))
    triangles=[]
    for j in range(len(path)-1):
        for i in range(4):
            a=j*4+i;b=j*4+(i+1)%4;c=b+4;d=a+4
            triangles.extend([[a,b,c],[a,c,d]])
    poly(id+'-funnel',id.title()+' downturned exhaust funnel',[(x-4.4,-10),(x+4.4,-10),(x+4.4,-20),(x-4.4,-20)],9.5,6.0,'naval',
      surface=dict(vertices=vertices,triangles=triangles),exhaust=dict(position=xyz(x,-19.6,12.8),width=1.1,length=7.8))

mounts=[]
def gun(id,part,x,y,z,bearing,battery):
    mounts.append(dict(id=id,name=id.replace('-',' ').title(),partId=part,battery=battery,position=xyz(x,y,z),bearingDeg=bearing,rangefinder=False,
      magazineId='magazine-forward' if x>0 else 'magazine-aft'))
for side,sign,bearing in [('port',1,-90),('starboard',-1,90)]:
    aft=[-57.2,-71.0] if side=='port' else [-41.2,-55.7]
    for n,x in enumerate([75.7,56.0,*aft],1):
        part='type89-127-a1-mod2-twin' if side=='starboard' and n>=3 else 'type89-127-a1-twin'
        # S02 profile's AA gallery is below the flight deck. The initial
        # 12.5 m foundation put the mount mechanisms through the deck edge.
        gun('aa127-'+side+'-'+str(n),part,x,sign*(14.8 if x>0 else 16.05),10.5,bearing,'main')
for side,sign,bearing,xs in [('port',1,-90,[-42.0,-34.7,-18.6,-11.5,-3.9,3.2]),
                           ('starboard',-1,90,[-98.2,-91.3,-75.3,-68.8,15.2,22.4])]:
    for n,x in enumerate(xs,1):
        shield=side=='starboard' and n in [3,4]
        y=17.9 if side=='starboard' and n>=5 else 16.15
        gun('aa25-'+side+'-'+str(n),'type96-25-triple-shielded' if shield else 'type96-25-triple',x,sign*y,14.25,bearing,'secondary')

compartments=[];modules=[];connections=[];floodRegions=[]
def room(id,x,y,z,length,width,height,kind=None):
    c=dict(id=id,name=id.replace('-',' ').title(),center=xyz(x,y,z),size=[width,height,length],capacityM3=r(length*width*height*.72),pumpM3PerSecond=.028)
    compartments.append(c)
    if kind:
        mid='magazine-forward' if id=='forward-ordnance' else 'magazine-aft' if id=='aft-ordnance' else id+'-module'
        modules.append(dict(id=mid,name=c['name'],kind=kind,center=c['center'],size=[r(width*.66),r(height*.66),r(length*.7)],hp=140 if kind=='engine' else 90,compartmentId=id,
          **(dict(role='boiler' if 'boiler' in id else 'turbine') if kind=='engine' else {})))
    return c
room('forward-ordnance',86,0,-3.0,19,9.8,6.0,'magazine')
room('aft-ordnance',-78,0,-3.0,20,12.0,6.0,'magazine')
for n,x in enumerate([47,31,15,-1],1):
    for side,sign in [('port',1),('starboard',-1)]:room('boiler-'+side+'-'+str(n),x,sign*5.1,-3.7,14,9.2,6.6,'engine')
for n,x in enumerate([-20,-42],1):
    for side,sign in [('port',1),('starboard',-1)]:room('turbine-'+side+'-'+str(n),x,sign*5.1,-3.7,19,9.2,6.6,'engine')
room('steering-room',-105,0,-1.7,12,7.0,4.5,'steering')
room('aviation-service-room',51,0,2.3,16,11,4.3,'generator')
modules[-1]['id']='aviation-service';modules[-1]['name']='Air group service and power'
for side,sign in [('port',1),('starboard',-1)]:
    for n,x in enumerate([61,35,9,-17,-43,-65],1):
        c=room('wing-void-'+side+'-'+str(n),x,sign*11.1,-2.1,23,1.5,7.5)
        floodRegions.append(dict(id='flood-'+c['id'],compartmentId=c['id'],center=xyz(x,sign*12.4,-1.5),size=[3,10,25],face=side))
room('forepeak',109,0,2.4,15,4.5,5)
room('afterpeak',-117,0,2.0,8,5,3.5)
for a,b in zip(sorted(compartments,key=lambda c:c['center'][2]),sorted(compartments,key=lambda c:c['center'][2])[1:]):
    connections.append(dict(fromId=a['id'],toId=b['id'],areaM2=.014))
for side,sign in [('port',1),('starboard',-1)]:
    for end,x in [('forward',38.5 if side=='port' else 41.5),('aft',-64.6 if side=='port' else -48.0)]:
        ids=[m['id'] for m in mounts if side in m['id'] and ((m['position'][2]<0)==(x>0))]
        island=side=='starboard' and end=='forward'
        modules.append(dict(id='director-'+side+'-'+end,name='Type 94 director '+side+' '+end,kind='fire-control',placement='fixed',center=xyz(36.75 if island else x,-13.35 if island else sign*16.0,24.65 if island else 15.8),size=[1.65,1.65,1.65],hp=65,protectionMm=8,immersionToleranceM=.5,servesMountIds=ids))

armor=[]
def plate(id,name,vs,thickness,source='s04',basis='inferred'):
    vs=[xyz(*v) for v in vs];center=[sum(v[i] for v in vs)/len(vs) for i in range(3)]
    size=[max(.01,max(v[i] for v in vs)-min(v[i] for v in vs)) for i in range(3)]
    armor.append(dict(id=id,name=name,center=center,size=size,thicknessMm=thickness,
      plate=dict(vertices=vs,material='steel'),provenance=dict(sourceId=source,basis=basis,note='Published nominal thickness; extent and local contours are estimated.')))
for side,sign in [('port',1),('starboard',-1)]:
    plate('machinery-belt-'+side,'Machinery belt '+side,[(-60,sign*12.5,-3.5),(67,sign*12.5,-3.5),(67,sign*12.5,1.6),(-60,sign*12.5,1.6)],46)
    for end,x,width in [('forward',86,10.0),('aft',-78,12.2)]:
        plate('magazine-belt-'+side+'-'+end,'Magazine belt '+side+' '+end,[(x-10,sign*width/2,-6.2),(x+10,sign*width/2,-6.2),(x+10,sign*width/2,0),(x-10,sign*width/2,0)],165)
plate('machinery-deck','Protective deck over machinery',[(-60,-12.2,1.65),(67,-12.2,1.65),(67,12.2,1.65),(-60,12.2,1.65)],65)
for end,x,w in [('forward',86,10),('aft',-78,12.2)]:plate('magazine-deck-'+end,'Magazine crown '+end,[(x-10,-w/2,0),(x+10,-w/2,0),(x+10,w/2,0),(x-10,w/2,0)],132)

b=dict(schemaVersion=1,id='shokaku',name='IJN Shōkaku',configuration='December 1941; original armament; 48-aircraft gameplay complement; sourced reconstruction with unresolved offsets',
 coordinates='meters-y-up-bow-negative-z',modelUrl='/models/shokaku.glb',
 hull=dict(kind='authored-stations-v1',length=L,beam=26,draft=DRAFT,depth=19.32,massKg=32105000,waterplaneAreaM2=5050,reserveBuoyancyM3=15500,
  halfBreadths=[[s['station'],max(p[0] for p in s['points'])] for s in sections],deckHeights=[[s['station'],s['points'][-1][1]] for s in sections],keelHeights=[[s['station'],s['points'][0][1]] for s in sections],sections=sections),
 handling=dict(forwardSpeed=34*1852/3600,reverseSpeed=3.6,acceleration=.20,braking=.17,rudderRate=.4,maxYawRate=.023),
 mounts=mounts,mountEnvelope=dict(beam=42,length=L),structures=structures,armor=armor,modules=modules,compartments=compartments,connections=connections,floodRegions=floodRegions,
 structuralPlating=dict(hullMm=19,superstructureMm=8,note='Continuous structural hit coverage, provisional ordinary-steel shell; separate researched armor schedule.'),
 obstructions=[dict(id='hangar-block',center=xyz(0,0,10),size=[21,8.8,198]),dict(id='island-block',center=xyz(39.6,IY,18.2),size=[4.4,6.9,11.0])],
 viewpoints=dict(bridge=xyz(43.6,-12.6,21.10)),
 airWing=dict(version=1,launchPosition=xyz(16,0,FLIGHT),recoveryPosition=xyz(-109,0,FLIGHT),serviceModuleId='aviation-service',launchIntervalSeconds=2,rearmSeconds=35,flightSize=6,deckCapacity=12,maxActiveFlights=4,
  squadrons=[dict(id='shokaku-fighters',name='Shōkaku fighter group',modelId='a6m2-zero',role='fighter',count=16),dict(id='shokaku-dive',name='Shōkaku dive bomber group',modelId='d3a1-val',role='dive-bomber',count=16),dict(id='shokaku-torpedo',name='Shōkaku attack group',modelId='b5n2-kate',role='torpedo-bomber',count=16)]),
 rig=dict(version=1,ensigns=[dict(id='shokaku-ensign',design='ijn',position=xyz(27.3,IY,27.1),width=2.8,staffHeight=0)],radars=[]),
 damageControl=dict(version=1,teams=4,setupSeconds=6,repairPoints=190,roomFuelSeconds=200,mountFuelSeconds=65,suppressionPerSecond=.055,portablePumpM3PerSecond=.07,repairHpPerSecond=1.3,repairCeiling=.65,patchM2PerSecond=.001,maxPatchM2=.12,flashProtection=.35,basis='Provisional carrier damage-control calibration; no historical crew-performance claim.'),
 accuracy=dict(exterior='Independent original geometry based on S01-S06. S02 is a secondary arrangement with unverified drawing provenance; hidden offsets and exact bridge dimensions remain unresolved.',internals='Named machinery, ordnance, service, steering and side voids are gameplay volumes, not a recovered ship subdivision plan.',weapons='Six open Type 89 A1 and two gas-shielded A1 Mod 2 twins; twelve Type 96 triples. Positions are plan-measured estimates. Ballistics, service timings, ammunition and aircraft flight performance remain gameplay calibration.'))
# Physical deck geometry; operating capacity remains profile-specific.
b['airWing']['deckLayout'] = {'version': 1, 'surfaceId': 'flight-deck', 'spots': [{'id': 'park-1-port', 'position': [-8, 14.78, -23.0], 'preferredRole': 'fighter'}, {'id': 'park-1-starboard', 'position': [7.5, 14.78, -23.0], 'preferredRole': 'fighter'}, {'id': 'park-2-port', 'position': [-8, 14.78, -11.8], 'preferredRole': 'fighter'}, {'id': 'park-2-starboard', 'position': [7.5, 14.78, -11.8], 'preferredRole': 'fighter'}, {'id': 'park-3-port', 'position': [-8, 14.78, -0.6], 'preferredRole': 'dive-bomber'}, {'id': 'park-3-starboard', 'position': [7.5, 14.78, -0.6], 'preferredRole': 'dive-bomber'}, {'id': 'park-4-port', 'position': [-8, 14.78, 10.6], 'preferredRole': 'dive-bomber'}, {'id': 'park-4-starboard', 'position': [7.5, 14.78, 10.6], 'preferredRole': 'dive-bomber'}, {'id': 'park-5-port', 'position': [-8, 14.78, 21.8], 'preferredRole': 'torpedo-bomber'}, {'id': 'park-5-starboard', 'position': [8, 14.78, 21.8], 'preferredRole': 'torpedo-bomber'}, {'id': 'park-6-port', 'position': [-8, 14.78, 32.4], 'preferredRole': 'torpedo-bomber'}, {'id': 'park-6-starboard', 'position': [8, 14.78, 33.0], 'preferredRole': 'torpedo-bomber'}, {'id': 'park-7-port', 'position': [-8, 14.78, 44.2], 'preferredRole': 'fighter'}, {'id': 'park-7-starboard', 'position': [8, 14.78, 44.2], 'preferredRole': 'fighter'}, {'id': 'park-8-port', 'position': [-8, 14.78, 55.4], 'preferredRole': 'fighter'}, {'id': 'park-8-starboard', 'position': [8, 14.78, 55.4], 'preferredRole': 'fighter'}, {'id': 'park-9-port', 'position': [-8, 14.78, 66.6], 'preferredRole': 'dive-bomber'}, {'id': 'park-9-starboard', 'position': [8, 14.78, 66.6], 'preferredRole': 'dive-bomber'}, {'id': 'park-10-port', 'position': [-8, 14.78, 77.4], 'preferredRole': 'dive-bomber'}, {'id': 'park-10-starboard', 'position': [8, 14.78, 77.8], 'preferredRole': 'dive-bomber'}, {'id': 'park-11-port', 'position': [-8, 14.78, 89.0], 'preferredRole': 'torpedo-bomber'}, {'id': 'park-11-starboard', 'position': [8, 14.78, 89.0], 'preferredRole': 'torpedo-bomber'}, {'id': 'park-12-port', 'position': [-8, 14.78, 100.2], 'preferredRole': 'torpedo-bomber'}, {'id': 'park-12-starboard', 'position': [8, 14.78, 100.2], 'preferredRole': 'torpedo-bomber'}], 'launchStart': [0, 14.78, -37.7], 'launchEnd': [0, 14.78, -110], 'recoveryTouchdown': [0, 14.78, 111], 'recoveryStop': [0, 14.78, 88], 'elevators': [{'id': 'elevator-forward', 'position': [0, 14.78, -37.7], 'hangarY': 9.4, 'widthM': 16, 'lengthM': 13}]}
(ROOT/'blueprint.json').write_text(json.dumps(b,ensure_ascii=False,indent=2)+'\n')
print('Shokaku blueprint:',len(sections),'hull sections,',len(mounts),'mounts,',len(compartments),'compartments')
