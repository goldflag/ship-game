"""Fixed generic running-gear sizes, built from the original small appendages.

Dimensions are baked into original mesh coordinates and joint translations in
Blender metres. Published instances retain unit scale and independent pivots.
"""
from mathutils import Matrix
from small_appendages import create_small_propeller, create_small_rudder


def sized_original(part, col, helpers, materials, recipe, scale):
    before = set(col.objects)
    root = recipe(part, col, helpers, materials)
    transform = Matrix.Scale(scale, 4)
    meshes = set()
    for obj in set(col.objects) - before:
        obj.location *= scale
        if obj.type == 'MESH' and obj.data not in meshes:
            obj.data.transform(transform)
            meshes.add(obj.data)
    return root


def create_propeller(part, col, helpers, materials):
    # The original 1.2 m screw has a 1.22 m conservative blade envelope.
    return sized_original(part, col, helpers, materials, create_small_propeller,
                          part['size'][0] / 1.22)


def create_rudder(part, col, helpers, materials):
    # The original 1 m foil has a 1.13 m stock-and-bearing envelope.
    return sized_original(part, col, helpers, materials, create_small_rudder,
                          part['size'][1] / 1.13)
