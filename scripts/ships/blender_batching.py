"""Join ordinary export meshes without operators or polygon reordering.

Keep authored loop starts: a Mesh -> BMesh -> Mesh round trip can choose another
triangle diagonal on a non-planar quad. Special meshes use the caller's original
Blender operator path instead.
"""
import bpy
import numpy as np


def values(collection, property_name, width=1, dtype=np.int32):
    result = np.empty(len(collection) * width, dtype=dtype)
    collection.foreach_get(property_name, result)
    return result


def join_mesh_data(objects):
    active = objects[0]
    inverse = active.matrix_world.inverted()
    parts, temporary, materials, uv_names = [], [], [], []
    vertex_offset = loop_offset = edge_offset = 0
    for obj in objects:
        data = obj.data.copy()
        temporary.append(data)
        if obj is not active: data.transform(inverse @ obj.matrix_world)
        mapping = []
        for material in data.materials:
            if material not in materials: materials.append(material)
            mapping.append(materials.index(material))
        for layer in data.uv_layers:
            if layer.name not in uv_names: uv_names.append(layer.name)
        slots = values(data.polygons, 'material_index')
        if mapping: slots = np.asarray(mapping, dtype=np.int32)[slots]
        parts.append({
            'positions': values(data.vertices, 'co', 3, np.float32),
            'vertices': values(data.loops, 'vertex_index') + vertex_offset,
            'loop_edges': values(data.loops, 'edge_index') + edge_offset,
            'edges': values(data.edges, 'vertices', 2) + vertex_offset,
            'sharp': values(data.edges, 'use_edge_sharp', dtype=np.bool_),
            'starts': values(data.polygons, 'loop_start') + loop_offset,
            'counts': values(data.polygons, 'loop_total'),
            'smooth': values(data.polygons, 'use_smooth', dtype=np.bool_),
            'materials': slots,
            'uvs': {layer.name: values(layer.data, 'uv', 2, np.float32) for layer in data.uv_layers},
            'loop_count': len(data.loops),
        })
        vertex_offset += len(data.vertices)
        loop_offset += len(data.loops)
        edge_offset += len(data.edges)
    result = bpy.data.meshes.new(active.data.name + '.batched')
    result.vertices.add(vertex_offset)
    result.loops.add(loop_offset)
    result.edges.add(edge_offset)
    result.polygons.add(sum(len(part['starts']) for part in parts))
    for collection, prop, key in [
        (result.vertices, 'co', 'positions'), (result.loops, 'vertex_index', 'vertices'),
        (result.loops, 'edge_index', 'loop_edges'), (result.edges, 'vertices', 'edges'),
        (result.edges, 'use_edge_sharp', 'sharp'), (result.polygons, 'loop_start', 'starts'),
        (result.polygons, 'loop_total', 'counts'), (result.polygons, 'use_smooth', 'smooth'),
        (result.polygons, 'material_index', 'materials'),
    ]:
        collection.foreach_set(prop, np.concatenate([part[key] for part in parts]))
    for material in materials: result.materials.append(material)
    for name in uv_names:
        layer = result.uv_layers.new(name=name)
        layer.data.foreach_set('uv', np.concatenate([part['uvs'][name] if name in part['uvs'] else np.zeros(part['loop_count'] * 2, dtype=np.float32) for part in parts]))
    if result.uv_layers:
        result.uv_layers.active_index = active.data.uv_layers.active_index
        for layer in active.data.uv_layers:
            result.uv_layers[layer.name].active_render = layer.active_render
    result.update()
    result.calc_loop_triangles()
    active.data = result
    return temporary


def has_nonplanar_faces(data):
    counts = values(data.polygons, 'loop_total')
    if not np.any(counts > 3): return False
    starts = values(data.polygons, 'loop_start')
    corners = values(data.loops, 'vertex_index')
    positions = values(data.vertices, 'co', 3, np.float32).reshape(-1, 3)
    normals = values(data.polygons, 'normal', 3, np.float32).reshape(-1, 3)
    relative = positions[corners] - np.repeat(positions[corners[starts]], counts, axis=0)
    distances = np.abs(np.einsum('ij,ij->i', relative, np.repeat(normals, counts, axis=0)))
    return bool(np.any((distances > 1e-4) & np.repeat(counts > 3, counts)))
