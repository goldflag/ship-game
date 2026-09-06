"""Capture coast detail and a survey view of all nine actual game landforms with Orca."""
import base64, json, pathlib, subprocess
root=pathlib.Path('assets/maps/review')
def evaluate(expression):
    expression='(async()=>{for(let i=0;i<250&&!window.ready;i++)await new Promise(r=>setTimeout(r,100));if(!window.ready)throw new Error("Map review did not initialize");return await ('+expression+');})()'
    process=subprocess.run(['orca','eval','--expression',expression,'--json'],capture_output=True,text=True)
    response=json.loads(process.stdout)
    if not response['ok']: raise RuntimeError(response)
    value=response['result']['result']
    try:return json.loads(value)
    except json.JSONDecodeError:return value
results=[]
for map_id in ['pacific-islands','arctic-passage','indian-volcanic-coast']:
    for index,overview in [(0,False),(0,True),(1,True),(2,True)]:
        capture=evaluate(f'(async()=>{{await window.reviewMap({json.dumps(map_id)});const result=await window.reviewLandform({index},{str(overview).lower()});return {{result,image:await window.captureMap()}};}})()')
        result=capture['result']
        if result['errors']:raise RuntimeError(result)
        image=capture['image']
        name=f'{map_id}-'+(f'survey-{index}' if overview else 'detail')+'.png'
        (root/name).write_bytes(base64.b64decode(image.split(',',1)[1]))
        results.append(dict(file=name,**result));print(result,flush=True)
(root/'landforms-render.json').write_text(json.dumps(results,indent=2)+'\n')
