"""Original USS Omaha (CL-4) recipe, GameModels3D fit A (1923 hull), the reference's plain paint.

Blueprint meters: +Y up, -Z bow. Authoring meters: +X bow, +Y port, +Z up. The shared exporter owns the
sole basis conversion. Proportions follow the approved GameModels3D pasc005 fit A; no reference geometry or
texture is loaded. The lofted hull and the measured superstructure blocks come from the blueprint;
`omaha_kit.py` holds the shared vocabulary, `omaha_bridge.py` draws the navigation platform, the bridge and
after-station detail and the upperworks rails, `omaha_fittings.py` the torpedo pockets, casemate hoods, funnels'
caps, masts, directors, rangefinders, searchlights, aviation, boats, torpedo mounts, deck and underwater gear,
and `omaha_windows.py` the windows and scuttles the reference paints.
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
sys.path.insert(0, str(ROOT / 'assets/parts'))
from library import create_mount
sys.path.insert(0, str(Path(__file__).parent))
from omaha_kit import Kit, R
import omaha_bridge
import omaha_fittings
import omaha_windows

OUT = Path(os.environ['SHIP_OUTPUT'])
D = json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
scene.world = bpy.data.worlds.new('Omaha review world')
scene.world.color = (.08, .10, .12)
kit = Kit(D, ['Hull and decks', 'Superstructure', 'Main and secondary batteries', 'Light AA', 'Torpedoes',
              'Sensors and masts', 'Boats and aviation', 'Deck fittings', 'Underwater fittings'])
materials, collections, helpers = kit.materials, kit.collections, kit.helpers

# ---------------------------------------------------------------- hull
hull = authored_hull(D['hull'], kit.mesh, collections['Hull and decks'], [materials['hullgray'], materials['antifouling']], False)
hull.data.materials.append(materials['deck'])
omaha_fittings.torpedo_pockets(D, kit, hull)
for face in hull.data.polygons:
    if face.normal.z > .96 and face.center.z > 0:
        face.material_index = 2
    elif face.material_index == 2 or face.center.z > 0 and face.material_index == 1:
        face.material_index = 0

# ---------------------------------------------------------------- superstructure
shells = []
import bmesh
for s in D['structures']:
    ob = authored_structure(s, kit.mesh, materials, collections['Superstructure'])
    if 'exhaust' in s:
        # Split the funnel's walls where the black top band begins (1.2 m under the rim).
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.bisect_plane(bm, geom=[*bm.verts, *bm.edges, *bm.faces], dist=1e-6, plane_co=(0, 0, s['exhaust']['position'][1] - 1.2), plane_no=(0, 0, 1))
        bm.to_mesh(ob.data)
        bm.free()
    ob.data.materials.append(materials[kit.roof(s)])
    ob.data.materials.append(materials['black'])
    for face in ob.data.polygons:
        if 'exhaust' in s and face.center.z > s['exhaust']['position'][1] - 1.2:
            # The funnel caps are black from about 1.2 m below the rim, as the reference paints them.
            face.material_index = 2
        elif face.normal.z > .8 and 'exhaust' not in s:
            face.material_index = 1
    if 'exhaust' in s or s['id'].endswith('-boot'):
        ob.data.shade_smooth()
        ob.data.set_sharp_from_angle(angle=math.radians(40))
    shells.append(ob)
support = SupportSurface([hull, *shells])
kit.support = support
kit.hull_face_count = len(hull.data.polygons)  # support faces below this index are the hull's

# ---------------------------------------------------------------- guns
for mount in D['mounts']:
    light = mount['partId'] in ('us-11in75-quad', 'us-50cal-browning-m2')
    col = collections['Light AA' if light else 'Main and secondary batteries']
    x, y, z = R(mount['position'])
    floor = min(z, kit.below(x, y, z + .5, z))
    if z - floor > .02:
        radius = min(mount['weapon']['barbetteRadius'], 1.55) if mount['battery'] == 'main' else max(.35, min(mount['weapon']['barbetteRadius'], 1.9))
        kit.cylz(mount['id'], col, 'seat', (x, y, floor - .02), radius, z - floor + .025, 'naval', 48 if radius > 1 else 20)
    create_mount(mount, col, helpers, materials)

# ---------------------------------------------------------------- fittings
omaha_bridge.build(D, kit)  # before the fittings: their last step merges every rail and wire
omaha_fittings.build(D, kit)
omaha_windows.build(D, kit)

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
print('Omaha original recipe:', len(scene.objects), 'objects; source saved')
