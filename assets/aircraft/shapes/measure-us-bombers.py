"""Original sparse silhouette reconstruction from retained orthographic drawings.
Run from repository root. Coordinates below are manually picked ORIGINAL-image pixels,
not traced SVG paths or geometry from another model. Elliptic sections between
silhouette stations remain inferred and are explicitly not manufacturing data.
"""
from pathlib import Path
import json, math
from PIL import Image, ImageDraw
ROOT=Path('assets/aircraft')

def make(id,L,B,image,source,title,variant,reg,body,wing,tail,fin,canopy,cowl,prop,gear,extras,notes,license='Public domain, U.S. Navy Bureau of Aeronautics'):
    # side: positive x may point aft or forward; topLengthAxis handles rotated plates.
    sn,st,shaft=reg['side']['noseXPx'],reg['side']['tailXPx'],reg['side']['shaftYPx']
    reg['side'].update({'noseX':sn,'tailX':st,'engineShaftY':shaft,'imagePath':str(ROOT/'references/schematics'/id/image)})
    if reg['top']['lengthAxis']=='x':
        reg['plan']={'noseX':reg['top']['noseAxisPx'],'tailX':reg['top']['tailAxisPx'],'centerY':reg['top']['centerPx'],'spanPx':reg['top']['spanPx'],'imagePath':str(ROOT/'references/schematics'/id/image),'sourceTransform':'identity'}
    else:
        reg['plan']={'noseX':reg['top']['noseAxisPx'],'tailX':reg['top']['tailAxisPx'],'centerY':reg['top']['centerPx'],'spanPx':reg['top']['spanPx'],'imagePath':str(ROOT/'references/schematics'/id/image),'sourceTransform':{'operation':'transpose','description':'Reference original has nose down; transpose image so newX=oldY, newY=oldX; nose then points right.'}}
    ss=L/abs(st-sn)
    tn,tt=reg['top']['noseAxisPx'],reg['top']['tailAxisPx']
    ts=B/reg['top']['spanPx']; ht=reg['top']['tailHalfSpanPx']
    u=lambda x:(x-sn)/(st-sn)
    tu=lambda x:(x-tn)/(tt-tn)
    z=lambda y:(shaft-y)*ss
    span=lambda p:p/(reg['top']['spanPx']/2)
    q=lambda x:round(x,5)
    tuples=lambda rows:[[q(v) for v in row] for row in rows]
    body=sorted(body,key=lambda p:u(p[0]));canopy=sorted(canopy,key=lambda p:u(p[0]))
    o={'schemaVersion':1,'id':id,'reference':{'sourceUrl':source,'imagePath':str(ROOT/'references/schematics'/id/image),'sourceTitle':title,'variant':variant,'license':license,'notes':notes,'registration':reg},
       'fuselage':tuples([[u(x),w*ts,z(b),z(t)] for x,w,b,t in body]),
       'wing':tuples([[span(s),tu(le),tu(te),zz] for s,le,te,zz in wing]),
       'horizontalTail':tuples([[s/ht,tu(le),tu(te),zz] for s,le,te,zz in tail]),
       'tailSpan':q(ht*2*ts),
       'fin':tuples([[u(x),z(y)] for x,y in fin]),
       'canopy':tuples([[u(x),w*ts,z(base),z(top)] for x,w,base,top in canopy]),
       'cowling':{'frontU':q(u(cowl[0])),'rearU':q(u(cowl[1])),'radiusM':q(cowl[2])},
       'propeller':{'u':q(u(prop[0])),'radiusM':prop[1],'blades':prop[2],'spinnerLengthM':prop[3]},
       'gear':{'mainU':q(u(gear[0])),'trackM':gear[1],'wheelRadiusM':gear[2],'wheelZM':q(z(gear[3])),'tailU':q(u(gear[4])),'tailWheelZM':q(z(gear[5]))},
       'extras':extras,
       'measurement':{'method':'Manual original raster pixel landmarks registered independently in top, side and front views. Linear metric conversion; intervening sections inferred.','lengthM':L,'wingspanM':B,'sideMetersPerPixel':q(ss),'topSpanMetersPerPixel':q(ts),'rawFuselagePixels':body,'rawWingPixels':wing,'rawTailPixels':tail,'rawFinPixels':fin,'rawCanopyPixels':canopy}}
    (ROOT/'shapes'/f'{id}.json').write_text(json.dumps(o,indent=2)+'\n')
    p=ROOT/'references/schematics'/id/image
    im=Image.open(p).convert('RGB');d=ImageDraw.Draw(im)
    # Overlay measured points, keeping every original available unchanged.
    d.line([(x,t) for x,w,b,t in body],fill=(230,80,20),width=2)
    d.line([(x,b) for x,w,b,t in body],fill=(230,80,20),width=2)
    d.line(fin+[fin[0]],fill=(210,20,130),width=2)
    d.line([(x,t) for x,w,b,t in canopy],fill=(0,145,205),width=2)
    center=reg['top']['centerPx']
    topPoint=(lambda s,a:(center+s,a)) if reg['top']['lengthAxis']=='y' else (lambda s,a:(a,center+s))
    for rows,col in [(wing,(0,150,95)),(tail,(75,100,240))]:
        for sign in [-1,1]:
            for j in [1,2]:
                ps=[topPoint(sign*r[0],r[j]) for r in rows];d.line(ps,fill=col,width=2)
                for x,y in ps:d.ellipse((x-2,y-2,x+2,y+2),fill=col)
    for rows in [body,canopy]:
        for row in rows:
            x=row[0];y=row[-1];d.ellipse((x-2,y-2,x+2,y+2),fill=(230,50,20))
    im.save(p.with_name('measured-landmarks.png'))
    print(id,'saved',len(body),'fuselage stations; tail span',o['tailSpan'])

make('tbf-1c-avenger',12.48,16.51,'buaer-tbf-1.jpg',
 'https://commons.wikimedia.org/wiki/File:Grumman_TBF-1_Avenger_BuAer_drawing.jpg',
 'U.S. Navy BuAer Descriptive Arrangement, 1 July 1943','MODEL TBF-1 & 1C; also TBM-1 & 1C',
 {'imageSizePx':[1134,1810], 'side':{'boundsPx':[191,1312,951,1623],'noseXPx':201,'tailXPx':946,'shaftYPx':1482},'top':{'boundsPx':[83,65,1073,798],'lengthAxis':'y','noseAxisPx':795,'tailAxisPx':68,'centerPx':578,'spanPx':987,'tailHalfSpanPx':190},'front':{'boundsPx':[77,850,1085,1160],'centerXPx':576,'shaftYPx':1024,'wingRootYPx':1035,'wingTipYPx':989},'estimatedPickingTolerancePx':3,'registrationNote':'Top and side printing differ by ~2.6 percent in axial scale. Length and span registered independently; engine shaft horizontal in side drawing, ground line intentionally not used as flight datum.'},
 [[243,40,1525,1443],[254,43,1531,1437],[300,45,1541,1426],[354,46,1545,1417],[385,46,1545,1423],[420,46,1546,1430],[465,46,1546,1430],[515,46,1546,1431],[560,44,1547,1432],[605,42,1547,1423],[650,38,1546,1428],[700,33,1541,1426],[750,28,1529,1425],[800,22,1504,1423],[850,17,1496,1430],[890,10,1490,1450],[910,5,1484,1464],[916,1,1478,1475]],
 [[0,617,408,-.2],[45,616,406,-.2],[116,615,406,-.19],[188,603,421,-.02],[260,590,436,.12],[335,578,451,.3],[405,566,465,.44],[463,555,478,.55],[484,552,482,.59],[490,539,490,.61],[493.5,521,521,.61]],
 [[0,197,129, .85],[42,190,69,.85],[85,183,74,.85],[132,176,84,.85],[160,170,101,.85],[183,166,122,.85],[190,148,148,.85]],
 [[801,1423],[811,1417],[820,1394],[832,1358],[843,1330],[852,1323],[865,1321],[882,1322],[900,1327],[908,1365],[918,1420],[932,1463],[913,1470],[883,1466],[867,1466],[867,1435],[801,1435]],
 [[376,13,1419,1418],[388,23,1423,1401],[403,29,1427,1390],[430,30,1428,1387],[468,30,1429,1389],[506,30,1430,1392],[542,29,1430,1394],[567,27,1431,1398],[577,22,1431,1428]],
 [243,354,.86],[230,1.9812,3,.38],[411,3.2004,.4318,1593,785,1530],
 {'turretU':.533,'turretZ':.98,'seatUs':[.315],'gunSpanFractions':[.28],'antennaU':.34,'antennaHeightM':.65,'turret':{'u':.533,'centerZM':.98,'radiusM':.43,'gunLengthM':1.04,'note':'Distinct dorsal ball turret after canopy, not an extended greenhouse.'},'canopyFrames':8,'dorsalSpine':{'frontU':.57,'rearU':.82,'topZM':1.03},'wingFoldSpanFraction':.245,'wingSection':{'root':'NACA 23015','tip':'NACA 23009'},'bombBay':{'frontU':.17,'rearU':.57,'widthM':1.12},'wingGuns':[{'spanFraction':.28,'caliberMm':12.7}],'antenna':{'u':.34,'heightM':.65}},
 ['The retained original sheet explicitly includes TBF-1C and wing-gun annotation; no variant extrapolation needed for principal silhouette.','Source dimensions include span 54 ft 2 in, tail span 20 ft 10 in, main tread 10 ft 6 in, propeller diameter 13 ft. Catalog length 12.48 m retained.','Fuselage under the canopy, hidden elliptic sections, root fairings, ventral glazing and turret depth remain reconstructed from orthographic silhouettes, not factory lofting.'])

make('sbd-3-dauntless',10.06,12.65,'buaer-sbd-5.jpg',
 'https://commons.wikimedia.org/wiki/File:Douglas_SBD-5_BuAer_3_view_drawing.jpg',
 'U.S. Navy BuAer SBD-5 & 6 Descriptive Arrangement, 1 June 1944','SBD-5/6 main airframe used for SBD-3; variant-specific intake and sight retained separately',
 {'imageSizePx':[880,1153],'side':{'boundsPx':[184,866,688,1085],'noseXPx':184,'tailXPx':687,'shaftYPx':981},'top':{'boundsPx':[117,30,752,535],'lengthAxis':'y','noseAxisPx':534,'tailAxisPx':31,'centerPx':434,'spanPx':634,'tailHalfSpanPx':135},'front':{'boundsPx':[120,584,753,800],'centerXPx':434,'shaftYPx':703,'wingRootYPx':736,'wingTipYPx':688},'estimatedPickingTolerancePx':2,'registrationNote':'Source side view has horizontal engine shaft with landing gear in airframe-level attitude. Top/side longitudinal scale agrees; tail span label 17 ft 9 in.'},
 [[212,29,1009,952],[220,34,1015,948],[249,35,1019,946],[282,35,1022,943],[300,34,1024,949],[330,32,1024,950],[365,30,1022,950],[400,28,1019,950],[432,26,1014,949],[460,25,1007,941],[500,23,998,944],[540,20,992,944],[575,17,989,947],[610,13,986,952],[647,9,982,956],[675,4,977,961],[685,1,969,967]],
 [[0,427,273,-.6],[47,427,273,-.6],[85,420,273,-.6],[143,413,286,-.36],[210,405,301,-.1],[282,394,316,.18],[305,381,329,.25],[314,366,343,.28],[317,355,355,.28]],
 [[0,131,61,.39],[35,124,60,.39],[75,115,61,.39],[110,108,61,.39],[125,100,67,.39],[133,91,75,.39],[135,84,84,.39]],
 [[535,944],[562,940],[585,934],[602,924],[614,910],[625,888],[637,873],[648,867],[657,870],[666,881],[674,906],[680,934],[687,959],[686,968],[681,975],[666,980],[636,981],[592,984]],
 [[302,13,948,944],[315,22,950,932],[326,26,950,924],[350,27,950,923],[375,27,950,924],[400,26,950,925],[422,25,950,927],[438,21,949,934],[453,11,948,941],[459,2,944,943]],
 [212,282,.735],[202,1.6764,3,.3],[311,3.2131,.381,1059,656,990],
 {'seatUs':[.35,.495],'aileronStart':.66,'canopyFrames':7,'wingFoldSpanFraction':None,'diveBrakes':{'innerSpanFraction':.12,'outerSpanFraction':.74,'chordFraction':.22,'perforated':True,'holeDiameterM':.065,'redInterior':True},'wingSection':{'root':'NACA 2415','tip':'NACA 2407'},'rearGun':{'u':.52,'baseZM':.92,'barrelLengthM':.75},'centerBombCrutch':{'frontU':.26,'rearU':.51},'intake':{'u':.13,'topZM':.81,'widthM':.27,'heightM':.12,'note':'SBD-3 raised carburetor intake is a variant detail absent from SBD-5 drawing.'},'telescopicSight':{'frontU':.16,'rearU':.29,'heightM':.15}},
 ['Primary retained SBD-5/6 drawing supplies common airframe, broad fixed inner wing, rounded tips and long curved dorsal-fin root; this does not certify an SBD-3-specific engine cowling.','SBD-3 upper carburetor intake and telescopic sight are explicit variant approximations; exact -3 cowling-panel stations remain unresolved.','No wing fold: the SBD had fixed wings. Perforated split dive brakes are a required visible distinguishing feature. Cross-sections, fillets and canopy curvature between measured silhouettes remain inferred.'])

make('sb2c-4-helldiver',11.18,15.16,'buaer-sb2c-5.jpg',
 'https://commons.wikimedia.org/wiki/File:Curtiss_SB2C_Helldiver_BuAer_3_side_view.jpg',
 'U.S. Navy BuAer SB2C Descriptive Arrangement from SB2C-5 characteristic sheet','Sheet labels SB2C-1/1C outline with SB2C-3/4/5 engine/propeller note; used for SB2C-4 principal airframe',
 {'imageSizePx':[354,543],'side':{'boundsPx':[59,406,279,503],'noseXPx':60,'tailXPx':278,'shaftYPx':470},'top':{'boundsPx':[18,13,315,234],'lengthAxis':'y','noseAxisPx':232,'tailAxisPx':14,'centerPx':167,'spanPx':296,'tailHalfSpanPx':57},'front':{'boundsPx':[19,257,316,354],'centerXPx':168,'shaftYPx':318,'wingRootYPx':327,'wingTipYPx':312},'estimatedPickingTolerancePx':1.5,'registrationNote':'Low resolution primary scan limits station precision to roughly 0.08 m. Side full level length 36 ft 8 in; top span 49 ft 8.75 in. Tail span reconstructed by span ratio.'},
 [[72,13,479,457],[76,15,482,453],[87,15.5,484,451],[104,15.5,485,449],[117,15,486,456],[132,14.5,486,457],[149,14,485,457],[167,13.5,483,457],[184,13,480,457],[201,12,478,451],[216,10,475,450],[232,8,471,450],[246,6,468,452],[257,4,465,454],[266,2,460,455],[270,.5,457,456]],
 [[0,175,104,-.45],[17,175,106,-.43],[38,175,112,-.33],[65,175,120,-.2],[91,175,126,-.07],[116,175,132,.07],[134,175,138,.17],[143,172,145,.22],[147,166,154,.24],[148,161,161,.24]],
 [[0,72,34,1.12],[12,65,27,1.12],[27,59,27,1.12],[41,53,28,1.12],[50,47,31,1.12],[55,42,36,1.12],[57,39,39,1.12]],
 [[215,449],[223,443],[230,433],[238,418],[246,411],[253,408],[259,408],[266,412],[272,420],[276,432],[278,443],[275,450],[268,455],[258,458],[252,464],[249,468],[231,473],[219,471]],
 [[115,4,454,451],[122,8.5,457,445],[129,10,457,444],[140,10,457,444],[153,10,457,444],[166,10,457,444],[179,9.5,457,444],[191,9,457,445],[199,7,456,447],[201,2,453,451]],
 [72,104,.80],[68,1.8542,4,.42],[121,4.8768,.4191,494,249,468],
 {'seatUs':[.35,.60],'gunSpanFractions':[.435],'canopyFrames':9,'wingFoldSpanFraction':.43,'diveBrakes':{'innerSpanFraction':.14,'outerSpanFraction':.43,'chordFraction':.26,'perforated':True,'holeDiameterM':.075,'redInterior':True},'wingSection':{'root':'NACA 23017','tip':'NACA 23009'},'rearGun':{'u':.66,'baseZM':1.19,'barrelLengthM':.82},'wingGuns':[{'spanFraction':.435,'caliberMm':20}],'bombBay':{'frontU':.27,'rearU':.68,'widthM':1.15},'finNote':'High rounded crown and convex aft rudder, with low dorsal root; never a triangle.','spinner':'Four-blade SB2C-4 propeller; source printed three-blade silhouette is overridden by its own -3/4/5 annotation.'},
 ['BuAer sheet is genuine but only 354 × 543 px; broad proportions are measured and small features require subsequent high-resolution maintenance-drawing corroboration.','Main wing has almost straight leading edge, strongly tapered trailing edge and full dihedral. Tall round-topped fin/rudder and deep bomb-bay fuselage distinguish the type.','Retained source explicitly notes four-blade 12 ft 2 in propeller for SB2C-3,4,5; main illustration uses earlier three-blade propeller. Recipe uses four blades.','SB2C-4 perforated dive-brake details, panel seams and canopy framing are reconstructed; factory sections not available.'])

make('tbd-1-devastator',10.67,15.24,'commons-tbd.png',
 'https://commons.wikimedia.org/wiki/File:Douglas_TBD_Devastator_3-view.svg',
 'Douglas TBD Devastator three-view orthographic drawing, Kaboldy, 25 October 2011','Production TBD-1 with raised greenhouse canopy',
 {'imageSizePx':[873,1118],'side':{'boundsPx':[279,13,862,211],'noseXPx':860,'tailXPx':280,'shaftYPx':148},'top':{'boundsPx':[278,292,861,1105],'lengthAxis':'x','noseAxisPx':860,'tailAxisPx':280,'centerPx':698,'spanPx':810,'tailHalfSpanPx':144},'front':{'boundsPx':[14,292,238,1106],'centerXPx':146,'shaftYPx':698,'note':'Front view is rotated 90 degrees: span runs vertically, height runs horizontally; main wing low at root with pronounced outer-panel dihedral.'},'estimatedPickingTolerancePx':2,'registrationNote':'Original retained SVG rasterized at nominal size using MuPDF; geometric source paths are not imported. Top span and side length scales differ by 2.3 percent, registered independently.'},
 [[838,29,180,118],[829,32,183,115],[808,33,185,113],[790,34,188,112],[754,35,194,122],[720,36,199,122],[680,35,201,122],[640,33,198,122],[590,30,194,122],[530,27,187,120],[480,23,178,118],[430,18,166,113],[400,14,159,109],[370,10,154,110],[335,7,150,113],[300,5,142,116],[283,1.5,131,121]],
 [[0,723,512,-.63],[45,723,519,-.63],[80,722,533,-.63],[120,718,545,-.61],[185,714,560,-.39],[250,710,575,-.15],[315,704,592,.08],[365,698,605,.25],[391,686,619,.35],[401,674,634,.38],[405,657,657,.4]],
 [[0,411,326,.59],[22,403,296,.59],[60,389,300,.59],[100,374,304,.59],[126,360,312,.59],[140,348,326,.59],[144,337,335,.59]],
 [[406,108],[394,105],[384,98],[370,82],[353,50],[338,25],[323,14],[311,19],[300,36],[289,66],[282,100],[280,121],[283,131],[290,139],[310,145],[335,151],[362,155]],
 [[754,7,121,112],[735,19,121,101],[715,25,121,91],[697,27,121,83],[681,27,120,80],[655,26,120,84],[622,25,120,88],[592,25,120,94],[560,24,120,98],[533,24,119,103],[530,23,119,118]],
 [838,790,.66],[846,1.60,3,.25],[697,3.1,.368,250,337,167],
 {'seatUs':[.31,.414,.535],'canopyFrames':10,'wingFoldSpanFraction':.295,'wingCorrugations':{'outerSpanFraction':.30,'endSpanFraction':.96,'pitchM':.056,'depthM':.008,'direction':'chordwise'},'wingSection':{'root':'NACA 22 family, inferred thickness','tip':'NACA 22 family, inferred thickness'},'rearGun':{'u':.56,'baseZM':.60,'barrelLengthM':.70},'torpedoCrutch':{'frontU':.31,'rearU':.65,'semiRecessed':True},'gearNote':'Semi-retractable wheels remain partly exposed when retracted; extended depiction uses main underwing yoke rather than generic vertical fuselage gear.','telescopicSight':{'frontU':.165,'rearU':.29,'heightM':.19}},
 ['Credited modern technical orthographic reference, not a factory drawing. Original SVG and an unchanged nominal raster are retained under source license.','Official NHHC Dictionary of American Naval Aviation Squadrons volume I page 511 confirms span 50 ft and length 35 ft; its original PDF now returns 404 and mirror 403 during acquisition, so it was not used as the measured raster.','Wing shape, long raised three-place greenhouse, very narrow tail fuselage and corrugated outer wing are measured or located from retained three-view. Small sections and extended gear geometry remain inferred.'],
 license='Reference only: Kaboldy, CC BY-SA 3.0 https://creativecommons.org/licenses/by-sa/3.0/; raster is unchanged conversion of retained original SVG. Sparse dimensional landmarks are factual measurements; independently constructed mesh topology.')
