import {chromium} from 'playwright';
await (await import('node:fs/promises')).mkdir('.build/accounts-test',{recursive:true});
await (await import('node:fs/promises')).writeFile('.build/accounts-test/blank.html','<!doctype html><body><div id="host" style="position:fixed;inset:0"></div>');
const browser=await chromium.launch({channel:'chrome',headless:true});
const pages=[];
try {
 for(let i=0;i<2;i++) {
  const context=await browser.newContext({viewport:{width:1000,height:700}}),page=await context.newPage();pages.push(page);
  await page.goto('http://localhost:5200/.build/accounts-test/blank.html');
  const user=await page.evaluate(async index=>{const r=await fetch('/api/auth/sign-up/email',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Browser '+index,email:`two-${crypto.randomUUID()}@example.test`,password:'two-browser-password-1234'})});if(!r.ok)throw new Error(await r.text());return (await r.json()).user;},i);
  await page.setContent('<body style="margin:0"><div id="host" style="position:fixed;inset:0"></div></body>');
  page.on('websocket',ws=>{ws.on('close',()=>console.log('WS closed'));ws.on('socketerror',e=>console.log('WS error',e));});
  page.on('console',m=>{if(m.type()==='error'||m.text().startsWith('LOBBY'))console.log('browser console',m.text().slice(0,250));});
  page.on('pageerror',error=>console.log('pageerror',error.message));
  await page.evaluate(async ({account,index})=>{
   const {setAccount}=await import('/src/accounts/session.ts');setAccount(account);
   window.testAccountId=account;
   const {loadConstructionCatalog}=await import('/src/ships/constructionEquipment.ts');const catalog=await loadConstructionCatalog();
   const {createStarterSource}=await import('/src/ships/constructionStarter.ts');const source=createStarterSource(catalog,'patrol');source.name='Browser ship '+index;
   const {openCloudConstructionStore}=await import('/src/ships/constructionCloud.ts');const store=openCloudConstructionStore();await store.save({designId:source.id,name:source.name,source,schemaVersion:1,catalogRevision:catalog.revision,expectedRevisionId:null});store.close();
   const {restoreLocalShips}=await import('/src/ships/constructionLibrary.ts');await restoreLocalShips();
   const {localShips}=await import('/src/ships/localShips.ts');window.testFleet=[localShips()[0].definition.id,'fletcher'];
   const {Game}=await import('/src/game/Game.ts');const {GRAPHICS_PRESETS}=await import('/src/game/graphicsSettings.ts');const {shipPreset}=await import('/src/ships/presets.ts');
   await new Promise((resolve,reject)=>{const game=new Game(document.getElementById('host'),GRAPHICS_PRESETS.low,{progress(){},ready:resolve,error:reject,pause(){},hud(){},telemetry(){}},shipPreset('fletcher'));window.testGame=game;game.setInPort(true);game.start();});
  },{account:user.id,index:i});
  console.log('Browser',i,'harbor and saved design loaded');
 }
 for(let i=0;i<2;i++) {
  const code=i===0?'':await pages[0].evaluate(()=>window.testInvite);
  await pages[i].evaluate(async ({mode,code})=>{
   const {MatchConnection}=await import('/src/game/session/RemoteBattleSession.ts');
   const connection=await MatchConnection.join(window.testFleet,mode,code,s=>{console.log('LOBBY '+JSON.stringify(s));window.testStatus=s;if(s.inviteCode)window.testInvite=s.inviteCode;if(s.error)window.testError=s.error;});window.testConnection=connection;
   window.testMatch=connection.matched.then(async remote=>{window.testRemote=remote;await window.testGame.prepareOnlineBattle(remote);await window.testGame.beginBattle();remote.loadedAssets();window.testRendered=true;}).catch(e=>window.testError=String(e));
  },{mode:i===0?'create-invite':'join-invite',code});
  if(i===0)await pages[0].waitForFunction(()=>window.testInvite||window.testError,{timeout:15000});
 }
 await Promise.all(pages.map(p=>p.waitForFunction(()=>window.testRendered||window.testError,{timeout:60000})));
 for(const [i,p] of pages.entries()) {console.log('Browser result',i,await p.evaluate(()=>({rendered:window.testRendered,error:window.testError,custom:window.testRemote?.constructionShips.size,tick:window.testRemote?.tick})));await p.screenshot({path:'.build/accounts-test/battle-'+i+'.png'});}
 await pages[0].waitForFunction(()=>window.testRemote?.tick>180,{timeout:20000});
 console.log('Two authenticated browsers rendered both custom designs and simulated battle');
 await pages[0].evaluate(async()=>{
   window.testRemote.surrender();
   const {setAccount}=await import('/src/accounts/session.ts');
   const {openCloudConstructionStore,retainRecovery,recoveryDrafts}=await import('/src/ships/constructionCloud.ts');
   const {loadConstructionCatalog}=await import('/src/ships/constructionEquipment.ts');const catalog=await loadConstructionCatalog();
   const {createStarterSource}=await import('/src/ships/constructionStarter.ts');const source=createStarterSource(catalog,'blank');
   const input={designId:source.id,name:source.name,source,schemaVersion:1,catalogRevision:catalog.revision,expectedRevisionId:null};
   await retainRecovery(input);const store=openCloudConstructionStore();setAccount('different-account');
   let blocked=false;try{await store.save(input);}catch{blocked=true;}
   if(!blocked)throw new Error('An old adapter uploaded under another account');
   if(!(await recoveryDrafts(window.testAccountId)).some(d=>d.input.designId===source.id))throw new Error('Recovery draft was lost');
   if((await recoveryDrafts('different-account')).length)throw new Error('Recovery leaked across accounts');
   setAccount(window.testAccountId);store.close();
 });
 console.log('Account switching retains recovery drafts exclusively for their owner');
} catch(e){for(const p of pages)console.log(await p.evaluate(()=>({status:window.testStatus,error:window.testError})));throw e;} finally {for(const p of pages) await p.evaluate(()=>{window.testRemote?.surrender();window.testGame?.dispose();}).catch(()=>{});await browser.close();}
