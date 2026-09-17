import { expect, test } from 'bun:test';
import type { ConstructionEquipment, ConstructionResult, ConstructionSource } from '../../ships/blueprint';
import { automaticPropellerLabel } from './propellerAssignment';

const prop = { id: 'screw', partId: 'propeller', position: [-3, -1, 10], bearingDeg: 0 } as ConstructionEquipment;
const source = { id: 'ship', revision: 'current', construction: { equipment: [prop, { id: 'port-engine', position: [-3, 0, 0] }] } } as ConstructionSource;
const result = { sourceId: 'ship', revision: 'current', propellerAssignments: [{ propellerId: 'screw', engineId: 'port-engine' }] } as ConstructionResult;

test('automatic engine display uses only the current native assignment', () => {
  expect(automaticPropellerLabel(source, result, prop)).toBe('Automatic · Port · port-engine');
  expect(automaticPropellerLabel(source, { ...result, revision: 'old' }, prop)).toBe('Automatic · assigning…');
  expect(automaticPropellerLabel(source, { ...result, sourceId: 'another-ship' }, prop)).toBe('Automatic · assigning…');
  expect(automaticPropellerLabel(source, undefined, prop)).toBe('Automatic · assigning…');
});

test('manual overrides, incomplete layouts and missing engines have distinct labels', () => {
  expect(automaticPropellerLabel(source, result, { ...prop, powerSourceId: 'port-engine' })).toBe('Automatic');
  expect(automaticPropellerLabel(source, { ...result, propellerAssignments: undefined }, prop)).toBe('Automatic · fix layout to assign');
  expect(automaticPropellerLabel(source, { ...result, propellerAssignments: [] }, prop)).toBe('Automatic · no powered engine');
});
