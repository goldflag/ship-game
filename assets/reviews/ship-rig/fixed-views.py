"""Lay out unchanged fixed review images; each panel retains its aspect ratio."""
import json,re
from pathlib import Path
from PIL import Image,ImageDraw
root=Path(__file__).resolve().parents[3]
roster=(root/'src/ships/presets.ts').read_text().split('export const shipPresets = {')[1].split('};')[0]
for line in roster.splitlines():
    sid=line.strip().split(':')[0].rstrip(',').strip("'")
    if not sid:continue
    folder=root/'assets/ships'/sid/'generated/review'
    definition=json.loads((root/'public/models'/f'{sid}.json').read_text())
    if not (folder/'cameras.json').exists():continue
    if json.loads((folder/'cameras.json').read_text())['contentHash']!=definition['contentHash']:continue
    canvas=Image.new('RGB',(1800,330),'#253640');draw=ImageDraw.Draw(canvas)
    draw.text((14,10),sid+' | '+definition['contentHash'][:12],fill='white')
    for i,name in enumerate(['profile','plan','bow','stern','quarter']):
        im=Image.open(folder/(name+'.png')).convert('RGB');im.thumbnail((352,278))
        canvas.paste(im,(i*360+(360-im.width)//2,40+(278-im.height)//2))
        draw.text((i*360+12,27),name,fill='#d6e0e2')
    canvas.save(Path(__file__).parent/(sid+'-fixed-views.jpg'),quality=90)
