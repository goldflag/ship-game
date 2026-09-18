"""Original low-poly porthole based on the owner's supplied visual reference.

Twelve-sided glazing and bevelled rim, with a seven-segment rain eyebrow.
Blender X=0 is the wall; positive X is outward. No through-hull opening.
"""
import math
from geometry import Model


def create_rimmed_porthole(part, col, helpers, materials):
    m = Model(col, helpers, materials)
    # Keep the shallow frame and eyebrow seated while following sloped hulls.
    m.root['wallRelief'] = True
    angles = [math.radians(15 + i * 30) for i in range(12)]
    pane = [(0.003, .195 * math.cos(a), .195 * math.sin(a)) for a in angles]
    m.mesh('glazing', pane, [tuple(range(12))], mat='glass')

    def band(name, angles, profile, closed):
        n, k = len(angles), len(profile)
        vertices = [(depth, radius * math.cos(a), radius * math.sin(a))
                    for a in angles for radius, depth in profile]
        faces = [(i*k+j, ((i+1)%n)*k+j, ((i+1)%n)*k+(j+1)%k, i*k+(j+1)%k)
                 for i in range(n if closed else n-1) for j in range(k)]
        if not closed:
            faces += [tuple(reversed(range(k))), tuple((n-1)*k+j for j in range(k))]
        m.mesh(name, vertices, faces, mat='naval')

    # A bevel catches the light without subdivisions, tubes or tiny fasteners.
    band('rim', angles, [(.195, 0), (.195, .015), (.208, .023), (.226, 0)], True)
    band('rain-eyebrow', [math.radians(-15+i*30) for i in range(8)],
         [(.276, 0), (.276, .036), (.300, 0)], False)
    return m.root
