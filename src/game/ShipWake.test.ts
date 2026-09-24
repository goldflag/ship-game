import { expect, test } from 'bun:test';
import { float, vec3 } from 'three/tsl';
import { ShipWake } from './ShipWake';
import { cpuWakeFoamPainter } from './testing/wakeFoam';
import type { WakeShip } from './FleetWakeFoam';
import { PreparedPoseGroup } from './FrameScene';
import { CombatSimulation } from '../simulation/combat';
import { shipPreset } from '../ships/presets';
import type { Vec3 } from '../ships/blueprint';
import type { WakeFieldApi, WakeSampler } from './ocean/contracts';

test('fleet displacement respects the field capacity, hull size, depth, and replacement lifecycle', () => {
  const generators = new Map<number, { object: unknown; options: Record<string, unknown> }>();
  let id = 0, resets = 0;
  const center = { x: 0, z: 0 };
  const field: WakeFieldApi = {
    resolution: 256, enabled: true, worldSize: 0, friction: 0, foamStrength: 0, foamBreakThreshold: 0, foamLifetime: 0,
    setCenter(x, z) { Object.assign(center, { x, z }); },
    addGenerator(object, options = {}) { generators.set(++id, { object, options: { ...options } }); return id; },
    removeGenerator: key => generators.delete(key),
    updateGenerator(key, options) { Object.assign(generators.get(key)!.options, options); return true; },
    reset() { resets++; },
    sampler: { height: () => float(0), normal: () => vec3(0, 1, 0), foam: () => float(0) },
    step() {}, dispose() {},
  };
  let bound: WakeSampler | null = null;
  const wake = new ShipWake({ wake: field, setWakeSampler(sampler) { bound = sampler; } }, cpuWakeFoamPainter);
  expect(bound).not.toBeNull();
  expect(field.foamLifetime).toBe(9);
  const definition = shipPreset('fletcher'), initial = new CombatSimulation(definition).ship;
  const ships: WakeShip[] = Array.from({ length: 12 }, (_, i) => ({
    definition, root: new PreparedPoseGroup(), motion: { ...initial, x: i * 40, z: 0, speed: 15 },
  }));
  ships[0].motion.speed = 0;
  ships[1].motion.y = -4;
  wake.update(ships, .1);
  expect(center).toEqual({ x: 0, z: 0 });
  expect(generators.size).toBe(16);
  expect([...generators.values()].filter(g => g.options.active).length).toBe(12);
  const bow = [...generators.values()][0];
  expect((bow.options.offset as { z: number }).z).toBeCloseTo(-definition.hull.length * .448);
  expect(bow.options.radius).toBeCloseTo(definition.hull.beam * .28);
  // Moving bots continue to energize the field when the player has stopped.
  expect(field.foamStrength).toBeGreaterThan(0);
  wake.update([ships[11]], .1);
  expect(generators.size).toBe(2);
  expect([...generators.values()].every(g => g.object === ships[11].root)).toBe(true);
  const source = shipPreset('resolute'), volume = source.hull.volume!;
  const custom: WakeShip = { ...ships[11], root: new PreparedPoseGroup(), definition: {
    ...source, hull: { ...source.hull, length: 616, beam: 232, volume: {
      ...volume, cells: volume.cells.map(cell => ({ faces: cell.faces.map(face => ({
        vertices: face.vertices.map(([x, y, z]): Vec3 => [x + 100, y, z + 200]),
      })) })),
    } },
  } };
  wake.update([custom], .1);
  const [customBow, customStern] = [...generators.values()];
  expect(customBow.options.offset).toEqual({ x: 100, y: 0, z: 198 - 220 * .448 });
  expect(customStern.options.offset).toEqual({ x: 100, y: 0, z: 198 + 220 * .448 });
  expect(customStern.options.radius).toBeCloseTo(32 * .39);
  wake.reset();
  expect(resets).toBe(1);
  wake.dispose();
  expect(generators.size).toBe(0);
  expect(bound).toBeNull();
});

test('the ocean realism switch rebinds the realistic wake live, and off restores the original sampler', () => {
  const field: WakeFieldApi = {
    resolution: 256, enabled: true, worldSize: 0, friction: 0, foamStrength: 0, foamBreakThreshold: 0, foamLifetime: 0,
    setCenter() {}, addGenerator: () => 1, removeGenerator: () => true, updateGenerator: () => true, reset() {},
    sampler: { height: () => float(0), normal: () => vec3(0, 1, 0), foam: () => float(0) }, step() {}, dispose() {},
  };
  const realism = { wake: true };
  const bindings: (WakeSampler | null)[] = [];
  const wake = new ShipWake({ wake: field, realism, setWakeSampler(sampler) { bindings.push(sampler); } }, cpuWakeFoamPainter);
  // Realistic by default: the surface also reads the bubble clouds and the slick.
  expect(bindings).toHaveLength(1);
  expect(bindings[0]?.slick).toBeFunction();
  expect(bindings[0]?.bubbles).toBeFunction();
  wake.update([], .1);
  expect(bindings).toHaveLength(1);
  realism.wake = false;
  wake.update([], .1);
  expect(bindings).toHaveLength(2);
  expect(Object.keys(bindings[1]!).sort()).toEqual(['foam', 'height', 'normal', 'shelter']);
  // Without the hull shelter too, the surface reads exactly the original sampler.
  wake.shelter = false;
  wake.update([], .1);
  expect(bindings).toHaveLength(3);
  expect(Object.keys(bindings[2]!).sort()).toEqual(['foam', 'height', 'normal']);
  realism.wake = true;
  wake.update([], 0);
  expect(bindings).toHaveLength(4);
  expect(bindings[3]?.slick).toBeFunction();
  expect(bindings[3]?.shelter).toBeUndefined();
  wake.dispose();
});
