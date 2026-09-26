"""Original IJN Fusō recipe, 1943 fit, the reference's source (default) paint.

Blueprint meters: +Y up, -Z bow. Authoring meters: +X bow, +Y port, +Z up. The
shared exporter owns the sole basis conversion. Proportions follow the approved
GameModels3D pjsb006 B hull; no reference geometry or texture is loaded.
Region modules (fuso_*.py) each build one part of the ship from the shared
helpers passed to them.
"""
import bpy
import math
import json
import os
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'scripts/ships'))
from blender_fidelity import authored_hull, authored_structure
from blender_supports import SupportSurface
from blender_rig import create_flagstaffs
sys.path.insert(0, str(ROOT / 'assets/parts'))
from library import create_mount
sys.path.insert(0, str(Path(__file__).parent))
from fuso_kit import Kit, P, LINOLEUM_EDGE, linoleum_edge
import fuso_pagoda
import fuso_midships
import fuso_aft
import fuso_hull

# Region modules in build order; each may claim measured prisms it draws itself.
REGIONS = [fuso_pagoda, fuso_midships, fuso_aft, fuso_hull]
CLAIMED = set().union(*(region.CLAIMED_STRUCTURES for region in REGIONS))

OUT = Path(os.environ['SHIP_OUTPUT'])
D = json.loads(Path(os.environ['SHIP_DEFINITION']).read_text())
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
scene.world = bpy.data.worlds.new('Fusō review world')
scene.world.color = (.08, .10, .12)
collections = {}
for name in ['Hull and decks', 'Superstructure', 'Main and secondary batteries', 'Light AA', 'Sensors and masts', 'Boats and aviation', 'Deck fittings', 'Underwater fittings']:
    col = bpy.data.collections.new(name)
    scene.collection.children.link(col)
    collections[name] = col

# Reference source paint: light blue-grey hull and upperworks, grey steel roofs, the casemate ledge and
# quarterdeck steel, natural wood weather decks, a linoleum aircraft deck with brass strips, black funnel cap,
# red-oxide bottom to the waterline. Linear RGB interpretations; appearance.json binds the named paints.
colors = {'naval': (.090, .095, .112), 'hullgray': (.090, .095, .112), 'roof': (.076, .080, .094), 'deck': (.128, .095, .060),
          'linoleum': (.090, .046, .036), 'edge': (.038, .038, .040), 'painted-edge': (.074, .078, .090), 'dark': (.012, .013, .014),
          'black': (.012, .012, .013), 'canvas': (.55, .53, .44), 'antifouling': (.092, .058, .038), 'bronze': (.36, .27, .12),
          'glass': (.02, .04, .05), 'wood': (.19, .13, .075), 'white': (.30, .31, .30), 'gold': (.62, .45, .12),
          'sidelight-red': (.42, .02, .02), 'sidelight-green': (.02, .30, .07), 'searchlight-face': (.16, .18, .20)}
materials = {}
for key, color in colors.items():
    m = bpy.data.materials.new('Fusō ' + key)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = .76
    p.inputs['Metallic'].default_value = .05
    materials[key] = m


def mat(value):
    return materials[value] if isinstance(value, str) else value


def mesh(name, vertices, faces, material=None, col=None, smooth=False):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    ob = bpy.data.objects.new(name, data)
    (col or collections['Hull and decks']).objects.link(ob)
    if material is not None:
        data.materials.append(mat(material))
    for poly in data.polygons:
        poly.use_smooth = smooth
    return ob


def cyl(name, loc, radius, depth, material='naval', col=None, vertices=24, r2=None):
    r2 = radius if r2 is None else r2
    depth = max(.002, depth)
    vv = [(r * math.cos(math.tau * i / vertices), r * math.sin(math.tau * i / vertices), z) for r, z in [(radius, -depth / 2), (r2, depth / 2)] for i in range(vertices)]
    ff = [tuple(reversed(range(vertices))), tuple(range(vertices, 2 * vertices))] + [(i, (i + 1) % vertices, (i + 1) % vertices + vertices, i + vertices) for i in range(vertices)]
    ob = mesh(name, vv, ff, material, col, True)
    ob.location = loc
    ob.data.polygons[0].use_smooth = False
    ob.data.polygons[1].use_smooth = False
    return ob


def rod(name, a, b, r, material='edge', col=None, r2=None, vertices=10):
    a, b = Vector(a), Vector(b)
    ob = cyl(name, (a + b) / 2, r, (b - a).length, material, col, vertices, r2)
    ob.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
    return ob


def box(name, loc, dim, material='naval', col=None, bev=0):
    dx, dy, dz = [v / 2 for v in dim]
    vv = [(sx * dx, sy * dy, sz * dz) for sx, sy, sz in [(-1, -1, -1), (-1, 1, -1), (1, 1, -1), (1, -1, -1), (-1, -1, 1), (-1, 1, 1), (1, 1, 1), (1, -1, 1)]]
    ob = mesh(name, vv, [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], material, col)
    ob.location = loc
    return ob


helpers = dict(mesh=mesh, cyl=cyl, rod=rod, box=box)
H = D['hull']
L = H['length']

# ---------------------------------------------------------------- hull
hull = authored_hull(H, mesh, collections['Hull and decks'], [materials['hullgray'], materials['antifouling']], False)
for key in ['deck', 'roof', 'linoleum']:
    hull.data.materials.append(materials[key])
ZC = -1.095
# The linoleum's chevron edge splits the quarterdeck's faces (as the waterline splits the sides), so the paint
# boundary follows it rather than the loft's stations.
import bmesh
bm = bmesh.new()
bm.from_mesh(hull.data)
for (x0, z0), (x1, z1) in zip(LINOLEUM_EDGE, LINOLEUM_EDGE[1:]):
    for side in (-1, 1):
        a, b = Vector((-z0, -side * x0, 0)), Vector((-z1, -side * x1, 0))
        normal = (b - a).cross(Vector((0, 0, 1))).normalized()
        deck = [f for f in bm.faces if f.normal.z > .96 and 3.5 < f.calc_center_median().z < 4.3 and -86 < f.calc_center_median().x < -75]
        if deck:
            geom = list({e for f in deck for e in f.edges}) + list({v for f in deck for v in f.verts}) + deck
            bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=a, plane_no=normal)
bm.to_mesh(hull.data)
bm.free()
for face in hull.data.polygons:
    if face.normal.z > .96 and face.center.z > 0:
        zref = -face.center.x + ZC
        face.material_index = 2
        # The casemate ledge outboard of the forecastle wall is steel; the quarterdeck abaft the linoleum's chevron
        # edge is the linoleum aircraft deck.
        if face.center.z < 4.3 and zref < 52.5:
            face.material_index = 3
        elif face.center.z < 4.3 and -face.center.x > linoleum_edge(face.center.y):
            face.material_index = 4

# ---------------------------------------------------------------- superstructure
ROOFS = {}
shells = []
for s in D['structures']:
    ob = authored_structure(s, mesh, materials, collections['Superstructure'])
    ob.data.materials.append(materials[ROOFS.get(s['id'], 'roof')])
    ob.data.materials.append(materials['black'])
    funnel = s['id'] == 'funnel'
    for face in ob.data.polygons:
        if funnel:
            face.use_smooth = abs(face.normal.z) < .8
            if face.normal.z > .8:
                face.material_index = 2
        elif face.normal.z > .8:
            face.material_index = 1
    shells.append(ob)
support = SupportSurface([hull, *shells])
# Claimed prisms still support fittings; their region draws the visible replacement.
for ob in [o for o in shells if o['assemblyId'] in CLAIMED]:
    shells.remove(ob)
    bpy.data.objects.remove(ob, do_unlink=True)
kit = Kit(D, helpers, materials, collections, support)

# ---------------------------------------------------------------- guns
arm = collections['Main and secondary batteries']
light = collections['Light AA']
for mount in D['mounts']:
    x, y, z = -mount['position'][2], -mount['position'][0], mount['position'][1]
    kind = mount['partId']
    col = light if kind.startswith('type96') else arm
    radius = mount['weapon']['barbetteRadius']
    if mount['battery'] == 'main':
        # The Kongō turret recipe bears on a shallow roller ring 3.14 m above its yaw datum; the ship owns the
        # barbette (4.82 m, as the reference's) from the supporting deck up to that plane.
        top = z + 3.14
        floor = support.below(x, y, top - .05)
        ob = cyl(mount['id'] + '.barbette', (x, y, (floor + top) / 2), 4.82, top - floor + .02, 'naval', arm, 72)
        ob['assemblyId'] = mount['id']
        kit.barbette_details(mount, floor, top)
    else:
        floor = min(z, support.below(x, y, z + .5))
        if z - floor > .02 and not kind.startswith(('type96', 'type89')):
            ob = cyl(mount['id'] + '.barbette', (x, y, (floor + z) / 2), radius, z - floor + .02, 'naval', col, 40)
            ob['assemblyId'] = mount['id']
        if kind.startswith('type89') or kind == 'type96-25-mogami-2':
            kit.gun_tub(mount, floor)
        elif kind.startswith('type96') and z - floor > .02:
            kit.cylz(mount['id'], col, 'pedestal plate', (x, y, floor), .45, z - floor + .01, 'naval', 16)
    create_mount(mount, col, helpers, materials)
    if kind == 'type96-25-kongo-single':
        # The shared single's ring sight hangs 8 cm clear of its rail (a part defect this recipe works round
        # without editing the shared builder): two spokes join the ring to the rail's end, on the ring's own
        # elevation node so they follow the gun.
        ring = bpy.data.objects.get(mount['id'] + '.ring-sight')
        if ring is not None:
            hub = Vector((.13, .17, .31))
            for dy, dz in ((.1, 0), (0, .1), (0, -.1)):
                spoke = rod(mount['id'] + '.ring-sight spoke', hub, hub + Vector((0, dy, dz)), .008, 'edge', col, vertices=6)
                spoke.parent = ring.parent
                spoke['assemblyId'] = mount['id']

# ---------------------------------------------------------------- regions
for region in REGIONS:
    region.build(D, kit)
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
print('Fusō original recipe:', len(scene.objects), 'objects; source saved')
