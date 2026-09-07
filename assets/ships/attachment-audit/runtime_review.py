"""Capture the dev port through an existing Orca browser page; no production hooks.

python3 assets/ships/attachment-audit/runtime_review.py PAGE_ID SHIP [SHIP ...]
The page must already have a loaded port from the dev server at localhost:5187.
"""
import base64
import json
from pathlib import Path
import subprocess
import sys
import time

root = Path(__file__).resolve().parent
page, *ships = sys.argv[1:]
views = {
    'bismarck': [('aa', [0, 0, 18], [24, 36, 18]), ('bridge', [20, 0, 23], [12, -33, 12])],
    'baltimore': [('battery', [22, 0, 11], [30, 34, 17]), ('stern', [-65, 0, 7], [-14, 28, 13])],
    'yamato': [('aa', [0, 0, 18], [22, 46, 22]), ('stern', [-105, 0, 8], [-15, 33, 12])],
    'liberty-cargo': [('midships', [0, 0, 9], [22, 38, 17])],
    'liberty-collier': [('machinery', [-40, 0, 10], [-23, 32, 17]), ('bow', [53, 0, 8], [15, 25, 12])],
    'victory-cargo': [('midships', [0, 0, 10], [25, 40, 19])],
    'flower-corvette': [('bridge', [4, 0, 6], [10, 17, 8]), ('stern', [-21, 0, 4], [-9, 15, 8])],
}

def orca(*args):
    for attempt in range(3):
        command = subprocess.run(['orca', *args, '--page', page, '--json'], capture_output=True, text=True)
        result = json.loads(command.stdout)
        if result.get('ok'):
            return result['result']
        # Orca can briefly lose the CDP page between commands. Refresh its
        # tab registry before retrying a read/wait; never repeat a UI click.
        if args[0] not in ('snapshot', 'wait', 'eval') or result.get('error', {}).get('code') not in ('browser_tab_not_found', 'browser_error'):
            break
        subprocess.run(['orca', 'tab', 'list', '--json'], capture_output=True)
        time.sleep(.5)
    raise RuntimeError(result)

def evaluate(expression):
    value = orca('eval', '--expression', expression)['result']
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value

for ship in ships:
    current = evaluate('window.shipTrialDiagnostics().shipId')
    if current != ship:
        snapshot = orca('snapshot')
        name = json.loads(root.parent.joinpath(ship, 'blueprint.json').read_text())['name']
        ref = next(key for key, value in snapshot['refs'].items() if value['name'] == 'Inspect '+name)
        orca('click', '--element', '@'+ref)
        # Port switching retains the initialized ocean and GPU device.
        orca('wait', '--fn', 'window.shipTrialDiagnostics?.().shipId === '+json.dumps(ship), '--timeout', '60000')
    ready = evaluate(root.joinpath('runtime-review.js').read_text())
    assert ready['shipId'] == ship, ready
    poses = evaluate('window.attachmentReview.poses()')
    root.joinpath('runtime', f'{ship}-articulation.json').write_text(json.dumps(poses, indent=2)+'\n')
    for name, target, offset in views[ship]:
        pose = {'trainFraction': 1, 'elevationFraction': 1, 'recoilFraction': 1}
        detail = evaluate('window.attachmentReview.detail('+','.join(map(json.dumps, [target, offset, pose]))+')')
        encoded = detail.pop('image').split(',', 1)[1]
        root.joinpath('runtime', f'{ship}-{name}.png').write_bytes(base64.b64decode(encoded))
        root.joinpath('runtime', f'{ship}-{name}.json').write_text(json.dumps(detail, indent=2)+'\n')
    print(json.dumps({'ship': ship, 'contentHash': ready['contentHash'], 'poses': len(poses['poses']), 'maxMuzzleErrorM': max(p['maxMuzzleErrorM'] for p in poses['poses'])}), flush=True)
