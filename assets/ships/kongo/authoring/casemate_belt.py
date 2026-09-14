"""Original casemate tier, shared by the visible model and CPU contact authoring.

Breadths follow the approved model's saved cross-section measurements. The
recess cheeks and aft transition still need closer visual acceptance.
"""
import math
import bpy

# Blender +X forward, +Y port. The outer wall follows the hull shoulder rather
# than the former narrow, straight-sided deckhouse approximation.
HALF_OUTLINE = [(-31, 8.5), (-24, 11.2), (-16, 12.8), (-8.52, 13.23),
                (0, 13.315), (16, 13.11), (25, 12.825), (31, 12.58),
                (36, 12.32), (40, 12.0), (49, 9.0), (53, 5.7)]
OUTLINE = [(x, -y) for x, y in HALF_OUTLINE] + list(reversed(HALF_OUTLINE))


def openings(mounts):
    for mount in mounts:
        if mount['partId'] != 'type41-152-kongo-casemate':
            continue
        a, z, c = mount['position']
        x, y = -c, -a
        angle = -math.radians(mount['bearingDeg'])
        def point(u, v):
            return (x + u * math.cos(angle) - v * math.sin(angle),
                    y + u * math.sin(angle) + v * math.cos(angle))
        # Saved cross sections put the three broadside well backs about 2.7 m
        # inboard of the bearing. The diagonal after well has its own contour.
        broadside = not mount['id'].endswith('-4')
        back_depth = 2.7 if broadside else 1.34
        flare = 12 if broadside else 9
        back = [(back_depth * math.cos(math.pi / 2 + i * math.pi / 24),
                 1.48 * math.sin(math.pi / 2 + i * math.pi / 24)) for i in range(24)]
        yield mount, [point(u, v) for u, v in [(0, -1.48), (9, -flare), (9, flare)] + back]


def create(prism, mounts, naval, wood):
    tier = prism('deck.central-tier', OUTLINE, 4.66, 7.28, naval)
    planking = prism('deck.central-planking', OUTLINE, 7.28, 7.31, wood)
    for mount, mouth in openings(mounts):
        cutter = prism('temporary-casemate-cut', mouth, mount['position'][1] - .02, 7.46, naval)
        for target in [tier, planking]:
            bpy.context.view_layer.objects.active = target
            modifier = target.modifiers.new('Authored casemate recess', 'BOOLEAN')
            modifier.operation = 'DIFFERENCE'
            modifier.solver = 'EXACT'
            modifier.object = cutter
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        bpy.data.objects.remove(cutter, do_unlink=True)
    return tier, planking
