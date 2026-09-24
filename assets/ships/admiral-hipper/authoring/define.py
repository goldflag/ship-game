"""Original editable hull stations and structure polygons for the approved Hipper fit.

Structure polygons are rounded visual interpretations in metres. The hull stations come
from lines.json, control-station offsets measured like a lines plan from the approved
GameModels3D pgsc108 viewing reference; this helper reads no reference mesh or texture,
and the blueprint is the runtime contract.
"""
import json,math
from pathlib import Path
DIR=Path(__file__).resolve().parents[1]
lines=json.loads(Path(__file__).with_name('lines.json').read_text())
L=lines['length'];LOW,HIGH,H0=lines['LOW'],lines['HIGH'],lines['H0']
# Reference hull endpoint alignment: the source stern staff projects behind the
# physical shell. Authoring measurements below use a +1.3 m auxiliary datum;
# the compiled blueprint is centered on the original physical hull.
ORIGIN=1.3
def levels(keel,deck):
 # Twenty levels from the keel to the belt knuckle, four from it to the deck edge,
 # so the waist above the belt keeps its own points at every station.
 h0=H0 if keel<H0-1 else keel+(deck-keel)*.75
 return [keel+(h0-keel)*u for u in LOW]+[h0+(deck-h0)*u for u in HIGH]
rows=sorted(lines['rows'],key=lambda r:-r[0])
stern_row,bow_row=rows[0],rows[-1]
# The shell closes on the centreline at both ends: the counter above the last
# measured stern station and the stem head ahead of the first bow station.
sections=[{'station':0,'points':[[0,round(y,4)] for y in levels(min(stern_row[1]+.2,stern_row[2]-.15),stern_row[2])]}]
for z,k,d,ws in rows:
 sections.append({'station':round(L/2-z,4),'points':[[round(w,4),round(y,4)] for w,y in zip(ws,levels(k,d))]})
sections.append({'station':L,'points':[[0,round(y,4)] for y in levels(bow_row[2]-.8,bow_row[2]+.03)]})
outline=[(s['station'],round(max(p[0] for p in s['points']),4)) for s in sections]
deck=[(s['station'],s['points'][-1][1]) for s in sections]
keel=[(s['station'],s['points'][0][1]) for s in sections]
BEAM=round(2*max(w for s,w in outline)+.002,3)
DRAFT=round(-min(k for s,k in keel),3)
DEPTH=round(max(d for s,d in deck)+DRAFT,3)
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
def loft(id,name,rings,material='naval'):
 """Closed solid through horizontal rings [(points, height)] of equal point count."""
 n=len(rings[0][0]);m=len(rings);vs=[];tri=[]
 for pts,z in rings:vs+=[[-y,z,round(-x+ORIGIN,4)] for x,y in pts]
 for i in range(1,n-1):tri.extend([[0,i+1,i],[(m-1)*n,(m-1)*n+i,(m-1)*n+i+1]])
 for r in range(m-1):
  for i in range(n):j=(i+1)%n;a=r*n;b=a+n;tri.extend([[a+i,a+j,b+j],[a+i,b+j,b+i]])
 widest=max(rings,key=lambda r:max(p[0] for p in r[0])-min(p[0] for p in r[0])+max(p[1] for p in r[0]))[0]
 base=min(z for p,z in rings);top=max(z for p,z in rings)
 return {'id':id,'name':name,'footprint':[[-y,round(-x+ORIGIN,4)] for x,y in widest],'baseY':base,'height':round(top-base,4),'material':material,'surface':{'vertices':vs,'triangles':tri}}
def side_prism(id,name,profile,half,material='naval'):
 """Solid of a side profile [(forward, height)], counterclockwise, extruded across +/-half."""
 n=len(profile);vs=[[s*half,z,round(-x+ORIGIN,4)] for s in [-1,1] for x,z in profile];tri=[]
 for i in range(1,n-1):tri.extend([[0,i,i+1],[n,n+i+1,n+i]])
 for i in range(n):j=(i+1)%n;tri.extend([[i,n+j,j],[i,n+i,n+j]])
 xs=[x for x,z in profile]
 return {'id':id,'name':name,'footprint':[[-half,round(-max(xs)+ORIGIN,4)],[half,round(-max(xs)+ORIGIN,4)],[half,round(-min(xs)+ORIGIN,4)],[-half,round(-min(xs)+ORIGIN,4)]],'baseY':min(z for x,z in profile),'height':round(max(z for x,z in profile)-min(z for x,z in profile),4),'material':material,'surface':{'vertices':vs,'triangles':tri}}
# Funnel casing measured on the reference: 9.32 m by 4.56 m above the collar that
# flares it into the funnel house, a slightly longer jacket above the gallery.
FUNNEL_X=10.96
structures=[
 shape('forward-shelter','Forward shelter deck',[(5.55,-5.5),(19,-5.5),(20,-5.4),(21,-5.06),(25,-5.06),(26,-6.5),(27,-6.9),(42,-6.9),(48,-4.3),(54,-3.6),(55,-2.4),(55,2.4),(54,3.6),(48,4.3),(42,6.9),(27,6.9),(26,6.5),(25,5.06),(21,5.06),(20,5.4),(19,5.5),(5.55,5.5)],4.65,7.12),
 shape('forward-battery-house','Forward battery deckhouse',[(21.3,-4.48),(32.5,-4.48),(34.5,-3.4),(36.5,-3.4),(37.8,-4.43),(40.5,-4.43),(42,-4.03),(43,-3.34),(44.45,-2.3),(44.45,2.3),(43,3.34),(42,4.03),(40.5,4.43),(37.8,4.43),(36.5,3.4),(34.5,3.4),(32.5,4.48),(21.3,4.48)],7.12,9.42),
 shape('bridge-lower','Lower bridge and navigation deck',[(27,-4.65),(32.5,-4.65),(34.5,-3.59),(36.5,-3.59),(37.8,-4.43),(40.5,-4.43),(42,-4.03),(43,-3.34),(44.45,-2.3),(44.45,2.3),(43,3.34),(42,4.03),(40.5,4.43),(37.8,4.43),(36.5,3.59),(34.5,3.59),(32.5,4.65),(27,4.65)],9.42,11.64),
 # The conning position rises through the bridge deck (11.7 m) to 13.8 m, with the
 # navigating position's roof and rangefinder above its after part, as measured.
 shape('conning-tower','Armored conning position',rr(38.6,0,8.6,4.4,1.2),7.12,13.8),
 shape('bridge-navigation','Navigating position',rr(36.95,0,5.3,4.4,.8),13.8,14.4),
 # Forward tower, measured on the reference: a broad base to the 14.2 m platform,
 # a slender core through the admiral's bridge house to the top gallery.
 shape('tower-base','Forward tower lower shaft',rr(25.35,0,6.3,7.2,.6),9.42,14.12),
 shape('tower-wheelhouse',"Admiral's bridge house",[(18.5,0),(18.7,-1.5),(19.3,-2.5),(20.0,-2.95),(25.5,-2.95),(27.4,-2.4),(27.8,-1.3),(27.8,1.3),(27.4,2.4),(25.5,2.95),(20.0,2.95),(19.3,2.5),(18.7,1.5)],17.9,19.6),
 shape('tower-upper-shaft','Forward tower core',rr(23.6,0,5.64,3.4,1.0),9.3,25.2),
 shape('tower-director-base','Main director base',[(21.25, 0), (21.45, -0.2), (24.2, -2.6), (24.7, -2.73), (25.05, -2.68), (25.5, -2.38), (25.7, -1.75), (25.82, -0.9), (25.84, 0), (25.82, 0.9), (25.7, 1.75), (25.5, 2.38), (25.05, 2.68), (24.7, 2.73), (24.2, 2.6), (21.45, 0.2)],25.2,27.12),
 shape('funnel-base','Funnel lower uptake',rr(FUNNEL_X,0,9.32,4.56,2.2,8),4.6,16.3),
 loft('funnel-collar','Funnel base collar',[(rr(FUNNEL_X-.15,0,10.9,5.3,2.55,8),9.3),(rr(FUNNEL_X-.15,0,10.3,5.0,2.4,8),10.6),(rr(FUNNEL_X,0,9.32,4.56,2.2,8),12.3)]),
 shape('funnel-jacket','Funnel jacket',rr(FUNNEL_X,0,9.72,4.72,2.3,8),16.3,18.8),
 # The funnel house runs forward from the casing to the tower at shelter-deck
 # height, and a sloping fillet carries the casing's front down onto it.
 shape('funnel-house','Funnel house',[(15.3,-3.0),(21.1,-3.0),(21.1,3.0),(15.3,3.0)],7.12,9.3),
 side_prism('funnel-fillet','Funnel front fillet',[(15.55,9.3),(18.7,9.3),(15.55,12.4)],1.95),
 # Hangar: a full-height block ahead of the catapult with sloping shoulders over
 # its boat ledges, then a low after section; all on a shelter deck.
 shape('hangar-lower','Hangar shelter deck',[(5.55,-6.6),(-6.95,-6.6),(-7.25,-5.0),(-15.5,-5.0),(-15.5,5.0),(-7.25,5.0),(-6.95,6.6),(5.55,6.6)],4.6,7.12),
 shape('hangar','Aircraft hangar',[(5.55,-6.3),(-6.95,-6.3),(-6.95,6.3),(5.55,6.3)],7.12,12.1),
 shape('hangar-aft','Hangar after section',[(-6.95,-4.0),(-15.5,-4.0),(-15.5,4.0),(-6.95,4.0)],7.12,9.6),
 shape('catapult-pedestal','Catapult turntable pedestal',rr(-9.0,0,4.3,4.2,2.0,4),9.6,12.1),
 shape('aft-shelter','Aft shelter and battery deck',[(-53,-2.6),(-50,-4),(-44,-6.5),(-26,-6.5),(-15.5,-6.6),(-15.5,6.6),(-26,6.5),(-44,6.5),(-50,4),(-53,2.6)],4.75,7.18),
 shape('aft-deckhouse','Aft command deckhouse',[(-41.5, -2.5), (-41, -3.42), (-39, -4.87), (-38, -5.22), (-32, -5.28), (-31, -4.98), (-30, -4.28), (-29.5, -3.96), (-25, -3.96), (-24.5, -4.29), (-24, -4.7), (-21, -4.73), (-20, -5.7), (-19, -6.14), (-18, -5.73), (-17.4, -3.1), (-17.4, 3.1), (-18, 5.73), (-19, 6.14), (-20, 5.7), (-21, 4.73), (-24, 4.7), (-24.5, 4.29), (-25, 3.96), (-29.5, 3.96), (-30, 4.28), (-31, 4.98), (-32, 5.28), (-38, 5.22), (-39, 4.87), (-41, 3.42), (-41.5, 2.5)],7.18,9.72),
 # Raised blocks on the after deckhouse: a lookout position forward and the after
 # target designator's pedestal, as measured on the reference.
 shape('aft-deckhouse-front','After lookout block',rr(-20.4,0,5.6,4.6,.5),9.72,12.0),
 shape('aft-sight-pedestal','After designator pedestal',rr(-38.7,0,1.6,1.8,.4),9.72,11.97),
 shape('aft-director-house','Aft director house',[(-38.8,0),(-38,1.1),(-37,1.84),(-36,2.89),(-35,3.89),(-29,3.89),(-28,2.68),(-27.6,0),(-28,-2.68),(-29,-3.89),(-35,-3.89),(-36,-2.89),(-37,-1.84),(-38,-1.1)],9.72,11.8),
 shape('aft-director-base','Aft main director pedestal',[(-37, 0), (-36, -0.88), (-34, -1.53), (-32.5, -1.65), (-31.5, -1.56), (-31, -1.43), (-30.5, -0.85), (-30.2, 0), (-30.5, 0.85), (-31, 1.43), (-31.5, 1.56), (-32.5, 1.65), (-34, 1.53), (-36, 0.88)],11.85,14.2),
]
# The hangar has a raised flat roof and sloping shoulders down to the boat ledges.
# Perimeter heights alone lose the shoulders, so it carries its own section.
hangar=next(s for s in structures if s['id']=='hangar')
section=[(-6.3,7.12),(-6.3,9.55),(-5.9,10.2),(-4.6,12.1),(4.6,12.1),(5.9,10.2),(6.3,9.55),(6.3,7.12)]
k=len(section)
vertices=[[-y,z,round(-x+ORIGIN,4)] for x in [-6.95,5.55] for y,z in section]
triangles=[]
for i in range(1,k-1):triangles.extend([[0,i+1,i],[k,k+i,k+i+1]])
for i in range(k):
 j=(i+1)%k;triangles.extend([[i,j,j+k],[i,j+k,i+k]])
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
'hull':{'kind':'authored-stations-v1','length':L,'beam':BEAM,'draft':DRAFT,'depth':DEPTH,'massKg':18500000,'waterplaneAreaM2':3350,'reserveBuoyancyM3':10000,'halfBreadths':outline,'deckHeights':deck,'keelHeights':keel,'sections':sections},
'handling':{'forwardSpeed':16.46,'reverseSpeed':4,'acceleration':.14,'braking':.18,'rudderRate':.18,'maxYawRate':.020},'mounts':[], 'structures':structures,
'armor':[],'structuralPlating':{'hullMm':18,'superstructureMm':10,'note':'Provisional game steel thicknesses; visual model does not establish armor specifications.'},
'compartments':comp,'modules':modules,'connections':[{'fromId':comp[i]['id'],'toId':comp[i+1]['id'],'areaM2':.045,'state':'closed'} for i in range(len(comp)-1)],'obstructions':[],
'viewpoints':{'bridge':[0,19.0,-25.4]},'accuracy':{'exterior':'Original construction against approved pgsc108 A fit; hull and superstructure review in progress.','internals':'Provisional game compartments and loading, not historical plans.','weapons':'Not fitted yet; authored game calibration will be documented.'}}
# Preserve equipment authored in the blueprint while this hull/structure helper evolves,
# and the gameplay profiles the fleet helpers wrote (local damage, damage control, room
# fires and support machinery), so a hull or structure revision does not reset them.
old=json.loads((DIR/'blueprint.json').read_text())
if old.get('configuration','').startswith('GameModels3D'):
 for key in ['mounts','torpedoLaunchers','torpedoTubes','rig','mountClearance','localDamage','damageControl']:
  if key in old:D[key]=old[key]
 fires={c['id']:c['fire'] for c in old.get('compartments',[]) if 'fire' in c}
 for c in D['compartments']:
  if c['id'] in fires:c['fire']=fires[c['id']]
 D['modules']+=[m for m in old.get('modules',[]) if m['id'].startswith('support-')]
# Written as the repository's JSON tooling writes it: whole numbers without a decimal point.
def js(o):return {k:js(v) for k,v in o.items()} if isinstance(o,dict) else [js(v) for v in o] if isinstance(o,list) else int(o) if isinstance(o,float) and o.is_integer() else o
(DIR/'blueprint.json').write_text(json.dumps(js(D),indent=2,ensure_ascii=False)+'\n')
