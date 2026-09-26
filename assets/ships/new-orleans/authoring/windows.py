"""New Orleans bridge glazing: the windows and portholes the reference paints on its bridge, and the wall each is on.

  bun run ship:reference pasc107 --hull B_Hull --name pasc107-b --render --eye 200,15,-26 --target 0,15,-26 --ortho 30 --out .build/new-orleans/renders/win-side
  bun run ship:reference pasc107 --hull B_Hull --name pasc107-b --render --eye 0,15,-200 --target 0,15,-26 --ortho 24 --out .build/new-orleans/renders/win-front
  python windows.py > ../new_orleans_windows_data.py       (from this directory; needs numpy, scipy and Pillow)

Dark, low-saturation blobs 0.2 to 1.6 m across in the orthographic textured renders are the painted openings:
round ones portholes, filled rectangles windows. Each is located in the reference frame from its render's camera,
and its wall's depth is the median first hit of view rays cast at nine points inside it against the reference
mesh round the bridge (rays that disagree by more than 0.3 m drop the row). Measured offsets only.
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
REF = ROOT / '.build/references/pasc107-b'
RENDERS = ROOT / '.build/new-orleans/renders'


def detect(path, ortho, cu, cv, flip_u, region):
    """Blobs as (kind, u0, u1, v0, v1): u along the image's right axis (sign-flipped when flip_u), v up."""
    im = np.asarray(Image.open(path).convert('RGB')).astype(float)
    h, w, _ = im.shape
    ppm = w / ortho
    lum = im.mean(2)
    sat = im.max(2) - im.min(2)
    dark = (lum < 95) & (sat < 45)
    dark = ndimage.binary_opening(dark, structure=np.ones((4, 4)))
    lab, n = ndimage.label(dark)
    out = []
    for k, sl in enumerate(ndimage.find_objects(lab), 1):
        ys, xs = sl
        hh, ww = ys.stop - ys.start, xs.stop - xs.start
        area = (lab[sl] == k).sum()
        fill = area / (hh * ww)
        if min(hh, ww) < .18 * ppm or max(hh, ww) > 1.6 * ppm:
            continue
        a = (xs.start - w / 2) / ppm
        b = (xs.stop - w / 2) / ppm
        v1 = cv + (h / 2 - ys.start) / ppm
        v0 = cv + (h / 2 - ys.stop) / ppm
        u0, u1 = (cu - b, cu - a) if flip_u else (cu + a, cu + b)
        # Portholes read as round or, on a canted face, oval.
        roundish = .45 < ww / hh < 2.2 and .55 < fill < .92
        kind = 'porthole' if roundish and max(hh, ww) < .6 * ppm else 'window' if fill > .78 and min(hh, ww) > .3 * ppm else None
        if kind is None:
            continue
        uc, vc = (u0 + u1) / 2, (v0 + v1) / 2
        if not (region[0] <= uc <= region[1] and region[2] <= vc <= region[3]):
            continue
        out.append([kind, round(u0, 3), round(u1, 3), round(v0, 3), round(v1, 3)])
    return out


meta = json.loads((REF / 'reference.json').read_text())
raw = (REF / 'mesh.bin').read_bytes()
_, _, nv, ni = struct.unpack('<4I', raw[:16])
pos = np.frombuffer(raw, dtype='<f4', count=nv * 3, offset=16).reshape(-1, 3).astype(np.float64)
idx = np.frombuffer(raw, dtype='<u4', count=ni, offset=16 + nv * 12).reshape(-1, 3)
tris = pos[idx]
is_hull = np.zeros(len(idx), bool)
for part in meta['parts']:
    if part['group'] == 'hull':
        is_hull[part['first']:part['first'] + part['count']] = True
lo, hi = np.array([-12, 5, -40]), np.array([12, 26, -12])
keep = ((tris.max(1) >= lo) & (tris.min(1) <= hi)).all(1)
tris, is_hull = tris[keep], is_hull[keep]
v0, e1, e2 = tris[:, 0], tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]
nrm = np.cross(e1, e2)
nlen = np.linalg.norm(nrm, axis=1)
nrm = nrm / np.maximum(nlen, 1e-12)[:, None]


def first_wall(o, d):
    p = np.cross(d, e2)
    det = (e1 * p).sum(1)
    ok = np.abs(det) > 1e-12
    inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
    s = o - v0
    u = (s * p).sum(1) * inv
    q = np.cross(s, e1)
    v = (q * d).sum(1) * inv
    t = (e2 * q).sum(1) * inv
    hit = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0) & (nlen > 1e-6)
    if not hit.any():
        return None
    # The first thing the ray meets must be a wall of the ship itself facing it, not a gun, lamp or fitting.
    k = np.flatnonzero(hit)[np.argmin(t[hit])]
    return float(t[k]) if is_hull[k] and abs(nrm[k] @ d) > .3 else None


def depth(point, d):
    ts = [t for t in (first_wall(point(fu, fv), d) for fu in (.25, .5, .75) for fv in (.25, .5, .75)) if t is not None]
    if len(ts) < 5:
        return None, None
    ts = np.array(ts)
    med = float(np.median(ts))
    return med, float(np.percentile(np.abs(ts - med), 75))


# Side view from starboard: image right is -z (bow), so u = -z; front view from ahead: image right is -x (port).
side_raw = detect(RENDERS / 'win-side/camera.png', 30, 0.0, 15, False, (-15, 15, 6, 24))
front_raw = detect(RENDERS / 'win-front/camera.png', 24, 0.0, 15, False, (-12, 12, 10, 24))  # below 10 m the turrets stand in front
# Searchlight lenses and lamps are fittings, not openings (am037/am038 positions, reference frame).
LAMPS = [(1.71, 14.04, -7.06), (-1.73, 14.04, -4.54), (0, 15.44, -33.1), (-4.12, 13.9, -19.18), (4.12, 13.9, -19.18)]
side, front, dropped = [], [], 0
X0 = 60.0
for kind, u0, u1, y0, y1 in side_raw:
    z0, z1 = -26.0 - u1, -26.0 - u0
    if not -40 <= (z0 + z1) / 2 <= -12:
        continue
    t, spread = depth(lambda fu, fv: np.array([X0, y0 + (y1 - y0) * fv, z0 + (z1 - z0) * fu]), np.array([-1.0, 0, 0]))
    if t is None or spread > .3:
        dropped += 1
        continue
    zc, yc = (z0 + z1) / 2, (y0 + y1) / 2
    if any(abs(zc - lz) < .9 and abs(yc - ly) < .9 and abs(X0 - t - abs(lx)) < 1.2 for lx, ly, lz in LAMPS):
        continue
    side.append((kind, round(z0, 3), round(z1, 3), y0, y1, round(X0 - t, 3)))
Z0 = -120.0
for kind, u0, u1, y0, y1 in front_raw:
    x0, x1 = -u1, -u0
    t, spread = depth(lambda fu, fv: np.array([x0 + (x1 - x0) * fu, y0 + (y1 - y0) * fv, Z0]), np.array([0, 0, 1.0]))
    if t is None or spread > .3:
        dropped += 1
        continue
    xc, yc = (x0 + x1) / 2, (y0 + y1) / 2
    if any(abs(xc - lx) < .9 and abs(yc - ly) < .9 and abs(Z0 + t - lz) < 1.2 for lx, ly, lz in LAMPS):
        continue
    front.append((kind, x0, x1, y0, y1, round(Z0 + t, 3)))
print('"""Windows and portholes the reference paints on its bridge, read off orthographic renders of the approved')
print('GameModels3D pasc107 B_Hull textures with the wall each lies on (reference frame: x starboard, y up, z toward the')
print('stern, metres), written by authoring/windows.py. No reference geometry or texture is loaded by the recipe."""')
print()
print('# (kind, z0, z1, y0, y1, starboard wall x): seen from starboard, mirrored to port.')
print('SIDE = [\n' + ''.join(f'    {r!r},\n' for r in side) + ']')
print('# (kind, x0, x1, y0, y1, wall z): seen from ahead.')
print('FRONT = [\n' + ''.join(f'    {r!r},\n' for r in front) + ']')
print(f'{len(side)} side, {len(front)} front, {dropped} dropped', file=sys.stderr)
