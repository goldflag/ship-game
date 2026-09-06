"""Capture the actual game in the current Orca tab on ocean-maps.html.
Run from the repository root after the diagnostic reports Ready.
"""
import base64
import json
import pathlib
import subprocess

root = pathlib.Path('assets/maps/review')
root.mkdir(parents=True, exist_ok=True)

def evaluate(expression):
    expression = '(async()=>{for(let i=0;i<250&&!window.ready;i++)await new Promise(r=>setTimeout(r,100));if(!window.ready)throw new Error("Map review did not initialize");return await ('+expression+');})()'
    process = subprocess.run(['orca', 'eval', '--expression', expression, '--json'], capture_output=True, text=True)
    response = json.loads(process.stdout)
    if not response['ok']:
        raise RuntimeError(response)
    value = response['result']['result']
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value

results = []
for map_id in ['north-atlantic', 'pacific-islands', 'arctic-passage', 'indian-volcanic-coast']:
    capture = evaluate(f'(async()=>{{const result=await window.reviewMap({json.dumps(map_id)});return {{result,image:await window.captureMap()}};}})()')
    result = capture['result']
    if result['errors']:
        raise RuntimeError(result)
    image = capture['image']
    path = root / (map_id + '.png')
    path.write_bytes(base64.b64decode(image.split(',', 1)[1]))
    subprocess.run(['cwebp', '-quiet', '-q', '86', '-resize', '640', '360', str(path), '-o', f'public/maps/{map_id}.webp'], check=True)
    results.append(result)
    print(result, flush=True)
(root / 'render.json').write_text(json.dumps(results, indent=2) + '\n')
