import { expect, test } from 'bun:test';
import { FleetWakeFoam, type WakeShip } from './FleetWakeFoam';
import { PreparedPoseGroup } from './FrameScene';
import { shipPreset } from '../ships/presets';
import { CombatSimulation } from '../simulation/combat';
import { DataTexture, PerspectiveCamera } from 'three/webgpu';
import { cpuWakeFoamPainter } from './testing/wakeFoam';
import { SLICK_EXTENT, WAKE_EXTENT } from './WakeFoam';
import type { Vec3 } from '../ships/blueprint';

/** The fleet atlas interleaves red (trail foam, or the realistic trail's turbulence) and green (slick). */
const CHANNELS = 2;

function cpuImage(foam: FleetWakeFoam) {
  if (!(foam.texture instanceof DataTexture)) throw new Error('Wake fixtures paint with the CPU test painter');
  return foam.texture.image;
}

function ship(x: number, speed = 15): WakeShip {
  const definition = shipPreset('bismarck');
  const motion = { ...new CombatSimulation(definition).ship, x, speed };
  return { definition, motion, root: new PreparedPoseGroup() };
}
function tileHas(foam: FleetWakeFoam, slot: number, channel = 0): boolean {
  const size = cpuImage(foam).width, res = size / 8;
  const pixels = cpuImage(foam).data as Uint8Array;
  for (let row = 0; row < res; row++) {
    const start = ((Math.floor(slot / 8) * res + row) * size + slot % 8 * res) * CHANNELS;
    for (let x = 0; x < res; x++) if (pixels[start + x * CHANNELS + channel] > 0) return true;
  }
  return false;
}
const tileHasFoam = (foam: FleetWakeFoam, slot: number) => tileHas(foam, slot, 0);
/** A channel of a hull's tile at a world point, 0–1; channel 1 is laid over the wider slick square. */
function atWorld(foam: FleetWakeFoam, root: WakeShip['root'], x: number, z: number, channel = 0): number {
  const image = cpuImage(foam), size = image.width, res = size / 8, frame = foam.frame(root)!;
  const center = channel ? frame.slickCenter : frame.center, extent = channel ? SLICK_EXTENT : WAKE_EXTENT;
  const ix = Math.floor((x - center.x) / extent * res + res / 2), iz = Math.floor((z - center.y) / extent * res + res / 2);
  if (ix < 0 || iz < 0 || ix >= res || iz >= res) return 0;
  return (image.data as Uint8Array)[((Math.floor(frame.slot / 8) * res + iz) * size + frame.slot % 8 * res + ix) * CHANNELS + channel] / 255;
}

for (const realistic of [false, true]) {
  const mode = realistic ? 'realistic wake' : 'original wake';

  test(`${mode}: all 60 ships have independent trails across a wide battlefield, even with the player stopped`, () => {
    const foam = new FleetWakeFoam(256, cpuWakeFoamPainter);
    foam.realistic = realistic;
    const ships = Array.from({ length: 60 }, (_, i) => ship(i * 650, i === 0 ? 0 : 15));
    foam.update(ships, .1, []);
    for (let frame = 0; frame < 30; frame++) {
      ships.forEach(s => { s.motion.z -= s.motion.speed * .1; });
      foam.update(ships, .1, []);
    }
    expect(tileHasFoam(foam, 0)).toBe(false);
    for (let i = 1; i < ships.length; i++) expect(tileHasFoam(foam, i)).toBe(true);
    // Only the realistic trail paints a slick, and never for the stopped player.
    for (let i = 0; i < ships.length; i++) expect(tileHas(foam, i, 1)).toBe(realistic && i > 0);
    const beforePause = (cpuImage(foam).data as Uint8Array).slice();
    foam.update(ships, 0, []);
    expect(cpuImage(foam).data).toEqual(beforePause);
    // A teleported hull clears only its own trail, never its neighbours'.
    ships[1].motion.x += 1000;
    foam.update(ships, .1, []);
    expect(tileHasFoam(foam, 1)).toBe(false);
    expect(tileHas(foam, 1, 1)).toBe(false);
    expect(tileHasFoam(foam, 2)).toBe(true);
    // Repacking the atlas must replace a removed hull's tile immediately.
    foam.update([ships[2], ships[0]], .1, []);
    expect(tileHasFoam(foam, 0)).toBe(true);
    expect(tileHasFoam(foam, 1)).toBe(false);
    // A reset leaves nothing to paint on the next frame.
    foam.reset(); foam.update([], .1, []);
    expect((cpuImage(foam).data as Uint8Array).some(value => value > 0)).toBe(false);
    foam.dispose();
  });

  test(`${mode}: stopped and submerged ships emit no new trail; existing foam fades away`, () => {
    const foam = new FleetWakeFoam(256, cpuWakeFoamPainter), ships = [ship(0), ship(5000)];
    foam.realistic = realistic;
    ships[1].motion.y = -4;
    foam.update(ships, .1, []);
    for (let i = 0; i < 30; i++) {
      ships.forEach(s => { s.motion.z -= 1.5; });
      foam.update(ships, .1, []);
    }
    expect(tileHasFoam(foam, 0)).toBe(true);
    expect(tileHasFoam(foam, 1)).toBe(false);
    expect(tileHas(foam, 1, 1)).toBe(false);
    ships[0].motion.speed = 0;
    for (let i = 0; i < 560; i++) foam.update(ships, .1, []);
    expect(tileHasFoam(foam, 0)).toBe(false);
    if (realistic) {
      // The slick outlives the churned water by minutes, then goes too.
      expect(tileHas(foam, 0, 1)).toBe(true);
      for (let i = 0; i < 1900; i++) foam.update(ships, .1, []);
      expect(tileHas(foam, 0, 1)).toBe(false);
    }
    foam.dispose();
  });

  test(`${mode}: an off-centre editor hull emits foam at its own stern, not the authoring origin`, () => {
    const source = shipPreset('resolute'), volume = source.hull.volume!;
    const custom: WakeShip = {
      root: new PreparedPoseGroup(), motion: { x: 0, y: 0, z: 0, heading: 0, speed: 15 },
      definition: { ...source, hull: { ...source.hull, length: 616, beam: 232, volume: {
        ...volume, cells: volume.cells.map(cell => ({ faces: cell.faces.map(face => ({
          vertices: face.vertices.map(([x, y, z]): Vec3 => [x + 100, y, z + 200]),
        })) })),
      } } },
    };
    const foam = new FleetWakeFoam(256, cpuWakeFoamPainter);
    foam.realistic = realistic;
    foam.update([custom], .1, []);
    for (let i = 0; i < 20; i++) { custom.motion.z -= 1.5; foam.update([custom], .1, []); }
    // Resolute's actual hull runs from -112 to +108 m; translating the source
    // places its stern near (100, 308), then sailing moves it 30 m forward.
    expect(atWorld(foam, custom.root, 100, 200 - 2 + 220 * .468 - 30)).toBeGreaterThan(0);
    expect(atWorld(foam, custom.root, 0, custom.definition.hull.length * .468 - 30)).toBe(0);
    foam.dispose();
  });

  test(`${mode}: distant wake refreshes retain the full curved trail and zoom restores nearby cadence`, () => {
    const detailed = new FleetWakeFoam(256, cpuWakeFoamPainter), distant = new FleetWakeFoam(256, cpuWakeFoamPainter);
    detailed.realistic = distant.realistic = realistic;
    const ships = [ship(0)], camera = new PerspectiveCamera(52, 1, .5, 60000);
    camera.position.set(0, 1000, 6000);
    let detailedUpdates = 0, distantUpdates = 0;
    for (let tick = 0; tick < 300; tick++) {
      const motion = ships[0].motion; motion.heading += .003;
      motion.x += Math.sin(motion.heading) * motion.speed / 60;
      motion.z -= Math.cos(motion.heading) * motion.speed / 60;
      const a = detailed.texture.version, b = distant.texture.version;
      detailed.update(ships, 1 / 60, []); distant.update(ships, 1 / 60, [], camera);
      detailedUpdates += Number(detailed.texture.version !== a); distantUpdates += Number(distant.texture.version !== b);
    }
    expect(distantUpdates).toBeLessThan(detailedUpdates / 2);
    camera.zoom = 10; camera.updateProjectionMatrix();
    // Both publish the same accumulated path when inspected closely.
    detailed.update(ships, .21, []); distant.update(ships, .21, [], camera);
    expect(cpuImage(distant).data).toEqual(cpuImage(detailed).data);
    const version = distant.texture.version;
    distant.update(ships, .06, [], camera);
    expect(distant.texture.version).toBeGreaterThan(version);
    detailed.dispose(); distant.dispose();
  });
}

/** Sail one hull straight north at `speed` for `seconds`, then return its trail. */
function sail(speed: number, seconds: number, realistic = true) {
  const foam = new FleetWakeFoam(256, cpuWakeFoamPainter), hull = ship(0, speed);
  foam.realistic = realistic;
  for (let t = 0; t < seconds; t += .1) { hull.motion.z -= speed * .1; foam.update([hull], .1, []); }
  const { length, beam } = hull.definition.hull, stern = hull.motion.z + length * .468;
  /** Channel value `aft` metres behind the stern and `across` metres to starboard. */
  const at = (aft: number, across = 0, channel = 0) => atWorld(foam, hull.root, hull.motion.x + across, stern + aft, channel);
  const width = (aft: number, channel = 0, floor = .1) => {
    let span = 0;
    for (let across = -300; across <= 300; across += 2) if (at(aft, across, channel) > floor) span += 2;
    return span;
  };
  return { foam, hull, beam, at, width };
}

test('realistic wake: a continuous churned band about a beam wide that widens and fades astern', () => {
  const { foam, beam, at, width } = sail(15, 90);
  // Continuous down the track for the first few hundred metres: no gaps between samples or streams.
  for (let aft = 10; aft <= 300; aft += 3) expect(at(aft)).toBeGreaterThan(.3);
  // About a beam of dense turbulence at the stern, spreading slowly with the distance run.
  expect(width(20, 0, .5)).toBeGreaterThan(beam * .5);
  expect(width(20, 0, .5)).toBeLessThan(beam * 1.4);
  expect(width(500)).toBeGreaterThan(width(60));
  // Decaying with age: fresh water churns hardest.
  expect(at(30)).toBeGreaterThan(at(300));
  expect(at(300)).toBeGreaterThan(at(700));
  foam.dispose();
});

test('realistic wake: the slick outlasts the churned water and widens with the square root of distance', () => {
  const { foam, hull, beam, at, width } = sail(15, 200);
  // Far astern the white water has gone and the slick remains, a few beams wide.
  expect(at(1400)).toBe(0);
  expect(at(1400, 0, 1)).toBeGreaterThan(.2);
  expect(at(2400, 0, 1)).toBeGreaterThan(0);
  const near = width(200, 1), far = width(1800, 1);
  expect(far).toBeGreaterThan(near);
  // Nine times the distance widens it by well under nine times.
  expect(far).toBeLessThan(near * 4);
  expect(far).toBeLessThan(beam * 8);
  // Its square follows the trail: the hull sits near the leading edge, the trail fills the rest.
  const frame = foam.frame(hull.root)!;
  expect(frame.slickCenter.y - frame.center.y).toBeGreaterThan(SLICK_EXTENT * .3);
  foam.dispose();
});

test('realistic wake: every texel a trail paints lies inside the box the sampler reads it through', () => {
  const { foam, hull } = sail(15, 120), frame = foam.frame(hull.root)!, image = cpuImage(foam), size = image.width, res = size / 8;
  const painted = foam['entries'].get(hull.root)!.foam.painted;
  for (const channel of [0, 1] as const) {
    const center = channel ? frame.slickCenter : frame.center, extent = channel ? SLICK_EXTENT : WAKE_EXTENT, box = painted[channel];
    let inked = 0;
    for (let iz = 0; iz < res; iz++) for (let ix = 0; ix < res; ix++) {
      if (!(image.data as Uint8Array)[((Math.floor(frame.slot / 8) * res + iz) * size + frame.slot % 8 * res + ix) * CHANNELS + channel]) continue;
      inked++;
      const x = center.x + (ix + .5 - res / 2) * extent / res, z = center.y + (iz + .5 - res / 2) * extent / res;
      expect(x).toBeGreaterThanOrEqual(box.x); expect(x).toBeLessThanOrEqual(box.z);
      expect(z).toBeGreaterThanOrEqual(box.y); expect(z).toBeLessThanOrEqual(box.w);
    }
    expect(inked).toBeGreaterThan(100);
  }
  foam.dispose();
});

test('realistic wake: a slow hull leaves little white water, and the original trail no slick', () => {
  const fast = sail(15, 30), slow = sail(15 * .3, 30), original = sail(15, 30, false);
  expect(fast.at(40)).toBeGreaterThan(.7);
  expect(slow.at(12)).toBeLessThan(fast.at(40) * .25);
  expect(slow.at(12, 0, 1)).toBeGreaterThan(0);
  expect(original.at(100, 0, 1)).toBe(0);
  for (const trail of [fast, slow, original]) trail.foam.dispose();
});
