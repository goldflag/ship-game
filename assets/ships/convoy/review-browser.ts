/** Browser-side integration review of the real game UI and renderer. */
export async function reviewInBrowser() {
  const reviewWindow = window as any;
  const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  async function until(predicate: () => boolean, label: string) {
    const start = performance.now();
    while (!predicate()) {
      if (performance.now() - start > 30000) throw new Error('Timed out: ' + label);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await frame();
  }
  function snapshot() {
    return { url: location.href, text: document.body.innerText,
      buttons: [...document.querySelectorAll('button')].map(b => ({
        name: b.getAttribute('aria-label') || b.textContent!.trim(), disabled: b.disabled,
      })) };
  }
  async function click(name: string) {
    const before = snapshot();
    if (!before.buttons.some(b => b.name === name && !b.disabled)) throw new Error('Missing control: ' + name);
    const button = [...document.querySelectorAll('button')].find(b =>
      b.getAttribute('aria-label') === name || b.textContent!.trim() === name)!;
    button.click(); await frame();
    return snapshot();
  }
  const diagnostic = () => reviewWindow.shipTrialDiagnostics();
  const ready = () => !!document.querySelector('.garage-ship-cards button:not(:disabled)');
  const captures: { label: string; data: string }[] = [];
  const roster = [
    ['flower-corvette', 'Flower Corvette'], ['liberty-cargo', 'Liberty Cargo'],
    ['liberty-collier', 'Liberty Collier'], ['victory-cargo', 'Victory Cargo'],
  ];
  function progress(label: string) {
    const endpoint = new URLSearchParams(location.search).get('result');
    if (endpoint) {
      const url = new URL(endpoint); url.pathname = '/progress';
      void fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }) });
    }
  }
  async function settleCamera() {
    let previous = diagnostic().camera.position, stable = 0;
    await until(() => {
      const position = diagnostic().camera.position;
      stable = Math.hypot(...position.map((v: number, i: number) => v - previous[i])) < .002 ? stable + 1 : 0;
      previous = position;
      return stable >= 5;
    }, 'camera settled');
  }
  async function capture(label: string) {
    await frame();
    const capture = { label, data: document.querySelector('canvas')!.toDataURL('image/jpeg', .9) };
    const endpoint = new URLSearchParams(location.search).get('result');
    if (endpoint) {
      const url = new URL(endpoint); url.pathname = '/capture';
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(capture) });
      if (!response.ok) throw new Error('Capture delivery failed: ' + label);
      captures.push({ label, data: '' });
    } else captures.push(capture);
  }
  const report = [];
  await until(ready, 'port ready');
  for (const [id, name] of roster) {
    await click('Inspect ' + name);
    await until(() => ready() && diagnostic().shipId === id &&
      document.querySelector(`[aria-label="Inspect ${name}"]`)?.getAttribute('aria-pressed') === 'true', 'select ' + id);
    await settleCamera();
    let d = diagnostic();
    if (!d.inPort || d.tick !== 0) throw new Error('Port not frozen: ' + id);
    const entry: any = { id, hash: d.contentHash, backend: d.backend, portFps: d.fps,
      initialTick: d.tick, portSnapshot: snapshot(), articulation: [] };
    await capture(id + '-port');
    for (const [train, elevation, recoil] of [[-1, 0, 0], [1, 1, 1]]) {
      reviewWindow.shipTrialArticulation({ trainFraction: train, elevationFraction: elevation, recoilFraction: recoil });
      await frame(); d = diagnostic();
      if (d.maxMuzzleErrorM > .025) throw new Error('Articulation mismatch: ' + id);
      entry.articulation.push({ train, elevation, recoil, maxMuzzleErrorM: d.maxMuzzleErrorM });
      await capture(id + (train < 0 ? '-depressed' : '-elevated'));
    }
    reviewWindow.shipTrialArticulation(null);
    entry.armorSnapshot = await click('Armor');
    if (diagnostic().portInspection !== 'armor') throw new Error('Armor control failed');
    await capture(id + '-armor');
    entry.internalsSnapshot = await click('Internals');
    if (diagnostic().portInspection !== 'internals') throw new Error('Internals control failed');
    const engine = [...document.querySelectorAll<HTMLButtonElement>('.port-volume-list button')]
      .find(b => /Triple-expansion|Geared steam turbine/.test(b.textContent!));
    if (!engine) throw new Error('No engine inspection row');
    await click(engine.getAttribute('aria-label') || engine.textContent!.trim());
    d = diagnostic();
    if (d.selectedVolume !== 'module:main-engine') throw new Error('Engine not isolated');
    entry.isolatedVolume = d.selectedVolume;
    entry.isolatedSnapshot = snapshot();
    await capture(id + '-internals');
    await click('Clear selection'); await click('Statistics');
    d = diagnostic();
    if (d.tick !== 0 || d.portInspection !== 'exterior' || d.selectedVolume) throw new Error('Inspection reset failed');
    entry.finalTick = d.tick; report.push(entry);
    progress(id + ': port, inspection and articulation passed');
  }

  if (new URLSearchParams(location.search).has('portOnly')) return { report, captures, battles: [] };
  const key = (code: string, down: boolean) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true, cancelable: true }));
  function tap(code: string) { key(code, true); key(code, false); }
  async function addShip(name: string, role: 'Friendly' | 'Enemy') {
    snapshot();
    const group = document.querySelector(`[aria-label="Add ${name}"]`);
    const button = [...(group?.querySelectorAll('button') ?? [])].find(b => b.textContent!.trim() === role) as HTMLButtonElement;
    if (!button || button.disabled) throw new Error('Missing roster action: ' + name + ' ' + role);
    button.click(); await frame(); snapshot();
  }
  async function configureBattle(id: string, name: string, mixed: boolean) {
    await click('Inspect ' + name);
    await until(() => ready() && diagnostic().shipId === id, 'battle player selection');
    await click('CUSTOM BATTLE');
    let remove: HTMLButtonElement | null;
    while ((remove = document.querySelector('.battle-roster button[aria-label^="Remove "]'))) {
      await click(remove.getAttribute('aria-label')!);
    }
    if (mixed) {
      for (const [otherId, otherName] of roster) {
        if (otherId !== id) await addShip(otherName, 'Friendly');
        await addShip(otherName, 'Enemy');
      }
    } else await addShip('Flower Corvette', 'Enemy');
    snapshot();
    const slider = document.querySelector<HTMLInputElement>('#battle-spawn-distance')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(slider, '1000');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
    await frame();
    if (slider.getAttribute('aria-valuetext') !== '1 kilometers') throw new Error('Spawn distance did not update');
    const setupSnapshot = snapshot();
    await click('Start battle');
    await until(() => !diagnostic().inPort && diagnostic().tick > 0, 'battle started');
    return setupSnapshot;
  }
  const battles = [];
  for (const [id, name, mixed] of [...roster.map(([id, name]) => [id, name, false] as const), ['flower-corvette', 'Flower Corvette', true] as const]) {
    progress(id + (mixed ? ': mixed fleet launch' : ': battle launch'));
    const setupSnapshot = await configureBattle(id, name, mixed);
    const initial = diagnostic();
    const expectedCount = mixed ? 8 : 2;
    if (initial.fleet.length !== expectedCount || initial.renderedShips.filter((s: any) => s.visible).length !== expectedCount) throw new Error('Fleet model count mismatch');
    for (let n = 0; n < 4; n++) tap('KeyW');
    tap(id === 'flower-corvette' ? 'Digit1' : 'Digit2');
    key('KeyD', true); key('KeyQ', true);
    await until(() => diagnostic().tick >= initial.tick + 300, 'underway and steering');
    key('KeyD', false);
    await until(() => diagnostic().tick >= initial.tick + 1200, 'twenty seconds of combat');
    key('KeyQ', false);
    const active = diagnostic();
    const player = active.fleet.find((a: any) => a.id === 'player');
    if (!(player.motion.speed > 0) || !(player.ammo < initial.fleet[0].ammo)) throw new Error('Player did not move/fire: ' + id);
    if (active.maxMuzzleErrorM > .025 || active.fleet.some((a: any) => !Object.values(a.motion).filter(v => typeof v === 'number').every(Number.isFinite))) throw new Error('Invalid active combat pose');
    if (mixed && !['friendly', 'enemy'].every(team => active.fleet.some((a: any, i: number) => a.controller === 'bot' && a.team === team && a.ammo < initial.fleet[i].ammo))) throw new Error('Both bot teams must fire');
    const label = mixed ? 'mixed-convoy' : id;
    await capture(label + '-battle');
    const battleSnapshot = snapshot();
    tap('Escape');
    await until(() => diagnostic().paused && !!document.querySelector('dialog[open]'), 'battle paused');
    await click('Return to port');
    await until(() => ready() && diagnostic().inPort && diagnostic().tick === 0, 'return to port');
    const reset = diagnostic();
    if (reset.events.length || reset.combat.playerWater || reset.combat.targetWater ||
      reset.fleet.some((a: any, i: number) => a.ammo !== initial.fleet[i].ammo || a.integrity !== initial.fleet[i].integrity) ||
      reset.renderedShips.some((s: any) => s.impactMarks)) throw new Error('Battle reset left damage or ammunition state');
    battles.push({ id, mixed, setupSnapshot, battleSnapshot, initial, active,
      reset: { tick: reset.tick, inPort: reset.inPort, fleet: reset.fleet, effects: reset.effects, events: reset.events, renderedShips: reset.renderedShips } });
    progress(label + ': underway, firing, pause and clean return passed');
  }
  return JSON.stringify({ report, captures, battles });
}
