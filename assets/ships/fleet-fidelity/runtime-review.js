/* Development-only review harness, executed through Orca in our localhost page.
 * No production hooks or network writes. Reload removes the helper. UI actions
 * still own ship selection, launch, battery controls and return-to-port.
 */
(async () => {
  const { localToWorld, rotate } = await import('/src/simulation/geometry.ts');
  let game;
  // Vite may keep a timestamped module identity after definition HMR.
  const modules = [...new Set(performance.getEntriesByType('resource').map(e => e.name).filter(name => {
    const url = new URL(name); return url.origin === location.origin && url.pathname === '/src/game/Game.ts';
  }))].reverse();
  for (const url of modules) {
    const { Game } = await import(url), original = Game.prototype.diagnostics;
    try {
      Game.prototype.diagnostics = function () { game = this; return original.call(this); };
      window.shipTrialDiagnostics();
    } finally { Game.prototype.diagnostics = original; }
    if (game) break;
  }
  if (!game) throw new Error('Loaded development session required');
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const log = window.fleetFidelityReview?.log ?? [];
  const record = (kind, details) => {
    const d = game.diagnostics();
    const row = { kind, shipId: d.shipId, contentHash: d.contentHash, backend: d.backend, time: new Date().toISOString(), ...details };
    log.push(row); return row;
  };
  window.fleetFidelityReview = {
    log,
    async poses() {
      if (!game.inPort) throw new Error('Return to port before articulation review');
      const poses = [];
      for (const trainFraction of [-1, 0, 1]) for (const elevationFraction of [0, 1]) for (const recoilFraction of [0, 1]) {
        game.previewArticulation({ trainFraction, elevationFraction, recoilFraction });
        await frame();
        const d = game.diagnostics();
        if (d.maxMuzzleErrorM > .025) throw new Error('Rendered muzzle/CPU mismatch');
        poses.push({ trainFraction, elevationFraction, recoilFraction, maxMuzzleErrorM: d.maxMuzzleErrorM });
      }
      game.previewArticulation(null);
      return record('articulation', { mounts: game.definition.mounts.length, poses });
    },
    async camera(azimuth = 1.05, elevation = .28, distance = 345) {
      Object.assign(game.rig, { azimuth, elevation, distance });
      const focus = game.inspecting ? game.targetView.motion : game.playerView.motion;
      game.rig.update(focus, focus.y, 0, true);
      await frame();
      return { shipId: game.definition.id, camera: game.diagnostics().camera.position };
    },
    async hover() {
      const canvas = game.renderer.domElement, rect = canvas.getBoundingClientRect();
      if (game.playerView.inspection.mode !== 'armor') throw new Error('Select Armor in the port UI first');
      for (let y = .3; y < .76; y += .035) for (let x = .24; x < .76; x += .035) {
        const clientX = rect.left + x * rect.width, clientY = rect.top + y * rect.height;
        if (document.elementFromPoint(clientX, clientY) !== canvas) continue;
        canvas.dispatchEvent(new PointerEvent('pointermove', { clientX, clientY, pointerType: 'mouse', bubbles: true }));
        game.armorHover.update(game.playerView.inspection);
        const hovered = game.diagnostics().hoveredArmor;
        if (hovered) { await frame(); return record('armor-hover', { hovered, clientX, clientY, tooltip: document.getElementById('port-armor-tooltip')?.textContent }); }
      }
      throw new Error('No visible armor hit in canvas review grid');
    },
    selection() {
      const d = game.diagnostics();
      return record('inspection-selection', { mode: d.portInspection, selected: d.selectedVolume, hovered: d.hoveredArmor });
    },
    async shot(victimId, localFrom, localTo, penetrationMm = 2200) {
      if (game.inPort || game.paused) throw new Error('Launch and resume a battle first');
      const sim = game.simulation, victim = sim.actors.find(a => a.motion.id === victimId);
      if (!victim) throw new Error('Unknown actor');
      const before = victim.damage.integrity, firstTick = sim.tick;
      const delta = localTo.map((n, i) => n - localFrom[i]);
      const speed = 1200, length = Math.hypot(...delta);
      const shellId = 900000 + firstTick;
      sim.shells.push({ id: shellId, ownerId: sim.player.motion.id, position: localToWorld(localFrom, victim.motion), velocity: rotate(delta.map(n => n / length * speed), victim.motion), age: 0, penetrationMm, damage: 35, caliberM: .2032, visited: [] });
      await sleep(350);
      const events = sim.events.filter(e => e.tick >= firstTick && e.shipId === victimId);
      return record('seeded-live-swept-shot', { victimId, victimDefinition: victim.definition.id, localFrom, localTo, before, after: victim.damage.integrity, events, effects: game.effects.diagnostics(), water: victim.damage.compartments.reduce((n, c) => n + c.waterM3, 0), muzzleErrorM: game.diagnostics().maxMuzzleErrorM });
    },
    async firing(battery) {
      const start = performance.now(), before = game.diagnostics().combat.batteries.find(b => b.battery === battery)?.ammo;
      while (performance.now() - start < 15000) {
        const d = game.diagnostics();
        if (d.combat.battery !== battery) throw new Error('Select the battery in the UI first');
        if (d.combat.ready) {
          const button = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label')?.startsWith('Fire aligned guns'));
          if (!button || button.disabled) { await sleep(100); continue; }
          button.click(); await sleep(700);
          const after = game.diagnostics();
          return record('UI-battery-fire', { battery, before, after: after.combat.batteries.find(b => b.battery === battery)?.ammo, events: after.events, effects: after.effects, muzzleErrorM: after.maxMuzzleErrorM });
        }
        await sleep(100);
      }
      throw new Error('No aligned battery within 15 seconds');
    },
    diagnostics: () => game.diagnostics(),
    capture() {
      // Capture the live renderer when the desktop host cannot screenshot an
      // inactive tab. This is the actual game canvas, without the HTML HUD.
      game.renderFrame();
      return game.renderer.domElement.toDataURL('image/png');
    },
    async settled() { await sleep(1000); return record('settled-state', { diagnostics: game.diagnostics() }); },
    // Deliberate test deployment. No damage state is edited; seeded shots above
    // still travel through the live CPU simulation and normal effect pipeline.
    broadside() {
      const sim = game.simulation;
      for (const actor of sim.actors) { actor.controller = actor === sim.player ? 'player' : 'idle'; actor.motion.speed = 0; }
      Object.assign(sim.player.motion, { heading: Math.PI / 2, speed: 0, x: 0, z: 0 });
      game.input.setOrder(1); game.input.setRudder(0); // Engine order index 1 is STOP.
      game.selectAim(''); game.rig.aimAt(sim.aimAt('', game.battery), sim.ship);
      game.fleetViews.forEach(v => v.snap());
      return record('seeded-broadside-deployment', { fleet: game.diagnostics().fleet });
    },
  };
  return { ready: true, shipId: game.definition.id, contentHash: game.definition.contentHash };
})()
