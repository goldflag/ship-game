import { expect, test } from 'bun:test';
import { Group, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from '../simulation/combat';
import { projectShipLabel, ShipLabels } from './ShipLabels';
import type { ShipView } from './ShipView';

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

test('overhead condition percentages, meters and loss spans use each ship maximum', () => {
  // Minimal DOM surface; exercise the actual label updates and Three.js projection.
  class Element {
    children: Element[] = [];
    className = ''; textContent = ''; hidden = false;
    style: Record<string, string> = {}; dataset: Record<string, string> = {};
    attributes = new Map<string, string>();
    classList = { toggle() {} };
    append(...children: Element[]) { this.children.push(...children); }
    appendChild(child: Element) { this.append(child); }
    replaceChildren() { this.children = []; }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    find(name: string): Element | undefined {
      return this.className === name ? this : this.children.map(child => child.find(name)).find(Boolean);
    }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => new Element() } });
  try {
    for (const id of ['yamato', 'baltimore']) {
      const sim = new CombatSimulation(shipPreset(id)), actor = sim.target;
      const root = new Group(); root.add(new Group()); root.position.z = -5000;
      const view = { root, motion: actor.motion } as unknown as ShipView;
      const host = new Element(), labels = new ShipLabels(host as unknown as HTMLElement);
      labels.setFleet([view], [actor]); labels.resize(1600, 900);
      const camera = new PerspectiveCamera(52, 16 / 9, .5, 60000);
      const maxHp = actor.damage.maxIntegrity;
      labels.update(camera, 0);
      expect(host.find('ship-label-health')!.textContent).toBe('100% · operational');
      expect(host.find('ship-label-meter')!.attributes.get('aria-valuemax')).toBe(String(maxHp));
      actor.damage.integrity *= .6;
      labels.update(camera, 1);
      expect(host.find('ship-label-health')!.textContent).toBe('60% · operational');
      expect(host.find('ship-label-fill')!.style.transform).toBe('scaleX(0.6)');
      expect(host.find('ship-label-loss')!.style.left).toBe('60%');
      expect(host.find('ship-label-loss')!.style.width).toBe('40%');
    }
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
