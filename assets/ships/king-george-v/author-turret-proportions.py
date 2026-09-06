"""Apply revision 4 to the existing fitted blueprint without resetting internals.

The component recipe and this bounded refit are original authoring inputs.
Run this, then author-evidence.py and the shared ship:build/review commands.
"""
import json
import subprocess
import sys
from pathlib import Path

here = Path(__file__).resolve().parent
subprocess.run([sys.executable, str(here / 'author-blueprint.py'), '--catalog-only'], check=True)
b = json.loads((here / 'blueprint.json').read_text())
# The formerly short B gunhouse concealed an overlong tower forefoot. These
# two low platforms now leave space for the complete twin's rounded rear.
for s in b['structures']:
    if s['id'] not in ['tower-base', 'tower-middle']:
        continue
    s['footprint'] = [[x, max(z, -27.2)] for x, z in s['footprint']]
    xs = [p[0] for p in s['footprint']]
    zs = [p[1] for p in s['footprint']]
    o = next(o for o in b['obstructions'] if o['id'] == s['id'])
    o['center'] = [(min(xs)+max(xs))/2, s['baseY']+s['height']/2, (min(zs)+max(zs))/2]
    o['size'] = [max(xs)-min(xs)-.4, s['height'], max(zs)-min(zs)-.4]
for a in b['armor']:
    if not a['id'].startswith('main-b-barbette-'):
        continue
    vs = a['plate']['vertices']
    radius = max((x*x+(z+35)**2)**.5 for x, y, z in vs)
    a['plate']['vertices'] = [[x*4.9/radius, y, -35+(z+35)*4.9/radius] for x, y, z in vs]
    lo = [min(v[i] for v in a['plate']['vertices']) for i in range(3)]
    hi = [max(v[i] for v in a['plate']['vertices']) for i in range(3)]
    a['center'] = [(x+y)/2 for x, y in zip(lo, hi)]
    a['size'] = [max(.001, y-x) for x, y in zip(lo, hi)]
(here / 'blueprint.json').write_text(json.dumps(b, indent=2)+'\n')
print('Updated turret proportions, B barbette and two tower forefeet; fitted internal IDs retained.')
