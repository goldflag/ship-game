"""Attachment audit for `bun run ship:floating` (acceptance check 1). Evidence, not a certificate.

blender --background --python floating_check.py -- --model <source.blend|model.glb> --out <floating.json>
    [--gap 0.06] [--ignore substring,...] [--leaf substring,...]

Every mesh must be joined to the hull through a chain of physical contacts: intersecting triangles,
surfaces within `--gap` metres, or a vertex embedded inside another closed part. The search starts at
the hull (`assemblyId` 'hull') and spreads through touching parts; whatever it never reaches floats,
alone or as a cluster that only touches itself. A part never counts as its own support. Leaf parts
(merged rail and wire meshes, rigging; `--leaf`) are attached when they touch a supported part but carry nothing:
a merged rail mesh that runs the length of the ship must not hold up whatever it brushes.
"""
import bpy
import json
import sys
import time
from collections import defaultdict
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]


def option(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


model = Path(option('--model'))
out = Path(option('--out'))
gap = float(option('--gap', .06))
ignore = [s.lower() for s in option('--ignore', '').split(',') if s]
leaf = [s.lower() for s in option('--leaf', 'wires,halyard,rigging').split(',') if s]
T0 = time.perf_counter()
if model.suffix == '.blend':
    bpy.ops.wm.open_mainfile(filepath=str(model))
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(model))
scene = bpy.context.scene
bpy.context.view_layer.update()
deps = bpy.context.evaluated_depsgraph_get()

parts = {}
for o in scene.objects:
    if o.type != 'MESH' or o.get('exportRole') == 'simulation' or o.hide_render:
        continue
    if any(s in o.name.lower() for s in ignore):
        continue
    e = o.evaluated_get(deps)
    data = e.to_mesh()
    data.calc_loop_triangles()
    if len(data.loop_triangles):
        m = o.matrix_world
        vertices = [m @ v.co for v in data.vertices]
        faces = [tuple(t.vertices) for t in data.loop_triangles]
        lo = Vector([min(v[i] for v in vertices) for i in range(3)])
        hi = Vector([max(v[i] for v in vertices) for i in range(3)])
        parts[o.name] = dict(vertices=vertices, faces=faces, lo=lo, hi=hi, assembly=str(o.get('assemblyId') or o.name.split('.')[0]))
    e.to_mesh_clear()
trees = {}


def tree(name):
    if name not in trees:
        p = parts[name]
        trees[name] = BVHTree.FromPolygons(p['vertices'], p['faces'], all_triangles=True)
    return trees[name]


def samples(name, limit=400):
    vs = parts[name]['vertices']
    return vs[::max(1, len(vs) // limit)]


def inside(point, name):
    """Odd crossings of a ray from the point: the point lies inside the (closed) part."""
    t = tree(name)
    origin, direction, crossings = point.copy(), Vector((.2113, .3517, .9119)).normalized(), 0
    for _ in range(64):
        hit = t.ray_cast(origin, direction)
        if hit[0] is None:
            break
        crossings += 1
        origin = hit[0] + direction * 1e-4
    return crossings % 2 == 1


def touches(a, b):
    pa, pb = parts[a], parts[b]
    if any(pa['lo'][i] > pb['hi'][i] + gap or pb['lo'][i] > pa['hi'][i] + gap for i in range(3)):
        return False
    if tree(a).overlap(tree(b)):
        return True
    for x, y in ((a, b), (b, a)):
        t = tree(y)
        for v in samples(x):
            if t.find_nearest(v, gap)[0] is not None:
                return True
    for x, y in ((a, b), (b, a)):
        py = parts[y]
        for v in samples(x, 40):
            if all(py['lo'][i] <= v[i] <= py['hi'][i] for i in range(3)) and inside(v, y):
                return True
    return False


cell = 4.0
grid = defaultdict(list)
for name, p in parts.items():
    for i in range(int((p['lo'].x - gap) // cell), int((p['hi'].x + gap) // cell) + 1):
        for j in range(int((p['lo'].y - gap) // cell), int((p['hi'].y + gap) // cell) + 1):
            for k in range(int((p['lo'].z - gap) // cell), int((p['hi'].z + gap) // cell) + 1):
                grid[(i, j, k)].append(name)


def neighbours(name):
    p, seen = parts[name], set()
    for i in range(int((p['lo'].x - gap) // cell), int((p['hi'].x + gap) // cell) + 1):
        for j in range(int((p['lo'].y - gap) // cell), int((p['hi'].y + gap) // cell) + 1):
            for k in range(int((p['lo'].z - gap) // cell), int((p['hi'].z + gap) // cell) + 1):
                for q in grid[(i, j, k)]:
                    if q != name and q not in seen:
                        seen.add(q)
                        yield q


roots = [n for n, p in parts.items() if p['assembly'] == 'hull']
if not roots:
    raise SystemExit('No hull mesh (assemblyId "hull") to search from')
reached, frontier = set(roots), list(roots)
while frontier:
    name = frontier.pop()
    for other in neighbours(name):
        if other not in reached and touches(name, other):
            reached.add(other)
            if not any(s in other.lower() for s in leaf):
                frontier.append(other)
floating = [n for n in parts if n not in reached]


def runtime(v):
    """Ship metres, +X starboard, +Y up, -Z bow: the retained scene is authored bow +X, port +Y;
    the glTF importer turns the published +Y up into Blender's +Z up."""
    return (-v[1], v[2], -v[0]) if model.suffix == '.blend' else (v[0], v[2], -v[1])


def bounds(names):
    corners = [runtime(parts[n][k]) for n in names for k in ('lo', 'hi')]
    return [round(min(c[i] for c in corners), 2) for i in range(3)], [round(max(c[i] for c in corners), 2) for i in range(3)]
by_assembly = defaultdict(list)
for n in floating:
    by_assembly[parts[n]['assembly']].append(n)
report = {'model': str(model), 'gap': gap, 'ignore': ignore, 'leaf': leaf, 'parts': len(parts), 'floating': [
    {'assembly': a, 'parts': sorted(names), 'runtimeBounds': bounds(names),
     'wholeAssembly': all(parts[n]['assembly'] != a or n in names for n in parts)} for a, names in sorted(by_assembly.items())]}
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(report, indent=1))
print(f'FLOATING {len(floating)} of {len(parts)} parts unattached, {time.perf_counter() - T0:.1f} s', flush=True)
