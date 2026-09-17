import type { ShipView } from '../../src/game/ShipView';
import type { Combatant } from '../../src/simulation/damage';
import type { ConstructionSource, ShipDefinition } from '../../src/ships/blueprint';

export function resetReviewPose(actor: Combatant, definition: ShipDefinition, source: ConstructionSource, view: ShipView, neutral = false) {
  actor.mounts.forEach((m, i) => Object.assign(m, { train: 0, elevation: neutral ? 0 : (definition.mounts[i].initialElevationDeg ?? 0) * Math.PI / 180, recoil: 0 }));
  actor.torpedoLaunchers?.forEach(l => { l.train = neutral ? 0 : (source.construction.equipment.find(e => e.id === l.id)?.bearingDeg ?? 0) * Math.PI / 180; });
  view.snap(); view.updateRenderMatrices();
}
