"""Same-scale source/model inspection sheets, not a historical certification.

Run after ship:build, ship:review and render-alpha-profiles-v2.py. Requires Pillow. Uses the fixed profile
camera's recorded scale/height, never stretches a model to fit a drawing.
The original scan, source-render profile and cyan silhouette overlay are shown
separately so folds and reconstruction differences remain inspectable.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

folder=Path(__file__).resolve().parent
root=folder.parents[2]
plans=json.loads((folder/'plans-v2.json').read_text())
out=folder/'reports/plan-comparisons'
out.mkdir(parents=True,exist_ok=True)
records=[]
for ship in ['flower-corvette','liberty-cargo','victory-cargo']:
    plan=plans[ship]; reg=plan['registration']
    review=folder.parent/ship/'generated/review'
    definition=json.loads((root/'public/models'/f'{ship}.json').read_text())
    camera=json.loads((review/'cameras.json').read_text())
    if camera['contentHash']!=definition['contentHash']:
        raise RuntimeError(f'{ship}: stale fixed views; run ship:review')
    name,position,target,scale,w,h=next(v for v in camera['views'] if v[0]=='profile')
    source=Image.open(folder/'references/plans'/reg['raster']).convert('RGB')
    render=Image.open(review/'profile-alpha.png').convert('RGBA')
    px_per_m=(reg['bowX']-reg['sternX'])/plan['length']
    factor=px_per_m/(w/scale)
    # One uniform scale and translation, aligned to LOA center and waterline.
    resized=render.resize((round(w*factor),round(h*factor)),Image.Resampling.LANCZOS)
    left=round((reg['sternX']+reg['bowX'])/2-resized.width/2)
    top=round(reg['waterlineY']-(h/2+position[2]*w/scale)*factor)
    mask=resized.getchannel('A')
    aligned=Image.new('RGB',source.size,'white');aligned.paste(resized,(left,top),mask)
    fullmask=Image.new('L',source.size);fullmask.paste(mask,(left,top))
    edges=fullmask.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.MaxFilter(3))
    overlay=source.copy();overlay.paste(Image.new('RGB',source.size,(0,143,178)),(0,0),edges)
    upper={'flower-corvette':30,'liberty-cargo':35,'victory-cargo':120}[ship]
    lower=round(reg['baselineY']+23)
    crop=(0,upper,source.width,lower);height=lower-upper
    sheet=Image.new('RGB',(source.width,(height+48)*3+60),'white')
    draw=ImageDraw.Draw(sheet)
    draw.text((24,16),f"{plan['name']} | {definition['contentHash'][:16]} | {px_per_m:.4f} px/m | uniform scale; no silhouette fitting",fill='black')
    for i,(label,im) in enumerate([('ORIGINAL PLAN — scan defects retained',source),('AUTHORED MODEL — fixed orthographic profile',aligned),('OVERLAY — cyan model silhouette; original plan beneath',overlay)]):
        y=60+i*(height+48)
        draw.text((24,y+12),label,fill='black')
        sheet.paste(im.crop(crop),(0,y+40))
    sheet.save(out/f'{ship}-profile.png')
    records.append({'id':ship,'contentHash':definition['contentHash'],'source':reg['source'],'raster':reg['raster'],'pixelsPerMeter':px_per_m,'renderScaleM':scale,'uniformResizeFactor':factor,'translationPixels':[left,top],'limitations':'Side elevation only; does not certify transverse sections, armament, paint, loading or internals. Scan skew is not rectified.'})
(out/'registration.json').write_text(json.dumps(records,indent=2)+'\n')
print(f'Saved {len(records)} same-scale comparison sheets to {out}')
