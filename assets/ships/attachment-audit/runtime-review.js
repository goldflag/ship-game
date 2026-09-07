/* Development-only review harness, executed through Orca in our localhost page.
 * No production hooks or network writes. Reload removes the helper. UI actions
 * still own ship selection, launch, battery controls and return-to-port.
 */
(async () => {
  const { localToWorld, rotate } = await import('/src/simulation/geometry.ts');
  let game;
  // Vite may keep a timestamped module identity after definition HMR.
  const modules = [...new Set(performance.getEntriesByType('resource').map(e => e.name).filter(name => {
    const url = new URL(name); return url.origin === location.origin && url.pathname === '/src/game/Game.ts';
  }))].reverse();
  for (const url of modules) {
    const { Game } = await import(url), original = Game.prototype.diagnostics;
    try {
      Game.prototype.diagnostics = function () { game = this; return original.call(this); };
      window.shipTrialDiagnostics();
    } finally { Game.prototype.diagnostics = original; }
    if (game) break;
  }
  if (!game) throw new Error('Loaded development session required');
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const log = window.fleetFidelityReview?.log ?? [];
  const record = (kind, details) => {
    const d = game.diagnostics();
    const row = { kind, shipId: d.shipId, contentHash: d.contentHash, backend: d.backend, time: new Date().toISOString(), ...details };
    log.push(row); return row;
  };
  window.attachmentReview = {
    async poses() {
      if (!game.inPort) throw new Error('Port required');
      const results=[];
      for(const trainFraction of [-1,0,1]) for(const elevationFraction of [0,1]) for(const recoilFraction of [0,1]) {
        game.previewArticulation({trainFraction,elevationFraction,recoilFraction});
        await frame();
        const d=game.diagnostics();
        if(d.maxMuzzleErrorM>.025) throw new Error('Muzzle mismatch');
        results.push({trainFraction,elevationFraction,recoilFraction,maxMuzzleErrorM:d.maxMuzzleErrorM});
      }
      game.previewArticulation(null);
      return record('articulation',{mounts:game.definition.mounts.length,poses:results});
    },
    async detail(targetBlender, offsetBlender, pose=null) {
      game.previewArticulation(pose);
      game.rig.update=()=>{};
      const local=v=>new game.camera.position.constructor(-v[1],v[2],-v[0]);
      const target=game.playerView.root.localToWorld(local(targetBlender));
      const eye=game.playerView.root.localToWorld(local(targetBlender.map((v,i)=>v+offsetBlender[i])));
      game.camera.position.copy(eye);game.camera.lookAt(target);game.camera.updateMatrixWorld(true);
      await frame();game.renderFrame();
      return {shipId:game.definition.id,contentHash:game.definition.contentHash,targetBlender,offsetBlender,pose,camera:game.camera.position.toArray(),image:game.renderer.domElement.toDataURL('image/png')};
    },
    diagnostics(){return game.diagnostics();}
  };
  return {ready:true,shipId:game.definition.id,contentHash:game.definition.contentHash};
})()
