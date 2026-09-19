import type { PerspectiveCamera } from 'three/webgpu';
import type { Battery, ShipDefinition } from '../../ships/blueprint';
import { shipPreset } from '../../ships/presets';
import { reportName } from '../../ui/reconReports';
import type { CameraRig } from '../CameraRig';
import type { ObservedShipViews } from '../ObservedShipViews';
import { Rangefinder } from '../Rangefinder';
import { observeRangeTarget, pickRangeTarget, rangeTargetVisible, type RangeTarget } from '../rangefinderSight';
import type { BattleSession } from '../session/BattleSession';
import type { ShipState } from '../session/elements';

/** What optical ranging reads from `Game`, each member at the moment of use. */
export interface RangefindingContext {
  readonly simulation: BattleSession;
  readonly camera: PerspectiveCamera;
  readonly rig: Pick<CameraRig, 'binoculars' | 'setRangeLock' | 'update'>;
  readonly host: { readonly clientWidth: number; readonly clientHeight: number };
  readonly observedShipViews?: Pick<ObservedShipViews, 'position'>;
  /** The displayed pose of the player's hull, once its model is loaded. */
  readonly playerMotion?: ShipState;
  readonly inPort: boolean;
  /** The camera is off the ship's sight: the chart, a follow view or the free camera. */
  readonly viewAway: boolean;
  readonly battery: Battery;
  /** Paused, tactically paused or choosing a helm: the range keys do nothing. */
  readonly ordersBlocked: boolean;
  /** Ranging is a deliberate sighting: the guns follow the sight again. */
  takeManualAim(): void;
}

/** The binocular rangefinder: choosing a hull, timing the measurement, holding the lock
 * and handing the locked range to the camera rig. */
export class RangefindingController {
  readonly rangefinder = new Rangefinder();

  constructor(private readonly context: RangefindingContext) {}

  get canRange(): boolean {
    const { inPort, rig, viewAway, simulation, battery } = this.context;
    return !inPort && rig.binoculars && !viewAway && !simulation.player.damage.sunk && (battery === 'main' || battery === 'secondary');
  }

  reset(): void {
    this.rangefinder.reset();
    this.context.rig.setRangeLock();
  }

  /** Only hulls admitted to this player's view may provide optical measurements.
   * PvE enemy exteriors use current observations, never hidden actor positions. */
  targets(): RangeTarget[] {
    const { simulation, observedShipViews } = this.context;
    const dimensions = (definition: ShipDefinition) => ({
      length: definition.hull.length,
      beam: definition.hull.beam,
      height: Math.max(2, definition.hull.depth - definition.hull.draft, definition.viewpoints?.bridge?.[1] ?? 0),
    });
    const targets: RangeTarget[] = simulation.actors
      .filter((actor) => actor !== simulation.player && !actor.damage.sunk)
      .map((actor) => ({
        id: actor.motion.id,
        name: actor.definition.name,
        position: [actor.motion.x, actor.motion.y, actor.motion.z],
        heading: actor.motion.heading,
        ...dimensions(actor.definition),
      }));
    for (const report of simulation.observedShips ?? []) {
      if (
        !report.observers.includes(simulation.ship.id) ||
        simulation.tick - report.observedTick > 60 ||
        report.health <= 0 ||
        targets.some((target) => target.id === report.id)
      )
        continue;
      const position = observedShipViews?.position(report.id);
      if (!position) continue;
      const track = simulation.observationTracks?.find((track) => track.id === report.id);
      targets.push({
        id: report.id,
        name: track ? reportName(track) : 'Surface contact',
        position: position.toArray(),
        heading: report.heading,
        ...dimensions(shipPreset(report.presetId)),
      });
    }
    return targets;
  }

  measure(): void {
    if (!this.canRange || this.context.ordersBlocked) return;
    const { simulation, camera, host, rig } = this.context;
    const targets = this.targets();
    this.rangefinder.start(pickRangeTarget(targets, camera, simulation.ship, host.clientWidth, host.clientHeight, simulation.islands));
    rig.setRangeLock();
    this.context.takeManualAim();
  }

  toggleLock(): void {
    if (!this.canRange || this.context.ordersBlocked) return;
    const { simulation, rig } = this.context;
    this.rangefinder.toggleLock();
    rig.setRangeLock(this.rangefinder.state.locked ? this.rangefinder.state.rangeM : undefined);
    this.context.takeManualAim();
    rig.update(simulation.ship, simulation.ship.y, 0);
  }

  update(seconds: number): void {
    if (!this.canRange) {
      this.reset();
      return;
    }
    if (seconds <= 0) return;
    const { simulation, camera, host, rig } = this.context;
    const state = this.rangefinder.state;
    if (state.phase === 'measuring' || state.phase === 'tracking') {
      const targets = this.targets(),
        target = targets.find((target) => target.id === state.targetId);
      const observation = target && observeRangeTarget(target, camera, simulation.ship, host.clientWidth, host.clientHeight);
      this.rangefinder.update(
        seconds,
        observation && target && rangeTargetVisible(target, camera.position.toArray(), targets, simulation.islands)
          ? observation
          : undefined,
      );
    }
    rig.setRangeLock(state.locked ? state.rangeM : undefined);
    if (state.locked) {
      const pose = this.context.playerMotion ?? simulation.ship;
      rig.update(pose, pose.y, 0);
    }
  }
}
