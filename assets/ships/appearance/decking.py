"""Original planked deck color and relief, independent of its paint/stain color."""
import json
from pathlib import Path

import bpy
import numpy as np

from surface import encode_srgb, packed_image


def apply_decking(scene, materials, config_path):
    spec = json.loads(Path(config_path).read_text())
    for role, deck in spec.get('decking', {}).items():
        material = materials[role]
        surface = material.node_tree.nodes.get('Principled BSDF')
        color = spec.get('palette', {}).get(spec['materials'][role]['paint'],
                                          surface.inputs['Base Color'].default_value[:3])
        plank_length, plank_width = deck['plankLength'], deck['plankWidth']
        length, width = plank_length * 4, plank_width * 12
        nx, ny = 2048, 512
        x = (np.arange(nx)[None, :] + .5) * length / nx
        y = (np.arange(ny)[:, None] + .5) * width / ny
        row = np.floor(y / plank_width)
        along = x + (row % 4) * plank_length / 4
        column = np.floor(along / plank_length) % 4
        # Four staggered butt joints; repeat the same whole boards at tile edges.
        shade = np.mod(np.sin(row * 127.1 + column * 311.7) * 43758.5453, 1) * 2 - 1
        grain = np.sin(y / width * np.pi * 2 * 197 + .45 * np.sin(x / length * np.pi * 2 * 3))
        grain += .35 * np.sin(y / width * np.pi * 2 * 331 + np.sin(x / length * np.pi * 2))
        seam = np.zeros((ny, nx))
        for position, period, pixel_size in [(y, plank_width, width / ny),
                                             (along, plank_length, length / nx)]:
            distance = np.abs((position + period / 2) % period - period / 2)
            coverage = np.clip((deck['seamWidth'] / 2 + pixel_size / 2 - distance) / pixel_size, 0, 1)
            seam = np.maximum(seam, coverage)
        variation = 1 + .16 * shade + .025 * grain
        pixels = encode_srgb(np.asarray(color)[None, None, :] * variation[:, :, None])
        pixels *= (1 - .44 * seam[:, :, None])
        color_image = packed_image(material.name + ' original planking', pixels)

        # Submillimeter caulking relief, exported as an ordinary tangent normal map.
        height = -.0008 * seam + .00004 * grain
        dx = (np.roll(height, -1, axis=1) - np.roll(height, 1, axis=1)) / (2 * length / nx)
        dy = (np.roll(height, -1, axis=0) - np.roll(height, 1, axis=0)) / (2 * width / ny)
        normal = np.stack((-dx, -dy, np.ones_like(dx)), axis=-1)
        normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
        normal_image = packed_image(material.name + ' plank relief', normal * .5 + .5)
        normal_image.colorspace_settings.name = 'Non-Color'
        normal_image.pack()
        nodes, links = material.node_tree.nodes, material.node_tree.links
        uv = nodes.new('ShaderNodeUVMap'); uv.uv_map = 'DeckUV'
        texture = nodes.new('ShaderNodeTexImage'); texture.image = color_image
        links.new(uv.outputs['UV'], texture.inputs['Vector'])
        links.new(texture.outputs['Color'], surface.inputs['Base Color'])
        relief = nodes.new('ShaderNodeTexImage'); relief.image = normal_image
        links.new(uv.outputs['UV'], relief.inputs['Vector'])
        normal_map = nodes.new('ShaderNodeNormalMap'); normal_map.uv_map = 'DeckUV'
        links.new(relief.outputs['Color'], normal_map.inputs['Color'])
        links.new(normal_map.outputs['Normal'], surface.inputs['Normal'])
        material['deckSubstrate'] = 'timber'
        material['deckCoating'] = deck['coating']
        bpy.context.view_layer.update()
        for obj in scene.objects:
            if obj.type != 'MESH' or material not in list(obj.data.materials):
                continue
            if obj.data.users > 1:
                obj.data = obj.data.copy()
            layer = obj.data.uv_layers.get('DeckUV') or obj.data.uv_layers.new(name='DeckUV')
            for face in obj.data.polygons:
                if obj.data.materials[face.material_index] != material:
                    continue
                for index in face.loop_indices:
                    point = obj.matrix_world @ obj.data.vertices[obj.data.loops[index].vertex_index].co
                    layer.data[index].uv = (point.x / length, point.y / width)
