"""Original editable hull stations and structure polygons for the approved Hipper fit.

Measurements are rounded visual interpretations in metres. This authoring helper
reads no external model, image or transform; the blueprint is the runtime contract.
"""
import json,math
from pathlib import Path
DIR=Path(__file__).resolve().parents[1]
L=205.4
# Reference hull endpoint alignment: the source stern staff projects behind the
# physical shell. Authoring measurements below use a +1.3 m auxiliary datum;
# the compiled blueprint is centered on the original physical hull.
ORIGIN=1.3
world_outline=[(-101.4,0),(-101.1,.95),(-100.6,1.68),(-100,2.25),(-99,2.95),(-97,3.72),(-95,4.25),(-90,5.25),(-84,6.20),(-79,6.84),(-74,7.45),(-69,7.98),(-64,8.47),(-59,8.91),(-54,9.28),(-44,9.75),(-34,10.02),(-24,10.28),(-14,10.43),(-4,10.56),(6,10.56),(16,10.43),(26,10.30),(36,9.87),(46,9.43),(56,8.72),(66,7.72),(76,6.58),(86,5.02),(92,4.02),(96,3.28),(98,2.62),(100,2.0),(101,1.62),(102,1.23),(103,.72),(104,0)]
outline=[(round(x+101.4,4),w) for x,w in world_outline]
def stations(points):return [(round(x+101.4,4),h) for x,h in points]
deck=stations([(-101.4,4.95),(-79,4.94),(-54,4.78),(-4,4.51),(24,4.64),(40,4.70),(50,4.78),(55,4.84),(61,4.885),(67,4.965),(70,5.01),(75,5.17),(80,5.36),(86,5.70),(90,5.93),(94,6.22),(98,6.58),(100,6.77),(102,6.98),(104,7.32)])
keel=stations([(-101.4,4.95),(-100,3.10),(-99,.90),(-96,-1.20),(-92,-2.18),(-88,-2.6),(-84,-3.1),(-80,-3.7),(-76,-5.7),(-72,-6.7),(-64,-7.74),(96,-7.74),(99,-7.74),(100,-7.7),(101,-5.4),(102,-.80),(103,3.80),(104,7.32)])
def interp(tab,s):
 for (a,v),(b,w) in zip(tab,tab[1:]):
  if a<=s<=b:return v+(w-v)*(s-a)/(b-a)
 return tab[-1][1]
sections=[]
# Preserve sheer and keel breakpoints in the loft itself, as well as its
# nominal height tables, so the deck mesh follows the same editable curve.
for s in sorted(set(p[0] for tab in [outline,deck,keel] for p in tab)):
 w=interp(outline,s)
 k,t=interp(keel,s),interp(deck,s)
 # Full rounded bilges amidships, finer stern run and increasing bow flare.
 # The source's maximum underwater beam lies below the waterline; keeping
 # the lower control points near the keel avoids an erroneous V-shaped body.
 flare=max(0,min(1,(s-165)/43));stern=max(0,1-s/35)
 x=s-101.4
 fullness=max(0,min(1,(x+55)/40,(95-x)/80))
 fine=[0,.05,.23,.42,.73,.92,.96,.96,.98,1]
 full=[0,.38,.65,.77,.91,1,1,.966,.95,1]
 heights=[0,.015,.055,.09,.19,.385,.475,.63,.82,1]
 factors=[((a+(b-a)*fullness)*(1-flare*.30*(1-h)),h) for a,b,h in zip(fine,full,heights)]
 sections.append({'station':s,'points':[[round(w*wf*(1-.06*stern*(1-hf)),4),round(k+(t-k)*hf,4)] for wf,hf in factors]})
def shape(id,name,pts,base,top,material='naval',roof=None):
 d={'id':id,'name':name,'footprint':[[-y,round(-x+ORIGIN,4)] for x,y in pts],'baseY':base,'height':round(top-base,4),'material':material}
 if roof:
  n=len(pts);vs=[[-y,base,round(-x+ORIGIN,4)] for x,y in pts]+[[-y,z,round(-x+ORIGIN,4)] for x,y,z in roof];tri=[]
  for i in range(1,n-1):tri.extend([[0,i+1,i],[n,n+i,n+i+1]])
  for i in range(n):j=(i+1)%n;tri.extend([[i,j,j+n],[i,j+n,i+n]])
  d['surface']={'vertices':vs,'triangles':tri}
 return d
# Counterclockwise original corner polygons in forward/port coordinates.
def rr(x,y,l,w,r=.6,n=3):
 return [(round(x+sx*(l/2-r)+r*math.cos(math.radians(a)),4),round(y+sy*(w/2-r)+r*math.sin(math.radians(a)),4)) for sx,sy,start in [(1,1,0),(-1,1,90),(-1,-1,180),(1,-1,270)] for a in [start+i*90/n for i in range(n+1)]]
def ellipse_points(x,y,a,b,n=40):return [(x+a*math.cos(i*math.tau/n),y+b*math.sin(i*math.tau/n)) for i in range(n)]
structures=[
 shape('forward-shelter','Forward shelter deck',[(17,-5.5),(19,-5.5),(20,-5.4),(21,-5.06),(25,-5.06),(26,-6.5),(27,-6.9),(42,-6.9),(48,-4.3),(54,-3.6),(55,-2.4),(55,2.4),(54,3.6),(48,4.3),(42,6.9),(27,6.9),(26,6.5),(25,5.06),(21,5.06),(20,5.4),(19,5.5),(17,5.5)],4.65,7.12),
 shape('forward-battery-house','Forward battery deckhouse',[(21.3,-4.48),(32.5,-4.48),(34.5,-3.4),(36.5,-3.4),(37.8,-4.43),(40.5,-4.43),(42,-4.03),(43,-3.34),(44.45,-2.3),(44.45,2.3),(43,3.34),(42,4.03),(40.5,4.43),(37.8,4.43),(36.5,3.4),(34.5,3.4),(32.5,4.48),(21.3,4.48)],7.12,9.42),
 shape('bridge-lower','Lower bridge and navigation deck',[(27,-4.65),(32.5,-4.65),(34.5,-3.59),(36.5,-3.59),(37.8,-4.43),(40.5,-4.43),(42,-4.03),(43,-3.34),(44.45,-2.3),(44.45,2.3),(43,3.34),(42,4.03),(40.5,4.43),(37.8,4.43),(36.5,3.59),(34.5,3.59),(32.5,4.65),(27,4.65)],9.42,12.1),
 shape('conning-tower','Armored conning position',rr(36.4,0,6.4,5.6,2),7.12,12.85),
 shape('bridge-navigation','Navigation bridge',[(29,-3.5),(33.4,-3.5),(34.3,-2.8),(34.3,2.8),(33.4,3.5),(29,3.5)],12.5,14.5),
 shape('tower-base','Forward tower lower shaft',rr(24.8,0,6.7,5.5,.65),9.42,17.0),
 shape('tower-wheelhouse','Tower enclosed wheelhouse',[(21.8,-3),(25.5,-3),(27.4,-2.4),(27.8,-1.3),(27.8,1.3),(27.4,2.4),(25.5,3),(21.8,3)],17,19.25),
 shape('tower-upper-shaft','Forward tower upper shaft',rr(24.0,0,4.7,3.6,.4),19.25,25.2),
 shape('tower-director-base','Main director base',[(21.25, 0), (21.45, -0.2), (24.2, -2.6), (24.7, -2.73), (25.05, -2.68), (25.5, -2.38), (25.7, -1.75), (25.82, -0.9), (25.84, 0), (25.82, 0.9), (25.7, 1.75), (25.5, 2.38), (25.05, 2.68), (24.7, 2.73), (24.2, 2.6), (21.45, 0.2)],25.2,27.12),
 shape('funnel-base','Funnel lower uptake',rr(10.7,0,10.0,4.08,1.95,8),4.6,16.65),
 shape('funnel-jacket','Funnel jacket',rr(10.7,0,10.6,4.52,2.20,8),16.65,18.75),
 shape('hangar','Aircraft hangar',rr(-5.575,0,20.45,7.1,.35),4.6,12.2),
 shape('aft-shelter','Aft shelter and battery deck',[(-53,-2.6),(-50,-4),(-44,-6.5),(-26,-6.5),(-25,-5.64),(-24,-4.69),(-19,-4.69),(-18,-4),(-17,-2.8),(-17,2.8),(-18,4),(-19,4.69),(-24,4.69),(-25,5.64),(-26,6.5),(-44,6.5),(-50,4),(-53,2.6)],4.75,7.18),
 shape('aft-deckhouse','Aft command deckhouse',[(-41.5, -2.5), (-41, -3.42), (-39, -4.87), (-38, -5.22), (-32, -5.28), (-31, -4.98), (-30, -4.28), (-29.5, -3.96), (-25, -3.96), (-24.5, -4.29), (-24, -4.7), (-21, -4.73), (-20, -5.7), (-19, -6.14), (-18, -5.73), (-17.4, -3.1), (-17.4, 3.1), (-18, 5.73), (-19, 6.14), (-20, 5.7), (-21, 4.73), (-24, 4.7), (-24.5, 4.29), (-25, 3.96), (-29.5, 3.96), (-30, 4.28), (-31, 4.98), (-32, 5.28), (-38, 5.22), (-39, 4.87), (-41, 3.42), (-41.5, 2.5)],7.18,9.72),
 shape('aft-director-house','Aft director house',[(-38.8,0),(-38,1.1),(-37,1.84),(-36,2.89),(-35,3.89),(-29,3.89),(-28,2.68),(-27.6,0),(-28,-2.68),(-29,-3.89),(-35,-3.89),(-36,-2.89),(-37,-1.84),(-38,-1.1)],9.72,11.8),
 shape('aft-director-base','Aft main director pedestal',[(-37, 0), (-36, -0.88), (-34, -1.53), (-32.5, -1.65), (-31.5, -1.56), (-31, -1.43), (-30.5, -0.85), (-30.2, 0), (-30.5, 0.85), (-31, 1.43), (-31.5, 1.56), (-32.5, 1.65), (-34, 1.53), (-36, 0.88)],11.85,14.2),
]
# The hangar has a raised flat center and sloping roof shoulders. Perimeter
# heights alone lose the ridge, which also carries the catapult bearing.
hangar=next(s for s in structures if s['id']=='hangar')
section=[(-3.55,4.6),(-3.55,10.65),(-2.9,12.2),(2.9,12.2),(3.55,10.65),(3.55,4.6)]
vertices=[[-y,z,round(-x+ORIGIN,4)] for x in [-15.8,4.65] for y,z in section]
triangles=[]
for i in range(1,5):triangles.extend([[0,i+1,i],[6,6+i,7+i]])
for i in range(6):
 j=(i+1)%6;triangles.extend([[i,j,j+6],[i,j+6,i+6]])
hangar['surface']={'vertices':vertices,'triangles':triangles}
# Director housings are part of the same authored structure contract, so the
# physical optical shoulders also constrain nearby elevating AA guards.
for key,x,base in [('forward',23.7,27.5),('aft',-31.6,14.2)]:
 structures.append(shape('main-director-'+key+'-housing','Main director '+key+' housing',ellipse_points(x,0,1.39,1.39,32),base,base+2.4))
 for side in [-1,1]:
  structures.append(shape('main-director-'+key+'-shoulder-'+('port' if side==1 else 'starboard'),'Main director '+key+' optical shoulder',[(x+(-.2 if key=='forward' else .2)+dx,side*1.88+dy) for dx,dy in [(-.92,-.665),(.92,-.665),(.92,.665),(-.92,.665)]],base+1.04,base+2.40))
# Provisional compartment model; no externally unsupported historical claim.
comp=[];modules=[]
for i,(x,l,w) in enumerate([(-82,24,6),(-58,20,10),(-36,22,14),(-12,24,16),(14,24,16),(39,20,12),(61,18,9),(83,20,5)]):
 cid=f'space-{i+1}';comp.append({'id':cid,'name':['After peak','Aft magazines','Aft machinery','Turbine rooms','Boiler rooms','Forward machinery','Forward magazines','Forward peak'][i],'center':[0,-1,-x+ORIGIN],'size':[w,7,l],'capacityM3':round(w*7*l*.72),'pumpM3PerSecond':.06,'fire':{'fuelSeconds':120,'ignitionHeat':1,'heatPerDamage':.018}})
 for kind in (['steering'] if i==0 else ['magazine'] if i in [1,6] else ['engine'] if i in [2,3,4,5] else []):
  mid=('aft-magazine' if i==1 else 'forward-magazine') if kind=='magazine' else f'{kind}-{i+1}'
  modules.append({'id':mid,'name':mid.replace('-',' ').title(),'kind':kind,'center':[0,-1,-x+ORIGIN],'size':[max(2,w-2),5,l-4],'hp':300 if kind=='engine' else 180,'compartmentId':cid})
D={'schemaVersion':1,'id':'admiral-hipper','name':'Admiral Hipper','configuration':'GameModels3D A fit · source asset hipper_1943 · plain finish','coordinates':'meters-y-up-bow-negative-z','modelUrl':'/models/admiral-hipper.glb',
'hull':{'kind':'authored-stations-v1','length':L,'beam':21.12,'draft':7.74,'depth':15.06,'massKg':18500000,'waterplaneAreaM2':3350,'reserveBuoyancyM3':10000,'halfBreadths':outline,'deckHeights':deck,'keelHeights':keel,'sections':sections},
'handling':{'forwardSpeed':16.46,'reverseSpeed':4,'acceleration':.14,'braking':.18,'rudderRate':.18,'maxYawRate':.020},'mounts':[], 'structures':structures,
'armor':[],'structuralPlating':{'hullMm':18,'superstructureMm':10,'note':'Provisional game steel thicknesses; visual model does not establish armor specifications.'},
'compartments':comp,'modules':modules,'connections':[{'fromId':comp[i]['id'],'toId':comp[i+1]['id'],'areaM2':.045,'state':'closed'} for i in range(len(comp)-1)],'obstructions':[],
'viewpoints':{'bridge':[0,19.0,-25.4]},'accuracy':{'exterior':'Original construction against approved pgsc108 A fit; hull and superstructure review in progress.','internals':'Provisional game compartments and loading, not historical plans.','weapons':'Not fitted yet; authored game calibration will be documented.'}}
# Preserve equipment authored in the blueprint while this hull/structure helper evolves.
old=json.loads((DIR/'blueprint.json').read_text())
if old.get('configuration','').startswith('GameModels3D'):
 for key in ['mounts','torpedoLaunchers','torpedoTubes','rig','mountClearance']:
  if key in old:D[key]=old[key]
(DIR/'blueprint.json').write_text(json.dumps(D,indent=2)+'\n')
