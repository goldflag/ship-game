"""Readable indexes of the fixed export review and matched before/after renders.

This only assembles existing original render evidence; it does not retouch or
reframe models, regenerate a baseline, or read historical/game reference art.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[3]
try:
    FONT = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 23)
except OSError:
    FONT = ImageFont.load_default(size=23)

for ship in ['yamato', 'baltimore', 'enterprise-cv6', 'bismarck']:
    source = ROOT / 'assets/ships' / ship
    review = source / 'generated/review'
    content_hash = json.loads((review / 'cameras.json').read_text())['contentHash']
    report = source / 'reports/fidelity-01'
    report.mkdir(parents=True, exist_ok=True)
    sheet = Image.new('RGB', (1800, 1760), '#f2f0e9')
    draw = ImageDraw.Draw(sheet)
    draw.text((25, 15), f'{ship} | fixed export views | {content_hash[:12]}', font=FONT, fill='#243845')
    # Broad profile/plan cells retain enough pixels to inspect sheer and outline.
    cells = [('profile', (20, 60, 1760, 410)), ('plan', (20, 450, 1760, 380)),
             ('bow', (20, 860, 490, 460)), ('stern', (530, 860, 490, 460)),
             ('quarter', (1020, 860, 760, 880))]
    for name, (x, y, width, height) in cells:
        draw.text((x, y), name, font=FONT, fill='#243845')
        image = ImageOps.contain(Image.open(review / (name + '.png')).convert('RGB'), (width, height - 35))
        sheet.paste(image, (x + (width-image.width)//2, y + 35))
    sheet.save(report / 'fixed-views.png')
    if ship == 'bismarck':
        continue
    views = json.loads((source / 'references/capture-plan.json').read_text())['views']
    sheet = Image.new('RGB', (2400, 6 * 440 + 60), '#f2f0e9')
    draw = ImageDraw.Draw(sheet)
    draw.text((25, 15), f'{ship} | matched originals: BEFORE left, AFTER right | {content_hash[:12]}', font=FONT, fill='#243845')
    for i, view in enumerate(views):
        x, y = (i % 2) * 1200, 60 + (i // 2) * 440
        draw.text((x+15, y), view['id'], font=FONT, fill='#243845')
        for j, directory in enumerate([report/'before/authored', source/'generated/comparison/authored']):
            image = Image.open(directory/(view['id']+'.png')).convert('RGBA')
            image = ImageOps.contain(image, (590, 395))
            sheet.paste(image, (x + j*600 + (600-image.width)//2, y+35), image)
    sheet.save(report/'matched-views.png')
    print(ship, content_hash[:12], 'fixed + matched contact sheets')
