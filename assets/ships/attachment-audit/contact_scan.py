"""Inspect physical mesh contact before export batching (local Blender).

BVH triangle intersections, containment in closed solids, and vertex-to-surface
proximity form a contact graph rooted at hull.surface. This detects details
inside the hull's bounding box but above its actual local deck. A small contact
tolerance accommodates painted overlays and export rounding, not missing beams.
Run: blender -b --python contact_scan.py -- before|after <ship> ...
"""
import hashlib
import json
import sys
import time
from collections import Counter
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[3]
TOL = .025


def inspect(ship, phase):
    started = time.monotonic()
    source = ROOT / 'assets/ships' / ship / 'generated/source.blend'
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    definition_path = ROOT / 'public/models' / f'{ship}.json'
    content_hash = json.loads(definition_path.read_text())['contentHash']
    bpy.ops.wm.open_mainfile(filepath=str(source))
    depsgraph = bpy.context.evaluated_depsgraph_get()
    rows, geometry = [], []
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH' or obj.get('exportRole') == 'simulation':
            continue
        if any('Studio' in c.name or 'Measurement' in c.name for c in obj.users_collection):
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        vertices = [obj.matrix_world @ v.co for v in mesh.vertices]
        faces = [tuple(p.vertices) for p in mesh.polygons]
        evaluated.to_mesh_clear()
        if not vertices or not faces:
            continue
        points = np.array(vertices)
        edges = Counter(tuple(sorted((a, b))) for face in faces for a, b in zip(face, face[1:]+face[:1]))
        closed = all(n == 2 for n in edges.values())
        rows.append(dict(name=obj.name, assembly=obj.get('assemblyId'), node=obj.get('nodeId'),
                         low=points.min(axis=0).tolist(), high=points.max(axis=0).tolist()))
        geometry.append((vertices, BVHTree.FromPolygons(vertices, faces), closed))
    low = np.array([r['low'] for r in rows]); high = np.array([r['high'] for r in rows])
    parents = list(range(len(rows)))

    def root(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]; i = parents[i]
        return i

    def inside(point, tree):
        direction = Vector((.811, .331, .483)).normalized()
        origin = point.copy(); count = 0
        for _ in range(128):
            hit, _, _, distance = tree.ray_cast(origin, direction)
            if hit is None:
                return count % 2 == 1
            if distance < TOL:
                return True
            count += 1; origin = hit + direction * .0001
        return False

    def touches(i, j):
        av, at, ac = geometry[i]; bv, bt, bc = geometry[j]
        if at.overlap(bt):
            return True
        # Test the smaller mesh first; every vertex is considered where needed.
        if len(av) > len(bv):
            av, at, ac, bv, bt, bc = bv, bt, bc, av, at, ac
        if bc and inside(av[0], bt):
            return True
        if ac and inside(bv[0], at):
            return True
        for vertices, tree in [(av, bt), (bv, at)]:
            # Restrict candidates to the other expanded box before nearest queries.
            other = j if tree is geometry[j][1] else i
            for v in vertices:
                if all(low[other,k]-TOL <= v[k] <= high[other,k]+TOL for k in range(3)):
                    nearest = tree.find_nearest(v, TOL)
                    if nearest[0] is not None:
                        return True
        return False

    # Union only proven mesh contacts; broad hull boxes are never evidence.
    order = np.argsort(low[:,0]); active = np.array([], dtype=int); candidates = 0; contacts = 0
    for idx, i in enumerate(order):
        active = active[high[active,0]+TOL >= low[i,0]]
        gaps = np.maximum(0, np.maximum(low[active]-high[i], low[i]-high[active]))
        for j in active[(gaps*gaps).sum(axis=1) <= TOL*TOL]:
            if root(i) == root(j):
                continue
            candidates += 1
            if touches(i, j):
                parents[root(i)] = root(j); contacts += 1
        active = np.append(active, i)
    groups = {}
    for i in range(len(rows)):
        groups.setdefault(root(i), []).append(i)
    hull = next(i for i,r in enumerate(rows) if r['node'] == 'hull.surface')
    connected = groups[root(hull)]
    islands = []
    for key, members in groups.items():
        if key == root(hull):
            continue
        minimum = (float('inf'), None, None)
        for i in members:
            gaps = np.maximum(0, np.maximum(low[connected]-high[i], low[i]-high[connected]))
            distances = np.linalg.norm(gaps, axis=1); index = distances.argmin()
            if distances[index] < minimum[0]:
                minimum = (float(distances[index]), i, connected[index])
        extent = high[members].max(axis=0)-low[members].min(axis=0)
        islands.append(dict(objects=[rows[i] for i in members], extent=extent.tolist(),
                            minimumBoxGap=minimum[0], closestHullConnectedObject=rows[minimum[2]]['name']))
    islands.sort(key=lambda g: (-max(g['extent']), -g['minimumBoxGap']))
    if hashlib.sha256(source.read_bytes()).hexdigest() != source_hash or json.loads(definition_path.read_text())['contentHash'] != content_hash:
        raise RuntimeError(f'{ship} was rebuilt during inspection; rerun against the published asset')
    report = dict(ship=ship, sourceSha256=source_hash,
                  contentHash=content_hash,
                  method='triangle intersection, closed-solid containment, vertex/surface proximity', toleranceM=TOL,
                  limits='Separate objects are graph nodes; a mesh containing disconnected islands needs additional review. Contacts do not establish historical accuracy.',
                  meshCount=len(rows), hullConnectedMeshCount=len(connected), candidates=candidates,
                  contacts=contacts, elapsedSeconds=time.monotonic()-started, islands=islands)
    out = Path(__file__).resolve().parents[3] / '.build/ships/attachment-audit' / phase
    out.mkdir(parents=True, exist_ok=True)
    (out / (ship + '-contact.json')).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(dict(ship=ship, meshes=len(rows), islands=len(islands), seconds=round(report['elapsedSeconds'],1),
                         largest=[dict(extent=g['extent'], names=[o['name'] for o in g['objects']][:5]) for g in islands[:12]])), flush=True)


phase, *ships = sys.argv[sys.argv.index('--')+1:]
assert phase in ('before', 'after')
for ship in ships:
    inspect(ship, phase)
