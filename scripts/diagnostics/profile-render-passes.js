export function profileRenderPasses(g) {
 const r=g.renderer, original=r.render, rows={}, stack=[];
 r.render=function(scene,camera){
  const rt=r.getRenderTarget();const key=JSON.stringify({scene:scene===g.scene?"GAME":scene.name||scene.type,sceneId:scene.id,camera:camera.type,target:rt?.texture?.name||rt?.texture?.id||'screen',size:rt?[rt.width,rt.height]:[r.domElement.width,r.domElement.height],opaque:r.opaque,transparent:r.transparent,override:scene.overrideMaterial?.type});
  const state={start:performance.now(),nested:0};stack.push(state);
  const value=original.call(this,scene,camera);const elapsed=performance.now()-state.start;stack.pop();if(stack.length)stack.at(-1).nested+=elapsed;
  const row=rows[key]??={ms:0,calls:0};row.ms+=elapsed-state.nested;row.calls++;
  return value;
 };
 return {get results(){return Object.entries(rows).map(([key,v])=>({...JSON.parse(key),...v})).sort((a,b)=>b.ms-a.ms)},restore(){r.render=original}};
}
