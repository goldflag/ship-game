/** Repeatable effect scenes for `scripts/browser/effects-review.ts`. Each scene resets the stage, stages
 * events, fires or motion, and captures a labelled sequence. The default battle is Bismarck (ship 0,
 * at the origin, bow toward −Z) against a static Bismarck (ship 1) 1.5 km off her starboard beam.
 * Ship-local camera offsets: +X starboard, +Y up, −Z toward the bow. Add scenes freely. */
import type { EffectsStage, Frame } from './effectsStage';

type Shoot = (label?: string) => Promise<void>;
export type Scene = (stage: EffectsStage, shoot: Shoot) => Promise<void>;

/** Advance to each absolute time and capture it. */
async function timeline(stage: EffectsStage, shoot: Shoot, times: number[], prefix = ''): Promise<void> {
  for (const time of times) {
    stage.advance(Math.max(0, time - stage.elapsed));
    await shoot(`${prefix}${time.toFixed(2)} s`);
  }
}

export const scenes: Record<string, Scene> = {
  /** Main-battery broadside from the firing ship's disengaged quarter. */
  async muzzle(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 15 });
    stage.aim(0, 1, 4, 'main');
    stage.camera({ ship: 0, offset: [-150, 42, 150], look: [70, 14, -35], fov: 50 });
    stage.fire(0);
    await timeline(stage, shoot, [.03, .1, .25, .6, 1.5, 3, 5, 8, 12]);
  },
  /** The same broadside seen from 3 km, as a spectator on another ship would. */
  async 'muzzle-far'(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 15 });
    stage.aim(0, 1, 6, 'main');
    stage.camera({ ship: 0, offset: [-1800, 120, 2400], look: [0, 20, 0], fov: 18 });
    stage.fire(0);
    await timeline(stage, shoot, [.05, .3, 1, 3, 6, 10]);
  },
  /** A single turret, close enough to read the blast shape. */
  async 'muzzle-turret'(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 15 });
    stage.aim(0, 1, 3, 'main');
    stage.camera({ ship: 0, offset: [-60, 30, -140], look: [60, 12, -60], fov: 55 });
    stage.fire(0, { mounts: [0] });
    await timeline(stage, shoot, [.02, .06, .12, .25, .5, 1, 2, 4, 7]);
  },
  /** Night broadside: the flash must light the ship, the sea and its own smoke. */
  async 'muzzle-night'(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 23 });
    stage.aim(0, 1, 4, 'main');
    stage.camera({ ship: 0, offset: [-150, 42, 150], look: [70, 14, -35], fov: 50 });
    stage.fire(0);
    await timeline(stage, shoot, [.03, .1, .3, 1, 3, 6]);
  },
  /** Three armour-piercing hits and a ricochet along the target's engaged side. */
  async hit(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 15 });
    stage.camera({ ship: 1, offset: [stage.facing() * 230, 40, 110], look: [0, 10, -10], fov: 45 });
    stage.hit(1, { kind: 'penetration', along: .62, height: 4 });
    stage.advance(.35); stage.hit(1, { kind: 'penetration', along: .4, height: 7, caliberM: .2 });
    stage.advance(.35); stage.hit(1, { kind: 'ricochet', along: .78, height: 5 });
    stage.advance(.3); stage.hit(1, { kind: 'stopped', along: .5, height: 2.5 });
    await timeline(stage, shoot, [1.02, 1.1, 1.3, 1.7, 2.5, 4, 6, 9, 14]);
  },
  /** One heavy penetration, close enough to read the fireball, sparks and scar. */
  async 'hit-close'(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 15 });
    const side = stage.facing();
    stage.camera({ ship: 1, offset: [side * 85, 16, -10], look: [0, 6, -30], fov: 50 });
    stage.hit(1, { kind: 'penetration', along: .62, height: 4 });
    await timeline(stage, shoot, [.02, .06, .12, .25, .5, 1, 2, 4, 7]);
  },
  /** High-explosive bursts on the superstructure and deck. */
  async he(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 15 });
    stage.camera({ ship: 1, offset: [stage.facing() * 230, 40, 110], look: [0, 10, -10], fov: 45 });
    stage.hit(1, { kind: 'burst', along: .55, height: 12 });
    stage.advance(.4); stage.hit(1, { kind: 'burst', along: .35, height: 6, caliberM: .15 });
    await timeline(stage, shoot, [.45, .55, .8, 1.3, 2.5, 4, 7, 10]);
  },
  /** Magazine ignition: the largest single event in a battle. */
  async magazine(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 15 });
    stage.camera({ ship: 1, offset: [stage.facing() * 900, 90, 350], look: [0, 60, 0], fov: 40 });
    stage.hit(1, { kind: 'magazine' });
    await timeline(stage, shoot, [.05, .2, .5, 1, 2, 4, 8, 14, 22]);
  },
  /** An established fire: vented compartments and two burning turrets, close and at range. */
  async fire(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 15 });
    stage.burn(1, { rooms: 3, mounts: [0, 3], intensity: 1 });
    stage.camera({ ship: 1, offset: [-200, 50, 140], look: [0, 12, -10], fov: 45 });
    stage.advance(25); await shoot('close 25 s');
    stage.camera({ ship: 1, offset: [-120, 30, -90], look: [0, 14, -60], fov: 45 }); await shoot('turret 25 s');
    stage.camera({ ship: 1, offset: [-1600, 120, 900], look: [0, 40, 0], fov: 25 }); await shoot('1.8 km 25 s');
    stage.camera({ ship: 1, offset: [-7000, 220, 3500], look: [0, 60, 0], fov: 8 }); await shoot('8 km 25 s');
    stage.burn(1, { rooms: 3, mounts: [0, 3], intensity: .35, trend: 'contained', suppressed: true });
    stage.camera({ ship: 1, offset: [-200, 50, 140], look: [0, 12, -10], fov: 45 });
    stage.advance(10); await shoot('being fought +10 s');
    stage.burn(1, { rooms: 3, mounts: [0, 3], intensity: 0, trend: 'cooling' });
    stage.advance(10); await shoot('cooling +10 s');
  },
  /** The same fire at dusk and at night, where its light matters most. */
  async 'fire-night'(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 18.4 });
    stage.burn(1, { rooms: 3, mounts: [0, 3], intensity: 1 });
    stage.camera({ ship: 1, offset: [-200, 50, 140], look: [0, 12, -10], fov: 45 });
    stage.advance(25); await shoot('dusk');
    stage.weather({ timeHours: 23 }); await shoot('night');
    stage.camera({ ship: 1, offset: [-1600, 120, 900], look: [0, 40, 0], fov: 25 }); await shoot('night 1.8 km');
  },
  /** Funnel exhaust at full ahead and at slow speed, from the chase view and at range. */
  async funnel(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 15 });
    stage.underway(0, 1);
    stage.camera({ ship: 0, offset: [-140, 55, 190], look: [0, 18, -20], fov: 50 });
    stage.advance(30); await shoot('full ahead, chase');
    stage.camera({ ship: 0, offset: [-60, 40, 40], look: [0, 30, 0], fov: 55 }); await shoot('full ahead, funnel');
    stage.camera({ ship: 0, offset: [-900, 80, 300], look: [0, 25, 150], fov: 30 }); await shoot('full ahead, 1 km beam');
    stage.camera({ ship: 0, offset: [-5000, 160, 2500], look: [0, 30, 600], fov: 9 }); await shoot('full ahead, 5.6 km');
    stage.reset(); stage.weather({ timeHours: 15 });
    stage.underway(0, .25);
    stage.camera({ ship: 0, offset: [-140, 55, 190], look: [0, 18, -20], fov: 50 });
    stage.advance(30); await shoot('quarter ahead, chase');
    stage.weather({ timeHours: 18.4 }); await shoot('quarter ahead, dusk');
    stage.weather({ timeHours: 23 }); await shoot('quarter ahead, night');
  },
  /** GPU cost of a busy moment: two broadsides in the air, hits, three fires and both ships underway. */
  async perf(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 15 });
    stage.burn(1, { rooms: 3, mounts: [0, 3], intensity: 1 });
    stage.underway(0, 1); stage.underway(1, .6);
    stage.camera({ ship: 0, offset: [-140, 55, 190], look: [60, 18, -20], fov: 50 });
    stage.advance(20);
    stage.note('idle', await stage.measure());
    stage.aim(0, 1, 4, 'main'); stage.aim(1, 0, 4, 'main');
    stage.fire(0); stage.fire(1); stage.advance(.3);
    for (let i = 0; i < 4; i++) { stage.hit(1, { kind: 'penetration', along: .2 + i * .2 }); stage.hit(0, { kind: 'burst', from: 1, along: .3 + i * .15, height: 8 }); }
    stage.advance(.5);
    stage.note('broadsides and hits', await stage.measure());
    await shoot('busy');
  },
  /** Funnel exhaust underway: close, toward the sun, from the beam and at range, then dusk and night. */
  async 'b-funnel'(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 15, windSpeed: 7, windDirection: 60 });
    stage.underway(0, 1);
    stage.camera({ ship: 0, offset: [-140, 55, 190], look: [0, 22, -20], fov: 50 });
    stage.advance(40); await shoot('full, chase');
    stage.camera({ ship: 0, offset: [-45, 34, 30], look: [0, 30, 10], fov: 60 }); await shoot('full, at the funnel');
    stage.camera({ ship: 0, offset: [150, 40, -120], look: [0, 35, 150], fov: 55 }); await shoot('full, from ahead');
    stage.camera({ ship: 0, offset: [-900, 80, 300], look: [0, 30, 250], fov: 30 }); await shoot('full, 1 km beam');
    stage.camera({ ship: 0, offset: [-4200, 140, 2600], look: [0, 30, 700], fov: 10 }); await shoot('full, 5 km');
    stage.weather({ timeHours: 18.4 });
    stage.camera({ ship: 0, offset: [-140, 55, 190], look: [0, 22, -20], fov: 50 }); await shoot('full, dusk');
    stage.weather({ timeHours: 23 }); await shoot('full, night');
    stage.reset(); stage.weather({ timeHours: 15, windSpeed: 7, windDirection: 60 });
    stage.camera({ ship: 0, offset: [-140, 55, 190], look: [0, 22, -20], fov: 50 });
    stage.advance(40); await shoot('stopped');
    stage.underway(0, .3); stage.advance(40); await shoot('slow ahead');
  },
  /** The plume ribbon alone (billows hidden), stopped and underway, for spotting ribbon artifacts. */
  async 'b-ribbon'(stage, shoot) {
    const exhaust = (stage.game as unknown as { funnelSmoke: { root: { children: { layers: { set(layer: number): void } }[] } } }).funnelSmoke;
    for (const speed of [0, .5]) {
      stage.reset(); stage.weather({ timeHours: 15, windSpeed: 7, windDirection: 60 });
      if (speed) stage.underway(0, speed);
      stage.advance(50);
      exhaust.root.children[1].layers.set(31);
      stage.camera({ ship: 0, offset: [-260, 60, 260], look: [0, 30, 60], fov: 55 }); await shoot(`ribbon only, ${speed ? 'half ahead' : 'stopped'}`);
      exhaust.root.children[1].layers.set(0); await shoot(`with billows, ${speed ? 'half ahead' : 'stopped'}`);
    }
  },
  /** Looking toward the sun through the plume: backlit edges should glow, the core stay dark. */
  async 'b-sun'(stage, shoot) {
    for (const hours of [9, 17.2]) {
      stage.reset(); stage.weather({ timeHours: hours, windSpeed: 7, windDirection: 60 });
      stage.underway(0, .7); stage.advance(40);
      const g = stage.game as unknown as { effectLighting: { sunDirection: { value: { x: number; y: number; z: number } } }; fleetViews: { actor: { motion: { x: number; z: number } } }[] };
      const sun = g.effectLighting.sunDirection.value, ship = g.fleetViews[0].actor.motion;
      const horizontal = Math.hypot(sun.x, sun.z) || 1, target: [number, number, number] = [ship.x, 45, ship.z + 120];
      stage.camera({ position: [target[0] - sun.x / horizontal * 320, 40, target[2] - sun.z / horizontal * 320], target: [target[0] + sun.x / horizontal * 100, 45 + sun.y * 60, target[2] + sun.z / horizontal * 100], fov: 55 });
      await shoot(`toward the sun, ${hours} h`);
    }
  },
  /** Strong wind on the beam: the plume must lie over and stream to leeward. */
  async 'b-crosswind'(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 11, windSpeed: 16, windDirection: 0 });
    stage.underway(0, .6);
    stage.camera({ ship: 0, offset: [-260, 70, 260], look: [0, 25, 0], fov: 50 });
    stage.advance(40); await shoot('16 m/s beam wind');
    stage.camera({ ship: 0, offset: [-1400, 200, 900], look: [0, 30, 200], fov: 30 }); await shoot('from 1.7 km');
  },
  /** Working up from stop to full, then turning: a sooty burst and a curved trail. */
  async 'b-workup'(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 13, windSpeed: 5, windDirection: 90 });
    stage.camera({ ship: 0, offset: [-200, 60, 220], look: [0, 22, -20], fov: 50 });
    stage.advance(15);
    // Smooth acceleration, as the simulation reports it tick by tick.
    for (let i = 1; i <= 100; i++) { stage.underway(0, i / 100); stage.advance(.12); }
    await shoot('working up (12 s)');
    stage.advance(15); await shoot('full, settled');
    const ship = (stage.game as unknown as { fleetViews: { actor: { motion: { heading: number } } }[] }).fleetViews[0].actor;
    for (let i = 0; i < 300; i++) { ship.motion.heading += .0045; stage.advance(.1); }
    stage.camera({ ship: 0, offset: [-500, 380, 500], look: [0, 20, 200], fov: 50 }); await shoot('after a 77° turn');
  },
  /** Damaged boilers: black smoke at half power. */
  async 'b-damaged'(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 15, windSpeed: 7, windDirection: 60 });
    const actor = (stage.game as unknown as { fleetViews: { actor: { damage: { modules: { hp: number }[] } }; definition: { modules: { role?: string; kind?: string }[] } }[] }).fleetViews[0];
    const saved = actor.actor.damage.modules.map(m => m.hp);
    actor.definition.modules.forEach((m, i) => { if (m.role === 'boiler' || m.kind === 'engine' || m.role === 'engine') actor.actor.damage.modules[i].hp *= .3; });
    const { systemHealth } = await import('../../src/game/machinery');
    stage.note('engine power', systemHealth(actor.actor as never, actor.definition as never, 'engine'));
    stage.underway(0, .5);
    stage.camera({ ship: 0, offset: [-140, 55, 190], look: [0, 22, -20], fov: 50 });
    stage.advance(40); await shoot('damaged boilers, half ahead');
    stage.camera({ ship: 0, offset: [-900, 80, 300], look: [0, 30, 250], fov: 30 }); await shoot('damaged, 1 km');
    actor.actor.damage.modules.forEach((m, i) => { m.hp = saved[i]; });
  },
  /** Where the exhaust's GPU time goes: billows and ribbon toggled frame by frame in one session. Under GPU
   * contention (other browsers rendering) compare the low percentiles, not medians. */
  async 'b-cost'(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 15, windSpeed: 7, windDirection: 60 });
    stage.underway(0, 1); stage.underway(1, .6);
    stage.camera({ ship: 0, offset: [-140, 55, 190], look: [60, 22, -20], fov: 50 });
    stage.advance(60);
    const exhaust = (stage.game as unknown as { funnelSmoke: { root: { children: { layers: { set(layer: number): void } }[] } } }).funnelSmoke;
    const [ribbon, billows] = exhaust.root.children;
    const cases: Record<string, [boolean, boolean]> = { none: [false, false], ribbon: [true, false], billows: [false, true], both: [true, true] };
    // Interleave cases frame by frame; under GPU contention the low percentiles approximate the true cost.
    const g = stage.game as unknown as { renderer: { backend: { trackTimestamp: boolean }; info: { autoReset: boolean; reset(): void }; resolveTimestampsAsync(kind: string): Promise<number | undefined>; _nodes: { nodeFrame: { update(): void } } }; renderFrame(): void };
    await stage.render();
    g.renderer.backend.trackTimestamp = true;
    const samples: Record<string, number[]> = {};
    for (let i = 0; i < 400; i++) {
      const [name, [r, b]] = Object.entries(cases)[i % 4];
      ribbon.layers.set(r ? 0 : 31); billows.layers.set(b ? 0 : 31);
      g.renderer._nodes.nodeFrame.update(); g.renderFrame();
      const time = await g.renderer.resolveTimestampsAsync('render');
      if (i >= 40 && typeof time === 'number') (samples[name] ??= []).push(time);
    }
    ribbon.layers.set(0); billows.layers.set(0);
    const pct = (values: number[], q: number) => { const v = [...values].sort((a, b) => a - b); return +v[Math.floor((v.length - 1) * q)].toFixed(3); };
    stage.note('GPU ms min / p10 / p50', Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, [pct(v, 0), pct(v, .1), pct(v, .5)]])));
    await shoot('cost frame');
  },
  /** Viewport depth copies per rendered frame with the exhaust hidden and shown (each can split a render pass). */
  async 'b-copies'(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 15, windSpeed: 7, windDirection: 60 });
    stage.underway(0, 1); stage.advance(30);
    stage.camera({ ship: 0, offset: [-140, 55, 190], look: [60, 22, -20], fov: 50 });
    const g = stage.game as unknown as { renderer: Record<string, (...args: unknown[]) => unknown>; funnelSmoke: { root: { children: { layers: { set(layer: number): void } }[] } } };
    let copies = 0;
    const original = g.renderer.copyFramebufferToTexture.bind(g.renderer);
    g.renderer.copyFramebufferToTexture = (...args: unknown[]) => { copies++; return original(...args); };
    const count = async (shown: boolean) => {
      g.funnelSmoke.root.children.forEach(child => child.layers.set(shown ? 0 : 31));
      await stage.render(); copies = 0; await stage.render(); return copies;
    };
    stage.note('depth copies per frame', { hidden: await count(false), shown: await count(true) });
    g.renderer.copyFramebufferToTexture = original;
    await shoot('copies');
  },
  /** Every ship in the battle underway, seen from above the formation (launch with a larger --battle). */
  async 'b-fleet'(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 15, windSpeed: 7, windDirection: 60 });
    const count = stage.ships().length;
    for (let i = 0; i < count; i++) stage.underway(i, .5 + .5 * (i % 2));
    stage.camera({ ship: 0, offset: [-1500, 500, 1300], look: [600, 20, -200], fov: 45 });
    stage.advance(60); await shoot(`${count} ships`);
    const exhaust = (stage.game as unknown as { funnelSmoke: { root: { children: { layers: { set(layer: number): void } }[] }; diagnostics(): unknown } }).funnelSmoke;
    const toggle = (shown: boolean) => exhaust.root.children.forEach(child => child.layers.set(shown ? 0 : 31));
    const rows: Record<string, number | null>[] = [];
    for (let i = 0; i < 2; i++) {
      toggle(true); const shown = await stage.measure(40);
      toggle(false); const hidden = await stage.measure(40);
      rows.push({ shown: shown.gpuMs, hidden: hidden.gpuMs, cpuShown: shown.cpuMs });
    }
    toggle(true);
    stage.note('fleet: exhaust shown vs hidden (GPU ms)', rows);
    stage.note('counts', exhaust.diagnostics());
    stage.camera({ ship: 0, offset: [-160, 60, 220], look: [60, 22, -20], fov: 50 }); await shoot('chase in the fleet');
  },
};

export type { Frame };
