"""Original KGV 1941 dimensional reconstruction. Run before flood/stability authoring.

The editable blueprint is the versioned asset. This retained construction study
records how its initial stations, compartments and component facets were made.
References are visual evidence only; no external meshes or textures are consumed.
"""
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
L, B, DRAFT, DEPTH = 227.08, 31.3944, 8.8392, 15.5773
DECK = DEPTH - DRAFT

def write(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')

def interp(points, s):
    for (a, va), (b, vb) in zip(points, points[1:]):
        if a <= s <= b:
            return va + (vb-va)*(s-a)/(b-a)
    return points[0][1] if s < points[0][0] else points[-1][1]

# Upper-deck silhouette read from NPB5309, uniformly registered over LOA.
# Smooth original fairing between stations; these are not builder's offsets.
shape = [(0,0),(.015,.13),(.04,.32),(.08,.52),(.13,.71),(.19,.85),
         (.27,.95),(.36,.992),(.44,1),(.55,1),(.64,.985),(.73,.90),
         (.81,.75),(.88,.55),(.94,.29),(.978,.105),(1,0)]
def fair(s):
    # Cubic monotone interpolation avoids a polygonal plan silhouette.
    p=[(t*L,w*B/2) for t,w in shape]
    for i,((a,va),(b,vb)) in enumerate(zip(p,p[1:])):
        if a <= s <= b:
            def slope(j):
                if j==0:return (p[1][1]-p[0][1])/(p[1][0]-p[0][0])
                if j==len(p)-1:return (p[-1][1]-p[-2][1])/(p[-1][0]-p[-2][0])
                d0=(p[j][1]-p[j-1][1])/(p[j][0]-p[j-1][0]);d1=(p[j+1][1]-p[j][1])/(p[j+1][0]-p[j][0])
                return 0 if d0*d1<=0 else 2*d0*d1/(d0+d1)
            t=(s-a)/(b-a)
            return (2*t**3-3*t*t+1)*va+(t**3-2*t*t+t)*(b-a)*slope(i)+(-2*t**3+3*t*t)*vb+(t**3-t*t)*(b-a)*slope(i+1)
    return 0

stations=sorted(set([round(L*i/120,7) for i in range(121)]+[0,.74,L-.74,L]))
half=[];decks=[];keels=[];sections=[]
for s in stations:
    t=s/L;w=max(0,min(B/2,fair(s)))
    deck=DECK+(.15*(1-t/.08)**2 if t<.08 else 0)
    # Rounded cruiser stern, broad flat floor amidships, fine near-vertical bow.
    keel=interp([(0,1.0),(.74,0),(5,-2.0),(14,-5.8),(28,-DRAFT),(L-18,-DRAFT),(L-4,-7),(L-.74,0),(L,DECK)],s)
    fullness=min(1,max(0,(t-.015)/.18),max(0,(.997-t)/.18))
    points=[]
    for u in [0,.035,.10,.20,.34,.50,.65,.78,.90,1]:
        z=keel+(deck-keel)*u
        if z<0:
            q=(z-keel)/max(.001,-keel)
            factor=(.58*fullness+(1-.58*fullness)*math.sin(q*math.pi/2)**.62)
        else:
            factor=1-.018*fullness*(z/max(deck,.1))
        points.append([round(w*factor,7),round(z,7)])
    # Waterline/boot bands inserted explicitly, preserving identical ring counts.
    for z in [-1.1,0]:
        zz=max(keel,min(deck,z));u=(zz-keel)/max(.001,deck-keel)
        if zz<0:
            q=(zz-keel)/max(.001,-keel);factor=.58*fullness+(1-.58*fullness)*math.sin(q*math.pi/2)**.62
        else:factor=1-.018*fullness*(zz/max(deck,.1))
        points.append([round(w*factor,7),round(zz,7)])
    points.sort(key=lambda p:p[1])
    half.append([s,w]);decks.append([s,deck]);keels.append([s,keel]);sections.append(dict(station=s,points=points))

def gunhouse(quad):
    footprint=([[-7.2,-2.9],[-5.7,-5.8],[2.4,-6.1],[5.6,-5.55],[5.6,5.55],[2.4,6.1],[-5.7,5.8],[-7.2,2.9]] if quad else
               [[-5.4,-2.4],[-4.4,-4.6],[2.4,-4.8],[4.6,-3.8],[4.6,3.8],[2.4,4.8],[-4.4,4.6],[-5.4,2.4]])
    vertices=[[x,y,.25] for x,y in footprint]+[[x-.9 if x>4 else x,y*.975,3.7] for x,y in footprint]
    faces=[]
    def face(label,indices,mm,finish='naval'):
        faces.append(dict(id=label,indices=indices,thicknessMm=mm,material='steel',finish=finish))
    for i in range(1,7):
        face('floor-'+str(i),[0,i+1,i],25)
        face('roof-'+str(i),[8,8+i,9+i],149,'roof')
    for i in range(8):
        j=(i+1)%8;mm=324 if i==3 else 174 if i in [0,6,7] else 225
        face('wall-'+str(i)+'-a',[i,j,j+8],mm);face('wall-'+str(i)+'-b',[i,j+8,i+8],mm)
    return dict(version=1,vertices=vertices,faces=faces,provenance=dict(sourceId='rn-mkiii-plan',basis='inferred',note='Original facets informed by Mk III plan and IWM A3655; published nominal face/side/rear/roof schedule, exact facets and local thickness transitions estimated.'))

catalogPath=ROOT/'assets/parts/guns.json';catalog=json.loads(catalogPath.read_text())
main=dict(kind='gun',barbetteRadius=6.1,gunhouseSize=[12.8,12.2,3.7],pivotHeight=1.85,trunnionForward=4.5,muzzleForward=17.1,
    barrelSpacing=2.4384,caliberM=.3556,traverseDeg=135,traverseRateDeg=2,elevationMinDeg=-3,elevationMaxDeg=40,elevationRateDeg=8,
    reloadSeconds=30,muzzleSpeed=754.38,projectileMassKg=721.21,penetrationMm=510,damage=64,recoilM=1.143,ammoPerBarrel=100,armorMm=324,
    barrelBaseRadius=.57,rangefinderWidth=12.5,rangefinderForward=-3.9,
    ballistics=dict(dragPerSecond=.011,dispersionRad=.0013,muzzleSpeedSigmaFraction=.0015,penetrationReferenceSpeedMps=754.38,basis='Game-calibrated linear drag and dispersion; muzzle speed and projectile mass from RMG B9. Not a range-table reproduction.'),
    ap=dict(armingResistanceMm=32,fuzeDelaySeconds=.025,explosiveKg=22,fragmentPenetrationMm=55,basis='Approximate APC bursting charge; arming threshold, delay and fragments are game calibration.'))
parts=[dict(main,id='bl-14-mkvii-quad',name='14-inch Mk VII quadruple',massKg=1582000,barrelCount=4,gunhouseMesh=gunhouse(True)),
       dict(main,id='bl-14-mkvii-twin',name='14-inch Mk VII twin',massKg=915000,barrelCount=2,barbetteRadius=4.7,gunhouseSize=[10,9.6,3.7],rangefinderWidth=9.14,rangefinderForward=-2.8,trunnionForward=3.6,muzzleForward=16.2,gunhouseMesh=gunhouse(False)),
       dict(id='qf-525-mki-twin',name='5.25-inch QF Mk I twin',kind='gun',massKg=78700,barbetteRadius=2.5,gunhouseSize=[5.6,4.4,2.5],pivotHeight=1.35,
            trunnionForward=1.7,muzzleForward=6.6,barrelSpacing=.96,barrelCount=2,caliberM=.13335,traverseDeg=80,traverseRateDeg=10,
            elevationMinDeg=-5,elevationMaxDeg=70,elevationRateDeg=10,reloadSeconds=8,muzzleSpeed=792.48,projectileMassKg=36.287,
            penetrationMm=145,damage=17,recoilM=.61,ammoPerBarrel=400,armorMm=25,barrelBaseRadius=.235,
            gunhouseShape=dict(footprint=[[-2.8,-1.5],[-2.2,-2.2],[1.6,-2.2],[2.8,-1.5],[2.8,1.5],[1.6,2.2],[-2.2,2.2],[-2.8,1.5]],roof=[[-2.8,-1.5,2.5],[-2.2,-2.2,2.5],[1.6,-2.2,2.5],[2.5,-1.5,1.65],[2.5,1.5,1.65],[1.6,2.2,2.5],[-2.2,2.2,2.5],[-2.8,1.5,2.5]]),
            ballistics=dict(dragPerSecond=.037,dispersionRad=.0017,penetrationReferenceSpeedMps=792.48,basis='RMG B9 muzzle speed; linear drag, dispersion and SAP mapped to shared AP are provisional.'),
            ap=dict(armingResistanceMm=14,fuzeDelaySeconds=.015,explosiveKg=1.8,fragmentPenetrationMm=24,basis='SAP represented by AP solver; explosive/fuze/fragment values are provisional.'),
            he=dict(explosiveKg=3.6,fragmentPenetrationMm=18,damage=20,stockFraction=.5,basis='Illustrative 50/50 SAP-equivalent and HE outfit; time fuzes and star shell omitted.'))]
newIds={p['id'] for p in parts};catalog['parts']=[p for p in catalog['parts'] if p['id'] not in newIds]+parts;write(catalogPath,catalog)

b=dict(schemaVersion=1,id='king-george-v',name='HMS King George V',configuration='Early 1941 Home Fleet exterior, before December AA refit; 1940 standard mean-draft datum',
 coordinates='meters-y-up-bow-negative-z',modelUrl='/models/king-george-v.glb',
 hull=dict(kind='authored-stations-v1',length=L,beam=B,draft=DRAFT,depth=DEPTH,massKg=38031*1016.0469088,waterplaneAreaM2=5400,reserveBuoyancyM3=22000,halfBreadths=half,deckHeights=decks,keelHeights=keels,sections=sections),
 handling=dict(forwardSpeed=28*.5144444444,reverseSpeed=3.8,acceleration=.22,braking=.28,rudderRate=.32,maxYawRate=.028),
 mounts=[],armor=[],compartments=[],modules=[],connections=[],obstructions=[],structures=[],
 viewpoints=dict(bridge=[0,25,-24]),structuralPlating=dict(hullMm=18,superstructureMm=8,note='Nominal collision skin only; exact plating scantlings not recovered.'),
 accuracy=dict(exterior='Original early-1941 reconstruction informed by Vickers as-fitted plans and IWM photographs. Principal dimensions sourced; station offsets, minor fittings and paint reflectance interpreted.',internals='Estimated machinery, magazines, partitions, flooding and stability for inspectable combat; not an as-built internal survey.',weapons='Ten 14-inch and sixteen 5.25-inch guns. Source-based bore, layout, speed and train/elevation; ballistics and damage calibrated for gameplay. Pom-poms, UP and aircraft are visual only.'))

for id,name,part,x,z in [('a','A','quad',50,DECK+.1),('b','B','twin',35,DECK+3.8),('y','Y','quad',-60,DECK+.1)]:
    b['mounts'].append(dict(id='main-'+id,name=name+' turret',partId='bl-14-mkvii-'+part,battery='main',position=[0,z,-x],bearingDeg=180 if id=='y' else 0,rangefinder=True,magazineId='magazine-'+id))
for side,sign in [('p',-1),('s',1)]:
    for i,(x,y,z) in enumerate([(12.5,11.4,DECK+.1),(2.0,11.4,DECK+3.25),(-23.5,11.4,DECK+3.25),(-34,11.4,DECK+.1)],1):
        b['mounts'].append(dict(id=f'secondary-{side}{i}',name=f'{side.upper()}{i} 5.25-inch',partId='qf-525-mki-twin',battery='secondary',position=[sign*y,z,-x],bearingDeg=sign*90,rangefinder=False,magazineId=f'magazine-{side}{i}'))

def structure(id,name,outline,z,height,material='naval'):
    b['structures'].append(dict(id=id,name=name,footprint=[[-y,-x] for x,y in outline],baseY=z,height=height,material=material))
def chamfer(cx,length,width,cut=1):
    return [(cx-length/2,-width/2+cut),(cx-length/2+cut,-width/2),(cx+length/2-cut,-width/2),(cx+length/2,-width/2+cut),(cx+length/2,width/2-cut),(cx+length/2-cut,width/2),(cx-length/2+cut,width/2),(cx-length/2,width/2-cut)]
structure('forward-shelter','Forward shelter deck',chamfer(14,37,18,4),DECK,3.1)
structure('hangar-port','Port aircraft hangar',[(-4,1),(-4,8),(8,8),(8,1)],DECK,6.0)
structure('hangar-starboard','Starboard aircraft hangar',[(-4,-8),(-4,-1),(8,-1),(8,-8)],DECK,6.0)
structure('after-shelter','After shelter deck',chamfer(-32,26,18,5),DECK,3.1)
structure('boat-deck','After boat deck',chamfer(-32,23.5,17,4),DECK+3.1,2.5)
structure('tower-base','Forward tower lower platform',chamfer(22,15,17,3.2),DECK+3.1,3.0)
structure('tower-middle','Forward tower signal deck',chamfer(22.5,13.5,14,2.5),DECK+6.1,3.0)
structure('tower-lower-bridge','Lower bridge',chamfer(22.4,11.8,12.2,1.9),DECK+9.1,3.0)
structure('tower-upper-bridge','Upper bridge and compass platform',chamfer(22.2,10.0,9.0,1),DECK+12.1,3.0)
structure('tower-admirals','Admirals bridge roof',chamfer(22.1,9.7,10.5,1),DECK+15.1,.23,'roof')
structure('director-forward-base','Forward main director base',chamfer(18.2,5.5,5.6,.8),DECK+15.3,3.0)
structure('director-aft-base','After main director tower',chamfer(-45.5,4.5,4.6,.6),DECK+2.0,5.8)
for id,x in [('forward-funnel',.8),('after-funnel',-23.4)]:
    outline=[(x+3.55*math.cos(t*math.tau/24),2.95*math.sin(t*math.tau/24)) for t in range(24)]
    structure(id,id.replace('-',' ').title(),outline,DECK+5.6,12.4)
for s in b['structures']:
    pts=s['footprint'];xs=[p[0] for p in pts];zs=[p[1] for p in pts]
    # Bounding proxies kept inside the visual platforms for firing clearance.
    b['obstructions'].append(dict(id=s['id'],center=[(min(xs)+max(xs))/2,s['baseY']+s['height']/2,(min(zs)+max(zs))/2],size=[max(xs)-min(xs)-.4,s['height'],max(zs)-min(zs)-.4]))

def room(id,name,center,size,kind=None,role=None,hp=150):
    cid=id+'-room';b['compartments'].append(dict(id=cid,name=name+' space',center=center,size=size,capacityM3=math.prod(size)*.78,pumpM3PerSecond=.014))
    if kind:
        module=dict(id=id,name=name,kind=kind,center=center,size=[s*.72 for s in size],hp=hp,compartmentId=cid,immersionToleranceM=.8)
        if role:module['role']=role
        b['modules'].append(module)
for id,x,size in [('a',50,[16,7,16]),('b',35,[12,7,12]),('y',-60,[16,7,18])]:room('magazine-'+id,id.upper()+' 14-inch magazine',[0,-3,-x],size,'magazine',hp=210)
for side,sign in [('p',-1),('s',1)]:
    for i,x in enumerate([12.5,2,-23.5,-34],1):room(f'magazine-{side}{i}',f'{side.upper()}{i} 5.25-inch magazine',[sign*10,-3,-x],[4.4,5,7],'magazine',hp=80)
groups=[]
for i,(side,sign,x) in enumerate([('port',-1,9),('starboard',1,9),('port',-1,-15),('starboard',1,-15)],1):
    boilerIds=[]
    for j,dx in enumerate([3.5,-3.5],1):
        bid=f'boiler-{i}-{j}';boilerIds.append(bid);room(bid,f'Boiler {i}.{j}',[sign*4.3,-3,-(x+dx)],[7,8,6.4],'engine','boiler',170)
    tid=f'turbine-{i}';room(tid,f'Turbine set {i}',[sign*4.3,-3,-(x-9.5)],[7,8,4.6],'engine','turbine',180)
    groups.append(dict(id=f'drive-{i}',share=.25,boilerIds=boilerIds,driveIds=[tid],shaftIds=[]))
room('steering','Steering gear',[0,-2.0,91],[8,5,9],'steering',hp=150)
b['propulsion']=dict(groups=groups,basis='Four equal turbine/shaft trains supplied by paired boilers. Eight boilers and four turbines are documented; room bounds and routing are estimated; shafts aggregated with turbines.')

def plate(id,name,vs,mm,exterior=False,basis='inferred'):
    lo=[min(v[i] for v in vs) for i in range(3)];hi=[max(v[i] for v in vs) for i in range(3)]
    b['armor'].append(dict(id=id,name=name,center=[(a+c)/2 for a,c in zip(lo,hi)],size=[max(.001,c-a) for a,c in zip(lo,hi)],thicknessMm=mm,
        plate=dict(vertices=vs,material='steel',exterior=exterior),provenance=dict(sourceId='kgv-protection',basis=basis,note='Published nominal KGV protection; placement and tapered belt reconstruction estimated. Steel uses the shared penetration model.')))
# Vertical all-or-nothing citadel, with thinner lower edge; no German turtleback.
for i,(a,c,mm,deckmm) in enumerate([(-72,-45,373,149),(-45,26,349,124),(26,62,373,149)]):
    # Longitudinal values are authoring +X; armor vertices are runtime coordinates.
    for side,sign in [('port',-1),('starboard',1)]:
        for j,(x0,x1) in enumerate(zip([a+(c-a)*k/8 for k in range(8)],[a+(c-a)*k/8 for k in range(1,9)])):
            w0=fair(x0+L/2)*.997;w1=fair(x1+L/2)*.997
            for label,y0,y1,th in [('upper',-1.2,4.6,mm),('taper',-2.5,-1.2,round(mm*.72)),('lower',-3.8,-2.5,137)]:
                plate(f'belt-{side}-{i}-{j}-{label}',f'{side.title()} {"magazine" if i!=1 else "machinery"} belt · {label}',[[sign*w0,y0,-x0],[sign*w1,y0,-x1],[sign*w1,y1,-x1],[sign*w0,y1,-x0]],th,True)
    for j in range(8):
        x0=a+(c-a)*j/8;x1=a+(c-a)*(j+1)/8;w0=fair(x0+L/2)*.987;w1=fair(x1+L/2)*.987
        plate(f'armored-deck-{i}-{j}','Magazine armored deck' if i!=1 else 'Machinery armored deck',[[-w0,4.65,-x0],[w0,4.65,-x0],[w1,4.65,-x1],[-w1,4.65,-x1]],deckmm)
for end,x in [('forward',62),('after',-72)]:
    w=fair(x+L/2)*.987
    plate('citadel-'+end,end.title()+' armored bulkhead',[[-w,-3.8,-x],[w,-3.8,-x],[w,4.6,-x],[-w,4.6,-x]],305 if end=='forward' else 254)
plate('steering-armored-deck','After steering protection · estimated deck',[[-6,1.1,73],[6,1.1,73],[4.5,1.1,98],[-4.5,1.1,98]],114)
plate('forward-protected-deck','Forward protective deck · estimated',[[-10,1.1,-63],[10,1.1,-63],[4,1.1,-96],[-4,1.1,-96]],64)
for mount in b['mounts'][:3]:
    radius=6.1 if mount['id']!='main-b' else 4.7;x=-mount['position'][2];top=mount['position'][1]+.12
    for i in range(24):
        a=i*math.tau/24;c=(i+1)*math.tau/24
        plate(mount['id']+'-barbette-'+str(i),mount['name']+' barbette',[[radius*math.cos(a),4.65,-x+radius*math.sin(a)],[radius*math.cos(c),4.65,-x+radius*math.sin(c)],[radius*math.cos(c),top,-x+radius*math.sin(c)],[radius*math.cos(a),top,-x+radius*math.sin(a)]],324)
b['damageControl']=dict(version=1,teams=4,setupSeconds=8,repairPoints=240,roomFuelSeconds=140,mountFuelSeconds=50,suppressionPerSecond=.065,portablePumpM3PerSecond=.09,repairHpPerSecond=.5,repairCeiling=.6,patchM2PerSecond=.012,maxPatchM2=.3,flashProtection=.88,basis='Shared provisional battleship crew/fuel/repair calibration; not historical manning, flash trials or damage-control performance.')
write(HERE/'blueprint.json',b)
print('Authored KGV blueprint and three original catalog components. Next: author-flood-spaces and author-stability, then ship:build.')
