import { expect, test } from 'bun:test';
import type { ConstructionDesignHead } from '../ships/constructionStore';
import type { LocalShipRevision } from '../ships/localShips';
import { editedLabel, filterDesigns, fleetLineWindow, portDesigns, sortDesigns } from './portDesigns';

const head = (id: string, name: string, updatedAt: number, extra: Partial<ConstructionDesignHead> = {}): ConstructionDesignHead =>
  ({ id, name, updatedAt, revisionId: `${id}-r1`, schemaVersion: 1, catalogRevision: 'c', ...extra });
const ship = (sourceId: string, name: string, length: number) =>
  ({ source: { id: sourceId, name }, definition: { id: `local-${sourceId}`, name, hull: { length } } }) as unknown as LocalShipRevision;

test('the port joins saved heads with compiled ships and lists the newest first', () => {
  const designs = portDesigns(
    [head('a', 'Old name', 100, { sourceId: 'src-a' }), head('b', 'Barge design', 300), head('c', 'Broken', 200, { readError: 'corrupt' })],
    [ship('src-a', 'Valiant', 252), ship('unsaved', 'Fresh from the slip', 40)], false);
  expect(designs.map(d => [d.name, d.status])).toEqual([
    ['Fresh from the slip', 'ready'], ['Barge design', 'draft'], ['Broken', 'recovery'], ['Valiant', 'ready'],
  ]);
  // The editor opens the stored design; the compiled source names it.
  expect(designs.find(d => d.name === 'Valiant')!.id).toBe('a');
  expect(portDesigns([head('b', 'Barge design', 300)], [], true)[0].status).toBe('preparing');
});

test('sorting and filtering leave drafts reachable', () => {
  const designs = portDesigns([head('a', 'Valiant', 100), head('b', 'Barge design', 300), head('c', 'Resolute', 200)], [ship('a', 'Valiant', 252), ship('c', 'Resolute', 224)], false);
  expect(sortDesigns(designs, 'name').map(d => d.name)).toEqual(['Barge design', 'Resolute', 'Valiant']);
  expect(sortDesigns(designs, 'size').map(d => d.name)).toEqual(['Valiant', 'Resolute', 'Barge design']);
  expect(filterDesigns(designs, 'ready', '').map(d => d.name)).toEqual(['Resolute', 'Valiant']);
  expect(filterDesigns(designs, 'drafts', '').map(d => d.name)).toEqual(['Barge design']);
  expect(filterDesigns(designs, 'all', ' val ').map(d => d.name)).toEqual(['Valiant']);
});

test('a long fleet line shows seven neighbours around the berthed ship', () => {
  const line = Array.from({ length: 20 }, (_, i) => i);
  expect(fleetLineWindow(line.slice(0, 5), 2)).toEqual([0, 1, 2, 3, 4]);
  expect(fleetLineWindow(line, 0)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(fleetLineWindow(line, 10)).toEqual([7, 8, 9, 10, 11, 12, 13]);
  expect(fleetLineWindow(line, 19)).toEqual([13, 14, 15, 16, 17, 18, 19]);
});

test('edit times read as a person would say them', () => {
  const now = Date.UTC(2026, 8, 18, 12), minute = 60_000, day = 24 * 60 * minute;
  expect(editedLabel(now - 20_000, now)).toBe('Edited just now');
  expect(editedLabel(now - 12 * minute, now)).toBe('Edited 12 min ago');
  expect(editedLabel(now - 2 * 60 * minute, now)).toBe('Edited 2 h ago');
  expect(editedLabel(now - day, now)).toBe('Edited yesterday');
  expect(editedLabel(now - 3 * day, now)).toBe('Edited 3 days ago');
  expect(editedLabel(now - 9 * day, now)).toBe('Edited 9 Sep');
  expect(editedLabel(Number.MAX_SAFE_INTEGER, now)).toBe('Edited just now');
});
