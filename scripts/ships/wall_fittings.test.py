"""Regression: wall fittings lie square on flared plating and stand no further proud than a real one.

Run with Blender --background --factory-startup --python-exit-code 1 --python.
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).parent))
from blender_wall_fittings import seat_wall_fittings


def mesh(name, verts, faces):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def disc(name, centre, axis, radius, depth, sides=12):
    """A closed cylinder from `centre` along `axis`."""
    axis = Vector(axis).normalized()
    u = axis.cross(Vector((0, 0, 1)))
    u = u.normalized() if u.length > .1 else axis.cross(Vector((0, 1, 0))).normalized()
    v = axis.cross(u)
    c = Vector(centre)
    ring = [radius * (u * math.cos(math.tau * i / sides) + v * math.sin(math.tau * i / sides)) for i in range(sides)]
    verts = [tuple(c + r) for r in ring] + [tuple(c + axis * depth + r) for r in ring]
    faces = [tuple(range(sides))[::-1], tuple(range(sides, 2 * sides))] + [(i, (i + 1) % sides, sides + (i + 1) % sides, sides + i) for i in range(sides)]
    return mesh(name, verts, faces)


def box(name, lo, hi):
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    verts = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    return mesh(name, verts, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)])


# A hull side flared 20 degrees outboard (normal tilted down from +Y), and a vertical deckhouse wall at y = 4.
flare = math.radians(20)
side_normal = Vector((0, math.cos(flare), -math.sin(flare)))
up_along = Vector((0, math.sin(flare), math.cos(flare)))
corners = [Vector((x, 0, 0)) + up_along * h for x in (-5, 5) for h in (-3, 3)]
mesh('Hull side', [tuple(corners[i]) for i in (0, 2, 3, 1)], [(0, 1, 2, 3)])
mesh('Deckhouse wall', [(-3, 4, 5), (3, 4, 5), (3, 4, 8), (-3, 4, 8)], [(0, 1, 2, 3)])

# A scuttle placed as if the side were vertical: its rim along +Y, standing 11 cm proud.
rim = disc('Hull scuttle rim', (0, -.02, 0), (0, 1, 0), .15, .09)
glass = disc('Hull scuttle glass', (0, .07, 0), (0, 1, 0), .105, .01)
# A door whose leaf floats 5 cm off the wall and whose dog stands 12 cm out.
frame = box('Test deckhouse door frame', (-.5, 3.955, 5), (.5, 4.045, 6.9))
leaf = box('Test deckhouse door leaf', (-.4, 4.025, 5.05), (.4, 4.085, 6.85))
dog = box('Test deckhouse door dog', (.2, 4.08, 5.9), (.3, 4.125, 5.95))
# A free-standing cowl ventilator on the deck by the wall is not a wall fitting.
cowl = box('Cowl ventilator', (1, 3.2, 5), (1.4, 3.6, 6.5))
cowl_before = [v.co.copy() for v in cowl.data.vertices]

summary = seat_wall_fittings(bpy.context.scene)


def proud(objects, point, normal):
    return max((o.matrix_world @ v.co - point).dot(normal) for o in objects for v in o.data.vertices)


def largest_normal(o):
    return max(o.data.polygons, key=lambda p: p.area).normal


tilt = math.degrees(largest_normal(rim).angle(side_normal))
tilt = min(tilt, 180 - tilt)
assert tilt < 1, f'scuttle still tilted {tilt:.1f} degrees off the flared plating'
scuttle_proud = proud([rim, glass], Vector((0, 0, 0)), side_normal)
assert .03 <= scuttle_proud <= .0501, f'scuttle stands {scuttle_proud * 100:.1f} cm proud'
door_proud = proud([frame, leaf, dog], Vector((0, 4, 0)), Vector((0, 1, 0)))
assert door_proud <= .0701, f'door stands {door_proud * 100:.1f} cm proud'
# Front to back order holds: the leaf still stands in front of the frame's face.
leaf_front = max(v.co.y for v in leaf.data.vertices)
frame_front = max(v.co.y for v in frame.data.vertices)
assert leaf_front > frame_front, 'the door leaf fell behind its frame'
assert all((a - v.co).length < 1e-6 for a, v in zip(cowl_before, cowl.data.vertices)), 'a free-standing ventilator moved'
assert summary['scuttle']['squared'] == 1 and summary['door']['pressed'] == 1, summary
print('wall fittings: OK', summary)
