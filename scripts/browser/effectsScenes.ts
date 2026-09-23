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
  /** A turret fired across the view, so the flame jet, side lobes and cloud read in profile. */
  async 'a-muzzle-side'(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 15 });
    stage.aim(0, 1, 3, 'main');
    stage.camera({ ship: 0, offset: [95, 24, -250], look: [55, 14, -70], fov: 42 });
    stage.fire(0, { mounts: [0] });
    await timeline(stage, shoot, [.02, .05, .1, .2, .4, .8, 1.5, 3, 6]);
  },
  /** Heavy AA airbursts over the target: the shared gas shader must keep flak charcoal and brief. */
  async 'a-flak'(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 15 });
    stage.camera({ ship: 1, offset: [stage.facing() * 420, 150, 160], look: [0, 170, 0], fov: 40 });
    stage.flak(1, [0, 180, 0]); stage.advance(.3); stage.flak(1, [40, 200, -60]); stage.flak(1, [-30, 165, 50], .127);
    await timeline(stage, shoot, [.32, .4, .6, 1, 2, 4]);
  },
  /** The secondary battery firing: proportionally smaller, faster blasts. */
  async 'a-secondary'(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 15 });
    stage.aim(0, 1, 3, 'secondary');
    stage.camera({ ship: 0, offset: [120, 30, -150], look: [15, 10, -20], fov: 45 });
    stage.fire(0, { battery: 'secondary' });
    await timeline(stage, shoot, [.02, .06, .15, .4, 1, 2.5]);
  },
  /** The magazine detonation framed whole from 2.5 km: fireball, column, cap and pall. */
  async 'a-magazine-wide'(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 15 });
    stage.camera({ ship: 1, offset: [stage.facing() * 2400, 60, 600], look: [0, 190, 0], fov: 32 });
    stage.hit(1, { kind: 'magazine' });
    await timeline(stage, shoot, [.1, .5, 1.5, 3, 6, 10, 18, 30, 45]);
  },
  /** One high-explosive burst on the superstructure, close. */
  async 'a-he-close'(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 15 });
    const side = stage.facing();
    stage.camera({ ship: 1, offset: [side * 85, 22, -10], look: [0, 10, -30], fov: 50 });
    stage.hit(1, { kind: 'burst', along: .6, height: 11 });
    await timeline(stage, shoot, [.02, .06, .12, .25, .5, 1, 2, 4, 8]);
  },
  /** Paired A/B cost of the combat effects (shown vs hidden, interleaved) during a close
   * broadside, a hit sequence and a magazine detonation. Robust to other GPU load. */
  async 'a-cost'(stage, shoot) {
    stage.reset(); stage.weather({ timeHours: 15 });
    stage.aim(0, 1, 4, 'main'); stage.aim(1, 0, 4, 'main');
    stage.camera({ ship: 0, offset: [-150, 42, 150], look: [70, 14, -35], fov: 50 });
    stage.fire(0); stage.fire(1); stage.advance(.6);
    stage.note('broadsides 0.6 s', await stage.effectsCost());
    stage.advance(2.4);
    stage.note('broadsides 3 s', await stage.effectsCost());
    await shoot('broadsides 3 s');
    stage.reset();
    stage.camera({ ship: 1, offset: [stage.facing() * 230, 40, 110], look: [0, 10, -10], fov: 45 });
    for (let i = 0; i < 4; i++) stage.hit(1, { kind: i % 2 ? 'burst' : 'penetration', along: .3 + i * .15, height: 4 + i * 2 });
    stage.advance(1);
    stage.note('4 hits 1 s', await stage.effectsCost());
    await shoot('4 hits 1 s');
    stage.reset();
    stage.camera({ ship: 1, offset: [stage.facing() * 2400, 60, 600], look: [0, 190, 0], fov: 32 });
    stage.hit(1, { kind: 'magazine' }); stage.advance(8);
    stage.note('magazine 8 s at 2.5 km', await stage.effectsCost());
    await shoot('magazine 8 s');
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
};

export type { Frame };
