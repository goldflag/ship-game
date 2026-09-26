"""Synchronize the Hyūga twin's catalog entry and armoured shell from this recipe (plain Python).

  python3 assets/parts/ijn-hyuga-356/sync_shape.py

Writes `type41-356-hyuga-twin` into assets/parts/guns.json after the Kongō 1942 twin, keeping the Type 41
gun's ballistics from that entry, with this recipe's gunhouse mesh and the Ise-class mount datums measured
from the approved GameModels3D pjsb517 jgm191 visual.
"""
import copy
import json
import sys
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
# geometry.py imports Blender modules for its builder; the shell itself is plain geometry.
for name in ('bpy', 'blender_components', 'blender_barrels'):
    stub = types.ModuleType(name)
    stub.create_gun_mount = None
    stub.barrel_layout = None
    sys.modules.setdefault(name, stub)
sys.path.insert(0, str(HERE))
from geometry import gunhouse_shape  # noqa: E402

path = ROOT / 'assets/parts/guns.json'
catalog = json.loads(path.read_text())
ids = [p['id'] for p in catalog['parts']]
kongo = catalog['parts'][ids.index('type41-356-kongo-1942-twin')]
part = copy.deepcopy(kongo)
for key in ('rangefinderWidth', 'rangefinderForward'):
    part.pop(key, None)
part.update({
    'id': 'type41-356-hyuga-twin',
    'name': '356 mm/45 Type 41 Ise-class twin',
    'barbetteRadius': 4.7,
    'gunhouseSize': [12.8, 9.1, 2.64],
    'gunhouseBaseHeight': 0.01,
    'pivotHeight': 0.84,
    'trunnionForward': 2.6,
    'muzzleForward': 14.16,
    'barrelSpacing': 2.25,
    'armorMm': 305,
    'gunhouseMesh': gunhouse_shape(),
})
if 'type41-356-hyuga-twin' in ids:
    catalog['parts'][ids.index('type41-356-hyuga-twin')] = part
else:
    catalog['parts'].insert(ids.index('type41-356-kongo-1942-twin') + 1, part)
path.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + '\n')
print('Synchronized type41-356-hyuga-twin:', len(part['gunhouseMesh']['vertices']), 'vertices,', len(part['gunhouseMesh']['faces']), 'faces')
