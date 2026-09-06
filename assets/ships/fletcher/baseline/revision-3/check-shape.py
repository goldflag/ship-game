"""Raster-only, camera-matched checks of Fletcher's corrected major proportions.

Run after the shared authored/reference renders. These deliberately sparse probes
measure the displayed silhouettes, not the reference model's vertices/topology.
They do not certify a refit, load datum, or historical lines plan.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import hashlib
import json
import math

source = Path(__file__).resolve().parent
root = source.parents[2]
out = source/'generated/comparison'
ref = source/'references/gamemodels3d'
old = source/'baseline/revision-2/generated/comparison/authored'
current = out/'authored'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
auth = json.loads((current/'manifest.json').read_text())
reference = json.loads((ref/'manifest.json').read_text())
previous = json.loads((old/'manifest.json').read_text())
definition = json.loads((root/'public/models/fletcher.json').read_text())
assert auth['contentHash'] == definition['contentHash'], 'Stale authored views'
assert auth['modelSha256'] == sha(root/'public/models/fletcher.glb'), 'Stale rendered model'
assert auth['capturePlanSha256'] == reference['capturePlanSha256'] == previous['capturePlanSha256'], 'Camera plans differ'


def load_views(folder, manifest):
    views = {}
    for name in ['starboard', 'top', 'bow']:
        path = folder/(name+'.png')
        record = next(x for x in manifest['captures'] if x['id'] == name)
        assert sha(path) == record['imageSha256'], 'Capture hash mismatch: '+str(path)
        views[name] = Image.open(path).convert('RGBA').getchannel('A')
    return views


def measure(views):
    side, plan, bow = (views[n] for n in ['starboard', 'top', 'bow'])
    values = {}
    # Far-forward rows below the forecastle; no mast, turret or anchor can become
    # the leading edge in these sampled ranges.
    for z in [-3, -2, 0, 2, 4]:
        y = round(350+(9-z)/.064)
        xs = [x for x in range(1600, 1990) if side.getpixel((x, y)) > 240]
        values[f'stem-x-at-z-{z}'] = (max(xs)-1000)*.064 if xs else None
    # Five lower-profile columns clear of the propellers and keel appendages.
    for x in [30, 38, 46, 52, 54]:
        px = round(1000+x/.064)
        ys = [y for y in range(450, 650) if side.getpixel((px, y)) > 240]
        values[f'forefoot-z-at-x-{x}'] = 9-(max(ys)-350)*.064 if ys else None
    # Forecastle half-breadths, avoiding the anchors and bow staff.
    for x in [40, 45, 50]:
        px = round(1000+x/.064)
        ys = [y for y in range(240, 460) if plan.getpixel((px, y)) > 240]
        values[f'foredeck-half-breadth-at-x-{x}'] = (max(ys)-min(ys))*.064/2 if ys else None
    # The uninterrupted solid bridge silhouette through the centreline, viewed
    # from ahead. Detached signals, rigging and wing lights are excluded.
    for z in [8.5, 9.5, 10.5, 11, 11.5]:
        py = round(450+(9-z)*900/33)
        l = r = 450
        if bow.getpixel((450, py)) <= 240:
            values[f'bridge-solid-width-at-z-{z}'] = 0
            continue
        while l > 0 and bow.getpixel((l-1, py)) > 240: l -= 1
        while r < 899 and bow.getpixel((r+1, py)) > 240: r += 1
        values[f'bridge-solid-width-at-z-{z}'] = (r-l)*33/900
    return values


measurements = {key: measure(load_views(folder, manifest))
                for key, folder, manifest in [('reference', ref, reference), ('previous', old, previous), ('current', current, auth)]}
rows = []
for name, expected in measurements['reference'].items():
    before = measurements['previous'][name]; after = measurements['current'][name]
    assert None not in [expected, before, after], 'Missing silhouette at '+name
    rows.append({'probe': name, 'referenceM': round(expected, 5), 'previousM': round(before, 5),
                 'currentM': round(after, 5), 'previousErrorM': round(abs(before-expected), 5),
                 'currentErrorM': round(abs(after-expected), 5)})
groups = []
for prefix, name in [('stem-', 'Bow stem position'), ('forefoot-', 'Forward lower profile'),
                     ('foredeck-', 'Foredeck half-breadth'), ('bridge-', 'Upper bridge solid width')]:
    part = [r for r in rows if r['probe'].startswith(prefix)]
    rms = lambda column: math.sqrt(sum(r[column]**2 for r in part)/len(part))
    groups.append({'name': name, 'samples': len(part), 'previousRmsM': round(rms('previousErrorM'), 4),
                   'currentRmsM': round(rms('currentErrorM'), 4)})
report = {'schemaVersion': 1, 'contentHash': auth['contentHash'], 'recipeSha256': sha(Path(__file__)),
          'capturePlanSha256': auth['capturePlanSha256'], 'modelSha256': auth['modelSha256'],
          'referenceManifestSha256': sha(ref/'manifest.json'), 'previousManifestSha256': sha(old/'manifest.json'),
          'authoredManifestSha256': sha(current/'manifest.json'), 'groups': groups, 'probes': rows,
          'limitations': ['Sparse screen-space probes, not a full geometric similarity score.',
                         'Side/plan sampling is 0.064 m/pixel; bow sampling is 0.03667 m/pixel.',
                         'The unchanged global registration leaves the reference load datum unverified.',
                         'AA fit, antennas, individual fittings and gunhouses can still differ.',
                         'No reference vertices, topology or component transforms are read.']}
(out/'shape-measurements.json').write_text(json.dumps(report, indent=2)+'\n')
# Three rows at identical camera/scale make the corrected massing easy to judge.
font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 24)
for view in ['starboard', 'top', 'bridge']:
    panels = []
    for folder, label in [(old, 'Previous revision 2'), (current, 'Corrected revision 3'), (ref, 'GameModels3D reference — comparison only')]:
        im = Image.open(folder/(view+'.png')).convert('RGBA')
        bg = Image.new('RGBA', im.size, '#eae9e3'); bg.alpha_composite(im)
        panel = Image.new('RGB', (im.width, im.height+50), '#eae9e3'); panel.paste(bg, (0, 50))
        ImageDraw.Draw(panel).text((22, 10), label, font=font, fill='#273d4b')
        panels.append(panel)
    sheet = Image.new('RGB', (panels[0].width, sum(p.height for p in panels)), '#eae9e3')
    y = 0
    for panel in panels: sheet.paste(panel, (0, y)); y += panel.height
    sheet.save(out/('shape-'+view+'.png'))
for group in groups: print(group['name']+': '+str(group['previousRmsM'])+' → '+str(group['currentRmsM'])+' m RMS on '+str(group['samples'])+' probes')
