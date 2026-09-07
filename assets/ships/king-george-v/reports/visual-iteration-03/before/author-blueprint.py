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
            return va if abs(b-a)<1e-9 else va + (vb-va)*(s-a)/(b-a)
    return points[0][1] if s < points[0][0] else points[-1][1]

# Original section study from Vickers NPB5265 (1937/38), checked against
# NPB5308/5309 as fitted July 1941. Manual raster readings, NOT builders offsets.
# Ordinate spacing 35 ft; no.1 registered at authoring X=112 m, +/-0.8 m.
# Heights are metres above the standard keel. The design S.W.L. is 28 ft,
# one foot below this model's 29 ft standard-load datum. No game offsets read.
LEVELS=[0,.18,.76,1.41,2.0574,3.3528,4.6482,5.9436,7.239,8.5344,9.8298,11.1252,13.30,15.5773]
# ordinate, keel height, upper-deck height, half breadths at LEVELS
LINES=[
 (1.5,0,17.12,[0,.025,.055,.11,.16,.22,.28,.36,.46,.61,.85,1.16,1.71,2.21]),
 (2,0,16.91,[0,.05,.12,.23,.39,.63,.83,1.02,1.20,1.41,1.70,2.16,3.20,4.12]),
 (3,0,16.59,[0,.09,.30,.59,.91,1.47,1.99,2.53,2.99,3.46,3.91,4.54,5.72,6.86]),
 (4,0,16.24,[0,.15,.57,1.13,1.63,2.51,3.40,4.25,4.92,5.55,6.10,6.74,7.82,8.82]),
 (5,0,15.99,[0,.26,.91,1.78,2.59,3.92,5.23,6.48,7.60,8.37,8.79,9.18,9.78,10.62]),
 (6,0,15.78,[0,.41,1.69,3.27,4.64,6.68,8.25,9.42,10.07,10.45,10.67,10.98,11.44,12.11]),
 (7,0,15.63,[0,.70,2.86,5.20,7.01,9.13,10.64,11.65,12.21,12.55,12.64,12.75,13.00,13.38]),
 (8,0,15.5773,[0,1.82,5.00,7.99,10.00,12.07,13.18,13.73,14.03,14.17,14.17,14.20,14.32,14.45]),
 (9,0,15.5773,[0,4.2,8.12,10.83,12.39,14.04,14.60,14.86,15.01,15.08,15.08,15.08,15.12,15.17]),
 (10,0,15.5773,[0,7.8,11.66,13.69,14.64,15.16,15.41,15.55,15.63,15.66,15.66,15.64,15.59,15.51]),
 (11,0,15.5773,[0,10.10,13.98,15.02,15.46,15.62,15.68,15.6972,15.6972,15.6972,15.6972,15.68,15.63,15.57]),
 (12,0,15.5773,[0,10.10,13.97,15.01,15.46,15.63,15.68,15.6972,15.6972,15.6972,15.6972,15.68,15.63,15.57]),
 (13,0,15.5773,[0,7.80,11.74,13.69,14.63,15.18,15.43,15.57,15.63,15.65,15.65,15.63,15.58,15.50]),
 (14,0,15.5773,[0,4.81,8.60,11.11,12.70,14.20,14.71,14.94,15.08,15.15,15.18,15.20,15.23,15.23]),
 (15,0,15.60,[0,2.22,5.05,7.97,9.89,12.11,13.22,13.82,14.12,14.26,14.35,14.43,14.54,14.61]),
 (16,0,15.63,[0,.59,2.06,4.0,5.88,8.80,10.48,11.72,12.50,12.99,13.22,13.52,13.82,14.07]),
 (17,0,15.67,[0,.15,.51,1.59,3.01,5.82,7.76,9.34,10.56,11.31,11.85,12.27,12.76,13.12]),
 (18,0,15.74,[0,.05,.15,.45,1.02,3.03,5.52,7.17,8.59,9.35,9.95,10.46,11.02,11.47]),
 (19,.30,15.81,[0,0,.08,.18,.44,1.51,3.37,5.02,6.45,7.08,7.69,8.31,9.04,9.52]),
 (20,2.1,15.88,[0,0,0,0,0,.11,.74,2.71,4.16,4.95,5.54,6.04,6.62,7.12]),
 (20.5,3.12,15.92,[0,0,0,0,0,.03,.39,1.75,3.05,3.99,4.62,5.13,5.72,6.24]),
 (21,5.30,15.97,[0,0,0,0,0,0,0,.52,1.83,2.83,3.47,3.96,4.63,5.15]),
 (21.5,5.94,16.02,[0,0,0,0,0,0,0,0,.52,1.76,2.30,2.69,3.14,3.51]),
 (22,7.239,16.06,[0,0,0,0,0,0,0,0,0,.95,1.03,1.10,1.17,1.28]),
]
# Shared continuous vertical sampling avoids degenerate clamped rings at the ends.
U=[0,.008,.016,.028,.046,.07,.10,.14,.19,.25,.32,.40,.49,.58,.66,.74,.82,.90,1]
def monotone(points,s):
 for i,((a,va),(b,vb)) in enumerate(zip(points,points[1:])):
  if a<=s<=b:
   def slope(j):
    if j==0:return (points[1][1]-points[0][1])/(points[1][0]-points[0][0])
    if j==len(points)-1:return (points[-1][1]-points[-2][1])/(points[-1][0]-points[-2][0])
    d0=(points[j][1]-points[j-1][1])/(points[j][0]-points[j-1][0]);d1=(points[j+1][1]-points[j][1])/(points[j+1][0]-points[j][0])
    return 0 if d0*d1<=0 else 2*d0*d1/(d0+d1)
   t=(s-a)/(b-a)
   return (2*t**3-3*t*t+1)*va+(t**3-2*t*t+t)*(b-a)*slope(i)+(-2*t**3+3*t*t)*vb+(t**3-t*t)*(b-a)*slope(i+1)
 return points[0][1] if s<points[0][0] else points[-1][1]
controls=[]
for number,keel,deck,ws in LINES:
 x=112-(number-1)*10.668
 profile=[(keel,0)]+[(z,w) for z,w in zip(LEVELS,ws) if z>keel]+[(deck,ws[-1])]
 profile=sorted(dict(profile).items())
 controls.append((x+L/2,keel-DRAFT,deck-DRAFT,[monotone(profile,keel+(deck-keel)*u) for u in U]))
# As-fitted stem/overhang registered at LOA. Waterline endpoints are 225.6 m
# apart under the adopted 29 ft load; the plan's true load and trim are uncertain.
controls += [(0,1.0,7.25,[0]*len(U)),(.74,0,7.25,[.12*math.sin(math.pi*u/2) for u in U]),
 (L-.74,0,8.38,[.08*math.sin(math.pi*u/2) for u in U]),(L,8.40,8.40,[0]*len(U)),
 (L-2.0,-8.70,8.35,[.015+.12*u+.12*u*u for u in U])]
controls.sort()
stations=sorted(set([round(L*i/200,7) for i in range(201)]+[c[0] for c in controls]))
half=[];decks=[];keels=[];sections=[]
for station in stations:
 keel=monotone([(c[0],c[1]) for c in controls],station);deck=monotone([(c[0],c[2]) for c in controls],station)
 ws=[min(B/2,max(0,monotone([(c[0],c[3][j]) for c in controls],station))) for j in range(len(U))]
 points=[[round(w,7),round(keel+(deck-keel)*u,7)] for w,u in zip(ws,U)]
 for zz in [-1.1,0]:
  height=max(keel,min(deck,zz));w=interp([(z,w) for w,z in points],height);points.append([round(w,7),round(height,7)])
 points.sort(key=lambda p:p[1])
 half.append([station,min(B/2,max(ws))]);decks.append([station,deck]);keels.append([station,keel]);sections.append(dict(station=station,points=points))
def fair(s):return interp(half,s)

def gunhouse(quad):
    if quad:
        floor=[(-6.9,-2.3),(-5.7,-5.5),(.5,-6.15),(5.6,-5.48),(5.6,5.48),(.5,6.15),(-5.7,5.5),(-6.9,2.3)]
        shoulder=[(x if x<4 else 5.10,y,2.55) for x,y in floor]
        roof=[(-6.55,-2.15,3.7),(-5.4,-5.13,3.7),(.5,-5.77,3.7),(4.85,-5.36,3.7),(4.85,5.36,3.7),(.5,5.77,3.7),(-5.4,5.13,3.7),(-6.55,2.15,3.7)]
    else:
        floor=[(-5.1,-1.95),(-4.2,-4.02),(.5,-4.72),(4.55,-4.32),(4.55,4.32),(.5,4.72),(-4.2,4.02),(-5.1,1.95)]
        shoulder=[(x if x<4 else 4.07,y,2.65) for x,y in floor]
        roof=[(-4.83,-1.81,3.70),(-3.96,-3.67,3.70),(.5,-4.39,3.70),(3.85,-4.21,3.70),(3.85,4.21,3.70),(.5,4.39,3.70),(-3.96,3.67,3.70),(-4.83,1.81,3.70)]
    vertices=[[x,y,.25] for x,y in floor]+[list(p) for p in shoulder]+[list(p) for p in roof]
    faces=[]
    def tri(label,idx,mm,finish='naval'):faces.append(dict(id=label,indices=idx,thicknessMm=mm,material='steel',finish=finish))
    for i in range(1,7):tri('floor-'+str(i),[0,i+1,i],25);tri('roof-'+str(i),[16,16+i,17+i],149,'roof')
    for layer in range(2):
      for i in range(8):
        j=(i+1)%8;a=layer*8+i;b=layer*8+j;c=b+8;d=a+8
        mm=324 if i==3 else 174 if i in [0,6,7] else 225
        tri(f'wall-{layer}-{i}-a',[a,b,c],mm);tri(f'wall-{layer}-{i}-b',[a,c,d],mm)
    return dict(version=1,vertices=vertices,faces=faces,provenance=dict(sourceId='rn-mkiii-plan',basis='inferred',note='Revision 2 original segmented faces and shoulders, read from RN Mk III plan / IWM A3655. Dimensions and thickness boundaries approximate; no game geometry.'))

catalogPath=ROOT/'assets/parts/guns.json';catalog=json.loads(catalogPath.read_text())
main=dict(kind='gun',barbetteRadius=6.1,gunhouseSize=[12.5,12.3,3.7],pivotHeight=1.85,trunnionForward=4.5,muzzleForward=17.1,
    barrelSpacing=2.4384,caliberM=.3556,traverseDeg=135,traverseRateDeg=2,elevationMinDeg=-3,elevationMaxDeg=40,elevationRateDeg=8,
    reloadSeconds=30,muzzleSpeed=754.38,projectileMassKg=721.21,penetrationMm=510,damage=64,recoilM=1.143,ammoPerBarrel=100,armorMm=324,
    barrelBaseRadius=.64,rangefinderWidth=12.5,rangefinderForward=-3.9,
    ballistics=dict(dragPerSecond=.011,dispersionRad=.0013,muzzleSpeedSigmaFraction=.0015,penetrationReferenceSpeedMps=754.38,basis='Game-calibrated linear drag and dispersion; muzzle speed and projectile mass from RMG B9. Not a range-table reproduction.'),
    ap=dict(armingResistanceMm=32,fuzeDelaySeconds=.025,explosiveKg=22,fragmentPenetrationMm=55,basis='Approximate APC bursting charge; arming threshold, delay and fragments are game calibration.'))
parts=[dict(main,id='bl-14-mkvii-quad',name='14-inch Mk VII quadruple',massKg=1582000,barrelCount=4,gunhouseMesh=gunhouse(True)),
       dict(main,id='bl-14-mkvii-twin',name='14-inch Mk VII twin',massKg=915000,barrelCount=2,barbetteRadius=4.7,gunhouseSize=[9.65,9.44,3.7],rangefinderWidth=9.14,rangefinderForward=-2.8,trunnionForward=3.6,muzzleForward=16.2,gunhouseMesh=gunhouse(False)),
       dict(id='qf-525-mki-twin',name='5.25-inch QF Mk I twin',kind='gun',massKg=78700,barbetteRadius=2.5,gunhouseSize=[5.4,4.65,3.05],pivotHeight=1.35,
            trunnionForward=1.7,muzzleForward=6.6,barrelSpacing=.96,barrelCount=2,caliberM=.13335,traverseDeg=80,traverseRateDeg=10,
            elevationMinDeg=-5,elevationMaxDeg=70,elevationRateDeg=10,reloadSeconds=8,muzzleSpeed=792.48,projectileMassKg=36.287,
            penetrationMm=145,damage=17,recoilM=.61,ammoPerBarrel=400,armorMm=25,barrelBaseRadius=.235,
            gunhouseShape=dict(footprint=[[-2.8,-1.5],[-2.2,-2.2],[1.6,-2.2],[2.8,-1.5],[2.8,1.5],[1.6,2.2],[-2.2,2.2],[-2.8,1.5]],roof=[[-2.5,-1.35,2.75],[-1.95,-2.0,3.05],[1.15,-2.0,3.05],[2.6,-1.45,1.85],[2.6,1.45,1.85],[1.15,2.0,3.05],[-1.95,2.0,3.05],[-2.5,1.35,2.75]]),
            ballistics=dict(dragPerSecond=.037,dispersionRad=.0017,penetrationReferenceSpeedMps=792.48,basis='RMG B9 muzzle speed; linear drag, dispersion and SAP mapped to shared AP are provisional.'),
            ap=dict(armingResistanceMm=14,fuzeDelaySeconds=.015,explosiveKg=1.8,fragmentPenetrationMm=24,basis='SAP represented by AP solver; explosive/fuze/fragment values are provisional.'),
            he=dict(explosiveKg=3.6,fragmentPenetrationMm=18,damage=20,stockFraction=.5,basis='Illustrative 50/50 SAP-equivalent and HE outfit; time fuzes and star shell omitted.'))]
secondary=next(p for p in parts if p['id']=='qf-525-mki-twin')
foot=[(-2.8,0),(-2.67,-.92),(-2.13,-1.77),(-1.24,-2.25),(.62,-2.25),(1.58,-1.94),(2.72,-1.38),(2.72,1.38),(1.58,1.94),(.62,2.25),(-1.24,2.25),(-2.13,1.77),(-2.67,.92)]
shoulder=[(x,y,2.45 if x<1.5 else 1.67) for x,y in foot]
roof=[(x+.21 if x<-1 else x-.22,y*.85,3.02 if x<.7 else 3.02-(x-.62)*(.55238)) for x,y in foot]
n=len(foot);vertices=[[x,y,.25] for x,y in foot]+[list(p) for p in shoulder]+[list(p) for p in roof];faces=[]
def secface(idx,label,finish='naval'):faces.append(dict(id=label,indices=idx,thicknessMm=25,material='steel',finish=finish))
for i in range(1,n-1):secface([0,i+1,i],'floor-'+str(i))
for label,polygon in [('rear',[0,1,2,3,4,9,10,11,12]),('nose',[4,5,6,7,8,9])]:
 for i in range(1,len(polygon)-1):secface([2*n+polygon[0],2*n+polygon[i],2*n+polygon[i+1]],'roof-'+label+'-'+str(i),'roof')
for level in range(2):
 for i in range(n):
  j=(i+1)%n;a=level*n+i;b=level*n+j;c=b+n;d=a+n
  secface([a,b,c],f'wall-{level}-{i}-a');secface([a,c,d],f'wall-{level}-{i}-b')
secondary.pop('gunhouseShape',None)
secondary['gunhouseMesh']=dict(version=1,vertices=vertices,faces=faces,provenance=dict(sourceId='rmg-npb5309',basis='inferred',note='Original Mk I curved-back and shoulder facets from 1941 drawings and photographs; GameModels3D raster cross-check only. Local facets are estimated.'))
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
structure('forward-shelter','Forward shelter deck',[(32,-3.7),(26,-8.2),(-4,-8.2),(-4,8.2),(26,8.2),(32,3.7)],DECK,3.05)
structure('hangar-port','Port aircraft hangar',[(-4,.7),(-4,8.2),(8,8.2),(8,.7)],DECK+3.05,3.1)
structure('hangar-starboard','Starboard aircraft hangar',[(-4,-8.2),(-4,-.7),(8,-.7),(8,-8.2)],DECK+3.05,3.1)
structure('after-shelter','After shelter deck',[(-46,-1.8),(-37,-8.3),(-18,-8.3),(-18,8.3),(-37,8.3),(-46,1.8)],DECK,3.05)
# Boat deck sits at the hangar roof level on pillars/open recesses, not a solid slab.
structure('boat-deck','After boat deck', [(-46,-1.8),(-37,-8.5),(-18,-8.5),(-18,8.5),(-37,8.5),(-46,1.8)],DECK+5.97,.18,'roof')
structure('boat-deck-trunk','After boat deck supporting trunk',chamfer(-35,13,8,1.5),DECK+3.05,2.92)
structure('tower-base','Forward tower lower platform',[(30,-3.7),(24.2,-8),(14,-8),(14,8),(24.2,8),(30,3.7)],DECK+3.05,3.05)
structure('tower-middle','Forward tower signal deck',[(29.9,-3.7),(24.6,-7.8),(15.6,-7.8),(9,-3.9),(9,3.9),(15.6,7.8),(24.6,7.8),(29.9,3.7)],DECK+6.1,3.05)
# Vertical tower trunk; the forward admiral's cabin and wings project beyond it.
structure('tower-lower-bridge','Lower bridge trunk',chamfer(23,10.4,8.5,.85),DECK+9.15,5.95)
structure('tower-admirals','Admiral bridge projecting cabin',[(24,-5.1),(27,-5.1),(31.0,-2.8),(31,2.8),(27,5.1),(24,5.1)],DECK+12.2,2.90)
structure('tower-upper-bridge','Navigation bridge glazed cabin',chamfer(28.6,5.4,7.2,.55),DECK+15.1,1.85)
structure('compass-shelter','Compass bridge glazed shelter',chamfer(28.1,4.9,6.8,.5),DECK+16.99,.80)
structure('director-forward-base','Forward 14-inch director seating',chamfer(22.3,4.5,4.5,.65),DECK+15.1,1.25)
structure('hacs-forward-tower','Forward HACS support',chamfer(15.1,2.8,3.0,.4),DECK+9.15,12.0)
structure('director-aft-base','After main director tower',chamfer(-45,4.0,4.1,.55),DECK+3.05,5.05)
for id,x in [('forward-funnel',.8),('after-funnel',-23.4)]:
    outline=[(x+3.48*math.cos(t*math.tau/40),2.75*math.sin(t*math.tau/40)) for t in range(40)]
    structure(id,id.replace('-',' ').title(),outline,DECK+5.6,12.40)
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
