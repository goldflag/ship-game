"""Inspect published GLBs in the running Orca browser; retain actual canvas captures.
Open /aircraft-review.html in this worktree first. Requires public orca CLI.
"""
import base64, hashlib, json, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'assets/aircraft';OUT=BASE/'reports/browser';OUT.mkdir(parents=True,exist_ok=True)
CAT=json.loads((ROOT/'public/models/aircraft/catalog.json').read_text())
records=[]
for entry in CAT['aircraft']:
    code='''(async () => {
      const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const records = [];
      for (const lod of [0,1,2]) {
        await window.aircraftReview.select(AIRCRAFT_ID, lod);
        window.aircraftReview.pose(null); window.aircraftReview.view('quarter'); await frames();
        const rest = window.aircraftReviewDiagnostics();
        const png = document.querySelector('canvas').toDataURL();
        window.aircraftReview.pose({propellerAngle:.8,controlsAngle:.27,gearFraction:.65,diveBrakeAngle:.8});
        await frames();
        const posed = window.aircraftReviewDiagnostics();
        const posedPng = lod === 0 ? document.querySelector('canvas').toDataURL() : null;
        records.push({lod,rest,posed,png,posedPng});
      }
      return JSON.stringify(records);
    })()'''.replace('AIRCRAFT_ID',json.dumps(entry['id']))
    run=subprocess.run(['orca','eval','--expression',code,'--json'],capture_output=True,text=True,check=True)
    envelope=json.loads(run.stdout)
    if not envelope.get('ok'):raise RuntimeError(envelope)
    reply=envelope['result']['result']
    if isinstance(reply,str):reply=json.loads(reply)
    if isinstance(reply,str):reply=json.loads(reply)
    for item in reply:
        for name,diagnostic in [('rest',item['rest']),('posed',item['posed'])]:
            assert diagnostic['ready'] and not diagnostic['error'],diagnostic
            assert diagnostic['aircraftId']==entry['id'] and diagnostic['lod']==item['lod'],diagnostic
            assert diagnostic['contentHash']==CAT['contentHash'],'Browser loaded stale GLB'
        rest={j['id']:j for j in item['rest']['joints']}
        for joint in item['posed']['joints']:
            changed=max(abs(a-b) for a,b in zip(rest[joint['id']]['quaternion'],joint['quaternion']))>1e-5
            assert changed != joint['fixed'],f"Unexpected movement for {entry['id']}:{joint['id']}"
        for key,suffix in [('png','quarter'),('posedPng','articulated')]:
            data=item.pop(key)
            if data:
                path=OUT/f"{entry['id']}-lod{item['lod']}-{suffix}.png"
                path.write_bytes(base64.b64decode(data.split(',',1)[1]))
                item[suffix+'Capture']={'path':str(path.relative_to(BASE)),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
        records.append(item)
    print(entry['id']+': all 3 LODs rendered; articulation and source hash passed',flush=True)
(BASE/'reports/browser-articulation.json').write_text(json.dumps({'schemaVersion':2,'contentHash':CAT['contentHash'],'loads':len(records),'records':records},indent=2)+'\n')
