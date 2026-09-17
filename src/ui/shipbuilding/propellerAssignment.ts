import type { ConstructionEquipment, ConstructionResult, ConstructionSource } from '../../ships/blueprint';

export function propellerEngineName(engine: ConstructionEquipment): string {
  const side = engine.position[0] < -.05 ? 'Port' : engine.position[0] > .05 ? 'Starboard' : 'Centerline';
  return `${side} · ${engine.id}`;
}

/** Display the native compiler's current routing, never a second assignment algorithm. */
export function automaticPropellerLabel(source: ConstructionSource, result: ConstructionResult | undefined, propeller: ConstructionEquipment): string {
  if (propeller.powerSourceId) return 'Automatic';
  if (!result || result.sourceId !== source.id || result.revision !== source.revision) return 'Automatic · assigning…';
  if (!result.propellerAssignments) return 'Automatic · fix layout to assign';
  const id = result.propellerAssignments.find(a => a.propellerId === propeller.id)?.engineId;
  const engine = source.construction.equipment.find(e => e.id === id);
  return engine ? `Automatic · ${propellerEngineName(engine)}` : 'Automatic · no powered engine';
}
