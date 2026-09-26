"""Swept envelopes of the light and secondary gun parts, for `walls.py` to give way to.

  blender -b assets/ships/new-orleans/generated/source.blend --python assets/ships/new-orleans/authoring/mount_envelope.py

For the first mount of each non-main part in the built model, every mesh under its yaw node except the barrels is
swept through the part's elevation range (elevating parts turned about their trunnion, 13 steps); the largest distance
from the training axis is kept per 5 cm band of height above the mount's deck. Writes `mount-envelopes.json`
({partId: [[height, radius], ...]}) beside this script. Barrels are left to the installation interlocks.
"""
import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
b = json.loads((HERE.parent / 'blueprint.json').read_text())
catalog = {p['id']: p for p in json.loads((HERE.parents[3] / 'assets/parts/guns.json').read_text())['parts']}


def descendants(ob):
    for c in ob.children:
        yield c
        yield from descendants(c)


envelopes = {}
for m in b['mounts']:
    if m['battery'] == 'main' or m['partId'] in envelopes:
        continue
    w = catalog[m['partId']]
    mx, my, mz = m['position']
    yaw = bpy.data.objects[m['id'] + '.yaw']
    owner = {}
    for pn in [o for o in descendants(yaw) if o.type == 'EMPTY' and o.name.endswith('.elevation')]:
        for o in descendants(pn):
            owner[o.name] = pn
    steps = [w['elevationMinDeg'] + (w['elevationMaxDeg'] - w['elevationMinDeg']) * k / 12 for k in range(13)]
    bands = {}
    for ob in descendants(yaw):
        if ob.type != 'MESH' or any(k in ob.name for k in ('barrel', 'bore', 'muzzle', 'flash')):
            continue
        verts = [ob.matrix_world @ v.co for v in ob.data.vertices]
        rots = [Matrix()]
        if ob.name in owner:
            pn = owner[ob.name]
            pivot = pn.matrix_world.translation.copy()
            muzzle = [o for o in descendants(pn) if o.type == 'EMPTY' and o.name.endswith('.muzzle')]
            d = muzzle[0].matrix_world.translation - pivot if muzzle else Vector((1, 0, 0))
            d.z = 0
            d.normalize()
            axis = d.cross(Vector((0, 0, 1))).normalized()
            sign = -1 if (Matrix.Rotation(-math.radians(30), 4, axis) @ d).z > 0 else 1
            rots = [Matrix.Translation(pivot) @ Matrix.Rotation(sign * math.radians(e), 4, axis) @ Matrix.Translation(-pivot) for e in steps]
        for rot in rots:
            for v in verts:
                p = rot @ v
                x, y, z = -p.y, p.z, -p.x  # authoring (+X bow, +Y port, +Z up) to runtime
                k = round((y - my) / .05)
                bands[k] = max(bands.get(k, 0), math.hypot(x - mx, z - mz))
    envelopes[m['partId']] = [[round(k * .05, 2), round(r, 3)] for k, r in sorted(bands.items())]
    print(m['id'], m['partId'], 'largest reach', max(r for _, r in envelopes[m['partId']]))
(HERE / 'mount-envelopes.json').write_text(json.dumps(envelopes) + '\n')
