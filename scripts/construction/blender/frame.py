"""Construction <-> Blender authoring frame; the Python twin of scripts/construction/blenderFrame.ts.

Construction (runtime): +X starboard, +Y up, -Z bow, metres.
Blender authoring:      +X bow, +Y port, +Z up, metres (waterline at Z = 0 when the source's is).

The map is a proper rotation, so winding and handedness survive it. Hull-piece yaw (`rotationDeg`)
is counter-clockwise from above, the same sense as a Blender Z rotation; equipment `bearingDeg` is
clockwise from above (0 bow, 90 starboard), so it is the negated Blender Z rotation.
Plain Python: no bpy, so tests can run it with any interpreter.
"""


def to_blender(v):
    x, y, z = v
    return (-z, -x, y)


def from_blender(v):
    bx, by, bz = v
    return (-by, bz, -bx)


def size_to_blender(s):
    x, y, z = s
    return (z, x, y)


def size_from_blender(s):
    bx, by, bz = s
    return (by, bz, bx)


def degrees360(value):
    n = value % 360.0
    n = round(n * 1e9) / 1e9
    return 0.0 if n == 360.0 or abs(n) < 1e-9 else n


def bearing_to_blender_yaw(bearing_deg):
    return degrees360(-bearing_deg)


def blender_yaw_to_bearing(yaw_deg):
    return degrees360(-yaw_deg)


def rotation_to_blender_yaw(rotation_deg):
    return degrees360(rotation_deg)


def blender_yaw_to_rotation(yaw_deg):
    return degrees360(yaw_deg)


if __name__ == '__main__':
    # `python3 frame.py` prints a fixed table the TypeScript test compares with its own module.
    import json
    points = [(1.0, 2.0, 3.0), (-4.5, 0.25, -7.0), (0.0, 0.0, -1.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)]
    angles = [0.0, 30.0, 90.0, 180.0, 270.0, -45.0, 725.5]
    print(json.dumps({
        'toBlender': [to_blender(p) for p in points],
        'fromBlender': [from_blender(p) for p in points],
        'sizeToBlender': [size_to_blender(p) for p in points],
        'sizeFromBlender': [size_from_blender(p) for p in points],
        'bearingToBlenderYaw': [bearing_to_blender_yaw(a) for a in angles],
        'blenderYawToBearing': [blender_yaw_to_bearing(a) for a in angles],
        'rotationToBlenderYaw': [rotation_to_blender_yaw(a) for a in angles],
        'blenderYawToRotation': [blender_yaw_to_rotation(a) for a in angles],
    }))
