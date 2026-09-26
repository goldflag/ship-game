"""Original .50-calibre Browning M2 water-cooled machine gun on its deck pedestal.

Visual proportions follow the approved GameModels3D pasc005 (Omaha) A air defence,
`aga055_browning_m2_mod2`: a flanged deck socket and a slim post, a sleeve and collar
on the post head, a cast gooseneck that swings up and forward to the trunnion on the
gun's starboard side, the receiver with its spade grips, the water jacket and flash
hider, the ammunition chest on the port side of the receiver and a ring sight on a
starboard sight bar. The reference poses the gun at 30 degrees; its parts are drawn
here turned back to the horizontal about the trunnion. No reference geometry is loaded.
The mount has no shield and no gunhouse.
Authoring frame: +X muzzle, +Y port, +Z up, yaw datum on the deck.
"""
import bpy
import bmesh
import math
from mathutils import Matrix, Vector
from blender_barrels import barrel_layout


def create_mount(mount, col, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    palette = dict(materials)
    palette.setdefault('painted-edge', palette['edge'])
    naval, edge, dark, painted = (palette[k] for k in ['naval', 'edge', 'dark', 'painted-edge'])
    name = mount['id']
    spec = mount['weapon']
    pivot = spec['pivotHeight']
    trunnion = spec['trunnionForward']

    def joint(suffix, parent=None, loc=(0, 0, 0)):
        node = bpy.data.objects.new(name + '.' + suffix, None)
        col.objects.link(node)
        node.location = loc
        node.parent = parent
        node['nodeId'] = node.name
        node['assemblyId'] = name
        return node

    yaw = joint('yaw')

    def put(obj, parent=None):
        obj.parent = parent or yaw
        obj.matrix_parent_inverse = Matrix.Identity(4)
        obj['assemblyId'] = name
        return obj

    def solid(obj):
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(obj.data)
        bm.free()
        return obj

    def tube(label, path, radius, material, parent=None, sides=8):
        """A swept polygon along a polyline of (x, y, z) points in a plane of constant y, capped at both
        ends; the section keeps one side toward +Y so the sweep never twists."""
        pts = [Vector(p) for p in path]
        side = Vector((0, 1, 0))
        rings = []
        for i, p in enumerate(pts):
            d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            normal = d.cross(side).normalized()
            rings.append([tuple(p + radius * (normal * math.cos(math.tau * k / sides) + side * math.sin(math.tau * k / sides))) for k in range(sides)])
        vv = [v for ring in rings for v in ring]
        ff = [(j * sides + k, j * sides + (k + 1) % sides, (j + 1) * sides + (k + 1) % sides, (j + 1) * sides + k)
              for j in range(len(rings) - 1) for k in range(sides)]
        ff += [tuple(reversed(range(sides))), tuple(range((len(rings) - 1) * sides, len(rings) * sides))]
        return put(solid(mesh(name + '.' + label, vv, ff, material, col, True)), parent)

    # ---- deck socket, post, sleeve and collar -----------------------------------------
    put(cyl(name + '.deck-flange', (0, 0, .03), .243, .06, naval, col, 12))
    put(cyl(name + '.flange-boss', (0, 0, .09), .16, .06, naval, col, 12, .10))
    for i in range(6):
        a = math.tau * i / 6
        put(cyl(name + '.flange-bolt', (.20 * math.cos(a), .20 * math.sin(a), .068), .018, .016, edge, col, 6))
    put(cyl(name + '.post', (0, 0, .335), .095, .60, naval, col, 12))
    put(cyl(name + '.sleeve', (0, 0, .77), .105, .34, naval, col, 12))
    put(cyl(name + '.sleeve-collar', (0, 0, .907), .112, .03, edge, col, 12))
    put(rod(name + '.clamp-lever', (.08, -.08, .78), (.23, -.25, .79), .012, edge, col, vertices=5))
    put(rod(name + '.clamp-pin', (.05, .12, .82), (.05, .12, .98), .016, edge, col, vertices=6))

    # ---- gooseneck: a cast arm from the sleeve head, forward and up, back to the trunnion boss ----
    y = -.16
    put(box(name + '.gooseneck-foot', (.0, -.075, .90), (.20, .25, .12), naval, col))
    path = [(.02, y, .90), (.17, y, 1.06), (.27, y, 1.22), (.26, y, 1.36), (.15, y, 1.48), (trunnion, y, pivot - .07)]
    tube('gooseneck', path, .064, naval, sides=8)
    put(rod(name + '.traverse-lock', (.33, -.16, 1.16), (.33, -.16, 1.32), .016, edge, col, vertices=6))

    # ---- elevating mass ------------------------------------------------------------------
    length = spec['muzzleForward'] - trunnion
    bore = spec['caliberM'] / 2
    for side, yy, _ in barrel_layout(spec):
        elevation = joint(side + '.elevation', yaw, (trunnion, yy, pivot))
        elevation.rotation_euler.y = -math.radians(mount.get('initialElevationDeg', 1))
        recoil = joint(side + '.recoil', elevation)
        joint(side + '.muzzle', recoil, (length, 0, 0))
        # Trunnion boss on the gooseneck head (the gun's starboard side), the cradle plate over it.
        put(rod(name + '.trunnion-boss', (0, -.245, -.064), (0, -.074, -.064), .075, edge, col, vertices=8), elevation)
        put(box(name + '.cradle', (-.05, -.02, -.13), (.40, .16, .05), naval, col), elevation)
        # Receiver body on the bore line, its deeper side plates below, back plate, grips, trigger.
        put(box(name + '.receiver', (-.275, 0, 0), (.67, .13, .147), edge, col), recoil)
        for sign in [1, -1]:
            put(box(name + '.side-plate', (-.313, sign * .07, -.08), (.53, .012, .257), edge, col), recoil)
        put(box(name + '.back-plate', (-.647, 0, 0), (.08, .195, .15), edge, col), recoil)
        for sign in [1, -1]:
            grip = [(-.66, sign * .06, -.02), (-.76, sign * .15, -.02), (-.84, sign * .20, .02)]
            for a, b in zip(grip, grip[1:]):
                put(rod(name + '.spade-grip', a, b, .016, edge, col, vertices=6), recoil)
            put(rod(name + '.grip-handle', (-.84, sign * .20, -.06), (-.84, sign * .20, .10), .022, dark, col, vertices=6), recoil)
        put(rod(name + '.trigger-bar', (-.62, -.10, -.126), (-.62, .10, -.126), .01, edge, col, vertices=5), recoil)
        # Water jacket with its filler, the flash hider and the bore.
        put(rod(name + '.water-jacket', (.06, 0, 0), (.936, 0, 0), .069, painted, col, vertices=8), recoil)
        put(rod(name + '.jacket-band', (.06, 0, 0), (.11, 0, 0), .077, edge, col, vertices=8), recoil)
        put(rod(name + '.jacket-band', (.88, 0, 0), (.936, 0, 0), .075, edge, col, vertices=8), recoil)
        put(rod(name + '.jacket-filler', (.30, 0, .06), (.30, 0, .10), .018, edge, col, vertices=6), recoil)
        put(rod(name + '.flash-hider', (.936, 0, 0), (length, 0, 0), .024, edge, col, r2=.045, vertices=8), recoil)
        put(rod(name + '.bore', (length - .004, 0, 0), (length + .001, 0, 0), bore, dark, col, vertices=8), recoil)
        # Ammunition chest on the port side of the receiver with its feed throat.
        put(box(name + '.ammunition-chest', (-.09, .24, -.09), (.18, .33, .20), naval, col), elevation)
        put(box(name + '.chest-lid', (-.09, .24, .014), (.19, .34, .012), edge, col), elevation)
        put(box(name + '.feed-throat', (-.15, .06, -.02), (.10, .05, .08), edge, col), elevation)
        # Sight bar to starboard: front post at the trunnion, ring sight at the rear.
        put(rod(name + '.sight-arm', (.035, -.065, .02), (.035, -.31, .02), .012, edge, col, vertices=5), elevation)
        put(rod(name + '.sight-bar', (-.53, -.28, 0), (.035, -.28, 0), .01, edge, col, vertices=5), elevation)
        put(rod(name + '.front-sight-post', (.036, -.284, -.12), (.036, -.284, .16), .008, edge, col, vertices=5), elevation)
        put(rod(name + '.ring-sight-post', (-.535, -.283, 0), (-.535, -.283, .21), .01, edge, col, vertices=5), elevation)
        ring = [(-.535, -.283 + .08 * math.cos(math.tau * k / 12), .287 + .08 * math.sin(math.tau * k / 12)) for k in range(12)]
        for a, b in zip(ring, ring[1:] + ring[:1]):
            put(rod(name + '.ring-sight', a, b, .006, edge, col, vertices=4), elevation)
        for a, b in [((-.535, -.363, .287), (-.535, -.203, .287)), ((-.535, -.283, .207), (-.535, -.283, .367))]:
            put(rod(name + '.ring-sight-cross', a, b, .004, edge, col, vertices=4), elevation)

    a, b, c = mount['position']
    yaw.location = (-c, -a, b)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw
