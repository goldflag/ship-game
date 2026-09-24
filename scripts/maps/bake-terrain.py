"""Bake a battle map's real-world terrain into the game's heightfield format.

    python3 scripts/maps/bake-terrain.py <map-id> [<map-id> ...]   # or --all

Reads the chart recipe `assets/maps/charts/<id>.json`, downloads AWS Terrain Tiles
(Terrarium encoding) into the ignored `.build/maps/dem-cache/`, projects them onto the
game's local frame and writes `public/maps/terrain/<id>.ntf`. A shaded-relief preview with
the deployment corridor and a JSON report go to `.build/maps/`.

The frame: x east of the chart's centre, z toward the chart's bottom, metres. The recipe's
`bearing` is the true bearing of the chart's top (-z), so 0 keeps north up. The centre is
the midpoint between the two fleets' default spawn lines.

Terrain Tiles data sources and their attribution are listed in assets/maps/terrain-notes.md.
Requires Python 3 with numpy and Pillow, and curl on PATH.
"""
from __future__ import annotations

import json
import math
import pathlib
import struct
import subprocess
import sys
import zlib

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
CHARTS = ROOT / 'assets/maps/charts'
OUTPUT = ROOT / 'public/maps/terrain'
BUILD = ROOT / '.build/maps'
CACHE = BUILD / 'dem-cache/terrarium'
EARTH_RADIUS = 6371008.8
TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
MAGIC = b'NTF1'
HEIGHT_STEP = 0.25  # metres per stored quantum
LAND_MIN = 1.0      # every land sample stands at least this far above the sea
SEA_MAX = -2.0      # every sea sample lies at least this deep
SHELF_DEPTH = 160.0


def tile(z: int, x: int, y: int) -> np.ndarray:
    path = CACHE / str(z) / str(x) / f'{y}.png'
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        url = TILE_URL.format(z=z, x=x, y=y)
        partial = path.with_suffix('.part')
        result = subprocess.run(['curl', '-sfL', '--retry', '4', '-o', str(partial), url])
        if result.returncode:
            raise RuntimeError(f'download failed: {url}')
        partial.rename(path)
    rgb = np.asarray(Image.open(path).convert('RGB')).astype(np.float64)
    return rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768


def geographic(recipe: dict, east: np.ndarray, north: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Inverse azimuthal equidistant projection about the chart centre (spherical earth)."""
    lat0 = math.radians(recipe['center']['lat'])
    lon0 = math.radians(recipe['center']['lon'])
    rho = np.hypot(east, north)
    c = rho / EARTH_RADIUS
    azimuth = np.arctan2(east, north)
    lat = np.arcsin(np.sin(lat0) * np.cos(c) + np.cos(lat0) * np.sin(c) * np.cos(azimuth))
    lon = lon0 + np.arctan2(np.sin(azimuth) * np.sin(c) * np.cos(lat0), np.cos(c) - np.sin(lat0) * np.sin(lat))
    return np.degrees(lat), np.degrees(lon)


def mercator_pixels(lat: np.ndarray, lon: np.ndarray, zoom: int) -> tuple[np.ndarray, np.ndarray]:
    scale = 2 ** zoom * 256
    phi = np.radians(lat)
    return (lon + 180) / 360 * scale, (1 - np.log(np.tan(phi) + 1 / np.cos(phi)) / math.pi) / 2 * scale


def sample_dem(lat: np.ndarray, lon: np.ndarray, zoom: int) -> np.ndarray:
    px, py = mercator_pixels(lat, lon, zoom)
    # Pixel centres sit at +0.5.
    px -= 0.5
    py -= 0.5
    x0, x1 = int(np.floor(px.min())) // 256, int(np.floor(px.max()) + 1) // 256
    y0, y1 = int(np.floor(py.min())) // 256, int(np.floor(py.max()) + 1) // 256
    mosaic = np.empty(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256))
    total = (x1 - x0 + 1) * (y1 - y0 + 1)
    for n, (ty, tx) in enumerate((ty, tx) for ty in range(y0, y1 + 1) for tx in range(x0, x1 + 1)):
        mosaic[(ty - y0) * 256:(ty - y0 + 1) * 256, (tx - x0) * 256:(tx - x0 + 1) * 256] = tile(zoom, tx, ty)
        if n % 50 == 0:
            print(f'  tiles {n + 1}/{total}', flush=True)
    fx, fy = px - x0 * 256, py - y0 * 256
    ix = np.clip(np.floor(fx).astype(np.int64), 0, mosaic.shape[1] - 2)
    iy = np.clip(np.floor(fy).astype(np.int64), 0, mosaic.shape[0] - 2)
    u, v = np.clip(fx - ix, 0, 1), np.clip(fy - iy, 0, 1)
    return (mosaic[iy, ix] * (1 - u) * (1 - v) + mosaic[iy, ix + 1] * u * (1 - v)
            + mosaic[iy + 1, ix] * (1 - u) * v + mosaic[iy + 1, ix + 1] * u * v)


def edt(mask: np.ndarray, reach: int = 120) -> np.ndarray:
    """Euclidean distance (in cells) from every cell to the nearest True cell, exact up to
    `reach` cells and capped beyond it."""
    rows, n = mask.shape
    index = np.arange(n, dtype=np.float64)
    far = float(4 * (n + rows))
    left = np.maximum.accumulate(np.where(mask, index, -far), axis=1)
    right = np.minimum.accumulate(np.where(mask, index, far)[:, ::-1], axis=1)[:, ::-1]
    row = np.minimum(index - left, right - index)
    squared = row * row
    best = squared.copy()
    cap = float(reach * reach)
    for offset in range(1, reach + 1):
        shifted = squared[offset:] + offset * offset
        np.minimum(best[:-offset], shifted, out=best[:-offset])
        shifted = squared[:-offset] + offset * offset
        np.minimum(best[offset:], shifted, out=best[offset:])
    return np.sqrt(np.minimum(best, cap))


def components(mask: np.ndarray) -> tuple[np.ndarray, int]:
    """4-connected labels of a boolean grid, by union-find over horizontal runs."""
    parent: list[int] = []

    def find(a: int) -> int:
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    runs: list[tuple[int, int, int, int]] = []  # row, start, end (exclusive), run id
    previous: list[tuple[int, int, int]] = []
    for j in range(mask.shape[0]):
        padded = np.concatenate([[False], mask[j], [False]]).astype(np.int8)
        edges = np.flatnonzero(np.diff(padded))
        current = []
        k = 0
        for start, end in zip(edges[::2].tolist(), edges[1::2].tolist()):
            run = len(parent)
            parent.append(run)
            while k < len(previous) and previous[k][1] <= start:
                k += 1
            m = k
            while m < len(previous) and previous[m][0] < end:
                a, b = find(run), find(previous[m][2])
                if a != b:
                    parent[max(a, b)] = min(a, b)
                m += 1
            current.append((start, end, run))
            runs.append((j, start, end, run))
        previous = current
    roots: dict[int, int] = {}
    labels = np.zeros(mask.shape, dtype=np.int32)
    for j, start, end, run in runs:
        root = find(run)
        labels[j, start:end] = roots.setdefault(root, len(roots) + 1)
    return labels, len(roots)


def encode(quanta: np.ndarray) -> bytes:
    """NTF1 planar prediction: each sample stores q - (left + up - up_left), zeros outside the grid."""
    q = quanta.astype(np.int32)
    left = np.zeros_like(q)
    left[:, 1:] = q[:, :-1]
    up = np.zeros_like(q)
    up[1:] = q[:-1]
    up_left = np.zeros_like(q)
    up_left[1:, 1:] = q[:-1, :-1]
    residual = q - (left + up - up_left)
    if residual.min() < -32768 or residual.max() > 32767:
        raise ValueError('terrain residual exceeds 16 bits')
    return residual.astype('<i2').tobytes()


def despike(h: np.ndarray, passes: int = 2) -> tuple[np.ndarray, int]:
    """Replace survey spikes (radar voids and blunders standing hundreds of metres over their surroundings) with the
    local median. A sample is a spike when it stands above the median of its 9 x 9 neighbourhood by more than 60 m plus
    the neighbourhood's own spread (its 80th less its 20th percentile): a real summit or cliff has a steep, wide spread
    around it, a spike stands over flat ground. Small clusters (under a tenth of the window) are caught too."""
    h = h.astype(np.float32).copy()
    reach, total = 4, 0
    for _ in range(passes):
        padded = np.pad(h, reach, mode='edge')
        replaced = h.copy()
        for top in range(0, h.shape[0], 192):
            rows = min(192, h.shape[0] - top)
            window = np.stack([padded[top + reach + dz:top + reach + dz + rows, reach + dx:reach + dx + h.shape[1]]
                               for dz in range(-reach, reach + 1) for dx in range(-reach, reach + 1)])
            low, median, high = np.partition(window, [16, 40, 64], axis=0)[[16, 40, 64]]
            spike = h[top:top + rows] - median > 60 + (high - low)
            replaced[top:top + rows][spike] = median[spike]
            total += int(spike.sum())
        h = replaced
    return h, total


def smoothstep(a: float, b: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def bake(map_id: str) -> dict:
    recipe = json.loads((CHARTS / f'{map_id}.json').read_text())
    cell = float(recipe['cellM'])
    width_m, depth_m = (float(v) * 1000 for v in recipe['sizeKm'])
    nx, nz = int(round(width_m / cell)) + 1, int(round(depth_m / cell)) + 1
    origin_x, origin_z = -(nx - 1) * cell / 2, -(nz - 1) * cell / 2
    xs = origin_x + np.arange(nx) * cell
    zs = origin_z + np.arange(nz) * cell
    bearing = math.radians(recipe.get('bearing', 0))
    supersample = int(recipe.get('supersample', 2))
    print(f'{map_id}: {nx} x {nz} samples at {cell:g} m, zoom {recipe["zoom"]}, {supersample}x{supersample} supersampling', flush=True)
    heights = np.zeros((nz, nx))
    offsets = (np.arange(supersample) + 0.5) / supersample - 0.5
    for oz in offsets:
        for ox in offsets:
            X, Z = np.meshgrid(xs + ox * cell, zs + oz * cell)
            # The chart's top (-z) points along the bearing; +x is a quarter turn clockwise of it.
            east = X * math.cos(bearing) - Z * math.sin(bearing)
            north = -X * math.sin(bearing) - Z * math.cos(bearing)
            lat, lon = geographic(recipe, east, north)
            heights += sample_dem(lat, lon, int(recipe['zoom']))
    heights /= supersample * supersample
    heights, spikes = despike(heights)
    print(f'  {spikes} spike samples replaced', flush=True)

    land = heights > float(recipe.get('landThresholdM', 0.5))
    # Drop DEM specks (surf, moored ships, radar noise) smaller than a few cells.
    labels, count = components(land)
    sizes = np.bincount(labels.ravel(), minlength=count + 1)
    speck = int(recipe.get('minIslandCells', 3))
    land &= sizes[labels] >= speck
    # Water that cannot reach the open sea is low land the DEM flattened (polders behind dikes,
    # paddies, river flats): ships could never sail there, so it becomes coastal lowland.
    water, count = components(~land)
    fill = np.ones(count + 1, dtype=bool)
    fill[0] = False
    fill[np.unique(np.concatenate([water[0], water[-1], water[:, 0], water[:, -1]]))] = False
    land |= fill[water]

    distance = edt(land) * cell
    seabed = -np.minimum(SHELF_DEPTH, 2.5 + distance * float(recipe.get('shelfSlope', 0.12)))
    terrain = np.where(land, np.maximum(heights, LAND_MIN), np.minimum(seabed, SEA_MAX))

    # The world ends in open sea: land within the outer band settles below the surface.
    band = float(recipe.get('edgeFalloffKm', 6)) * 1000
    Xg, Zg = np.meshgrid(xs, zs)
    to_edge = np.minimum.reduce([Xg - xs[0], xs[-1] - Xg, Zg - zs[0], zs[-1] - Zg])
    keep = smoothstep(0, band, to_edge)
    terrain = terrain * keep + (-60.0) * (1 - keep)

    quanta = np.clip(np.round(terrain / HEIGHT_STEP), -32768, 32767).astype(np.int16)
    # A coastline needs a clear sign change: nothing rounds onto the waterline.
    quanta[(quanta == 0) & (terrain > 0)] = 1
    quanta[(quanta == 0) & (terrain <= 0)] = -1
    payload = zlib.compress(encode(quanta), 9)
    header = MAGIC + struct.pack('<IIffffII', nx, nz, cell, origin_x, origin_z, HEIGHT_STEP, 0, len(payload))
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / f'{map_id}.ntf').write_bytes(header + payload)

    stored = quanta.astype(np.float64) * HEIGHT_STEP
    report = inspect(map_id, recipe, stored, xs, zs, cell)
    report['bytes'] = len(header) + len(payload)
    BUILD.mkdir(parents=True, exist_ok=True)
    (BUILD / f'{map_id}-report.json').write_text(json.dumps(report, indent=2) + '\n')
    preview(map_id, stored, xs, zs, cell, report)
    return report


def inspect(map_id: str, recipe: dict, h: np.ndarray, xs: np.ndarray, zs: np.ndarray, cell: float) -> dict:
    land = h > 0
    clearance = edt(land) * cell
    X, Z = np.meshgrid(xs, zs)

    def least(region: np.ndarray) -> float:
        return float(clearance[region].min()) if region.any() else float('inf')

    corridor = (np.abs(X) <= 3000) & (np.abs(Z) <= 11000)
    wide = (np.abs(X) <= 10000) & (np.abs(Z) <= 11000)
    circle = np.hypot(X, Z) <= 25000
    pve = (np.abs(X) <= 5000) & (np.abs(Z) >= 7000) & (np.abs(Z) <= 17000)
    return {
        'id': map_id,
        'grid': [len(xs), len(zs)],
        'cellM': cell,
        'landFraction': round(float(land.mean()), 3),
        'maxHeightM': round(float(h.max()), 1),
        'corridorClearanceM': round(least(corridor), 0),
        'wideBoxClearanceM': round(least(wide), 0),
        'wideBoxLandFraction': round(float(land[wide].mean()), 3),
        'pveCircleWaterFraction': round(float(1 - land[circle].mean()), 3),
        'pveBandsWaterFraction': round(float(1 - (clearance[pve] < 300).mean()), 3),
    }


def preview(map_id: str, h: np.ndarray, xs: np.ndarray, zs: np.ndarray, cell: float, report: dict) -> None:
    gz, gx = np.gradient(h, cell)
    light = np.clip(0.55 + (-gx * 0.6 + -gz * 0.6) / np.sqrt(1 + gx * gx + gz * gz), 0, 1)
    top = max(float(h.max()), 1.0)
    t = np.clip(h / top, 0, 1)[..., None]
    land_color = (np.array([96, 128, 82]) * (1 - t) + np.array([214, 204, 190]) * t)
    sea_t = np.clip(-h / SHELF_DEPTH, 0, 1)[..., None]
    sea_color = np.array([96, 150, 170]) * (1 - sea_t) + np.array([18, 38, 58]) * sea_t
    rgb = np.where((h > 0)[..., None], land_color * light[..., None], sea_color)
    image = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))
    from PIL import ImageDraw
    draw = ImageDraw.Draw(image)

    def pixel(x: float, z: float) -> tuple[float, float]:
        return (x - xs[0]) / cell, (z - zs[0]) / cell

    for box, colour in (((3000, 11000), (255, 220, 60)), ((10000, 11000), (255, 140, 40))):
        draw.rectangle([pixel(-box[0], -box[1]), pixel(box[0], box[1])], outline=colour, width=3)
    r = 25000 / cell
    cx, cz = pixel(0, 0)
    draw.ellipse([cx - r, cz - r, cx + r, cz + r], outline=(80, 200, 255), width=3)
    for d, colour in ((5000, (255, 255, 255)), (20000, (255, 80, 80))):
        for z in (d / 2, -d / 2):
            draw.line([pixel(-2600, z), pixel(2600, z)], fill=colour, width=4)
    grid = 10000
    for value in range(int(xs[0] // grid) * grid, int(xs[-1]) + 1, grid):
        draw.line([pixel(value, zs[0]), pixel(value, zs[-1])], fill=(255, 255, 255, 60), width=1)
    for value in range(int(zs[0] // grid) * grid, int(zs[-1]) + 1, grid):
        draw.line([pixel(xs[0], value), pixel(xs[-1], value)], fill=(255, 255, 255, 60), width=1)
    scale = 1400 / max(image.size)
    image = image.resize((round(image.size[0] * scale), round(image.size[1] * scale)), Image.LANCZOS)
    image.save(BUILD / f'{map_id}-preview.png')
    print(json.dumps(report), flush=True)


if __name__ == '__main__':
    ids = [p.stem for p in sorted(CHARTS.glob('*.json'))] if sys.argv[1:] == ['--all'] else sys.argv[1:]
    if not ids:
        sys.exit(__doc__)
    for map_id in ids:
        bake(map_id)
