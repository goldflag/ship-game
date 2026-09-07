"""Original Baltic paint, rasterized from authored metric shapes, never reference pixels.

Packed, ordinary glTF base-color images and mesh UVs make this finish portable.
No decals, extra faces, shader extensions, or runtime ship-name conditions.
"""
import json
from pathlib import Path

import bpy
import numpy as np


def rgb(value):
    return np.array([int(value[i:i + 2], 16) / 255 for i in (1, 3, 5)], dtype=np.float32)


def linear(value):
    return np.where(value <= 0.04045, value / 12.92, ((value + 0.055) / 1.055) ** 2.4)


def inside(x, y, polygon):
    """Vectorized even/odd polygon fill in the declared metric coordinate plane."""
    result = np.zeros(np.broadcast_shapes(x.shape, y.shape), dtype=bool)
    for (ax, ay), (bx, by) in zip(polygon, polygon[1:] + polygon[:1]):
        if ay != by:
            result ^= ((ay > y) != (by > y)) & (x < (bx - ax) * (y - ay) / (by - ay) + ax)
    return result


def grid(bounds, width, height):
    x0, x1, y0, y1 = bounds
    return (x0 + (np.arange(width, dtype=np.float32)[None, :] + 0.5) * (x1 - x0) / width,
            y0 + (np.arange(height, dtype=np.float32)[:, None] + 0.5) * (y1 - y0) / height)


def packed_image(name, pixels):
    height, width = pixels.shape[:2]
    image = bpy.data.images.new(name, width=width, height=height, alpha=False)
    image.colorspace_settings.name = 'sRGB'
    rgba = np.ones((height, width, 4), dtype=np.float32)
    # Byte-backed sRGB image pixels are encoded RGB; material constants are linear.
    rgba[:, :, :3] = np.clip(pixels, 0, 1)
    image.pixels.foreach_set(rgba.ravel())
    image.pack()
    return image


def image_material(material, image):
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new('ShaderNodeOutputMaterial')
    surface = nodes.new('ShaderNodeBsdfPrincipled')
    surface.inputs['Roughness'].default_value = 0.82
    surface.inputs['Metallic'].default_value = 0.04
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = image
    texture.interpolation = 'Linear'
    texture.extension = 'EXTEND'
    uv = nodes.new('ShaderNodeUVMap')
    uv.uv_map = 'UVMap'
    links = material.node_tree.links
    links.new(uv.outputs['UV'], texture.inputs['Vector'])
    links.new(texture.outputs['Color'], surface.inputs['Base Color'])
    links.new(surface.outputs['BSDF'], output.inputs['Surface'])


def side_atlas(spec, colors, finishes):
    width, tile_height, gutter = 2048, 512, 4
    bounds = spec['side']['bounds']
    x, z = grid(bounds, width, tile_height - 2 * gutter)
    tiles = []
    for finish in finishes:
        pixels = np.empty((tile_height - 2 * gutter, width, 3), dtype=np.float32)
        pixels[:] = colors[finish]
        for polygon in spec['side']['darkEnds']:
            pixels[inside(x, z, polygon)] = colors['roof']
        for polygon in spec['side']['falseWaves']:
            pixels[inside(x, z, polygon)] = colors['white']
        for band in spec['side']['bands']:
            for color in ('black', 'white'):
                pixels[inside(x, z, band[color])] = colors[color]
        # Exact waterline boundary, also on the low shell material's upper edge.
        pixels[np.broadcast_to(z < spec['side']['waterline'], pixels.shape[:2])] = colors['boot']
        tiles.append(np.pad(pixels, ((gutter, gutter), (0, 0), (0, 0)), mode='edge'))
    return packed_image('Original Baltic side paint', np.concatenate(tiles)), tile_height, gutter


def deck_image(spec, colors):
    deck = spec['deck']
    width, height = 4096, 1024
    x, y = grid(deck['bounds'], width, height)
    # Independent staggered teak boards; fine caulking uses pixel coverage so it
    # remains visible without moire or a second material layer over the deck.
    row = np.floor(y / deck['plankWidth'])
    along = x + np.mod(row, 2) * deck['plankLength'] / 2
    column = np.floor(along / deck['plankLength'])
    shade = np.mod(np.sin(row * 127.1 + column * 311.7) * 43758.5453, 1)
    grain = np.sin(x * 19 + y * 191) * 0.007 + np.sin(x * 3.1 - y * 327) * 0.008
    pixels = colors['teakDark'] + shade[:, :, None] * (colors['teakLight'] - colors['teakDark'])
    pixels += grain[:, :, None]
    for position, period, pixel_size in (
        (y, deck['plankWidth'], (deck['bounds'][3] - deck['bounds'][2]) / height),
        (along, deck['plankLength'], (deck['bounds'][1] - deck['bounds'][0]) / width),
    ):
        distance = np.abs(np.mod(position + period / 2, period) - period / 2)
        coverage = np.clip((deck['seamWidth'] / 2 + pixel_size / 2 - distance) / pixel_size, 0, 1)
        pixels = pixels * (1 - coverage[:, :, None]) + colors['caulking'] * coverage[:, :, None]
    for mark in deck['recognitionMarkings']:
        u, v = x - mark['centerX'], y
        field = np.broadcast_to(np.abs(u) <= mark['bandLength'] / 2, pixels.shape[:2])
        pixels[field] = colors['red']
        pixels[u * u + v * v <= (mark['discDiameter'] / 2) ** 2] = colors['white']
        # Upright clockwise hooked cross as painted in the supplied plan. The
        # same ship-local coordinates on both ends avoid mirroring either sign.
        a, b = u / (mark['symbolSize'] / 5), v / (mark['symbolSize'] / 5)
        cross = ((np.abs(a) <= .5) & (np.abs(b) <= 2.5)) | ((np.abs(b) <= .5) & (np.abs(a) <= 2.5))
        cross |= ((a >= -.5) & (a <= 2.5) & (b >= 1.5) & (b <= 2.5))
        cross |= ((a >= 1.5) & (a <= 2.5) & (b >= -2.5) & (b <= .5))
        cross |= ((a >= -2.5) & (a <= .5) & (b >= -2.5) & (b <= -1.5))
        cross |= ((a >= -2.5) & (a <= -1.5) & (b >= -.5) & (b <= 2.5))
        pixels[cross] = colors['black']
    return packed_image('Original teak and Baltic deck recognition', pixels)


def apply_paint(scene, materials, scheme_path):
    spec = json.loads(Path(scheme_path).read_text())
    if spec['version'] != 1:
        raise ValueError('Unsupported paint scheme version')
    colors = {key: rgb(value) for key, value in spec['palette'].items()}
    for key, material in materials.items():
        if key in colors:
            color = (*linear(colors[key]), 1)
            material.diffuse_color = color
            material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = color

    finishes = ('hullgray', 'naval', 'roof', 'edge')
    atlas, tile_height, gutter = side_atlas(spec, colors, finishes)
    painted = {}
    for index, finish in enumerate(finishes):
        material = materials[finish].copy()
        material.name = 'Baltic sides · ' + finish
        image_material(material, atlas)
        painted[materials[finish]] = (material, index)
    # Light fittings share the upperworks tile; retaining glass, canvas, bronze,
    # machinery and gun mechanisms keeps the paint off non-painted surfaces.
    painted[materials['light']] = painted[materials['naval']]
    deck_material = materials['deck']
    deck_material.name = 'Baltic teak and deck recognition · 1941'
    image_material(deck_material, deck_image(spec, colors))

    bpy.context.view_layer.update()
    side_faces, deck_faces = 0, 0
    for obj in scene.objects:
        if obj.type != 'MESH' or obj.get('exportRole') == 'simulation':
            continue
        slots = list(obj.data.materials)
        if not any(material in painted or material == deck_material for material in slots):
            continue
        uv = obj.data.uv_layers.get('UVMap') or obj.data.uv_layers.new(name='UVMap')
        replacements = {}
        for face in obj.data.polygons:
            original = slots[face.material_index]
            is_deck = original == deck_material
            # Articulated gun components keep their gray finish; fixed barbettes
            # and upperworks receive a single continuous ship-space projection.
            normal = obj.matrix_world.to_3x3() @ face.normal
            if not is_deck and (obj.parent or original not in painted or abs(normal.z) > .75):
                continue
            if is_deck:
                bounds = spec['deck']['bounds']
                deck_faces += 1
            else:
                bounds = spec['side']['bounds']
                material, tile = painted[original]
                if original not in replacements:
                    replacements[original] = len(obj.data.materials)
                    obj.data.materials.append(material)
                face.material_index = replacements[original]
                side_faces += 1
            x0, x1, y0, y1 = bounds
            for loop_index in face.loop_indices:
                vertex = obj.data.vertices[obj.data.loops[loop_index].vertex_index]
                point = obj.matrix_world @ vertex.co
                u = (point.x - x0) / (x1 - x0)
                v = ((point.y if is_deck else point.z) - y0) / (y1 - y0)
                if not is_deck:
                    v = (tile * tile_height + gutter + min(1, max(0, v)) * (tile_height - 2 * gutter)) / atlas.size[1]
                uv.data[loop_index].uv = (u, v)
    scene['paintScheme'] = spec['id']
    print('BALTIC PAINT', json.dumps({'sideFaces': side_faces, 'deckFaces': deck_faces, 'images': 2}), flush=True)
