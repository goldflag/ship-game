"""Fletcher raster review pack. Reads our model metadata and preserved images only.
Run after ship:review and scripts/reference/render_authored.py (REFERENCE_SHIP=fletcher).
No reference geometry or source image enters ship authoring.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json, hashlib, html, shutil, runpy
ROOT=Path(__file__).resolve().parents[3]
source=Path(__file__).resolve().parent;out=source/'generated/comparison';refs=source/'references'
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def font(size):
    try:return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',size)
    except OSError:return ImageFont.load_default(size=size)
def paper(path):
    im=Image.open(path).convert('RGBA');bg=Image.new('RGBA',im.size,'#eae9e3');bg.alpha_composite(im);return bg.convert('RGB')
def labelled(im,label):
    canvas=Image.new('RGB',(im.width,im.height+58),'#eae9e3');canvas.paste(im,(0,58))
    ImageDraw.Draw(canvas).text((22,16),label,font=font(22),fill='#273d4b');return canvas
runpy.run_path(str(source/'check-shape.py'))
model=ROOT/'public/models/fletcher.glb';definition=json.loads((ROOT/'public/models/fletcher.json').read_text())
auth=json.loads((out/'authored/manifest.json').read_text());ref=json.loads((refs/'gamemodels3d/manifest.json').read_text())
if auth['contentHash']!=definition['contentHash'] or auth['modelSha256']!=sha(model):raise ValueError('Stale authored renders')
if auth['capturePlanSha256']!=ref['capturePlanSha256']:raise ValueError('Reference and authored cameras differ')
(out/'sheets').mkdir(parents=True,exist_ok=True)
for a in auth['captures']:
    name=a['id'];r=next(r for r in ref['captures'] if r['id']==name)
    ap=out/'authored'/a['image'];rp=refs/'gamemodels3d'/r['image']
    if sha(ap)!=a['imageSha256'] or sha(rp)!=r['imageSha256']:raise ValueError('Image changed after capture')
    ours=labelled(paper(ap),'Original Fletcher revision 4 · '+definition['contentHash'][:12])
    other=labelled(paper(rp),'GameModels3D Fletcher · later AA fit · comparison only')
    sheet=Image.new('RGB',(ours.width+other.width,ours.height+50),'#eae9e3');sheet.paste(ours,(0,0));sheet.paste(other,(ours.width,0))
    ImageDraw.Draw(sheet).text((22,ours.height+12),'Identical cameras; one global reference scale. No component fitting or historical accuracy certification.',font=font(19),fill='#273d4b')
    sheet.save(out/'sheets'/(name+'.png'))
# Before/after uses the unchanged shared review camera span; its vertical framing follows model height.
before=labelled(paper(source/'baseline/revision-2/generated/review/profile.png'),'Previous revision 2 · before proportion correction')
after=labelled(paper(source/'generated/review/profile.png'),'Current revision 4 · original Fletcher')
comparison=Image.new('RGB',(max(before.width,after.width),before.height+after.height),'#eae9e3');comparison.paste(before,(0,0));comparison.paste(after,(0,before.height));comparison.save(out/'before-after.png')
plan=Image.open(refs/'historical/oni-222-us-1945-fletcher.png').convert('RGB')
plan.crop((950,260,2180,835)).save(out/'oni-profile-plan.png')
# A compact contact sheet keeps all independently matched angles inspectable.
thumbs=[]
for a in auth['captures']:
    im=paper(out/'authored'/a['image']);im.thumbnail((480,250));thumbs.append((a['id'],im))
contact=Image.new('RGB',(1500,320*((len(thumbs)+2)//3)),'#eae9e3');draw=ImageDraw.Draw(contact)
for i,(name,im) in enumerate(thumbs):
    x=i%3*500;y=i//3*320;draw.text((x+16,y+14),name.replace('-',' ').title(),font=font(22),fill='#273d4b');contact.paste(im,(x+(500-im.width)//2,y+55+(250-im.height)//2))
contact.save(out/'contact-sheet.png')
links=''.join(f'<figure><a href="sheets/{a["id"]}.png"><img loading="lazy" src="sheets/{a["id"]}.png" alt="Original and GameModels3D {a["id"]} comparison"></a><figcaption>{a["id"].replace("-"," ").title()}</figcaption></figure>' for a in auth['captures'])
# This is a static model inspection artifact, not a new product screen.
body='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fletcher · model reference review</title><style>body{margin:0;background:#132a36;color:#e9e7de;font:17px/1.6 system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:32px}a{color:#e6c288}p{max-width:90ch}figure{margin:28px 0}img{display:block;width:100%;height:auto;background:#eae9e3}figcaption{padding:8px 0;color:#b5c5cc}.sources{max-width:100ch}code{overflow-wrap:anywhere}nav{display:flex;flex-wrap:wrap;gap:24px}h1{font-size:36px}h2{margin-top:40px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}@media(max-width:750px){.grid{grid-template-columns:1fr}main{padding:18px}}</style><main><nav><a href="/?ship=fletcher">Fletcher in game</a><a href="#comparison">Matched views</a><a href="#sources">Sources</a><a href="review-manifest.json">Capture provenance</a></nav><h1>Fletcher · turret and propeller correction</h1><p>Revision 4 rebuilds all five Mk 30 gunhouses and both propellers. Taller asymmetrical enclosures, sloping roofs, shoulder corners, real gun-port recesses and curved elevating shields replace the previous generic shapes. Broad, rounded, handed propeller blades replace narrow strips. The original component catalog and ship recipe remain editable.</p><figure><img src="before-after.png" alt="Before and after Fletcher model profiles"><figcaption>Shared orthographic profile camera span; vertical framing follows each model’s height. Colour here is Workbench material colour, not the in-game camouflage.</figcaption></figure><h2 id="comparison">Matching comparison views</h2><p>Our actual exported GLB and GameModels3D use identical orthographic cameras. The game reference has one whole-model scale of 15 metres per viewer unit; its waterline and refit are unverified. The July 1942-inspired fit retains the high after AA tub and six 20 mm guns rather than adopting the later game model’s AA platforms.</p>'''+links+'''<h2 id="sources">Plans and dated photographs</h2><figure><img src="oni-profile-plan.png" alt="US Navy ONI 222-US Fletcher profile and deck plan"><figcaption>ONI 222-US, 1 September 1945, printed page 89. Preserved crop of the actual Navy recognition drawing. The later AA fit and schematic hull are not a July 1942 construction or lines plan.</figcaption></figure><div class="grid"><figure><a href="historical/19-n-31243.jpg"><img src="historical/19-n-31243.jpg" alt="USS Fletcher off New York, 18 July 1942, Bureau of Ships photograph"><figcaption>NARA 19-N-31243 · actual 1942 round bridge, director, high aft gun tub, boats, camouflage and depth-charge deck. Perspective reference, not a dimensional tracing.</figcaption></a></figure><figure><img src="historical/19-n-31245.jpg" alt="USS Fletcher underway on 18 July 1942"><figcaption>NARA 19-N-31245 · July 1942 silhouette.</figcaption></figure></div><p>The hull, bridge tiers, wings, deckhouse fronts and funnel caps were corrected through repeated matching-view inspection and sparse silhouette measurements. Exact hull offsets, load datum, individual outfit dates and port/starboard camouflage remain open. Small fittings and paint are original interpretations. Export checks verify the model/blueprint contract; they do not certify historical accuracy.</p><ul class="sources"><li><a href="https://gamemodels3d.com/en/games/worldofwarships/vehicles/pasd021">GameModels3D Fletcher</a> · comparison rasters only; no imported topology, attachment transforms, UVs or textures in our production model.</li><li><a href="historical/oni-222-us-fletcher-extract.pdf">Preserved ONI 222-US source extract</a> · US Navy government publication, mirrored by HyperWar/ibiblio.</li><li><a href="https://www.history.navy.mil/content/history/nhhc/our-collections/photography/numerical-list-of-images/nara-series/19-n/19-N-30000/19-n-31243-uss-fletcher--dd-445-.html">NHHC 19-N-31243</a> · US Navy/Bureau of Ships, NARA.</li><li><a href="sources.json">Full source register</a> · includes unavailable Sigsbee/Bath Iron Works full plates, which were not used as measured evidence.</li></ul><p>Build: <code>'''+definition['contentHash']+'''</code>. Local Blender pipeline; no Blender MCP tools were available.</p></main></html>'''
shape=json.loads((out/'shape-measurements.json').read_text())
if shape['contentHash']!=definition['contentHash']:raise ValueError('Stale shape measurements')
shape_html='<h2 id="shape">Shape comparison</h2><p>RMS difference at selected points in the preserved reference images. These are sparse screen-space probes, not a full-model similarity score. The original registration is unchanged; the reference load datum and later AA fit remain unverified. <a href="shape-measurements.json">All probes and limits</a> · <a href="shape-correction.md">Shape correction record</a>.</p><table style="border-collapse:collapse;text-align:left"><thead><tr><th style="padding:10px 24px 10px 0">Sampled silhouette</th><th style="padding:10px 24px">Previous</th><th style="padding:10px 24px">Corrected</th></tr></thead><tbody>'
for group in shape['groups']:
    shape_html+='<tr><td style="padding:8px 24px 8px 0">'+group['name']+'</td><td style="padding:8px 24px">'+format(group['previousRmsM'],'.2f')+' m</td><td style="padding:8px 24px">'+format(group['currentRmsM'],'.2f')+' m</td></tr>'
shape_html+='</tbody></table>'
for name in ['starboard','top','bridge']:
    shape_html+='<figure><a href="shape-'+name+'.png"><img src="shape-'+name+'.png" loading="lazy" alt="Previous Fletcher, corrected Fletcher and reference '+name+' silhouettes"></a><figcaption>'+name.capitalize()+': previous revision 2 / current revision 4 / GameModels3D. Identical camera and scale; no image warping.</figcaption></figure>'
start=body.index('<figure><img src="before-after.png"')
end=body.index('</figure>',start)+len('</figure>')
body=body[:start]+'<details><summary>Earlier hull and bridge corrections</summary>'+shape_html+'</details>'+body[end:]
published_report=(source/'reports/shape-correction.md').read_text().replace('../generated/comparison/index.html','index.html').replace('../generated/comparison/shape-measurements.json','shape-measurements.json').replace('[validation.md](validation.md)','[runtime summary](runtime/summary.json)')
(out/'shape-correction.md').write_text(published_report)
shutil.copy2(source/'reports/discrepancies.md',out/'discrepancies.md')
runtime=source/'reports/runtime-review'
if (runtime/'summary.json').exists():
    checked=json.loads((runtime/'summary.json').read_text())
    if checked['contentHash']!=definition['contentHash']:raise ValueError('Stale runtime review')
    shutil.rmtree(out/'runtime',ignore_errors=True)
    (out/'runtime').mkdir()
    pictures=['turret-game-neutral','turret-game-low-recoil','turret-game-high-recoil','propellers-game-quarter','propellers-game-stern','propellers-game-rotated','exterior-quarter','afterdeck-closeup','depth-charge-blast']
    for name in pictures:shutil.copy2(runtime/(name+'.png'),out/'runtime'/(name+'.png'))
    shutil.copy2(runtime/'summary.json',out/'runtime/summary.json')
    component_record=json.loads((runtime/'component-closeups.json').read_text())
    if component_record['contentHash']!=definition['contentHash']:raise ValueError('Stale component closeups')
    shutil.copy2(runtime/'component-closeups.json',out/'runtime/component-closeups.json')
    shutil.copy2(source/'reports/component-geometry-check.json',out/'component-geometry-check.json')
    runtime_html='<h2>In-game model and articulation</h2><p>Actual exported model in the production WebGPU scene, inspected with a diagnostic camera. All 18 joint poses passed; ten torpedoes launched and hit, and eight depth charges completed their launch-to-blast cycle. Propeller images temporarily hide sea and hull for inspection of the actual loaded GLB; the rotated view checks independent pivots, not sailing animation. <a href="runtime/summary.json">Runtime validation</a>.</p>'
    runtime_html+=''.join('<figure><a href="runtime/'+name+'.png"><img loading="lazy" src="runtime/'+name+'.png" alt="Fletcher '+name.replace('-',' ')+'"></a><figcaption>'+name.replace('-',' ').capitalize()+'</figcaption></figure>' for name in pictures)
    body=body.replace('<h2 id="comparison">',runtime_html+'<h2 id="comparison">')
# Component review compares the preserved revision 3 with this exact exported GLB.
old=source/'baseline/revision-3/generated/comparison/authored'
old_manifest=json.loads((old/'manifest.json').read_text())
component_views=['turret-quarter','turret-side','propellers-stern','propellers-quarter']
component_html='<h2 id="components">Turret and propeller closeups</h2><p>Previous revision 3 / corrected revision 4 / GameModels3D. All three use identical cameras and the unchanged global registration. <a href="components.md">Changes and remaining approximations</a>.</p>'
for name in component_views:
    a=next(c for c in auth['captures'] if c['id']==name);b=next(c for c in old_manifest['captures'] if c['id']==name)
    for field in ['position','target','spanM','resolution','projection','cameraMatrixWorld','visibility']:
        assert a[field]==b[field], 'Baseline camera changed: '+name
    assert sha(old/(name+'.png'))==b['imageSha256']
    panels=[labelled(paper(folder/(name+'.png')),label) for folder,label in [(old,'Previous revision 3'),(out/'authored','Corrected revision 4'),(refs/'gamemodels3d','GameModels3D comparison reference')]]
    sheet=Image.new('RGB',(panels[0].width,sum(p.height for p in panels)),'#eae9e3');y=0
    for panel in panels:sheet.paste(panel,(0,y));y+=panel.height
    image_name='component-'+name+'.png';sheet.save(out/image_name)
    component_html+='<figure><a href="'+image_name+'"><img loading="lazy" src="'+image_name+'" alt="Previous, corrected and reference '+name+' shapes"></a><figcaption>'+name.replace('-',' ').capitalize()+'</figcaption></figure>'
component_html+='<details><summary>Navy component drawing and dry-dock photograph</summary><div class="grid"><figure><a href="historical/op1112-mk30-mod18.jpg"><img loading="lazy" src="historical/op1112-mk30-mod18.jpg" alt="Navy OP 1112 Mk30 Mod18 general arrangement"><figcaption>OP 1112 (2nd revision), p.288. Mod 18 general form; exact Mod 0 details remain interpreted.</figcaption></a></figure><figure><a href="historical/all-hands-1952-propeller-extract.pdf"><img loading="lazy" src="historical/all-hands-1952-propeller.png" alt="Navy All Hands photograph of Lewis Hancock propeller replacement"><figcaption>All Hands, October 1952, p.3. Broad three-bladed screw on a postwar sister ship; no pitch table.</figcaption></a></figure></div></details>'
body=body.replace('<details><summary>Earlier hull and bridge corrections</summary>',component_html+'<details><summary>Earlier hull and bridge corrections</summary>')
body=body.replace('<a href="#comparison">Matched views</a>','<a href="#components">Turrets and propellers</a><a href="#comparison">All views</a>')
(out/'components.md').write_text((source/'reports/components.md').read_text().replace('../generated/comparison/index.html','index.html').replace('../references/historical/','historical/'))
(out/'index.html').write_text(body)
shutil.copytree(refs/'historical',out/'historical',dirs_exist_ok=True);shutil.copy2(refs/'19-n-31245.jpg',out/'historical/19-n-31245.jpg');shutil.copy2(refs/'sources.json',out/'sources.json')
manifest={'schemaVersion':1,'contentHash':definition['contentHash'],'modelSha256':sha(model),'recipeSha256':sha(source/'build.py'),'reviewRecipeSha256':sha(Path(__file__)),'shapeReviewRecipeSha256':sha(source/'check-shape.py'),'shapeAuthoringRecipeSha256':sha(source/'author-shape.py'),'componentAuthoringRecipeSha256':sha(ROOT/'assets/parts/author-mk30.py'),'componentCatalogSha256':sha(ROOT/'assets/parts/guns.json'),'componentCheckRecipeSha256':sha(source/'check-components.py'),'blueprintSha256':sha(source/'blueprint.json'),'sourceRegisterSha256':sha(refs/'sources.json'),'capturePlanSha256':auth['capturePlanSha256'],'authored':auth,'reference':ref,'historicalAccuracy':'Not certified; recognition plan and dated photographs interpreted, hull lines reconstructed.','outputs':{str(p.relative_to(out)):sha(p) for p in sorted(out.rglob('*')) if p.is_file() and p.name!='review-manifest.json'}}
(out/'review-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
publish=ROOT/'public/ship-reference/fletcher';temporary=publish.with_name('fletcher.tmp')
shutil.rmtree(temporary,ignore_errors=True);shutil.copytree(out,temporary)
shutil.rmtree(publish,ignore_errors=True);temporary.rename(publish)
print('Fletcher review: '+str(publish/'index.html'))
