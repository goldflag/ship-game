/* Execute through Orca eval in the loaded localhost development game. Reload
 * removes this harness. It records the actual GLB and CPU simulation together. */
(async () => {
  // An Orca background tab may have just resumed its document. Wait for the
  // existing application load, and reuse its exact module URL/cache identity.
  const deadline=performance.now()+60000;
  while(!document.querySelector('.port-model-views')) {
    if(performance.now()>deadline)throw new Error('Port did not become ready');
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  const threeUrl=performance.getEntriesByType('resource').map(e=>e.name).find(name=>new URL(name).pathname.endsWith('/three_webgpu.js'));
  const THREE = await import(threeUrl || '/node_modules/.vite/deps/three_webgpu.js');
  let game;
  const urls = [...new Set(performance.getEntriesByType('resource').map(e => e.name).filter(name => {
    const u = new URL(name); return u.origin === location.origin && u.pathname === '/src/game/Game.ts';
  }))].reverse();
  for (const url of urls) {
    const { Game } = await import(url), original = Game.prototype.diagnostics;
    try { Game.prototype.diagnostics = function () { game = this; return original.call(this); }; window.shipTrialDiagnostics(); }
    finally { Game.prototype.diagnostics = original; }
    if (game) break;
  }
  if (!game?.playerView || game.definition.id !== 'shokaku') throw new Error('Load Shokaku in the development port first');
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const log = [];
  const record = (kind, details) => {
    const d = game.diagnostics(), row = { kind, shipId: d.shipId, contentHash: d.contentHash, time: new Date().toISOString(), backend: d.backend, ...details };
    log.push(row); return row;
  };
  window.shokakuReview = {
    game, log, record,
    capture() { game.renderFrame(); return game.renderer.domElement.toDataURL('image/png'); },
    async camera(azimuth=1.1,elevation=.35,distance=300) {
      Object.assign(game.rig,{azimuth,elevation,distance});game.rig.update(game.playerView.motion,game.playerView.motion.y,0,true);await frame();
      return record('camera',{position:game.camera.position.toArray()});
    },
    async independentPoses() {
      if (!game.inPort) throw new Error('Port only');
      const original=structuredClone(game.simulation.player.mounts),poses=[];
      for (let step=0;step<=120;step++) {
        game.simulation.player.mounts.forEach((state,i)=>{
          const w=game.definition.mounts[i].weapon;
          const train=Math.sin(step*Math.PI/12+i*Math.PI/3);
          const elevation=(1+Math.sin(step*Math.PI/10+i*Math.PI/2))/2;
          state.train=train*w.traverseDeg*Math.PI/180;
          state.elevation=(w.elevationMinDeg+elevation*(w.elevationMaxDeg-w.elevationMinDeg))*Math.PI/180;
          state.recoil=(step+i)%5/4;
        });
        game.playerView.update();
        const d=game.diagnostics();
        if(d.maxMuzzleErrorM>.025)throw new Error('CPU/GLB muzzle mismatch');
        poses.push({step,maxMuzzleErrorM:d.maxMuzzleErrorM});
        if(step%12===0){game.renderFrame();await frame();}
      }
      game.simulation.player.mounts.forEach((state,i)=>Object.assign(state,original[i]));game.playerView.update();
      return record('independent-mount-poses',{poses,maxMuzzleErrorM:Math.max(...poses.map(p=>p.maxMuzzleErrorM))});
    },
    async gridSweep() {
      if (!game.inPort) throw new Error('Port only');
      const original=structuredClone(game.simulation.player.mounts);
      const grids=game.definition.mounts.map(m=>{
        const w=m.weapon,values=(lo,hi)=>[...new Set([lo,hi,...Array.from({length:Math.floor(hi/10)-Math.ceil(lo/10)+1},(_,i)=>(Math.ceil(lo/10)+i)*10)])].sort((a,b)=>a-b);
        return values(-w.traverseDeg,w.traverseDeg).flatMap(t=>values(w.elevationMinDeg,w.elevationMaxDeg).flatMap(e=>[0,.5,1].map(r=>[t,e,r])));
      });
      const frames=[];
      try {
        for(let step=0;step<Math.max(...grids.map(g=>g.length));step++) {
          game.simulation.player.mounts.forEach((state,i)=>{
            const [t,e,r]=grids[i][(step+i*23)%grids[i].length];
            Object.assign(state,{train:t*Math.PI/180,elevation:e*Math.PI/180,recoil:r});
          });
          game.playerView.update();game.renderFrame();
          const error=Math.max(...game.playerView.muzzleErrors());
          if(error>.025)throw new Error('CPU/GLB muzzle mismatch');
          frames.push({step,maxMuzzleErrorM:error});
          window.shokakuSweepProgress={step,total:Math.max(...grids.map(g=>g.length))};
          await frame();
        }
      } finally {
        game.simulation.player.mounts.forEach((state,i)=>Object.assign(state,original[i]));game.playerView.update();
      }
      return record('exported-grid-sweep',{method:'Actual game-rendered GLB. 10-degree grids plus exact limits and 0/half/full recoil; phase offsets give neighbors different poses. Source triangle sweep and exported conservative bounds provide separate collision evidence.',mounts:game.definition.mounts.map((m,i)=>({id:m.id,uniquePoses:grids[i].length})),frames,maxMuzzleErrorM:Math.max(...frames.map(f=>f.maxMuzzleErrorM))});
    },
    neighborBounds() {
      const root=game.playerView.root,nodes=new Map();root.updateMatrixWorld(true);
      root.traverse(o=>{if(o.userData.nodeId)nodes.set(o.userData.nodeId,o);});
      const bounds=[];
      for(const m of game.definition.mounts){
        const yaw=nodes.get(m.id+'.yaw');let radius=0,vertices=0;
        yaw.traverse(o=>{
          if(!o.isMesh)return;
          let elevation=o;
          while(elevation!==yaw&&!String(elevation.userData.nodeId).endsWith('.elevation'))elevation=elevation.parent;
          const articulated=elevation!==yaw,transform=new THREE.Matrix4().copy(elevation.matrixWorld).invert().multiply(o.matrixWorld);
          const positions=o.geometry.getAttribute('position'),v=new THREE.Vector3();
          for(let i=0;i<positions.count;i++){
            v.fromBufferAttribute(positions,i).applyMatrix4(transform);vertices++;
            const r=articulated?Math.hypot(Math.abs(elevation.position.x)+Math.abs(v.x),Math.abs(elevation.position.z)+Math.hypot(Math.abs(v.z)+m.weapon.recoilM,v.y)):Math.hypot(v.x,v.z);
            radius=Math.max(radius,r);
          }
        });
        bounds.push({mount:m.id,position:m.position,radiusM:radius,vertices});
      }
      const pairs=[];
      for(let i=0;i<bounds.length;i++)for(let j=i+1;j<bounds.length;j++){
        const a=bounds[i],b=bounds[j];pairs.push({a:a.mount,b:b.mount,guaranteedGapM:Math.hypot(a.position[0]-b.position[0],a.position[2]-b.position[2])-a.radiusM-b.radiusM});
      }
      pairs.sort((a,b)=>a.guaranteedGapM-b.guaranteedGapM);
      return record('exported-independent-neighbor-bounds',{method:'Actual GLB vertices, conservative horizontal cylinders over any independent yaw/elevation and 0..maximum recoil',bounds,pairs,result:pairs[0].guaranteedGapM>0?'pass':'requires narrower sweep'});
    },
    async advance(seconds) {
      game.previewAdvance(seconds);game.renderFrame();await frame();
      return record('advance',{seconds,diagnostics:game.diagnostics()});
    },
    state(label='state') {return record(label,{diagnostics:game.diagnostics()});},
  };
  return {ready:true,ship:game.definition.id,contentHash:game.definition.contentHash};
})()
