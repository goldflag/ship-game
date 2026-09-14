"""Write the original roof-platform faces as ordinary mounted armor plates."""
import json, math
from pathlib import Path
from turret_roof import panels, clearance_surface

path = Path(__file__).resolve().parent.parent / 'blueprint.json'
definition = json.loads(path.read_text())
definition['armor'] = [a for a in definition['armor']
                       if not a['id'].startswith(('main-2-aa-roof-', 'main-3-aa-roof-'))]
for mount in ('main-2', 'main-3'):
    for label, face in panels():
        vertices = [[-y, z, -x] for x, y, z in face]
        low = [min(p[i] for p in vertices) for i in range(3)]
        high = [max(p[i] for p in vertices) for i in range(3)]
        definition['armor'].append(dict(
            id=f'{mount}-aa-roof-{label}',
            name=f'{mount.replace("main-", "No. ")} turret AA platform · {label.replace("-", " ")}',
            center=[(a+b)/2 for a, b in zip(low, high)],
            size=[max(.001, b-a) for a, b in zip(low, high)],
            thicknessMm=8,
            plate=dict(vertices=vertices, material='steel', mountId=mount),
            provenance=dict(sourceId='gamemodels3d-kongo-1944', basis='estimated',
                            note='Original platform contour from approved turret views. 8 mm plating is provisional game calibration, not a historical thickness.')))
surface=clearance_surface()
for mount in definition['mounts']:
    if mount['id'] not in ('aa25-01','aa25-02','aa25-33','aa25-34'):
        continue
    parent=next(m for m in definition['mounts'] if m['id']==mount['parentMountId'])
    # First place the original platform in neutral hull coordinates, then
    # express it in the child's untrained frame. Both ride the same carrier.
    angle=math.radians(parent['bearingDeg']);c,s=math.cos(angle),math.sin(angle)
    child=math.radians(mount['bearingDeg']);cc,ss=math.cos(child),math.sin(child)
    points=[]
    for x,y,z in surface['vertices']:
        rx,rz=-y,-x
        world=(parent['position'][0]+c*rx-s*rz,parent['position'][1]+z,parent['position'][2]+s*rx+c*rz)
        dx,dy,dz=[world[i]-mount['position'][i] for i in range(3)]
        points.append([round(cc*dx+ss*dz,8),round(dy,8),round(-ss*dx+cc*dz,8)])
    # Bounds of the original low Type 96 recipe's tube, flash hider and gas
    # cylinder. These reserve the full recoil stroke, not a firing arc limit.
    mount['travelClearance']=dict(version=1,surface=dict(vertices=points,triangles=surface['triangles']),barrels=[
        dict(fromM=0,toM=1.28,heightM=0,radiusM=.043,recoils=True),
        dict(fromM=1.28,toM=1.383,heightM=0,radiusM=.049,recoils=True),
        dict(fromM=-.1,toM=.68,heightM=-.09,radiusM=.028,recoils=False)])
path.write_text(json.dumps(definition, indent=2)+'\n')
print('Synchronized carried AA platform decks and shields')
