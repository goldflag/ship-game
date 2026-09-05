"""Temporarily pause other local game previews while measuring one WebGPU scene."""
import json
import subprocess
import sys

action = sys.argv[1]
for page in sys.argv[2:]:
    expression = '''(async()=>{
if('ACTION'==='resume'){window.__harborPerformanceRestore?.();return 'restored';}
window.__harborPerformanceRestore?.();
const root=document.getElementById('root'),key=root && Object.keys(root).find(k=>k.startsWith('__reactContainer'));
const seen=new Set();let game;
function walk(f){if(!f||seen.has(f)||game)return;seen.add(f);for(let h=f.memoizedState;h;h=h.next){const v=h.memoizedState?.current;if(v?.simulation&&v?.renderer)game=v;}walk(f.child);walk(f.sibling);}
if(key)walk(root[key]?.stateNode?.current||root[key]);
if(!game)return 'no game';
const schedule=game.scheduleFrame;game.scheduleFrame=()=>{};cancelAnimationFrame(game.raf);
await game.frameTask;
let timer;
window.__harborPerformanceRestore=()=>{clearTimeout(timer);game.scheduleFrame=schedule;game.lastTime=performance.now();if(!game.disposed)schedule.call(game);delete window.__harborPerformanceRestore;};
timer=setTimeout(window.__harborPerformanceRestore,180000);
return 'paused for benchmark (automatic recovery in 3 minutes)';
})()'''.replace('ACTION',action)
    result=json.loads(subprocess.check_output(['orca','eval','--page',page,'--expression',expression,'--json'],timeout=25))
    print(page,result.get('result',{}).get('result',result),flush=True)
