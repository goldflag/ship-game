"""Original representative models for the three procedural deck path profiles.

These four-metre straight samples support standalone library inspection. Player
routes use the versioned catalog profile and original path visual recipe; native
construction owns their loading and attachment checks. All dimensions are metres.
"""
import math
from geometry import Model


def create_railing(part, col, helpers, materials):
    model = Model(col, helpers, materials)
    profile = part['path']
    height, width = profile['heightM'], profile['diameterM']
    count = math.ceil(4 / profile['postSpacingM'])
    for i in range(count + 1):
        x = 4 * i / count
        model.box('stanchion', (x, 0, height / 2), (width, width, height))
    rails = profile.get('railCount', 3)
    for level in range(1, rails + 1):
        z = height * level / rails - width / 2
        model.box('horizontal-rail', (2, 0, z), (4, width, width))
    return model.root


def create_rope(part, col, helpers, materials):
    model = Model(col, helpers, materials)
    radius = part['path']['diameterM'] / 2
    model.rod('rope', (0, 0, 0), (4, 0, 0), radius, mat='rope', vertices=12)
    return model.root


def create_chain(part, col, helpers, materials):
    model = Model(col, helpers, materials)
    diameter = part['path']['diameterM']
    # Alternating interlocked oval links, dimensioned by the wire diameter.
    count = math.ceil(4 / (diameter * 4))
    pitch = 4 / count
    for i in range(count + 1):
        x = i * pitch
        points = []
        for j in range(16):
            angle = j * math.tau / 16
            a, b = math.cos(angle) * diameter * 2.5, math.sin(angle) * diameter * 1.5
            points.append((x + a, b if i % 2 else 0, 0 if i % 2 else b))
        model.path('chain-link', points, diameter / 2, closed=True, mat='edge', vertices=8)
    return model.root
