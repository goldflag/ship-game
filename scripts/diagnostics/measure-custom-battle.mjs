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
    window.pipelineSamples=[]; window.workerSamples=[];
    window.gpuAdapters=[];
    if (window.GPUAdapter) {
      const requestDevice = GPUAdapter.prototype.requestDevice;
      GPUAdapter.prototype.requestDevice = function (...args) {
        const info = this.info;
        window.gpuAdapters.push(info ? { vendor: info.vendor, architecture: info.architecture,
          device: info.device, description: info.description, isFallbackAdapter: this.isFallbackAdapter } : { unavailable: true });
        return requestDevice.apply(this, args);
      };
    }
    for(const method of ['createRenderPipeline','createRenderPipelineAsync','createComputePipeline','createComputePipelineAsync']) {
      if(!window.GPUDevice) break;
      const original=GPUDevice.prototype[method];
      GPUDevice.prototype[method]=function(...args){const start=performance.now(),value=original.apply(this,args);window.pipelineSamples.push({method,start,ms:performance.now()-start,label:args[0].label});return value;};
    }
    const post=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(message,...args){
      if(message?.type==='init'&&message.setup?.ships) {
        message.setup.seed=0x6e617661;
        if (new URLSearchParams(location.search).has('profile')) {
          message.profile=true;
          this.addEventListener('message',event=>{if(event.data.timing)window.workerSamples.push(event.data.timing);});
        }
      }
      return post.call(this,message,...args);
    };
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
  const data=await page.evaluate(()=>({result:review.result,rows:review.rows,pipelines:window.pipelineSamples,worker:window.workerSamples}));
  data.environment = { browser: browser.version(), ...await page.evaluate(() => ({
    userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
    adapters: window.gpuAdapters,
  })) };
  if (process.env.UPLOAD_PROFILE_AFTER) {
    data.uploads = await page.evaluate(async () => {
      const g = review.game, rows = new Map(), buffers = new Map();
      const original = GPUQueue.prototype.writeBuffer;
      GPUQueue.prototype.writeBuffer = function (buffer, offset, source, dataOffset, size) {
        const start = performance.now();
        const result = original.apply(this, arguments);
        const row = rows.get(buffer.label) ?? { label: buffer.label, calls: 0, bytes: 0, ms: 0 };
        row.calls++; row.ms += performance.now() - start;
        row.bytes += size === undefined ? source.byteLength - (dataOffset ?? 0) * (source.BYTES_PER_ELEMENT ?? 1) : size * (source.BYTES_PER_ELEMENT ?? 1);
        rows.set(buffer.label, row); buffers.set(buffer, (buffers.get(buffer) ?? 0) + 1);
        return result;
      };
      g.paused = false;
      try { for (let i = 0; i < 60; i++) await g.frame(await new Promise(requestAnimationFrame)); }
      finally { g.paused = true; GPUQueue.prototype.writeBuffer = original; }
      return { frames: 60, buffers: buffers.size, rows: [...rows.values()].sort((a, b) => b.ms - a.ms) };
    });
    console.log('Buffer uploads', JSON.stringify(data.uploads));
  }
  if (process.env.GPU_PROFILE_AFTER) {
    data.gpu = await page.evaluate(async () => {
      const g = review.game, renderer = g.renderer;
      if (!renderer.backend.device?.features.has('timestamp-query')) return { unavailable: true };
      renderer.backend.trackTimestamp = true;
      const samples = [];
      g.paused = false;
      for (let i = 0; i < 30; i++) {
        await g.frame(await new Promise(requestAnimationFrame));
        await Promise.all([renderer.resolveTimestampsAsync('render'), renderer.resolveTimestampsAsync('compute')]);
        samples.push({render:renderer.info.render.timestamp,compute:renderer.info.compute.timestamp});
      }
      g.paused = true; renderer.backend.trackTimestamp = false;
      return samples;
    });
    console.log('GPU timings',JSON.stringify(data.gpu));
  }
  if (process.env.CPU_PROFILE_AFTER) {
    console.log('Render pose counts', JSON.stringify(await page.evaluate(() => review.game.fleetViews.map(v => ({
      id: v.definition.id, poses: v.poseMatrices.poses.length, active: v.renderActive,
    })))));
    await cdp.send('Profiler.enable'); await cdp.send('Profiler.start');
    await page.evaluate(async () => {
      const g = review.game, end = performance.now() + 8000;
      g.paused = false;
      while (performance.now() < end) {
        const time = await new Promise(requestAnimationFrame);
        await g.frame(time);
      }
      g.paused = true;
    });
    const {profile} = await cdp.send('Profiler.stop');
    await writeFile(new URL(`${label}.cpuprofile`,output),JSON.stringify(profile));
  }
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
