"""Original adjustable access samples, exported through the shared library.

Bun evaluates the same metric recipe used by the editor. Runtime +Y up/-Z bow
is converted once into Blender +X bow/+Z up before the common exporter.
"""
import json
import shutil
import subprocess
from pathlib import Path
import bpy
from mathutils import Matrix, Vector


def create_access(part, col, helpers, materials):
    root_path = Path(__file__).resolve().parents[3]
    bun = shutil.which('bun') or str(Path.home()/'.bun/bin/bun')
    members = json.loads(subprocess.check_output([bun, str(Path(__file__).with_name('access_sample.ts')), part['path']['kind']], cwd=root_path))
    root = bpy.data.objects.new('component', None)
    col.objects.link(root)
    root['nodeId'] = 'component.root'
    root['assemblyId'] = 'component'
    def convert(v): return Vector((-v[2], -v[0], v[1]))
    for i, m in enumerate(members):
        a, b = convert(m['a']), convert(m['b'])
        name = 'component.' + m['name'] + '.' + str(i)
        if m.get('round'):
            obj = helpers['rod'](name, a, b, m['width']/2, materials['naval'], col, vertices=8)
        else:
            obj = helpers['box'](name, (a+b)/2, (m['width'],m['depth'],(b-a).length), materials['naval'], col)
            axes = [convert(axis) for axis in m['axes']]
            obj.rotation_euler = Matrix(axes).transposed().to_euler()
        obj.parent = root
    return root
