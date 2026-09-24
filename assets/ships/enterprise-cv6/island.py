"""Island face detail, executed in build.py's scope after details.py and the island fittings.

Placed after the GameModels3D pasa518 island (lockers, hose racks, extinguishers, telephone
and switch boxes, scuttles, ladders, voice pipes, signal lamps and flag bags on the faces and
platforms), limited to fittings the June 1942 island carried; 1943-44 additions are omitted."""

def build_island_detail():
    k = Kit('Island face fittings', COL['Island'], 'island-fittings')
    inner, outer = IY + HW, IY - HW          # port (flight-deck) face and starboard face
    lo, hi = -15.2, 32.2                      # island base, Blender x (bow +)
    funnel = (-7.9, 10.9)
    for y0, nrm in [(inner, 1), (outer, -1)]:
        wy = y0 + nrm * .02
        # Watertight doors at flight-deck level.
        for x in ([24.5, 5.2, -12.5] if nrm > 0 else [16.5, -3.0]):
            fit.door('Island deck-level door', x, wy + nrm * .02, FLIGHT + .05, .72, 1.8)
        # Ready lockers, fire-fighting gear and switch boxes along the base.
        for x in ([29.2, 20.4, 12.2, 1.2, -6.4] if nrm > 0 else [27.0, 22.0, 9.8, 3.5, -8.0]):
            locker(k, x, y0 + nrm * .3, FLIGHT, (1.05, .5, .95), 0)
        for x in ([26.8, 8.3, -9.4] if nrm > 0 else [19.2, 1.0]):
            hose_rack(k, x, wy, FLIGHT + 1.35, (0, nrm))
            extinguisher(k, x + .9, wy, FLIGHT + .15, (0, nrm))
        for x in ([31.0, 17.6, 6.8, -1.0, -10.8] if nrm > 0 else [30.0, 13.2, -1.8, -12.0]):
            k.box((x, wy + nrm * .09, FLIGHT + 1.45), (.34, .16, .44), 0, 'naval')
            k.box((x, wy + nrm * .18, FLIGHT + 1.62), (.3, .03, .06), 0, 'edge')
        # Two rows of rimmed scuttles on the lower decks.
        for z in [FLIGHT + 1.15, COMM + 1.05]:
            for i in range(int((hi - lo) / 2.4)):
                x = lo + 1.2 + i * 2.4
                if funnel[0] - .5 < x < funnel[1] + .5 and z > COMM: continue
                if any(abs(x - d) < 1.0 for d in [24.5, 5.2, -12.5, 16.5, -3.0, 14.02, 28.65, -9.15]): continue
                if any(abs(x - v) < 1.0 for v in [7.92, 3.05, -3.05, -7.92]) and z > COMM: continue
                k.rod((x, wy - nrm * .01, z), (x, wy + nrm * .05, z), .19, 'edge', 8)
                k.rod((x, wy + nrm * .05, z), (x, wy + nrm * .06, z), .14, 'glass', 8, caps=False)
        # Vertical ladders from the flight deck to the communications platform.
        for x in ([18.8, -4.6] if nrm > 0 else [11.6, -6.6]):
            k.ladder_on(x, y0, FLIGHT, COMM + .05, (0, nrm), .42, .18)
        # Voice pipes and cable runs from the lower decks up to the bridge.
        for x in ([30.4, 29.9] if nrm > 0 else [31.0]):
            voice_pipe(k, [(x, wy + nrm * .12, FLIGHT + .3), (x, wy + nrm * .12, NAV + .9)])
        for dx in [0, .12]:
            voice_pipe(k, [(lo + 1.0 + dx, wy + nrm * .1, FLIGHT + .4), (lo + 1.0 + dx, wy + nrm * .1, FLAG + 1.8)])
    # Signal lamps at the navigation-wing ends and the flag walkway; flag bags aft of the wings.
    for s in ['navigation-wings', 'flag-walkway']:
        st = S[s]; pts = [(-z, -x) for x, z in st['footprint']]; z = st['baseY'] + st['height']
        xmax = max(p[0] for p in pts)
        for side in [min(p[1] for p in pts) + .45, max(p[1] for p in pts) - .45]:
            signal_lamp(k, xmax - 1.2, side, z, 0)
    st = S['navigation-wings']; pts = [(-z, -x) for x, z in st['footprint']]; z = st['baseY'] + st['height']
    xmin = min(p[0] for p in pts)
    for side in [min(p[1] for p in pts) + .55, max(p[1] for p in pts) - .55]:
        k.box((xmin + 1.6, side, z + .42), (2.2, .75, .84), 0, 'canvas')
        k.box((xmin + 1.6, side, z + .87), (2.3, .82, .06), 0, 'roof')
    # Funnel: service platforms' lockers and a whistle/siren pipe on the forward face.
    voice_pipe(k, [(funnel[1] + .12, IY + .6, FLAG + .2), (funnel[1] + .12, IY + .6, STACK + .9)])
    voice_pipe(k, [(funnel[1] + .12, IY - .6, FLAG + .2), (funnel[1] + .12, IY - .6, STACK + .7)])
    k.rod((funnel[1] + .12, IY + .6, STACK + .9), (funnel[1] + .12, IY + .6, STACK + 1.25), .09, 'bronze', 8)
    k.emit()

build_island_detail()
