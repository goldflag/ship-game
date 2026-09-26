"""Measure the windows and portholes the approved reference paints on Ise's pagoda and after tower.

Renders orthographic views of the cached GameModels3D pjsb526 reference with its source textures
(`bun run ship:reference pjsb526 --render`), finds the painted window panes as dark rectangles and
the portholes as dark discs, and writes their centres and sizes to `ise_windows.py` as a table in
ship metres (reference frame: x starboard, y up, z toward the stern). The recipe seats each one on
this model's own walls by casting a ray from outside along the view. Only our table is written; no
reference pixels or geometry are kept.

  python3 assets/ships/ise/measure-windows.py
"""
import json
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = ROOT / '.build/ise/windows'
SIZE = (1600, 1000)
ORTHO = 24.0
# (name, view, eye, target): front views look aft at the pagoda's face; side views look inboard from starboard.
VIEWS = [
    ('front-low', 'front', (0, 21.5, -150), (0, 21.5, -30)),
    ('front-high', 'front', (0, 35.0, -150), (0, 35.0, -30)),
    ('side-pagoda-low', 'side', (150, 21.5, -30), (0, 21.5, -30)),
    ('side-pagoda-high', 'side', (150, 34.0, -30), (0, 34.0, -30)),
    ('side-after-tower', 'side', (150, 22.0, 44), (0, 22.0, 44)),
]
DARK = 78          # sRGB luminance of a painted pane or porthole (the grey walls are 110-150)


def render(name, eye, target):
    out = OUT / name
    cmd = ['bun', 'scripts/construction/cli.ts', 'reference', 'pjsb526', '--render', '--eye', ','.join(map(str, eye)),
           '--target', ','.join(map(str, target)), '--ortho', str(ORTHO), '--out', str(out)]
    subprocess.run(cmd, cwd=ROOT, check=True, capture_output=True)
    return np.asarray(Image.open(out / 'camera.png').convert('RGB')).astype(float)


def blobs(mask):
    """4-connected components of a boolean image as (rows, cols) index arrays."""
    seen = np.zeros_like(mask, bool)
    H, W = mask.shape
    out = []
    for r0, c0 in zip(*np.nonzero(mask)):
        if seen[r0, c0]:
            continue
        stack, rows, cols = [(r0, c0)], [], []
        seen[r0, c0] = True
        while stack:
            r, c = stack.pop()
            rows.append(r)
            cols.append(c)
            for rr, cc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                if 0 <= rr < H and 0 <= cc < W and mask[rr, cc] and not seen[rr, cc]:
                    seen[rr, cc] = True
                    stack.append((rr, cc))
        out.append((np.array(rows), np.array(cols)))
    return out


rows = []
for name, view, eye, target in VIEWS:
    img = render(name, eye, target)
    lum = img @ np.array([.299, .587, .114])
    m = ORTHO / SIZE[0]
    for r, c in blobs(lum < DARK):
        n = len(r)
        h_px, w_px = r.max() - r.min() + 1, c.max() - c.min() + 1
        w, h = w_px * m, h_px * m
        fill = n / (h_px * w_px)
        if not (.12 <= w <= 3.2 and .12 <= h <= 1.6 and n * m * m >= .02 and fill >= .62):
            continue
        u, v = (c.min() + c.max() + 1) / 2, (r.min() + r.max() + 1) / 2
        a = (u - SIZE[0] / 2) * m          # image right
        y = target[1] - (v - SIZE[1] / 2) * m
        kind = 'port' if .7 < w / h < 1.4 and fill < .86 and w < .8 else 'window'
        if view == 'front':
            # Looking aft (+z) with up +y, image right is +x (starboard).
            rows.append(['front', kind, round(a, 3), round(y, 3), round(w, 3), round(h, 3)])
        else:
            # Looking inboard (-x) from starboard with up +y, image right is -z (the bow).
            rows.append(['side', kind, round(target[2] - a, 3), round(y, 3), round(w, 3), round(h, 3)])
# The depth of the wall each opening is painted on, from the towers' thin-wall plan cuts (measure-plan.ts --thin; the
# glazed fronts are thin shells): the foremost wall a front window's vertical line meets, or the outermost wall a side
# window's meets, in the cuts through the opening's height and 15 cm over and under it (a band of real openings
# leaves only mullions in the cuts through it, so the sill and head find the wall).
levels = json.loads((ROOT / '.build/ise/thin-cuts.json').read_text())['levels']


def crossings(ring, along, value):
    """Where the line (x = value for along 0, z = value for along 1) crosses a closed outline: the other coordinate."""
    out = []
    for a, b in zip(ring, ring[1:] + ring[:1]):
        if (a[along] - value) * (b[along] - value) < 0:
            t = (value - a[along]) / (b[along] - a[along])
            out.append(a[1 - along] + (b[1 - along] - a[1 - along]) * t)
    return out


kept = []
for row in rows:
    view, kind, across, y, w, h = row
    hits = [v for level in levels if abs(level['y'] - y) <= h / 2 + .15
            for p in level['polygons'] for v in crossings(p['ring'], 0 if view == 'front' else 1, across)]
    if hits:
        kept.append(row + [round(min(hits) if view == 'front' else max(hits), 3)])
rows = kept
# Front views see both sides of the centreline; side views are the starboard side, mirrored to port by the recipe.
text = ',\n'.join('    ' + json.dumps(r) for r in rows)
(HERE / 'ise_windows.py').write_text(
    '"""Windows and portholes painted on the reference\'s pagoda and after tower, written by measure-windows.py:\n'
    '[view, kind, across, y, width, height, wall] in reference metres; across is x for front views (looking aft)\n'
    'and z for starboard side views (mirrored to port by the recipe); wall is the reference wall\'s z (front) or x\n'
    '(side) at that opening."""\n'
    f'ROWS = [\n{text}\n]\n')
print(len(rows), 'openings')
