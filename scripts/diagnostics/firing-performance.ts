/** Development-only probes on the actual fleet simulation, ocean and effects.
 * Freeze a CPU-fired scene and alternate one effect at a time. */
export function installFiringReview(game: any) {
  const helm = { throttle: .5, rudder: 0 };
  const intent = { aim: [3000, .5, 0], fire: true, battery: 'main' };
  const camera = (view: 'chase' | 'smoke' | 'fleet' = 'chase') => {
    const p = game.simulation.player.motion;
    game.camera.fov = 52; game.camera.updateProjectionMatrix();
    game.camera.position.set(p.x + (view === 'fleet' ? 1800 : view === 'smoke' ? 90 : 210), view === 'fleet' ? 1300 : view === 'smoke' ? 30 : 82, p.z + (view === 'fleet' ? 1800 : 155));
    game.camera.lookAt(p.x, 15, view === 'fleet' ? p.z - 2500 : p.z - 6);
    game.camera.updateMatrixWorld();game.effects.update(game.simulation,0,game.camera);
  };
  const advance = async (seconds: number, renderEachTick = false) => {
    const counts = {shots:0,splashes:0,peakSmoke:0,peakSpray:0,impacts:0,maxMarkMs:0};let sequence=game.simulation.events.at(-1)?.sequence ?? 0;
    for(let i=0;i<Math.round(seconds*60);i++) {
      game.simulation.step(helm,intent);
      game.fleetViews.forEach((view:any)=>view.update());
      const start=performance.now(),budget={remainingMs:2};
      for(let offset=0;offset<game.fleetViews.length;offset++){
        const view=game.fleetViews[(offset+game.simulation.tick)%game.fleetViews.length];
        view.impactMarks.update(game.simulation.events,view.actor.motion.id,budget);
      }
      counts.maxMarkMs=Math.max(counts.maxMarkMs,performance.now()-start);
      game.effects.update(game.simulation,1/60,game.camera);
      game.shipWake.update(game.simulation.ship,1/60,game.simulation.events);
      for(const event of game.simulation.events) if(event.sequence>sequence) {sequence=event.sequence;if(event.kind==='shot')counts.shots++;if(event.kind==='splash')counts.splashes++;if(event.impact)counts.impacts++;}
      const d=game.effects.diagnostics();counts.peakSmoke=Math.max(counts.peakSmoke,d.smoke);counts.peakSpray=Math.max(counts.peakSpray,d.spray);
      if(renderEachTick) {
        game.fleetViews.forEach((v:any)=>v.snap());camera();
        await new Promise(requestAnimationFrame);game.renderFrame();
      } else if(i%120===119) await new Promise(resolve=>setTimeout(resolve,0));
    }
    game.fleetViews.forEach((v:any)=>v.snap());camera();game.renderFrame();
    return {tick:game.simulation.tick,renderedFrames:renderEachTick?Math.round(seconds*60):1,...counts,effects:game.effects.diagnostics(),
      marks:game.fleetViews.reduce((sum:number,v:any)=>sum+v.impactMarks.count,0),
      queued:game.fleetViews.reduce((sum:number,v:any)=>sum+v.impactMarks.pendingCount,0)};
  };
  const measure = async (samples=12) => {
    const renderer=game.renderer, root=game.effects.root;
    const smoke=root.getObjectByName('Propellant and impact volumes'), spouts=root.getObjectByName('Aerated water volumes');
    const meshes=root.children.filter((o:any)=>o.isMesh), lights=root.children.filter((o:any)=>o.isLight);
    const intensities=lights.map((l:any)=>l.intensity), visibilities=meshes.map((m:any)=>m.visible);
    const tracking=renderer.backend.trackTimestamp, auto=renderer.info.autoReset;
    renderer.backend.trackTimestamp=renderer.hasFeature('timestamp-query');renderer.info.autoReset=false;
    const results:Record<string,any>={};
    const modes=['all','noSmoke','noSpouts','noLights','noEffects'];
    try {
      for(let frame=-4;frame<samples;frame++) for(const mode of frame%2 ? [...modes].reverse() : modes) {
        await new Promise(requestAnimationFrame);
        meshes.forEach((m:any,i:number)=>m.visible=visibilities[i]&&mode!=='noEffects');
        if(mode==='noSmoke')smoke.visible=false;if(mode==='noSpouts')spouts.visible=false;
        lights.forEach((l:any,i:number)=>l.intensity=mode==='noLights'||mode==='noEffects'?0:intensities[i]);
        renderer.info.reset();const start=performance.now();game.renderFrame();const cpu=performance.now()-start;
        const gpu=renderer.backend.trackTimestamp?await renderer.resolveTimestampsAsync('render'):null;
        if(frame<0)continue;const row=results[mode]??={cpu:[],gpu:[]};row.cpu.push(cpu);if(gpu!==null)row.gpu.push(gpu);
        row.draws=renderer.info.render.drawCalls;row.triangles=renderer.info.render.triangles;
      }
      const stats=(values:number[])=>{values.sort((a,b)=>a-b);return {median:values[Math.floor(values.length/2)],p90:values[Math.floor(values.length*.9)]};};
      return {canvas:[renderer.domElement.width,renderer.domElement.height],tick:game.simulation.tick,effects:game.effects.diagnostics(),samples,results:Object.fromEntries(Object.entries(results).map(([key,row])=>[key,{cpuMs:stats(row.cpu),gpuMs:stats(row.gpu),draws:row.draws,triangles:row.triangles}]))};
    } finally {meshes.forEach((m:any,i:number)=>m.visible=visibilities[i]);lights.forEach((l:any,i:number)=>l.intensity=intensities[i]);renderer.backend.trackTimestamp=tracking;renderer.info.autoReset=auto;game.renderFrame();}
  };
  return {advance,camera,measure};
}
