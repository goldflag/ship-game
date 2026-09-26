"""Seat wall fittings on the plating they are mounted on.

Recipes place scuttles, doors, windows and louvred vents from hand-written offsets, often against a wall
assumed vertical and with generous standoffs. This pass runs once over a built scene, before its objects
are consolidated, and corrects each fitting against the surface actually behind it:

- a scuttle (porthole, portlight, sidelight) is turned square to the local plating normal, so it lies flat
  on a flared or tumbled-home hull instead of tilting into or out of it;
- every fitting that faces its plating (within 15 degrees) is pressed towards it so its outermost part stands no further proud than a real
  one: 5 cm for a scuttle with its eyebrow, 7 cm for a door with its dogs and handwheel, 4 cm for a window
  frame, 9 cm for a louvred vent with its rain hood. Depth is compressed along the plating normal, so rims,
  glass, leaves and dogs keep their order front to back.

A fitting is found by object name (the recipes' own names such as 'Hull scuttle rim' or 'bridge-lower door
leaf'); an object that merges many fittings is split into its loose parts, and parts that touch make one
fitting. Fittings on roofs and decks, larger than 3 m, or on mounts' own structures (roof ventilators,
turret rear vents, rangefinder windows, hangar doors) are left alone. The plating is every other mesh.
"""
import math
import re

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

# (kind, name pattern, largest standoff in metres, turn square to the plating)
KINDS = [
    ('scuttle', re.compile(r'scuttle|porthole|portlight|port ?light|sidelight', re.I), .05, True),
    ('door', re.compile(r'door', re.I), .07, False),
    ('window', re.compile(r'window', re.I), .04, False),
    ('vent', re.compile(r'vent|louvre|louver|grille', re.I), .09, False),
]
EXCLUDE = re.compile(r'rear-vent|roof|ventilator|rangefinder|sight|hangar|searchlight|funnel|trunk|director|intake|uptake|\bcap\b|neck', re.I)
# Parts that touch within this gap belong to one fitting.
TOUCH = .03
LARGEST = 3.0
# A fitting pressed fully into its plating is brought back out this far, so its face still shows.
LEAST = .012
# Anything standing further out than this is a free-standing structure (a cowl ventilator, a locker), not a wall fitting.
FREESTANDING = .45
# A fitting whose face turns further than this from the plating behind it is not seated on that plating.
ALIGNED = 15


def kind_of(name):
    if EXCLUDE.search(name):
        return None
    for kind, pattern, cap, square in KINDS:
        if pattern.search(name):
            return kind, cap, square
    return None


def loose_parts(mesh):
    """Vertex index lists of a mesh's connected parts."""
    parent = list(range(len(mesh.vertices)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for e in mesh.edges:
        a, b = find(e.vertices[0]), find(e.vertices[1])
        if a != b:
            parent[a] = b
    parts = {}
    for i in range(len(mesh.vertices)):
        parts.setdefault(find(i), []).append(i)
    return list(parts.values())


def largest_face(faces):
    """Unit normal of the largest face among (world points) polygons: a scuttle's glass or rim face."""
    best, axis = 0.0, None
    for pts in faces:
        n = Vector()
        for i in range(len(pts)):
            n += pts[i].cross(pts[(i + 1) % len(pts)])
        area = n.length / 2
        if area > best:
            best, axis = area, n.normalized()
    return axis


def host_tree(scene, skip):
    bm = bmesh.new()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for o in scene.objects:
        if o.type != 'MESH' or o in skip or max(o.dimensions) < .4:
            continue
        evaluated = o.evaluated_get(depsgraph)
        me = evaluated.to_mesh()
        part = bmesh.new()
        part.from_mesh(me)
        part.transform(o.matrix_world)
        temp = bpy.data.meshes.new('host')
        part.to_mesh(temp)
        part.free()
        bm.from_mesh(temp)
        bpy.data.meshes.remove(temp)
        evaluated.to_mesh_clear()
    tree = BVHTree.FromBMesh(bm)
    bm.free()
    return tree


def seat_wall_fittings(scene):
    """Square scuttles to their plating and press every wall fitting to a real standoff. Returns a summary."""
    bpy.context.view_layer.update()
    pieces = []  # (object, vertex indices, world points, kind, cap, square, polygons)
    fitting_objects = set()
    for o in scene.objects:
        if o.type != 'MESH' or o.modifiers or not o.data.vertices:
            continue
        found = kind_of(re.sub(r'\.\d+$', '', o.name))
        if not found:
            continue
        fitting_objects.add(o)
        kind, cap, square = found
        mw = o.matrix_world
        parts = loose_parts(o.data)
        owner = {}
        for k, part in enumerate(parts):
            for i in part:
                owner[i] = k
        polygons = [[] for _ in parts]
        for poly in o.data.polygons:
            polygons[owner[poly.vertices[0]]].append([mw @ o.data.vertices[i].co for i in poly.vertices])
        for k, part in enumerate(parts):
            pts = [mw @ o.data.vertices[i].co for i in part]
            pieces.append((o, part, pts, kind, cap, square, polygons[k]))
    if not pieces:
        return {}
    tree = host_tree(scene, fitting_objects)

    # Group touching parts of one kind into fittings (a spatial hash on 1 m cells keeps this near linear).
    boxes = []
    for o, part, pts, kind, cap, square, _ in pieces:
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))) - Vector((TOUCH,) * 3)
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))) + Vector((TOUCH,) * 3)
        boxes.append((lo, hi))
    parent = list(range(len(pieces)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    cells = {}
    for i, (lo, hi) in enumerate(boxes):
        for x in range(math.floor(lo.x), math.floor(hi.x) + 1):
            for y in range(math.floor(lo.y), math.floor(hi.y) + 1):
                for z in range(math.floor(lo.z), math.floor(hi.z) + 1):
                    for j in cells.get((x, y, z), ()):
                        if pieces[j][3] != pieces[i][3]:
                            continue
                        a, b = boxes[j]
                        if a.x <= hi.x and lo.x <= b.x and a.y <= hi.y and lo.y <= b.y and a.z <= hi.z and lo.z <= b.z:
                            ra, rb = find(i), find(j)
                            if ra != rb:
                                parent[ra] = rb
                    cells.setdefault((x, y, z), []).append(i)
    fittings = {}
    for i in range(len(pieces)):
        fittings.setdefault(find(i), []).append(i)

    summary = {}
    moved = {}  # object -> {vertex index: new world point}
    for members in fittings.values():
        kind, cap, square = pieces[members[0]][3:6]
        stat = summary.setdefault(kind, {'fittings': 0, 'squared': 0, 'pressed': 0, 'proud_before': 0.0, 'proud_after': 0.0, 'skipped': 0})
        pts = [p for m in members for p in pieces[m][2]]
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        if max(hi - lo) > LARGEST:
            stat['skipped'] += 1
            continue
        centre = sum(pts, Vector()) / len(pts)
        hit, normal, _, _ = tree.find_nearest(centre, 1.0)
        if hit is None:
            stat['skipped'] += 1
            continue
        n = normal.normalized()
        if (centre - hit).dot(n) < 0:
            n = -n
        if abs(n.z) > .6:
            stat['skipped'] += 1
            continue
        stat['fittings'] += 1
        new = list(pts)
        if max((p - hit).dot(n) for p in pts) > FREESTANDING:
            stat['fittings'] -= 1
            stat['skipped'] += 1
            continue
        axis = largest_face([f for m in members for f in pieces[m][6]])
        if axis is not None and axis.dot(n) < 0:
            axis = -axis
        angle = axis.angle(n) if axis is not None else math.pi / 2
        if square and math.radians(2) < angle < math.radians(45):
            turn = axis.rotation_difference(n).to_matrix()
            new = [hit + turn @ (p - hit) for p in new]
            stat['squared'] += 1
        elif angle > math.radians(ALIGNED):
            # The fitting does not face the plating found behind it (a corner, a curved casing): pressing it along
            # that normal would shear it, so leave it as built.
            stat['fittings'] -= 1
            stat['skipped'] += 1
            continue
        depth = [(p - hit).dot(n) for p in new]
        proud = max(depth)
        stat['proud_before'] += max((p - hit).dot(n) for p in pts)
        if proud > cap:
            k = cap / proud
            new = [p - n * (d * (1 - k)) for p, d in zip(new, depth)]
            stat['pressed'] += 1
        elif proud < LEAST:
            new = [p + n * (LEAST - proud) for p in new]
        stat['proud_after'] += max((p - hit).dot(n) for p in new)
        k = 0
        for m in members:
            o, part = pieces[m][0], pieces[m][1]
            target = moved.setdefault(o, {})
            for i in part:
                target[i] = new[k]
                k += 1
    for o, points in moved.items():
        if o.data.users > 1:
            o.data = o.data.copy()
        inverse = o.matrix_world.inverted()
        for i, p in points.items():
            o.data.vertices[i].co = inverse @ p
        o.data.update()
    for kind, stat in summary.items():
        n = max(1, stat['fittings'])
        stat['proud_before'] = round(stat['proud_before'] / n, 3)
        stat['proud_after'] = round(stat['proud_after'] / n, 3)
    print('Seated wall fittings:', summary, flush=True)
    return summary
