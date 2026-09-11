"""Fit provisional fixed armor to the authored hull without changing plate IDs.

Run after hull station edits. Thicknesses and longitudinal/vertical extents
remain game assumptions; this only keeps their geometry seated in the hull.
"""
import bisect
import json
from pathlib import Path

path = Path(__file__).resolve().parent.parent / 'blueprint.json'
definition = json.loads(path.read_text())
hull = definition['hull']
sections = hull['sections']


def breadth(height, longitudinal):
    station = hull['length'] / 2 - longitudinal
    i = max(1, min(len(sections)-1,
                   bisect.bisect_left([s['station'] for s in sections], station)))
    a, b = sections[i-1:i+1]
    t = (station-a['station']) / (b['station']-a['station'])
    points = [[u+(v-u)*t for u, v in zip(p, q)]
              for p, q in zip(a['points'], b['points'])]
    for (w0, y0), (w1, y1) in zip(points, points[1:]):
        if y0 <= height <= y1 and y1 > y0:
            return w0+(w1-w0)*(height-y0)/(y1-y0)
    raise ValueError(f'Armor vertex lies outside the vertical hull: {height}, {longitudinal}')


for armor in definition['armor']:
    if not armor['id'].startswith(('belt-', 'deck-')):
        continue
    vertices = armor['plate']['vertices']
    for vertex in vertices:
        x, y, z = vertex
        width = max(0, breadth(y, z)-.01)
        if armor['id'].startswith('deck-'):
            width = min(9, width)
        vertex[0] = round(width if x > 0 else -width, 6)
    armor['center'] = [(min(p[i] for p in vertices)+max(p[i] for p in vertices))/2
                       for i in range(3)]
    armor['size'] = [max(.001, max(p[i] for p in vertices)-min(p[i] for p in vertices))
                     for i in range(3)]

path.write_text(json.dumps(definition, indent=2)+'\n')
print('Fitted provisional belt and deck vertices to current hull sections')
