"""Flight-deck end girders and the quarterdeck under the after overhang; executed in build.py's scope.

After GameModels3D pasa518 where the 1942 ship had the same structure: a deep plated fascia girder
with a rolled round-down lip across each flight-deck end, plate girders under the deck-end frames,
and quarterdeck fittings (boats in cradles, bitts, lockers and a hose rack).
The reference's side plating that encloses the forecastle and quarterdeck is a later addition and is
left out: the 1942 ends stay open."""

def build_deck_ends():
    k = Kit('Flight deck end girders', COL['Hangar and galleries'], 'flight-deck-end-girders')
    outline = [(-z, -x) for x, z in S['flight-deck']['footprint']]
    xmax = max(p[0] for p in outline); xmin = min(p[0] for p in outline)
    deck_bottom = S['flight-deck']['baseY']
    def fascia(path, depth, name):
        # Plate hung from the deck edge, a bottom flange and a rolled lip at the deck line.
        k.wall(path, deck_bottom - depth, depth, .05, 'naval', False, 0)
        k.tube([(x, y, deck_bottom - depth + .03) for x, y in path], .06, 'naval', 6)
        k.tube([(x, y, FLIGHT - .25) for x, y in path], .1, 'naval', 8)
        for a, b in zip(path, path[1:]):
            n = max(1, int(math.dist(a, b) / 1.6))
            for i in range(1, n):
                x = a[0] + (b[0] - a[0]) * i / n; y = a[1] + (b[1] - a[1]) * i / n
                k.box((x, y, deck_bottom - depth / 2), (.08, .08, depth - .08), math.atan2(b[1] - a[1], b[0] - a[0]), 'naval')
    # Forward end: the outline's tapered bow end (x beyond 107 m), inside the deck edge.
    fwd = sorted([p for p in outline if p[0] > xmax - 9.5], key=lambda p: math.atan2(p[1], p[0] - (xmax - 20)))
    fwd = [(x - .03 * (1 if x > xmax - .1 else 0), y * (1 - .003)) for x, y in fwd]
    fascia(fwd, 1.25, 'forward')
    # After end: straight across the square end, returning 4 m along each side.
    aft = [(xmin + 4, -11.55), (xmin + .03, -11.55), (xmin + .03, 11.55), (xmin + 4, 11.55)]
    fascia(aft, 1.0, 'aft')
    # Plate girders under the deck-end frames (the knees and crossbeam rods stay).
    for x in [87, 93, 99, 105, 111, -113, -119, -125]:
        for y0, y1 in [(-10.8, -6.2), (-6.2, 6.2), (6.2, 10.8)]:
            k.box((x, (y0 + y1) / 2, deck_bottom - .42), (.06, y1 - y0, .8), 0, 'naval')
            k.box((x, (y0 + y1) / 2, deck_bottom - .82), (.3, y1 - y0, .05), 0, 'naval')
    k.emit()


def build_quarterdeck():
    k = Kit('Quarterdeck fittings', COL['Deck equipment'], 'quarterdeck-fittings')
    boats = Fittings(dict(mesh=mesh, cyl=cyl, rod=rod, box=box), M, COL['Deck equipment'])
    for sg in [-1, 1]:
        x = -116.2; y = sg * 3.3
        z = interpolate(H['deckHeights'], x + H['length'] / 2)
        boats.boat('Quarterdeck dinghy', x, y, z + .16, 3.6, 1.45, False)
        # Bitts, a chock at the counter and a locker by the reels.
        bollard(k, -121.4, sg * 2.2, interpolate(H['deckHeights'], -121.4 + H['length'] / 2), 0)
        locker(k, -111.5, sg * 6.4, interpolate(H['deckHeights'], -111.5 + H['length'] / 2), (1.1, .6, .9), 0)
        hose_rack(k, -110.2, sg * 6.9, interpolate(H['deckHeights'], -110.2 + H['length'] / 2) + 1.2, (0, -sg))
    k.emit()

build_deck_ends()
build_quarterdeck()
