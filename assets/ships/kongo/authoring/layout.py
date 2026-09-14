"""Original sparse hull and architectural layout; never reads external model geometry."""
import json, math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
path=ROOT/'assets/ships/kongo/blueprint.json'
b=json.loads(path.read_text())
b.update(name='IJN Kongō',configuration='1944 — approved GameModels3D War Thunder fit; original reconstruction in progress')
# Coordinates below are authored Blender longitudinal metres (+bow), breadth, deck and keel.
# Sparse control stations are deliberately editable design inputs, not a reference mesh.
stations=[
(-110.5,0,4.0,.0),(-109,.65,4.05,-.65),(-106,1.8,4.1,-1.7),(-101,3.7,4.12,-2.8),
(-94,7.4,4.15,-3.7),(-85,9.1,4.18,-4.9),(-74,10.9,4.2,-7.9),(-62,12.35,4.25,-8.2),
(-48,13.7,4.3,-9),(-34,14.65,4.35,-9),(-26,15.05,4.4,-9),(-22,15.2,5.25,-9),
(-12,15.55,5.25,-9),(0,16,5.25,-9),(14,15.8,5.25,-9),(28,15.0,5.25,-9),
(40,13.9,5.25,-9),(52,12.2,5.3,-9),(64,10.25,5.48,-9),(76,8.05,5.85,-8.5),
(86,5.8,6.3,-8.8),(94,3.7,6.8,-8.5),(101,2.0,7.3,-7.5),
(104.5,1.3,7.55,-6.2),(106,1.0,7.65,-5.2),(107.5,.72,7.75,-2.6),
(108,.58,7.8,3.0),(109,.4,7.85,7.0),(110.5,0,8.0,8.0)]
# Forecastle sheer and quarterdeck corrected from the approved side view.
stations=[(x,w,(4.9+.3*min(1,(x+110.5)/30) if x < -26 else 7.3+.7*((x-52)/58.5)**2 if x >= 52 else d),k) for x,w,d,k in stations]
h=dict(kind='authored-stations-v1',length=221,beam=32,draft=9,depth=17,massKg=38767000,
 waterplaneAreaM2=4900,reserveBuoyancyM3=18000,halfBreadths=[],deckHeights=[],keelHeights=[],sections=[])
for x,w,d,k in stations:
 s=x+110.5
 h['halfBreadths'].append([s,w]);h['deckHeights'].append([s,d]);h['keelHeights'].append([s,k])
 # Rounded bilges, full waterline bulges and inset upper side plating.
 z1=k+(d-k)*.07
 zs=[k,z1,k+(d-k)*.22,k+(d-k)*.38,k+(d-k)*.55,k+(d-k)*.72,max(k+(d-k)*.80,d-.5),d]
 fs=[0,.53,.81,.97,1,.95,.87,.87]
 if x>85:fs=[0,.22,.48,.73,.9,.98,1,1]
 if x < -55:
  t=min(1,(-x-55)/20);aft=[0,.16,.28,.43,.65,.8,.95,1]
  fs=[a+(c-a)*t for a,c in zip(fs,aft)]
 h['sections'].append(dict(station=s,points=[[round(w*f,3),round(z,3)] for f,z in zip(fs,zs)]))
b['hull']=h
b['handling']=dict(forwardSpeed=15.42,reverseSpeed=4,acceleration=.1,braking=.14,rudderRate=.2,maxYawRate=.015)
path.write_text(json.dumps(b,ensure_ascii=False,indent=2)+'\n')
