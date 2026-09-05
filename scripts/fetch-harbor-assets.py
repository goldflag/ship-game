"""Fetch the CC0 source assets used by the harbor. No runtime network dependency.

Run with Python 3, then export-harbor-assets.py with Blender to produce tree LODs.
Sources and authors are recorded in public/harbor/ASSETS.md.
"""
import concurrent.futures
import json
import hashlib
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('/tmp/bismarck-harbor-source')
OUTPUT = ROOT / 'public/harbor'
TEXTURES = {
    'ground': 'aerial_grass_rock',
    'meadow': 'leafy_grass',
    'rock': 'aerial_rocks_02',
    'brick': 'factory_brick',
    'concrete': 'concrete_floor_02',
    'apron': 'concrete_floor_worn_001',
    'cobbles': 'cobblestone_floor_04',
    'asphalt': 'asphalt_02',
    'slate': 'roof_slates_02',
}
MODELS = ['fir_tree_01', 'tree_small_02', 'rock_09', 'wooden_military_crate', 'barrel_03']


def download(url, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        subprocess.run(['curl', '-fL', '--silent', '--show-error', '--retry', '2', url, '-o', str(target)], check=True)


def metadata(asset):
    target = SOURCE / (asset + '.json')
    download('https://api.polyhaven.com/files/' + asset, target)
    return json.loads(target.read_text())


def texture(item):
    name, asset = item
    files = metadata(asset)
    for channel, source in [('color', 'Diffuse'), ('normal', 'nor_gl'), ('roughness', 'Rough')]:
        if source not in files:
            source = 'rough' if channel == 'roughness' else source
        if source not in files:
            continue
        info = files[source]['1k']['jpg']
        target=OUTPUT / f'{name}-{channel}.jpg'
        if target.exists() and hashlib.md5(target.read_bytes()).hexdigest()!=info['md5']:
            target.unlink()
        download(info['url'], target)
    print('Texture:', name, flush=True)


def model(asset):
    info = metadata(asset)['gltf']['1k']['gltf']
    folder = SOURCE / asset
    download(info['url'], folder / (asset + '.gltf'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda item: download(item[1]['url'], folder / item[0]), info['include'].items()))
    print('Model source:', asset, flush=True)


if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(texture, TEXTURES.items()))
        list(pool.map(model, MODELS))
