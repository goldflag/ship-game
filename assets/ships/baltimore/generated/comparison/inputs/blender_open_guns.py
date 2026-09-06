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
    for side in [-1, 1]:
        attach(box(name + '.cradle', (trunnion, side * width * .36, height * .65),
                   (.50 if style == 'open-pedestal' else .20, width * .12, height * .7), gray, col), yaw)
        attach(cyl(name + '.trunnion-cover', (trunnion, side * width * .4, height),
                   .16 if style == 'open-pedestal' else .07, .12, steel, col, 16), yaw)
        attach(box(name + '.seat', (-.45, side * width * .40, height * .46),
                   (.4, .35, .09), gray, col), yaw)
    if style == 'oerlikon':
        # Split shield leaves the barrel and sights visible.
        for side in [-1, 1]:
            attach(box(name + '.shield', (.2, side * .28, .92), (.025, .46, .62), gray, col), yaw)
    for index, side in enumerate(sides):
        lateral = ((count - 1) / 2 - index) * spec['barrelSpacing']
        elevation = empty(side + '.elevation', yaw, (trunnion, lateral, height))
        elevation.rotation_euler.y = -math.radians(1)
        recoil = empty(side + '.recoil', elevation)
        length = spec['muzzleForward'] - trunnion
        empty(side + '.muzzle', recoil, (length, 0, 0))
        radius = spec.get('barrelBaseRadius', spec['caliberM'] * .85)
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
            attach(box(name + '.loading-tray', (-1.18, 0, -.19), (.95, .48, .08), gray, col), elevation)
        elif style == 'oerlikon':
            attach(cyl(name + '.drum', (-.12, 0, .15), .17, .17, dark, col, 20), recoil)
        else:
            attach(box(name + '.ammunition-feed', (-.20, 0, .21), (.38, .18, .18), gray, col), recoil)
    for side in [-1, 1]:
        attach(rod(name + '.sight-support', (-.12, side * width * .43, height * .7),
                   (.1, side * width * .43, height + .35), .025, steel, col), yaw)
        attach(rod(name + '.sight', (0, side * width * .43, height + .35),
                   (.27, side * width * .43, height + .35), .055, dark, col), yaw)
    for obj in set(bpy.context.scene.objects) - before:
        obj['assemblyId'] = name
    return yaw
