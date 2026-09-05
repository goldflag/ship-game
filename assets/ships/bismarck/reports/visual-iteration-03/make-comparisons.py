"""Compose unchanged raster captures at one common scale for each view."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

here=Path(__file__).resolve().parent;ship=here.parents[1]
font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',26)
small=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',17)
manifest={'contentHash':json.loads((ship.parents[2]/'public/models/bismarck.json').read_text())['contentHash'],'beforeHash':'dc419a66c00f247f07a02634e136d6688aea9866303ec69f218f706437169606','views':[]}
for view,crop in [('bow-flare',(500,120,1590,1020)),('anton',(300,370,1600,785)),('bruno',(270,350,1550,900))]:
 paths=[here/f'before-{view}.png',ship/f'generated/comparison/authored/{view}.png',ship/f'generated/comparison/reference/{view}.png']
 panels=[Image.open(p).convert('RGB').crop(crop) for p in paths]
 width=900;height=round(panels[0].height*width/panels[0].width)
 sheet=Image.new('RGB',(width*3,height+110),'#102028');draw=ImageDraw.Draw(sheet)
 for i,(panel,label) in enumerate(zip(panels,['Previous model','Corrected model','Game reference · global scale'])):
  draw.text((i*width+18,15),label,font=font,fill='#e5e9e6');sheet.paste(panel.resize((width,height)),(i*width,58))
 draw.text((18,height+77),'Same camera and crop across panels. The game reference is comparison evidence; its units/load are unverified.',font=small,fill='#b2c2c9')
 output=f'{view}-before-after-reference.png';sheet.save(here/output)
 manifest['views'].append({'id':view,'crop':crop,'output':output,'method':'Identical crop and uniform resize; no retouching or per-component fitting.'})
(here/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
