"""Arrange the actual fixed Blender renders into labeled review sheets (Pillow)."""
import hashlib
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parent
CAT=json.loads((ROOT/'catalog.json').read_text())
font=ImageFont.load_default(size=19)
small=ImageFont.load_default(size=13)
hasher=hashlib.sha256((ROOT/'catalog.json').read_bytes()+b'\0'+(ROOT/'build.py').read_bytes())
hasher.update(b'\0detail_bombers.py\0'+(ROOT/'detail_bombers.py').read_bytes())
for a in sorted(CAT['aircraft'],key=lambda a:a['id']):
    hasher.update(b'\0'+a['id'].encode()+b'\0'+(ROOT/'shapes'/f"{a['id']}.json").read_bytes())
record={'schemaVersion':1,'contentHash':hasher.hexdigest(),'sheets':{}}
for a in CAT['aircraft']:
    manifest=json.loads((ROOT/a['id']/'generated/review/manifest.json').read_text())
    if manifest['contentHash']!=record['contentHash']:raise SystemExit(f"Stale review source: {a['id']}")
for view in ['quarter','top','side','front','rear','articulated']:
    sheet=Image.new('RGB',(1600,math.ceil(len(CAT['aircraft'])/4)*330),(27,38,48));draw=ImageDraw.Draw(sheet)
    for i,a in enumerate(CAT['aircraft']):
        pic=Image.open(ROOT/a['id']/'generated/review'/f'{view}.png').convert('RGB');pic.thumbnail((400,275))
        x=i%4*400;y=i//4*330
        sheet.paste(pic,(x+(400-pic.width)//2,y))
        draw.text((x+13,y+272),a['name'],font=font,fill=(235,231,211))
        draw.text((x+13,y+299),f"{a['year']}  /  {a['role']}  /  {a['wingspan']:.2f} m span",font=small,fill=(149,177,184))
    path=ROOT/'reports'/f'{view}-sheet.jpg'
    sheet.save(path,quality=91)
    record['sheets'][view]={'path':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
(ROOT/'reports/sheets.json').write_text(json.dumps(record,indent=2)+'\n')
