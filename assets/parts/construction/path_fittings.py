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
    height, radius = profile['heightM'], profile['diameterM'] / 2
    count = math.ceil(4 / profile['postSpacingM'])
    for i in range(count + 1):
        x = 4 * i / count
        model.box('post-foot', (x, 0, .015), (.12, .12, .03), mat='edge')
        model.rod('stanchion', (x, 0, .03), (x, 0, height), radius * 1.25, vertices=12)
        for sign in [-1, 1]:
            model.cyl('foot-bolt', (x, sign * .043, .037), .008, .014, mat='edge', vertices=6)
    for z in [height / 3, height * 2 / 3, height]:
        model.rod('horizontal-rail', (0, 0, z), (4, 0, z), radius, vertices=12)
    return model.root


def create_rope(part, col, helpers, materials):
    model = Model(col, helpers, materials)
    radius = part['path']['diameterM'] / 2
    # A subdued original rope colour, with no emissive or external texture data.
    rope = materials['naval'].copy()
    rope.name = 'natural-rope'
    rope.diffuse_color = (.31, .23, .13, 1)
    bsdf = rope.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rope.diffuse_color
    bsdf.inputs['Roughness'].default_value = .95
    model.m = dict(materials, rope=rope)
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
