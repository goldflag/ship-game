"""Build matched raster sheets and a portable, accessible local inspection page.

Reads only raster reference pack, reviewed spec, published measurements and our own
blueprint. The raw reference mesh cache is deliberately not a dependency.
"""
import base64, hashlib, html, json, math, shutil, sys, zipfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps
from index import index_pack
ROOT=Path(__file__).resolve().parents[2]
ship=sys.argv[1] if len(sys.argv)>1 else 'bismarck'
if not __import__('re').fullmatch('[a-z][a-z0-9-]{0,63}',ship):raise ValueError('Invalid ship ID')
source=ROOT/'assets/ships'/ship;out=source/'generated/comparison';refs=source/'references'
spec=json.loads((source/'modeling-spec.json').read_text());blueprint=json.loads((source/'blueprint.json').read_text());report=json.loads((source/'reports/measurements.json').read_text());reg=json.loads((refs/'gamemodels3d/manifest.json').read_text());auth=json.loads((out/'authored/manifest.json').read_text())
if report['contentHash']!=auth['contentHash']:raise ValueError('Mismatched measurement and rendered ship')
if reg['capturePlanSha256']!=auth['capturePlanSha256']:raise ValueError('Reference cameras changed; recapture the reference pack first')
views=json.loads((refs/'capture-plan.json').read_text())['views']
for name in ['sheets','overlays','historical','reference','sections']: (out/name).mkdir(parents=True,exist_ok=True)
shutil.copytree(ROOT/'assets/reference-ui',out/'fonts',dirs_exist_ok=True)
FONT='/System/Library/Fonts/Supplemental/Arial.ttf'
def font(size):
 try:return ImageFont.truetype(FONT,size)
 except OSError:return ImageFont.load_default(size=size)
def rgba(path):return Image.open(path).convert('RGBA')
def paper(im):
 bg=Image.new('RGBA',im.size,'#f2f0e9');bg.alpha_composite(im);return bg.convert('RGB')
def text(draw,xy,s,size=26,fill='#243845'):draw.text(xy,s,font=font(size),fill=fill)
def tag_image(im,label):
 canvas=Image.new('RGB',(im.width,im.height+70),'#f2f0e9');canvas.paste(paper(im),(0,70));text(ImageDraw.Draw(canvas),(24,18),label);return canvas

for c in reg['captures']:
 path=refs/'gamemodels3d'/c['image']
 if hashlib.sha256(path.read_bytes()).hexdigest()!=c['imageSha256']:raise ValueError('Reference image hash mismatch: '+c['id'])
 shutil.copyfile(path,out/'reference'/c['image'])
for c in auth['captures']:
 if hashlib.sha256((out/'authored'/c['image']).read_bytes()).hexdigest()!=c['imageSha256']:raise ValueError('Authored image hash mismatch')
shutil.copyfile(refs/'gamemodels3d/manifest.json',out/'reference/manifest.json')
# Historical images use a single whole-sheet scale. Alpha removes white paper only;
# no silhouette fitting, skew correction or component-specific registration occurs.
history=spec['historicalRegistration'];original=rgba(refs/history['image'])
original.save(out/'historical/original-plan.png')
for id in ['starboard','port','top']:
 v=next(x for x in views if x['id']==id);w,h=v['resolution'];r=history[id];crop=r['crop'];cropped=original.crop(crop);cropped.save(out/'historical'/(id+'-crop.png'))
 src=Image.new('RGBA',original.size);src.paste(cropped,(crop[0],crop[1]))
 # White source paper becomes transparent; all colored reference linework is retained.
 pixels=[]
 for red,green,blue,alpha in src.getdata():pixels.append((red,green,blue,0 if min(red,green,blue)>249 else alpha))
 src.putdata(pixels)
 ppm=w/v['spanM'];scale=ppm/history['pixelsPerMeter'];ox,oy=r['originPixel'];cx=w/2;cy=h/2 if id=='top' else h/2+v['target'][2]*ppm
 sx=-scale if r.get('mirrorX') else scale
 registered=src.transform((w,h),Image.Transform.AFFINE,(1/sx,0,ox-cx/sx,0,1/scale,oy-cy/scale),Image.Resampling.BICUBIC)
 registered.save(out/'historical'/(id+'.png'))

for v in views:
 id=v['id'];a=rgba(out/'authored'/(id+'.png'));r=rgba(out/'reference'/(id+'.png'))
 if a.size!=r.size:raise ValueError('Comparison render dimensions differ')
 labels=[(a,'Authored GLB · '+report['contentHash'][:12]),(r,"GameModels3D · "+reg['gameVersion']+' · comparison registration')]
 if (out/'historical'/(id+'.png')).exists():labels.append((rgba(out/'historical'/(id+'.png')),spec['review']['historicalLabel']))
 sheet=Image.new('RGB',(a.width*len(labels),a.height+140),'#f2f0e9');draw=ImageDraw.Draw(sheet)
 for i,(im,label) in enumerate(labels):sheet.paste(tag_image(im,label),(i*a.width,50))
 text(draw,(24,12),id.replace('-',' ').title()+' · '+v['projection']+f" · {v['spanM']} m span",24)
 text(draw,(24,a.height+121),'Reference images are not historical dimensional verification. No independent stretching or component fit.',16)
 sheet.save(out/'sheets'/(id+'.png'))
 overlay=Image.new('RGBA',a.size)
 for im,color in [(r,(180,95,45)),(a,(30,110,145))]:
  mask=im.getchannel('A').point(lambda n:int(n*.52));tint=Image.new('RGBA',im.size,(*color,0));tint.putalpha(mask);overlay.alpha_composite(tint)
 paper(overlay).save(out/'overlays'/(id+'.png'))
# Browsable contact sheet, preserving each camera's aspect ratio.
def contact(folder,dest):
 tw,th=500,300;canvas=Image.new('RGB',(tw*5,th*math.ceil(len(views)/5)),'#f2f0e9');d=ImageDraw.Draw(canvas)
 for i,v in enumerate(views):
  im=paper(rgba(folder/(v['id']+'.png')));im.thumbnail((tw-20,th-52));x=(i%5)*tw;y=(i//5)*th
  canvas.paste(im,(x+(tw-im.width)//2,y+42+(th-52-im.height)//2));text(d,(x+14,y+12),v['id'],20)
 canvas.save(dest)
index_pack(refs/'gamemodels3d');contact(out/'authored',out/'authored-contact-sheet.png')
shutil.copyfile(refs/'gamemodels3d/contact-sheet.png',out/'reference/contact-sheet.png')
# Independently authored hull and protection sections, in the same datum as the exterior.
def section_points(s):
 for a,b in zip(blueprint['hull']['sections'],blueprint['hull']['sections'][1:]):
  if a['station']<=s<=b['station']:
   t=(s-a['station'])/(b['station']-a['station']);return [[x+(bb[0]-x)*t,y+(bb[1]-y)*t] for (x,y),bb in zip(a['points'],b['points'])]
 raise ValueError('Section outside authored hull')
colors={'KC':'#9b5a27','Wh':'#307ca2','Ww':'#45876a','steel':'#666d70','teak':'#ba9560'}
section_ids=[]
for frame in spec['sectionFrames']:
 id='frame-'+str(frame).replace('.','-');section_ids.append(id);z=spec['coordinates']['frameOriginM']-frame;pts=section_points(blueprint['hull']['length']/2-z)
 scale=20;px=lambda x:450+x*scale;py=lambda y:400-y*scale
 elements=['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 720" role="img" aria-label="Authored hull, armor and room section">','<rect width="900" height="720" fill="#f2f0e9"/>',f'<text x="24" y="38" font-family="sans-serif" font-size="23" fill="#243845">Frame {frame} · reconstructed hull / protection / spaces</text>']
 outline=pts+[[-x,y] for x,y in reversed(pts)]
 points=' '.join(f'{px(x):.2f},{py(y):.2f}' for x,y in outline);elements.append(f'<polygon points="{points}" fill="#e3e2dc" stroke="#526772" stroke-width="2"/>')
 for c in blueprint['compartments']:
  for cell in c.get('cells',[c]):
   if abs(z-cell['center'][2])<=cell['size'][2]/2:
    x,y,_=cell['center'];sx,sy,_=cell['size'];color='#aa927e' if 'propellant' in c['id'] else '#9fbbad'
    elements.append(f'<rect x="{px(x-sx/2)}" y="{py(y+sy/2)}" width="{sx*scale}" height="{sy*scale}" fill="{color}" fill-opacity=".28" stroke="#74847c" stroke-width=".7"><title>{html.escape(c["name"])}</title></rect>')
 for a in blueprint['armor']:
  plate=a.get('plate');
  if not plate or plate.get('mountId'):continue
  verts=plate['vertices'];cuts=[]
  for p,q in zip(verts,verts[1:]+verts[:1]):
   if (p[2]-z)*(q[2]-z)<0:
    t=(z-p[2])/(q[2]-p[2]);cuts.append([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t])
  if len(cuts)>=2:
   p,q=cuts[:2];elements.append(f'<line x1="{px(p[0])}" y1="{py(p[1])}" x2="{px(q[0])}" y2="{py(q[1])}" stroke="{colors[plate["material"]]}" stroke-width="{max(.7,a["thicknessMm"]/1000*scale)}"><title>{html.escape(a["name"])} · {a["thicknessMm"]} mm</title></line>')
 elements += [f'<path d="M40 400H860" stroke="#3a6c8e" stroke-dasharray="8 5"/>','<text x="40" y="391" font-family="sans-serif" font-size="15">Y = 0 · standard waterline</text>',f'<text x="24" y="645" font-family="sans-serif" font-size="16">Keel Y = {spec['coordinates']['keelY']} m · 20 px/m · plate thickness drawn to scale (minimum 0.7 px)</text>',f'<text x="24" y="674" font-family="sans-serif" font-size="16">Brown KC · blue Wh · green Ww · gray structure · tan teak. Room envelopes are estimated.</text>','</svg>']
 (out/'sections'/(id+'.svg')).write_text('\n'.join(elements))
for record in spec['review']['images']:
 name=record['file']
 if Path(name).name!=name:raise ValueError('Historical image must be a filename')
 shutil.copyfile(refs/'historical'/name,out/'historical'/name)
for filename,path in [('measurements.json',source/'reports/measurements.json'),('modeling-spec.json',source/'modeling-spec.json'),('sources.json',refs/'sources.json'),('blueprint.json',source/'blueprint.json')]:shutil.copyfile(path,out/filename)
(out/'historical/registration.json').write_text(json.dumps(history,indent=2)+'\n')
# Native controls keep the inspection page portable and usable with keyboard or touch.
css='''*{box-sizing:border-box}body{margin:0;background:#0e202c;color:#e9e8df;font-family:Barlow,sans-serif;font-size:16px;line-height:1.55}main{max-width:1540px;margin:auto;padding:28px clamp(16px,4vw,56px)}h1,h2{font-family:'Barlow Condensed',sans-serif;font-weight:600}h1{font-size:clamp(28px,4vw,46px);line-height:1.1;margin:18px 0}h2{font-size:25px;line-height:1.25;margin:32px 0 16px}p{max-width:95ch;color:#b9c7cc}a{color:#e5bf80;text-underline-offset:4px}nav{display:flex;gap:12px 24px;flex-wrap:wrap}nav a{padding:10px 0}select,button{font:inherit;background:#172f3f;color:#e9e8df;border:1px solid #56717e;min-height:44px;padding:8px 12px;border-radius:2px}input[type=range]{width:200px;max-width:100%}:focus-visible{outline:3px solid #e5bf80;outline-offset:4px}.controls{display:flex;align-items:end;gap:16px;flex-wrap:wrap;padding:18px 0}.controls label{display:grid;gap:6px}figure{margin:0}figure>img{display:block;max-width:100%;height:auto;background:#f2f0e9}figcaption{padding:12px 0;color:#b9c7cc;font-size:14px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}.pair img{width:100%}.overlay{display:grid;background:#f2f0e9;max-height:580px}.overlay img{grid-area:1/1;width:100%;height:100%;max-height:580px;object-fit:contain}.overlay .ours{opacity:var(--alpha,.5)}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{padding:12px 14px;text-align:left;border-bottom:1px solid #334c58}th{color:#e5bf80;font-weight:500}.table-wrap{overflow:auto}details{border-top:1px solid #334c58;margin-top:18px}summary{cursor:pointer;min-height:48px;padding:12px 0;color:#e5bf80}summary:focus-visible{outline-offset:0}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:22px}.gallery img{width:100%;height:190px;object-fit:contain;background:#f2f0e9}.note{color:#e5bf80}.probes{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;color:#b9c7cc}.credit{font-size:14px;border-top:1px solid #334c58;margin-top:32px;padding-top:20px}@media(max-width:650px){.pair{grid-template-columns:1fr}main{padding-top:18px}table{font-size:14px}th,td{padding:10px 8px}.controls{align-items:stretch}.controls label{flex:1 1 180px}h1,h2{font-family:'Barlow Condensed',sans-serif;font-weight:600}h1{font-size:30px}}'''
options=''.join(f'<option value="{v["id"]}">{html.escape(v["id"].replace("-"," ").title())} · {v["projection"]}</option>' for v in views)
rows=''.join(f'<tr><th scope="row">{d["id"].replace("-"," ")}</th><td>{d["measured"]:.3f} m</td><td>{d["target"]:.3f} m</td><td>{d["deviation"]:+.3f} m</td><td>±{d["tolerance"]} m</td><td>{d["basis"]}<br>assessed uncertainty ±{d["evidenceUncertaintyM"]} m</td></tr>' for d in report['dimensions'])
landmark_rows=''.join(f'<tr><th scope="row">{d["id"].replace("-"," ")}</th><td>{", ".join(f"{n:.2f}" for n in d["measured"])}</td><td>{", ".join(f"{n:.2f}" for n in d["runtime"])}</td><td>{max(abs(n) for n in d["deviationM"]):.4f} m</td><td>{d["basis"]} · ±{d["toleranceM"]} m · {d["sourceId"]}</td></tr>' for d in report['landmarks'])
sources=json.loads((refs/'sources.json').read_text())['sources']
sourcehtml=''.join(f'<li><a href="{html.escape(s["url"],quote=True)}">{html.escape(s["id"])}</a> — {html.escape(s["document"])}<p>{html.escape(s["status"])}. {html.escape(s["limits"])}</p></li>' for s in sources)
gallery=''.join(f'<figure><a href="sheets/{v["id"]}.png" download><img loading="lazy" src="sheets/{v["id"]}.png" alt="Matched {v["id"]} comparison"></a><figcaption>{v["id"]} · <a href="sheets/{v["id"]}.png" download>PNG sheet</a> · <a href="overlays/{v["id"]}.png" download>overlay</a></figcaption></figure>' for v in views)
probes='\n\n'.join(p['id']+': '+ ' → '.join(f"{h['name']} ({h['thicknessMm']} mm {h['material']})" for h in p['layers']) for p in report['probes'])
def historical_figure(name):
 record=next(r for r in spec['review']['images'] if r['file']==name)
 caption=html.escape(record['caption']);url=record.get('url')
 if url:caption+=f' · <a href="{html.escape(url,quote=True)}">Source discussion</a>'
 return f'<figure><img loading="lazy" src="historical/{name}" alt="{html.escape(record["alt"],quote=True)}"><figcaption>{caption}</figcaption></figure>'
body=f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(spec['review']['title'])} reference review</title><link rel="stylesheet" href="fonts/fonts.css"><style>{css}</style><main>
<nav aria-label="Review navigation"><a href="../../../?ship={ship}">Open ship in game</a><a href="#dimensions">Dimensions</a><a href="#sections">Protection and spaces</a><a href="#evidence">Sources and limits</a><a href="{ship}-review.zip" download>Download review pack</a><a href="{ship}.glb" download>Download GLB</a></nav>
<h1>{html.escape(spec['review']['title'])}</h1><p>{html.escape(spec['review']['intro'])}</p>
<p class="note">Engineering targets passed · hull sections and internal envelopes remain reconstructed. Build {report['contentHash'][:12]} · {reg['gameVersion']} reference · no historical accuracy certification.</p>
<div class="controls"><label for="view">Comparison view<select id="view">{options}</select></label><label for="reference">Reference layer<select id="reference"><option value="reference">GameModels3D clay render</option><option value="historical">Historical drawing</option></select></label><label for="opacity">Authored overlay <output id="opacity-value">50%</output><input id="opacity" type="range" min="0" max="100" value="50"></label></div>
<figure><div class="overlay"><img id="reference-image" src="reference/starboard.png" alt="GameModels3D reference in the selected fixed view"><img class="ours" id="authored-image" src="authored/starboard.png" alt="Actual exported authored ship overlaid at the same camera scale"></div><figcaption id="view-note">Same orthographic camera. Reference: {html.escape(reg['registration']['method'])} Blue/brown exported overlays are available below.</figcaption></figure>
<div class="pair"><figure><img id="own-side" src="authored/starboard.png" alt="Authored ship alone"><figcaption>Actual authored GLB</figcaption></figure><figure><img id="ref-side" src="reference/starboard.png" alt="Selected comparison reference alone"><figcaption id="reference-caption">GameModels3D · comparison evidence</figcaption></figure></div>
<p><a id="sheet-link" href="sheets/starboard.png" download>Download full resolution comparison sheet</a> · <a href="reference/contact-sheet.png" download>Reference contact sheet</a> · <a href="reference/manifest.json" download>Capture manifest</a></p>
<h2 id="dimensions">Dimensions and datums</h2><div class="table-wrap"><table><thead><tr><th>Measurement</th><th>Exported</th><th>Target</th><th>Deviation</th><th>Build tolerance</th><th>Evidence</th></tr></thead><tbody>{rows}</tbody></table></div>
<p>Measurements intersect actual exported hull triangles. The hull is watertight after welding: {report['geometry']['triangles']} triangles, {report['geometry']['degenerate']} degenerate triangles. All {len(report['spaces'])} authored room envelopes fit within the reconstructed hull. These checks cannot certify missing historical offsets.</p>
<p><a href="measurements.json" download>Measurements and probes</a> · <a href="modeling-spec.json" download>Reviewed modeling specification</a> · <a href="blueprint.json" download>Editable blueprint</a> · <a href="historical/registration.json" download>Historical raster registration</a></p>
<h2>Landmark deviations</h2><p>Runtime coordinates are X starboard, Y up, Z aft, in metres. Deviations check the exported landmarks against the reviewed specification; they do not measure agreement with GameModels3D. Evidence uncertainties are our assessment, not source-published error bars.</p><div class="table-wrap"><table><thead><tr><th>Landmark</th><th>Exported X, Y, Z</th><th>Reviewed X, Y, Z</th><th>Largest axis deviation</th><th>Evidence and tolerance</th></tr></thead><tbody>{landmark_rows}</tbody></table></div>
<h2 id="sections">Protection and internal spaces</h2><div class="controls"><label for="section">Structural frame<select id="section">{''.join(f'<option value="{id}">{id.replace("frame-", "").replace("-", ".")}</option>' for id in section_ids)}</select></label></div>
<div class="pair"><figure><img id="section-image" src="sections/{section_ids[0]}.svg" alt="Authored hull, armor layers and compartments at selected frame"><figcaption>Authored section · physical layer separation and thickness</figcaption></figure>{historical_figure(spec['review']['sectionReference'])}</div>
<p>CPU probes cross separate physical plates once. Teak backing is visible but contributes no invented steel-equivalent resistance. Slopes change incidence; gunhouse plates train with their mount. AP performance and flood capacities remain game approximations.</p><pre class="probes">{html.escape(probes)}</pre>
<details><summary>All fixed views and component sheets</summary><div class="gallery">{gallery}</div></details>
<h2 id="evidence">Evidence and unresolved differences</h2><p>{html.escape(spec['review']['limits'])}</p>
<div class="pair">{''.join(historical_figure(name) for name in spec['review']['evidenceImages'])}</div>
<p><a href="historical/original-plan.png" download>Original dated plan image, with credit</a> · <a href="sources.json" download>Full source register</a></p><details><summary>Source records and access limitations</summary><ul>{sourcehtml}</ul></details>
<p class="credit">Historical drawing © {html.escape(spec['review']['historicalCredit'])}. Other archival and photograph credits remain in the source register. GameModels3D / Wargaming reference renders retained for comparison. All production geometry and materials independently authored. Reference art is not a game texture.</p>
</main><script>const available=new Set(['starboard','port','top']);const view=document.getElementById('view'),reference=document.getElementById('reference');function update(){{const id=view.value;reference.options[1].disabled=!available.has(id);if(!available.has(id))reference.value='reference';const own='authored/'+id+'.png',ref=reference.value+'/'+id+'.png';document.getElementById('authored-image').src=own;document.getElementById('own-side').src=own;document.getElementById('reference-image').src=ref;document.getElementById('ref-side').src=ref;document.getElementById('sheet-link').href='sheets/'+id+'.png';document.getElementById('reference-caption').textContent=reference.value==='historical'?'Historical reconstruction · source register and original credit':'GameModels3D · comparison evidence';document.getElementById('view-note').textContent=reference.value==='historical'?'Historical image: one uniform scale from complete hull endpoints, vertically registered at the keel. Original image and crops preserved. No component fitting.':id==='perspective'?'Perspective view · qualitative comparison only; not a dimensional projection.':'Matched orthographic cameras. Game reference uses one global {reg['registration']['uniformScale']} m/viewer-unit registration; source waterline/load remains unverified.';}}view.addEventListener('change',update);reference.addEventListener('change',update);document.getElementById('opacity').addEventListener('input',e=>{{document.querySelector('.overlay').style.setProperty('--alpha',e.target.value/100);document.getElementById('opacity-value').value=e.target.value+'%';}});document.getElementById('section').addEventListener('change',e=>document.getElementById('section-image').src='sections/'+e.target.value+'.svg');</script></html>'''
(out/'index.html').write_text(body)
shutil.copyfile(refs/'gamemodels3d/index.html',out/'reference/index.html')
shutil.copyfile(ROOT/'public/models'/(ship+'.glb'),out/(ship+'.glb'))
# Standalone review with original inputs and all page dependencies. The generated
# Blender scene and unlinked authored overview remain in assets, avoiding another
# copy of rebuildable/convenience outputs in the portable archive.
archive=out/(ship+'-review.zip')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in sorted(out.rglob('*')):
  if p.is_file() and p!=archive and p.name not in ['build.json','authored-contact-sheet.png']:z.write(p,p.relative_to(out))
 for path,name in [(source/'build.py','authoring/build.py'),(ROOT/'assets/parts/guns.json','authoring/guns.json')]:z.write(path,name)
 z.writestr('authoring/README.txt','The editable blueprint is ../blueprint.json. Original build.py and guns.json are retained here. Rebuild with the repository shared ship pipeline; the generated Blender scene remains at assets/ships/'+ship+'/generated/source.blend. All interactive review views and their downloads are included.\n')
print('COMPARISON PACK',len(views),'views;',archive.stat().st_size,'bytes',flush=True)
