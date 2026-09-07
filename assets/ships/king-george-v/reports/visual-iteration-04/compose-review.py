"""Show before/reference/current at identical scale, with declared translations.

Local profile panels register the front-floor corner only, so load-datum
differences do not obscure body proportions. Nothing is stretched or warped.
Raw camera-matched images and their manifests remain available separately.
"""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont

here = Path(__file__).resolve().parent
ship = here.parents[1]
font_path = '/System/Library/Fonts/Supplemental/Arial.ttf'
font = ImageFont.truetype(font_path, 25)
small = ImageFont.truetype(font_path, 18)
roots = [here/'before/matched', ship/'references/gamemodels3d', ship/'generated/comparison/authored']
labels = ['Before', 'GameModels3D reference', 'Revised original']
hashes = [json.loads((root/'manifest.json').read_text()).get('contentHash', 'raster comparison only') for root in roots]
scale = .86
width, height = 860, 375
out = Image.new('RGB', (width*3, height*2+140), '#eff0ed')
draw = ImageDraw.Draw(out)
draw.text((20, 14), 'KGV main turrets — measured local proportions', fill='#23353a', font=font)
for col, (label, content_hash) in enumerate(zip(labels, hashes)):
    draw.text((col*width+20, 54), label+' · '+content_hash[:12], fill='#23353a', font=small)
records = []
for row, (view, title, anchors) in enumerate([
    ('main-a', 'Quadruple A · front-floor corner aligned', [(1167,617),(1164,674),(1167,617)]),
    ('main-b', 'Twin B · front-floor corner aligned', [(1134,645),(1190,742),(1194,645)]),
]):
    for col, (root, anchor) in enumerate(zip(roots, anchors)):
        im = Image.open(root/(view+'.png')).convert('RGBA')
        # Every panel uses the same crop extent relative to its one picked anchor.
        box = (anchor[0]-875, anchor[1]-320, anchor[0]+125, anchor[1]+80)
        im = im.crop(box).resize((860,344), Image.Resampling.LANCZOS)
        panel = Image.new('RGB', im.size, '#d8ddd9')
        panel.paste(im, mask=im.getchannel('A'))
        px, py = col*width, 110+row*height
        out.paste(panel, (px,py))
        draw.text((px+18,py+9), title, fill='#172a32', font=small)
        floor_y = py+round(320*scale)
        draw.line([(px+8,floor_y),(px+width-8,floor_y)], fill='#d49643', width=2)
        draw.text((px+18,py+350), 'Uniform scale; translation only. No component rescaling.', fill='#41565e', font=small)
        records.append(dict(view=view,source=str(root.relative_to(ship)),anchor=anchor,crop=list(box),uniformScale=scale))
out.save(here/'local-proportions.png')

# Plan comparison uses exactly the same pixel crop for all three images.
out = Image.new('RGB',(2580,825),'#eff0ed');draw=ImageDraw.Draw(out)
draw.text((20,14),'Quadruple A — unchanged top camera, same crop and scale',fill='#23353a',font=font)
for col,(root,label) in enumerate(zip(roots,labels)):
    im=Image.open(root/'main-a-top.png').convert('RGBA').crop((280,350,1280,1170))
    im=im.resize((860,705),Image.Resampling.LANCZOS)
    panel=Image.new('RGB',im.size,'#d8ddd9');panel.paste(im,mask=im.getchannel('A'))
    out.paste(panel,(col*860,90));draw.text((col*860+20,55),label,fill='#23353a',font=small)
out.save(here/'plan-proportions.png')
(here/'presentation-registration.json').write_text(json.dumps(dict(profilePanels=records,planCrop=[280,350,1280,1170],planScale=.86,contentHash=hashes[-1]),indent=2)+'\n')
out=Image.new('RGB',(1800,1460),'#eaece9');draw=ImageDraw.Draw(out)
draw.text((15,15),'KGV revision 4 · '+hashes[-1][:16],fill='#2f434b',font=font)
for view,rect in [('profile',(0,55,1800,530)),('plan',(0,530,1800,1005)),('bow',(0,1005,600,1450)),('stern',(600,1005,1200,1450)),('quarter',(1200,1005,1800,1450))]:
    im=Image.open(ship/'generated/review'/(view+'.png')).convert('RGB')
    im.thumbnail((rect[2]-rect[0],rect[3]-rect[1]-28))
    out.paste(im,(rect[0]+(rect[2]-rect[0]-im.width)//2,rect[1]+28))
    draw.text((rect[0]+12,rect[1]),view,fill='#2f434b',font=small)
out.save(here/'fixed-review-contact.png')
print('Saved profile and plan comparisons for',hashes[-1])
