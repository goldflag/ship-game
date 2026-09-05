import { expect, test } from 'bun:test';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { layoutShipLabels, projectShipLabel } from './ShipLabels';

test('ship labels follow camera projection and cull rear, offscreen and clipped ships', () => {
  const camera = new PerspectiveCamera(52, 16 / 9, .5, 60000);
  camera.updateMatrixWorld();
  expect(projectShipLabel(new Vector3(0, 0, -5000), camera, 1600, 900)).toEqual({ x: 800, y: 450 });
  expect(projectShipLabel(new Vector3(0, 0, 5000), camera, 1600, 900)).toBeNull();
  expect(projectShipLabel(new Vector3(0, 0, -.1), camera, 1600, 900)).toBeNull();
  expect(projectShipLabel(new Vector3(0, 0, -70000), camera, 1600, 900)).toBeNull();
  expect(projectShipLabel(new Vector3(9000, 0, -5000), camera, 1600, 900)).toBeNull();
  const above = projectShipLabel(new Vector3(0, 60, -5000), camera, 1600, 900)!;
  expect(above.y).toBeLessThan(450);
  camera.lookAt(5000, 0, 0); camera.updateMatrixWorld();
  expect(projectShipLabel(new Vector3(5000, 0, 0), camera, 1600, 900)!.x).toBeCloseTo(800);
  expect(projectShipLabel(new Vector3(0, 0, -5000), camera, 1600, 900)).toBeNull();
});

test('clustered fleet labels keep distinct readable rows and stay within narrow viewport edges', () => {
  const labels = layoutShipLabels([{ x: 195, y: 420 }, { x: 200, y: 419 }, { x: 190, y: 421 }, { x: 6, y: 400 }, { x: 389, y: 400 }], 390);
  for (const label of labels) {
    expect(label.x - 72).toBeGreaterThanOrEqual(8);
    expect(label.x + 72).toBeLessThanOrEqual(382);
    expect(label.lift).toBeGreaterThanOrEqual(8);
    expect(label.y - label.lift - 48).toBeGreaterThan(0);
  }
  for (let a = 0; a < labels.length; a++) for (let b = a + 1; b < labels.length; b++) {
    const left = labels[a], right = labels[b];
    expect(Math.abs(left.x - right.x) >= 152 || Math.abs((left.y - left.lift) - (right.y - right.lift)) >= 56).toBe(true);
  }
});

test('subpixel projections finish layout without repeatedly colliding at a rounded boundary', () => {
  const labels = layoutShipLabels(Array.from({ length: 10 }, (_, i) => ({ x: 500 + i * .07, y: 750.137902310314 + i * .013 })), 1000);
  expect(labels).toHaveLength(10);
  expect(labels.every(label => Number.isFinite(label.lift) && label.y - label.lift >= 58)).toBe(true);
});

test('mobile ship names stay clear of battle status, helm, weapons and the centered sight', () => {
  const hud = [
    {left:12,right:177,top:260,bottom:406.9}, {left:40,right:350,top:100,bottom:261.3},
    {left:12,right:169.5,top:579.4,bottom:832}, {left:179,right:211,top:406,bottom:438},
  ];
  const labels = layoutShipLabels([{x:195,y:624.78},{x:194.25,y:427.59},{x:289.57,y:435.58}],390,hud);
  for (const label of labels) {
    const top = label.y - label.lift - 50, bottom = label.y - label.lift;
    expect(top).toBeGreaterThanOrEqual(8);
    for (const rect of hud) expect(label.x + 72 <= rect.left - 8 || label.x - 72 >= rect.right + 8 || bottom <= rect.top - 8 || top >= rect.bottom + 8).toBe(true);
  }
});
