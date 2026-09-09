import { expect, test } from 'bun:test';
import { Group } from 'three/webgpu';
import { ObservedShipViews } from './ObservedShipViews';
import type { ObservedShip } from './session/BattleSession';

test('a remote ship report gives the chart an exterior but cannot reveal it to another ship camera', () => {
  const views = new ObservedShipViews();
  const template = new Group(); template.name = 'Public recognition model';
  views.setModels(new Map([['fletcher', template]]));
  const report: ObservedShip = { id: 'contact-0-1', presetId: 'fletcher', position: [1000, 0, -2000], heading: 0, velocity: [0, 0, -10], observedTick: 120, observers: ['forward-destroyer'] };
  views.update([report], 150, true, 'rear-carrier');
  expect(views.root.children).toHaveLength(1);
  const exterior = views.root.children[0];
  expect(exterior.visible).toBe(false);
  views.update([report], 150, true, 'forward-destroyer');
  expect(exterior.visible).toBe(true);
  expect(exterior.position.toArray()).toEqual([1000, 0, -2005]);
  views.update([report], 150, true);
  expect(exterior.visible).toBe(true);
  views.update([], 180, true);
  expect(views.root.children).toHaveLength(0);
  expect(template.parent).toBeNull();
});
