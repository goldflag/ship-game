import type { ShipDefinition } from '../../ships/blueprint';
import type { BattlefieldCamera } from '../BattlefieldCamera';
import type { CameraRig } from '../CameraRig';
import type { InputController } from '../InputController';
import type { BattleSession } from '../session/BattleSession';
import { physicalLoss } from '../session/battleRules';
import type { ShipView } from '../ShipView';

/** What the spectator reads from and asks of `Game`, each member at the moment of use.
 * `spectatedShipId` stays a public field of `Game`; the port, the frame loop and the UI read it. */
export interface SpectatorContext {
  readonly simulation: BattleSession;
  /** The player's own hull: the rig returns to its bridge and length when spectating ends. */
  readonly definition: ShipDefinition;
  readonly fleetViews: readonly ShipView[];
  readonly rig: Pick<
    CameraRig,
    | 'mode'
    | 'exitBinoculars'
    | 'setInspecting'
    | 'setBridge'
    | 'setHullLength'
    | 'setSubmarine'
    | 'update'
    | 'capturePointer'
    | 'releasePointer'
  >;
  readonly input: Pick<InputController, 'clear' | 'isEnabled' | 'setEnabled'>;
  readonly battlefieldCamera: Pick<BattlefieldCamera, 'cancelTransition'>;
  readonly inPort: boolean;
  readonly fleetCommandMode: boolean;
  readonly airOperationsOpen: boolean;
  readonly inspecting: boolean;
  readonly followingAircraft: boolean;
  spectatedShipId: string | undefined;
  controls(): { readonly inputEnabled: boolean; readonly captureAfterSpectate: boolean };
  enterFleetCommand(): void;
  /** A sunk helm in a custom battle offers the helm wheel once. */
  offerHelmWheel(): void;
  setAirOperationsOpen(open: boolean): void;
  /** Toggles target inspection; only called to leave it. */
  inspectTarget(): void;
  endFollow(): void;
}

/** Which friendly hull the camera rides when it is not the player's helm: a fleet-command
 * captain, a teammate after the player's loss, or the hull a helm swap is landing on. */
export class SpectatorController {
  private lastFleetHelmId?: string;

  constructor(private readonly context: SpectatorContext) {}

  /** A new battle starts with no helm to have lost. */
  forgetHelm(): void {
    this.lastFleetHelmId = undefined;
  }

  /** Hulls the camera may sit on without the helm: every friendly in fleet command or
   * after the player's loss, and, where the session transfers helms, the hull a
   * custom-battle swap is landing on. */
  get candidates(): ShipView[] {
    const { inPort, simulation, fleetCommandMode, fleetViews } = this.context;
    if (inPort || !simulation.isBattle || (!fleetCommandMode && !simulation.player.damage.sunk && !simulation.selectShip)) return [];
    return fleetViews.filter(
      ({ actor }) =>
        (fleetCommandMode || actor !== simulation.player) &&
        simulation.actors.find((a) => a === actor)?.team === simulation.player.team &&
        !physicalLoss(actor),
    );
  }

  /** A spectator is chosen for the player only once the helm is gone: on the chart or on the bottom. */
  private get autoSpectates(): boolean {
    return this.context.fleetCommandMode || this.context.simulation.player.damage.sunk;
  }

  update(): void {
    const context = this.context,
      { simulation } = context;
    if (context.fleetCommandMode) {
      const lost =
        this.lastFleetHelmId &&
        !simulation.controlledShipId &&
        simulation.actors.some((a) => a.motion.id === this.lastFleetHelmId && physicalLoss(a));
      this.lastFleetHelmId = simulation.controlledShipId;
      if (lost) context.enterFleetCommand();
    }
    // Automatic ship selection must not replace an explicitly followed aircraft.
    if (context.followingAircraft) return;
    if (context.fleetCommandMode && simulation.controlledShipId && !context.airOperationsOpen) {
      context.spectatedShipId = undefined;
      const enabled = context.controls().inputEnabled;
      if (context.input.isEnabled !== enabled) context.input.setEnabled(enabled);
      return;
    }
    if (context.fleetCommandMode && context.spectatedShipId && !this.candidates.some((v) => v.actor.motion.id === context.spectatedShipId))
      context.enterFleetCommand();
    if (context.fleetCommandMode && context.airOperationsOpen) return;
    if (!context.fleetCommandMode) context.offerHelmWheel();
    const candidates = this.candidates;
    if (candidates.some((view) => view.actor.motion.id === context.spectatedShipId)) return;
    const next = this.autoSpectates ? candidates[0] : undefined;
    if (next) this.spectate(next.actor.motion.id);
    else if (context.spectatedShipId) {
      context.spectatedShipId = undefined;
      context.rig.setBridge(context.definition.viewpoints?.bridge);
      context.rig.setHullLength(context.definition.hull.length);
      context.rig.setSubmarine(context.definition.submarine);
    }
  }

  spectate(id: string): void {
    const context = this.context,
      { rig } = context;
    const view = this.candidates.find((view) => view.actor.motion.id === id);
    if (!view) return;
    // Closing the chart starts the descent onto this ship; keep it. Switching
    // between hulls already on the water stays a cut.
    if (context.airOperationsOpen) context.setAirOperationsOpen(false);
    else context.battlefieldCamera.cancelTransition();
    if (context.inspecting) context.inspectTarget();
    context.endFollow();
    context.spectatedShipId = id;
    context.input.clear();
    // Arriving on a new hull starts in the chase view; the glasses belong to the hull left behind.
    rig.exitBinoculars();
    rig.setInspecting(false);
    rig.mode = 'Chase';
    rig.setBridge(view.definition.viewpoints?.bridge);
    rig.setHullLength(view.definition.hull.length);
    rig.setSubmarine(view.definition.submarine);
    rig.update(view.motion, view.motion.y, 0, true);
    // Following a captain in fleet command steers the camera like holding the helm:
    // the mouse looks around at once and Ctrl frees the cursor for the orders panel.
    // A sunk player's spectator keeps the cursor for the teammate picker; a swap
    // landing on a new hull in a custom battle keeps aiming.
    if (context.controls().captureAfterSpectate) rig.capturePointer();
    else rig.releasePointer();
  }

  cycle(direction: number): void {
    const candidates = this.candidates;
    if (!candidates.length) return;
    const index = candidates.findIndex((view) => view.actor.motion.id === this.context.spectatedShipId);
    this.spectate(candidates[(Math.max(0, index) + (direction < 0 ? -1 : 1) + candidates.length) % candidates.length].actor.motion.id);
  }
}
