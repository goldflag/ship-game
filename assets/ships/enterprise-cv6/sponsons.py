"""5-inch gun sponsons, executed in build.py's scope after details.py.

Measured against GameModels3D pasa518 (reference raised 0.87 m and shifted 0.4 m aft): each
pair of 5-inch/38 mounts stands on one plated sponson whose side continues the hull flare up
to a gun deck just below the flight deck, with a bulge and splinter bulwark round each gun.
The gun deck's inboard edge stays open to the forecastle and quarterdeck (1942 fit)."""

def build_sponsons():
    groups = {}
    for m in D['mounts']:
        if m['partId'].startswith('us-5'):
            x, y, z = -m['position'][2], -m['position'][0], m['position'][1]
            groups.setdefault((x > 0, y > 0), []).append((x, abs(y), z, m['id']))
    for (fore, port), guns in groups.items():
        sign = 1 if port else -1
        guns.sort()
        deck = guns[0][2]
        xs = [g[0] for g in guns]
        # Plan outline (x, half-breadth) measured from the reference gun deck.
        if fore:
            edge, bulge_r, bulge_out, inboard = 15.57, 2.40, 16.47, 10.2
            aft_end, fwd_end = min(xs) - 5.7, max(xs) + 4.2
            fwd_taper = [(fwd_end - 2.3, edge), (fwd_end, 11.2)]
            aft_taper = [(aft_end, 14.3), (aft_end + 2.3, edge)]
        else:
            # Bulges centred on each gun, clear of the Mk 24's 2.14 m rotating deck.
            edge, bulge_r, bulge_out, inboard = 14.75, 2.45, max(g[1] for g in guns) + 2.45, 10.2
            aft_end, fwd_end = min(xs) - 3.5, max(xs) + 3.9
            fwd_taper = [(fwd_end - 1.6, edge), (fwd_end, 14.75)]
            aft_taper = [(aft_end, 14.7), (aft_end + 1.6, edge)]
        outer = list(aft_taper)
        for gx, gy, gz, gid in sorted(guns):
            cy = bulge_out - bulge_r
            half = math.acos(max(-1, min(1, (edge - cy) / bulge_r)))
            outer += [(gx + bulge_r * math.sin(a), cy + bulge_r * math.cos(a))
                      for a in [-half + 2 * half * i / 10 for i in range(11)]]
        outer += fwd_taper
        outer = [p for i, p in enumerate(outer) if i == 0 or math.dist(p, outer[i - 1]) > .05]
        k = Kit(('fore' if fore else 'aft') + (' port' if port else ' starboard') + ' 5-inch sponson',
                COL['Hangar and galleries'], 'sponson-' + ('fore-' if fore else 'aft-') + ('port' if port else 'starboard'))
        # Gun deck slab.
        ring = [(x, sign * w) for x, w in outer] + [(outer[-1][0], sign * inboard), (outer[0][0], sign * inboard)]
        k.prism(ring, deck - .16, deck, 'steel-deck')
        # Sponson side: the hull flare carried up and out to the deck edge.
        low = []
        for x, w in outer:
            zb = interpolate(H['deckHeights'], x + H['length'] / 2) - .05
            low.append((x, sign * (loft_width(x, zb) - .05), zb))
        top = [(x, sign * w, deck - .3) for x, w in outer]
        lip = [(x, sign * w, deck - .16) for x, w in outer]
        n = len(outer)
        k.add(low + top + lip, [(i, i + 1, n + i + 1, n + i) for i in range(n - 1)] +
              [(n + i, n + i + 1, 2 * n + i + 1, 2 * n + i) for i in range(n - 1)], 'naval')
        # Closed box below the gun deck: plated inboard side and end bulkheads down to the deck below.
        x0, x1 = outer[0][0], outer[-1][0]
        xs_in = [x0 + (x1 - x0) * j / 12 for j in range(13)]
        zin = [interpolate(H['deckHeights'], x + H['length'] / 2) - .02 for x in xs_in]
        k.add([(x, sign * inboard, z) for x, z in zip(xs_in, zin)] + [(x, sign * inboard, deck - .16) for x in xs_in],
              [(j, j + 1, 14 + j, 13 + j) for j in range(12)], 'naval')
        for i, j in [(0, 0), (n - 1, 12)]:
            k.add([(outer[i][0], sign * inboard, zin[j]), low[i], lip[i], (outer[i][0], sign * inboard, deck - .16)], [(0, 1, 2, 3)], 'naval')
        # Vertical stiffeners on the inboard plating.
        for x in xs_in[1:-1:2]:
            zb = interpolate(H['deckHeights'], x + H['length'] / 2)
            k.box((x, sign * (inboard - .05), (zb + deck) / 2), (.12, .1, deck - zb - .2), 0, 'naval')
        # Splinter bulwark round the outboard edge, with stiffening brackets.
        path = [(x, sign * w) for x, w in outer]
        if not port: path = list(reversed(path))
        k.wall(path, deck, .92, .04, 'naval')
        for i in range(0, n, 3):
            x, w = outer[i]
            k.box((x, sign * (w - .12), deck + .35), (.05, .22, .7), 0, 'naval')
        # Inboard guard rail (the flight deck overhead leaves this side open) and ladders down.
        # (forward of the hangar front only; aft of it the gallery wall closes the side)
        r0 = outer[0][0] + .3; r1 = outer[-1][0] - .3
        if fore: r0 = max(r0, 75.9)
        k.rail([(r0, sign * (inboard + .08)), (r1, sign * (inboard + .08))], deck, .85, 1.6)
        lx = (outer[0][0] + outer[-1][0]) / 2
        zb = interpolate(H['deckHeights'], lx + H['length'] / 2)
        k.ladder((lx - 1.6, sign * (inboard - .45), zb), (lx, sign * (inboard - .45), deck), .6)
        # Gun-crew fittings: ready-service lockers against the bulwark, hose rack, telephone boxes.
        # (at the deck ends, outside the mounts' swept circles)
        for xe in [outer[0][0] + 1.4, outer[-1][0] - 1.6]:
            locker(k, xe, sign * (inboard + .5), deck, (1.2, .55, .75), 0)
        ready_box(k, outer[0][0] + 3.0, sign * (inboard + .5), deck, 0)
        for gx, gy, gz, gid in guns:
            zb = interpolate(H['deckHeights'], gx + H['length'] / 2)
            zc = (zb + deck) / 2 - .2
            t = (zc - zb) / (deck - .3 - zb)
            w = loft_width(gx, zb - .05) + (edge - (loft_width(gx, zb - .05))) * t
            carley(k, gx, sign * (w + .35), zc, 2.6, 1.15, 0, None)
            for dx in [-.7, .7]:
                k.box((gx + dx, sign * (w + .12), zc - .62), (.08, .5, .08), 0, 'naval')
        k.emit()

build_sponsons()
