"""Portable historical/before-after review without a game-reference dependency.

Only explicitly redistributable evidence enters public output. Restricted scans
remain under assets with source links, never silently copied into a download.
"""
import hashlib, html, json, math, re, shutil, sys, zipfile
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[2]
ship=sys.argv[1]
if not re.fullmatch('[a-z][a-z0-9-]{0,63}',ship):raise ValueError('Invalid ship ID')
source=ROOT/'assets/ships'/ship;out=source/'generated/comparison';refs=source/'references'
spec=json.loads((source/'modeling-spec.json').read_text());b=json.loads((source/'blueprint.json').read_text())
report=json.loads((source/'reports/measurements.json').read_text());export=json.loads((source/'reports/export.json').read_text())
auth=json.loads((out/'authored/manifest.json').read_text());baseline=source/'reports/fidelity-01/before'
before=json.loads((baseline/'authored/manifest.json').read_text());views=json.loads((refs/'capture-plan.json').read_text())['views']
if not report['passed'] or report['contentHash']!=auth['contentHash']:raise ValueError('Unverified/stale authored geometry')
if before['capturePlanSha256']!=auth['capturePlanSha256']:raise ValueError('Before/after cameras differ; never silently reframe a baseline')
for name in ['before','sheets','overlays','historical','sections','fonts','inputs','runtime']:
    folder=out/name
    if folder.exists():shutil.rmtree(folder)
    folder.mkdir(parents=True)
shutil.copytree(ROOT/'assets/reference-ui',out/'fonts',dirs_exist_ok=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
for manifest,folder in [(auth,out/'authored'),(before,baseline/'authored')]:
    for c in manifest['captures']:
        if not re.fullmatch('[a-z0-9-]+.png',c['image']) or sha(folder/c['image'])!=c['imageSha256']:raise ValueError('Capture changed: '+c['id'])
shutil.copytree(baseline/'authored',out/'before',dirs_exist_ok=True)
def rgba(path):return Image.open(path).convert('RGBA')
def paper(im):
    bg=Image.new('RGBA',im.size,'#f2f0e9');bg.alpha_composite(im);return bg.convert('RGB')
try:font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',25)
except OSError:font=ImageFont.load_default(size=25)

# Whole-sheet affine registration: one scale, no component fit or stretching.
history={};credits=[]
for r in spec['historicalRegistrations']:
    if not r['redistribute']:continue
    v=next(v for v in views if v['id']==r['view']);im=rgba(refs/r['image'])
    if Path(r['image']).name!=r['image']:raise ValueError('Reference must be a filename')
    shutil.copyfile(refs/r['image'],out/'historical'/r['image'])
    layer=Image.new('RGBA',im.size);layer.paste(im.crop(r['crop']),r['crop'][:2])
    layer.putdata([(rr,g,bb,0 if min(rr,g,bb)>249 else a) for rr,g,bb,a in layer.getdata()])
    w,h=v['resolution'];ppm=w/v['spanM'];scale=ppm/r['pixelsPerMeter'];ox,oy=r['originPixel']
    cx=w/2;cy=h/2 if v['id']=='top' else h/2+v['target'][2]*ppm
    registered=layer.transform((w,h),Image.Transform.AFFINE,(1/scale,0,ox-cx/scale,0,1/scale,oy-cy/scale),Image.Resampling.BICUBIC)
    registered.save(out/'historical'/(v['id']+'.png'));history[v['id']]=r
    credits.append(r['credit']+' '+r['note'])

for v in views:
    id=v['id'];a=rgba(out/'authored'/(id+'.png'));old=rgba(out/'before'/(id+'.png'))
    if a.size!=old.size:raise ValueError('Different before/after raster sizes')
    layers=[(old,'Before · '+before['contentHash'][:12]),(a,'After · '+auth['contentHash'][:12])]
    if id in history:layers.append((rgba(out/'historical'/(id+'.png')),'Historical · '+history[id]['sourceId']))
    sheet=Image.new('RGB',(a.width*len(layers),a.height+80),'#f2f0e9');draw=ImageDraw.Draw(sheet)
    for i,(im,label) in enumerate(layers):
        sheet.paste(paper(im),(i*a.width,70));draw.text((i*a.width+20,18),label,font=font,fill='#243845')
    sheet.save(out/'sheets'/(id+'.png'))
    overlay=Image.new('RGBA',a.size)
    for im,color in [(old,(180,95,45)),(a,(30,110,145))]:
        tint=Image.new('RGBA',a.size,(*color,0));tint.putalpha(im.getchannel('A').point(lambda n:int(n*.52)));overlay.alpha_composite(tint)
    paper(overlay).save(out/'overlays'/(id+'.png'))

# Section stations are metres from the overall stern, not invented frame numbers.
section_ids=[]
for station in spec['sectionStations']:
    id='station-'+str(round(station,3)).replace('.','-');section_ids.append(id);z=b['hull']['length']/2-station
    a,c=next((a,c) for a,c in zip(b['hull']['sections'],b['hull']['sections'][1:]) if a['station']<=station<=c['station'])
    t=(station-a['station'])/(c['station']-a['station']);pts=[[x+(cc[0]-x)*t,y+(cc[1]-y)*t] for (x,y),cc in zip(a['points'],c['points'])]
    scale=min(20,760/b['hull']['beam']);px=lambda x:450+x*scale;py=lambda y:380-y*scale
    elements=['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 650" role="img" aria-label="Original hull protection and provisional rooms">','<rect width="900" height="650" fill="#f2f0e9"/>',f'<text x="24" y="35" font-family="sans-serif" font-size="22">Station {station:.3f} m from stern · runtime Z {z:.3f} m</text>']
    points=' '.join(f'{px(x):.2f},{py(y):.2f}' for x,y in pts+[[-x,y] for x,y in reversed(pts)])
    elements.append(f'<polygon points="{points}" fill="#e3e2dc" stroke="#526772" stroke-width="2"/>')
    for c in b['compartments']:
        if abs(z-c['center'][2])<=c['size'][2]/2:
            x,y,_=c['center'];sx,sy,_=c['size'];elements.append(f'<rect x="{px(x-sx/2)}" y="{py(y+sy/2)}" width="{sx*scale}" height="{sy*scale}" fill="#9fbbad" fill-opacity=".28" stroke="#74847c"><title>{html.escape(c["name"])}</title></rect>')
    for a in b['armor']:
        p=a.get('plate')
        if not p or p.get('mountId'):continue
        cuts=[]
        for v,w in zip(p['vertices'],p['vertices'][1:]+p['vertices'][:1]):
            if (v[2]-z)*(w[2]-z)<0:
                t=(z-v[2])/(w[2]-v[2]);cuts.append([v[0]+(w[0]-v[0])*t,v[1]+(w[1]-v[1])*t])
        if len(cuts)>=2:
            v,w=cuts[:2];elements.append(f'<line x1="{px(v[0])}" y1="{py(v[1])}" x2="{px(w[0])}" y2="{py(w[1])}" stroke="#a26731" stroke-width="{max(.8,a["thicknessMm"]*scale/1000)}"><title>{html.escape(a["name"])} · {a["thicknessMm"]} mm (provisional)</title></line>')
    elements+=['<path d="M40 380H860" stroke="#3a6c8e" stroke-dasharray="8 5"/>','<text x="24" y="598" font-family="sans-serif" font-size="16">Y = 0 is the declared load datum. Steel thickness to scale, minimum 0.8 px.</text>','<text x="24" y="626" font-family="sans-serif" font-size="16">Room envelopes and armor boundaries are reconstructed, not certified subdivision.</text>','</svg>']
    (out/'sections'/(id+'.svg')).write_text('\n'.join(elements))

evidence=[];restricted=[]
for e in spec['evidence']:
    if e['redistribute']:
        if Path(e['image']).name!=e['image']:raise ValueError('Evidence must be a filename')
        shutil.copyfile(refs/e['image'],out/'historical'/e['image']);evidence.append(e)
    else:restricted.append(e)
for name,path in [('measurements.json',source/'reports/measurements.json'),('modeling-spec.json',source/'modeling-spec.json'),('sources.json',refs/'sources.json'),('blueprint.json',source/'blueprint.json'),('discrepancies.md',source/'reports/discrepancies.md'),('export.json',source/'reports/export.json')]:shutil.copyfile(path,out/name)
for path,name in [(source/'build.py','build.py'),(ROOT/'assets/parts/guns.json','guns.json'),(ROOT/'assets/ships/fleet-fidelity/author.py','fleet-author.py'),(ROOT/'assets/ships/fleet-fidelity/deck_surface.py','deck-surface.py')]:shutil.copyfile(path,out/'inputs'/name)
for path in (ROOT/'scripts/ships').glob('*.py'):shutil.copyfile(path,out/'inputs'/path.name)
shutil.copyfile(ROOT/'public/models'/(ship+'.glb'),out/(ship+'.glb'))
(out/'historical/registration.json').write_text(json.dumps(spec['historicalRegistrations'],indent=2)+'\n')
(out/'historical/credits.txt').write_text('\n\n'.join(credits)+'\nSee sources.json for original archival credits. Restricted scans excluded.\n')
esc=html.escape
options=''.join(f'<option value="{v["id"]}">{esc(v["id"].replace("-"," ").title())}</option>' for v in views)
rows=''.join(f'<tr><th>{esc(d["id"])}</th><td>{d["measured"]:.4f} m</td><td>{d["target"]:.4f} m</td><td>{d["deviation"]:+.4f} m</td><td>±{d["tolerance"]} m</td><td>{esc(d["sourceId"])}</td></tr>' for d in report['dimensions'])
gallery=''.join(f'<figure><a href="sheets/{v["id"]}.png"><img loading="lazy" src="sheets/{v["id"]}.png" alt="Before and after {v["id"]}"></a><figcaption>{v["id"]} · <a href="sheets/{v["id"]}.png" download>Full sheet</a> · <a href="overlays/{v["id"]}.png" download>Change overlay</a></figcaption></figure>' for v in views)
sources=json.loads((refs/'sources.json').read_text())['sources']
sourcehtml=''.join(f'<li><a href="{esc(s.get("url","#"),quote=True)}">{esc(s["id"])}</a> — {esc(s.get("title",s.get("document",s["id"])))}<p>{esc(s.get("status",""))} {esc("; ".join(s.get("limitations",[])))}</p></li>' for s in sources)
evidencehtml=''.join(f'<figure><img loading="lazy" src="historical/{e["image"]}" alt="{esc(e["caption"],quote=True)}"><figcaption>{esc(e["caption"])} · {esc(e["sourceId"])}</figcaption></figure>' for e in evidence)
restrictedhtml=''.join(f'<li>{esc(e["image"])} — {esc(e["caption"])} Source: {esc(e["sourceId"])}</li>' for e in restricted)
runtimehtml=''
runtime=source/'reports/fidelity-01/runtime'
if (runtime/'review.json').exists():
    records=json.loads((runtime/'review.json').read_text())
    runtime_hash=spec.get('runtimeReview',{}).get('contentHash',auth['contentHash'])
    if any(r['contentHash']!=runtime_hash or r['shipId']!=ship for r in records):raise ValueError('Runtime record differs from its explicitly registered export')
    runtime_note='' if runtime_hash==auth['contentHash'] else f'<p class="note">Historical runtime evidence · reviewed export {esc(runtime_hash[:12])}, current export {esc(auth["contentHash"][:12])}. {esc(spec["runtimeReview"]["note"])}</p>'
    shutil.copyfile(runtime/'review.json',out/'runtime/review.json')
    runtimehtml='<h2 id="runtime">Live game review</h2>'+runtime_note+'<p>Orca / WebGPU. UI battery firing and reset records are distinct from deliberately seeded structural shots. Canvas-only images omit the HTML HUD; they are direct live renderer captures, not Blender renders. Frame rates were affected by desktop load and tab occlusion; these are functional checks, not a performance certification. <a href="runtime/review.json">Exact-hash runtime records</a></p><div class="gallery">'
    for image in sorted(runtime.glob('*.png')):
        shutil.copyfile(image,out/'runtime'/image.name)
        runtimehtml+=f'<figure><a href="runtime/{image.name}"><img loading="lazy" src="runtime/{image.name}" alt="{esc(image.stem)}"></a><figcaption>{esc(image.stem.replace("-"," "))}</figcaption></figure>'
    runtimehtml+='</div>'
probes='\n'.join(p['id']+': '+' → '.join(f'{h["name"]} ({h["thicknessMm"]} mm)' for h in p['layers']) for p in report['probes'])
probes+='\n\n'+'\n'.join(p['id']+': '+('MISS' if not p['hits'] else ', '.join(sorted({h['id'] for h in p['hits']}))) for p in report['structuralProbes'])
body=f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{esc(spec['review']['title'])}</title><link rel="stylesheet" href="fonts/fonts.css"><link rel="stylesheet" href="fonts/review.css"><main>
<nav aria-label="Review navigation"><a href="../../../?ship={ship}">Open ship</a><a href="#dimensions">Dimensions</a><a href="#sections">Protection</a><a href="#evidence">Evidence</a><a href="{ship}-review.zip" download>Download review pack</a><a href="{ship}.glb" download>GLB</a></nav>
<h1>{esc(spec['review']['title'])}</h1><p>{esc(spec['configuration'])}. {esc(spec['review']['intro'])}</p><p class="note">Build {auth['contentHash'][:12]} · {export['triangles']:,} triangles · {export['meshes']} meshes. Engineering verification is not historical certification.</p>
<div class="controls"><label>View<select id="view">{options}</select></label><label>Comparison<select id="reference"><option value="before">Pre-pass original</option><option value="historical">Historical drawing</option></select></label><label>Current overlay <output id="opacity-value">50%</output><input id="opacity" type="range" min="0" max="100" value="50"></label></div>
<figure><div class="overlay"><img id="reference-image" src="before/starboard.png" alt="Selected comparison layer"><img class="ours" id="authored-image" src="authored/starboard.png" alt="Current exported ship"></div><figcaption id="view-note">Identical fixed cameras; no rescaling between authored stages.</figcaption></figure>
<div class="pair"><figure><img id="own-side" src="authored/starboard.png" alt="Current ship alone"><figcaption>Current GLB · {auth['contentHash'][:12]}</figcaption></figure><figure><img id="ref-side" src="before/starboard.png" alt="Comparison alone"><figcaption id="ref-label">Preserved original · {before['contentHash'][:12]}</figcaption></figure></div>
<h2 id="dimensions">Dimensions and mounting datums</h2><div class="table-wrap"><table><thead><tr><th>Measurement</th><th>Exported</th><th>Target</th><th>Deviation</th><th>Build tolerance</th><th>Evidence</th></tr></thead><tbody>{rows}</tbody></table></div>
<p>Actual transformed hull triangles, not accessor bounds. {report['geometry']['triangles']:,} hull triangles; {report['geometry']['nonManifoldEdges']} nonmanifold edges; {report['geometry']['degenerate']} degenerate faces. {len(report['spaces'])} room envelopes fit the loft. All {len(report['landmarks'])} mounting-axis export checks pass. Tolerances check authored datums; source uncertainty remains separate.</p>
<p><a href="measurements.json">Measurements, axes and probes</a> · <a href="modeling-spec.json">Modeling specification</a> · <a href="blueprint.json">Editable blueprint</a> · <a href="export.json">Export/articulation checks</a></p>
<h2 id="sections">Hull, protection and provisional spaces</h2><div class="controls"><label>Section station<select id="section">{''.join(f'<option value="{id}">{station:.3f} m from stern</option>' for id,station in zip(section_ids,spec['sectionStations']))}</select></label></div><figure><img id="section-image" src="sections/{section_ids[0]}.svg" alt="Selected hull protection section"></figure><p>Authored hull and deckhouse surfaces take CPU hits. Exterior armor replaces nearby nominal skin; open hangars stay open. Gunhouse facets move with their original joints. Only hull contacts create sea breaches. Nominal plating, ballistics and flooding capacities are estimates.</p><pre class="probes">{esc(probes)}</pre>
<details><summary>All twelve registered before/after views</summary><div class="gallery">{gallery}</div></details>
{runtimehtml}
<h2 id="evidence">Historical evidence and unresolved differences</h2><p>{esc(spec['review']['limits'])}</p><p><a href="discrepancies.md">Discrepancy register</a> · <a href="sources.json">Full source register</a> · <a href="historical/registration.json">Raster registrations</a> · <a href="historical/credits.txt">Credits</a></p><div class="pair">{evidencehtml}</div><details><summary>Restricted local evidence, excluded from this pack</summary><ul>{restrictedhtml}</ul></details><details><summary>Source records</summary><ul>{sourcehtml}</ul></details>
<p class="credit">All production geometry and materials independently authored. Historical references are not runtime textures. {' '.join(esc(c) for c in credits)} No GameModels3D geometry or attachment data used. Original authoring inputs included; rebuild with the repository shared pipeline. Generated Blender scenes remain under assets.</p>
</main><script>const history={json.dumps({k:v['note'] for k,v in history.items()})};const view=document.getElementById('view'),reference=document.getElementById('reference');function update(){{const id=view.value;reference.options[1].disabled=!history[id];if(!history[id])reference.value='before';for(const k of ['authored-image','own-side'])document.getElementById(k).src='authored/'+id+'.png';for(const k of ['reference-image','ref-side'])document.getElementById(k).src=reference.value+'/'+id+'.png';document.getElementById('view-note').textContent=reference.value==='historical'?history[id]:'Identical fixed cameras; no rescaling between authored stages.';document.getElementById('ref-label').textContent=reference.value==='historical'?'Historical evidence; source and fit limitations apply':'Preserved pre-pass original';}}view.addEventListener('change',update);reference.addEventListener('change',update);document.getElementById('opacity').addEventListener('input',e=>{{document.querySelector('.overlay').style.setProperty('--alpha',e.target.value/100);document.getElementById('opacity-value').value=e.target.value+'%';}});document.getElementById('section').addEventListener('change',e=>document.getElementById('section-image').src='sections/'+e.target.value+'.svg');update();</script></html>'''
(out/'index.html').write_text(body)
archive=out/(ship+'-review.zip')
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for p in sorted(out.rglob('*')):
        if p.is_file() and p!=archive and p.name!='build.json':z.write(p,p.relative_to(out))
if archive.stat().st_size>=100*1024*1024:raise ValueError('Review archive exceeds repository host limit')
print('HISTORICAL REVIEW',ship,len(views),'matched views;',archive.stat().st_size,'bytes; restricted scans excluded')
