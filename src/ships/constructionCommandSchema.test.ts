import { expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  BOUNDARY,
  COMMANDS,
  COMMAND_OPS,
  CONSTRUCTION_CONVENTIONS,
  EQUIPMENT,
  FACES,
  FINISHES,
  LOAD,
  PRIMITIVE,
  PRIMITIVE_KINDS,
  SURFACE,
  closestMatches,
  constructionBatchJsonSchema,
  validateCommandShape,
  type Field,
} from './constructionCommandSchema';
import { objectSpecDrift, readTypes, specDrift } from './constructionTypeReader';
import { CONSTRUCTION_FACES } from './constructionEditor';
import { CONSTRUCTION_SHAPE_NAMES } from './constructionShapes';
import { CONSTRUCTION_SURFACE_FINISHES } from './constructionPaints';
import { createStarterSource } from './constructionStarter';
import type { ConstructionCatalog, ConstructionSource } from './blueprint';

const here = import.meta.dir;
const types = readTypes([
  join(here, 'blueprint/blueprintTypes.ts'),
  join(here, 'blueprint/constructionTypes.ts'),
  join(here, 'constructionVertex.ts'),
  join(here, 'constructionPatches.ts'),
  join(here, 'constructionCommands.ts'),
]);

test('the ConstructionCommand union and the command specs declare the same ops and fields', () => {
  const union = types.union('ConstructionCommand', 'op');
  expect(Object.keys(union).sort()).toEqual([...COMMAND_OPS].sort());
  for (const op of COMMAND_OPS) expect(specDrift(COMMANDS[op].fields as Record<string, Field>, union[op], op)).toEqual([]);
  // The reader sees real drift rather than agreeing with everything.
  const { degrees: _, ...rotate } = COMMANDS.rotate.fields;
  expect(specDrift(rotate, union.rotate, 'rotate')).toEqual(['rotate.degrees is declared but has no spec']);
  expect(specDrift({ ...COMMANDS.rotate.fields, degrees: { type: 'number', optional: true } }, union.rotate, 'rotate')).toEqual([
    'rotate.degrees is required in the type',
  ]);
});

test('record specs match the declared source types, including nested records, optionality and literal choices', () => {
  expect(objectSpecDrift(PRIMITIVE, types.fields('ConstructionPrimitive'))).toEqual([]);
  expect(objectSpecDrift(EQUIPMENT, types.fields('ConstructionEquipment'))).toEqual([]);
  expect(objectSpecDrift(BOUNDARY, types.fields('ConstructionBoundary'))).toEqual([]);
  expect(objectSpecDrift(LOAD, types.fields('ConstructionLoad'))).toEqual([]);
  expect(objectSpecDrift(SURFACE, types.fields('ConstructionSurfaceAssignment'))).toEqual([]);
  expect([...FACES]).toEqual([...CONSTRUCTION_FACES]);
  expect([...FINISHES]).toEqual(CONSTRUCTION_SURFACE_FINISHES.map((finish) => finish.id));
  expect([...PRIMITIVE_KINDS].sort() as string[]).toEqual(Object.keys(CONSTRUCTION_SHAPE_NAMES).sort());
});

test('every record of the authored construction ships passes as a whole-record command', async () => {
  const sources: ConstructionSource[] = [createStarterSource({ revision: 'test' } as ConstructionCatalog, 'fletcher-hull')];
  for (const id of ['valiant', 'resolute', 'balcony-playground'])
    sources.push((await Bun.file(join(here, '../../assets/ships', id, 'blueprint.json')).json()) as ConstructionSource);
  let records = 0;
  for (const { construction: data } of sources)
    for (const [op, rows] of [
      ['primitive', data.primitives],
      ['equipment', data.equipment],
      ['boundary', data.boundaries],
      ['load', data.loads],
      ['surface', data.surfaces],
    ] as const)
      for (const value of rows) {
        validateCommandShape({ op, value }, records++);
      }
  expect(records).toBeGreaterThan(300);
});

test('the JSON Schema is derived from the same specs', () => {
  const schema = constructionBatchJsonSchema() as {
    $schema: string;
    required: string[];
    additionalProperties: boolean;
    properties: {
      commands: {
        items: {
          oneOf: {
            title: string;
            required: string[];
            additionalProperties: boolean;
            properties: Record<string, { const?: string; $ref?: string }>;
          }[];
        };
      };
    };
    $defs: Record<string, { properties: Record<string, unknown>; required: string[] }>;
  };
  expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  expect(schema.required).toEqual(['version', 'expectedRevision', 'label', 'commands']);
  expect(schema.additionalProperties).toBe(false);
  const commands = schema.properties.commands.items.oneOf;
  expect(commands.map((command) => command.title)).toEqual(COMMAND_OPS);
  for (const command of commands) {
    const fields = COMMANDS[command.title as keyof typeof COMMANDS].fields as Record<string, Field>;
    expect(command.properties.op.const).toBe(command.title);
    expect(command.additionalProperties).toBe(false);
    expect(Object.keys(command.properties).sort()).toEqual(['op', ...Object.keys(fields)].sort());
    expect(command.required.sort()).toEqual(['op', ...Object.keys(fields).filter((key) => !fields[key].optional)].sort());
  }
  expect(commands.find((command) => command.title === 'rotate')!.required).toContain('degrees');
  expect(commands.find((command) => command.title === 'equipment')!.properties.value.$ref).toBe('#/$defs/Equipment');
  expect(Object.keys(schema.$defs).sort()).toEqual([
    'AnglePair',
    'Boundary',
    'CompoundSolid',
    'CustomHull',
    'Equipment',
    'EquipmentPatch',
    'Fitting',
    'FittingMesh',
    'FittingPatch',
    'FittingSolid',
    'FittingTube',
    'FreeformMesh',
    'HullStation',
    'Load',
    'Primitive',
    'PrimitivePatch',
    'SurfaceAssignment',
    'SurfaceTarget',
    'Vec3',
  ]);
  expect(schema.$defs.Equipment.required).toEqual(['id', 'partId', 'position', 'bearingDeg']);
  expect(schema.$defs.EquipmentPatch.required).toEqual([]);
  expect(schema.$defs.EquipmentPatch.properties).not.toHaveProperty('id');
  expect((schema.$defs.EquipmentPatch.properties.paint as { anyOf: unknown[] }).anyOf).toContainEqual({ type: 'null' });
  expect(schema.$defs.EquipmentPatch.properties.position).not.toHaveProperty('anyOf');
  expect(JSON.stringify(schema)).not.toContain('"optional"');
  expect(Object.keys(CONSTRUCTION_CONVENTIONS)).toContain('axes');
});

test('close matches rank near edits and abbreviations, and stay quiet otherwise', () => {
  expect(closestMatches('gun-fwd', ['hull', 'gun-forward', 'gun-aft'])).toEqual(['gun-forward']);
  expect(closestMatches('Gun_Forward', ['gun-forward'])).toEqual(['gun-forward']);
  expect(closestMatches('section-108x', ['section-10', 'section-108', 'section-0'])[0]).toBe('section-108');
  expect(closestMatches('funnel', ['hull', 'gun-forward'])).toEqual([]);
});
