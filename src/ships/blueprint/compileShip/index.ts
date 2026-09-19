/** compileShip: validate an unknown blueprint section by section, then attach catalog weapons. Section order is the error order. */
import type { Armor, DepthChargePart, GunPart, ShipBlueprint, ShipDefinition, TorpedoPart } from '../blueprintTypes';
import { record, text, volumes } from '../validators';
import { validateAirWing } from './airWing';
import { compileArmor } from './armor';
import { validateCompartments, validateFloodRegions, validateObstructionsAndConnections } from './compartments';
import { validateDamageControl, validateLocalDamage, validateUnderwaterProtection } from './damage';
import { validateGunParts, validateMounts } from './guns';
import { validateHandling, validateHullDimensions, validateHullForm, validateIdentity, validateRig, validateStructures } from './hull';
import { validateLauncherOwners, validateModules, validateMountMagazines, validatePropulsion } from './modules';
import { validateMountClearanceBodies, validateMountClearanceEnvelopes } from './mountClearance';
import { validateSubmarine } from './submarine';
import { validateUnderwaterWeapons } from './underwaterWeapons';

/** Validate unknown input before compiling. Limits are authoring safeguards, not a PvP ruleset. */
export function compileShip(input: unknown, catalogInput: unknown): ShipDefinition {
  const b = record(input, 'blueprint'),
    catalog = record(catalogInput, 'catalog');
  validateIdentity(b, catalog);
  const h = validateHullDimensions(b);
  validateRig(b, h);
  validateHullForm(b, h);
  validateStructures(b, h);
  validateHandling(b);
  const parts = validateGunParts(catalog);
  validateDamageControl(b);
  const mounts = validateMounts(b, h, parts);
  validateMountClearanceBodies(b, mounts);
  const compartments = volumes(b.compartments, 'compartments');
  validateMountClearanceEnvelopes(b, mounts);
  validateCompartments(mounts, compartments);
  const modules = validateModules(b, h, mounts, compartments);
  validateUnderwaterProtection(b, h);
  validateLocalDamage(b, h, mounts, modules);
  validatePropulsion(b, modules);
  validateFloodRegions(b, compartments);
  validateMountMagazines(mounts, modules);
  const { torpedoes, depthCharges } = validateUnderwaterWeapons(b, catalog, h, parts, mounts, modules);
  const compiledArmor = compileArmor(b, parts, mounts);
  validateObstructionsAndConnections(b, compartments);
  const accuracy = record(b.accuracy, 'accuracy');
  validateLauncherOwners(b, modules);
  validateAirWing(b, h, modules);
  validateSubmarine(b, h, modules);
  ['exterior', 'internals', 'weapons'].forEach((k) => text(accuracy[k], `accuracy.${k}`));
  const blueprint = structuredClone(input) as ShipBlueprint;
  const result: ShipDefinition = {
    ...blueprint,
    torpedoTubes: undefined,
    depthChargeLaunchers: undefined,
    armor: structuredClone(compiledArmor) as Armor[],
    compilerVersion: 1,
    mounts: blueprint.mounts.map((m) => {
      const weapon = structuredClone(parts.find((p) => p.id === m.partId)) as unknown as GunPart;
      if (m.traverseDeg !== undefined) weapon.traverseDeg = m.traverseDeg;
      delete weapon.catalogElevationMinDeg;
      delete weapon.catalogElevationMaxDeg;
      if (m.elevationMinDeg !== undefined) {
        weapon.catalogElevationMinDeg = weapon.elevationMinDeg;
        weapon.elevationMinDeg = m.elevationMinDeg;
      }
      if (m.elevationMaxDeg !== undefined) {
        weapon.catalogElevationMaxDeg = weapon.elevationMaxDeg;
        weapon.elevationMaxDeg = m.elevationMaxDeg;
      }
      return { ...m, weapon };
    }),
  };
  if (blueprint.torpedoTubes)
    result.torpedoTubes = blueprint.torpedoTubes.map((t) => ({
      ...t,
      weapon: structuredClone(torpedoes.find((p) => p.id === t.partId)) as unknown as TorpedoPart,
    }));
  else delete result.torpedoTubes;
  if (blueprint.depthChargeLaunchers)
    result.depthChargeLaunchers = blueprint.depthChargeLaunchers.map((l) => ({
      ...l,
      weapon: structuredClone(depthCharges.find((p) => p.id === l.partId)) as unknown as DepthChargePart,
    }));
  else delete result.depthChargeLaunchers;
  return result;
}
