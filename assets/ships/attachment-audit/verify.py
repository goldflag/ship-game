"""Verify retained attachment evidence against the exact published fleet.

Run after builds, contact scans, fixed views and runtime captures are complete.
Visual inspection and historical interpretation are still separate obligations.
"""
import hashlib
import json
from pathlib import Path
import struct
import subprocess

audit = Path(__file__).resolve().parent
repo = audit.parents[2]
ships = ['bismarck', 'yamato', 'baltimore', 'enterprise-cv6', 'type-viic',
         'liberty-cargo', 'liberty-collier', 'victory-cargo', 'flower-corvette', 'fletcher']

def read(path):
    return json.loads(path.read_text())

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def node_ids(data):
    length = struct.unpack_from('<I', data, 12)[0]
    gltf = json.loads(data[20:20+length])
    return {node['extras']['nodeId'] for node in gltf['nodes'] if node.get('extras', {}).get('nodeId')}

records = []
for ship in ships:
    source = repo/'assets/ships'/ship
    model = repo/'public/models'/f'{ship}.glb'
    definition = read(model.with_suffix('.json'))
    content_hash = definition['contentHash']
    contact = read(audit/'reports/after'/f'{ship}-contact.json')
    fixed = read(source/'generated/review/cameras.json')
    runtime = read(audit/'runtime'/f'{ship}-articulation.json')
    assert all(record['contentHash'] == content_hash for record in [contact, fixed, runtime]), ship+' stale evidence'
    assert contact['sourceSha256'] == sha(source/'generated/source.blend'), ship+' changed original model'
    if ship == 'yamato':
        allowed = {'Bower anchor chain forged link', 'Operations room scuttle', 'Conning tower vision slit'}
        assert all(obj['name'].split('.')[0] in allowed for island in contact['islands'] for obj in island['objects'])
    else:
        assert not contact['islands'], ship+' detached candidate requires review'
    assert len(runtime['poses']) == 12, ship+' incomplete articulation sweep'
    assert max(pose['maxMuzzleErrorM'] for pose in runtime['poses']) <= .025
    initial = subprocess.check_output(['git', 'show', f'b020bbf:public/models/{ship}.glb'], cwd=repo)
    old_ids, current_ids = node_ids(initial), node_ids(model.read_bytes())
    assert old_ids <= current_ids, (ship, old_ids-current_ids)
    images = {}
    for view in ['profile', 'plan', 'bow', 'stern', 'quarter']:
        image = source/'generated/review'/f'{view}.png'
        images[str(image.relative_to(repo))] = sha(image)
    details = sorted((audit/'runtime').glob(ship+'-*.json'))
    for path in details:
        if path.name.endswith('-articulation.json'):
            continue
        assert read(path)['contentHash'] == content_hash, str(path)+' stale close-up'
        images[str(path.with_suffix('.png').relative_to(repo))] = sha(path.with_suffix('.png'))
    assert len(images) > 5, ship+' no runtime close-up'
    records.append({'ship': ship, 'contentHash': content_hash, 'modelSha256': sha(model),
                    'sourceSha256': contact['sourceSha256'], 'retainedNodeIds': sorted(old_ids),
                    'contactIslands': len(contact['islands']), 'runtimePoses': len(runtime['poses']),
                    'maxMuzzleErrorM': max(pose['maxMuzzleErrorM'] for pose in runtime['poses']),
                    'reviewImages': images})
assert not subprocess.check_output(['git', 'diff', '--name-only', 'b020bbf', '--', 'assets/ships/bismarck/baseline'], cwd=repo)
components = read(audit/'reports/open-mounts.json')
catalog = read(repo/'assets/parts/guns.json')
open_parts = {part['id'] for part in catalog['parts'] if part.get('mountingStyle', 'enclosed') != 'enclosed'}
assert {record['part'] for record in components} == open_parts
assert all(sum(record['part'] == part for record in components) == 6 for part in open_parts)
assert all(not record['detached'] for record in components)
report = {'schemaVersion': 1, 'baselineRevision': 'b020bbf', 'ships': records,
          'openComponentPoses': len(components), 'historicalAccuracy': 'Not certified; see dated source and discrepancy registers.'}
(audit/'reports/verification.json').write_text(json.dumps(report, indent=2)+'\n')
print(f'Verified {len(records)} ships, 50 fixed views, 120 runtime poses, and {len(components)} open-component poses.')
