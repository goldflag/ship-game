"""Joint binding for original AA fittings authored in a local +X firing frame.

Recipes retain their own geometry. Barrel groups are ordered port to starboard,
matching the shared barrel-ID contract after the exporter converts coordinates.
Foundations stay outside this hierarchy. Registered consumers track this file in
recipe-inputs.json so changes invalidate their generated models.
"""
import math
import bpy
from mathutils import Matrix


def articulate_aa(mount, collection, frame_objects, barrel_groups):
    weapon = mount['weapon']
    sides = {1: ['center'], 2: ['left', 'right'],
             3: ['left', 'center', 'right'],
             4: ['left-outer', 'left', 'right', 'right-outer']}[weapon.get('barrelCount', 2)]
    assert len(sides) == len(barrel_groups), mount['id']

    def joint(suffix, parent=None, location=(0, 0, 0)):
        ob = bpy.data.objects.new(mount['id'] + '.' + suffix, None)
        collection.objects.link(ob)
        ob['nodeId'] = ob.name
        ob['assemblyId'] = mount['id']
        ob.parent = parent
        ob.location = location
        return ob

    yaw = joint('yaw')
    for ob in frame_objects:
        ob['assemblyId'] = mount['id']
        ob.parent = yaw
    for i, (side, objects) in enumerate(zip(sides, barrel_groups)):
        lateral = ((len(sides) - 1) / 2 - i) * weapon['barrelSpacing']
        pivot = (weapon['trunnionForward'], lateral, weapon['pivotHeight'])
        pitch = joint(side + '.elevation', yaw, pivot)
        pitch.rotation_euler.y = -math.radians(1)
        recoil = joint(side + '.recoil', pitch)
        joint(side + '.muzzle', recoil, (weapon['muzzleForward'] - weapon['trunnionForward'], 0, 0))
        # These objects were authored at the neutral 1-degree elevation. Convert
        # to recoil-local space without repeated whole-scene dependency updates.
        inverse = (Matrix.Translation(pivot) @ Matrix.Rotation(-math.radians(1), 4, 'Y')).inverted()
        for ob in objects:
            local = ob.matrix_basis.copy()
            ob['assemblyId'] = mount['id']
            ob.parent = recoil
            ob.matrix_basis = inverse @ local
    x, y, z = mount['position']
    yaw.location = (-z, -x, y)
    yaw.rotation_euler.z = -math.radians(mount['bearingDeg'])
    return yaw
