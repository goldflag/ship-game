"""Record the development sea-trial fixture through the public Orca browser CLI.

Usage: python3 review-browser.py PAGE_ID batteries|articulation|closeup|inspection
Open sea-trial.html in that page first. Each action waits for completion; the
canvas is captured immediately after the production renderer presents a frame.
"""
import base64
import json
from pathlib import Path
import subprocess
import sys

page, action = sys.argv[1:3]
out = Path(__file__).resolve().parent

def evaluate(expression):
    result = subprocess.run(['orca', 'eval', '--page', page, '--expression', expression, '--json'], capture_output=True, text=True, timeout=55)
    data = json.loads(result.stdout)
    if not data.get('ok'):
        raise RuntimeError(data)
    value = data['result']['result']
    try:
        return json.loads(value) if isinstance(value, str) else value
    except json.JSONDecodeError:
        return value

def save(name, value):
    (out / (name + '.json')).write_text(json.dumps(value, indent=2) + '\n')

def capture(name):
    value = evaluate('(async()=>{const t=window.kingGeorgeTrial;await t.still();await t.game.pipeline.render();return {hash:t.report.contentHash,image:t.game.renderer.domElement.toDataURL("image/png")};})()')
    (out / (name + '.png')).write_bytes(base64.b64decode(value['image'].split(',', 1)[1]))
    print('Captured', name, value['hash'], flush=True)

def closeup():
    evaluate('(()=>{const g=window.kingGeorgeTrial.game,p=g.simulation.player.motion;g.camera.position.set(p.x+55,p.y+24,p.z-83);g.camera.lookAt(p.x,p.y+10,p.z-45);g.camera.updateMatrixWorld();})()')
    capture('turrets-in-game')
    evaluate('window.kingGeorgeTrial.game.previewArticulation({trainFraction:0,elevationFraction:1,recoilFraction:1})')
    capture('turrets-elevated-in-game')
    evaluate('window.kingGeorgeTrial.game.previewArticulation(null)')

ready = evaluate('Boolean(window.kingGeorgeTrial)')
if not ready:
    raise RuntimeError('Wait for the controlled sea-trial ready status before running this recorder.')

if action == 'batteries':
    for battery, ammunition in [('main', 'ap'), ('secondary', 'ap'), ('secondary', 'he')]:
        value = evaluate(f'window.kingGeorgeTrial.battery({json.dumps(battery)},{json.dumps(ammunition)})')
        print(value, flush=True)
        save(battery + '-' + ammunition + '-trial', value)
        save('sea-trial', evaluate('window.kingGeorgeTrial.report'))
        capture('sea-trial-' + battery + '-' + ammunition)
    save('damage-trial', evaluate('window.kingGeorgeTrial.damage()'))
    capture('sea-trial-damage')
    save('reset-trial', evaluate('window.kingGeorgeTrial.reset()'))
    save('sea-trial', evaluate('window.kingGeorgeTrial.report'))

elif action == 'articulation':
    evaluate('window.kingGeorgeTrial.reset()')
    poses = [('elevation', 0, 1, 1), ('starboard', 1, 1, 1), ('port', -1, 0, 0), ('restored', None, 0, 0)]
    for name, train, elevation, recoil in poses:
        pose = None if train is None else dict(trainFraction=train, elevationFraction=elevation, recoilFraction=recoil)
        evaluate('window.kingGeorgeTrial.game.previewArticulation(' + json.dumps(pose) + ')')
        value = evaluate('(async()=>{const t=window.kingGeorgeTrial;await t.still();return t.game.diagnostics();})()')
        if not value['inPort'] or value['maxMuzzleErrorM'] > .025:
            raise RuntimeError('Unexpected articulation diagnostic: ' + str(value))
        save('articulation-' + name, value)
        capture('articulation-' + name)
        print(name, value['maxMuzzleErrorM'], flush=True)
    capture('in-game-refined')
    closeup()

elif action == 'closeup':
    closeup()

elif action == 'inspection':
    evaluate('window.kingGeorgeTrial.reset()')
    for mode in ['armor', 'internals']:
        evaluate('window.kingGeorgeTrial.game.playerView.setInspection(' + json.dumps(mode) + ')')
        capture('in-game-' + mode)
    evaluate('window.kingGeorgeTrial.game.playerView.setInspection("internals","module:boiler-1-1")')
    capture('in-game-isolation')
    evaluate('window.kingGeorgeTrial.game.playerView.setInspection("exterior")')
else:
    raise RuntimeError('Unknown review action: ' + action)
