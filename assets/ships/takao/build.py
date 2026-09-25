"""Original IJN Takao recipe, 1944 fit, the reference's plain paint.

Blueprint meters: +Y up, -Z bow. Authoring meters: +X bow, +Y port, +Z up. The shared
exporter owns the sole basis conversion. Proportions follow the approved GameModels3D
pjsc708 default configuration (Takao-class 1944 hull); no reference geometry or texture is
loaded. The lofted hull and the measured superstructure blocks come from the blueprint;
`takao_kit.py` holds the shared vocabulary and `takao_fittings.py` draws the masts,
funnels' caps, directors, sensors, aviation, boats, torpedo mounts and deck fittings.
"""
import bpy
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
from takao_kit import Kit, ZC
import takao_fittings

OUT = Path(os.environ['SHIP_OUTPUT'])
D = json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
scene.world = bpy.data.worlds.new('Takao review world')
scene.world.color = (.08, .10, .12)
kit = Kit(D, ['Hull and decks', 'Superstructure', 'Main and secondary batteries', 'Light AA', 'Torpedoes',
              'Sensors and masts', 'Boats and aviation', 'Deck fittings', 'Underwater fittings'])
materials, collections, helpers = kit.materials, kit.collections, kit.helpers

# ---------------------------------------------------------------- hull
hull = authored_hull(D['hull'], kit.mesh, collections['Hull and decks'], [materials['hullgray'], materials['antifouling']], False)
for key in ['linoleum', 'roof']:
    hull.data.materials.append(materials[key])
for face in hull.data.polygons:
    if face.normal.z > .96 and face.center.z > 0:
        zref = -face.center.x + ZC
        # Linoleum with brass strips over the weather deck; the forecastle head and the stern are steel.
        face.material_index = 2 if -77.5 < zref < 94.0 else 3

# ---------------------------------------------------------------- superstructure
shells = []
FUNNEL_TOPS = {}
for s in D['structures']:
    if s['id'].startswith(('forward-funnel', 'after-funnel')):
        top = max(v[1] for v in s['surface']['vertices']) if s.get('surface') else s['baseY'] + s['height']
        key = s['id'].rsplit('-', 1)[0]
        FUNNEL_TOPS[key] = max(FUNNEL_TOPS.get(key, 0), top)
for s in D['structures']:
    ob = authored_structure(s, kit.mesh, materials, collections['Superstructure'])
    ob.data.materials.append(materials[kit.roof(s)])
    ob.data.materials.append(materials['black'])
    funnel = s['id'].rsplit('-', 1)[0] in FUNNEL_TOPS
    for face in ob.data.polygons:
        if funnel and face.center.z > FUNNEL_TOPS[s['id'].rsplit('-', 1)[0]] - 1.25:
            # The funnel caps are black from about 1.2 m below the mouth, as the reference paints them.
            face.material_index = 2
        elif face.normal.z > .8:
            face.material_index = 1
        face.use_smooth = funnel and abs(face.normal.z) < .5
    shells.append(ob)
support = SupportSurface([hull, *shells])
kit.support = support
for ob in [o for o in shells if o['assemblyId'] in takao_fittings.CLAIMED_STRUCTURES]:
    shells.remove(ob)
    bpy.data.objects.remove(ob, do_unlink=True)

# ---------------------------------------------------------------- guns
for mount in D['mounts']:
    light = mount['partId'].startswith('type96')
    col = collections['Light AA' if light else 'Main and secondary batteries']
    if mount['battery'] == 'main':
        kit.barbette(mount)
    else:
        kit.gun_seat(mount)
    create_mount(mount, col, helpers, materials)
    if mount['partId'] == 'type96-25-kongo-single':
        # The shared single's ring sight hangs 8 cm off its rail; the sight's cross-wires, owned by
        # the same elevating joint, carry it on the rail's end.
        elev = bpy.data.objects[mount['id'] + '.center.elevation']
        for a, b in (((.13, .17, .21), (.13, .17, .41)), ((.13, .07, .31), (.13, .27, .31))):
            wire = kit.rod(mount['id'] + '.sight cross-wire', a, b, .007, 'edge', col, vertices=5)
            wire.parent = elev
            wire['assemblyId'] = mount['id']

# ---------------------------------------------------------------- fittings
takao_fittings.build(D, kit)

scene['definitionHash'] = D['contentHash']
scene['historicalConfiguration'] = D['configuration']
scene['accuracyStatus'] = 'GameModels3D-only fidelity target; see README approximations'
create_flagstaffs(D)
sys.path.insert(0, str(ROOT / 'assets/ships/appearance'))
from surface import apply_appearance
apply_appearance(scene, materials, Path(__file__).with_name('appearance.json'))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'source.blend'))
print('Takao original recipe:', len(scene.objects), 'objects; source saved')
