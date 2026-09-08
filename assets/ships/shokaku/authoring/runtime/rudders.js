/* Review-only poses of retained joints; normal carrier play leaves them static. */
(async()=>{
 const g=window.shokakuReview.game,{localToWorld}=await import('/src/simulation/geometry.ts');
 if(!g.inPort)throw new Error('Port only');
 const nodes=new Map();g.playerView.root.traverse(n=>{if(n.userData.nodeId)nodes.set(n.userData.nodeId,n);});
 const joints=['rudder-aft.yaw','rudder-forward.yaw'].map(id=>nodes.get(id));
 if(joints.some(n=>!n))throw new Error('Missing retained rudder joint');
 const saved=joints.map(n=>({quaternion:n.quaternion.clone(),matrix:n.matrix.clone()}));
 const update=g.rig.update,near=g.camera.near,angles=[-35,-30,-25,-20,-15,-10,-5,0,5,10,15,20,25,30,35],images=[];
 let frames=0;
 try{
  g.rig.update=()=>{};g.camera.near=.1;g.camera.updateProjectionMatrix();
  g.camera.position.fromArray(localToWorld([12,-8,126],g.playerView.motion));
  g.camera.lookAt(...localToWorld([0,-6.8,108],g.playerView.motion));g.camera.updateMatrixWorld();
  for(const a of angles)for(const b of angles){
   joints.forEach((n,i)=>{n.rotation.y=(i?b:a)*Math.PI/180;n.updateMatrix();});
   g.playerView.root.updateMatrixWorld(true);g.renderFrame();frames++;
   if((a===0&&b===0)||(a===-35&&b===35)||(a===35&&b===-35))images.push({name:`rudders-${a}-${b}`,anglesDeg:[a,b],image:g.renderer.domElement.toDataURL('image/png')});
   await new Promise(r=>requestAnimationFrame(r));
  }
 }finally{
  joints.forEach((n,i)=>{n.quaternion.copy(saved[i].quaternion);n.matrix.copy(saved[i].matrix);});
  g.playerView.root.updateMatrixWorld(true);g.rig.update=update;g.camera.near=near;g.camera.updateProjectionMatrix();g.rig.update(g.playerView.motion,g.playerView.motion.y,0,true);
 }
 return {contentHash:g.definition.contentHash,backend:g.diagnostics().backend,fixture:'Manual review of retained GLB joints; 225 independently paired rendered poses. Normal surface-carrier steering does not animate these joints. Source triangle review supplies separate collision evidence.',frames,anglesDeg:angles,cameraLocal:[12,-8,126],targetLocal:[0,-6.8,108],images};
})()
