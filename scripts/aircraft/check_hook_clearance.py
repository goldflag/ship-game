"""Inspect published hook/gear triangles in isolated background Blender.

Usage: blender --background --factory-startup --python-exit-code 1
       --python scripts/aircraft/check_hook_clearance.py -- all
Temporary evidence is keyed to the exact three published GLB hashes.
"""
import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('selection', nargs='?', default='all')
parser.add_argument('--output', default='.build/aircraft/hook-clearance.json')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
if not bpy.app.background:
    raise RuntimeError('Run in isolated background Blender; this check replaces its scratch scene')
catalog = json.loads((ROOT / 'assets/aircraft/catalog.json').read_text())['aircraft']
selected = [a for a in catalog if args.selection in ('all', a['id'])]
if not selected:
    raise ValueError('Unknown aircraft: ' + args.selection)


def geometry(objects):
    vertices, faces = [], []
    for obj in objects:
        if obj.type != 'MESH':
            continue
        offset = len(vertices)
        vertices.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
        faces.extend(tuple(offset + i for i in p.vertices) for p in obj.data.polygons)
    if not faces:
        raise ValueError('Missing independently owned hook or gear geometry')
    return BVHTree.FromPolygons(vertices, faces), vertices


records, failures = [], []
for aircraft in selected:
    model = aircraft['id']
    shape = json.loads((ROOT / f'assets/aircraft/shapes/{model}.json').read_text())
    gear = shape['gear']
    main_z = aircraft['length'] * (gear['mainU'] - .5) - .06
    tail_z = aircraft['length'] * (gear['tailU'] + .006 - .5)
    dy, dz = gear['tailWheelZM'] - gear['wheelZM'], tail_z - main_z
    pitch = math.atan2(dy, dz) - math.asin((.135 - gear['wheelRadiusM']) / math.hypot(dy, dz))
    clearance = gear['wheelRadiusM'] - gear['wheelZM'] * math.cos(pitch) + main_z * math.sin(pitch)
    for lod in range(3):
        path = ROOT / 'public/models/aircraft' / (f'LOD{lod}/{model}-lod{lod}.glb' if lod else f'{model}.glb')
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(path))
        original = list(bpy.context.scene.objects)
        root = bpy.data.objects.new('CPU resting pose', None)
        bpy.context.scene.collection.objects.link(root)
        for obj in original:
            if obj.parent is None:
                obj.parent = root
        root.location.z, root.rotation_euler.x = clearance, pitch
        nodes = {o.get('nodeId'): o for o in original if o.get('nodeId')}
        hook = nodes['arrestor.hook']
        hook.rotation_mode = 'QUATERNION'
        hook_base = hook.rotation_quaternion.copy()
        gears = [nodes[id] for id in ('gear.port', 'gear.starboard', 'gear.tail')]
        for joint in gears:
            joint.rotation_mode = 'QUATERNION'
        bases = [joint.rotation_quaternion.copy() for joint in gears]
        bpy.context.view_layer.update()
        _, hook_vertices = geometry(hook.children_recursive)
        minimum = min(v.z for v in hook_vertices)
        if minimum < .02:
            failures.append(f'{model}/LOD{lod}: stowed hook is only {minimum:.4f} m above the tyre plane')
        # Gear and hook controls vary independently. Fixed Val gear respects its
        # exported capability; no broad aircraft box substitutes for the fork.
        gear_trees = []
        for step in range(33):
            for joint, base in zip(gears, bases):
                angle = step / 32 * math.pi * .43
                angle *= 1 if joint['nodeId'].endswith('.port') else -1
                angle *= .5 if joint['nodeId'].endswith('.tail') else 1
                if joint.get('fixed') or joint.get('articulation') == 'fixed':
                    angle = 0
                axis = (1, 0, 0) if joint.get('axis') == 'spanwise' else (0, -1, 0)
                joint.rotation_quaternion = base @ Quaternion(axis, angle)
            bpy.context.view_layer.update()
            gear_trees.append(geometry([o for joint in gears for o in joint.children_recursive])[0])
        intersections = []
        for step in range(65):
            hook.rotation_quaternion = hook_base @ Quaternion((1, 0, 0), .65 * step / 64)
            bpy.context.view_layer.update()
            tree, _ = geometry(hook.children_recursive)
            for gear_step, other in enumerate(gear_trees):
                pairs = tree.overlap(other)
                if pairs:
                    intersections.append({'hook': step / 64, 'gearRetraction': gear_step / 32, 'trianglePairs': len(pairs)})
        if intersections:
            failures.append(f'{model}/LOD{lod}: hook intersects gear in {len(intersections)} sampled poses')
        records.append({'model': model, 'lod': lod, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                        'stowedMinimumY': minimum, 'hookSamples': 65, 'gearSamples': 33,
                        'intersections': intersections})
        print(f'{model}/LOD{lod}: stowed {minimum:.4f} m, {len(intersections)} conflicting poses', flush=True)
output = Path(args.output)
if not output.is_absolute():
    output = ROOT / output
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({'records': records, 'failures': failures}, indent=2) + '\n')
if failures:
    raise RuntimeError('; '.join(failures))
