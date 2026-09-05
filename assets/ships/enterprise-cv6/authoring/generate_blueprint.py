"""Transcribe dimensional evidence into the editable v1 ship blueprint.

Run explicitly after editing the offset transcription. ship:build consumes the
resulting blueprint, never a hidden mesh or a copied game model.
"""
from pathlib import Path
import json, csv, math
ROOT = Path(__file__).resolve().parents[1]
FT = .3048
LENGTH = 809.5 * FT
DRAFT = (25 + 11.5/12) * FT
FP = LENGTH/2 - 18.75*FT
AP = FP - 770*FT
FLIGHT_AFT = AP - 36*FT
FLIGHT_FORWARD = FLIGHT_AFT + 802*FT
# C&R 189525 explicitly marks the flight deck at 80 ft molded on centerline.
# Its small wood-surface allowance and CV-6 as-built confirmation remain E007.
FLIGHT = 80*FT-DRAFT
MAIN = (52+10/12)*FT-DRAFT

def f(value):
    if value == '-': return None
    if '-' not in value: return float(value)
    feet, inches, eighths = map(float,value.split('-'))
    return feet + inches/12 + eighths/96

def r(v): return round(v,6)
def frame(n): return FP-n*4*FT
def level(feet): return feet*FT-DRAFT
def lerp(table,x):
    for (a,va),(b,vb) in zip(table,table[1:]):
        if a <= x <= b:return va+(vb-va)*(x-a)/(b-a)
    return table[0][1] if x<table[0][0] else table[-1][1]
# These elevations are above the 1934 molded baseline, not above the sea.
levels=[3.25,6,11,17.875,24.375,30,39.5,48]
keel=[(0,4),(.25,1.65),(.5,0),(34,0),(35,8.583),(36,11.75),
      (37,14.458),(38,17.25),(39,20.208),(39.5,21.604),(40,24.375)]
sections=[]
rows=csv.reader(line for line in (ROOT/'authoring/hull-offsets.csv').read_text().splitlines() if not line.startswith('#'))
for row in rows:
    sec=float(row[0]); widths=list(map(f,row[1:])); bottom=lerp(keel,sec)
    main_width=widths[8] if widths[8] is not None else 46
    main_height=lerp([(0,52.8),(8,52.6),(14,52.5),(32,52.5),(40,52.7)],sec)
    pts=[(0,bottom)]
    # Below the first tabulated waterline, a rounded bilge is interpolated.
    first=next(((z,w) for z,w in zip(levels,widths) if w is not None and z>=bottom),None)
    if first and first[0]-bottom>1:
        z,w=first;pts.extend([(w*.76,bottom+(z-bottom)*.10),(w*.93,bottom+(z-bottom)*.45)])
    pts.extend((w,z) for z,w in zip(levels,widths) if w is not None and z>=bottom)
    pts.append((main_width,main_height))
    if widths[9] is not None:pts.append((widths[9],58))
    if widths[10] is not None:pts.append((widths[10],lerp([(0,61.9),(8,61.5)],sec)))
    x=FP-sec*19.25*FT
    sections.append(dict(station=r(x+LENGTH/2),points=[[r(w*FT),r(h*FT-DRAFT)] for w,h in pts]))
# Stem and counter are explicit, with the measured steel hull end datums.
sections.extend([
 dict(station=LENGTH,points=[[0,r(61.9*FT-DRAFT)],[.002,r(61.92*FT-DRAFT)],[0,r(62*FT-DRAFT)]]),
 dict(station=r(FP+12*FT+LENGTH/2),points=[[0,r(56.8*FT-DRAFT)],[r(3.2*FT),r(58*FT-DRAFT)],[r(11.5625*FT),r(61.9*FT-DRAFT)]]),
 dict(station=r(FP+4*FT+LENGTH/2),points=[[0,r(49.5*FT-DRAFT)],[r(6.80*FT),r(52.8*FT-DRAFT)],[r(13.146*FT),r(58*FT-DRAFT)],[r(14.78*FT),r(61.9*FT-DRAFT)]]),
 dict(station=r(AP-4*FT+LENGTH/2),points=[[0,r(26.28*FT-DRAFT)],[r(6.06*FT),r(30*FT-DRAFT)],[r(14.604*FT),r(39.5*FT-DRAFT)],[r(20.917*FT),r(48*FT-DRAFT)],[r(24.438*FT),r(52.73*FT-DRAFT)]]),
 dict(station=r(AP-13*FT+LENGTH/2),points=[[0,r(32.948*FT-DRAFT)],[r(2.896*FT),r(35.5*FT-DRAFT)],[r(6.417*FT),r(39.5*FT-DRAFT)],[r(13.4375*FT),r(48*FT-DRAFT)],[r(17.094*FT),r(52.78*FT-DRAFT)]]),
 dict(station=0,points=[[0,r(52.45*FT-DRAFT)],[.002,r(52.5*FT-DRAFT)],[0,r(52.82*FT-DRAFT)]])])
sections.sort(key=lambda s:s['station'])
# Small flat keel datum at amidships: the outer bottom includes the keel shoe.
for s in sections:
 if s['points'][0][1] == r(-DRAFT):s['points'][0][1]=-DRAFT
beam=max(p[0]*2 for s in sections for p in s['points'])
structures=[]
def poly(id,name,xy,base,height,material):
    # Authoring input is forward/port; JSON always uses runtime starboard/-forward.
    structures.append(dict(id=id,name=name,footprint=[[r(-y),r(-x)] for x,y in xy],baseY=r(base),height=r(height),material=material))
def rect(id,name,x,y,length,width,base,height,material,cut=0):
    a,b=x-length/2,x+length/2;c,d=y-width/2,y+width/2
    xy=[(a+cut,c),(b-cut,c),(b,c+cut),(b,d-cut),(b-cut,d),(a+cut,d),(a,d-cut),(a,c+cut)] if cut else [(a,c),(b,c),(b,d),(a,d)]
    poly(id,name,xy,base,height,material)
def rounded(id,name,aft,forward,width,base,height,material,radius=.9):
    # Rounded rectangular casing measured on the four-foot frame grid.
    a,b=frame(aft),frame(forward);c,d=IY-width/2,IY+width/2
    xy=[]
    for x,y,start in [(b-radius,d-radius,0),(a+radius,d-radius,90),
                      (a+radius,c+radius,180),(b-radius,c+radius,270)]:
        for i in range(5):
            angle=math.radians(start+i*90/4)
            xy.append((x+radius*math.cos(angle),y+radius*math.sin(angle)))
    poly(id,name,xy,base,height,material)
def island_poly(id,name,fy,base,height,material):
    poly(id,name,[(frame(fr),IY+off*FT) for fr,off in fy],base,height,material)
# Deck width at its broad central part = 86 ft. Longitudinal edge changes follow
# the class flight-deck sheet; local shoulder offsets remain a measured estimate.
outline=[(FLIGHT_AFT,-11.5824),(-18,-11.5824),(-18,-7.9248),
         (43,-7.9248),(43,-11.5824),(FLIGHT_FORWARD-9,-11.5824),
         (FLIGHT_FORWARD,-7.8),(FLIGHT_FORWARD,7.8),(FLIGHT_FORWARD-9,11.5824),
         (69,11.5824),(67,12.0),(40,13.45),(38,14.6304),(-18,14.6304),
         (-73,12.0),(-75,11.5824),(FLIGHT_AFT,11.5824)]
poly('flight-deck','Flight deck, steel and wood',outline,FLIGHT-.34,.34,'deck')
# Elevator edge locations are reconstructed on the class frame grid.
for id,x,y in [('elevator-forward',76.2,0),('elevator-middle',-28.6512,-2.1336),('elevator-aft',-100.584,0)]:
    rect(id,id.replace('-',' ').title(),x,y,48*FT,44*FT,FLIGHT+.006,.028,'elevator',cut=.95)
# Narrow, open-sided hangar between forecastle and after galleries.
rect('hangar-deck','Hangar floor',-7.5,0,166.4208,19.2024,MAIN-.18,.18,'steel-deck')
# Island centerline 36 ft 3 in starboard (class 1940 inboard-profile annotation).
IY=-36.25*FT
COMM,FLAG,NAV,PILOT,ROOF,PILOT_ROOF=map(level,[87,94.5,102,104.5,109.5,111.75])
# C&R 189526 and CV-5 BOGP 216500 give these deck elevations explicitly.
# Frame and edge measurements are recorded separately from exact annotations.
island_poly('island-base','Island lower decks',[(109,-8.25),(70,-8.25),(70,8.25),(109,8.25)],FLIGHT,FLAG-FLIGHT,'naval')
island_poly('communications-walkway','Communications platform edge',[(110,-10),(69,-10),(69,10),(109,10),(109,8),(110,8)],COMM-.12,.12,'steel-deck')
island_poly('flag-bridge','Flag bridge housing',[(108.5,-8.25),(70,-8.25),(70,8.25),(108.5,8.25)],FLAG,NAV-FLAG,'naval')
island_poly('flag-walkway','Flag bridge projecting platform',[(110,-10),(69,-10),(69,12),(76,12),(76,15),(83,15),(83,10),(109,10)],FLAG-.14,.14,'steel-deck')
island_poly('navigation-bridge','Navigating bridge and air plot',[(87.5,-8.25),(72,-8.25),(70.25,-4),(70.25,4),(72,8.25),(87.5,8.25)],NAV,ROOF-NAV,'naval')
island_poly('navigation-wings','Navigating bridge wings',[(88,-10),(77,-10),(77,-17),(70,-17),(68.5,-10),(68.5,10),(70,17),(77,17),(77,10),(88,10)],NAV-.15,.15,'steel-deck')
island_poly('bridge-roof','Air plot roof',[(88,-10),(76,-10),(71,-8),(70,0),(71,8),(76,10),(88,10)],ROOF-.12,.12,'steel-deck')
rounded('pilot-house','Raised pilot house',76.2,70.1,18.5*FT,PILOT,PILOT_ROOF-PILOT,'naval',1.25)
rounded('pilot-roof','Pilot house roof and director platform',76.4,69.9,20*FT,PILOT_ROOF-.12,.12,'steel-deck',1.4)
rounded('secondary-conning','Secondary conning station',109.5,103,16.5*FT,NAV,ROOF-NAV,'naval',1.25)
# The third uptake slopes aft: the casing narrows longitudinally towards its cap.
rounded('funnel','Three-uptake funnel casing',103.0,87.5,15.7*FT,FLAG,level(129.875)-FLAG,'naval',.95)
rounded('funnel-cap','Funnel cap',103.0,89.2,15.7*FT,level(129.875)-.12,.12,'edge',.95)
FCTRL,TOP_FLOOR,TOP_ROOF=map(level,[135.5,139.5,145.75])
fighting_outline=[(85.5,0),(84.8,-5),(82.4,-14),(80.6,-12),(78.7,-6),(78.3,0),(78.7,6),(80.6,12),(82.4,14),(84.8,5)]
island_poly('fighting-platform','Fire control and ready-service platform',fighting_outline,FCTRL-.20,.20,'steel-deck')
island_poly('fighting-top','Enclosed fire control position',[(84.2,-5.7),(79.4,-5.7),(78.8,0),(79.4,5.7),(84.2,5.7),(85,0)],TOP_FLOOR,TOP_ROOF-TOP_FLOOR,'naval')
island_poly('fighting-roof','Former machine-gun platform, radar support',[(85.2,0),(84.3,-6),(81.8,-11),(79,-6),(78.4,0),(79,6),(81.8,11),(84.3,6)],TOP_ROOF-.14,.14,'steel-deck')
# Searchlight platforms project from the casing, rather than floating beside it.
for side,offset in [('port',11),('starboard',-11)]:
    rect('searchlight-platform-'+side,'36-inch searchlight platform '+side,frame(96),IY+offset*FT,5.4,2.6,ROOF-.14,.14,'steel-deck',cut=.55)
mounts=[]
def mount(id,name,part,x,y,height,bearing,battery,magazine=None):
    m=dict(id=id,name=name,partId=part,battery=battery,position=[r(-y),r(height),r(-x)],bearingDeg=bearing,rangefinder=False)
    if magazine:m['magazineId']=magazine
    mounts.append(m)
for side,y,sgn in [('port',12.65,-1),('starboard',-12.65,1)]:
    for n,x in enumerate([82,74,-99,-107],1):
        mid='five-inch-'+side+'-'+str(n)
        height=FLIGHT-2.1 if n%2 else FLIGHT-1.0
        mount(mid,('Port' if side=='port' else 'Stbd')+' 5-inch '+str(n),'us-5in38-mk21-single',x,y,height,sgn*90,'main','magazine-forward' if x>0 else 'magazine-aft')
# Fore and aft paired 1.1-inch tubs adjacent to the island (19-N-29691).
for id,x,y,z in [('fore-lower',frame(65),-11.8,FLIGHT),('fore-upper',frame(67),-10.4,COMM),('aft-lower',frame(114),-12,FLIGHT),('aft-upper',frame(110),-10.5,COMM)]:
    mount('quad-'+id,'1.1-inch '+id,'us-11in75-quad',x,y,z,90,'secondary')
# March 1942 photographs identify galleries; precise individual positions await
# a dated CV-6 AA arrangement. Counts are explicit, not disguised twin mounts.
for side,y,sgn in [('port',14.2,-1),('starboard',-14.2,1)]:
    for n,x in enumerate([-116,-112,-66,-61,-56,-51,-46,-41,48,53,58,63],1):
        mount('oerlikon-'+side+'-'+str(n),side.title()+' 20 mm '+str(n),'oerlikon-20mm-single',x,y,FLIGHT-.65,sgn*90,'secondary')
for n,x in enumerate([-7,-2,3,8,13,18],1):
    mount('oerlikon-island-'+str(n),'Island 20 mm '+str(n),'oerlikon-20mm-single',x,-15.5,FLIGHT,90,'secondary')
compartments=[];modules=[]
for id,z,size,kind in [('fore-magazine',-76,22,'magazine'),('boilers-forward',-29,28,'engine'),('boilers-aft',1,28,'engine'),('turbines',32,29,'engine'),('aft-magazine',77,20,'magazine'),('steering-space',102,10,'steering')]:
    width=10 if abs(z)>70 else 17
    compartments.append(dict(id=id,name=id.replace('-',' ').title(),center=[0,-2.7,z],size=[width,8,size],capacityM3=r(width*8*size*.68),pumpM3PerSecond=.035))
    mid='magazine-forward' if id=='fore-magazine' else 'magazine-aft' if id=='aft-magazine' else 'engine-port' if id=='boilers-forward' else id+'-module'
    modules.append(dict(id=mid,name=id.replace('-',' ').title(),kind=kind,center=[0,-2.7,z],size=[width-2,5,size-4],hp=140 if kind=='engine' else 90,compartmentId=id))
b=dict(schemaVersion=1,id='enterprise-cv6',name='USS Enterprise (CV-6)',configuration='June 1942, Battle of Midway; pre-bulge hull; reconstruction in progress',coordinates='meters-y-up-bow-negative-z',modelUrl='/models/enterprise-cv6.glb',
 hull=dict(kind='authored-stations-v1',length=LENGTH,beam=beam,draft=DRAFT,depth=19.0,massKg=25909680,waterplaneAreaM2=4400,reserveBuoyancyM3=6500,
 halfBreadths=[[s['station'],max(p[0] for p in s['points'])] for s in sections],deckHeights=[[s['station'],s['points'][-1][1]] for s in sections],keelHeights=[[s['station'],s['points'][0][1]] for s in sections],sections=sections),
 handling=dict(forwardSpeed=32.5*1852/3600,reverseSpeed=3.5,acceleration=.22,braking=.18,rudderRate=.4,maxYawRate=.024),
 mounts=mounts,mountEnvelope=dict(beam=35,length=LENGTH),structures=structures,
 viewpoints=dict(bridge=[r(-IY),r(NAV+1.7),r(-frame(68.4))]),
 armor=[dict(id='hull-plating',name='Hull plating (gameplay proxy)',center=[0,-1.5,0],size=[24,12,232],thicknessMm=19),dict(id='machinery-belt',name='Machinery belt',center=[0,-.7,0],size=[24.8,4.5,133],thicknessMm=101.6),dict(id='protective-deck',name='Protective deck',center=[0,2.1,0],size=[23,.0381,148],thicknessMm=38.1)],
 modules=modules,compartments=compartments,connections=[dict(fromId=a['id'],toId=b['id'],areaM2=.018) for a,b in zip(compartments,compartments[1:])],
 obstructions=[dict(id='hangar-obstruction',center=[0,10.8,7.5],size=[18,5.2,163]),dict(id='island-obstruction',center=[-IY,FLIGHT+5.5,-11],size=[5.0,11,44])],
 accuracy=dict(exterior='Dimensional reconstruction from CV-6 contract offsets, CV-5 as-built plans and CV-6 1942 photos. See open discrepancies; not certified 100% accurate.',internals='Provisional renderer-free damage volumes, not historical watertight subdivisions.',weapons='8 single 5-inch/38, 4 quadruple 1.1-inch, 30 single 20 mm. Local fitting geometry, some placements and ballistic/damage values remain provisional.'))
(ROOT/'blueprint.json').write_text(json.dumps(b,indent=2)+'\n')
print('Wrote blueprint:',len(sections),'hull sections;',len(mounts),'mounts; dimensions',LENGTH,beam,DRAFT)
