"""Original US heavy main-battery turrets as standalone articulated parts.

Local metres: +X firing, +Y port, +Z up; origin is the mount datum. The hull
installation owns the fixed barbette; only the rotating bearing ring, gunhouse
and guns are authored here. Python geometry only, no external inputs.
"""
import math
import bpy
from mathutils import Vector
from aa_articulation import articulate_aa
from gun_bloomers import create_bloomer

NEUTRAL = math.radians(1)


def _tools(collection, helpers, materials, n):
    mesh, rod = helpers['mesh'], helpers['rod']

    def lathe(name, pivot, profile, material, bore_from=None, sides=16):
        """Turned profile along the bore axis, posed at the neutral elevation."""
        vv = [(x - pivot[0], r * math.cos(i * math.tau / sides), r * math.sin(i * math.tau / sides))
              for x, r in profile for i in range(sides)]
        ff = [(j * sides + i, j * sides + (i + 1) % sides, (j + 1) * sides + (i + 1) % sides, (j + 1) * sides + i)
              for j in range(len(profile) - 1) for i in range(sides)]
        ff.append(tuple(range((len(profile) - 1) * sides, len(profile) * sides)))
        ob = mesh(n + name, vv, ff, material, collection, True)
        if bore_from is not None:
            ob.data.materials.append(materials['dark'])
            for p in ob.data.polygons:
                if p.index >= bore_from * sides: p.material_index = 1
        ob.data.polygons[-1].use_smooth = False
        ob.location = pivot
        ob.rotation_euler.y = -NEUTRAL
        return ob

    def ladder(name, a, b, width, axis, material, step=.30):
        a, b = Vector(a), Vector(b)
        side = Vector((width / 2, 0, 0)) if axis == 'x' else Vector((0, width / 2, 0))
        for sign in [-1, 1]:
            rod(n + name + '.stringer', a + side * sign, b + side * sign, .03, material, collection, vertices=6)
        count = max(2, math.ceil((b - a).length / step))
        for i in range(count):
            p = a.lerp(b, (i + .5) / count)
            rod(n + name + '.rung', p - side, p + side, .022, material, collection, vertices=6)

    def face_panels(name, face_x, centers, half, y_edge, z0, sill, head, z1, material, y_edge_top=None):
        """Flat sloped face plate left open at each rectangular gun port."""
        y_edge_top = y_edge if y_edge_top is None else y_edge_top
        edge_y = lambda z: y_edge + (y_edge_top - y_edge) * (z - z0) / (z1 - z0)

        def quad(ya0, yb0, za, ya1, yb1, zb):
            # Seen from +X the winding runs counter-clockwise: normal faces forward.
            mesh(n + name, [(face_x(za), ya0, za), (face_x(za), yb0, za), (face_x(zb), yb1, zb), (face_x(zb), ya1, zb)],
                 [(0, 1, 2, 3)], material, collection)
        quad(-edge_y(z0), edge_y(z0), z0, -edge_y(sill), edge_y(sill), sill)
        quad(-edge_y(head), edge_y(head), head, -edge_y(z1), edge_y(z1), z1)
        ends = [None] + [p for y in sorted(centers) for p in [y - half, y + half]] + [None]
        for a, b in zip(ends[::2], ends[1::2]):
            a0 = -edge_y(sill) if a is None else a
            a1 = -edge_y(head) if a is None else a
            b0 = edge_y(sill) if b is None else b
            b1 = edge_y(head) if b is None else b
            quad(a0, b0, sill, a1, b1, head)
    return lathe, ladder, face_panels


def create_iowa_main(mount, collection, helpers, materials):
    """16-inch/50 Mk 7 three-gun turret (Iowa class)."""
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    spec = mount['weapon']
    n = mount['id']
    naval, dark, edge = (materials[k] for k in ['naval', 'dark', 'edge'])
    roof = materials.get('roof', naval)
    lathe, ladder, face_panels = _tools(collection, helpers, materials, n)
    before = set(bpy.context.scene.objects)
    spacing = spec['barrelSpacing']
    centers = [spacing, 0, -spacing]

    # Rotating bearing ring mates with the ship's fixed barbette at the datum.
    cyl(n + '.roller', (0, 0, .09), spec['barbetteRadius'], .18, edge, collection, 32)

    # Armoured envelope: long tapered house, undercut rear overhang, sloped face.
    V = [(-9.46, 0, .699), (-9.38, -1.425, .679), (-8.915, -5.195, .582), (-6.97, -5.57, .161), (.62, -6.7, .161),
         (6.03, -5.05, .161), (6.03, 5.05, .161), (.62, 6.7, .161), (-6.97, 5.57, .161), (-8.915, 5.195, .582),
         (-9.38, 1.425, .679), (-9.46, 0, 3.2), (-9.38, -1.425, 3.2), (-8.915, -4.67, 3.2), (-6.97, -4.96, 3.2),
         (.64, -6.095, 3.2), (3.775, -5.05, 3.2), (3.775, 5.05, 3.2), (.64, 6.095, 3.2), (-6.97, 4.96, 3.2),
         (-8.915, 4.67, 3.2), (-9.38, 1.425, 3.2), (6.03, -5.05, .576), (6.03, 5.05, .576)]
    walls = [(8, 7, 6, 5, 4, 3), (3, 2, 1), (3, 1, 0), (3, 0, 10), (3, 10, 9), (3, 9, 8),
             (0, 1, 12, 11), (1, 2, 13, 12), (2, 3, 14, 13), (3, 4, 15, 14), (4, 5, 22), (4, 22, 16), (4, 16, 15),
             (5, 6, 23, 22), (6, 7, 18), (6, 18, 17), (6, 17, 23), (7, 8, 19, 18), (8, 9, 20, 19), (9, 10, 21, 20), (10, 0, 11, 21)]
    mesh(n + '.gunhouse', V, walls, naval, collection)
    mesh(n + '.roof', V, [tuple(range(11, 22))], roof, collection)
    face_x = lambda z: 6.03 - (z - .576) * 2.255 / 2.624
    face_panels('.face', face_x, centers, .80, 5.05, .576, 1.0, 2.85, 3.2, naval)

    # Narrow ladders climb the face between and outboard of the three ports.
    for y in [-4.61, -1.575, 1.575, 4.61]:
        ladder('.face.ladder', (face_x(.66) + .045, y, .66), (face_x(3.06) + .045, y, 3.06), .36, 'y', edge)
        for z in [.85, 2.8]:
            for dy in [-.18, .18]:
                rod(n + '.face.ladder.shoe', (face_x(z) - .01, y + dy, z), (face_x(z) + .075, y + dy, z), .022, naval, collection, vertices=6)

    # Aft rangefinder ears emerge from the tapered sides with flanges and optics.
    rod(n + '.rangefinder.tube', (-6.82, -6.92, 2.48), (-6.82, 6.92, 2.48), .22, naval, collection, vertices=16)
    for sign in [-1, 1]:
        box(n + '.rangefinder.hood', (-6.82, sign * 6.03, 2.46), (1.40, 1.98, .90), naval, collection)
        box(n + '.rangefinder.flange', (-6.82, sign * 5.48, 2.44), (2.05, .14, 1.46), naval, collection)
        box(n + '.rangefinder.window.frame', (-6.109, sign * 6.89, 2.47), (.075, .49, 1.03), edge, collection)
        box(n + '.rangefinder.glass', (-6.064, sign * 6.89, 2.47), (.025, .34, .88), dark, collection)
        path = [(-6.82 + .72 * math.cos(i * math.tau / 24), sign * 7.045, 2.46 + .43 * math.sin(i * math.tau / 24)) for i in range(24)]
        for a, b in zip(path, path[1:] + path[:1]):
            rod(n + '.rangefinder.cover.rim', a, b, .023, naval, collection, vertices=6)
        # Two staggered armoured sight housings on each forward side plate.
        for x, y, z in [(1.18, 6.31, 2.43), (-.23, 6.83, 1.65)]:
            box(n + '.side.sight.flange', (x, sign * (y - .25), z), (.81, .16, .85), naval, collection)
            box(n + '.side.sight', (x, sign * y, z), (.57, .65, .68), naval, collection)
            box(n + '.side.sight.bezel', (x + .292, sign * y, z), (.055, .49, .54), edge, collection)
            box(n + '.side.sight.lens', (x + .325, sign * y, z), (.018, .33, .39), dark, collection)
        # Side ladder follows the inclined armour.
        ladder('.side.ladder', (-1.17, sign * 6.52, .30), (-1.17, sign * 5.92, 3.17), .44, 'x', edge)
        for z in [.5, 2.9]:
            y = 6.58 - (z - .161) * .20
            for x in [-1.39, -.95]:
                rod(n + '.side.ladder.shoe', (x, sign * (y - .15), z), (x, sign * y, z), .026, naval, collection, vertices=6)
        # Rear safety basket hung from the roof edge of the overhang.
        y0, y1 = (.35, 3.25) if sign == 1 else (-3.25, -.35)
        for yy in [y0 + i * (y1 - y0) / 12 for i in range(13)]:
            x = -9.46 + .12 * abs(yy)
            rod(n + '.basket.rib', (x, yy, 3.17), (x - .35, yy, 2.73), .018, edge, collection, vertices=6)
            rod(n + '.basket.floor', (x - .35, yy, 2.73), (x - .52, yy, 3.17), .018, edge, collection, vertices=6)
        for zz, dx in [(3.17, .03), (2.74, .35), (3.17, .53)]:
            rod(n + '.basket.edge', (-9.46 + .12 * abs(y0) - dx, y0, zz), (-9.46 + .12 * abs(y1) - dx, y1, zz), .026, naval, collection, vertices=6)
        # Roof handrails along the long side edges.
        rail = [(-6.4, 4.75), (-3.0, 5.27), (.3, 5.77)]
        for (xa, ya), (xb, yb) in zip(rail, rail[1:]):
            rod(n + '.roof.rail', (xa, sign * ya, 3.42), (xb, sign * yb, 3.42), .022, edge, collection, vertices=6)
        for x, y in rail:
            rod(n + '.roof.rail.post', (x, sign * y, 3.19), (x, sign * y, 3.42), .022, edge, collection, vertices=6)

    # Roof periscopes, sight hoods and plating seams.
    for y in [-1.60, 1.60]:
        cyl(n + '.roof.periscope.base', (-5.31, y, 3.27), .16, .14, naval, collection, 16)
        cyl(n + '.roof.periscope', (-5.31, y, 3.42), .09, .26, naval, collection, 12)
        box(n + '.roof.periscope.head', (-5.25, y, 3.55), (.25, .20, .15), naval, collection)
        box(n + '.roof.periscope.lens', (-5.116, y, 3.55), (.02, .14, .085), dark, collection)
    for y in [-4.1, 4.1]:
        box(n + '.roof.sight.hood', (2.35, y, 3.30), (.62, .46, .22), naval, collection)
        box(n + '.roof.sight.lens', (2.665, y, 3.31), (.02, .30, .10), dark, collection)
    box(n + '.rear.access', (-9.448, 0, 1.81), (.09, 1.09, 1.91), naval, collection)
    for y in [-.56, .56]:
        rod(n + '.rear.coaming', (-9.50, y, .83), (-9.50, y, 2.82), .024, naval, collection, vertices=6)
    frame = list(set(bpy.context.scene.objects) - before)

    groups = []
    for lateral in centers:
        start = set(bpy.context.scene.objects)
        pivot = (spec['trunnionForward'], lateral, spec['pivotHeight'])
        muzzle = spec['muzzleForward']
        bore = spec['caliberM'] / 2
        base = spec.get('barrelBaseRadius', .612)
        profile = [(pivot[0] + .25, base), (6.91, base), (8.316, base), (8.35, .500), (9.249, .500), (12.136, .406),
                   (muzzle, .317), (muzzle, bore), (muzzle - .7, bore)]
        lathe('.barrel', pivot, profile, edge, bore_from=7, sides=16)
        groups.append(list(set(bpy.context.scene.objects) - start))
    yaw = articulate_aa(mount, collection, frame, groups)
    for side, lateral in zip(['left', 'center', 'right'], centers):
        rim=[]
        for i in range(24):
            a=i*math.tau/24;c=math.cos(a);s=math.sin(a);r=max(abs(c),abs(s))
            z=1.925+1.17*math.copysign(abs(s)**.5,s)
            rim.append((face_x(z)+.008,lateral+1.02*math.copysign(abs(c)**.5,c),z))
        create_bloomer(mount, collection, helpers, materials, side, rim, 6.91, base, rings=5, fold_depth=.065, slack=.10, fullness=.10, forward_fullness=.22)
    return yaw


def create_baltimore_main(mount, collection, helpers, materials):
    """8-inch/55 Mk 12 three-gun turret (Baltimore class)."""
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    spec = mount['weapon']
    n = mount['id']
    naval, dark, edge = (materials[k] for k in ['naval', 'dark', 'edge'])
    roof = materials.get('roof', naval)
    lathe, ladder, face_panels = _tools(collection, helpers, materials, n)
    before = set(bpy.context.scene.objects)
    spacing = spec['barrelSpacing']
    centers = [spacing, 0, -spacing]
    H = 3.00355

    cyl(n + '.roller', (0, 0, .04), spec['barbetteRadius'], .08, edge, collection, 32)
    # Long gunhouse: chamfered rear, slightly tapered sides, deep sloped face.
    V = [(-6.096, -3.55, .05), (-5.72, -3.9, .05), (3.2, -3.55, .05), (3.5306, -3.05, .05), (3.5306, 3.05, .05), (3.2, 3.55, .05),
         (-5.72, 3.9, .05), (-6.096, 3.55, .05), (-6.096, -3.5, H), (-5.72, -3.85, H), (1.82, -3.2, H), (1.82, -2.85, H),
         (1.82, 2.85, H), (1.82, 3.2, H), (-5.72, 3.85, H), (-6.096, 3.5, H)]
    walls = [(7, 6, 5, 4, 3, 2, 1, 0)] + [(i, i + 1, i + 9, i + 8) for i in range(7) if i != 3] + [(7, 0, 8, 15)]
    mesh(n + '.gunhouse', V, walls, naval, collection)
    mesh(n + '.roof', V, [tuple(range(8, 16))], roof, collection)
    face_x = lambda z: 3.5306 - (z - .05) * 1.7106 / (H - .05)
    pz = spec['pivotHeight']
    face_panels('.face', face_x, centers, .43, 3.05, .05, pz - .50, pz + .50, H, naval, y_edge_top=2.85)

    # Transverse rangefinder near the back of the house, with armoured end hoods.
    rod(n + '.rangefinder.tube', (-5.207, -3.90, 2.16), (-5.207, 3.90, 2.16), .20, naval, collection, vertices=16)
    for side in [-1, 1]:
        box(n + '.rangefinder.hood', (-5.207, side * 3.68, 2.16), (.68, .5, .58), naval, collection)
        box(n + '.rangefinder.glass', (-4.86, side * 3.68, 2.18), (.018, .30, .20), dark, collection)
        # Side service ladder follows the inclined plate; louvred vent aft of it.
        ladder('.side.ladder', (-2.888, side * 3.83, .30), (-2.888, side * 3.65, H - .05), .48, 'x', edge)
        wall = lambda z: 3.812 - (z - .05) * .156 / (H - .05)
        vx, vz, vw, vh = -3.95, 1.25, .585, .45
        box(n + '.vent.recess', (vx, side * (wall(vz) + .01), vz), (vw, .06, vh), dark, collection)
        for i in range(4):
            z = vz - vh / 2 + .06 + i * .11
            box(n + '.vent.louver', (vx, side * (wall(z) + .05), z), (vw, .11, .04), naval, collection)
        box(n + '.vent.hood', (vx, side * (wall(vz + vh / 2) + .09), vz + vh / 2 + .03), (vw + .12, .26, .07), roof, collection)
        # The registered turret has a plain roof aft of the four sight heads.
        for x in [-1.75, 0]:
            y = side * 2.184
            rod(n + '.roof.handhold', (x, y, H + .09), (x + .63, y, H + .09), .025, edge, collection, vertices=6)
            for xx in [x, x + .63]:
                rod(n + '.roof.handhold.foot', (xx, y, H - .01), (xx, y, H + .09), .025, edge, collection, vertices=6)
        # Trainer/pointer sight hood on each forward side plate, and roof-edge rails.
        sy = wall(1.85) - .02
        box(n + '.side.sight', (1.15, side * (sy + .12), 1.85), (.52, .30, .46), naval, collection)
        box(n + '.side.sight.bezel', (1.42, side * (sy + .12), 1.85), (.05, .22, .34), edge, collection)
        box(n + '.side.sight.lens', (1.45, side * (sy + .12), 1.85), (.018, .15, .24), dark, collection)
    # Rung ladders climb the sloped face between the ports.
    for y in [-spacing / 2, spacing / 2]:
        ladder('.face.ladder', (face_x(.35) + .05, y, .35), (face_x(H - .1) + .05, y, H - .1), .34, 'y', edge)
        for z in [.5, 2.7]:
            for dy in [-.17, .17]:
                rod(n + '.face.ladder.shoe', (face_x(z) - .01, y + dy, z), (face_x(z) + .07, y + dy, z), .02, naval, collection, vertices=6)
    for lateral in [-2.5, -.86, .86, 2.5]:
        cyl(n + '.roof.periscope.hood', (1.02, lateral, 3.16), .17, .35, naval, collection, 10)
        box(n + '.roof.periscope.hood.cap', (1.05, lateral, 3.24), (.48,.35,.22), naval, collection)
        box(n + '.roof.periscope.sight', (1.18, lateral, 3.2), (.025, .14, .10), dark, collection)
    cyl(n + '.aft.sight.mast', (-4.85, 0, H + .32), .055, .64, naval, collection, 8)
    box(n + '.rear.door', (-6.12, 0, 1.35), (.08, .85, 1.85), naval, collection)
    for z in [.75, 1.35, 1.95]:
        rod(n + '.rear.door.dog', (-6.17, -.32, z), (-6.17, -.14, z), .026, edge, collection, vertices=6)
    frame = list(set(bpy.context.scene.objects) - before)

    groups = []
    for lateral in centers:
        start = set(bpy.context.scene.objects)
        pivot = (spec['trunnionForward'], lateral, pz)
        muzzle = spec['muzzleForward']
        bore = spec['caliberM'] / 2
        rad = spec.get('barrelBaseRadius', .30)
        x0 = pivot[0]
        profile = [(x0 + .2, rad * .83), (x0 + 3.0, rad * .83), (x0 + 3.1, rad * .64), (muzzle - 2.0, rad * .48), (muzzle, rad * .44),
                   (muzzle, bore), (muzzle - .45, bore)]
        lathe('.barrel', pivot, profile, edge, bore_from=5, sides=16)
        groups.append(list(set(bpy.context.scene.objects) - start))
    yaw = articulate_aa(mount, collection, frame, groups)
    for side, lateral in zip(['left', 'center', 'right'], centers):
        rim=[]
        for i in range(24):
            a=i*math.tau/24;c=math.cos(a);s=math.sin(a);r=max(abs(c),abs(s))
            z=pz+.05+1.05*math.copysign(abs(s)**.5,s)
            rim.append((face_x(z)+.008,lateral+.53*math.copysign(abs(c)**.65,c),z))
        create_bloomer(mount, collection, helpers, materials, side, rim, x0+2.05, rad*.83, rings=5, fold_depth=.08, slack=.08, fullness=.075, forward_fullness=.17)
    return yaw
