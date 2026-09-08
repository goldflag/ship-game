import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright-core');
const label = process.argv[2] ?? 'sample';
const output = new URL('../../.build/custom-battle/', import.meta.url);
await mkdir(output, {recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu','--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
try {
  const page = await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1.5});
  const errors=[];page.on('pageerror',e=>{errors.push(String(e));console.log(String(e));});
  page.on('response',r=>{if(r.status()>=400) console.log(`${r.status()} ${r.url()}`);});
  page.on('console',m=>{if(m.type()==='error') {errors.push(m.text()); console.log(m.text().slice(0,300));}});
  await page.addInitScript(forceWebGL=>{
    if (forceWebGL) Object.defineProperty(navigator, 'gpu', { value: undefined });
    window.pipelineSamples=[];
    for(const method of ['createRenderPipeline','createRenderPipelineAsync','createComputePipeline','createComputePipelineAsync']) {
      if(!window.GPUDevice) break;
      const original=GPUDevice.prototype[method];
      GPUDevice.prototype[method]=function(...args){const start=performance.now(),value=original.apply(this,args);window.pipelineSamples.push({method,start,ms:performance.now()-start,label:args[0].label});return value;};
    }
    const post=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(message,...args){if(message?.type==='init'&&message.setup?.ships)message.setup.seed=0x6e617661;return post.call(this,message,...args);};
  }, !!process.env.FORCE_WEBGL);
  const cdp=await page.context().newCDPSession(page);
  await page.goto(process.env.PERFORMANCE_URL??'http://localhost:5173/scripts/diagnostics/custom-battle-performance.html?seconds=60',{waitUntil:'domcontentloaded',timeout:120000});
  const statusTimer=setInterval(()=>{page.evaluate(()=>document.querySelector('.startup-status,.battle-loading-status')?.textContent ?? 'Loading battle graphics').then(console.log).catch(()=>{});},20000);
  try { await page.waitForFunction(()=>window.review?.ready,undefined,{timeout:240000}); }
  finally { clearInterval(statusTimer); }
  console.log('Battle ready');
  if(process.env.CPU_PROFILE){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
  await page.waitForFunction(()=>window.review?.result,undefined,{timeout:180000});
  if(process.env.CPU_PROFILE){const {profile}=await cdp.send('Profiler.stop');await writeFile(new URL(`${label}.cpuprofile`,output),JSON.stringify(profile));}
  const data=await page.evaluate(()=>({result:review.result,rows:review.rows,pipelines:window.pipelineSamples}));
  await writeFile(new URL(`${label}.json`,output),JSON.stringify({...data,errors},null,2));
  await page.screenshot({path:new URL(`${label}.png`,output).pathname.replace(/^\/(\w:)/,'$1')});
  if (process.env.VISUAL_REVIEW) {
    for (const mode of ['ship', 'aircraft', 'distant', 'zoom']) {
      const checked = await page.evaluate(async mode => {
        const g = review.game;
        g.rig.update = () => {};
        const plane = g.simulation.aircraft.find(p => p.phase === 'outbound' || p.phase === 'attack');
        const subject = mode === 'ship' ? [g.simulation.ship.x,g.simulation.ship.y,g.simulation.ship.z] : plane?.position;
        if (!subject) return { skipped: 'No airborne aircraft' };
        const distance = mode === 'ship' ? 230 : mode === 'aircraft' ? 30 : 4000;
        g.camera.zoom = mode === 'zoom' ? 24 : 1;
        g.camera.position.set(subject[0]+distance*.7,subject[1]+distance*.4,subject[2]+distance);
        g.camera.lookAt(...subject);g.camera.updateProjectionMatrix();g.camera.updateMatrixWorld(true);
        for(let i=0;i<3;i++) await g.frame(performance.now());
        return { aircraft:g.aircraftView.diagnostics(), muzzleError:Math.max(...g.fleetViews.flatMap(v=>v.muzzleErrors())) };
      },mode);
      await page.screenshot({path:new URL(`${label}-${mode}.png`,output).pathname.replace(/^\/(\w:)/,'$1')});
      console.log(mode, JSON.stringify(checked));
    }
  }
  console.log(JSON.stringify({total:data.result.total,windows:data.result.windows,tick:data.result.tick,phases:data.result.phases,errors}));
} finally {await browser.close();}
