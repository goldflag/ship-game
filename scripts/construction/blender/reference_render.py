"""Textured renders of a GameModels3D reference laid out by scripts/construction/referenceRender.ts, and
optionally of our published GLB (`model`) from the same cameras under the same light, written as pairs.

Viewing only: the scene is built from the ignored .build/ scratch files and is never saved. Ship metres
(+X starboard, +Y up, -Z bow) become Blender's bow +X, port +Y, up +Z, the repository's authoring axes.
"""
import bpy, json, sys
import numpy as np
from mathutils import Matrix, Vector

manifest = json.load(open(sys.argv[sys.argv.index('--') + 1]))
blob = open(manifest['scene'], 'rb').read()
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
scene = bpy.context.scene
to_blender = lambda p: (-p[2], -p[0], p[1])

for number, bucket in enumerate(manifest['buckets']):
    n, t = bucket['vertices'], bucket['triangles']
    positions = np.frombuffer(blob, dtype='<f4', count=n * 3, offset=bucket['positions']).reshape(-1, 3)
    uv = np.frombuffer(blob, dtype='<f4', count=n * 2, offset=bucket['uv']).reshape(-1, 2)
    index = np.frombuffer(blob, dtype='<u4', count=t * 3, offset=bucket['index']).reshape(-1, 3)
    verts = np.stack([-positions[:, 2], -positions[:, 0], positions[:, 1]], axis=1)
    mesh = bpy.data.meshes.new(f'reference-{number}')
    mesh.from_pydata(verts.tolist(), [], index.tolist())
    layer = mesh.uv_layers.new()
    loops = np.zeros(len(mesh.loops), dtype=np.int32)
    mesh.loops.foreach_get('vertex_index', loops)
    # Source UVs have v running down the image, as three.js reads them without flipping.
    coords = uv[loops].copy()
    coords[:, 1] = 1 - coords[:, 1]
    layer.data.foreach_set('uv', coords.ravel())
    material = bpy.data.materials.new(f'reference-{number}')
    material.use_nodes = True
    shader = material.node_tree.nodes['Principled BSDF']
    shader.inputs['Roughness'].default_value = .8
    if bucket['texture']:
        image = material.node_tree.nodes.new('ShaderNodeTexImage')
        image.image = bpy.data.images.load(bucket['texture'])
        material.node_tree.links.new(image.outputs['Color'], shader.inputs['Base Color'])
    else:
        shader.inputs['Base Color'].default_value = (*bucket['color'], 1)
    mesh.materials.append(material)
    obj = bpy.data.objects.new(f'reference-{number}', mesh)
    scene.collection.objects.link(obj)
reference_objects = [obj for obj in scene.objects if obj.type == 'MESH']

# Optional: our published GLB under the same light and cameras. The glTF importer puts runtime (x, y, z) at
# Blender (x, -z, y); a -90 degree turn about Z brings that to this script's bow +X, port +Y, up +Z.
ours_objects = []
if manifest.get('model'):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=manifest['model'])
    imported = [obj for obj in bpy.data.objects if obj not in before]
    for obj in imported:
        if obj.type in ('LIGHT', 'CAMERA'):
            bpy.data.objects.remove(obj, do_unlink=True)
    imported = [obj for obj in bpy.data.objects if obj not in before]
    root = bpy.data.objects.new('ours-root', None)
    scene.collection.objects.link(root)
    for obj in imported:
        if obj.parent is None:
            obj.parent = root
    root.rotation_euler.z = -np.pi / 2
    ours_objects = [obj for obj in imported if obj.type == 'MESH']

engines = [item.identifier for item in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
scene.view_settings.view_transform = 'Standard'
scene.world = bpy.data.worlds.new('reference light')
scene.world.use_nodes = True
background = scene.world.node_tree.nodes['Background']
background.inputs['Color'].default_value = (.86, .88, .9, 1)
background.inputs['Strength'].default_value = 1.0
sun = bpy.data.lights.new('sun', 'SUN')
sun.energy = 2.5
sun_object = bpy.data.objects.new('sun', sun)
scene.collection.objects.link(sun_object)
sun_object.rotation_euler = (0.9, 0.2, -0.6)
data = bpy.data.cameras.new('camera')
camera = bpy.data.objects.new('camera', data)
scene.collection.objects.link(camera)
scene.camera = camera
scene.render.image_settings.file_format = 'PNG'

for shot in manifest['shots']:
    eye, target, up = Vector(to_blender(shot['eye'])), Vector(to_blender(shot['target'])), Vector(to_blender(shot['up']))
    forward = (target - eye).normalized()
    right = forward.cross(up).normalized()
    true_up = right.cross(forward)
    camera.matrix_world = Matrix.Translation(eye) @ Matrix((right, true_up, -forward)).transposed().to_4x4()
    if shot.get('ortho'):
        data.type = 'ORTHO'
        data.ortho_scale = shot['ortho']
    else:
        data.type = 'PERSP'
        data.sensor_fit = 'VERTICAL'
        data.angle_y = np.radians(shot.get('fov') or 35)
    data.clip_start, data.clip_end = shot.get('clip') or (.05, (eye - target).length * 3 + 2000)
    scene.render.resolution_x, scene.render.resolution_y = shot['size']
    base = f"{manifest['directory']}/{shot['name']}"
    if not ours_objects:
        scene.render.filepath = base + '.png'
        bpy.ops.render.render(write_still=True)
        continue
    images = []
    for side, shown, hidden in (('reference', reference_objects, ours_objects), ('ours', ours_objects, reference_objects)):
        for obj in shown: obj.hide_render = False
        for obj in hidden: obj.hide_render = True
        scene.render.filepath = f'{base}-{side}.png'
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(f'{base}-{side}.png')
        w, h = image.size
        pixels = np.empty(w * h * 4, np.float32)
        image.pixels.foreach_get(pixels)
        bpy.data.images.remove(image)
        images.append(pixels.reshape(h, w, 4))
    # Wide views stack (reference above), square ones sit side by side (reference left), 12 px apart.
    a, b = images
    h, w = a.shape[:2]
    gap = 12
    if w > h * 1.3:
        pair = np.ones((h * 2 + gap, w, 4), np.float32)
        pair[h + gap:], pair[:h] = a, b
    else:
        pair = np.ones((h, w * 2 + gap, 4), np.float32)
        pair[:, :w], pair[:, w + gap:] = a, b
    out = bpy.data.images.new(shot['name'] + '-pair', pair.shape[1], pair.shape[0], alpha=True)
    out.pixels.foreach_set(pair.ravel())
    out.filepath_raw = base + '-pair.png'
    out.file_format = 'PNG'
    out.save()
    bpy.data.images.remove(out)
