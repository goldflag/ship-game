"""Original low-poly canvas gun-port covers with a fixed seam and pitching cuff.

Author the seam in mount-local Blender metres (+X bore, +Y port, +Z up).
The barrel recoils through the cuff, as with a sliding weather seal; the cuff
must overlap a continuous barrel sleeve throughout its declared recoil stroke.
No downloaded geometry or generated model is an authoring input.
"""
import math
import bpy


def create_bloomer(mount, collection, helpers, materials, side, rim_points,
                   collar_x, collar_radius, rings=5, fold_depth=.04, slack=.08,
                   fullness=0, forward_fullness=0):
    """Add after articulation; rim starts at +Y and winds toward +Z.

    The arbitrary 3D rim may follow a raked face and return over the roof.
    A five-degree shape grid keeps its seam seated at intermediate elevations.
    Shape metadata uses the existing renderer-only gunCover contract.
    """
    from blender_barrels import barrel_layout
    spec = mount['weapon']
    name = mount['id']
    rim = [tuple(float(v) for v in p) for p in rim_points]
    sectors = len(rim)
    if sectors < 8 or rings < 3 or collar_radius <= 0:
        raise ValueError('A bloomer needs at least eight rim points, three rings and a positive cuff radius')
    if any(len(p) != 3 or not all(math.isfinite(v) for v in p) for p in rim):
        raise ValueError('Invalid bloomer seam')
    lateral = next(y for key, y, _ in barrel_layout(spec) if key == side)
    yaw = next(o for o in collection.objects if o.get('nodeId') == name + '.yaw')
    elevation = next(o for o in collection.objects if o.get('nodeId') == name + '.' + side + '.elevation')
    pivot, height = spec['trunnionForward'], spec['pivotHeight']
    base = float(spec['elevationMinDeg'])
    maximum = float(spec['elevationMaxDeg'])
    bulge = fullness
    angles = sorted({float(a) for a in range(math.floor(base / 5) * 5 + 5, math.ceil(maximum / 5) * 5, 5)
                     if base < a < maximum} | {maximum})
    if not base < maximum:
        raise ValueError('Invalid gun elevation interval')

    def points(degrees):
        theta = math.radians(degrees)
        c, s = math.cos(theta), math.sin(theta)
        result = []
        for j in range(rings):
            t = j / (rings - 1)
            envelope = math.sin(math.pi * t)
            for i, start in enumerate(rim):
                angle = i * math.tau / sectors
                ca, sa = math.cos(angle), math.sin(angle)
                along, up = collar_x - pivot, collar_radius * sa
                end = (pivot + along * c - up * s,
                       lateral + collar_radius * ca,
                       height + along * s + up * c)
                p = [start[k] + (end[k] - start[k]) * t for k in range(3)]
                fold = envelope * fold_depth * math.sin(angle * 6 + t * 3)
                p[0] += forward_fullness * envelope
                p[1] += (bulge * envelope + fold) * ca
                p[2] += (bulge * envelope + fold) * sa - slack * envelope
                result.append(p)
        return result

    faces = [(j * sectors + i, j * sectors + (i + 1) % sectors,
              (j + 1) * sectors + (i + 1) % sectors, (j + 1) * sectors + i)
             for j in range(rings - 1) for i in range(sectors)]
    cover = helpers['mesh'](name + '.' + side + '.canvas-bag', points(base), faces,
                            materials.get('canvas', materials['dark']), collection, True)
    cover.parent = yaw
    cover['assemblyId'] = name
    cover['nodeId'] = name + '.' + side + '.cover'
    cover['gunCoverElevationId'] = name + '.' + side + '.elevation'
    cover['gunCoverBaseAngle'] = base
    cover['gunCoverAngles'] = angles
    cover['gunCoverFixedVertexCount'] = sectors
    cover.shape_key_add(name='Basis')
    knots = [base] + angles
    for i, angle in enumerate(angles):
        shape = cover.shape_key_add(name='Elevation ' + str(angle))
        for vertex, p in zip(shape.data, points(angle)):
            vertex.co = p
        driver = shape.driver_add('value').driver
        driver.type = 'SCRIPTED'
        variable = driver.variables.new()
        variable.name = 'pitch'
        variable.type = 'TRANSFORMS'
        target = variable.targets[0]
        target.id = elevation
        target.transform_type = 'ROT_Y'
        target.transform_space = 'LOCAL_SPACE'
        lower = knots[i]
        rising = f'(-pitch*57.29577951308232-({lower}))/({angle-lower})'
        falling = f'({angles[i+1]}+pitch*57.29577951308232)/({angles[i+1]-angle})' if i + 1 < len(angles) else '1'
        driver.expression = f'max(0,min(1,{rising},{falling}))'
    return cover
