"""Original IJN Nagato recipe, 1944 fit, the reference's default (source) paint.

Blueprint meters: +Y up, -Z bow. Authoring meters: +X bow, +Y port, +Z up. The shared exporter owns the sole
basis conversion. Proportions follow the approved GameModels3D pjsb010 B hull; no reference geometry or texture
is loaded. The lofted hull and the measured superstructure prisms come from the blueprint; `nagato_kit.py` holds
the shared vocabulary, the region modules draw what the prisms cannot (masts, funnel cap, directors and optics,
boats and cranes, aviation, ground tackle, underwater gear, rails) and `nagato_windows.py` glazes the openings
the reference paints.
"""
import bpy
import math
import json
import os
import sys
from pathlib import Path
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'scripts/ships'))
from blender_fidelity import authored_hull, authored_structure
from blender_supports import SupportSurface
from blender_rig import create_flagstaffs
sys.path.insert(0, str(ROOT / 'assets/parts'))
from library import create_mount
sys.path.insert(0, str(Path(__file__).parent))
from nagato_kit import Kit, P, R, ZC, FIXED_SINGLES
import nagato_fittings

OUT = Path(os.environ['SHIP_OUTPUT'])
D = json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
scene.world = bpy.data.worlds.new('Nagato review world')
scene.world.color = (.08, .10, .12)
kit = Kit(D, ['Hull and decks', 'Superstructure', 'Main and secondary batteries', 'Light AA', 'Sensors and masts',
              'Boats and aviation', 'Deck fittings', 'Underwater fittings'])
materials, collections, helpers = kit.materials, kit.collections, kit.helpers

# ---------------------------------------------------------------- hull
hull = authored_hull(D['hull'], kit.mesh, collections['Hull and decks'], [materials['hullgray'], materials['antifouling']], False)
for key in ['deck', 'roof']:
    hull.data.materials.append(materials[key])
for face in hull.data.polygons:
    if face.normal.z > .96 and face.center.z > 0:
        zref = -face.center.x + ZC
        # Planked weather decks; the casemate shelf beside the forecastle block is grey steel.
        face.material_index = 3 if -57.6 < zref < 12.1 else 2

# ---------------------------------------------------------------- superstructure
shells = []
FUNNEL_TOP = max((s['baseY'] + s['height'] for s in D['structures'] if s['id'].startswith('funnel-')), default=0)
for s in D['structures']:
    ob = authored_structure(s, kit.mesh, materials, collections['Superstructure'])
    ob.data.materials.append(materials[nagato_fittings.roof(s)])
    ob.data.materials.append(materials['black'])
    funnel = s['id'].startswith('funnel-')
    for face in ob.data.polygons:
        if funnel and face.center.z > FUNNEL_TOP - 1.35:
            # The funnel is black from about 1.3 m below the mouth, as the reference paints it.
            face.material_index = 2
        elif face.normal.z > .8:
            face.material_index = 1
    ob.data.shade_smooth()
    ob.data.set_sharp_from_angle(angle=math.radians(30))
    shells.append(ob)
support = SupportSurface([hull, *shells])
kit.support = support
for ob in [o for o in shells if o['assemblyId'] in nagato_fittings.CLAIMED_STRUCTURES]:
    shells.remove(ob)
    bpy.data.objects.remove(ob, do_unlink=True)

# ---------------------------------------------------------------- guns
def sight_wires(mount_id, col):
    """The shared single's ring sight hangs 8 cm off its rail; cross-wires owned by the same elevating joint carry
    it on the rail's end (as on Takao)."""
    elev = bpy.data.objects[mount_id + '.center.elevation']
    for a, b in (((.13, .17, .21), (.13, .17, .41)), ((.13, .07, .31), (.13, .27, .31))):
        wire = kit.rod(mount_id + '.sight cross-wire', a, b, .007, 'edge', col, vertices=5)
        wire.parent = elev
        wire['assemblyId'] = mount_id


BARBETTE_R = 5.87            # measured main barbettes (plan cuts of the reference hull group)
for mount in D['mounts']:
    light = mount['partId'].startswith('type96')
    col = collections['Light AA' if light else 'Main and secondary batteries']
    x, y, z = R(mount['position'])
    if mount.get('parentMountId'):
        pass
    elif mount['battery'] == 'main':
        floor = kit.below(x, y, z - .05)
        kit.cylz(mount['id'], col, 'barbette', (x, y, floor - .02), BARBETTE_R, z - floor + .02, 'naval', 96)
        kit.cylz(mount['id'], col, 'barbette top band', (x, y, z - .22), BARBETTE_R + .04, .12, 'naval', 96)
        if z - floor > 1.5:
            kit.cylz(mount['id'], col, 'barbette foot band', (x, y, floor + .35), BARBETTE_R + .03, .1, 'naval', 96)
    else:
        nagato_fittings.mount_seat(kit, mount, col)
    before = set(scene.objects)
    create_mount(mount, col, helpers, materials)
    if mount['partId'] == 'type96-25-kongo-single':
        sight_wires(mount['id'], col)
    if mount.get('parentMountId'):
        # A low pedestal seats the triple on the domed turret roof (the crown is 3.16 m over the sole, so the
        # pedestal's foot sinks into the dome); it trains with the turret too.
        kit.cylz(mount['id'], col, 'roof pedestal', (x, y, z - .45), .62, .46, 'naval', 24)
        # A triple on a turret roof trains with that turret.
        parent = next(o for o in scene.objects if o.get('nodeId') == mount['parentMountId'] + '.yaw')
        bpy.context.view_layer.update()
        for obj in set(scene.objects) - before:
            if obj.parent is None:
                world = obj.matrix_world.copy()
                obj.parent = parent
                obj.matrix_parent_inverse = Matrix.Identity(4)
                obj.matrix_world = world

# Twelve fixed 25 mm singles (the blueprint's mount limit), drawn with the catalog recipe at rest.
single = next(m for m in D['mounts'] if m['partId'] == 'type96-25-kongo-single')
for i, (x, y, z, bearing) in enumerate(FIXED_SINGLES, 1):
    fixed = dict(single, id=f'fixed-aa1-{i}', name=f'Fixed 25 mm single {i}', position=[x, y, round(z - ZC, 4)], bearingDeg=bearing)
    nagato_fittings.mount_seat(kit, fixed, collections['Light AA'])
    before = set(scene.objects)
    create_mount(fixed, collections['Light AA'], helpers, materials)
    sight_wires(fixed['id'], collections['Light AA'])
    bpy.context.view_layer.update()
    new = set(scene.objects) - before
    for obj in [o for o in new if o.type == 'MESH']:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
        if 'nodeId' in obj:
            del obj['nodeId']
        for key in [k for k in obj.keys() if k.startswith('gunCover')]:
            del obj[key]
        obj['assemblyId'] = f'fixed-aa1-{i}'
    for obj in [o for o in new if o.type != 'MESH']:
        bpy.data.objects.remove(obj, do_unlink=True)

# ---------------------------------------------------------------- fittings
nagato_fittings.build(D, kit)
kit.build_wires()

scene['definitionHash'] = D['contentHash']
scene['historicalConfiguration'] = D['configuration']
scene['accuracyStatus'] = 'GameModels3D-only fidelity target; see README approximations'
create_flagstaffs(D)
from blender_wall_fittings import seat_wall_fittings
seat_wall_fittings(scene)
sys.path.insert(0, str(ROOT / 'assets/ships/appearance'))
from surface import apply_appearance
apply_appearance(scene, materials, Path(__file__).with_name('appearance.json'))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'source.blend'))
print('Nagato original recipe:', len(scene.objects), 'objects; source saved')
