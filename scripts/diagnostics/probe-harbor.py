"""Measure completed Game frames at 1600×900; run start, then poll status.

Use the harbor diagnostic, or expose its Game as window.game in a built preview.
"""
import json
import subprocess
import sys
from pathlib import Path

page, action = sys.argv[1:3]
if action == 'start':
    expression = '''(()=>{
if(!window.game?.lastTime)throw new Error('Wait for the game to finish loading');
if(window.harborBenchmark && !window.harborBenchmark.done)throw new Error('Benchmark already running');
game.host.style.width='1600px';game.host.style.height='900px';
game.settings.resolution=1/Math.min(devicePixelRatio,1.5);game.resize();
game.rig.azimuth=1.08;game.rig.elevation=.23;game.rig.distance=325;
game.rig.update(game.simulation.ship,game.ship.position.y,0,true);
const frame=game.frame;let previous;
const result=window.harborBenchmark={warmup:60,samples:[],done:false,canvas:[game.renderer.domElement.width,game.renderer.domElement.height]};
game.frame=async(...args)=>{
  await frame.apply(game,args);
  const now=performance.now();
  if(result.warmup>0)result.warmup--;
  else if(previous!==undefined)result.samples.push(now-previous);
  previous=now;
  if(result.samples.length>=180){
    game.frame=frame;result.done=true;
    const sorted=[...result.samples].sort((a,b)=>a-b);
    result.meanMs=result.samples.reduce((a,b)=>a+b,0)/result.samples.length;
    result.medianMs=sorted[90];result.p95Ms=sorted[171];
  }
};
return JSON.stringify({started:true});
})()'''
else:
    expression = "JSON.stringify(window.harborBenchmark || {error:'Benchmark not started, or page reloaded'})"
result = subprocess.run(['orca','eval','--page',page,'--expression',expression,'--json'],capture_output=True,text=True)
payload=json.loads(result.stdout)
data=json.loads(payload['result']['result']) if payload.get('ok') else payload
if data.get('done'):
    Path('/tmp/harbor-frame-times.json').write_text(json.dumps(data,indent=2))
samples=data.pop('samples',None)
if samples is not None: data['frames']=len(samples)
print(json.dumps(data,indent=2))
