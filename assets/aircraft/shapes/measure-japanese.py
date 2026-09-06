#!/usr/bin/env python3
"""Recompute Japanese shape contracts from manually digitised published three views.

Pixels are retained here so the correspondence is inspectable. Top and side views
are registered independently; the nominal catalog length/span sets metric scale.
Hidden portions of fuselage under wing fillets and canopy are reconstructed.
"""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
CAT={a['id']:a for a in json.loads((ROOT/'assets/aircraft/catalog.json').read_text())['aircraft']}

def lerp(points,x):
 if x<=points[0][0]:return points[0][1:]
 for a,b in zip(points,points[1:]):
  if x<=b[0]:
   t=(x-a[0])/(b[0]-a[0]);return [p+(q-p)*t for p,q in zip(a[1:],b[1:])]
 return points[-1][1:]

DATA={
'a6m2-zero':dict(
 title='Mitsubishi A6M2 three-view drawing, CombinedFleet IJNAF reference archive',url='https://www.combinedfleet.com/ijna/a6m.htm',image='three-view.png',variant='A6M2 Model 21; the small upper nose is A6M1 and excluded',
 top=[33,509,478,159,794],side=[283,768,266],front=[89,722,405,700],
 # x, upper fuselage outline y, lower fuselage outline y (top view)
 width=[[59,451,505],[75,447,508],[95,447,508],[115,447,507],[140,446,508],[180,447,508],[220,449,504],[270,453,501],[315,457,497],[360,461,493],[400,465,488],[440,469,485],[475,473,482],[495,476,480],[509,478,478]],
 # x, upper and lower body outline (side; exclude canopy, fin and wing fillets)
 body=[[310,248,286],[316,239,297],[330,235,301],[349,235,301],[360,236,301],[382,232,300],[410,229,299],[440,230,297],[477,232,297],[521,235,296],[575,238,290],[625,242,286],[673,245,283],[706,249,279],[735,253,276],[754,263,273],[768,270,270]],
 wing=[[478,114,267,-.57],[445,119,251,-.52],[410,123,246,-.47],[360,128,238,-.39],[310,132,230,-.31],[260,137,219,-.23],[210,142,211,-.14],[184,148,207,-.10],[173,155,201,-.08],[165,164,194,-.07],[160,173,184,-.06],[159,177,178,-.06]],
 tail=[[478,386,467,.12],[455,393,463,.12],[430,401,458,.12],[405,410,454,.12],[382,418,451,.12],[366,424,445,.12],[359,431,440,.12],[357,435,436,.12]],
 fin=[[641,246],[655,243],[667,234],[679,219],[692,203],[706,188],[713,183],[721,181],[730,184],[738,193],[744,214],[749,236],[754,253],[766,270],[753,273],[739,268],[713,257],[677,254]],
 canopy=[[397,232,232,232],[410,230,219,228],[427,230,212,223],[440,230,211,221],[459,231,212,223],[479,233,216,226],[497,234,222,231],[512,235,228,235],[522,236,236,238]],
 canopyWidth=[[.23,.20],[.27,.33],[.32,.42],[.37,.39],[.43,.32],[.49,.20]],
 cowl=[310,360,32],prop=[302,83,3,19],gear=[382,195,17,350,736,288],
 extras={'engine':'radial','wingFoldFraction':.9,'gunSpanM':[1.8],'canopyFrameU':[.275,.308,.351,.394,.433],'antennaU':.45,'antennaHeightM':.85,'dropTank':False,'distinctive':'Long rounded Model 21 folding wingtips, low rounded fin, short single-pilot greenhouse.'}),
'd3a1-val':dict(
 title='Aichi D3A1 three-view drawing, CombinedFleet IJNAF reference archive',url='https://www.combinedfleet.com/ijna/d3a.htm',image='three-view.png',variant='D3A1 Model 11',
 top=[56,466,320,40,599],side=[309,719,134],front=[197,762,479,491],
 width=[[77,300,342],[87,296,346],[104,296,346],[118,297,345],[140,297,344],[170,298,343],[205,299,341],[240,300,341],[278,304,337],[315,307,333],[348,309,331],[380,312,328],[410,316,325],[440,319,323],[458,320,322],[466,321,321]],
 body=[[330,116,153],[341,110,160],[357,110,161],[368,111,160],[391,105,158],[414,106,158],[440,110,158],[471,110,156],[501,110,156],[520,108,156],[553,109,153],[590,111,150],[630,115,148],[663,122,143],[698,129,139],[719,135,135]],
 wing=[[320,128,277,-.49],[290,132,254,-.46],[252,132,254,-.41],[210,135,251,-.34],[174,141,249,-.26],[137,150,240,-.17],[107,158,230,-.10],[80,164,217,-.04],[57,170,203,0],[46,176,195,.02],[41,182,190,.03],[40,185,186,.03]],
 tail=[[320,390,465,0],[300,399,465,0],[282,406,462,0],[263,415,458,0],[250,423,451,0],[241,432,447,0],[238,438,442,0]],
 fin=[[568,111],[600,108],[631,106],[643,88],[655,69],[665,61],[676,58],[687,58],[696,63],[702,75],[705,95],[708,119],[712,130],[719,135],[700,139],[674,131],[642,126]],
 canopy=[[408,108,105,108],[421,109,95,99],[431,110,95,96],[445,110,95,96],[466,110,96,97],[487,110,97,98],[499,110,101,104],[511,109,107,108],[520,109,109,109]],
 canopyWidth=[[.24,.20],[.28,.37],[.35,.40],[.44,.39],[.48,.33],[.52,.10]],
 cowl=[330,368,25],prop=[322,62,3,8],gear=[400,124,14,203,680,155],
 extras={'engine':'radial','fixedGear':True,'wheelSpats':True,'diveBrakes':True,'canopyFrameU':[.283,.329,.385,.439],'antennaU':.383,'antennaHeightM':.62,'distinctive':'Elliptical wings; fixed main gear with deep streamlined wheel spats; full-length tandem canopy.'}),
'b5n2-kate':dict(
 title='Nakajima B5N2 three-view drawing, CombinedFleet IJNAF reference archive',url='https://www.combinedfleet.com/ijna/b5n.htm',image='three-view.png',variant='B5N2; upper partial B5N1 side view is excluded',
 top=[23,535,475,103,849],side=[290,801,242],front=[55,800,428,702],
 width=[[46,451,499],[58,447,502],[80,447,502],[94,448,502],[122,447,503],[149,448,500],[180,448,497],[224,448,494],[268,450,492],[307,452,490],[336,453,490],[368,455,488],[405,457,484],[440,461,481],[479,467,479],[511,471,477],[535,475,475]],
 body=[[314,220,262],[324,213,270],[344,213,271],[359,214,272],[385,211,276],[411,211,278],[446,216,278],[485,216,276],[532,219,275],[575,214,274],[605,215,271],[650,217,268],[693,221,263],[728,226,256],[765,232,250],[787,238,246],[801,242,242]],
 wing=[[475,122,366,-.68],[439,137,307,-.62],[399,143,289,-.55],[356,147,284,-.48],[313,152,278,-.41],[265,157,271,-.32],[212,164,261,-.21],[164,169,252,-.10],[136,176,243,-.03],[119,184,231,.01],[108,195,216,.04],[103,202,203,.04]],
 tail=[[475,438,532,.02],[453,449,522,.02],[429,457,519,.02],[406,465,515,.02],[382,473,511,.02],[366,482,506,.02],[357,490,501,.02],[355,495,496,.02]],
 fin=[[702,223],[711,211],[724,190],[739,168],[748,158],[755,155],[764,157],[772,162],[778,176],[781,201],[784,229],[790,237],[801,242],[785,248],[760,241],[733,231]],
 canopy=[[388,211,210,211],[401,214,203,207],[416,215,196,199],[434,216,196,197],[461,217,197,198],[490,218,198,199],[519,219,200,201],[546,219,201,202],[559,219,202,204],[573,216,210,213],[586,215,215,215]],
 canopyWidth=[[.2,.16],[.24,.39],[.30,.42],[.40,.42],[.47,.40],[.53,.30],[.58,.13]],
 cowl=[314,359,29],prop=[307,77,3,16],gear=[422,191,19,330,779,260],
 extras={'engine':'radial','wingFoldFraction':.56,'payload':'torpedo','canopyFrameU':[.249,.309,.366,.423,.479,.525],'antennaU':.472,'antennaHeightM':.88,'distinctive':'Long three-crew greenhouse, broad tapering wing, compact tail and exposed propeller hub.'}),
'b6n2-jill':dict(
 title='Nakajima B6N2 three-view drawing, CombinedFleet IJNAF reference archive',url='https://www.combinedfleet.com/ijna/b6n.htm',image='three-view.png',variant='B6N2 Model 12',
 top=[28,488,357,46,669],side=[271,729,130],front=[176,800,486,573],
 width=[[56,334,381],[75,329,386],[91,328,387],[112,329,388],[138,335,388],[167,337,388],[196,338,386],[225,339,384],[253,341,383],[281,344,382],[308,345,380],[335,346,378],[363,347,374],[391,349,370],[420,353,365],[452,355,362],[488,357,357]],
 body=[[298,111,148],[310,102,155],[330,99,159],[345,95,167],[373,99,166],[396,100,158],[422,103,157],[452,102,158],[480,103,155],[511,103,152],[540,100,151],[574,101,148],[608,102,144],[643,104,140],[674,110,138],[701,119,137],[720,125,135],[729,132,132]],
 wing=[[357,137,304,-.58],[326,143,281,-.54],[288,146,267,-.46],[248,149,259,-.37],[212,153,252,-.29],[172,157,242,-.20],[132,162,233,-.11],[98,165,226,-.03],[75,168,217,.02],[58,176,207,.05],[49,187,198,.07],[46,190,191,.07]],
 tail=[[357,407,480,.37],[334,414,477,.37],[306,419,473,.37],[281,423,468,.37],[260,429,463,.37],[246,434,456,.37],[241,442,451,.37],[240,446,447,.37]],
 fin=[[650,105],[661,99],[670,77],[678,53],[683,44],[691,42],[700,47],[709,58],[714,77],[719,98],[723,118],[729,132],[719,136],[702,127],[676,114]],
 canopy=[[391,99,97,99],[403,99,90,93],[416,100,86,87],[436,102,86,87],[462,103,86,87],[487,103,86,87],[510,103,86,87],[532,103,88,89],[548,101,95,98],[557,100,100,100]],
 canopyWidth=[[.25,.2],[.30,.4],[.38,.43],[.45,.43],[.52,.4],[.59,.18]],
 cowl=[298,373,31],prop=[290,71,4,20],gear=[400,211,14,212,704,151],
 extras={'engine':'radial','wingFoldFraction':.38,'payload':'torpedo','canopyFrameU':[.319,.374,.426,.477,.527],'antennaU':.267,'antennaHeightM':.98,'distinctive':'Bulky stepped engine cowling, four-blade prop, long greenhouse, nearly upright tall rounded fin.'}),
'a6m5-zero':dict(
 title='Mitsubishi A6M5 Zero, Kalab, Modelar 3/1969 p.23 (RCLibrary 13451)',url='https://rclibrary.co.uk/3view.asp?ID=13451',image='rc3v13451-thumb-large.jpg',variant='A6M5 Model 52; use complete lower half of top view',
 top=[46,595,414,86,742],side=[47,595,146],front=[278,570,425,685],
 width=[[82,386,442],[96,378,449],[135,378,450],[156,379,450],[180,379,450],[205,380,448],[235,381,447],[266,382,447],[300,384,446],[333,386,442],[368,389,438],[405,391,434],[447,395,430],[490,400,424],[533,406,420],[568,410,417],[595,414,414]],
 body=[[82,120,169],[93,109,180],[111,105,182],[138,105,183],[157,105,181],[174,105,184],[198,110,185],[230,113,185],[269,114,183],[316,111,183],[355,113,179],[395,115,174],[441,117,168],[480,122,162],[519,127,157],[555,132,153],[580,141,150],[595,147,147]],
 wing=[[414,156,332,-.65],[450,157,304,-.60],[493,159,285,-.52],[540,164,279,-.43],[588,168,271,-.34],[633,171,264,-.24],[677,175,258,-.15],[705,182,252,-.10],[722,192,245,-.07],[733,201,234,-.05],[740,210,225,-.04],[742,218,219,-.04]],
 tail=[[414,450,548,.15],[445,459,542,.15],[472,467,539,.15],[499,477,535,.15],[524,486,530,.15],[542,493,522,.15],[552,503,514,.15],[554,509,510,.15]],
 fin=[[456,120],[471,116],[484,98],[500,77],[518,54],[530,46],[539,44],[547,46],[555,54],[563,73],[571,99],[580,128],[586,141],[595,147],[579,151],[559,144],[534,137],[500,129]],
 canopy=[[176,105,103,105],[192,108,92,101],[211,110,82,95],[229,111,81,92],[246,112,83,96],[267,113,88,100],[286,114,94,107],[306,112,104,111],[320,111,111,112]],
 canopyWidth=[[.235,.15],[.29,.39],[.34,.43],[.39,.37],[.44,.29],[.49,.13]],
 cowl=[82,156,38],prop=[75,90,3,29],gear=[161,211,18,244,562,168],
 extras={'engine':'radial','wingFoldFraction':None,'exhaustStacks':True,'gunSpanM':[1.76],'canopyFrameU':[.299,.332,.376,.421,.455],'antennaU':.46,'antennaHeightM':.81,'distinctive':'Short rounded nonfolding Model 52 wings; individual exhausts; single pilot canopy and rounded Zero fin.'}),
'd4y2-judy':dict(
 title='Yokosuka D4Y2-C, P. Endsleigh Castle, Aircraft Profile 241 plate (scan p.17)',url='https://www.gruppofalchi.com/files/Profile-Publications-Aircraft-241---Aichi-D3A-Yokosuka-D4Y.pdf',image='profile-241-page-17-measure.png',variant='D4Y2-C reconnaissance Model 1-2; external airframe used for D4Y2, bomber-bay internals not evidenced',
 top=[205,1218,654,62,1243],side=[190,1216,1507],front=[113,1288,702,195],topImage='top-registered.png',
 width=[[264,624,686],[300,613,699],[350,606,705],[408,606,708],[468,606,707],[526,607,707],[580,608,706],[645,609,705],[710,610,704],[777,613,700],[841,617,695],[899,622,691],[964,627,686],[1022,632,680],[1077,638,674],[1136,645,668],[1190,650,661],[1218,654,654]],
 body=[[251,1470,1533],[280,1464,1541],[325,1457,1545],[376,1453,1549],[419,1449,1551],[461,1450,1558],[494,1455,1596],[552,1457,1595],[613,1457,1590],[676,1456,1585],[738,1453,1580],[802,1454,1570],[860,1458,1559],[922,1462,1553],[979,1466,1546],[1037,1470,1540],[1098,1477,1535],[1160,1484,1531],[1203,1498,1524],[1216,1510,1516]],
 wing=[[654,453,756,-.71],[710,463,732,-.64],[781,470,706,-.55],[856,475,694,-.45],[931,479,681,-.35],[1007,484,667,-.25],[1080,489,654,-.15],[1142,495,638,-.07],[1190,501,621,0],[1220,516,600,.04],[1237,539,577,.06],[1243,556,557,.07]],
 tail=[[654,1025,1180,.29],[693,1038,1175,.29],[737,1048,1171,.29],[780,1058,1164,.29],[826,1070,1157,.29],[867,1080,1148,.29],[894,1094,1135,.29],[907,1105,1120,.29],[909,1112,1113,.29]],
 fin=[[1018,1468],[1037,1450],[1060,1406],[1086,1362],[1105,1345],[1128,1335],[1151,1337],[1172,1350],[1183,1374],[1191,1410],[1198,1451],[1204,1482],[1215,1506],[1209,1522],[1180,1530],[1140,1509],[1100,1491],[1050,1481]],
 canopy=[[468,1450,1448,1450],[491,1454,1429,1440],[523,1457,1409,1430],[558,1457,1410,1426],[596,1457,1411,1428],[630,1457,1412,1429],[666,1457,1413,1432],[704,1457,1417,1436],[745,1456,1425,1440],[788,1455,1437,1447],[831,1455,1451,1454],[848,1455,1455,1455]],
 canopyWidth=[[.27,.14],[.32,.42],[.39,.45],[.46,.43],[.52,.37],[.59,.25],[.64,.06]],
 cowl=[251,465,40],prop=[240,151,3,50],gear=[477,488,31,1677,1150,1568],
 extras={'engine':'inline','chinRadiator':{'frontU':.09,'rearU':.43,'zM':-.73,'heightM':.30,'widthM':.82},'exhaustStacks':True,'payload':'bomb','canopyFrameU':[.331,.397,.464,.526],'antennaU':.464,'antennaHeightM':1.03,'distinctive':'Long slender inline-engine nose; deep chin radiator; short broad rounded wing and tandem greenhouse.'})
}

# Front-view wing centerline samples. The thick section's middle, rather than its
# upper or lower silhouette, defines the neutral lifting-surface height.
# A6M5's partial front view uses the plate scale and extrapolates the measured
# outer-panel slope to its absent tips; those final heights remain approximate.
FRONT_WING={
 'a6m2-zero':[[0,714],[.10,714],[.32,708],[.6,700],[.85,691],[1,686]],
 'd3a1-val':[[0,511],[.23,511],[.4,507],[.6,500],[.8,493],[1,485]],
 'b5n2-kate':[[0,725],[.27,725],[.42,720],[.62,709],[.82,699],[1,689]],
 'b6n2-jill':[[0,590],[.12,590],[.36,582],[.65,572],[.85,563],[1,557]],
 'a6m5-zero':[[0,713],[.1,711],[.3,705],[.44,700],[1,685]],
 'd4y2-judy':[[0,232],[.1,232],[.3,224],[.55,216],[.8,208],[1,202]],
}

def build(id,d):
 a=CAT[id];L=a['length'];S=a['wingspan'];tn,tt,tc,tup,tdown=d['top'];sn,st,sz=d['side'];tl=tt-tn;sl=st-sn;zs=L/sl;ys=S/(tdown-tup)
 U=lambda x:(x-sn)/sl
 TU=lambda x:(x-tn)/tl
 out={'schemaVersion':1,'id':id,'reference':{'sourceUrl':d['url'],'imagePath':f'assets/aircraft/references/schematics/{id}/{d["image"]}','sourceTitle':d['title'],'variant':d['variant'],'notes':['Manually digitised top/side silhouettes, independently registered to catalog length and wingspan.','Published reference drawing, not manufacturing geometry. Pixel rounding, scan distortion, hidden cross sections, canopy width and small details remain approximations.'],'registration':{'top':{'noseX':tn,'tailX':tt,'centerY':tc,'portTipY':tup,'starboardTipY':tdown,'imagePath':f'assets/aircraft/references/schematics/{id}/{d.get("topImage",d["image"])}'},'side':{'noseX':sn,'tailX':st,'engineShaftY':sz,'imagePath':f'assets/aircraft/references/schematics/{id}/{d["image"]}'},'front':{'leftTipX':d['front'][0],'rightTipX':d['front'][1],'centerX':d['front'][2],'engineShaftY':d['front'][3],'imagePath':f'assets/aircraft/references/schematics/{id}/{d["image"]}','metersPerPixel':zs if id=='a6m5-zero' else S/(d['front'][1]-d['front'][0]),'wingTipsCropped':id=='a6m5-zero'}}},'fuselage':[],'wing':[],'horizontalTail':[],'fin':[],'canopy':[]}
 for x,top,bottom in d['body']:
  u=U(x);p=tn+u*tl;wup,wdown=lerp(d['width'],p);out['fuselage'].append([u,(wdown-wup)*ys/2,(sz-bottom)*zs,(sz-top)*zs])
 for y,lead,trail,z in d['wing']:out['wing'].append([abs(y-tc)/((tdown-tup)/2),TU(lead),TU(trail),z])
 # Force geometric tips to catalog span; small left/right scan asymmetry is explicit.
 tip=out['wing'][-1][0]
 for row in out['wing']:
  row[0]/=tip
  front_y=lerp(FRONT_WING[id],row[0])[0]
  front_scale=zs if id=='a6m5-zero' else S/(d['front'][1]-d['front'][0])
  row[3]=(d['front'][3]-front_y)*front_scale
 tailhalf=abs(d['tail'][-1][0]-tc);out['tailSpan']=tailhalf*2*ys
 for y,lead,trail,z in d['tail']:out['horizontalTail'].append([abs(y-tc)/tailhalf,TU(lead),TU(trail),z])
 for x,y in d['fin']:out['fin'].append([U(x),(sz-y)*zs])
 for x,base,top,ignored in d['canopy']:
  u=U(x);w=lerp(d['canopyWidth'],u)[0];out['canopy'].append([u,w,(sz-base)*zs,(sz-top)*zs])
 cf,cr,rad=d['cowl'];out['cowling']={'frontU':U(cf),'rearU':U(cr),'radiusM':rad*zs}
 pu,pr,blades,spinner=d['prop'];out['propeller']={'u':U(pu),'radiusM':pr*zs,'blades':blades,'spinnerLengthM':spinner*zs}
 gu,track,wr,wz,tu,twz=d['gear'];fs=zs if id=='a6m5-zero' else S/(d['front'][1]-d['front'][0]);out['gear']={'mainU':U(gu),'trackM':track*fs,'wheelRadiusM':wr*zs,'wheelZM':(sz-wz)*zs,'tailU':U(tu),'tailWheelZM':(sz-twz)*zs}
 out['extras']=d['extras']
 out['reference']['notes'].append('Canopy lateral widths and hidden body contours are reconstructed inside the measured exterior envelope. Wing dihedral is digitised approximately from the front view, not an airfoil or load-bearing engineering specification.')
 if id=='a6m5-zero':out['reference']['notes'].append('RCLibrary PDF link returned HTTP 404. Original available 640-pixel plate preview retained, including creator and page credit; no claim of higher-resolution source. Front view wings are cropped; gear track uses the side-view pixel scale rather than cropped front extent.')
 if id=='d4y2-judy':out['reference']['notes']+=['Plan registration: source PDF page 17 rendered at 2x (2064x2784), reduced to 1376x1856; crop [80,330,1270,1300], rotate +66 degrees, expand. No nonuniform plan warping.','Illustrated D4Y2-C uses inline Atsuta engine; D4Y3/4 radial drawings deliberately excluded. Chin radiator is separate from primary fuselage loft.']
 def rounded(v):
  if isinstance(v,float):return round(v,5)
  if isinstance(v,list):return [rounded(x) for x in v]
  if isinstance(v,dict):return {k:rounded(x) for k,x in v.items()}
  return v
 (ROOT/f'assets/aircraft/shapes/{id}.json').write_text(json.dumps(rounded(out),indent=2)+'\n')
 return out

if __name__=='__main__':
 for id,d in DATA.items():
  out=build(id,d);print(id,'fuselage',len(out['fuselage']),'wing',len(out['wing']),'tail span',round(out['tailSpan'],2))
