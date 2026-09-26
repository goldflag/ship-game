"""Original USS Pensacola (CA-24) recipe, 1942 fit, the reference's plain paint.

Blueprint meters: +Y up, -Z bow. Authoring meters: +X bow, +Y port, +Z up. The shared
exporter owns the sole basis conversion. Proportions follow the approved GameModels3D
pasc106 A hull (asc043_pensacola_1942); no reference geometry or texture is loaded. The lofted
hull and the measured superstructure blocks come from the blueprint; `pensacola_kit.py` holds the
shared vocabulary, `pensacola_fittings.py` draws the masts, funnel caps, gun tubs, directors,
sensors, aviation, boats, deck fittings and underwater gear, and `pensacola_windows.py` glazes
the bridge.
"""
import bpy
import math
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'scripts/ships'))
from blender_fidelity import authored_hull, authored_structure
from blender_supports import SupportSurface
from blender_rig import create_flagstaffs
from blender_wall_fittings import seat_wall_fittings
sys.path.insert(0, str(ROOT / 'assets/parts'))
from library import create_mount
sys.path.insert(0, str(Path(__file__).parent))
from pensacola_kit import Kit, ZC
import pensacola_fittings
import pensacola_windows

OUT = Path(os.environ['SHIP_OUTPUT'])
D = json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
scene.world = bpy.data.worlds.new('Pensacola review world')
scene.world.color = (.08, .10, .12)
kit = Kit(D, ['Hull and decks', 'Superstructure', 'Main and secondary batteries', 'Light AA', 'Sensors and masts',
              'Boats and aviation', 'Deck fittings', 'Underwater fittings'])
materials, collections, helpers = kit.materials, kit.collections, kit.helpers

# ---------------------------------------------------------------- hull
hull = authored_hull(D['hull'], kit.mesh, collections['Hull and decks'], [materials['hullgray'], materials['antifouling']], False)
hull.data.materials.append(materials['deck'])
for face in hull.data.polygons:
    if face.normal.z > .96 and face.center.z > 0:
        # The flush weather deck is planked and painted deck blue, as the reference shows.
        face.material_index = 2

# ---------------------------------------------------------------- superstructure
shells = []
FUNNEL_TOPS = {}
for s in D['structures']:
    if s.get('exhaust'):
        FUNNEL_TOPS[s['id'].rsplit('-', 1)[0]] = s['baseY'] + s['height']
for s in D['structures']:
    ob = authored_structure(s, kit.mesh, materials, collections['Superstructure'])
    ob.data.materials.append(materials[kit.roof(s)])
    ob.data.materials.append(materials['black'])
    group = s['id'].rsplit('-', 1)[0]
    for face in ob.data.polygons:
        if group in FUNNEL_TOPS and face.center.z > FUNNEL_TOPS[group] - 1.8:
            # The funnel caps are black from about 1.8 m below the mouth, as the reference paints them.
            face.material_index = 2
        elif face.normal.z > .8:
            face.material_index = 1
    # Lofted blocks turn in many small facets: shade them smooth and keep the corners (over 30 degrees) sharp.
    ob.data.shade_smooth()
    ob.data.set_sharp_from_angle(angle=math.radians(30))
    shells.append(ob)
support = SupportSurface([hull, *shells])
kit.support = support

# ---------------------------------------------------------------- guns
for mount in D['mounts']:
    light = mount['partId'].startswith(('us-11in', 'us-20mm'))
    col = collections['Light AA' if light else 'Main and secondary batteries']
    if mount['battery'] == 'main':
        kit.barbette(mount)
    else:
        kit.gun_seat(mount)
    create_mount(mount, col, helpers, materials)

# ---------------------------------------------------------------- fittings
pensacola_fittings.build(D, kit)
pensacola_windows.build(D, kit)
kit.build_wires()

scene['definitionHash'] = D['contentHash']
scene['historicalConfiguration'] = D['configuration']
scene['accuracyStatus'] = 'GameModels3D-only fidelity target; see README approximations'
create_flagstaffs(D)
seat_wall_fittings(scene)
sys.path.insert(0, str(ROOT / 'assets/ships/appearance'))
from surface import apply_appearance
apply_appearance(scene, materials, Path(__file__).with_name('appearance.json'))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'source.blend'))
print('Pensacola original recipe:', len(scene.objects), 'objects; source saved')
