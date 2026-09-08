"""Regenerate original Type C enclosure facets in the component catalog.

Hand-authored sections from the approved GameModels3D pjsd718 close views.
No external meshes are read. The catalog is the runtime/build source of truth.
"""
import json
from pathlib import Path
catalog=Path(__file__).resolve().parents[3]/'parts/guns.json'
data=json.loads(catalog.read_text());part=next(p for p in data['parts'] if p['id']=='type3-127-typec-twin')
# Repeated stations open only the upper face/roof for each independently moving gun.
# The uninterrupted lower apron and tapered rear distinguish this Type C enclosure.
stations=[(-2.34,False),(-2.20,False),(-1.98,False),(-.925,False),(-.925,True),(-.145,True),(-.145,False),(.145,False),(.145,True),(.925,True),(.925,False),(1.98,False),(2.20,False),(2.34,False)]
vertices=[];faces=[];lookup={};rings=[]
for y,recess in stations:
 ay=abs(y);rear=-3.50 if ay<1.5 else (-2.80 if ay<2.1 else (-1.86 if ay<2.3 else -.95))
 front=1.50 if ay<1.5 else (1.32 if ay<2.1 else (1.02 if ay<2.3 else .65))
 roof=2.37 if ay<1.1 else (2.14 if ay<2.1 else (2.06 if ay<2.3 else 2.01))
 section=[(rear,.30),(front,.30),(front-.14,1.02),(front-.32,roof-.12),(-.35,roof),(rear,2.15 if ay<2.1 else (2.06 if ay<2.3 else 2.01))]
 if ay>2.3:section[3]=section[4]
 if recess:section[3]=(-.42,1.02);section[4]=(-.42,roof)
 ring=[]
 for x,z in section:
  v=(x,y,z)
  if v not in lookup:lookup[v]=len(vertices);vertices.append(list(v))
  ring.append(lookup[v])
 rings.append(ring)
def tri(ids,finish='naval'):
 if len(set(ids))<3:return
 a,b,c=[vertices[i] for i in ids];u=[b[i]-a[i] for i in range(3)];v=[c[i]-a[i] for i in range(3)]
 cross=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
 if sum(x*x for x in cross)<1e-16:return
 faces.append(dict(id=f'shell-{len(faces)+1:03}',indices=ids,thicknessMm=12,material='steel',finish=finish))
for i in range(1,5):tri([rings[0][0],rings[0][i],rings[0][i+1]]);tri([rings[-1][0],rings[-1][i+1],rings[-1][i]])
for a,b in zip(rings,rings[1:]):
 for i in range(6):
  j=(i+1)%6;finish='roof' if i in [3,4] else 'naval'
  tri([a[i],b[i],b[j]],finish);tri([a[i],b[j],a[j]],finish)
part.update(gunhouseSize=[5,4.68,2.37],gunhouseBaseHeight=.30,pivotHeight=1.67,muzzleForward=5.14)
part['gunhouseMesh']=dict(version=1,vertices=vertices,faces=faces,provenance=dict(sourceId='gamemodels3d-pjsd718',basis='estimated',note='Original Type C sections: tapered rear, rounded shoulders, upper gun recesses and continuous lower apron. Interpreted from approved model close views; provisional 12 mm game protection.'))
assert len(vertices)<=128 and len(faces)<=128
catalog.write_text(json.dumps(data,indent=2)+'\n')
print(f'Type C: {len(vertices)} vertices, {len(faces)} facets')
