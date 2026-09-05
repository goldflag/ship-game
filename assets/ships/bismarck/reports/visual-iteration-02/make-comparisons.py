"""Present the two independently authored iterations in unchanged review cameras.

This only crops the authored panel out of a preserved comparison sheet. It does
not resize, register, stretch, retouch or reconstruct either model image.
"""
import hashlib,json
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont

ship=Path(__file__).resolve().parents[2];out=Path(__file__).resolve().parent
old=ship/'reports/visual-iteration-01';current=ship/'generated/comparison/authored'
definition=json.loads((ship.parents[2]/'public/models/bismarck.json').read_text())
export=json.loads((ship/'reports/export.json').read_text())
try:font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',28)
except OSError:font=ImageFont.load_default(size=28)
records=[]
for name in ['bridge','funnel','quarter-bow','anton','stern-curvature']:
 original=Image.open(old/(name+'.png')).convert('RGB');new=Image.open(current/(name+'.png')).convert('RGBA')
 # compare.py places the untouched source at x=0,y=120 within the first column.
 assert original.width>=2*new.width and original.height==new.height+140
 before=original.crop((0,120,new.width,120+new.height))
 paper=Image.new('RGBA',new.size,'#f2f0e9');paper.alpha_composite(new)
 sheet=Image.new('RGB',(2*new.width,new.height+90),'#f2f0e9');sheet.paste(before,(0,90));sheet.paste(paper.convert('RGB'),(new.width,90))
 d=ImageDraw.Draw(sheet)
 d.text((22,18),f'{name.replace("-"," ").title()} · before · 59,194 triangles',font=font,fill='#243845')
 d.text((new.width+22,18),f'After · {export["triangles"]:,} triangles · {definition["contentHash"][:12]}',font=font,fill='#243845')
 path=out/(name+'-before-after.png');sheet.save(path)
 sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
 records.append({'view':name,'preservedBeforeSheetSha256':sha(old/(name+'.png')),'currentAuthoredImageSha256':sha(current/(name+'.png')),'outputSha256':sha(path),'beforeCrop':[0,120,new.width,new.height],'resizing':'none'})
(out/'manifest.json').write_text(json.dumps({'beforeContentHash':'6884ac0c339ca9e88662880a7886c66fa5bcc64c47d7f8b8bdf70c8a9b1c0039','afterContentHash':definition['contentHash'],'beforeTriangles':59194,'afterTriangles':export['triangles'],'note':'Geometry/detail growth is not a historical-fidelity percentage. Both panels retain the same fixed orthographic camera and span.','views':records},indent=2)+'\n')
print('Wrote',len(records),'unchanged-scale before/after sheets')
