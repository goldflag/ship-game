import { Vector2, Vector3, type Camera, type WebGPURenderer } from 'three/webgpu';
import { max } from 'three/tsl';
import { FleetWakeFoam, WAKE_ATLAS_CAPACITY, type WakeShip } from './FleetWakeFoam';
import type { CombatEvent } from '../game/session/elements';
import type { OceanApi, WakeFieldApi } from './ocean/contracts';
import { wakeHull } from './wakeHull';
import { TorpedoTrackFoam } from './TorpedoTrackFoam';
import type { Torpedo } from './torpedoAim';

/** Render-side wake configuration; driven by ship motion, independent of the helm. */
export class ShipWake {
  private readonly wake: WakeFieldApi;
  private readonly center = new Vector2();
  private readonly generators = new Map<WakeShip['root'], { bow: number; stern: number }>();
  private readonly foam: FleetWakeFoam;
  private readonly torpedoTracks: TorpedoTrackFoam;
  private eventSequence = 0;

  constructor(private readonly ocean: Pick<OceanApi, 'wake' | 'setWakeSampler'>, renderer?: WebGPURenderer) {
    const wake = this.wake = ocean.wake;
    // A 1.5 km field centred on the focus hull keeps a 250 m hull's whole trail while the
    // camera orbits and zooms; the tier's resolution sets the cells spent on it.
    wake.worldSize = 1536;
    wake.friction = 0.065;
    wake.foamBreakThreshold = 0.09;
    wake.foamStrength = 1.2;
    wake.foamLifetime = 9;
    // Trail foam is the game's own and stays on when the tier runs no wake field.
    this.foam = new FleetWakeFoam(wake.resolution ? Math.min(wake.resolution, 256) : 128, renderer);
    // A bubble track is a few metres wide: finer than any fleet wake cell.
    this.torpedoTracks = new TorpedoTrackFoam(renderer ? 1024 : 256, renderer);
    // The surface shades the wake's swell with the ocean's own lighting; the game adds its
    // trail and torpedo foam on top of the field's breaking foam.
    const field = wake.sampler;
    ocean.setWakeSampler({
      height: (x, z) => field.height(x, z),
      normal: (x, z) => field.normal(x, z),
      foam: (x, z) => max(max(field.foam(x, z), this.foam.sample(x, z)), this.torpedoTracks.sample(x, z)),
    });
  }

  update(ships: readonly WakeShip[], dt: number, events: readonly CombatEvent[] = [], camera?: Camera, torpedoes: readonly Pick<Torpedo, 'id' | 'position' | 'velocity'>[] = []): void {
    const freshEvents = events.filter(event => event.sequence > this.eventSequence);
    for (const event of freshEvents) this.eventSequence = Math.max(this.eventSequence, event.sequence);
    const focus = ships[0]?.motion;
    if (focus) { this.center.set(focus.x, focus.z); this.wake.setCenter(focus.x, focus.z); }
    // The foam atlas holds a fixed number of trails. A battle larger than that
    // keeps the focus hull and the trails nearest to it.
    const span = (ship: WakeShip) => Math.hypot(ship.motion.x - this.center.x, ship.motion.z - this.center.y);
    if (ships.length > WAKE_ATLAS_CAPACITY) ships = [ships[0], ...ships.slice(1).sort((a, b) => span(a) - span(b))].slice(0, WAKE_ATLAS_CAPACITY);
    // The wake field takes 16 generators. Give its local swell to the nearest eight hulls;
    // the foam atlas covers every ship.
    const nearby = ships.filter(ship => Math.abs(ship.motion.x - this.center.x) < 900 && Math.abs(ship.motion.z - this.center.y) < 900)
      .sort((a, b) => span(a) - span(b)).slice(0, 8);
    const roots = new Set(nearby.map(ship => ship.root));
    for (const [root, ids] of this.generators) if (!roots.has(root)) {
      this.wake.removeGenerator(ids.bow); this.wake.removeGenerator(ids.stern); this.generators.delete(root);
    }
    let strength = 0;
    for (const ship of nearby) {
      let ids = this.generators.get(ship.root);
      if (!ids) {
        const { length, beam, centerX, centerZ } = wakeHull(ship.definition.hull);
        ids = {
          bow: this.wake.addGenerator(ship.root, { active: false, depth: .32, radius: beam * .28, offset: new Vector3(centerX, 0, centerZ - length * .448), teleportThreshold: 100 }),
          stern: this.wake.addGenerator(ship.root, { active: false, depth: .18, radius: beam * .39, offset: new Vector3(centerX, 0, centerZ + length * .448), teleportThreshold: 100 }),
        };
        this.generators.set(ship.root, ids);
      }
      const surface = Math.max(0, Math.min(1, 1 + ship.motion.y / 3));
      const speed = Math.abs(ship.motion.speed) * surface;
      const ratio = Math.min(speed / ship.definition.handling.forwardSpeed, 1);
      this.wake.updateGenerator(ids.bow, { active: speed > .1, depth: .32 * ratio * ratio });
      this.wake.updateGenerator(ids.stern, { active: speed > .1, depth: .18 * ratio * ratio });
      strength = Math.max(strength, ratio);
    }
    this.wake.foamStrength = 1.2 * strength;
    this.foam.update(ships, dt, freshEvents, camera);
    this.torpedoTracks.update(torpedoes, dt, this.center.x, this.center.y, camera);
  }

  resetImpacts(): void { this.foam.resetImpacts(); this.eventSequence = 0; }
  diagnostics() { return { ...this.foam.diagnostics(), torpedoTracks: this.torpedoTracks.diagnostics() }; }

  /** Clear every trail, including the field's displacement when returning to port. */
  reset(): void {
    this.foam.reset(); this.torpedoTracks.reset();
    this.eventSequence = 0;
    this.wake.reset();
  }

  dispose(): void {
    for (const ids of this.generators.values()) {
      this.wake.removeGenerator(ids.bow); this.wake.removeGenerator(ids.stern);
    }
    this.generators.clear();
    this.ocean.setWakeSampler(null);
    this.foam.dispose(); this.torpedoTracks.dispose();
  }
}
