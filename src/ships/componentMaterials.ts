import definition from '../../assets/parts/materials.json';
import shipFinishes from '../../assets/ships/appearance/finishes.json';

export type ComponentMaterialRole = keyof typeof definition.roles;
export const COMPONENT_MATERIAL_INPUTS = ['assets/parts/materials.py', 'assets/parts/materials.json', 'assets/ships/appearance/finishes.json'];
const finishes = { ...shipFinishes.finishes, ...definition.finishes };

export function componentMaterial(role: ComponentMaterialRole) {
  const spec = definition.roles[role];
  return { ...spec, ...finishes[spec.finish as keyof typeof finishes], userData: {
    componentMaterialVersion: definition.schemaVersion, componentMaterialRole: role, componentPaint: spec.paint,
  } };
}

/** Old immutable catalogs have no extras. Recognize only their exact authored
 * material names; unknown or unsupported materials keep their original finish. */
export function followsComponentPaint(name: string, extras: Record<string, unknown>): boolean {
  if ('componentMaterialVersion' in extras || 'componentPaint' in extras || 'componentMaterialRole' in extras) {
    const role = extras.componentMaterialRole as ComponentMaterialRole;
    return extras.componentMaterialVersion === 1 && extras.componentPaint === 'component'
      && Object.hasOwn(definition.roles, role) && definition.roles[role].paint === 'component';
  }
  if (!Object.hasOwn(definition.legacyRoles, name)) return false;
  const role = definition.legacyRoles[name as keyof typeof definition.legacyRoles] as ComponentMaterialRole;
  return definition.roles[role].paint === 'component';
}

/** New publications must declare every surface. Retained pre-contract assets
 * remain readable through the legacy map, without mutating their bytes. */
export function validateComponentMaterials(materials: { name?: string; extras?: Record<string, unknown> }[]): void {
  if (!materials.length) throw new Error('Component has no materials');
  for (const material of materials) {
    const extras = material.extras ?? {}, role = extras.componentMaterialRole as ComponentMaterialRole;
    if (extras.componentMaterialVersion !== 1 || !Object.hasOwn(definition.roles, role)
      || extras.componentPaint !== definition.roles[role].paint) throw new Error(`Missing or invalid component material role: ${material.name}`);
  }
}
