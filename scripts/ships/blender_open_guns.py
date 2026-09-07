"""Original open US naval mounts. Catalog dimensions and stable runtime joints.

Pedestal, breech, recoil slide and sights are independently authored primitives.
These are geometrical reconstructions, not imported commercial model components.
"""
import math
import bpy


def create_open_mount(mount, col, helpers, materials):
    mesh, cyl, rod, box = (helpers[k] for k in ['mesh', 'cyl', 'rod', 'box'])
    spec = mount['weapon']
    style = spec['mountingStyle']
    gray, dark, steel = (materials[k] for k in ['naval', 'dark', 'edge'])
    count = spec.get('barrelCount', 2)
    sides = {1: ['center'], 2: ['left', 'right'], 3: ['left', 'center', 'right'],
             4: ['left-outer', 'left', 'right', 'right-outer']}[count]
    name = mount['id']
    before = set(bpy.context.scene.objects)

    def empty(suffix, parent=None, loc=(0, 0, 0)):
        o = bpy.data.objects.new(name + '.' + suffix, None)
        col.objects.link(o)
        o['nodeId'] = o.name
        o['assemblyId'] = name
        o.parent = parent
        o.location = loc
        return o

    def attach(obj, parent):
        # Helpers author local coordinates; assign parent without preserving world.
        obj.parent = parent
        obj['assemblyId'] = name
        return obj

    x, y, z = mount['position']
    root = empty('base', loc=(-z, -x, y))
    yaw = empty('yaw', root)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    r = spec['barbetteRadius']
    attach(cyl(name + '.foundation', (0, 0, .10), r, .20, steel, col, 32), root)
    attach(cyl(name + '.pedestal', (0, 0, spec['pivotHeight'] * .36), r * .52,
               spec['pivotHeight'] * .65, gray, col, 24, r2=r * .34), yaw)
    trunnion, height = spec['trunnionForward'], spec['pivotHeight']
    width = spec['gunhouseSize'][1]
    hand_trained = spec['caliberM'] <= .020
    fork = min(width * .36, .19) if hand_trained else width * .36
    # A continuous rotating saddle carries the two trunnion brackets. The old
    # recipe placed separate cheek plates beside the pedestal with air between.
    attach(box(name + '.carriage-saddle', (trunnion * .5, 0, height * .51),
               (max(.32, trunnion + .24), fork * 2 + .12, height * .20), gray, col), yaw)
    for side in [-1, 1]:
        attach(box(name + '.cradle', (trunnion, side * fork, height * .75),
                   (.50 if style == 'open-pedestal' else .20, .12, height * .55), gray, col), yaw)
        attach(rod(name + '.trunnion-cover', (trunnion, side * (fork-.08), height),
                   (trunnion, side * (fork+.10), height),
                   .16 if style == 'open-pedestal' else .07, steel, col, vertices=16), yaw)
        if not hand_trained:
            seat_y = side * width * .40
            attach(rod(name + '.seat-arm', (0, 0, height * .43),
                       (-.45, seat_y, height * .43), .055, gray, col), yaw)
            attach(box(name + '.seat', (-.45, seat_y, height * .46),
                       (.4, .35, .09), gray, col), yaw)
    if style == 'oerlikon':
        # OP 909: shield brackets attach to the carriage; the standing gunlayer
        # uses a shoulder rest, not the two seats formerly shared with heavy guns.
        for side in [-1, 1]:
            attach(box(name + '.shield', (.2, side * .28, .92), (.025, .46, .62), gray, col), yaw)
            attach(rod(name + '.shield-bracket', (trunnion, side * fork, height * .66),
                       (.2, side * .28, .75), .032, gray, col), yaw)
    attach(rod(name + '.trunnion-shaft', (trunnion, -fork, height),
               (trunnion, fork, height), .075 if hand_trained else .13, steel, col), yaw)
    for index, side in enumerate(sides):
        lateral = ((count - 1) / 2 - index) * spec['barrelSpacing']
        elevation = empty(side + '.elevation', yaw, (trunnion, lateral, height))
        elevation.rotation_euler.y = -math.radians(1)
        recoil = empty(side + '.recoil', elevation)
        length = spec['muzzleForward'] - trunnion
        empty(side + '.muzzle', recoil, (length, 0, 0))
        radius = spec.get('barrelBaseRadius', spec['caliberM'] * .85)
        # The slide stays with elevation while the barrel/breech recoil inside
        # it. Its circular bearing remains on the shaft at every elevation.
        attach(rod(name + '.elevating-bearing', (0, -.12, 0), (0, .12, 0),
                   max(.09, radius * 1.35), steel, col, vertices=20), elevation)
        attach(box(name + '.recoil-slide', (-.12, 0, -radius * .7),
                   (.64 + spec['recoilM'], max(.12, radius * 2.5), max(.10, radius * 1.4)), gray, col), elevation)
        attach(box(name + '.breech', (-.5 if style == 'open-pedestal' else -.25, 0, 0),
                   (1.1 if style == 'open-pedestal' else .55, radius * 3, radius * 3), steel, col), recoil)
        attach(rod(name + '.barrel-root', (0, 0, 0), (length * .38, 0, 0), radius, steel, col,
                   r2=radius * .77, vertices=16), recoil)
        attach(rod(name + '.barrel-tube', (length * .38, 0, 0), (length, 0, 0), radius * .77, steel, col,
                   r2=max(spec['caliberM'] * .59, radius * .48), vertices=16), recoil)
        attach(rod(name + '.bore', (length, 0, 0), (length + .004, 0, 0), spec['caliberM'] / 2,
                   dark, col, vertices=16), recoil)
        if style == 'open-pedestal':
            attach(rod(name + '.recoil-cylinder', (-.65, 0, -.26), (1.1, 0, -.26), .14,
                       gray, col, vertices=16), recoil)
            attach(box(name + '.loading-tray', (-1.08, 0, -.19), (1.20, .48, .08), gray, col), elevation)
            attach(rod(name + '.loading-tray-bracket', (-.30, 0, -radius * .7),
                       (-.95, 0, -.19), .075, gray, col), elevation)
        elif style == 'oerlikon':
            attach(cyl(name + '.drum', (-.12, 0, .15), .17, .17, dark, col, 20), recoil)
        else:
            attach(box(name + '.ammunition-feed', (-.20, 0, radius * 1.5 + .07),
                       (.38, .18, .18), gray, col), recoil)
        if hand_trained:
            for sign in [-1, 1]:
                attach(rod(name + '.shoulder-rest-arm', (-.30, 0, -.04),
                           (-.72, sign * .20, -.09), .028, gray, col), elevation)
                attach(box(name + '.shoulder-pad', (-.74, sign * .20, -.09),
                           (.08, .15, .22), dark, col), elevation)
            attach(rod(name + '.sight-support', (-.18, 0, .03),
                       (.10, 0, .35), .022, steel, col), elevation)
            attach(rod(name + '.sight', (0, 0, .35), (.27, 0, .35), .045, dark, col), elevation)
    if not hand_trained:
        for side in [-1, 1]:
            attach(rod(name + '.sight-support', (trunnion, side * fork, height * .85),
                       (.1, side * width * .43, height + .35), .025, steel, col), yaw)
            attach(rod(name + '.sight', (0, side * width * .43, height + .35),
                       (.27, side * width * .43, height + .35), .055, dark, col), yaw)
    for obj in set(bpy.context.scene.objects) - before:
        obj['assemblyId'] = name
    return yaw
