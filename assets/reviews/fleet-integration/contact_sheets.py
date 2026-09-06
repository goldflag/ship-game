"""Index the merged exports' existing fixed review renders; retain older evidence."""
import json
import argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[3]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output-name', default='.', help='Evidence subdirectory beside this script')
args = parser.parse_args()
OUTPUT = Path(__file__).resolve().parent / args.output_name
OUTPUT.mkdir(parents=True, exist_ok=True)
try:
    FONT = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 23)
except OSError:
    FONT = ImageFont.load_default(size=23)

for ship in ['bismarck', 'yamato', 'baltimore', 'enterprise-cv6', 'type-viic']:
    review = ROOT / 'assets/ships' / ship / 'generated/review'
    content_hash = json.loads((review / 'cameras.json').read_text())['contentHash']
    definition = json.loads((ROOT / 'public/models' / (ship + '.json')).read_text())
    if content_hash != definition['contentHash']:
        raise ValueError(f'{ship}: fixed review belongs to another export')
    sheet = Image.new('RGB', (1800, 1760), '#f2f0e9')
    draw = ImageDraw.Draw(sheet)
    draw.text((25, 15), f'{ship} | merged export | {content_hash[:12]}', font=FONT, fill='#243845')
    cells = [('profile', (20, 60, 1760, 410)), ('plan', (20, 450, 1760, 380)),
             ('bow', (20, 860, 490, 460)), ('stern', (530, 860, 490, 460)),
             ('quarter', (1020, 860, 760, 880))]
    for name, (x, y, width, height) in cells:
        draw.text((x, y), name, font=FONT, fill='#243845')
        with Image.open(review / (name + '.png')) as original:
            image = ImageOps.contain(original.convert('RGB'), (width, height - 35))
        sheet.paste(image, (x + (width - image.width) // 2, y + 35))
    sheet.save(OUTPUT / (ship + '-fixed-views.png'))
    print(ship, content_hash)
