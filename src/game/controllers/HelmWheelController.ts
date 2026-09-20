import type { CameraRig } from '../CameraRig';
import type { InputController } from '../InputController';
import type { BattleSession } from '../session/BattleSession';
import { physicalLoss } from '../session/battleRules';
import type { FleetActor } from '../session/elements';
import type { HelmWheelState } from '../types';

/** What the helm wheel reads from and asks of `Game`, each member at the moment of use.
 * `helmWheel` stays a public field of `Game`: the HUD renders the picker from it. */
export interface HelmWheelContext {
  readonly simulation: BattleSession;
  readonly rig: Pick<CameraRig, 'setHeld'>;
  readonly input: Pick<InputController, 'clear' | 'setOrder' | 'setRudder'>;
  readonly inPort: boolean;
  readonly paused: boolean;
  readonly airOperationsOpen: boolean;
  readonly inspecting: boolean;
  readonly fleetCommandMode: boolean;
  readonly spectatedShipId: string | undefined;
  helmWheel: HelmWheelState | undefined;
  /** Fleet command's own follow-then-helm path. */
  takeFleetHelm(id: string): void;
  spectateTeammate(id: string): void;
}

/** The helm wheel: the fleet fanned out around the current hull at true bearing.
 * Held on its key it closes on release, taking the highlighted helm; offered
 * after a sinking it stays up until a pick or Esc. The chart has its own picker. */
export class HelmWheelController {
  /** The sunk hull the wheel was last offered for, so it is offered once. */
  private offeredFor?: string;

  constructor(private readonly context: HelmWheelContext) {}

  /** A new fleet may be offered the wheel again. */
  forgetOffer(): void {
    this.offeredFor = undefined;
  }

  /** Friendly hulls the player could command next: afloat in a battle whose session
   * transfers the helm, and not the hull already under the camera. */
  get candidates(): FleetActor[] {
    const { inPort, simulation, spectatedShipId } = this.context;
    if (inPort || !simulation.isBattle || !simulation.selectShip || simulation.result !== 'active') return [];
    const current = spectatedShipId ?? simulation.player.motion.id;
    return simulation.actors.filter((a) => a.team === simulation.player.team && !physicalLoss(a) && a.motion.id !== current);
  }

  open(reason: HelmWheelState['reason']): void {
    const context = this.context;
    if (context.helmWheel || context.paused || context.airOperationsOpen || context.inspecting || !this.candidates.length) return;
    context.helmWheel = { reason };
    context.rig.setHeld(true);
    context.input.clear();
  }

  highlight(id: string | undefined): void {
    const context = this.context;
    if (!context.helmWheel || context.helmWheel.highlightId === id) return;
    context.helmWheel = { ...context.helmWheel, highlightId: id && this.candidates.some((a) => a.motion.id === id) ? id : undefined };
  }

  close(): void {
    if (!this.context.helmWheel) return;
    this.context.helmWheel = undefined;
    this.context.rig.setHeld(false);
  }

  /** Releasing the key commits to the highlighted hull; a wheel offered after a sinking waits for a pick. */
  release(): void {
    const wheel = this.context.helmWheel;
    if (!wheel || wheel.reason !== 'held') return;
    const id = wheel.highlightId;
    this.close();
    if (id) this.takeHelm(id);
  }

  /** Command another friendly hull. Fleet command keeps its follow-then-helm path;
   * a custom battle moves the camera onto the hull while the session confirms. */
  takeHelm(id: string): void {
    const context = this.context;
    if (!this.candidates.some((a) => a.motion.id === id)) return;
    this.close();
    this.offeredFor = undefined;
    if (context.fleetCommandMode) {
      context.takeFleetHelm(id);
      return;
    }
    context.spectateTeammate(id);
    context.simulation.selectShip?.(id);
    context.input.clear();
    context.input.setOrder(1);
    context.input.setRudder(0);
  }

  /** A sunk helm in a custom battle offers the wheel once; Esc leaves the spectator view in place. */
  offer(): void {
    const context = this.context;
    if (context.fleetCommandMode || context.helmWheel || context.paused) return;
    const id = context.simulation.player.motion.id;
    if (!context.simulation.player.damage.sunk || this.offeredFor === id) return;
    this.offeredFor = id;
    this.open('sunk');
  }
}
