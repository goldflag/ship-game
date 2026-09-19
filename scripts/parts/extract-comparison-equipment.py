#!/usr/bin/env python3
"""Download only public GM3D geometry and extract local comparison equipment.

Run: python3 scripts/parts/extract-comparison-equipment.py [--part PART_ID]
Requires local Blender (BLENDER_BIN or /opt/homebrew/bin/blender). No textures,
credentials, production geometry, or downloaded files enter version control.
Selections live in tools/ship-overlay/catalog-reference-extractions.json.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

PROJECT = Path(__file__).resolve().parents[2]
ROOT = PROJECT / '.build/component-comparison/research/masts-funnels'
CONFIG = PROJECT / 'tools/ship-overlay/catalog-reference-extractions.json'


def fetch(url, path):
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + '.pending')
        subprocess.run(['curl', '--fail', '--location', '--silent', '--show-error', '--max-time', '60', '--user-agent', 'ShipOverlay/1.0', '--output', str(temporary), url], check=True)
        temporary.replace(path)
    return path.read_bytes()


def acquire(config):
    cache = ROOT / 'source-cache'
    models = {}
    schemes = {}
    for item in config:
        url = item['sourceUrl']
        data_root = item.get('dataRoot', 'https://gamemodels3d.com/games/worldofwarships/data/test/')
        resources = [item['resource'], *item.get('fittedResources', [])]
        for resource in resources:
            key = data_root + resource
            local = cache / (hashlib.sha256(key.encode()).hexdigest() + '.model')
            raw = fetch(key + '.model', local)
            if raw[:2] == b'\x1f\x8b':
                raw = gzip.decompress(raw)
            models[key] = json.loads(raw)
            if resource == item['resource'] and item.get('expectedModelSha256'):
                digest = hashlib.sha256(json.dumps(models[key], sort_keys=True, separators=(',', ':')).encode()).hexdigest()
                if digest != item['expectedModelSha256']:
                    raise RuntimeError(f'Source geometry changed for {item["partId"]}; inspect and revise the selection before rebuilding.')
        if item.get('sourceSelection') and url not in schemes:
            raw = fetch(url, cache / (hashlib.sha256(url.encode()).hexdigest() + '.html')).decode()
            marker = re.search(r'scheme\s*:\s*', raw)
            if not marker:
                raise RuntimeError(f'No public source scheme at {url}; do not bypass access controls.')
            schemes[url] = json.JSONDecoder().raw_decode(raw[marker.end():])[0]['visual']['default']
    pack = ROOT / 'extraction-input.json'
    pack.write_text(json.dumps({'items': config, 'models': models, 'schemes': schemes}))
    return pack


def run_blender(pack):
    import bpy
    import numpy as np
    from mathutils import Matrix, Vector
    from mathutils.bvhtree import BVHTree

    data = json.loads(pack.read_text())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.world = bpy.data.worlds.new('Reference studio')
    scene.world.color = (.18, .18, .18)
    scene.render.engine = 'BLENDER_WORKBENCH'
    shading = scene.display.shading
    shading.light = 'STUDIO'
    shading.color_type = 'SINGLE'
    shading.single_color = (.62, .68, .72)
    shading.show_cavity = True
    shading.cavity_type = 'BOTH'
    scene.render.resolution_x = scene.render.resolution_y = 650
    scene.render.resolution_percentage = 100
    out = ROOT / 'glb'
    out.mkdir(parents=True, exist_ok=True)

    def inside(point, lo, hi):
        return all(lo[k] - .001 <= point[k] <= hi[k] + .001 for k in range(3))

    def connected(points, faces, selected, numpy_weld=False):
        parent = {}
        def find(a):
            parent.setdefault(a, a)
            if parent[a] != a:
                parent[a] = find(parent[a])
            return parent[a]
        def coord(i):
            return tuple(np.round(points[i], 4)) if numpy_weld else tuple(round(float(x), 4) for x in points[i])
        for i in selected:
            vertices = [coord(a) for a in faces[i]]
            root = find(vertices[0])
            for a in vertices[1:]:
                parent[find(a)] = root
        groups = {}
        for i in selected:
            groups.setdefault(find(coord(faces[i][0])), set()).add(i)
        return sorted(groups.values(), key=len, reverse=True)

    def attached(points, faces, accepted, groups, tolerance, passes=100):
        pending = [group for group in groups if group and not group & accepted]
        for _ in range(passes):
            tree = BVHTree.FromPolygons(points, [faces[i] for i in accepted], all_triangles=True)
            remaining = []
            changed = False
            for group in pending:
                vertices = {a for i in group for a in faces[i]}
                if any(tree.find_nearest(points[a], tolerance)[0] is not None for a in vertices):
                    accepted.update(group)
                    changed = True
                else:
                    remaining.append(group)
            pending = remaining
            if not changed:
                break
        return accepted

    def assembled(scheme):
        import copy
        root = {'nodes': copy.deepcopy(scheme['A_Hull'])}
        def find(node, name):
            children = node.get('nodes', {})
            for key, child in enumerate(children) if isinstance(children, list) else children.items():
                if key == name:
                    return child
                result = find(child, name)
                if result is not None:
                    return result
        for category, entries in scheme.items():
            if category == 'A_Hull' or not isinstance(entries, dict):
                continue
            for name, payload in entries.items():
                target = find(root, name)
                if target is None:
                    continue
                for key, value in payload.items():
                    if key != 'transform':
                        target[key] = copy.deepcopy(value)
                rotation = payload.get('transform', {}).get('rotation')
                if rotation:
                    a = Matrix(target.get('transform', {}).get('matrix', Matrix.Identity(4))).transposed()
                    target['transform'] = {'matrix': [list(row) for row in (a @ Matrix(rotation).transposed()).transposed()]}
        return root

    summaries = []
    for item in data['items']:
        data_root = item.get('dataRoot', 'https://gamemodels3d.com/games/worldofwarships/data/test/')
        geometry = data['models'][data_root + item['resource']]['geometry'][item.get('geometryKey', '')]
        points = [Vector(geometry['position'][i:i + 3]) * 15 for i in range(0, len(geometry['position']), 3)]
        faces = [geometry['index'][i:i + 3] for i in range(0, len(geometry['index']), 3)]
        islands = connected(np.array(geometry['position']).reshape(-1, 3) * 15, faces, range(len(faces)), True)
        selection = item.get('sourceSelection')
        if selection:
            lo, hi = selection['min'], selection['max']
            selected = {f for group in islands if all(inside(points[a], lo, hi) for f in group for a in faces[f]) for f in group}
            for index in selection.get('forceIslands', []):
                selected.update(islands[index])
            for index in selection.get('partialIslands', []):
                partial = {f for f in islands[index] if all(inside(points[a], lo, hi) for a in faces[f])}
                groups = connected(points, faces, partial)
                if groups:
                    selected.update(groups[0])
            groups = [group & selected for group in islands]
            accepted = groups[selection['contactSeed']].copy()
            for index in selection.get('forceIslands', []):
                accepted.update(groups[index])
            selected = attached(points, faces, accepted, groups, .13)
            if 'retainAboveY' in selection:
                for group in groups:
                    if group and min(points[a].y for f in group for a in faces[f]) >= selection['retainAboveY']:
                        selected.update(group)
        else:
            lo, hi = item['boundsSourceMetres']
            selected = {i for i, face in enumerate(faces) if all(inside(points[a], lo, hi) for a in face)}
            if item.get('wholeIslandsOnly'):
                selected = {f for index, group in enumerate(islands) if index not in item.get('excludeIslands', []) and all(inside(points[a], lo, hi) for f in group for a in faces[f]) for f in group}
            for index in item['forceIslands']:
                selected.update(islands[index])
            groups = connected(points, faces, selected)
            accepted = set() if item['seed'] == 'forced islands only' else groups[0].copy()
            for index in item['forceIslands']:
                accepted.update(islands[index])
            selected = attached(points, faces, accepted, groups, .16, 8)
        assert selected, item['partId']
        ids = sorted(selected)
        vertices = sorted({a for i in ids for a in faces[i]})
        remap = {old: new for new, old in enumerate(vertices)}
        exported_points = [points[i] for i in vertices]
        exported_faces = [[remap[a] for a in faces[i]] for i in ids]
        if selection:
            tree = BVHTree.FromPolygons(points, [faces[i] for i in ids], all_triangles=True)
            def visit(node, parent):
                matrix = node.get('transform', {}).get('matrix')
                transform = parent @ Matrix(matrix).transposed() if matrix else parent
                resource = node.get('visual')
                if resource in item.get('fittedResources', []):
                    for geo in data['models'][data_root + resource]['geometry'].values():
                        ps = [(transform @ Vector(geo['position'][i:i + 3])) * 15 for i in range(0, len(geo['position']), 3)]
                        if all(inside(p, lo, hi) for p in ps) and any(tree.find_nearest(p, .2)[0] is not None for p in ps):
                            start = len(exported_points)
                            exported_points.extend(ps)
                            exported_faces.extend([[start + a for a in geo['index'][i:i + 3]] for i in range(0, len(geo['index']), 3)])
                children = node.get('nodes', {})
                for child in children if isinstance(children, list) else children.values():
                    visit(child, transform)
            visit(assembled(data['schemes'][item['sourceUrl']]), Matrix.Identity(4))
        mn = Vector([min(p[k] for p in exported_points) for k in range(3)])
        mx = Vector([max(p[k] for p in exported_points) for k in range(3)])
        datum = Vector(((mn.x + mx.x) / 2, mn.y, (mn.z + mx.z) / 2))
        # Blender X/Y/Z = source X/Z/Y; glTF exporter maps this to runtime X/Y/-Z.
        verts = [(p.x - datum.x, p.z - datum.z, p.y - datum.y) for p in exported_points]
        mesh = bpy.data.meshes.new(item['partId'])
        mesh.from_pydata(verts, [], [tuple(reversed(f)) for f in exported_faces])
        mesh.update()
        obj = bpy.data.objects.new(item['partId'], mesh)
        scene.collection.objects.link(obj)
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.export_scene.gltf(filepath=str(out / (item['partId'] + '.glb')), export_format='GLB', use_selection=True, export_yup=True, export_materials='NONE')
        size = mx - mn
        target = Vector((0, 0, size.y / 2))
        camera = bpy.data.objects.new('Review camera', bpy.data.cameras.new('Review camera'))
        scene.collection.objects.link(camera)
        camera.location = target + Vector((1, -1.4, .7)) * max(size)
        camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
        camera.data.type = 'ORTHO'
        camera.data.ortho_scale = max(size) * 1.5
        scene.camera = camera
        scene.render.filepath = str(out / (item['partId'] + '.png'))
        bpy.ops.render.render(write_still=True)
        summaries.append({'partId': item['partId'], 'triangles': len(exported_faces), 'sourceBoundsMetres': [list(mn), list(mx)], 'sourceFaceIds': ids})
        bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.objects.remove(camera, do_unlink=True)
    (ROOT / 'rebuilt-extractions.json').write_text(json.dumps(summaries, indent=2))


def main():
    if '--blender-pack' in sys.argv:
        run_blender(Path(sys.argv[sys.argv.index('--blender-pack') + 1]))
        return
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--part', help='Extract one catalog part instead of all 15 available counterparts')
    args = parser.parse_args()
    items = json.loads(CONFIG.read_text())['extractions']
    if args.part:
        items = [item for item in items if item['partId'] == args.part]
        if not items:
            parser.error('Unknown part or no confirmed extractable counterpart')
    pack = acquire(items)
    blender = os.environ.get('BLENDER_BIN', '/opt/homebrew/bin/blender')
    subprocess.run([blender, '--background', '--python-exit-code', '1', '--python', str(Path(__file__).resolve()), '--', '--blender-pack', str(pack)], check=True)


if __name__ == '__main__':
    main()
