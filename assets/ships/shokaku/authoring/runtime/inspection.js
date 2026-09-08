(async()=>{
 const g=window.shokakuReview.game;if(!g.inPort)throw new Error('Port only');
 const pause=()=>new Promise(r=>setTimeout(r,220));
 const entries=[
  {tab:'Armor',mode:'armor',name:'Glazed conning and air-control bridge',id:'structure:air-control'},
  {tab:'Internals',mode:'internals',name:g.definition.modules.find(m=>m.id==='aviation-service').name,id:'module:aviation-service'},
  {tab:'Flooding',mode:'compartments',...(()=>{const c=g.definition.compartments.find(c=>c.name.toLowerCase().includes('boiler'));return {name:c.name,id:'compartment:'+c.id};})()}
 ],rows=[],images=[];
 await window.shokakuReview.camera(1.12,.27,270);
 try{
  for(const entry of entries){
   const tab=[...document.querySelectorAll('.port-model-views button')].find(b=>b.textContent.trim()===entry.tab);
   if(!tab)throw new Error('Missing inspection tab '+entry.tab);tab.click();await pause();
   const button=[...document.querySelectorAll('.port-volume-list button')].find(b=>b.textContent.includes(entry.name));
   if(!button)throw new Error('Missing inspection row '+entry.name);button.click();await pause();
   const d=g.diagnostics();rows.push({...entry,observedMode:d.portInspection,observedSelection:d.selectedVolume});
   if(d.portInspection!==entry.mode||d.selectedVolume!==entry.id)throw new Error('Inspection did not select '+entry.id);
   g.renderFrame();images.push({name:entry.mode,image:g.renderer.domElement.toDataURL('image/png')});
  }
 }finally{
  [...document.querySelectorAll('.port-model-views button')].find(b=>b.textContent.trim()==='Statistics')?.click();await pause();
 }
 return {contentHash:g.definition.contentHash,fixture:'Normal visible port tabs and volume buttons; selected updated bridge structural surface, aviation-service equipment and a boiler flood compartment.',backend:g.diagnostics().backend,rows,images,result:'pass'};
})()
