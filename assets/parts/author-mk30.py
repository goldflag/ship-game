"""Original Mk 30 enclosure controls; regenerate its versioned catalog facets.

OP 1112 (2nd rev.), p.288 supplies the single base-ring mount arrangement.
The rounded shoulders, sloping roof and gun-port recess are hand authored after
inspection of that plate and GameModels3D rasters. No source meshes are read.
These are approximate exterior dimensions, not an exact Mod 0 manufacturing plan.
"""
from pathlib import Path
import json

catalog = Path(__file__).with_name('guns.json')
data = json.loads(catalog.read_text())
part = next(p for p in data['parts'] if p['id'] == 'us-5in38-mk30-single')
part.pop('gunhouseShape', None)
part.update(gunhouseSize=[4.18, 2.96, 3.20], gunhouseBaseHeight=.48,
            pivotHeight=2.16, trunnionForward=.102, muzzleForward=4.56,
            barrelBaseRadius=.19, rollerRadius=1.40, barbetteRadius=1.30)
# CCW profiles in the forward/up plane. The paired stations at the port edges
# leave a real recess for the elevating shield and barrel, including full recoil.
profile = [(-2.76,.48),(1.30,.48),(1.30,1.68),(.58,2.84),
           (-1.65,3.20),(-2.76,3.20),(-2.88,3.05)]
shoulder = [(-2.60,.48),(1.12,.48),(1.12,1.63),(.43,2.60),
            (-1.65,2.96),(-2.60,2.96),(-2.72,2.85)]
recess = [profile[0],profile[1],(1.27,1.52),(-.40,1.52),
          (-.40,3.00),profile[5],profile[6]]
stations = [(-1.48,shoulder),(-1.34,profile),(-.40,profile),(-.40,recess),
            (.40,recess),(.40,profile),(1.34,profile),(1.48,shoulder)]
vertices, faces, lookup, rings = [], [], {}, []
for y, section in stations:
    ring = []
    for x,z in section:
        v = (x,y,z)
        if v not in lookup: lookup[v] = len(vertices); vertices.append(list(v))
        ring.append(lookup[v])
    rings.append(ring)
def triangle(ids, finish='naval'):
    if len(set(ids)) < 3: return
    faces.append(dict(id='shell-'+str(len(faces)+1).zfill(3),indices=ids,
                      thicknessMm=part['armorMm'],material='steel',finish=finish))
for i in range(1,len(profile)-1):
    triangle([rings[0][0],rings[0][i],rings[0][i+1]])
    triangle([rings[-1][0],rings[-1][i+1],rings[-1][i]])
for a,b in zip(rings,rings[1:]):
    for i in range(len(profile)):
        j=(i+1)%len(profile); finish='roof' if i in (3,4) else 'naval'
        triangle([a[i],b[i],b[j]],finish); triangle([a[i],b[j],a[j]],finish)
part['gunhouseMesh'] = dict(version=1,vertices=vertices,faces=faces,
    provenance=dict(sourceId='op1112-mk30-mod18',basis='estimated',
        note='Original enclosure facets interpreted from OP 1112 p.288 and raster comparisons; Mod 18 plate used for general form. Mod 0 detail, exact dimensions and existing gameplay armor thickness remain approximate.'))
assert len(vertices)<=128 and len(faces)<=128
catalog.write_text(json.dumps(data,indent=2)+'\n')
print(f'Mk 30: {len(vertices)} original vertices, {len(faces)} shared visual/armor facets')
