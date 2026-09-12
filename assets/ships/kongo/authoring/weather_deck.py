"""Original weather-deck crown shared by rendering and fitted foundations."""

def interp(table, x):
    for (a, u), (b, v) in zip(table, table[1:]):
        if a <= x <= b:
            return u + (v-u)*(x-a)/(b-a)
    return table[0][1] if x < table[0][0] else table[-1][1]

def camber(x):
    return interp([(0,.10),(64,.10),(70,.285),(76,.33),(80,.22),
                   (86,.30),(94,.26),(101,.255),(109,.24),(109.5,0),(110.5,0)], x)

def height(hull, x, y=0):
    station = x + hull['length']/2
    edge = interp(hull['deckHeights'], station)
    width = interp([(s['station'],s['points'][-1][0]) for s in hull['sections']], station)
    return edge + .02 + (camber(x)-.02)*max(0, 1-abs(y)/max(width,.001))
