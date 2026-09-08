/* Matched high and oblique views expose the island's walking surfaces. */
(async()=>{
 const g=window.shokakuReview.game,{localToWorld}=await import('/src/simulation/geometry.ts');
 if(!g.inPort)throw new Error('Port only');
 const update=g.rig.update,near=g.camera.near,images=[],views=[
  {name:'decks-forward-high',camera:[30,36,-53],target:[13.35,18.8,-39]},
  {name:'decks-aft-high',camera:[28,35,-25],target:[13.35,18.8,-39]},
  {name:'decks-top',camera:[13.35,48,-39],target:[13.35,19,-39.1]}
 ];
 try{
  g.rig.update=()=>{};g.camera.near=.25;g.camera.updateProjectionMatrix();
  for(const v of views){
   g.camera.position.fromArray(localToWorld(v.camera,g.playerView.motion));g.camera.lookAt(...localToWorld(v.target,g.playerView.motion));g.camera.updateMatrixWorld();
   await new Promise(r=>setTimeout(r,250));g.renderFrame();images.push({...v,image:g.renderer.domElement.toDataURL('image/png')});
  }
 }finally{g.rig.update=update;g.camera.near=near;g.camera.updateProjectionMatrix();g.rig.update(g.playerView.motion,g.playerView.motion.y,0,true);}
 return {contentHash:g.definition.contentHash,backend:g.diagnostics().backend,fixture:'Actual loaded GLB; all ship geometry present. Camera overrides restored after capture.',images};
})()
