"""Original Fubuki A specification interpreted from approved model views.
No reference geometry or textures are read. Regenerates this ship's base blueprint;
run shared stability/local-damage recipes afterwards. All internal/performance data
are provisional game calibration, not measured historical arrangements.
"""
from pathlib import Path
import json,math
SHIP=Path(__file__).resolve().parents[1]
L=118.75;half=L/2
# x (bow positive), deck half-breadth, deck and keel elevations.
stations=[(-59.375,.025,3.43,-.60),(-58.6,1.4,3.43,-.9),(-57,2.8,3.42,-.72),(-54,3.85,3.41,-.78),(-50,4.50,3.40,-1.15),(-44,4.97,3.39,-2.55),(-42,5.05,3.39,-3.22),(-38,5.15,3.38,-3.22),(-28,5.29,3.38,-3.22),(-15,5.29,3.39,-3.22),(-5,5.25,3.4,-3.22),(8,5.08,3.42,-3.22),(16,4.79,3.5,-3.22),(19.8,4.50,3.6,-3.22),(20.3,4.48,5.35,-3.22),(26,4.28,5.38,-3.22),(33,4.17,5.46,-3.22),(40,3.73,5.63,-3.22),(47,2.86,5.86,-3.22),(52,1.98,6.02,-3.22),(53.5,1.70,6.09,-3.10),(55,1.38,6.15,-2.72),(56,1.15,6.20,-2.10),(57,.92,6.24,-1.12),(57.8,.70,6.28,.15),(58.4,.48,6.31,1.85),(59,.20,6.34,4.6),(59.375,.001,6.36,6.34)]
h={'kind':'authored-stations-v1','length':L,'beam':10.58,'draft':3.22,'depth':9.58,'massKg':2300000,'waterplaneAreaM2':905,'reserveBuoyancyM3':1100,
 'halfBreadths':[[round(x+half,5),w] for x,w,d,k in stations],'deckHeights':[[round(x+half,5),d] for x,w,d,k in stations],'keelHeights':[[round(x+half,5),k] for x,w,d,k in stations],'sections':[]}
for x,w,d,k in stations:
 # Original rounded-bilge section, sharper forward V and tucked stern counter.
 bow=max(0,(x-35)/25);stern=max(0,(-x-38)/22)
 pts=[[0,k],[w*(.52-.4*bow-.28*stern),k+.08*(d-k)],[w*(.84-.32*bow-.28*stern),k+.23*(d-k)],[w*(.97-.15*bow-.10*stern),k+.44*(d-k)],[w*.995,k+.67*(d-k)],[w,k+.87*(d-k)],[w,d],[0,d+.005]]
 h['sections'].append({'station':round(x+half,5),'points':[[round(a,4),round(b,4)] for a,b in pts]})
b={'schemaVersion':1,'id':'fubuki','name':'Fubuki','configuration':'Approved GameModels3D Fubuki (A); default paint; source-model fit, historical year unverified','coordinates':'meters-y-up-bow-negative-z','modelUrl':'/models/fubuki.glb','hull':h,
 'handling':{'forwardSpeed':18,'reverseSpeed':4.5,'acceleration':.47,'braking':.40,'rudderRate':.60,'maxYawRate':.065},'mounts':[],'armor':[],'compartments':[],'modules':[],'connections':[],'obstructions':[],
 'structures':[],'structuralPlating':{'hullMm':12,'superstructureMm':6,'note':'Estimated game protection; the reference does not establish armor thickness.'},'viewpoints':{'bridge':[0,12.5,-28]},'accuracy':{'exterior':'Independent interpretation of approved GameModels3D pjsd106 A_Hull_1943. Scale and waterline provisional; historical year unverified.','internals':'Estimated rooms, machinery and magazines for gameplay; no internal reference plans.','weapons':'Approved source fit; mechanical stops and combat performance use provisional game conventions.'}}
def mount(id,part,x,y,z,bearing=0,main=False):
 b['mounts'].append({'id':id,'name':id.replace('-',' ').title(),'partId':part,'battery':'main' if main else 'secondary','position':[-y,z,-x],'bearingDeg':bearing,'rangefinder':False,'magazineId':'forward-magazine' if x>0 else 'aft-magazine'})
mount('main-forward','type3-127-typec-twin',41.847,0,5.967,main=True)
mount('main-aft','type3-127-typec-twin',-42.1005,0,3.7185,180,True)
for id,x,y,z,angle in [('bridge',30.954,0,8.331,0),('mid-port',-19.077,2.061,6.861,-90),('mid-starboard',-19.077,-2.0565,6.861,90),('aft-upper',-31.677,-.4065,6.1575,180),('aft-lower',-35.6865,-.4065,5.538,180)]:mount('aa-25-'+id,'type96-25-mogami-2',x,y,z,angle)
for id,y,a in [('port',.984,-90),('starboard',-.984,90)]:mount('aa-13-twin-'+id,'type93-13-twin',2.748,y,8.139,a)
for i,(x,y,z) in enumerate([(-1.224,-4.317,3.3885),(-2.8185,4.728,3.3885),(-4.863,4.728,3.3885),(-7.98,-4.317,3.378)]):mount('aa-13-single-'+str(i+1),'type93-13-single',x,y,z,90 if y<0 else -90)
def structure(id,outline,base,top):
 b['structures'].append({'id':id,'name':id.replace('-',' ').title(),'footprint':[[-y,-x] for x,y in outline],'baseY':base,'height':top-base,'material':'naval'})
def rect(x0,x1,w,c=.25):return [(x0,-w+c),(x0+c,-w),(x1-c,-w),(x1,-w+c),(x1,w-c),(x1-c,w),(x0+c,w),(x0,w-c)]
# Rounded forward faces are manually dimensioned original arcs, not source mesh copies.
def round_front(back,cx,rx,ry):
 return [(back,-ry)]+[(cx+rx*math.cos(-math.pi/2+i*math.pi/24),ry*math.sin(-math.pi/2+i*math.pi/24)) for i in range(25)]+[(back,ry)]
structure('bridge-lower',round_front(22.5,27.3,2.05,2.1),5.36,10.0)
# Side sponsons blend into the wheelhouse's broad circular front.
wheel=[(22.4,-2.4),(24,-2.4),(24.6,-3.45),(26.2,-3.45)]
wheel += [(26.2+3.9*math.cos(-math.pi/2+i*math.pi/28),3.45*math.sin(-math.pi/2+i*math.pi/28)) for i in range(1,29)]
wheel += [(24.6,3.45),(24,2.4),(22.4,2.4)]
structure('wheelhouse',wheel,10.0,12.70)
structure('bridge-upper',round_front(23.2,26.1,2.15,1.6),12.70,14.0)
structure('fore-uptake',rect(11.4,18.2,1.9),3.49,5.35)
structure('fore-torpedo-deck',rect(4.4,12,2.9),3.46,5.05)
structure('aft-uptake',rect(-5.3,1.1,1.8),3.4,5.8)
structure('after-deckhouse',rect(-37.15,-28.7,2.3),3.39,5.54)
structure('aft-aa-upper-step',rect(-33.5,-29,1.50),5.54,6.1575)
# Funnel jackets use original raked oval rings shared by rendering and collision.
for id,cx,base,top,rx,ry,rake in [('forward-funnel',15.4,5.35,13.5,1.9,1.26,-1.1),('after-funnel',-1.8,5.8,13.15,1.85,1.2,-1.1)]:
 n=40;verts=[]
 for t in [0,.15,.84,1]:
  for i in range(n):
   ang=i*math.tau/n;x=cx+rx*math.cos(ang)+rake*t;y=ry*math.sin(ang);z=base+(top-base)*t+.25*rx*math.cos(ang)*t
   verts.append([-y,z,-x])
 tris=[]
 for k in range(3):
  for i in range(n):
   a=k*n+i;c=k*n+(i+1)%n;tris.extend([[a,c,c+n],[a,c+n,a+n]])
 structure(id,rect(cx-rx-1.1,cx+rx,ry),base,top+.5)
 b['structures'][-1]['surface']={'version':1,'vertices':verts,'triangles':tris}
# Small interior rooms kept inside the section envelope; residual cells added separately.
for id,x,w,length,z,height,kind in [('forepeak',51,1.5,5,1.2,3.5,None),('forward-magazine',40,3.0,9,.4,3.5,'magazine'),('crew-forward',29,4.5,9,.3,3.8,None),('boiler-forward',15,5.8,11,0,4.2,'engine'),('boiler-aft',1,6.2,11,0,4.2,'engine'),('engine-port',-13,3.2,12,0,4.2,'engine'),('engine-starboard',-13,3.2,12,0,4.2,'engine'),('torpedo-magazine',-25,5,7,.1,3.8,'magazine'),('aft-magazine',-40,3.2,8,.3,3.5,'magazine'),('depth-charge-magazine',-49,2.8,5,.4,3,'magazine'),('steering',-54,1.8,3,1.0,1.9,'steering')]:
 y=1.8 if id=='engine-port' else -1.8 if id=='engine-starboard' else 0
 center=[-y,z,-x];size=[w,height,length];room=id+'-space'
 b['compartments'].append({'id':room,'name':id.replace('-',' ').title()+' (estimated)','center':center,'size':size,'capacityM3':w*height*length*.68,'pumpM3PerSecond':.014})
 if kind:b['modules'].append({'id':id,'name':id.replace('-',' ').title(),'kind':kind,'center':center,'size':[v*.75 for v in size],'hp':95 if kind=='engine' else 75,'compartmentId':room})
# Paired sealed doors; sea breaches do not imply all passages are open.
rooms=b['compartments']
for i in range(len(rooms)-1):
 a,c=rooms[i:i+2];p=[(v+c['center'][j])/2 for j,v in enumerate(a['center'])]
 b['connections'].append({'id':'door-'+str(i),'fromId':a['id'],'toId':c['id'],'areaM2':.5,'state':'closed','position':p,'bounds':{'center':p,'size':[.7,.9,.05]},'thicknessMm':5})
b['torpedoLaunchers']=[];b['torpedoTubes']=[]
for i,x,z in [(1,7.941,5.0475),(2,-13.4265,3.8895),(3,-24.5925,3.8895)]:
 id='torpedo-'+str(i)
 b['torpedoLaunchers'].append({'id':id,'name':'Triple 610 mm bank '+str(i),'position':[0,z,-x],'traverseRateDeg':16,'launchArcsDeg':[[-120,-50],[50,120]],'traverseLimitsDeg':[-120,120]})
 b['modules'].append({'id':id+'-equipment','name':'Torpedo bank '+str(i),'kind':'launcher','placement':'fixed','torpedoLauncherId':id,'center':[0,z+1.1,-x],'size':[4.7,2.2,8.4],'hp':100,'protectionMm':8,'immersionToleranceM':.3})
 for j,y in enumerate([-.76,0,.76]):b['torpedoTubes'].append({'id':id+'-tube-'+str(j+1),'name':id+' tube '+str(j+1),'partId':'ijn-610-type8-game','position':[-y,z+.84,-x-4.60],'bearingDeg':0,'arcDeg':2,'ammo':2,'magazineId':'torpedo-magazine','launcherId':id,'launcherModuleId':id+'-equipment'})
b['depthChargeLaunchers']=[]
for i,x,y,z in [(1,-50.9445,0,3.3675),(2,-55.3065,2.7705,3.381),(3,-55.3065,-2.7705,3.381),(4,-57.264,2.1765,3.381),(5,-57.264,-2.1765,3.381)]:
 id='depth-charge-'+str(i)
 b['depthChargeLaunchers'].append({'id':id,'name':'Depth charge station '+str(i),'partId':'ijn-450-depth-charge-game','position':[-y,z,-x],'velocity':[0,3 if i==1 else 0,2],'ammo':4,'magazineId':'depth-charge-magazine','launcherModuleId':id+'-equipment'})
 b['modules'].append({'id':id+'-equipment','name':'Depth charge station '+str(i),'kind':'launcher','placement':'fixed','center':[-y,z+.3,-x],'size':[1.4 if i==1 else .8,1.4 if i==1 else .5,1.1],'hp':45,'protectionMm':3,'immersionToleranceM':.25})
b['modules'].append({'id':'main-director','name':'Bridge optical director','kind':'fire-control','placement':'fixed','center':[0,14.0,-26.1],'size':[2.4,1.6,2.6],'hp':65,'protectionMm':6,'immersionToleranceM':.3,'servesMountIds':['main-forward','main-aft']})
(SHIP/'blueprint.json').write_text(json.dumps(b,indent=2)+'\n')
