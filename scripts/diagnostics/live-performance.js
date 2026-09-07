// Isolated diagnostic entry: runs the real App, HUD, audio and Game animation loop.
import { Game } from '/src/game/Game.ts';
import { mixedSimulation, reviewHelm, reviewIntent } from './mixed-fleet.ts';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async predicate => { while (!predicate()) await delay(50); };
const start = Game.prototype.start;
const beginBattle = Game.prototype.setInPort;
let loaded = false, sailing = false;
Game.prototype.start = function () {
  window.review = { game: this, ready: false };
  this.settings = { quality: 'medium', sea: 'Fair', resolution: 1 };
  this.rig.capturePointer = () => {};
  const ready = this.callbacks.ready;
  this.callbacks.ready = () => { ready(); loaded = true; };
  return start.call(this);
};
Game.prototype.prepareBattle = async function () {
  const sim = mixedSimulation(30);
  await this.replaceFleet(sim, sim.definition);
  this.battleSea = 'Fair';
};
Game.prototype.setInPort = function (port) {
  beginBattle.call(this, port);
  if (!port) sailing = true;
};
await import('/src/main.tsx');
const style = document.createElement('style');
style.textContent = '.game-shell,.ocean-viewport{width:1280px!important;height:720px!important;right:auto!important;bottom:auto!important}#performance-status{position:fixed;left:16px;bottom:12px;z-index:99999;padding:8px;background:#09202de6;color:#d9eff2;font:13px monospace;pointer-events:none}';
document.head.append(style);
const status = document.createElement('output'); status.id = 'performance-status'; document.body.append(status);
status.textContent = 'Loading 60-ship benchmark…';
await until(() => loaded);
const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.toLowerCase().includes(text));
await until(() => button('custom battle')); button('custom battle').click();
await until(() => button('start battle')); button('start battle').click();
await until(() => sailing);
const g = window.review.game, schedule = g.scheduleFrame;
g.scheduleFrame = () => {}; cancelAnimationFrame(g.raf); await g.frameTask; cancelAnimationFrame(g.raf);
g.input.sample = () => reviewHelm;
g.input.setOrder(3); g.manualAim = true;
for (let i = g.simulation.tick; i < 3600; i++) {
  g.simulation.step(reviewHelm, reviewIntent);
  if (i % 60 === 0) await delay(0);
}
g.fleetViews.forEach(v => v.snap());
const rigUpdate = g.rig.update;
const setCamera = mode => {
  g.rig.update = rigUpdate;
  if (mode === 'battle') {
    const p = g.simulation.player.motion;
    g.rig.update = () => {};
    g.camera.position.set(p.x + 190, p.y + 100, p.z + 230);
    g.camera.lookAt(p.x, p.y + 5, p.z); g.camera.updateMatrixWorld();
  }
};
setCamera('battle');
g.paused = true; g.audio?.setScene(false, true); g.lastTime = performance.now(); await g.frame(performance.now());
window.review.ready = true; document.title = 'Fleet performance review — LIVE';
status.textContent = 'Ready · 60 ships · 1920×1080 · keep this tab visible';
window.review.run = async ({ seconds = 30, warmup = 5, camera = 'battle', profile = false } = {}) => {
  if (window.review.running) throw new Error('A live sample is already running');
  window.review.running = true;
  const rows = [], counts = {}, frame = g.frame;
  let previous, startTime, startTick, lastSequence = g.simulation.events.at(-1)?.sequence ?? 0;
  let maxAircraft = 0, maxShells = 0, focusFrames = 0, hiddenFrames = 0, interrupted = false;
  const phases = {}, restores = [];
  if (profile) for (const [object, key, label] of [
    [g.simulation, 'advance', 'simulation'], [g, 'readSightAim', 'sight'], [g.water, 'update', 'water'],
    [g, 'renderFrame', 'mainRender'], [g.effects, 'update', 'effects'], [g.aircraftView, 'update', 'aircraft'],
    [g.fleetDraws, 'update', 'fleetDraws'], [g.shipLabels, 'update', 'labels'], [g.audio, 'update', 'audio'],
    [g.fleetViews[0].constructor.prototype, 'update', 'shipPoses'],
    [g.fleetViews[0].root.constructor.prototype, 'updateMatrixWorld', 'shipMatrices'],
    [g.fleetViews[0].impactMarks.constructor.prototype, 'update', 'marks'],
  ]) {
    if (!object) continue;
    const original = object[key], row = phases[label] = { ms: 0, calls: 0 };
    object[key] = function (...args) {
      const start = performance.now(), value = original.apply(this, args);
      const done = result => { if (startTime !== undefined) { row.ms += performance.now() - start; row.calls++; } return result; };
      return value?.then ? value.then(done) : done(value);
    };
    restores.push(() => object[key] = original);
  }
  setCamera(camera);
  g.setPaused(false);
  let finish;
  const done = new Promise(resolve => finish = resolve);
  const begun = performance.now();
  g.frame = async function (time) {
    const cpuStart = performance.now();
    await frame.call(this, time);
    const cpuEnd = performance.now();
    if (time - begun < warmup * 1000) return;
    if (startTime === undefined) { startTime = time; startTick = g.simulation.tick; lastSequence = g.simulation.events.at(-1)?.sequence ?? 0; }
    if (previous !== undefined) rows.push({ interval: time - previous, work: cpuEnd - cpuStart, time });
    if (previous !== undefined && time - previous > 250 && cpuEnd - cpuStart < 100) interrupted = true;
    previous = time;
    if (document.hasFocus()) focusFrames++;
    if (document.hidden) hiddenFrames++;
    maxAircraft = Math.max(maxAircraft, g.simulation.aircraft.filter(p => ['takeoff','outbound','attack','returning','landing'].includes(p.phase)).length);
    maxShells = Math.max(maxShells, g.simulation.shells.length);
    for (const event of g.simulation.events) if (event.sequence > lastSequence) {
      counts[event.kind] = (counts[event.kind] ?? 0) + 1; lastSequence = event.sequence;
    }
    status.textContent = `${(rows.length * 1000 / Math.max(1, time - startTime)).toFixed(1)} FPS · ${maxAircraft} aircraft · ${maxShells} shells · ${((time - startTime) / 1000).toFixed(0)}/${seconds}s`;
    if (interrupted || time - startTime >= seconds * 1000) finish();
  };
  g.lastTime = performance.now(); g.scheduleFrame = schedule; schedule.call(g);
  try {
    await done;
    const sorted = key => rows.map(r => r[key]).sort((a, b) => a - b);
    const stats = values => ({ mean: values.reduce((a, b) => a + b, 0) / values.length, p50: values[Math.floor(values.length * .5)], p95: values[Math.floor(values.length * .95)], p99: values[Math.floor(values.length * .99)], max: values.at(-1) });
    const elapsed = previous - startTime;
    const buckets = new Map();
    for (const row of rows) {
      const index = Math.floor((row.time - startTime) / 5000);
      const bucket = buckets.get(index) ?? { seconds: 0, frames: 0 };
      bucket.seconds += row.interval / 1000; bucket.frames++; buckets.set(index, bucket);
    }
    const windows = [...buckets.values()].filter(b => b.seconds > 1).map(b => ({ ...b, fps: b.frames / b.seconds }));
    return window.review.result = { interrupted, valid: !interrupted && hiddenFrames === 0 && Math.abs((g.simulation.tick - startTick) / 60 - elapsed / 1000) < .1, windows, production: import.meta.env.PROD, phases: profile ? Object.fromEntries(Object.entries(phases).map(([label, row]) => [label, { msPerFrame: row.ms / rows.length, callsPerFrame: row.calls / rows.length }])) : undefined, frames: rows.length, elapsedMs: elapsed, fps: rows.length * 1000 / elapsed, intervalMs: stats(sorted('interval')), workMs: stats(sorted('work')), over20Ms: rows.filter(r => r.interval > 20).length, simulationSeconds: (g.simulation.tick - startTick) / 60, startTick, endTick: g.simulation.tick, ships: g.simulation.actors.length, maxAircraft, maxShells, events: counts, focusFrames, hiddenFrames, framebuffer: [g.renderer.domElement.width, g.renderer.domElement.height], camera, hud: !!document.querySelector('.fleet-hud'), audio: g.audio?.diagnostics(), userAgent: navigator.userAgent };
  } finally {
    restores.reverse().forEach(restore => restore());
    g.scheduleFrame = () => {}; cancelAnimationFrame(g.raf); g.frame = frame; g.paused = true; g.audio?.setScene(false, true); window.review.running = false;
    status.textContent = interrupted ? 'Interrupted: browser throttled · keep tab visible and click Run' : status.textContent + ' · finished';
  }
};

const runButton = document.createElement('button');
runButton.textContent = 'Run 60 FPS check';
runButton.style.cssText = 'position:fixed;right:16px;top:16px;z-index:99999;padding:10px 14px;background:#0d2a38;color:#d9eff2;border:1px solid #72929e;cursor:pointer';
document.body.append(runButton);
let automatic = true;
const launch = async () => {
  if (window.review.running) return;
  automatic = false; runButton.hidden = true;
  try { const params = new URLSearchParams(location.search); await window.review.run({seconds:Number(params.get('seconds') ?? 30),warmup:10,camera:params.get('camera') ?? 'battle',profile:params.has('profile')}); }
  catch (error) { status.textContent = String(error); window.review.error = String(error); }
  finally { runButton.hidden = false; }
};
runButton.addEventListener('click', () => location.reload());
let lastVisibleFrame, consecutive = 0;
const awaitVisible = time => {
  if (!automatic) return;
  consecutive = !document.hidden && lastVisibleFrame !== undefined && time - lastVisibleFrame < 150 ? consecutive + 1 : 0;
  lastVisibleFrame = time;
  if (consecutive >= 5) void launch(); else requestAnimationFrame(awaitVisible);
};
requestAnimationFrame(awaitVisible);
