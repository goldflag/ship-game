import type { ShipDefinition } from './blueprint';
/** Published runtime output retains gameplay aggregates and equipment datums.
 * Equipment mass records also remain: machinery uses them to rate auxiliary power.
 * Editable construction and per-source mass diagnostics remain in blueprint.json,
 * ConstructionResult and the full compiled JSON used by the editor/build review.
 * Local designs continue through native source admission and are never replaced
 * with this projection in the saved-design library.
 */
export function runtimeProjection(definition: ShipDefinition): ShipDefinition {
  if (!definition.construction) return definition;
  return { ...definition,
    construction: { ...definition.construction, primitives: [], surfaces: [], boundaries: [], loads: [] },
    ...(definition.loading ? { loading: { ...definition.loading, contributions: definition.loading.contributions.filter(c => c.kind === 'equipment') } } : {}),
  };
}
