import { MathUtils } from 'three/webgpu';
import { gunTraverseAtFraction } from '../../ships/armament';
import type { ShipDefinition } from '../../ships/blueprint';
import { ArticulationResolver } from '../articulationPreview';
import type { BattleSession } from '../session/BattleSession';
import type { FleetActor } from '../session/elements';
import type { ShipView } from '../ShipView';

type JointPreview = { trainFraction: number; elevationFraction: number; recoilFraction: number };
export type ArticulationPreview = JointPreview & { mounts?: Record<string, Partial<JointPreview>> };

/** What the articulation review reads from `Game`, each member at the moment of use.
 * The resolver stays a field of `Game`, which disposes it and lets a test supply its own. */
export interface ArticulationPreviewContext<Diagnostics extends object> {
  readonly simulation: BattleSession;
  readonly definition: ShipDefinition;
  readonly playerView?: Pick<ShipView, 'update'>;
  readonly inPort: boolean;
  readonly disposed: boolean;
  resolver: ArticulationResolver | undefined;
  diagnostics(): Diagnostics;
}

/** Development-only port inspection of the loaded model at catalog joint limits: poses the
 * berthed ship's mounts through the clearance resolver and restores them afterwards. */
export class ArticulationPreviewController<Diagnostics extends object> {
  private original?: FleetActor['mounts'];
  private launchers?: FleetActor['torpedoLaunchers'];
  private request = 0;

  constructor(private readonly context: ArticulationPreviewContext<Diagnostics>) {}

  /** Put the mounts back as the port had them. Also cancels a preview whose result has not arrived. */
  restore(): void {
    const { simulation, playerView } = this.context;
    this.request++;
    if (this.original) {
      simulation.player.mounts.forEach((m, i) => Object.assign(m, this.original![i]));
      simulation.player.torpedoLaunchers?.forEach((l, i) => Object.assign(l, this.launchers?.[i]));
      this.launchers = undefined;
      this.original = undefined;
      playerView?.update();
    }
  }

  /** A replaced fleet has new mount states: forget the saved ones and cancel a pending preview without restoring. */
  discard(): void {
    this.request++;
    this.original = undefined;
    this.launchers = undefined;
  }

  async preview(pose: ArticulationPreview | null) {
    const context = this.context;
    if (!import.meta.env.DEV || !context.inPort || !context.playerView)
      throw new Error('Articulation review requires a loaded ship in the development port.');
    if (pose === null) this.restore();
    else {
      if (![pose.trainFraction, pose.elevationFraction, pose.recoilFraction].every(Number.isFinite))
        throw new Error('Review fractions must be finite.');
      for (const [id, override] of Object.entries(pose.mounts ?? {})) {
        if (
          !context.definition.mounts.some((m) => m.id === id) ||
          !Object.entries(override).every(
            ([key, value]) => ['trainFraction', 'elevationFraction', 'recoilFraction'].includes(key) && Number.isFinite(value),
          )
        )
          throw new Error('Invalid mount articulation override.');
      }
      const request = ++this.request;
      const simulation = context.simulation;
      const requested = context.definition.mounts.map((mount) => {
        const w = mount.weapon,
          selected = { ...pose, ...pose.mounts?.[mount.id] };
        return {
          train: gunTraverseAtFraction(mount, selected.trainFraction),
          elevation:
            ((w.elevationMinDeg + MathUtils.clamp(selected.elevationFraction, 0, 1) * (w.elevationMaxDeg - w.elevationMinDeg)) * Math.PI) /
            180,
          recoil: MathUtils.clamp(selected.recoilFraction, 0, 1),
        };
      });
      const resolver = (context.resolver ??= new ArticulationResolver());
      const accepted = await resolver.resolve(context.definition, simulation.player.mounts, requested);
      if (request !== this.request || simulation !== context.simulation || !context.inPort || context.disposed)
        return context.diagnostics();
      this.original ??= structuredClone(context.simulation.player.mounts);
      this.launchers ??= structuredClone(context.simulation.player.torpedoLaunchers);
      context.simulation.player.torpedoLaunchers?.forEach((l) => {
        const limits = context.definition.torpedoLaunchers?.find((d) => d.id === l.id)?.traverseLimitsDeg ?? [-140, 140];
        const fraction = MathUtils.clamp(pose.trainFraction, -1, 1);
        l.train = ((fraction < 0 ? -fraction * limits[0] : fraction * limits[1]) * Math.PI) / 180;
      });
      context.simulation.player.mounts.forEach((state, i) => {
        Object.assign(state, accepted[i].pose);
        state.status = accepted[i].blocked ? 'blocked' : 'ready';
      });
      context.playerView.update();
      return {
        ...context.diagnostics(),
        articulation: accepted.map((result, i) => ({ id: context.definition.mounts[i].id, requested: requested[i], ...result })),
      };
    }
    return context.diagnostics();
  }
}
