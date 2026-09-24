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

def build_funnel_detail():
    """Funnel casing faces after pasa518 (1942 fittings only): 24-inch signal searchlights on bracketed
    half-round platforms at the forward shoulders, horizontal strakes and vertical stiffeners, an exhaust
    pipe run, ladders, junction boxes and cable runs. The funnel spans recipe x -7.9..11.0 (bow +)."""
    k = Kit('Funnel casing fittings', COL['Island'], 'funnel-fittings')
    aft, fwd = -7.92, 10.97
    for nrm in [1, -1]:
        face = IY + nrm * FHW
        # Signal searchlight platforms at the forward shoulder (reference 600 mm lights).
        cx, top = 7.34, 28.1
        ring = arc(cx, face, .95, 0, math.pi, 10) if nrm > 0 else arc(cx, face, .95, math.pi, 2 * math.pi, 10)
        k.prism(ring, top - .1, top, 'roof')
        k.rail([p for p in ring], top, .95, .8)
        for dx in [-.55, .55]:
            k.add([(cx + dx, face, top - .1), (cx + dx, face + nrm * .9, top - .1), (cx + dx, face, top - 1.0),
                   (cx + dx + .04, face, top - .1), (cx + dx + .04, face + nrm * .9, top - .1), (cx + dx + .04, face, top - 1.0)],
                  [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], 'naval')
        k.rod((cx, face + nrm * .5, top), (cx, face + nrm * .5, top + .55), .07, 'naval', 8)
        k.rod((cx - .28, face + nrm * .5, top + .78), (cx + .3, face + nrm * .5, top + .78), .3, 'naval', 12)
        k.rod((cx + .3, face + nrm * .5, top + .78), (cx + .32, face + nrm * .5, top + .78), .26, 'glass', 12, caps=False)
        k.ladder_on(cx - 1.3, face, ROOF, top, (0, nrm), .42, .16)
        # Horizontal strakes and vertical stiffeners on the casing.
        for z in [27.0, 29.6]:
            k.box(((aft + 8.9) / 2 + .2, face + nrm * .04, z), (8.9 - aft - .4, .08, .1), 0, 'naval')
        for x in [-6.0, -3.0, 4.2, 8.2]:
            k.box((x, face + nrm * .035, (ROOF + 1.2 + STACK - .3) / 2), (.1, .07, STACK - .3 - ROOF - 1.2), 0, 'naval')
        # Exhaust pipe run up the after part of the face to a bent head above the cap.
        px = -6.9
        k.tube([(px, face + nrm * .2, FLAG + .3), (px, face + nrm * .2, STACK + .6), (px + .45, face + nrm * .2, STACK + 1.05)], .11, 'naval', 8)
        for z in [FLAG + 1.5, ROOF + .6, 28.4, 30.6]:
            k.box((px, face + nrm * .11, z), (.12, .2, .06), 0, 'edge')
        # Second ladder at the after end, junction boxes and a cable run.
        k.ladder_on(-7.35, face, ROOF, STACK, (0, nrm), .42, .16)
        for x, z in [(-1.2, 27.8), (2.6, 30.2), (5.8, 26.4), (-4.6, 30.8)]:
            k.box((x, face + nrm * .1, z), (.34, .2, .42), 0, 'naval')
        k.tube([(8.6, face + nrm * .06, ROOF + .2), (8.6, face + nrm * .06, 28.0), (6.9, face + nrm * .06, 28.0)], .03, 'edge', 4)
    # Cowl vents and small lockers on the funnel cap rim, inside the stack rail.
    for x in [-7.2, 9.8]:
        for sg in [-1, 1]:
            k.rod((x, IY + sg * 1.5, STACK), (x, IY + sg * 1.5, STACK + .7), .16, 'naval', 8)
            k.rod((x, IY + sg * 1.5, STACK + .7), (x + .35, IY + sg * 1.5, STACK + .95), .2, 'naval', 8)
    k.emit()


def build_island_extras():
    """Island faces after pasa518: an inclined ladder up the flight-deck face, vertical cable runs,
    mushroom vents on the tier roofs and a third row of scuttles on the flag-bridge tier aft."""
    k = Kit('Island extras', COL['Island'], 'island-extras')
    inner = IY + HW
    k.ladder((22.0, inner + .55, FLIGHT), (27.5, inner + .55, COMM), .6, .3)
    k.rod((22.0, inner + .9, FLIGHT), (27.5, inner + .9, COMM + 1.0), .025, 'edge', 4)
    for nrm in [1, -1]:
        face = IY + nrm * HW
        for x in [-13.8, -0.4, 13.4, 30.2]:
            k.tube([(x, face + nrm * .05, FLIGHT + .2), (x, face + nrm * .05, FLAG - .25)], .028, 'edge', 4)
    for sname in ['bridge-roof', 'pilot-roof']:
        st = S[sname]; z = st['baseY'] + st['height']
        for x, dy in [(-(st['footprint'][0][1]) - 1.5, 1.8), (-(st['footprint'][0][1]) - 4.5, -1.8)]:
            k.rod((x, IY + dy, z), (x, IY + dy, z + .5), .12, 'naval', 8)
            k.rod((x, IY + dy, z + .5), (x, IY + dy, z + .62), .26, 'naval', 10)
    for nrm in [1, -1]:
        face = IY + nrm * HW
        for x in [-12.0, -14.2]:
            z = FLAG + 1.2
            k.rod((x, face - nrm * .01, z), (x, face + nrm * .05, z), .19, 'edge', 8)
            k.rod((x, face + nrm * .05, z), (x, face + nrm * .06, z), .14, 'glass', 8, caps=False)
    k.emit()

build_funnel_detail()
build_island_extras()
