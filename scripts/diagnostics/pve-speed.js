// Actual fleet-command UI, local worker and rendering. Temporary results belong in .build/.
import { Game } from '/src/game/Game.ts';
import { PveDraft } from '/src/game/session/PveDraft.ts';
import { pveSpeedScenario } from './pve-speed-scenario.ts';
const params = new URLSearchParams(location.search);
const speed = Number(params.get('speed') ?? 4), seconds = Number(params.get('seconds') ?? 120);
const scenario = params.get('scenario') ?? 'surface';
if (![1, 2, 4].includes(speed) || !Number.isFinite(seconds) || seconds < 10 || seconds > 1800
  || !['surface', 'carrier'].includes(scenario)) throw new Error('Use speed 1/2/4, seconds 10..1800, scenario surface/carrier.');
const request = pveSpeedScenario(scenario);
const review = window.review = { ready: false, windows: [], worker: [], errors: [] };
window.addEventListener('error', event => review.errors.push(event.message));
window.addEventListener('unhandledrejection', event => review.errors.push(String(event.reason)));
if (params.has('profile')) {
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (message, ...args) {
    if (message?.type === 'plan') {
      message = { ...message, profile: true };
      this.addEventListener('message', event => { if (event.data.timing) review.worker.push(event.data.timing); });
    }
    return post.call(this, message, ...args);
  };
}
const create = PveDraft.create, start = Game.prototype.start, begin = Game.prototype.beginBattle, frame = Game.prototype.frame;
PveDraft.create = function (_, signal) { return create.call(this, request, signal); };
let loaded = false, begun = 0, previous, windowStart = 0, windowTick = 0, firstTick = 0, rows = [];
Game.prototype.start = function () {
  review.game = this;
  this.settings = { ...this.settings, quality: params.get('quality') ?? 'high', resolution: 1 };
  this.rig.capturePointer = () => {};
  const ready = this.callbacks.ready;
  this.callbacks.ready = () => { ready(); loaded = true; };
  return start.call(this);
};
Game.prototype.beginBattle = async function (...args) {
  await begin.apply(this, args);
  this.simulation.setSimulationSpeed(speed);
  begun = windowStart = performance.now(); firstTick = windowTick = this.simulation.tick; review.ready = true;
};
Game.prototype.frame = async function (time, warmingUp) {
  const before = performance.now();
  await frame.call(this, time, warmingUp);
  if (!begun || warmingUp || review.result) return;
  if (previous !== undefined) rows.push({ interval: time - previous, work: performance.now() - before });
  previous = time;
  const done = time - begun >= seconds * 1000 || this.simulation.result !== 'active';
  if (time - windowStart >= 10000 || done) {
    const elapsed = (time - windowStart) / 1000;
    const intervals = rows.map(r => r.interval).sort((a, b) => a - b);
    review.windows.push({ wallSeconds: (time - begun) / 1000, simulatedSeconds: (this.simulation.tick - firstTick) / 60,
      achievedSpeed: (this.simulation.tick - windowTick) / 60 / elapsed, fps: rows.length / elapsed,
      p95Ms: intervals[Math.floor(intervals.length * .95)], maxMs: intervals.at(-1),
      meanWorkMs: rows.reduce((n, r) => n + r.work, 0) / Math.max(1, rows.length) });
    windowStart = time; windowTick = this.simulation.tick; rows = [];
  }
  if (done) {
    review.result = { request, requestedSpeed: speed, elapsedSeconds: (time - begun) / 1000,
      achievedSpeed: (this.simulation.tick - firstTick) / 60 / ((time - begun) / 1000), windows: review.windows,
      quality: this.settings.quality, framebuffer: [this.renderer.domElement.width, this.renderer.domElement.height],
      backend: this.water.backend, tick: this.simulation.tick, outcome: this.simulation.result, hidden: document.hidden };
    this.paused = true;
  }
};
await import('/src/main.tsx');
async function wait(predicate) {
  const deadline = performance.now() + 240000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error('Fleet speed diagnostic setup timed out.');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}
const button = name => [...document.querySelectorAll('button')].find(b => b.textContent.trim().toLowerCase() === name);
await wait(() => loaded && button('battle') && !button('battle').disabled); button('battle').click();
await wait(() => document.querySelector('[role="tab"]'));
[...document.querySelectorAll('[role="tab"]')].find(b => b.textContent.trim().toLowerCase() === 'fleet command').click();
await wait(() => button('deploy fleet') && !button('deploy fleet').disabled); button('deploy fleet').click();
await wait(() => button('start battle') && !button('start battle').disabled); button('start battle').click();
