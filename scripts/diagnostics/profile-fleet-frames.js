export async function profileFleetFrames(game, { frames = 90, advanceTo = 3600 } = {}) {
  const g = game, records = {}, restores = [];
  const wrap = (object, key, name) => {
    if (!object || typeof object[key] !== 'function') return;
    const original = object[key];
    const row = records[name] = { ms: 0, calls: 0 };
    object[key] = function (...args) {
      const start = performance.now();
      const done = result => { row.ms += performance.now() - start; row.calls++; return result; };
      const value = original.apply(this, args);
      return value?.then ? value.then(done) : done(value);
    };
    restores.push(() => { object[key] = original; });
  };
  for (let i = g.simulation.tick; i < advanceTo; i++) g.simulation.step({throttle:.5,rudder:0}, {aim:[0,.5,-5000],fire:false,battery:'main'});
  g.fleetViews.forEach(v => v.snap());
  const p = g.simulation.player.motion;
  g.camera.position.set(p.x+190,p.y+100,p.z+230);g.camera.lookAt(p.x,p.y+5,p.z);g.camera.updateMatrixWorld();
  const r = g.renderer;
  wrap(g,'readSightAim','game.readSightAim');
  wrap(g.fleetViews[0].impactMarks.constructor.prototype,'update','marks.update');
  wrap(g.fleetViews[0].root.constructor.prototype,'updateMatrixWorld','ships.matrices');
  for (const key of ['_step','_renderPasses','update']) wrap(g.water,key,`water.${key}`);
  wrap(g.water.oceanSim,'update','waves.update');
  wrap(g.water.buoyancy,'update','buoyancy.update');
  for(const [i,s] of g.water._subsystems.entries()) for(const key of ['step','renderPass']) wrap(s,key,`subsystem.${i}.${s.constructor.name}.${key}`);
  for(const key of ['renderCapturePass','renderMaskPass','renderWaterDepthPass','renderSSRGBufferPass','renderSSRPass']) wrap(g.water.rendering,key,`capture.${key}`);
  for(const key of ['render','compute','computeAsync']) wrap(r,key,`renderer.${key}`);
  wrap(g.scene,'updateMatrixWorld','scene.matrices');
  for(const key of ['update','capturePreviousPose']) wrap(g.fleetViews[0].constructor.prototype,key,`ships.${key}`);
  for(const key of ['update']) for(const name of ['effects','aircraftView','fleetDraws','sky','shipLabels']) wrap(g[name],key,`${name}.${key}`);
  wrap(g.simulation,'advance','simulation.advance');
  wrap(g,'renderFrame','game.renderFrame');
  const times=[], gpuWait=[];
  g.paused=false;
  try {
    for(let i=0;i<frames+20;i++) {
      const start=performance.now();r._nodes.nodeFrame.update();r.info.frame=r._nodes.nodeFrame.frameId;
      g.lastTime=start-1000/60;await g.frame(start);
      const submitted=performance.now();await r.backend.device.queue.onSubmittedWorkDone();
      if(i>=20){times.push(performance.now()-start);gpuWait.push(performance.now()-submitted);}
      if(i===19) for(const row of Object.values(records)){row.ms=0;row.calls=0;}
    }
    const mean=a=>a.reduce((a,b)=>a+b,0)/a.length;
    return {frames,tick:g.simulation.tick,frameMs:mean(times),gpuWaitMs:mean(gpuWait),phases:Object.fromEntries(Object.entries(records).sort((a,b)=>b[1].ms-a[1].ms).map(([name,row])=>[name,{msPerFrame:row.ms/frames,callsPerFrame:row.calls/frames}]))};
  } finally {g.paused=true;restores.reverse().forEach(f=>f());}
}
