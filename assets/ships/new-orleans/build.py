"""Original USS New Orleans (CA-32) recipe, 1944 fit, the reference's plain paint.

Blueprint meters: +Y up, -Z bow. Authoring meters: +X bow, +Y port, +Z up. The shared exporter owns the sole
basis conversion. Proportions follow the approved GameModels3D pasc107 B_Hull configuration (hull
asc014_new_orlean_1944); no reference geometry or texture is loaded. The lofted hull and the measured
superstructure blocks come from the blueprint; `new_orleans_kit.py` holds the shared vocabulary and
`new_orleans_fittings.py` draws the masts, directors, radars, aviation, boats, deck gear and underwater gear.
"""
import bpy
import bmesh
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
from new_orleans_kit import Kit, R
import new_orleans_fittings
import new_orleans_windows

OUT = Path(os.environ['SHIP_OUTPUT'])
D = json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
scene.world = bpy.data.worlds.new('New Orleans review world')
scene.world.color = (.08, .10, .12)
kit = Kit(D, ['Hull and decks', 'Superstructure', 'Main and secondary batteries', 'Light AA', 'Sensors and masts',
              'Boats and aviation', 'Deck fittings', 'Underwater fittings'])
materials, collections, helpers = kit.materials, kit.collections, kit.helpers

# ---------------------------------------------------------------- hull
hull = authored_hull(D['hull'], kit.mesh, collections['Hull and decks'], [materials['hullgray'], materials['antifouling']], False)
for key in ['boot', 'wood_deck']:
    hull.data.materials.append(materials[key])
# The reference paints a black boot-topping from 0.24 to 0.76 m above its waterline over the fouled bottom.
bm = bmesh.new()
bm.from_mesh(hull.data)
for z in (.24, .76):
    bmesh.ops.bisect_plane(bm, geom=[*bm.verts, *bm.edges, *bm.faces], dist=1e-8, plane_co=(0, 0, z), plane_no=(0, 0, 1))
bm.to_mesh(hull.data)
bm.free()
for face in hull.data.polygons:
    zc = face.center.z
    if face.normal.z > .96 and zc > 2:
        # Timber weather decks, painted deck blue as the reference's planked texture shows them.
        face.material_index = 3
        face.use_smooth = False
    elif zc < .24:
        face.material_index = 1
    elif zc < .76:
        face.material_index = 2
    else:
        face.material_index = 0

# ---------------------------------------------------------------- superstructure
shells = []
for s in D['structures']:
    if s['id'].startswith('wall-'):
        # the interlocks' copy of a traced wall near a gun: new_orleans_fittings.walls draws the plating
        continue
    ob = authored_structure(s, kit.mesh, materials, collections['Superstructure'])
    ob.data.materials.append(materials['deck-blue'])
    ob.data.materials.append(materials['black'])
    funnel = 'exhaust' in s
    rim = s['baseY'] + s['height']
    for face in ob.data.polygons:
        if funnel and face.center.z > rim - 1.0:
            # The funnel tops are sooted black for about a metre under the rim, as the reference paints them.
            face.material_index = 2
        elif face.normal.z > .97 and not funnel:
            face.material_index = 1
    # Traced outlines and lofted tiers turn in many small steps: shade them smooth and keep corners over 30 degrees.
    ob.data.shade_smooth()
    ob.data.set_sharp_from_angle(angle=math.radians(30))
    shells.append(ob)
support = SupportSurface([hull, *shells])
kit.support = support

# ---------------------------------------------------------------- guns
for mount in D['mounts']:
    col = collections['Main and secondary batteries' if mount['battery'] == 'main' or mount['id'].startswith('secondary') else 'Light AA']
    if mount['battery'] == 'main':
        kit.barbette(mount)
    else:
        kit.gun_seat(mount)
    create_mount(mount, col, helpers, materials)
# The twin Oerlikons' canvas case bags carry twenty elevation shape keys each. Drawn faceted, the exporter splits every
# vertex per face (590 a bag for 162 points) and the 34 bags' morph targets came to 9.6 MB of a 26 MB model. A canvas bag
# shades smooth anyway: that shares its vertices and keeps its shape and every key.
for ob in scene.objects:
    if ob.type == 'MESH' and ob.data.shape_keys and ob.name.split('.')[1:2] == ['case-bag']:
        ob.data.shade_smooth()
# The reference's plain scheme paints the 8-inch barrels haze grey like their gunhouses; the catalog turret draws them
# in its dark-fittings role.
for ob in scene.objects:
    if ob.type == 'MESH' and ob.name.split('.')[0] in ('main-1', 'main-2', 'main-3') and ob.name.split('.')[1:2] == ['barrel']:
        ob.data.materials[0] = materials['naval']

# ---------------------------------------------------------------- fittings
new_orleans_fittings.build(D, kit)
new_orleans_windows.build(D, kit)

scene['definitionHash'] = D['contentHash']
scene['historicalConfiguration'] = D['configuration']
scene['accuracyStatus'] = 'GameModels3D-only fidelity target; see README approximations'
create_flagstaffs(D)
seat_wall_fittings(scene)
sys.path.insert(0, str(ROOT / 'assets/ships/appearance'))
from surface import apply_appearance
apply_appearance(scene, materials, Path(__file__).with_name('appearance.json'))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'source.blend'))
print('New Orleans original recipe:', len(scene.objects), 'objects; source saved')
