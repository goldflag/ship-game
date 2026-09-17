import type { ConstructionEquipment, ConstructionResult, ConstructionSource } from '../../ships/blueprint';

export function propellerEngineName(engine: ConstructionEquipment): string {
  const side = engine.position[0] < -.05 ? 'Port' : engine.position[0] > .05 ? 'Starboard' : 'Centerline';
  return `${side} · ${engine.id}`;
}

/** Current resolved engines; stale compile results must not appear as live connections. */
export function propellerEngines(source: ConstructionSource, result: ConstructionResult | undefined, propeller: ConstructionEquipment): ConstructionEquipment[] {
  if (!result || result.sourceId !== source.id || result.revision !== source.revision) return [];
  const ids = new Set(result.propellerAssignments?.filter(a => a.propellerId === propeller.id).map(a => a.engineId));
  return source.construction.equipment.filter(e => ids.has(e.id)).sort((a, b) => a.id.localeCompare(b.id));
}

/** Display the native compiler's current routing, never a second assignment algorithm. */
export function automaticPropellerLabel(source: ConstructionSource, result: ConstructionResult | undefined, propeller: ConstructionEquipment): string {
  if (propeller.powerSourceId) return 'Automatic';
  if (!result || result.sourceId !== source.id || result.revision !== source.revision) return 'Automatic · assigning…';
  if (!result.propellerAssignments) return 'Automatic · fix layout to assign';
  const engines = propellerEngines(source, result, propeller);
  if (engines.length > 1) return `Automatic · ${engines.length} engines`;
  return engines.length ? `Automatic · ${propellerEngineName(engines[0])}` : 'Automatic · no powered engine';
}
