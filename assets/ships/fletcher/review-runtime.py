"""Review the actual Fletcher GLB in an already-open Orca diagnostic game tab.
Read the installed orca-cli skill/guide first. Run: python3 <this-file> <page-id>.
The diagnostic fixture uses the production Game, renderer, CPU combat and HUD.
"""
from pathlib import Path
import sys,subprocess,json,base64
page=sys.argv[1];root=Path(__file__).resolve().parents[3]
out=Path(__file__).resolve().parent/'reports/runtime-review'
expected=json.loads((root/'public/models/fletcher.json').read_text())['contentHash']
def call(op,expression=None):
    args=['orca',op,'--page',page,'--json']
    if expression:args += ['--expression',expression]
    p=subprocess.run(args,capture_output=True,text=True,timeout=55)
    if p.returncode:raise RuntimeError(p.stdout[:1500]+p.stderr[:500])
    result=json.loads(p.stdout)
    if not result.get('ok'):raise RuntimeError(result)
    r=result['result'].get('result',result['result'])
    if isinstance(r,str):
        try:r=json.loads(r)
        except ValueError:pass
    return r

def save(name,value): (out/(name+'.json')).write_text(json.dumps(value,indent=2)+'\n')
def ev(code):return call('eval','(async()=>{const g=window.reviewGame;'+code+';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return g.diagnostics()})()')
def shot(name): (out/(name+'.png')).write_bytes(base64.b64decode(call('screenshot')['data']))
def camera(x,y,z,tx,ty,tz):ev(f'const p=g.simulation.ship;g.camera.position.set(p.x+({x}),p.y+({y}),p.z+({z}));g.camera.lookAt(p.x+({tx}),p.y+({ty}),p.z+({tz}));g.camera.updateMatrixWorld()')
def pose(t,e,r):ev('g.previewArticulation('+json.dumps(dict(trainFraction=t,elevationFraction=e,recoilFraction=r))+')')
initial=call('eval','window.reviewGame.diagnostics()');assert initial['contentHash']==expected
# Reuse the 18 poses just checked for this exact build; fail on any stale record.
a=json.loads((out/'orca-components.json').read_text()) if (out/'orca-components.json').exists() else {}
if a.get('contentHash')!=expected:
    rows=call('eval',"(async()=>{const g=window.reviewGame,rows=[];for(const trainFraction of [-1,0,1])for(const elevationFraction of [0,.5,1])for(const recoilFraction of [0,1]){const pose={trainFraction,elevationFraction,recoilFraction};g.previewArticulation(pose);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));rows.push({pose,diagnostics:g.diagnostics()})}g.previewArticulation(null);return rows})()")
    a={'contentHash':expected,'browser':'Orca embedded browser','rows':rows};save('orca-components',a)
assert len(a['rows'])==18
for row in a['rows']:
    d=row['diagnostics'];assert d['contentHash']==expected and d['maxMuzzleErrorM']<.001 and d['maxTorpedoMuzzleErrorM']<.001
save('articulation',{**a,'headless':False,'backend':initial['backend']})
ev('g.setInPort(true);g.setPaused(true);document.querySelector("#hud").style.display="none"')
camera(9,11,-48,0,7.4,-39)
for label,t,e,r in [('neutral',0,.15,0),('low-recoil',0,0,1),('high-recoil',0,1,1)]:
    pose(t,e,r);shot('turret-game-'+label)
    save('turret-game-'+label,call('eval','window.reviewGame.diagnostics()'))
print('Turret closeups captured',flush=True)
camera(40,25,-45,0,7.5,-17)
for label,t,e in [('port-low',-1,0),('starboard-high',1,1)]:pose(t,e,1);shot('articulation-close-'+label)
ev('g.previewArticulation(null)');camera(90,42,-38,0,6,0);shot('exterior-quarter')
camera(26,20,-43,0,7.5,-17);shot('bridge-closeup')
camera(31,19,44,0,4,33);shot('afterdeck-closeup')
# Inspection-only isolation exposes the submerged appendages in the actual Game.
# Store/restore every visibility flag; no production camera or mesh is modified.
ev('window.componentVisibility=[];for(const o of g.scene.children){window.componentVisibility.push([o,o.visible]);o.visible=o===g.playerView.root||o.isLight===true;}g.playerView.root.traverse(o=>{if(o.isMesh){window.componentVisibility.push([o,o.visible]);o.visible=/^(propeller-|shafts|rudder)/.test(o.userData.assemblyId??"");}})')
camera(10,.2,63,0,-2.7,50.75);shot('propellers-game-quarter')
camera(0,.2,65,0,-2.7,50.75);shot('propellers-game-stern')
rotated=call('eval','''(()=>{const g=window.reviewGame;const nodes=[];g.playerView.root.traverse(o=>{if((o.userData.nodeId??'').startsWith('propeller-'))nodes.push(o)});window.propellerRestore=nodes.map(o=>[o,o.quaternion.clone()]);return nodes.map((o,i)=>{const before=o.getWorldPosition(o.position.clone()),axisBefore=o.position.clone().set(0,0,1).applyQuaternion(o.getWorldQuaternion(o.quaternion.clone()));o.rotateZ((i===0?1:-1)*Math.PI/3);o.updateWorldMatrix(true,true);const after=o.getWorldPosition(o.position.clone());return {id:o.userData.nodeId,originErrorM:before.distanceTo(after),axisError:axisBefore.distanceTo(o.position.clone().set(0,0,1).applyQuaternion(o.getWorldQuaternion(o.quaternion.clone()))),position:after.toArray(),quaternion:o.quaternion.toArray()}})})()''')
assert len(rotated)==2 and all(x['originErrorM']<1e-5 and x['axisError']<1e-5 for x in rotated)
ev('');shot('propellers-game-rotated');save('propeller-pivots',{'contentHash':expected,'inspectionOnly':True,'note':'Actual loaded GLB isolated from sea/hull. Opposite 60-degree manual pivot poses; sailing animation remains static.','nodes':rotated})
ev('for(const [o,q] of window.propellerRestore)o.quaternion.copy(q);for(const [o,v] of window.componentVisibility)o.visible=v')
print('Both propellers inspected; independent pivot origins stable',flush=True)
# Deterministic original weapons checks, with the original visibility restored.
ev('g.setInPort(false);document.querySelector("#hud").style.display="";window.fletcherReview.setup("torpedo")')
call('eval','window.fletcherReview.advance(7,false)')
save('torpedo-launch',call('eval','window.fletcherReview.advance(6,true)'));ev('');shot('torpedo-launch')
torp=call('eval','window.fletcherReview.advance(32,false)');save('torpedo-result',torp)
launches=sum(x['kind']=='torpedo-launch' for x in torp['reviewEvents']);hits=sum(x['kind']=='torpedo-hit' for x in torp['reviewEvents']);assert launches==10 and hits>0
call('eval','window.fletcherReview.setup("depth-charge")')
save('depth-charge-launch',call('eval','window.fletcherReview.advance(2.8,true)'));ev('');shot('depth-charge-launch')
save('depth-charge-blast',call('eval','window.fletcherReview.advance(4.6,false)'));ev('');shot('depth-charge-blast')
charge=call('eval','window.fletcherReview.advance(5,false)');save('depth-charge-result',charge)
charges=sum(x['kind']=='depth-charge-launch' for x in charge['reviewEvents']);blasts=sum(x['kind']=='depth-charge-blast' for x in charge['reviewEvents']);assert charges==8 and blasts==8
reset=call('eval','window.fletcherReview.setup("main")');save('reset',reset);assert not reset['torpedoes'] and not reset['depthCharges']
save('summary',dict(contentHash=expected,browser='Orca embedded browser',backend=initial['backend'],poses=18,maxMuzzleErrorM=max(r['diagnostics']['maxMuzzleErrorM'] for r in a['rows']),maxTorpedoMuzzleErrorM=max(r['diagnostics']['maxTorpedoMuzzleErrorM'] for r in a['rows']),torpedoLaunches=launches,torpedoHits=hits,depthChargeLaunches=charges,depthChargeBlasts=blasts,propellerPivots=2,propellerInspection='Sea and hull hidden temporarily; original scene restored',pageErrors=call('eval','window.reviewError?[window.reviewError]:[]')))
print(f'Runtime passed: 18 poses; {launches} torpedoes/{hits} hits; {charges} charges/{blasts} blasts',flush=True)
