// Self-contained so Playwright can serialize this into either production build.
export async function measureWindowsLive({ seconds = 30, warmup = 10 } = {}) {
  const g = window.review.game, frame = g.frame;
  const rows = [], counts = {};
  let start, startTick, previous, lastEvent = 0, maxAircraft = 0, maxShells = 0, hiddenFrames = 0;
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const begun = performance.now();
  g.frame = async function(time) {
    const beginWork = performance.now();
    await frame.call(this, time);
    const work = performance.now() - beginWork;
    if (time - begun < warmup * 1000) return;
    if (start === undefined) { start = time; startTick = g.simulation.tick; lastEvent = g.simulation.events.at(-1)?.sequence ?? 0; }
    if (previous !== undefined) rows.push({ interval: time - previous, work });
    previous = time;
    if (document.hidden) hiddenFrames++;
    maxAircraft = Math.max(maxAircraft, g.simulation.aircraft.filter(p => ['takeoff', 'outbound', 'attack', 'returning', 'landing'].includes(p.phase)).length);
    maxShells = Math.max(maxShells, g.simulation.shells.length);
    for (const event of g.simulation.events) if (event.sequence > lastEvent) {
      counts[event.kind] = (counts[event.kind] ?? 0) + 1; lastEvent = event.sequence;
    }
    if (time - start >= seconds * 1000) finish();
  };
  g.setPaused(false); g.lastTime = performance.now();
  g.scheduleFrame = g.constructor.prototype.scheduleFrame;
  g.scheduleFrame();
  try {
    await done;
    const stats = key => {
      const values = rows.map(row => row[key]).sort((a, b) => a - b);
      return { mean: values.reduce((sum, n) => sum + n, 0) / values.length, p50: values[Math.floor(values.length * .5)], p95: values[Math.floor(values.length * .95)], p99: values[Math.floor(values.length * .99)], max: values.at(-1) };
    };
    const elapsedMs = previous - start, simulationSeconds = (g.simulation.tick - startTick) / 60;
    const result = { complete: true, hiddenFrames, keptRealtime: Math.abs(simulationSeconds - elapsedMs / 1000) < .1,
      frames: rows.length, elapsedMs, fps: rows.length * 1000 / elapsedMs, intervalMs: stats('interval'), workMs: stats('work'),
      simulationSeconds, startTick, endTick: g.simulation.tick, ships: g.simulation.actors.length, maxAircraft, maxShells, events: counts,
      framebuffer: [g.renderer.domElement.width, g.renderer.domElement.height], audio: g.audio?.diagnostics(), userAgent: navigator.userAgent };
    document.querySelector('#performance-status').textContent = `${result.fps.toFixed(1)} FPS · ${maxAircraft} aircraft · ${seconds}s complete`;
    return window.review.result = result;
  } finally {
    g.scheduleFrame = () => {}; cancelAnimationFrame(g.raf); g.frame = frame;
    g.paused = true; g.audio?.setScene(false, true);
  }
}
