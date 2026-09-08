(async()=>{
 const g=window.shokakuReview.game,{localToWorld}=await import('/src/simulation/geometry.ts');
 const update=g.rig.update,near=g.camera.near,views=[
 {name:'island-forward',camera:[30,23,-52],target:[13.35,19.4,-38]},
 {name:'island-aft',camera:[28,22,-27],target:[13.35,19.4,-39]},
 {name:'stern-quarter',camera:[36,18,151],target:[0,8.5,108]},
 {name:'stern-center',camera:[0,13,155],target:[0,8,112]}],images=[];
 try{g.rig.update=()=>{};g.camera.near=.25;g.camera.updateProjectionMatrix();
  for(const v of views){g.camera.position.fromArray(localToWorld(v.camera,g.playerView.motion));g.camera.lookAt(...localToWorld(v.target,g.playerView.motion));g.camera.updateMatrixWorld();await new Promise(r=>setTimeout(r,300));g.renderFrame();images.push({...v,image:g.renderer.domElement.toDataURL('image/png')});}
 }finally{g.rig.update=update;g.camera.near=near;g.camera.updateProjectionMatrix();g.rig.update(g.playerView.motion,g.playerView.motion.y,0,true);}
 return {contentHash:g.definition.contentHash,backend:g.diagnostics().backend,images};
})()
