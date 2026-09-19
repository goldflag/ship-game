// Run with: bun scripts/tests/shipbuilder-armament-browser.mjs <vite-url>
import {chromium} from 'playwright';
const browser=await chromium.launch({headless:true});
try {
const page=await browser.newPage({viewport:{width:1500,height:950}});
page.on('pageerror',e=>console.log('PAGE',e.message));
await page.goto((process.argv[2] ?? 'http://127.0.0.1:5200') + '/tools/construction/review.html');
await page.evaluate(async()=>{window.check=await import('/scripts/tests/shipbuilder-armament-browser.tsx');await window.check.mountArmamentReview(true);});
const ready=()=>page.waitForFunction(()=>{try{return !!window.check.armamentEditor().result()}catch{return false}},{timeout:60000});
await ready();
const first=await page.evaluate(()=>({source:window.check.armamentEditor().source(),result:window.check.armamentEditor().result()}));
if(first.source.construction.version!==2||first.source.construction.equipment.some(e=>e.id==='old-magazine'||e.magazineId))throw Error('Legacy conversion failed');
if(!first.result.definition)throw Error(JSON.stringify(first.result.diagnostics));
await page.evaluate(async()=>{window.check.armamentEditor().undo();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
const restored=await page.evaluate(()=>window.check.armamentEditor().source());
if(restored.construction.version!==1||!restored.construction.equipment.some(e=>e.id==='old-magazine'))throw Error('Conversion undo failed');
await page.evaluate(()=>window.check.armamentEditor().redo());await ready();
await page.getByRole('tab',{name:'Armament',exact:true}).click();
await page.keyboard.press('v');
const pos=await page.evaluate(async()=>{const T=await import('/node_modules/three/build/three.module.js');return window.shipbuilderViewport.project(new T.Vector3(0,4.5,-14));});
await page.mouse.click(pos.x,pos.y);
const rise=page.getByRole('spinbutton',{name:'Turret rise',exact:true});await rise.waitFor();await rise.fill('3');await rise.press('Tab');await ready();
const raised=await page.evaluate(()=>({source:window.check.armamentEditor().source(),result:window.check.armamentEditor().result()}));
const mag=d=>d.definition.modules.find(m=>m.id==='gun-forward-magazine');
if(Math.abs(mag(first.result).center[1]-mag(raised.result).center[1])>1e-8)throw Error('Magazine rose');
if(raised.source.construction.equipment.find(e=>e.id==='gun-forward').gun.barbetteHeightM!==3)throw Error('Height control failed');
// The tag offers no paint controls: a barbette wears its turret's paint, else the ship paint.
if(await page.getByRole('combobox',{name:/paint/i}).count())throw Error('Fitting tag still offers paint');
await page.evaluate(()=>{const e=window.check.armamentEditor();e.apply({version:1,expectedRevision:e.source().revision,label:'Paint turret',commands:[{op:'equipment-patch',id:'gun-forward',changes:{paint:'red-oxide'}}]});});await ready();
const verifyPaint=async expected=>{
 const state=await page.evaluate(()=>({source:window.check.armamentEditor().source(),result:window.check.armamentEditor().result()}));
 const gun=state.source.construction.equipment.find(e=>e.id==='gun-forward');
 if((gun.paint??'naval-gray')!==expected||gun.gun.barbetteHeightM!==3)throw Error('Paint edit changed rise or did not persist');
 const surfaces=state.result.surfaces.filter(s=>s.primitiveId==='equipment:gun-forward');
 if(!surfaces.length||surfaces.some(s=>s.paint!==expected))throw Error('Paint did not cover whole barbette');
 const otherPaints=result=>result.surfaces.filter(s=>s.primitiveId!=='equipment:gun-forward').map(s=>s.paint);
 if(JSON.stringify(otherPaints(state.result))!==JSON.stringify(otherPaints(raised.result)))throw Error('Barbette paint changed the deck');
};
await verifyPaint('red-oxide');
await page.evaluate(()=>window.check.armamentEditor().undo());await ready();await verifyPaint('naval-gray');
await page.evaluate(()=>window.check.armamentEditor().redo());await ready();await verifyPaint('red-oxide');
await page.keyboard.press('PageUp');await ready();
const stepped=await page.evaluate(()=>window.check.armamentEditor().source().construction.equipment.find(e=>e.id==='gun-forward'));if(stepped.gun.barbetteHeightM!==3.25)throw Error('PageUp did not extend barbette');
await page.keyboard.press('PageDown');await ready();
await page.getByRole('tab',{name:'Internals',exact:true}).click();
await page.setViewportSize({width:800,height:700});
await page.setViewportSize({width:1500,height:950});
await page.evaluate(()=>{const e=window.check.armamentEditor();e.apply({version:1,expectedRevision:e.source().revision,label:'Check narrow hull',commands:[{op:'move',ids:['gun-forward'],delta:[3.8,0,0]}]});});
await ready();
const invalid=await page.evaluate(()=>window.check.armamentEditor().result());if(invalid.definition)throw Error('Clipping turret launched');
if(!invalid.surfaces.some(s=>s.primitiveId==='equipment:gun-forward'&&s.face==='installation-outer'))throw Error('Invalid draft lost its barbette');
if(!invalid.surfaces.some(s=>s.primitiveId==='equipment:gun-forward'&&s.face==='installation-top'))throw Error('Invalid draft lost its round top rim');
await page.getByRole('button',{name:/SEA TRIALS/}).isDisabled().then(disabled=>{if(!disabled)throw Error('Trial button enabled');});
await page.evaluate(async()=>{await window.check.armamentEditor().flush();window.check.armamentEditor().undo();});await ready();
if(!await page.evaluate(()=>!!window.check.armamentEditor().result().definition))throw Error('Undo failed');
console.log(JSON.stringify({converted:true,raised:true,magazineY:mag(raised.result).center[1],invalid:invalid.diagnostics,undo:true}));
} finally { await browser.close(); }
