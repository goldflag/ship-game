"""Original flush door/window silhouettes. X=0 is the wall in Blender.

No rim, fasteners or solid thickness. Installed silhouettes conform to native
hull panels; the closed underlying hull remains unchanged.
"""
import math
from geometry import Model


def outline(width, height, radius):
    if not radius:
        return [(width/2, height/2), (-width/2, height/2),
                (-width/2, -height/2), (width/2, -height/2)]
    points = []
    for cy, cz, angle in [(width/2-radius, height/2-radius, 0),
                          (-width/2+radius, height/2-radius, 90),
                          (-width/2+radius, -height/2+radius, 180),
                          (width/2-radius, -height/2+radius, 270)]:
        for i in range(7):
            a = math.radians(angle+i*15)
            point = (cy+radius*math.cos(a), cz+radius*math.sin(a))
            if not points or math.dist(points[-1], point) > 1e-7:
                points.append(point)
    if math.dist(points[0], points[-1]) < 1e-7:
        points.pop()
    return points


def create_window(part, col, helpers, materials):
    m = Model(col, helpers, materials)
    width, height, _ = part['size']
    door = part.get('wallMount') == 'door'
    radius = min(width, height)/2 if part.get('wallMount') == 'porthole' else min(width,height)*.16 if 'rounded' in part['id'] else 0
    points = outline(width, height, radius)
    center = part['boundsCenter'][1]
    m.mesh('flush-door' if door else 'flush-glazing', [(0,y,z+center) for y,z in points], [tuple(range(len(points)))], mat='roof' if door else 'glass')
    return m.root
