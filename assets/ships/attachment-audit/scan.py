"""Read-only broad-phase inspection of original Blender object connectivity.

Run with local Blender --background --python scan.py -- <ship-id> ... .
Bounding-box connectivity is deliberately only a candidate finder: overlapping
boxes cannot certify physical attachment. Reports preserve object names before
export batching, making floating details traceable to their original recipes.
"""
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]
TOLERANCE = .025


def scan(ship):
    source = ROOT / 'assets/ships' / ship / 'generated/source.blend'
    bpy.ops.wm.open_mainfile(filepath=str(source))
    objects = []
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH' or obj.get('exportRole') == 'simulation':
            continue
        if any('Studio' in c.name or 'Measurement' in c.name for c in obj.users_collection):
            continue
        corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
        low = [min(c[i] for c in corners) for i in range(3)]
        high = [max(c[i] for c in corners) for i in range(3)]
        objects.append(dict(name=obj.name, assembly=obj.get('assemblyId'), node=obj.get('nodeId'), low=low, high=high))
    parents = list(range(len(objects)))

    def root(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i

    def gap(a, b):
        return sum(max(0, a['low'][j]-b['high'][j], b['low'][j]-a['high'][j])**2 for j in range(3))**.5

    ordered = sorted(range(len(objects)), key=lambda i: objects[i]['low'][0])
    active = []
    for i in ordered:
        a = objects[i]
        active = [j for j in active if objects[j]['high'][0] + TOLERANCE >= a['low'][0]]
        for j in active:
            if gap(a, objects[j]) <= TOLERANCE:
                parents[root(i)] = root(j)
        active.append(i)
    groups = {}
    for i in range(len(objects)):
        groups.setdefault(root(i), []).append(i)
    hull = next(i for i, a in enumerate(objects) if a['node'] == 'hull.surface')
    connected = groups[root(hull)]
    islands = []
    for key, members in groups.items():
        if key == root(hull):
            continue
        distance, a, b = min((gap(objects[i], objects[j]), i, j) for i in members for j in connected)
        islands.append(dict(objects=[objects[i] for i in members], minimumBoxGap=distance,
                            closestObject=objects[a]['name'], closestHullConnectedObject=objects[b]['name']))
    islands.sort(key=lambda g: -g['minimumBoxGap'])
    report = dict(ship=ship, source=str(source.relative_to(ROOT)), toleranceM=TOLERANCE,
                  method='object AABB candidate graph; overlaps do not prove attachment',
                  meshCount=len(objects), hullConnectedMeshCount=len(connected), islands=islands)
    out = Path(__file__).parent / 'reports' / 'before'
    out.mkdir(parents=True, exist_ok=True)
    (out / (ship + '.json')).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(dict(ship=ship, meshes=len(objects), islands=len(islands),
                         largest=[dict(gap=round(g['minimumBoxGap'],3),names=[o['name'] for o in g['objects']][:10]) for g in islands[:15]])), flush=True)


for ship_id in sys.argv[sys.argv.index('--')+1:]:
    scan(ship_id)
