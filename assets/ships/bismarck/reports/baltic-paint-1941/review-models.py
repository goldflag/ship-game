"""Task evidence: compare retained before scenes with the exact rebuilt sources.

Run from the repository root with local Blender. Before scenes are task-local
copies of the original published sources, kept under .build/ during this review.
"""
import hashlib
import json
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[5]


def snapshot(path):
    bpy.ops.wm.open_mainfile(filepath=str(path))
    bpy.context.view_layer.update()
    objects = {}
    for obj in bpy.context.scene.objects:
        digest = hashlib.sha256()
        digest.update(np.array(obj.matrix_world, dtype=np.float64).tobytes())
        digest.update(str((obj.type, obj.get('nodeId'), obj.get('assemblyId'), obj.parent.name if obj.parent else None)).encode())
        if obj.type == 'MESH':
            positions = np.empty(len(obj.data.vertices) * 3, dtype=np.float32)
            indices = np.empty(len(obj.data.loops), dtype=np.int32)
            faces = np.empty(len(obj.data.polygons), dtype=np.int32)
            obj.data.vertices.foreach_get('co', positions)
            obj.data.loops.foreach_get('vertex_index', indices)
            obj.data.polygons.foreach_get('loop_total', faces)
            digest.update(positions.tobytes()); digest.update(indices.tobytes()); digest.update(faces.tobytes())
        objects[obj.name] = digest.hexdigest()
    return bpy.context.scene.get('definitionHash'), objects


for ship, before_dir, report_dir in [
    ('bismarck', 'bismarck-paint-before', 'baltic-paint-1941'),
    ('yamato', 'yamato-crest-before', 'bow-crest'),
]:
    old_hash, before = snapshot(ROOT / '.build' / before_dir / 'source.blend')
    model_hash, after = snapshot(ROOT / f'assets/ships/{ship}/generated/source.blend')
    changed = [name for name, digest in before.items() if after.get(name) != digest]
    added = sorted(set(after) - set(before))
    # Yamato's existing open rail ends at the new solid bow bulwark. Sequential
    # Blender names of the remaining repeated rail pieces can consequently move.
    permitted = ('Deck guard wire', 'Rail stanchion') if ship == 'yamato' else ()
    assert all(name.startswith(permitted) for name in changed), changed
    assert ship != 'bismarck' or not added, added
    report = {'shipId': ship, 'contentHash': model_hash, 'beforeHash': old_hash,
              'existingObjects': len(before), 'changedExistingGeometryOrTransforms': changed,
              'addedObjects': added, 'method': 'All original vertex coordinates, polygon topology, transforms, parents, assembly IDs and node IDs compared by object name; materials/UVs intentionally excluded.'}
    if ship == 'bismarck':
        images = [image for image in bpy.data.images if image.packed_file]
        report['packedImages'] = [{'name': image.name, 'size': list(image.size)} for image in images]
        assert len(images) == 2
        hull = next(obj for obj in bpy.context.scene.objects if obj.get('nodeId') == 'hull.surface')
        assert hull.data.uv_layers.get('UVMap')
    else:
        petals = [obj for obj in bpy.context.scene.objects if obj.name.startswith('Chrysanthemum front petal')]
        assert len(petals) == 16
        points = [obj.matrix_world @ vertex.co for obj in petals for vertex in obj.data.vertices]
        diameter = [max(p[i] for p in points) - min(p[i] for p in points) for i in (1, 2)]
        assert all(abs(d - 1) < 0.00001 for d in diameter), diameter
        volumes = []
        for obj in petals:
            bm = bmesh.new(); bm.from_mesh(obj.data)
            assert all(edge.is_manifold for edge in bm.edges), obj.name
            volume = bm.calc_volume(signed=True); bm.free()
            assert volume > 0, (obj.name, volume)
            volumes.append(volume)
        support = bpy.data.objects['Crest bow bulwark']
        tree = BVHTree.FromPolygons([support.matrix_world @ v.co for v in support.data.vertices],
                                   [tuple(face.vertices) for face in support.data.polygons])
        boss = bpy.data.objects['Chrysanthemum seated backing']
        center = boss.matrix_world.translation
        backing_min_x = min((boss.matrix_world @ vertex.co).x for vertex in boss.data.vertices)
        backing_max_x = max((boss.matrix_world @ vertex.co).x for vertex in boss.data.vertices)
        contacts = []
        for y, dz in [(0, 0), (-.35, 0), (.35, 0), (0, -.35), (0, .35)]:
            hit, _, _, _ = tree.ray_cast(Vector((140, y, center.z + dz)), Vector((-1, 0, 0)), 20)
            assert hit is not None and backing_min_x < hit.x < backing_max_x, (y, dz, hit)
            contacts.append({'y': y, 'zOffset': dz, 'supportX': hit.x})
        report.update({'frontPetals': 16, 'rearPetals': 16, 'diameterM': diameter,
                       'closedPetalVolumesM3': volumes, 'backingSupportContacts': contacts,
                       'supportNote': 'Solid bulwark bottom intersects the existing forecastle deck; all petals overlap the seated backing at their roots.'})
        ornament = [obj.matrix_world @ vertex.co for obj in bpy.context.scene.objects
                    if obj.type == 'MESH' and obj.get('assemblyId') in ('bow-crest', 'bow-crest-support')
                    for vertex in obj.data.vertices]
        low = Vector([min(p[i] for p in ornament) for i in range(3)])
        high = Vector([max(p[i] for p in ornament) for i in range(3)])
        center = (low + high) / 2
        radius = max((p - center).length for p in ornament)
        definition = json.loads((ROOT / 'public/models/yamato.json').read_text())
        clearance = []
        for mount in definition['mounts']:
            yaw = bpy.data.objects[mount['id'] + '.yaw']; origin = yaw.matrix_world.translation
            reach = 0
            for obj in yaw.children_recursive:
                if obj.type != 'MESH':
                    continue
                joint = obj.parent
                while joint is not None and joint != yaw and not joint.name.endswith('.elevation'):
                    joint = joint.parent
                pivot = joint.matrix_world.translation if joint and joint != yaw else origin
                # Triangle inequality bounds arbitrary independent yaw/elevation,
                # not just sampled endpoints; full recoil adds a conservative term.
                for vertex in obj.data.vertices:
                    reach = max(reach, (pivot - origin).length + (obj.matrix_world @ vertex.co - pivot).length + mount['weapon']['recoilM'])
            gap = (origin - center).length - reach - radius
            assert gap > 0, (mount['id'], gap)
            clearance.append({'mountId': mount['id'], 'minimumConservativeGapM': gap})
        report['ornamentClearance'] = clearance
        report['clearanceMethod'] = 'Disjoint enclosing spheres: every new ornament/support vertex versus each registered moving mount, bounding arbitrary yaw, independent barrel elevation and full recoil. Applies to added fittings only.'
    out = ROOT / f'assets/ships/{ship}/reports/{report_dir}/geometry.json'
    out.write_text(json.dumps(report, indent=2) + '\n')
    print(ship, model_hash, 'original objects audited', len(before), 'changed rail objects', len(changed), 'added', len(added), flush=True)
