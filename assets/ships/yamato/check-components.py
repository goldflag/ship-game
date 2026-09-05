"""Read-only dimensional inspection of the generated original Blender source.

Run Blender --background --factory-startup --python-exit-code 1 --python this-file.
No scene changes are saved; durable authoring remains in build.py and the catalog.
"""
import bpy
import json
from pathlib import Path
from mathutils import Vector

ship = Path(__file__).resolve().parent
definition = json.loads((ship.parents[2] / 'public/models/yamato.json').read_text())
bpy.ops.wm.open_mainfile(filepath=str(ship / 'generated/source.blend'))
bpy.context.view_layer.update()
assert bpy.context.scene['definitionHash'] == definition['contentHash'], 'Source and published model differ'
measures = []

def check(label, measured, expected, source, tolerance=.025):
    measures.append(dict(id=label, measuredM=measured, expectedM=expected,
                         errorM=measured-expected, toleranceM=tolerance,
                         passed=abs(measured-expected) <= tolerance, source=source))

for mount in definition['mounts']:
    if mount['battery'] != 'main':
        continue
    name = mount['name']
    yaw = bpy.data.objects[mount['id'] + '.yaw'].matrix_world.translation
    roller = bpy.data.objects[name + ' • roller race']
    points = [roller.matrix_world @ v.co for v in roller.data.vertices]
    check(mount['id'] + '.roller-diameter', max(p.y for p in points)-min(p.y for p in points), 13.05, 'O-45(N) printed p.17')
    pivots = [bpy.data.objects[mount['id']+'.'+side+'.elevation'].matrix_world.translation for side in ['left','center','right']]
    for i in [0,1]:
        check(mount['id']+f'.bore-spacing-{i}', (pivots[i+1]-pivots[i]).length, 3.5, 'O-45(N) printed p.17')
    check(mount['id']+'.gun-axis-height', pivots[1].z-yaw.z, 4.4, 'O-45(N) printed p.17')
    check(mount['id']+'.trunnion-forward', Vector((pivots[1].x-yaw.x,pivots[1].y-yaw.y,0)).length, 3.25, 'O-45(N) printed p.17')
    hoods = [o for o in bpy.context.scene.objects if o.name.startswith(name+' • rangefinder hood')]
    assert len(hoods)==2, (name, len(hoods))
    check(mount['id']+'.optical-base', (hoods[0].matrix_world.translation-hoods[1].matrix_world.translation).length, 15, 'O-45(N) printed p.17; hood centres represent optical stations')

for side, sign in [('port',1),('starboard',-1)]:
    for suffix, lateral in [('outer',8.2),('inner',4.8)]:
        assembly=f'propeller-{side}-{suffix}'
        blades=[o for o in bpy.context.scene.objects if o.get('assemblyId')==assembly and o.type=='MESH']
        assert len(blades)==3, (assembly,len(blades))
        radius=max(((p.y-sign*lateral)**2+(p.z+7.8)**2)**.5 for blade in blades for p in [blade.matrix_world @ v.co for v in blade.data.vertices])
        check(assembly+'.diameter', radius*2, 5, 'Kure Museum screw/rudder detail page; nominal blade surface before cast thickness')

reflectors = sorted((o for o in bpy.context.scene.objects if '150 cm reflector' in o.name), key=lambda o:o.name)
assert len(reflectors) == 6, f'Museum specifies six searchlights, found {len(reflectors)}'
for i, reflector in enumerate(reflectors):
    points = [reflector.matrix_world @ v.co for v in reflector.data.vertices]
    check(f'searchlight-{i+1}.reflector-diameter', max(p.x for p in points)-min(p.x for p in points), 1.5,
          'Kure Museum searchlight educational page, 150 cm reflector; measured optical face, excluding casing')

report=dict(contentHash=definition['contentHash'], method='World-space original mesh vertices and joint/optical centres in retained source.blend', measures=measures,
            historicalAccuracy='Checks selected component measurements only. Gunhouse plate vertices, muzzle offsets, blade pitch and equipment positions remain unverified.')
(ship/'reports/components.json').write_text(json.dumps(report,indent=2)+'\n')
for m in measures: print(m['id'], round(m['measuredM'],6), 'PASS' if m['passed'] else 'FAIL')
assert all(m['passed'] for m in measures), 'Component dimension mismatch'
