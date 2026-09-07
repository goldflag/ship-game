"""Geometric attachment queries over explicitly selected original structure.

Use before creating fittings so a fitting cannot accidentally support itself.
No nearest-box fallbacks: a missing ray hit is an authoring error to resolve.
"""
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


class SupportSurface:
    def __init__(self, objects):
        bpy.context.view_layer.update()
        vertices, faces = [], []
        for obj in objects:
            if obj.type != 'MESH' or obj.get('exportRole') == 'simulation':
                continue
            offset = len(vertices)
            vertices.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
            faces.extend(tuple(offset+i for i in p.vertices) for p in obj.data.polygons)
        self.tree = BVHTree.FromPolygons(vertices, faces)

    def below(self, x, y, ceiling, depth=50):
        hit, _, _, _ = self.tree.ray_cast(Vector((x,y,ceiling+.001)), Vector((0,0,-1)), depth)
        if hit is None:
            raise ValueError(f'No authored support below ({x}, {y}, {ceiling}); add/reconcile the platform in the recipe')
        return hit.z

    def along(self, origin, direction, distance):
        hit, _, _, _ = self.tree.ray_cast(Vector(origin), Vector(direction).normalized(), distance)
        if hit is None:
            raise ValueError(f'No authored attachment from {origin} along {direction}')
        return hit
