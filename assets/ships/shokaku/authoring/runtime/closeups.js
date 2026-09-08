(async()=>{
const g=window.shokakuReview.game;if(!g.inPort)throw new Error('Port only');
const {localToWorld}=await import('/src/simulation/geometry.ts');
const update=g.rig.update,near=g.camera.near,images=[],views=[
 {name:'open127-game',mount:'aa127-port-1',camera:[-29,15.2,-68],target:[-16,12.8,-75.7]},
 {name:'triple25-game',mount:'aa25-port-4',camera:[-25,18,4],target:[-16.8,15.8,11.5]},
 {name:'gas127-game',mount:'aa127-starboard-3',camera:[29,15.3,48],target:[17,12.8,41.2]},
 {name:'shielded25-game',mount:'aa25-starboard-3',camera:[25,18,82],target:[16.8,15.8,75.3]}
];
try {
 g.rig.update=()=>{};g.camera.near=.2;g.camera.updateProjectionMatrix();
 for(const view of views){
  g.camera.position.fromArray(localToWorld(view.camera,g.playerView.motion));g.camera.lookAt(...localToWorld(view.target,g.playerView.motion));g.camera.updateMatrixWorld();
  await new Promise(r=>setTimeout(r,250));g.renderFrame();
  images.push({...view,image:g.renderer.domElement.toDataURL('image/png'),muzzleErrorM:g.diagnostics().maxMuzzleErrorM});
 }
}finally{g.rig.update=update;g.camera.near=near;g.camera.updateProjectionMatrix();g.rig.update(g.playerView.motion,g.playerView.motion.y,0,true);}
return {contentHash:g.definition.contentHash,backend:g.diagnostics().backend,scope:'Actual loaded GLB with all ship geometry present, development camera placed near each gun variant. Camera override is review-only and restored; normal port controls have a wider minimum distance.',images};
})()
