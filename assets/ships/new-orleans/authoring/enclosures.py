"""Open decks the plan tracer measured as solid blocks, corrected before walls.py and author-blueprint.py use the blocks.

structures.py keeps a plan cell only where a surface of the reference covers it, so an open deck walled in by
bulwarks under a platform comes back as a slab up to the bulwark top. Vertical lines through the reference find only
the deck and the platform above in four such places: the lower bridge round the pilothouse (under the navigating
bridge), the open navigating bridge round the director tower's base (under the director platform), the midships 20 mm
tub round its tower (under the twin mounts' platform) and the director platform abaft the director tower (under the
lookout platform). Here those slabs are dropped or cut back and the blocks standing in them are carried down to the
deck; walls.py then traces the bulwarks that the slabs' outlines had hidden.

Blocks are named by the tracer's number: deckhouse-025 in structures.py's output is bridge-025 in the blueprint.
`correct(structures)` edits the list in place and exits when a block is not the one measured here, so a
re-measurement that moves these blocks fails loudly instead of cutting the wrong ones.
"""
import sys

# Slabs over an open deck, dropped: number -> (base, top) as measured (the blueprint seated bridge-025 on 17.5 m).
SLABS = {'012': (12.25, 13.05), '025': (17.5, 18.85), '051': (9.65, 10.65)}
# Blocks standing in a dropped slab, carried down to the deck under it: number -> (base as measured, new base, top).
# The pilothouse (017) stands on the lower bridge's deck at 12.1 m and takes in the 10 cm plate (016) at its foot.
DOWN = {'017': (13.05, 12.1, 14.75), '027': (18.85, 17.5, 19.75), '055': (10.65, 9.65, 12.0)}
COVERED = {'016': (12.15, 12.25)}
# Blocks cut back to their part forward of runtime z (the director tower's after face): number -> (z, base, top).
# (029, the tower's foot above it, is taken into the tower by author-blueprint.py.)
CUT = {'028': (-23.44, 19.9, 20.45)}

# The bulwarks those slabs stood in, which walls.py sets aside as the slabs' own sides. Measured on the reference's
# plan cuts (ship:slice --plan and walls.py run without the slabs), runtime metres, each on its plate's midline, in
# the walls' format; walls.py adds them to the traced walls, so the recipe draws them and the interlocks see them.
BULWARKS = [
    # the lower bridge: the side screens abreast the pilothouse, the side bulwark between its traced pieces ahead of
    # them, and the breastwork across the front between the forward 20 mm tubs
    {'base': 12.009, 'top': 13.2, 'pts': [[3.413, -24.892], [3.413, -27.422]], 'mirror': True},
    {'base': 12.009, 'top': 13.2, 'pts': [[4.27, -28.4], [4.27, -29.72]], 'mirror': True},
    {'base': 12.009, 'top': 13.2, 'pts': [[-2.2, -33.303], [2.2, -33.303]], 'mirror': False},
    # the open navigating bridge's after arm round the pilothouse top, 1.43 m high, from the forward bulwark's after
    # ends (port to the after corner piece traced at 20.4 m, starboard to the foremast)
    {'base': 17.396, 'top': 18.825, 'pts': [[2.989, -28.086], [2.123, -28.086], [2.123, -21.249], [-0.826, -21.249]], 'mirror': False},
    {'base': 17.396, 'top': 18.825, 'pts': [[-3.29, -28.086], [-2.14, -28.086], [-2.14, -21.089]], 'mirror': False},
    # the director platform's after bulwark: its quarters from the traced sides to the after pieces, and inboard of
    # them to the foremast
    {'base': 19.763, 'top': 20.8, 'pts': [[2.525, -21.279], [3.4, -23.8]], 'mirror': True},
    {'base': 19.763, 'top': 20.8, 'pts': [[0.275, -21.279], [1.3, -21.279]], 'mirror': True},
]


def number(s):
    return s['id'].rsplit('-', 1)[-1]


def near(a, b):
    return abs(a - b) <= .06


def clip_forward(ring, z0):
    """The part of a closed outline (x, z) with z <= z0 (Sutherland-Hodgman against one line)."""
    out = []
    for a, b in zip(ring, ring[1:] + ring[:1]):
        ina, inb = a[1] <= z0 + 1e-9, b[1] <= z0 + 1e-9
        if ina:
            out.append(list(a))
        if ina != inb:
            t = (z0 - a[1]) / (b[1] - a[1])
            out.append([round(a[0] + (b[0] - a[0]) * t, 4), z0])
    # drop repeated points and points in line with their neighbours along the cut
    clean = []
    for p in out:
        if not clean or abs(p[0] - clean[-1][0]) > 1e-6 or abs(p[1] - clean[-1][1]) > 1e-6:
            clean.append(p)
    if len(clean) > 1 and abs(clean[0][0] - clean[-1][0]) < 1e-6 and abs(clean[0][1] - clean[-1][1]) < 1e-6:
        clean.pop()
    return clean


def correct(structures):
    """Apply the corrections to a list of measured blocks (dicts with id, footprint, baseY, height) in place."""
    by = {}
    for s in structures:
        by.setdefault(number(s), []).append(s)

    def the(n, what):
        found = [s for s in by.get(n, []) if not s['id'].startswith('wall-')]
        if len(found) != 1:
            sys.exit(f'enclosures.py: no single block {n} ({what}); re-check the corrections after re-measuring')
        return found[0]

    drop = set()
    for n, (base, top) in list(SLABS.items()) + list(COVERED.items()):
        found = [s for s in by.get(n, []) if not s['id'].startswith('wall-')]
        for s in found:
            if not (near(s['baseY'], base) or near(s['baseY'], base + .05)) or not near(s['baseY'] + s['height'], top):
                sys.exit(f"enclosures.py: {s['id']} ({s['baseY']}-{s['baseY'] + s['height']} m) is not the slab measured here")
            drop.add(id(s))
    for n, (was, base, top) in DOWN.items():
        s = the(n, 'carried down')
        if not near(s['baseY'] + s['height'], top) or not (near(s['baseY'], was) or near(s['baseY'], base)):
            sys.exit(f"enclosures.py: {s['id']} ({s['baseY']}-{s['baseY'] + s['height']} m) is not the block measured here")
        s['height'] = round(s['baseY'] + s['height'] - base, 3)
        s['baseY'] = base
    for n, (z0, base, top) in CUT.items():
        s = the(n, 'cut back')
        if not near(s['baseY'], base) or not near(s['baseY'] + s['height'], top) or 'surface' in s:
            sys.exit(f"enclosures.py: {s['id']} is not the block measured here")
        s['footprint'] = clip_forward(s['footprint'], z0)
        if len(s['footprint']) < 3:
            sys.exit(f"enclosures.py: nothing of {s['id']} lies forward of z {z0}")
    for n in list(DOWN) + list(CUT):
        s = the(n, 'renamed')
        if 'name' in s:
            s['name'] = s['name'].rsplit(' ', 2)[0] + f" {s['baseY']:.1f}-{s['baseY'] + s['height']:.1f} m"
        if 'bounds' in s:
            xs = [p[0] for p in s['footprint']]
            zs = [p[1] for p in s['footprint']]
            s['bounds'] = [min(xs), min(zs), max(xs), max(zs)]
    structures[:] = [s for s in structures if id(s) not in drop]
    return structures
