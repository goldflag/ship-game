"""Analytical S02 plan/profile registration; never consumed by production build."""
from pathlib import Path
import json
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1]
D=json.loads((ROOT/'../../../public/models/shokaku.json').resolve().read_text())
OUT=ROOT/'reports'/('geometry-'+D['contentHash'][:8]);OUT.mkdir(exist_ok=True)
im=Image.open(ROOT/'references/ijn-shokaku-1941-aircraft-carrier-detailed-BP.png').convert('RGB')
scale=(4705-38)/257.5;origin=2371.5
profile=lambda x,z:(origin+x*scale,625-z*scale)
plan=lambda x,y:(origin+x*scale,1375-y*scale)
layer=Image.new('RGBA',im.size);draw=ImageDraw.Draw(layer)
structures={s['id']:s for s in D['structures']}
for s in D['structures']:
 if s['id'].startswith(('island-','bridge-','navigation-','compass-','air-control','stern-')):
  pts=[(-z,-x) for x,z in s['footprint']]
  a=min(x for x,y in pts);b=max(x for x,y in pts);lo=s['baseY'];hi=lo+s['height']
  draw.line([profile(a,lo),profile(b,lo),profile(b,hi),profile(a,hi),profile(a,lo)],fill=(220,30,50,200),width=2)
  draw.line([plan(x,y) for x,y in pts+[pts[0]]],fill=(220,30,50,200),width=2)
  # Profile plate tops and bulwark tops are different source landmarks.
  if s['id'] in ['compass-platform','bridge-roof']:
   top=hi+(1.23 if s['id']=='bridge-roof' else 1.02)
   draw.line([profile(a,hi),profile(a,top),profile(b,top),profile(b,hi)],fill=(175,65,210,210),width=2)
for index in [0,-1]:
 draw.line([profile(s['station']-D['hull']['length']/2,s['points'][index][1]) for s in D['hull']['sections']],fill=(15,90,225,220),width=3)
# Flight deck surface is curved at the terminal round-down only.
draw.line([profile(x,14.75-.62*max(0,min(1,(-118.5-x)/6.55))**2) for x in [-125.05,-124,-122,-120,-118.5,117.15]],fill=(0,155,80,220),width=3)
merged=Image.alpha_composite(im.convert('RGBA'),layer).convert('RGB')
for name,box in [('island-profile',(2790,120,3300,470)),('island-plan',(2800,1500,3310,1760)),('stern-profile',(0,100,1060,850)),('stern-plan',(0,1030,1060,1720))]:
 original=im.crop(box);overlay=merged.crop(box);sheet=Image.new('RGB',(original.width*2,original.height+30),'white')
 sheet.paste(original,(0,30));sheet.paste(overlay,(original.width,30));caption=ImageDraw.Draw(sheet)
 caption.text((8,8),'S02 reference',fill='black');caption.text((original.width+8,8),'Current blueprint: red structures / blue hull / green flight deck',fill='black')
 sheet.save(OUT/('s02-'+name+'.png'))
floors=[]
for id,pixel in [('bridge-walkway',358),('navigation-wings',316),('compass-platform',272),('bridge-roof',233)]:
 s=structures[id];actual=s['baseY']+s['height'];reference=(625-pixel)/scale
 floors.append({'id':id,'referencePixelY':pixel,'referenceHeightM':reference,'modeledHeightM':actual,'differenceM':actual-reference})
(OUT/'registration.json').write_text(json.dumps({'contentHash':D['contentHash'],'source':'s02','isotropic':True,'pixelsPerMetre':scale,'sternPixelX':38,'bowPixelX':4705,'profileWaterlineY':625,'planCenterlineY':1375,'referenceDraftM':8.87,'islandFloorLandmarks':floors,'notes':['Modern secondary plan; original drawing date/source unresolved.','Profile outlines show minimum/maximum longitudinal footprint bounds, not hidden sidewall detail. Purple lines are the modeled solid bulwarks.','Dated S10 photographs corroborate configuration qualitatively.','No local warp or anisotropic scaling.']},indent=2)+'\n')
print(OUT)
