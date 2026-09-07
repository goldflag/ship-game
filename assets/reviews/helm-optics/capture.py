"""Capture the real development review page in the active Orca browser tab."""
import base64
import json
import subprocess
from pathlib import Path

OUT = Path(__file__).parent

def cli(*args):
    response = subprocess.run(['orca', *args, '--json'], text=True, capture_output=True)
    result = json.loads(response.stdout)
    if not result.get('ok'):
        raise RuntimeError(result)
    return result['result']

def evaluate(expression):
    result = cli('eval', '--expression', expression)
    return json.loads(result['result']) if 'result' in result else result

records = {}
for name, options in [
    ('torpedo-sectors', {'range':3000,'elevation':.55,'distance':160}),
    ('overhead', {'range':3000,'elevation':1.555,'distance':100}),
    ('periscope-5km', {'depth':7,'range':5000,'scope':True}),
    ('visibility-20km', {'depth':7,'range':20000,'scope':True}),
    ('impact', {'depth':0,'range':1500,'scope':True,'hit':True}),
    ('compact-helm', {'range':3000,'width':600,'height':900,'elevation':.5,'distance':160}),
]:
    width, height = options.get('width',1600), options.get('height',900)
    cli('exec','--command',f'set viewport {width} {height}')
    records[name] = evaluate(f'(async()=>{{reviewGame.water.deterministic=true;return await reviewView({json.dumps(options)})}})()')
    cli('snapshot')
    image = cli('screenshot')
    (OUT / f'{name}.png').write_bytes(base64.b64decode(image['data']))
(OUT / 'checks.json').write_text(json.dumps(records, indent=2)+'\n')
print(json.dumps({key:{'position':value['camera']['position'],'events':value.get('events'),'error':value.get('error')} for key,value in records.items()},indent=2))
