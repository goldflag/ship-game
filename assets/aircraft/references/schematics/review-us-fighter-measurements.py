from PIL import Image,ImageDraw
import json
from pathlib import Path
for id in ['f4f-4-wildcat','f6f-5-hellcat','f4u-1d-corsair']:
 s=json.loads(Path('assets/aircraft/shapes/'+id+'.json').read_text());r=s['reference'];raw=r['registration']['rawLandmarksPx'];im=Image.open(r['imagePath']).convert('RGB');draw=ImageDraw.Draw(im)
 def line(points,color='red'):
  draw.line(points,fill=color,width=2)
  for x,y in points:draw.ellipse((x-2,y-2,x+2,y+2),fill=color)
 line([(x,top) for x,w,bot,top in raw['fuselage']],'#ec8511');line([(x,bot) for x,w,bot,top in raw['fuselage']],'#ec8511')
 line([(x,top) for x,w,base,top in raw['canopy']],'#1971fa');line([tuple(x) for x in raw['fin']]+[tuple(raw['fin'][0])],'#af00bb')
 for key in ['wing','horizontalTail']:
  for sign in [-1,1]:
   def pt(d,x):return (313+sign*d,492-x) if id.startswith('f4u') else (x,r['registration']['plan']['centerYPx']+sign*d)
   line([pt(d,le) for d,le,te,z in raw[key]]+[pt(d,te) for d,le,te,z in reversed(raw[key])])
 p=Path('assets/aircraft/references/schematics')/id/'registration-overlay.png';im.save(p);print(p)
