import { expect, test } from 'bun:test';
import { Group, Scene } from 'three/webgpu';
import { ShipWake } from './ShipWake';
import type { WakeShip } from './FleetWakeFoam';
import { PreparedPoseGroup } from './FrameScene';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';

test('fleet displacement respects the vendor capacity, hull size, depth, and replacement lifecycle', () => {
  type Native = ConstructorParameters<typeof ShipWake>[0];
  const generators = new Map<number, { object: unknown; options: Record<string, unknown>; isFirstFrame: boolean }>();
  let id = 0;
  const native = {
    resolution: 256, enabled: true, setCamera() {}, getSampler: () => ({}),
    addGenerator(object: unknown, options: Record<string, unknown>) {
      generators.set(++id, { object, options, isFirstFrame: true }); return id;
    },
    removeGenerator: (key: number) => generators.delete(key),
    updateGenerator(key: number, options: Record<string, unknown>) { Object.assign(generators.get(key)!.options, options); },
    getGenerators: () => generators,
  } as unknown as Native;
  const wake = new ShipWake(native, new Group(), new Scene());
  const definition = shipPreset('fletcher'), initial = new CombatSimulation(definition).ship;
  const ships: WakeShip[] = Array.from({ length: 12 }, (_, i) => ({
    definition, root: new PreparedPoseGroup(), motion: { ...initial, x: i * 40, z: 0, speed: 15 },
  }));
  ships[0].motion.speed = 0;
  ships[1].motion.y = -4;
  wake.update(ships, .1);
  expect(generators.size).toBe(16);
  expect([...generators.values()].filter(g => g.options.active).length).toBe(12);
  const bow = [...generators.values()][0];
  expect((bow.options.offset as { z: number }).z).toBeCloseTo(-definition.hull.length * .448);
  expect(bow.options.radius).toBeCloseTo(definition.hull.beam * .28);
  // Moving bots continue to energize the field when the player has stopped.
  expect(native.foamStrength).toBeGreaterThan(0);
  wake.update([ships[11]], .1);
  expect(generators.size).toBe(2);
  expect([...generators.values()].every(g => g.object === ships[11].root)).toBe(true);
  generators.forEach(g => { g.isFirstFrame = false; });
  wake.reset();
  expect([...generators.values()].every(g => g.isFirstFrame)).toBe(true);
  wake.dispose();
  expect(generators.size).toBe(0);
});
