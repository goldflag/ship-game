"""Editable original installation layout. Run after define.py while iterating.

Rounded placement interpretations of the approved visual fit; game calibration
and finite stocks use existing systems, without claiming source-invisible data.
"""
import json,math
from platforms import install
from pathlib import Path
D=Path(__file__).resolve().parents[1];p=D/'blueprint.json';b=json.loads(p.read_text());mounts=[]
def mount(id,name,part,x,y,z,bearing=0,battery='secondary',rf=False,sector=180):
 mounts.append(dict(id=id,name=name,partId=part,battery=battery,position=[-y,z,round(-x+1.3,4)],bearingDeg=bearing,rangefinder=rf,traverseDeg=sector,magazineId='forward-magazine' if x>0 else 'aft-magazine',fire=dict(fuelSeconds=65,ignitionHeat=.6,heatPerDamage=.014)))
for id,x,z,rf,bearing in [('anton',61.6,5.5,False,0),('bruno',50.9,8.1,True,0),('caesar',-49.1,8.2,True,180),('dora',-59.8,5.5,False,180)]:
 mount('main-'+id,id.title(),'skc34-203-twin'+('-rf' if rf else ''),x,0,z,bearing,'main',rf,150)
for side,y,angle in [('port',1,270),('starboard',-1,90)]:
 for i,(x,w,z) in enumerate([(31.7,8.4,7.1),(-10.4,8.3,4.5),(-28.7,7.4,7.2)]):mount(f'{side}-105-{i+1}',f'{side.title()} 105 mm {i+1}','skc33-105-c31-twin',x,y*w,z,angle,sector=90)
 for i,(x,w,z) in enumerate([(-26.3,4.5,10.1),(-39,3,9.7)]):mount(f'{side}-37-{i+1}',f'{side.title()} 37 mm {i+1}','flak-37-bismarck-1941',x,y*w,z,angle,sector=95)
 for i,(x,w,z) in enumerate([(22,2.9,25),(5.5,3,16.2),(-30.6,2.8,11.8),(-42.5,5.3,7.2)]):mount(f'{side}-20-twin-{i+1}',f'{side.title()} twin 20 mm {i+1}','flak38-m43u-20-twin',x,y*w,z,angle,sector=100)
 for i,(x,w,z) in enumerate([(-40,6.4,7.2),(-88.4,3.6,4.9),(-93.2,2.5,4.9)]):mount(f'{side}-20-{i+1}',f'{side.title()} single 20 mm {i+1}','flak38-20-single',x,y*w,z,angle,sector=100)
 for i,(x,w,z) in enumerate([(43.3,5.6,7.1),(36,6,9.4)]):mount(f'{side}-40-{i+1}',f'{side.title()} 40 mm {i+1}','flak28-40-single',x,y*w,z,angle,sector=100)
mount('forecastle-40','Forecastle 40 mm','flak28-40-single',80.9,0,5.3,0,sector=130)
mount('tower-40','Tower forward 40 mm','flak28-40-single',28.6,0,22.5,0,sector=100)
# Neutral bearings follow the source installation; asymmetric sectors are
# explicit provisional outboard training stops, with physical barrel interlocks.
for m in mounts:
 id=m['id'];starboard=id.startswith('starboard');sign=1 if starboard else -1
 if '-105-' in id:
  rear=not id.endswith('-1');m['bearingDeg']=180 if rear else 0;m['traverseDeg']=180
  m['traverseLimitsDeg']=([-180,0] if starboard else [0,180]) if rear else ([0,180] if starboard else [-180,0])
 elif '-37-2' in id or '-20-twin-3' in id or '-20-twin-4' in id or ('-20-1' in id and '-twin-' not in id):m['bearingDeg']=sign*135
 elif '-20-2' in id or '-20-3' in id:m['bearingDeg']=180
 elif '-40-1' in id:m['bearingDeg']=sign*45
for m in mounts:
 if m['partId']=='flak38-m43u-20-twin':m['initialElevationDeg']=30
b['mounts']=mounts
b['modules']=[m for m in b['modules'] if m['kind'] not in ['launcher','fire-control']]
for id,x,z in [('forward',23.7,28.4),('aft',-31.6,15.2)]:
 b['modules'].append(dict(id=id+'-director',name=id.title()+' main director',kind='fire-control',placement='fixed',center=[0,z,-x+1.3],size=[2.5,2,2.4],hp=90,protectionMm=12,servesMountIds=[m['id'] for m in mounts if m['battery']=='main']))
for id,x,y,z in [('port-forward',23.6,5,15.7),('starboard-forward',23.6,-5,15.7),('port-aft',-19,4.7,13.9),('starboard-aft',-19,-4.7,13.9)]:
 b['modules'].append(dict(id=id+'-aa-director',name=id.title()+' AA director',kind='fire-control',placement='fixed',center=[-y,z,-x+1.3],size=[4.5,3.2,4.0],hp=60,protectionMm=5,servesMountIds=[m['id'] for m in mounts if '-105-' in m['id'] and m['id'].startswith(id.split('-')[0])]))
b['torpedoLaunchers']=[];b['torpedoTubes']=[]
for side,y,arc in [('port',1,[-130,-50]),('starboard',-1,[50,130])]:
 for i,(x,w) in enumerate([(21.2,8.9),(-21.1,8.8)]):
  id=f'{side}-torpedo-{i+1}';pos=[-y*w,4.8,-x+1.3]
  b['torpedoLaunchers'].append(dict(id=id,name=f'{side.title()} triple 533 mm {i+1}',position=pos,traverseRateDeg=10,launchArcsDeg=[arc],traverseLimitsDeg=[-150,0] if y==1 else [0,150]))
  b['modules'].append(dict(id=id+'-equipment',name=f'{side.title()} torpedo mount {i+1}',kind='launcher',placement='fixed',center=[pos[0],5.6,pos[2]],size=[3.18,1.9,8.25],hp=95,protectionMm=5,torpedoLauncherId=id))
  for j in range(3):b['torpedoTubes'].append(dict(id=id+f'-tube-{j+1}',name=f'Tube {j+1}',partId='g7a-ti-fast',position=[pos[0]+(j-1)*.7215,5.307,pos[2]-4.67],bearingDeg=0,arcDeg=2,ammo=1,magazineId='forward-magazine' if x>0 else 'aft-magazine',launcherId=id,launcherModuleId=id+'-equipment'))
b['accuracy']['weapons']='Approved A fit: four 203 mm twins, six 105 mm twins, four 37 mm twins, six 40 mm singles, eight 20 mm twins, six 20 mm singles, and four triple 533 mm launchers. Ballistics, stocks, armor, and operating limits are provisional game conventions.'
platform_heights=install(b)
b['mountClearance']={'version':1,'marginM':.02,'basis':'Provisional game interlock envelopes for the original fitted geometry. Gunhouse body boxes cover the upper armored houses; the low bearing/skirt interfaces are swept separately on original meshes. Independent neighbor and whole-assembly visual review remains required.','mounts':[{'mountId':m['id'],'barrelRadiusM':.29 if m['battery']=='main' else .15 if '-105-' in m['id'] else .075,'body':{'center':[0,1.755 if m['rangefinder'] else 1.42,1.45],'size':[8.05 if m['rangefinder'] else 6.64,3.11 if m['rangefinder'] else 2.44,8.05]}} if m['battery']=='main' else {'mountId':m['id'],'barrelRadiusM':.15 if '-105-' in m['id'] else .075} for m in mounts],'structures':[{'structureId':s['id'],'topExtensionM':platform_heights.get(s['id'],.1)} for s in b['structures']],'neighbors':[[a['id'],c['id']] for i,a in enumerate(mounts) for c in mounts[i+1:] if math.dist(a['position'],c['position'])<17]}
# Fitting envelopes are original, editable metrical interpretations of the
# shared builder's guards and controls; no renderer data enters simulation.
for entry,m in zip(b['mountClearance']['mounts'],mounts):
 if m['partId'] not in ['flak38-m43u-20-twin','flak38-20-single']:continue
 twin='twin' in m['partId'];fittings=[]
 def cap(a,c,r,joint='elevation'):
  # Builder forward/port/up -> runtime starboard/up/aft.
  fittings.append(dict(joint=joint,a=[-a[1],a[2],-a[0]],b=[-c[1],c[2],-c[0]],radiusM=r))
 for sy in ([-.14025,.14025] if twin else [0]):
  cap((-.71,sy,0),(.45,sy,0),.20)
  for hand in ([-1 if sy<0 else 1] if twin else [-1,1]):
   cap((-.4,sy+hand*.085,.10),(-.78,sy+hand*.30,.11),.032)
   cap((-.78,sy+hand*.30,.11),(-.85,sy+hand*.30,-.08),.032)
 if twin:
  points=[(0,0,.20),(.60,0,.20),(.85,0,-.27),(2.45,0,-.27)]
  for a,c in zip(points,points[1:]):cap(a,c,.025)
 entry['fittings']=fittings
# Conservative boxes for original fixed deck fittings. These already belong to
# the shared obstruction contract used by firing and movement; no render meshes
# or source assets are consulted. Auxiliary datum matches the original recipe.
b['obstructions']=[]
def fixed(id,a,c,pad=.03):
 center=[(x+y)/2 for x,y in zip(a,c)];extent=[abs(x-y)+pad*2 for x,y in zip(a,c)]
 b['obstructions'].append(dict(id=id.replace('--','-minus-').replace('.','-'),center=[-center[1],center[2],1.3-center[0]],size=[extent[1],extent[2],extent[0]]))
def ordinate(table,x):
 station=x+101.4
 for (a,v),(c,w) in zip(table,table[1:]):
  if a<=station<=c:return v+(w-v)*(station-a)/(c-a)
 return table[-1][1]
def deck(x):return ordinate(b['hull']['deckHeights'],x)
for side in [-1,1]:
 # Only the low forward/aft batteries can depress onto the weather-deck rails.
 for lo,hi in [(-101.4,-48),(50,104)]:
  xs=[lo]+[station-101.4 for station,w in b['hull']['halfBreadths'] if lo<station-101.4<hi]+[hi]
  for i,(a,c) in enumerate(zip(xs,xs[1:])):
   ya,yc=[side*max(0,ordinate(b['hull']['halfBreadths'],x)-.14) for x in [a,c]]
   fixed(f'weather-rail-{side}-{lo}-{i}',(a,ya,min(deck(a),deck(c))+.04),(c,yc,max(deck(a),deck(c))+.94))
 for x in [83,88]:fixed(f'capstan-{side}-{x}',(x-.68,side*2.25-.68,deck(x)),(x+.68,side*2.25+.68,deck(x)+.90),0)
 fixed(f'aft-mooring-reel-{side}',(-69.65,side*5.5-.70,4.95),(-68.35,side*5.5+.70,6.05),0)
 for i in range(6):
  ya=side*(.8+i*.85);yc=side*(.8+(i+1)*.85);xa=73.5-abs(ya)*.8;xc=73.5-abs(yc)*.8
  fixed(f'breakwater-{side}-{i}',(xa,ya,deck(xa)),(xc,yc,deck(xa)+.85),.04)
  fixed(f'breakwater-stay-{side}-{i}',(xa-1,ya,deck(xa)),(xa,ya,deck(xa)+.75),.045)
p.write_text(json.dumps(b,indent=2)+'\n')
