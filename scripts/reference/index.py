"""Index an existing raster pack without any production model or raw mesh input."""
import hashlib, html, json, math, re, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

def index_pack(folder):
    manifest=json.loads((folder/'manifest.json').read_text())
    views=manifest['captures'];width,height=500,300
    sheet=Image.new('RGB',(width*5,height*math.ceil(len(views)/5)),'#f2f0e9')
    draw=ImageDraw.Draw(sheet)
    try:font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',20)
    except OSError:font=ImageFont.load_default(size=20)
    figures=[]
    for i,v in enumerate(views):
        if not re.fullmatch('[a-z0-9-]+\\.png',v['image']):raise ValueError('Invalid capture filename')
        path=folder/v['image']
        if hashlib.sha256(path.read_bytes()).hexdigest()!=v['imageSha256']:raise ValueError('Stale capture: '+v['id'])
        im=Image.open(path).convert('RGBA');paper=Image.new('RGBA',im.size,'#f2f0e9');paper.alpha_composite(im);paper.thumbnail((width-20,height-52))
        x=i%5*width;y=i//5*height
        sheet.paste(paper,(x+(width-paper.width)//2,y+42+(height-52-paper.height)//2))
        draw.text((x+14,y+12),v['id'],font=font,fill='#243845')
        label=html.escape(v['id'].replace('-',' '))
        figures.append(f'<figure><a href="{v["image"]}"><img loading="lazy" src="{v["image"]}" alt="{label}"></a><figcaption>{label} · {v["projection"]} · {v["spanM"]} m registered span</figcaption></figure>')
    sheet.save(folder/'contact-sheet.png')
    title=html.escape(manifest.get('name','Ship')+' raster reference pack')
    (folder/'index.html').write_text(f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title><style>body{{margin:0;padding:24px;background:#0e202c;color:#e9e8df;font:16px/1.55 Arial,sans-serif}}main{{max-width:1500px;margin:auto}}a{{color:#e5bf80}}a:focus-visible{{outline:3px solid #e5bf80;outline-offset:4px}}.gallery{{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px}}figure{{margin:0}}img{{width:100%;height:190px;object-fit:contain;background:#f2f0e9}}figcaption{{padding:10px 0}}</style><main><h1>{title}</h1><p>GameModels3D {html.escape(manifest['gameVersion'])} · texture-free comparison renders. Dimensions and load datum are not historical verification.</p><p><a href="manifest.json">Source, scale, camera and visibility manifest</a> · <a href="contact-sheet.png">Full contact sheet</a></p><div class="gallery">{''.join(figures)}</div></main></html>''')

if __name__=='__main__':
    ship=sys.argv[1]
    if not re.fullmatch('[a-z][a-z0-9-]{0,63}',ship):raise ValueError('Invalid ship ID')
    index_pack(Path(__file__).resolve().parents[2]/'assets/ships'/ship/'references/gamemodels3d')
