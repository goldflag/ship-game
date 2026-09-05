"""Check the real Yamato hull for diagonal shadow bands through Orca's browser.

Open /scripts/diagnostics/harbor.html?ship=yamato&quality=medium on the dev
server, then run: python3 scripts/tests/hull-shadows.py <browser-page-id>
Requires Pillow. High and Ultra can use the same view and check.
"""
import base64
import json
import math
import os
from pathlib import Path
import subprocess
import sys

from PIL import Image

orca = os.environ.get('ORCA_CLI_COMMAND') or ('orca-dev' if os.environ.get('ORCA_DEV_REPO_ROOT') else 'orca')
expression = """(async()=>{
  const deadline=performance.now()+40000;
  while(!window.ready && !window.errors?.length && performance.now()<deadline)
    await new Promise(resolve=>setTimeout(resolve,200));
  if(!window.ready || window.errors.length) throw new Error(JSON.stringify(window.errors));
  if(game.definition.id!=='yamato' || !game.inPort) throw new Error('Open the Yamato harbor diagnostic');
  const light=game.water.lighting.sunLight;
  if(!light.castShadow || !game.renderer.shadowMap.enabled) throw new Error('Shadows must remain enabled');
  game.host.style.width='1200px'; game.host.style.height='720px';
  game.settings.resolution=1/Math.min(devicePixelRatio,1.5); game.resize();
  const update=game.rig.update;
  try {
    game.rig.update=()=>{};
    game.camera.position.set(game.ship.position.x+35,8,6);
    game.camera.lookAt(game.ship.position.x,3,0); game.camera.updateMatrixWorld();
    await new Promise(resolve=>setTimeout(resolve,700));
    const png=await window.captureHarbor();
    return {png,quality:game.settings.quality,backend:game.water.backend,
      normalBias:light.shadow.normalBias,depthBias:light.shadow.bias,
      shadowMap:light.shadow.mapSize.toArray(),shipHash:game.definition.contentHash};
  } finally { game.rig.update=update; }
})()"""
result = json.loads(subprocess.check_output(
    [orca, 'eval', '--page', sys.argv[1], '--expression', expression, '--json'], timeout=55))
capture = result['result']['result']
if isinstance(capture, str):
    capture = json.loads(capture)
folder = Path(__file__).resolve().parents[2] / 'assets/reviews/hull-lighting'
folder.mkdir(parents=True, exist_ok=True)
path = folder / (capture['quality'] + '-after.png')
path.write_bytes(base64.b64decode(capture.pop('png').split(',')[1]))

# Sample bare hull below the portholes and above the water. Remove the broad
# lighting gradient per row; periodic shadow bands remain in the residual.
image = Image.open(path).convert('RGB')
assert image.size == (1200, 720), image.size
residuals = []
for y in range(420, 461, 5):
    row = [sum(image.getpixel((x, y))) / 3 for x in range(180, 1100)]
    residuals.extend(row[x] - sum(row[x-45:x+46]) / 91 for x in range(45, len(row)-45))
capture['bandRms'] = math.sqrt(sum(value * value for value in residuals) / len(residuals))
capture['passed'] = capture['bandRms'] < 0.6
(folder / (capture['quality'] + '.json')).write_text(json.dumps(capture, indent=2) + '\n')
print(json.dumps(capture, indent=2))
assert capture['passed'], f"Hull shadow bands: RMS {capture['bandRms']:.3f} (limit 0.6)"
