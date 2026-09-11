"""Run with isolated Blender before ship:compile after editing casemate_belt.py.

Build contact surfaces from the original recipe, never from a published asset.
"""
import json
import sys
from pathlib import Path
import bpy

directory = Path(__file__).resolve().parent
sys.path.insert(0, str(directory))
from casemate_belt import create

path = directory.parent / 'blueprint.json'
definition = json.loads(path.read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)


def prism(name, outline, bottom, top, material):
    n = len(outline)
    vertices = [(x, y, z) for z in [bottom, top] for x, y in outline]
    faces = [(i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n)]
    faces += [tuple(reversed(range(n))), tuple(range(n, 2*n))]
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    return obj


tier, planking = create(prism, definition['mounts'], None, None)
definition['structures'] = [s for s in definition['structures']
                            if s['id'] != 'casemate-belt']
vertices, triangles = [], []
for obj in [tier, planking]:
    obj.data.calc_loop_triangles()
    offset = len(vertices)
    vertices.extend([round(-v.co.y, 6), round(v.co.z, 6), round(-v.co.x, 6)]
                    for v in obj.data.vertices)
    triangles.extend([offset+i for i in t.vertices] for t in obj.data.loop_triangles)
xs, ys, zs = zip(*vertices)
definition['structures'].append(dict(
    id='casemate-belt', name='Casemate belt and weather deck', material='naval',
    footprint=[[min(xs), min(zs)], [max(xs), min(zs)],
               [max(xs), max(zs)], [min(xs), max(zs)]],
    baseY=min(ys), height=max(ys)-min(ys),
    surface=dict(vertices=vertices, triangles=triangles)))
path.write_text(json.dumps(definition, indent=2)+'\n')
print('Casemate contact surface:', len(vertices), 'vertices,', len(triangles), 'triangles')
