"""Original USS Atlanta (CL-51) recipe, 1942 fit, the reference's plain paint.

Blueprint meters: +Y up, -Z bow. Authoring meters: +X bow, +Y port, +Z up. The shared
exporter owns the sole basis conversion. Proportions follow the approved GameModels3D
pasc006 A hull; no reference geometry or texture is loaded. The lofted hull and the
measured superstructure blocks come from the blueprint; `atlanta_kit.py` holds the shared
vocabulary and `atlanta_fittings.py` draws the tubs, masts, directors, sensors, torpedo
mounts, depth-charge gear, boats, crane, deck fittings and underwater gear.
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
from atlanta_kit import Kit, R
import atlanta_fittings
import atlanta_windows

OUT = Path(os.environ['SHIP_OUTPUT'])
D = json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
scene.world = bpy.data.worlds.new('Atlanta review world')
scene.world.color = (.08, .10, .12)
kit = Kit(D, ['Hull and decks', 'Superstructure', 'Main battery', 'Light AA', 'Torpedoes and depth charges',
              'Sensors and masts', 'Boats', 'Deck fittings', 'Underwater fittings'])
materials, collections, helpers = kit.materials, kit.collections, kit.helpers

# ---------------------------------------------------------------- hull
hull = authored_hull(D['hull'], kit.mesh, collections['Hull and decks'], [materials['hullgray'], materials['antifouling']], False)
hull.data.materials.append(materials['deck'])
for face in hull.data.polygons:
    if face.normal.z > .96 and face.center.z > 0:
        # Painted-steel weather deck in deck blue, stem to stern.
        face.material_index = 2

# ---------------------------------------------------------------- superstructure
shells = []
for s in D['structures']:
    ob = authored_structure(s, kit.mesh, materials, collections['Superstructure'])
    ob.data.materials.append(materials['roof'])
    ob.data.materials.append(materials['black'])
    funnel = 'exhaust' in s
    for face in ob.data.polygons:
        if funnel and face.normal.z > .5:
            # The funnel mouth under its clinker screen is dark, as the reference paints it.
            face.material_index = 2
        elif face.normal.z > .8:
            face.material_index = 1
    if funnel:
        for face in ob.data.polygons:
            face.use_smooth = abs(face.normal.z) < .5
    else:
        # Traced outlines turn in many small steps: shade them smooth and keep the corners (over 30 degrees) sharp.
        ob.data.shade_smooth()
        ob.data.set_sharp_from_angle(angle=math.radians(30))
    shells.append(ob)

# Tub floors and platforms join the support set before anything is seated on them.
platforms = atlanta_fittings.platforms(D, kit)
support = SupportSurface([hull, *shells, *platforms])
kit.support = support

# ---------------------------------------------------------------- guns
# The reference paints the 5-inch gunhouse roofs haze grey like their sides (only deckhouse roofs and decks are
# deck blue), so the gun part's roof role takes the side paint here.
gunhouse_materials = {**materials, 'roof': materials['naval']}
for mount in D['mounts']:
    main = mount['battery'] == 'main'
    col = collections['Main battery' if main else 'Light AA']
    if main:
        kit.barbette(mount)
    else:
        kit.gun_seat(mount)
    create_mount(mount, col, helpers, gunhouse_materials if main else materials)

# ---------------------------------------------------------------- fittings
atlanta_fittings.build(D, kit)
atlanta_windows.build(D, kit)

scene['definitionHash'] = D['contentHash']
scene['historicalConfiguration'] = D['configuration']
scene['accuracyStatus'] = 'GameModels3D-only fidelity target; see README approximations'
create_flagstaffs(D)
seat_wall_fittings(scene)
sys.path.insert(0, str(ROOT / 'assets/ships/appearance'))
from surface import apply_appearance
apply_appearance(scene, materials, Path(__file__).with_name('appearance.json'))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'source.blend'))
print('Atlanta original recipe:', len(scene.objects), 'objects; source saved')
