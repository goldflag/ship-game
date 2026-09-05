"""Reference acquisition only. Raw game geometry never enters ship:build inputs."""
import argparse, concurrent.futures, gzip, hashlib, json, re, ssl, urllib.request
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
CTX = ssl.create_default_context(cafile='/etc/ssl/cert.pem') if Path('/etc/ssl/cert.pem').exists() else ssl.create_default_context()

def download(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'ShipReferenceStudy/1.0'})
    with urllib.request.urlopen(req, context=CTX, timeout=60) as response:
        return response.read()

def visuals(obj):
    if isinstance(obj, dict):
        if isinstance(obj.get('visual'), str): yield obj['visual']
        for value in obj.values(): yield from visuals(value)
    elif isinstance(obj, list):
        for value in obj: yield from visuals(value)

def acquire(ship, vehicle):
    cache = ROOT / '.build/reference-cache' / ship
    cache.mkdir(parents=True, exist_ok=True)
    url = f'https://gamemodels3d.com/en/games/worldofwarships/vehicles/{vehicle}'
    page = download(url)
    text = page.decode('utf8')
    metadata = json.JSONDecoder().raw_decode(text.split('var _vehicle = ', 1)[1])[0]
    if metadata['index'] != vehicle: raise ValueError('Vehicle identifier mismatch')
    scheme = json.JSONDecoder().raw_decode(text.split('scheme : ', 1)[1])[0]['visual']['default']
    (cache/'scheme.json').write_text(json.dumps(scheme))
    (cache/'page.html').write_bytes(page)
    index = download('https://gamemodels3d.com/games/worldofwarships/').decode()
    version = re.search(r'active_server[^>]*>World of Warships<br>EU ([\d.]+)', index)
    if not version: raise ValueError('Cannot identify current EU source version')
    base = 'https://gamemodels3d.com/games/worldofwarships/data/current/'
    def fetch(path):
        dest = cache/'models'/Path(path+'.model')
        dest.parent.mkdir(parents=True, exist_ok=True)
        data = dest.read_bytes() if dest.exists() else download(base+path+'.model')
        decoded = gzip.decompress(data)
        if not decoded.strip():
            return {'path':path, 'url':base+path+'.model', 'omitted':'Server returned an empty reference component', 'sha256':hashlib.sha256(data).hexdigest(), 'bytes':len(data)}
        model = json.loads(decoded)
        if model.get('version') != 4 or 'geometry' not in model: raise ValueError('Unsupported reference format')
        dest.write_bytes(data)
        return {'path':path, 'url':base+path+'.model', 'sha256':hashlib.sha256(data).hexdigest(), 'bytes':len(data), 'formatVersion':model['version']}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        files = list(pool.map(fetch, sorted(set(visuals(scheme)))))
    manifest = {'schemaVersion':1, 'sourceId':'gm-'+vehicle, 'vehicle':vehicle, 'name':metadata['name'], 'gameVersion':'EU '+version[1], 'sourceUrl':url, 'accessedAt':datetime.now(timezone.utc).isoformat(), 'pageSha256':hashlib.sha256(page).hexdigest(), 'schemeSha256':hashlib.sha256((cache/'scheme.json').read_bytes()).hexdigest(), 'files':files, 'use':'Isolated reference rendering only. Never a production geometry input.', 'sourceUnits':'WoWS viewer units; The per-vessel capture plan specifies a single global comparison registration. Source metre scale and load datum are unverified; raw proportions are preserved.'}
    (cache/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(f"Cached {len(files)} reference components ({sum(f['bytes'] for f in files):,} bytes); {manifest['gameVersion']}")

if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('ship');parser.add_argument('--vehicle',required=True)
    a=parser.parse_args()
    if not re.fullmatch('[a-z][a-z0-9-]{0,63}',a.ship) or not re.fullmatch('[a-z0-9]+',a.vehicle):parser.error('Invalid ID')
    acquire(a.ship,a.vehicle)
