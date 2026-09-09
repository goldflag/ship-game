"""Original metric surface textures; ordinary packed sRGB images and frozen UVs.

No external pixels, new geometry, baked illumination or runtime shader hooks.
Material role bindings are recipe inputs to the existing ship blueprint pipeline.
"""
import json
from pathlib import Path

import bpy
import numpy as np


def noise(x, y, scale, seed):
    """Smooth deterministic value noise in meters, independent of image size."""
    u, v = x / scale, y / scale
    i, j = np.floor(u), np.floor(v)
    a, b = u - i, v - j
    a, b = a * a * (3 - 2 * a), b * b * (3 - 2 * b)

    def sample(dx, dy):
        return np.mod(np.sin((i + dx) * 127.1 + (j + dy) * 311.7 + seed * 17.3) * 43758.5453, 1)

    return ((sample(0, 0) * (1 - a) + sample(1, 0) * a) * (1 - b)
            + (sample(0, 1) * (1 - a) + sample(1, 1) * a) * b) * 2 - 1


def encode_srgb(linear):
    linear = np.clip(linear, 0, 1)
    return np.where(linear <= .0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - .055)


def decode_srgb(encoded):
    return np.where(encoded <= .04045, encoded / 12.92, ((encoded + .055) / 1.055) ** 2.4)


def packed_image(name, pixels):
    height, width = pixels.shape[:2]
    image = bpy.data.images.new(name, width=width, height=height, alpha=False)
    image.colorspace_settings.name = 'sRGB'
    rgba = np.ones((height, width, 4), dtype=np.float32)
    rgba[:, :, :3] = pixels
    image.pixels.foreach_set(rgba.ravel())
    image.pack()
    return image


def enhance_original_image(image, layout, finish, name):
    """Keep an original scheme and UV atlas; vary its reflectance in metric space.

    Existing byte-backed paint images contain the RGB bytes exported to glTF,
    including older images tagged Non-Color. Treat those bytes as sRGB here so
    the published colors survive and Blender previews agree with the runtime.
    """
    width, height = image.size
    original = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(original)
    original = original.reshape(height, width, 4)
    pixels = original[:, :, :3].copy()
    tiles, gutter = layout.get('tiles', 1), layout.get('gutter', 0)
    if height % tiles:
        raise ValueError('Paint atlas height must divide into complete tiles')
    tile_height = height // tiles
    x0, x1, y0, y1 = layout['bounds']
    x = x0 + (np.arange(width, dtype=np.float32)[None, :] + .5) * (x1 - x0) / width
    y = y0 + (np.arange(tile_height - 2 * gutter, dtype=np.float32)[:, None] + .5) * (y1 - y0) / (tile_height - 2 * gutter)
    # Existing schemes already carry fine detail: keep it and add gentle fading.
    variation = finish['variation'] * (.65 * noise(x, y, 1.3, 2) + .35 * noise(x, y, .31, 5))
    variation = np.pad(variation, ((gutter, gutter), (0, 0)), mode='edge')
    for tile in range(tiles):
        rows = slice(tile * tile_height, (tile + 1) * tile_height)
        pixels[rows] = encode_srgb(decode_srgb(pixels[rows]) * (1 + variation[:, :, None]))
    return packed_image(name, pixels)


def surface_pixels(color, finish, hull=None):
    tile = finish['tileMeters']
    if hull:
        x0, x1, y0, y1 = hull['bounds']
        # Power-of-two allocation, selected from physical surface dimensions.
        width, height = [2 ** int(np.ceil(np.log2(span * hull['pixelsPerMeter'])))
                         for span in (x1 - x0, y1 - y0)]
        if width > 4096 or height > 2048:
            raise ValueError('Surface exceeds texture budget; split the authored surface or lower density')
    else:
        x0, x1, y0, y1 = 0, tile, 0, tile
        width = height = 512
    x = x0 + (np.arange(width, dtype=np.float32)[None, :] + .5) * (x1 - x0) / width
    y = y0 + (np.arange(height, dtype=np.float32)[:, None] + .5) * (y1 - y0) / height

    def field(a, b):
        return (finish['variation'] * (.65 * noise(a, b, 1.3, 2) + .35 * noise(a, b, .31, 5))
                + finish['grain'] * noise(a, b, .045, 11))

    variation = field(x, y)
    if not hull:
        # Blend translated fields so the texture repeats without visible seams.
        u, v = x / tile, y / tile
        variation = ((variation * (1 - u) + field(x - tile, y) * u) * (1 - v)
                     + (field(x, y - tile) * (1 - u) + field(x - tile, y - tile) * u) * v)
        if finish.get('woodGrain'):
            variation += .025 * np.sin(y * np.pi * 2 * 96 / tile + .3 * np.sin(x * np.pi * 2 / tile))
    else:
        # Soft irregular runoff and a narrow tide stain, not a drawn plate grid.
        tide = hull['waterline'] + .07 * noise(x, 0, 1.2, 8)
        variation -= hull['stainStrength'] * np.exp(-((y - tide) / .27) ** 2)
        streak = np.maximum(0, noise(x, 0, .21, 17) - .20) ** 2
        vertical = .5 + .5 * noise(x * .05, y, 1.9, 4)
        variation -= hull['runoffStrength'] * streak * vertical
    return encode_srgb(np.asarray(color)[None, None, :] * (1 + variation[:, :, None]))


def apply_appearance(scene, materials, config_path):
    spec = json.loads(Path(config_path).read_text())
    library = json.loads(Path(__file__).with_name('finishes.json').read_text())
    if spec['version'] != 1 or library['version'] != 1:
        raise ValueError('Unsupported ship appearance version')
    bindings, images = {}, {}
    for role, binding in spec['materials'].items():
        material = materials[role]
        surface = material.node_tree.nodes.get('Principled BSDF')
        if surface is None:
            raise ValueError('Appearance needs a Principled surface: ' + role)
        color = spec.get('palette', {}).get(binding['paint'], list(surface.inputs['Base Color'].default_value[:3]))
        if len(color) != 3 or not all(0 <= c <= 1 for c in color):
            raise ValueError('Paint must contain three linear RGB values between zero and one')
        finish = dict(library['finishes'][binding['finish']])
        finish['woodGrain'] = binding['finish'] == 'wood'
        material['paintId'] = binding['paint']
        material['surfaceFinish'] = binding['finish']
        surface.inputs['Roughness'].default_value = finish['roughness']
        surface.inputs['Metallic'].default_value = finish['metallic']
        if surface.inputs['Base Color'].is_linked:
            existing = binding.get('existing')
            if existing == 'procedural':
                # The common exporter already bakes these original teak planks.
                # Keep their authored plank geometry, grain and color nodes.
                if not material.name.startswith('Teak decking'):
                    raise ValueError('Only exporter-supported teak can retain procedural color')
                continue
            source = surface.inputs['Base Color'].links[0].from_node
            if existing != 'image' or source.type != 'TEX_IMAGE' or source.image is None:
                raise ValueError('Refusing to replace an existing paint pattern: ' + role)
            key = (source.image.name, json.dumps(binding['imageLayout'], sort_keys=True), binding['finish'])
            if key not in images:
                images[key] = enhance_original_image(source.image, binding['imageLayout'], finish, spec['id'] + ' ' + role)
            source.image = images[key]
            # Preserve the source texture node and all existing UV coordinates.
            continue
        if binding.get('existing'):
            raise ValueError('Expected an existing paint pattern: ' + role)
        hull = spec['hull'] if binding.get('projection') == 'hull' else None
        # One neutral texture can serve many paint swatches through glTF's
        # standard baseColorFactor. This keeps fleet texture/memory costs bounded.
        neutral = .875
        if max(color) > neutral:
            raise ValueError('Paint swatch exceeds neutral-texture factor range')
        key = (binding['finish'], json.dumps(hull, sort_keys=True))
        if key not in images:
            images[key] = packed_image(spec['id'] + ' ' + binding['finish'] + (' hull' if hull else ''), surface_pixels([neutral] * 3, finish, hull))
        image = images[key]
        material.diffuse_color = (*color, 1)
        surface.inputs['Base Color'].default_value = (*color, 1)
        uv = material.node_tree.nodes.new('ShaderNodeUVMap')
        uv.uv_map = 'SurfaceUV'
        texture = material.node_tree.nodes.new('ShaderNodeTexImage')
        texture.image = image
        texture.extension = 'EXTEND' if hull else 'REPEAT'
        material.node_tree.links.new(uv.outputs['UV'], texture.inputs['Vector'])
        tint = material.node_tree.nodes.new('ShaderNodeMix')
        tint.data_type = 'RGBA'
        tint.blend_type = 'MULTIPLY'
        tint.inputs[0].default_value = 1
        tint.inputs[7].default_value = (*(c / neutral for c in color), 1)
        material.node_tree.links.new(texture.outputs['Color'], tint.inputs[6])
        material.node_tree.links.new(tint.outputs[2], surface.inputs['Base Color'])
        bindings[material] = (hull, finish['tileMeters'])

    bpy.context.view_layer.update()
    for obj in scene.objects:
        if obj.type != 'MESH' or not any(m in bindings for m in obj.data.materials):
            continue
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        uv = obj.data.uv_layers.get('SurfaceUV') or obj.data.uv_layers.new(name='SurfaceUV')
        normal_matrix = obj.matrix_world.to_3x3().inverted().transposed()
        for polygon in obj.data.polygons:
            binding = bindings.get(obj.data.materials[polygon.material_index])
            if binding is None:
                continue
            hull, tile = binding
            normal = normal_matrix @ polygon.normal
            axis = max(range(3), key=lambda i: abs(normal[i]))
            for index in polygon.loop_indices:
                point = obj.matrix_world @ obj.data.vertices[obj.data.loops[index].vertex_index].co
                if hull:
                    x0, x1, z0, z1 = hull['bounds']
                    coord = ((point.x - x0) / (x1 - x0), (point.z - z0) / (z1 - z0))
                else:
                    a, b = (point.x, point.y) if axis == 2 else ((point.x, point.z) if axis == 1 else (point.y, point.z))
                    coord = (a / tile, b / tile)
                uv.data[index].uv = coord
    scene['appearanceId'] = spec['id']
