"""Capture the actual WebGPU canvas in Orca's harbor diagnostic, without overlays."""
import base64
import json
from pathlib import Path
import subprocess
import sys

page = sys.argv[1]
folder = Path(__file__).resolve().parents[2] / 'docs/harbor'
folder.mkdir(exist_ok=True)
views = [
    ('harbor-desktop', 1600, 900, 1.08, .23, 325),
    ('harbor-north', 1600, 900, .12, .28, 540),
    ('harbor-south', 1600, 900, 2.6, .23, 520),
    ('harbor-overview', 1600, 1000, 1.08, .85, 1050),
    ('harbor-narrow', 430, 932, 1.08, .23, 325),
]
for name, width, height, angle, elevation, distance in views:
    if len(sys.argv)>2 and name not in sys.argv[2:]:
        continue
    script = f'''(async()=>{{const deadline=performance.now()+45000;
while(!window.ready && !window.errors?.length && performance.now()<deadline)await new Promise(resolve=>setTimeout(resolve,200));
if(!window.ready)throw new Error(JSON.stringify(window.errors || 'Harbor loading timed out'));
game.host.style.width='{width}px';game.host.style.height='{height}px';
game.settings.resolution=1/Math.min(devicePixelRatio,1.5);game.resize();
window.view({angle},{elevation},{distance});game.rig.update(game.simulation.ship,game.ship.position.y,0,true);
await new Promise(resolve=>setTimeout(resolve,700));
return await window.captureHarbor();}})()'''
    result = json.loads(subprocess.check_output(['orca','eval','--page',page,'--expression',script,'--json']))
    data = result.get('result',{}).get('result','')
    if data.startswith('"'):
        data=json.loads(data)
    if not data.startswith('data:image'):
        raise RuntimeError(str(result)[:1000])
    (folder / (name+'.png')).write_bytes(base64.b64decode(data.split(',')[1]))
    print(folder / (name+'.png'),flush=True)
