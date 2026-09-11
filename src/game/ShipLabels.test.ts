import { expect, test } from 'bun:test';
import { Group, PerspectiveCamera, Vector3, WebGLCoordinateSystem, WebGPUCoordinateSystem } from 'three/webgpu';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from '../simulation/combat';
import { projectShipLabel, ShipLabels } from './ShipLabels';
import type { ShipView } from './ShipView';

test.each([
  { backend: 'WebGL', coordinateSystem: WebGLCoordinateSystem, reversedDepth: false },
  { backend: 'WebGPU', coordinateSystem: WebGPUCoordinateSystem, reversedDepth: false },
  { backend: 'WebGL', coordinateSystem: WebGLCoordinateSystem, reversedDepth: true },
  { backend: 'WebGPU', coordinateSystem: WebGPUCoordinateSystem, reversedDepth: true },
])('ship labels cull rear, offscreen and clipped ships ($backend, reversed depth: $reversedDepth)', ({ coordinateSystem, reversedDepth }) => {
  const camera = new PerspectiveCamera(52, 16 / 9, .5, 60000);
  camera.coordinateSystem = coordinateSystem;
  // Match the camera state set by WebGPURenderer before updating labels.
  Reflect.set(camera, '_reversedDepth', reversedDepth);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  expect(projectShipLabel(new Vector3(0, 0, -5000), camera, 1600, 900)).toEqual({ x: 800, y: 450 });
  expect(projectShipLabel(new Vector3(0, 0, 5000), camera, 1600, 900)).toBeNull();
  expect(projectShipLabel(new Vector3(0, 0, -.1), camera, 1600, 900)).toBeNull();
  expect(projectShipLabel(new Vector3(0, 0, -.4), camera, 1600, 900)).toBeNull();
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
      actor.controller = 'player'; // The opposing human still needs a visible contact label.
      labels.setFleet([view], [actor], sim.player.motion.id); labels.resize(1600, 900);
      const camera = new PerspectiveCamera(52, 16 / 9, .5, 60000);
      camera.coordinateSystem = WebGPUCoordinateSystem;
      Reflect.set(camera, '_reversedDepth', true);
      camera.updateProjectionMatrix();
      const maxHp = actor.damage.maxIntegrity;
      labels.update(camera, 0);
      const label = host.find('ship-label ship-label-enemy')!;
      expect(label.hidden).toBe(false);
      expect(host.find('ship-label-health')!.textContent).toBe('100%');
      expect(host.find('ship-label-meter')!.attributes.get('aria-valuemax')).toBe(String(maxHp));
      actor.damage.integrity *= .6;
      labels.update(camera, 1);
      expect(host.find('ship-label-health')!.textContent).toBe('60%');
      // The meter uses displayed whole HP; loss feedback retains the exact hit.
      const displayedHp = Math.round(actor.damage.integrity);
      expect(host.find('ship-label-meter')!.attributes.get('aria-valuenow')).toBe(String(displayedHp));
      expect(host.find('ship-label-fill')!.style.transform).toBe(`scaleX(${displayedHp / maxHp})`);
      expect(actor.damage.integrity).toBe(maxHp * .6);
      expect(Number.parseFloat(host.find('ship-label-loss')!.style.left)).toBeCloseTo(60, 12);
      expect(Number.parseFloat(host.find('ship-label-loss')!.style.width)).toBeCloseTo(40, 12);
      expect(host.find('ship-label-meter')!.children).not.toContain(host.find('ship-label-health')!);
      actor.damage.sunk = true;
      labels.update(camera, 2);
      expect(host.find('ship-label-meter')!.hidden).toBe(true);
      expect(host.find('ship-label-health')!.hidden).toBe(true);
      actor.damage.sunk = false;
      labels.update(camera, 3);
      expect(host.find('ship-label-meter')!.hidden).toBe(false);
      expect(host.find('ship-label-health')!.hidden).toBe(false);
      camera.lookAt(0, 0, 5000);
      labels.update(camera, 1);
      expect(label.hidden).toBe(true);
      camera.lookAt(0, 0, -5000);
      labels.update(camera, 1);
      expect(label.hidden).toBe(false);
    }
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('reported enemy hulls get a named label with the observed condition, hidden while unseen', () => {
  class Element {
    children: Element[] = [];
    className = ''; textContent = ''; hidden = false;
    style: Record<string, string> = {}; dataset: Record<string, string> = {};
    attributes = new Map<string, string>();
    classes = new Set<string>();
    classList = { toggle: (name: string, on: boolean) => { if (on) this.classes.add(name); else this.classes.delete(name); } };
    parent?: Element;
    append(...children: Element[]) { children.forEach(child => { child.parent = this; this.children.push(child); }); }
    appendChild(child: Element) { this.append(child); }
    replaceChildren() { this.children = []; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    find(name: string): Element | undefined {
      return this.className === name ? this : this.children.map(child => child.find(name)).find(Boolean);
    }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => new Element() } });
  try {
    const anchors = new Map<string, Vector3 | undefined>([['contact-0-3', new Vector3(0, 30, -5000)]]);
    const host = new Element(), labels = new ShipLabels(host as unknown as HTMLElement, id => anchors.get(id));
    labels.resize(1600, 900);
    const camera = new PerspectiveCamera(52, 16 / 9, .5, 60000);
    camera.coordinateSystem = WebGPUCoordinateSystem;
    Reflect.set(camera, '_reversedDepth', true);
    camera.updateProjectionMatrix();
    labels.setObserved([{ id: 'contact-0-3', name: 'Large warship', health: .62 }]);
    labels.update(camera, 0);
    const label = host.find('ship-label ship-label-enemy ship-label-observed')!;
    expect(label.hidden).toBe(false);
    expect(label.dataset.shipId).toBe('contact-0-3');
    expect(host.find('ship-label-name')!.textContent).toBe('Large warship');
    expect(host.find('ship-label-health')!.textContent).toBe('62%');
    expect(host.find('ship-label-fill')!.style.transform).toBe('scaleX(0.62)');
    expect(host.find('ship-label-meter')!.attributes.get('aria-valuenow')).toBe('62');
    // Identification renames the label in place; a stale sighting keeps the name but drops the meter.
    labels.setObserved([{ id: 'contact-0-3', name: 'Yamato' }]);
    labels.update(camera, 1);
    expect(host.find('ship-label-name')!.textContent).toBe('Yamato');
    expect(host.find('ship-label-meter')!.hidden).toBe(true);
    expect(host.find('ship-label-health')!.hidden).toBe(true);
    labels.setObserved([{ id: 'contact-0-3', name: 'Yamato', health: .1, sunk: true }]);
    labels.update(camera, 2);
    expect(label.classes.has('ship-label-sinking')).toBe(true);
    expect(host.find('ship-label-meter')!.hidden).toBe(true);
    // No visible exterior, no label; the report itself is still a contact on the chart.
    anchors.set('contact-0-3', undefined);
    labels.update(camera, 3);
    expect(label.hidden).toBe(true);
    labels.setObserved([]);
    expect(host.find('ship-label ship-label-enemy ship-label-observed')).toBeUndefined();
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
