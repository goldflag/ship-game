// Install playwright-core in a separate tools directory and set PLAYWRIGHT_MODULE
// to its index.mjs, or run where that package is available. Uses installed Chrome.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright-core');
import { writeFile } from 'node:fs/promises';
const browser = await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
const results=[];
if (!process.argv[2]) throw new Error('Supply a capture name, e.g. before or after');
for(let run=0;run<2;run++) {
 const context=await browser.newContext({viewport:{width:1280,height:720}});
 const page=await context.newPage(); const errors=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('requestfailed',r=>errors.push(r.url()+': '+r.failure()?.errorText));
 const cdp=await context.newCDPSession(page);
 if(process.env.THROTTLE) await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:6250000,uploadThroughput:1250000});
 await page.addInitScript(()=>{
  window.startupStages=[];
  new MutationObserver(()=>{
   const label=document.querySelector('.startup-status')?.textContent ?? (document.querySelector('.garage')?'Harbor ready':null);
   if(label && window.startupStages.at(-1)?.label!==label) window.startupStages.push({label,ms:Math.round(performance.now())});
  }).observe(document,{childList:true,subtree:true,characterData:true});
 });
 await page.goto(process.env.STARTUP_URL ?? 'http://localhost:5298/',{waitUntil:'domcontentloaded',timeout:120000});
 await page.getByRole('button',{name:/^custom battle$/i}).waitFor({timeout:180000});
 const data=await page.evaluate(()=>({ms:Math.round(performance.now()),stages:window.startupStages,resources:performance.getEntriesByType('resource').filter(r=>r.transferSize>10000).map(r=>({name:r.name.split('/').pop(),kb:Math.round(r.transferSize/1024),start:Math.round(r.startTime),end:Math.round(r.responseEnd)}))}));
 results.push({...data,errors});console.log(JSON.stringify({stages:data.stages,totalMiB:data.resources.reduce((s,r)=>s+r.kb,0)/1024,errors}));
 await page.screenshot({path:`/tmp/startup-${process.argv[2]}-${run}.png`});
 await context.close();
}
await writeFile(`/tmp/startup-${process.argv[2]}.json`,JSON.stringify(results,null,2));
await browser.close();
