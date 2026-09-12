// Real application and Rust worker, measured from the first battle frame.
import { Game } from '/src/game/Game.ts';
import { fleetBatchSubmissionStats, setFleetBatchBundlesEnabled } from '/src/game/FleetBatchInstancing.ts';
import { profileRenderPasses } from './profile-render-passes.js';
const params = new URLSearchParams(location.search);
const seconds = Number(params.get('seconds') ?? 60);
const roster = (params.get('roster') ?? 'bismarck,yamato,baltimore,fletcher,king-george-v,flower-corvette,enterprise-cv6').split(',');
const review = window.review = { ready: false, rows: [], phases: {}, errors: [] };
// Measure the battle, not the sortie board that would otherwise sit in front of
// the dialog. `SORTIE_BOARD_STORAGE_KEY`.
try { localStorage.setItem('naval-sortie-board-v1', 'skip'); } catch { /* private window */ }
let renderProfile;
let loaded = false, begun = 0, previous;
const start = Game.prototype.start, prepare = Game.prototype.prepareBattle, setPort = Game.prototype.setInPort, frame = Game.prototype.frame;
const beginBattle = Game.prototype.beginBattle;
if (beginBattle) Game.prototype.beginBattle = async function (...args) {
  await beginBattle.apply(this,args);
  begun = performance.now(); review.ready = true;
};
Game.prototype.start = function () {
  review.game = this;
  review.setBundles = enabled => setFleetBatchBundlesEnabled(this.renderer.backend, enabled);
  if (params.get('bundles') === '0') review.setBundles(false);
  this.settings = { ...this.settings, quality: params.get('quality') ?? 'high', resolution: 1 };
  this.rig.capturePointer = () => {};
  const ready = this.callbacks.ready;
  this.callbacks.ready = () => { ready(); loaded = true; };
  return start.call(this);
};
Game.prototype.prepareBattle = function (_, progress) {
  return prepare.call(this, { playerShipId: roster[0], friendlyBots: roster.slice(1), enemies: roster,
    spawnDistance: 5000, mapId: 'north-atlantic', timeHours: 12, cloudCover: 38, windSpeed: 9 }, progress);
};
Game.prototype.setInPort = function (port) {
  setPort.call(this, port);
  if (!port && !begun && !beginBattle) { begun = performance.now(); review.ready = true; }
};
Game.prototype.frame = async function (time, warmingUp) {
  const before = performance.now();
  await frame.call(this, time, warmingUp);
  if (!begun || warmingUp || review.result) return;
  if (previous !== undefined) review.rows.push({ time: time - begun, interval: time - previous, work: performance.now() - before, tick: this.simulation.tick });
  previous = time;
  if (time - begun >= seconds * 1000) {
    const materials = new Map();
    this.scene.traverse(object => {
      for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
        const row = materials.get(material.id) ?? { id: material.id, type: material.type, name: material.name, objects: [] };
        const name = object.name || object.parent?.name || object.type;
        if (!row.objects.includes(name)) row.objects.push(name);
        materials.set(material.id, row);
      }
    });
    const stats = rows => {
      const values = rows.map(r => r.interval).sort((a,b) => a-b);
      return { frames: rows.length, fps: rows.length * 1000 / rows.reduce((s,r)=>s+r.interval,0), p50: values[Math.floor(values.length*.5)], p95: values[Math.floor(values.length*.95)], p99: values[Math.floor(values.length*.99)], max: values.at(-1), over50: values.filter(v=>v>50).length, over100: values.filter(v=>v>100).length, work: rows.reduce((s,r)=>s+r.work,0)/rows.length };
    };
    review.result = {
      total: stats(review.rows),
      windows: Array.from({length: Math.ceil(seconds/10)}, (_,i)=>({start:i*10,...stats(review.rows.filter(r=>r.time>=i*10000 && r.time<(i+1)*10000))})),
      tick: this.simulation.tick, startedAt: begun, elapsed: time-begun, roster, seed: this.simulation.seed,
      settings: { quality: this.settings.quality, resolution: this.settings.resolution },
      framebuffer: [this.renderer.domElement.width,this.renderer.domElement.height], backend: this.water.backend,
      diagnostics:this.diagnostics(), phases:review.phases, passes:renderProfile?.results,
      fleetBatches:this.fleetDraws?.diagnostics(),
      activeShipViews:this.fleetViews.filter(v=>v.renderActive).length,
      submission:{...fleetBatchSubmissionStats(this.renderer.backend)},
      renderInfo:{...this.renderer.info.render}, hidden:document.hidden,
      materials: [...materials.values()],
    };
    this.paused = true; this.scheduleFrame = () => {}; cancelAnimationFrame(this.raf); this.audio?.setScene(false,true);
  }
};
await import('/src/main.tsx');
const wait = async predicate => { while (!predicate()) await new Promise(r=>setTimeout(r,50)); };
const button = text => [...document.querySelectorAll('button')].find(b=>b.textContent.toLowerCase().includes(text));
await wait(()=>loaded);
// Garage BATTLE opens the sortie board (or the dialog straight away when the board is skipped).
await wait(()=>button('battle')); button('battle').click();
await wait(()=>button('custom battle') || button('deploy fleet')); button('custom battle')?.click();
// Choose the enemy's card, then the enemy lane places it.
const card = () => [...document.querySelectorAll('button.ship-card-pick')].find(b => b.getAttribute('aria-label')?.toLowerCase().startsWith(`choose ${roster[0].replace(/-/g,' ')}`)) ?? document.querySelector('button.ship-card-pick');
await wait(()=>card()); card().click();
await wait(()=>document.querySelector('section.fleet-lane.enemy.is-accepting')); document.querySelector('section.fleet-lane.enemy').click();
await wait(()=>button('deploy fleet') && !button('deploy fleet').disabled); button('deploy fleet').click();
await wait(()=>button('start battle') && !button('start battle').disabled); button('start battle').click();
await wait(()=>review.ready);
const g = review.game;
// Optional late-combat profiling leaves the initial FPS sample uninstrumented.
if (params.has('profile')) await wait(() => performance.now() - begun >= Number(params.get('profileAfter') ?? 0) * 1000);
if (params.has('profile')) renderProfile = profileRenderPasses(g);
if (params.has('profile')) for (const [object,key,label] of [
  [g.simulation,'advance','session'],[g,'readSightAim','sight'],[g.water,'update','water'],[g,'renderFrame','render'],
  [g.effects,'update','effects'],[g.aircraftView,'update','aircraft'],[g.fleetDraws,'update','fleetDraws'],
  [g.effects.smoke.constructor.prototype,'publish','particlePublish'],
  [g.effects.smoke.constructor.prototype,'advance','particleAdvance'],
  [g.effects.spouts,'publish','plumePublish'],[g.aircraftView.gunfire,'update','gunfire'],
  [g.funnelSmoke,'update','smoke'],[g.shipWake,'update','wake'],[g,'shipTelemetry','telemetry'],
  [g.fleetViews[0].constructor.prototype,'updateMotion','hullPoses'],
  [g.fleetViews[0].constructor.prototype,'updateArticulation','jointPoses'],
  [g.fleetViews[0].constructor.prototype,'updateRenderMatrices','matrices'],
  [g.fleetViews[0].poseMatrices.constructor.prototype,'update','surfaceMatrices'],
  [g.fleetViews[0].impactMarks.constructor.prototype,'update','impactMarks'],
  [[...g.fleetDraws.proxies.values()][0].constructor.prototype,'update','renderProxies'],
  [g.fleetViews[0].rig.constructor.prototype,'update','rigging'],
  [g.hitLabels,'update','hitLabels'],[g.shipLabels,'update','shipLabels'],[g.gunAim,'update','aimIndicators'],
]) {
  const original=object[key], row=review.phases[label]={ms:0,calls:0};
  object[key]=function(...args) { const begin=performance.now(), result=original.apply(this,args); const done=value=>{row.ms+=performance.now()-begin;row.calls++;return value;};return result?.then?result.then(done):done(result); };
}
