"""Compose unchanged fixed-camera renders; no scaling or fitting of components.

Run after ship:build and ship:review. Each complete raster is uniformly reduced
for presentation. The before snapshots retain their original manifests/hashes.
"""
from pathlib import Path
import json
from PIL import Image, ImageDraw, ImageFont

here = Path(__file__).resolve().parent
ship = here.parents[1]
current = ship / 'generated/comparison/authored'
before = here / 'before/matched'
font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 24)
small = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 17)
after_hash = json.loads((current / 'manifest.json').read_text())['contentHash']
before_hash = json.loads((before / 'manifest.json').read_text())['contentHash']

def panel(path, width=1050):
    im = Image.open(path).convert('RGBA')
    im.thumbnail((width, 875), Image.Resampling.LANCZOS)
    bg = Image.new('RGB', im.size, '#efeee8')
    bg.paste(im, mask=im.getchannel('A'))
    return bg

for view, output, title in [
    ('main-a-quarter', 'before-after.png', 'KGV main gunhouses — upright faces and shallow roof crown'),
    ('main-a', 'profile.png', 'Quadruple mounting — continuous side plates and rounded rear'),
    ('main-a-top', 'plan.png', 'Quadruple mounting — plan outline and projecting rangefinder covers'),
    ('main-b', 'twin.png', 'Twin mounting — separate roof profile and vertical face'),
]:
    a, b = panel(before / (view + '.png')), panel(current / (view + '.png'))
    out = Image.new('RGB', (a.width + b.width, max(a.height, b.height) + 108), '#efeee8')
    draw = ImageDraw.Draw(out)
    draw.text((20, 13), title, fill='#263a42', font=font)
    draw.text((20, 51), 'Before · ' + before_hash[:12], fill='#42565b', font=small)
    draw.text((a.width + 20, 51), 'Revised · ' + after_hash[:12], fill='#42565b', font=small)
    out.paste(a, (0, 80)); out.paste(b, (a.width, 80))
    draw.text((20, out.height - 24), 'Same orthographic camera and metric scale. Original authored geometry in both panels.', fill='#42565b', font=small)
    out.save(here / output)

print('Saved four same-camera before/after sheets for ' + after_hash)
