import { expect, test } from 'bun:test';
import { Matrix4, MeshBasicNodeMaterial, PerspectiveCamera, Quaternion, Vector3 } from 'three/webgpu';
import { EffectParticlePool, effectTexture, type EffectParticle } from './EffectParticles';

const seeded = (seed: number) => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };
type Internals = { ages: Float64Array; lives: Float64Array; cursor: number; claimed: number; commit(): void };
const internalsOf = (pool: EffectParticlePool) => pool as unknown as Internals;

/** Probing the whole ring from the cursor: the first spent slot, else the first with the largest share of its life spent. */
function probeRing(pool: EffectParticlePool): number {
  const { ages, lives, cursor } = internalsOf(pool), capacity = ages.length;
  internalsOf(pool).commit();
  let chosen = cursor % capacity, spent = -Infinity;
  for (let probe = 0; probe < capacity; probe++) {
    const index = (cursor + probe) % capacity;
    if (ages[index] >= lives[index]) return index;
    if (ages[index] / lives[index] > spent) { spent = ages[index] / lives[index]; chosen = index; }
  }
  return chosen;
}

test('a crowded pool gives up the slot that probing its whole ring would, through bursts, ties and delays', () => {
  const texture = effectTexture('smoke'), pool = new EffectParticlePool(300, texture), internals = internalsOf(pool);
  const random = seeded(7), wind = new Vector3(2, 0, 1);
  try {
    for (let frame = 0; frame < 120; frame++) {
      pool.advance(frame % 9 ? 1 / 30 : 0, wind);
      const burst = frame % 5 ? 12 : 400;
      for (let i = 0; i < burst; i++) {
        const expected = probeRing(pool), p = pool.emit(new Vector3(random() * 100, 0, 0));
        expect(internals.claimed).toBe(expected);
        // Lives and ages as emitters set them: delayed drops, instant flashes, equal shares, already-spent slots.
        const kind = random();
        p.life = kind < .1 ? 1 : 1 + Math.floor(random() * 8);
        p.age = kind < .1 ? .5 : kind < .3 ? -random() * .3 : kind < .35 ? p.life : kind < .5 ? random() * p.life : 0;
      }
    }
    pool.reset();
    for (let i = 0; i < 5; i++) { pool.emit(new Vector3()); expect(internals.claimed).toBe(i); }
  } finally { pool.dispose(); texture.dispose(); }
});

const smooth = (n: number) => { const t = Math.max(0, Math.min(1, n)); return t * t * (3 - 2 * t); };
/** Every live slot's particle, and the one each instance of the last publication draws (found by its position). */
function drawnParticles(pool: EffectParticlePool, position: (index: number) => Vector3) {
  const live = Array.from({ length: pool.capacity }, (_, slot) => ({ slot, p: pool.particle(slot) })).filter(({ p }) => p.age >= 0 && p.age < p.life);
  const drawn = Array.from({ length: pool.count }, (_, index) => {
    const at = position(index), found = live.filter(({ p }) => Math.fround(p.position.x) === at.x && Math.fround(p.position.y) === at.y && Math.fround(p.position.z) === at.z);
    expect(found.length).toBe(1);
    return found[0];
  });
  expect(new Set(drawn.map(({ slot }) => slot)).size).toBe(drawn.length);
  return { live, drawn };
}

test('publication writes the poses three composes, back to front, and clears what the last one left', () => {
  const texture = effectTexture('smoke'), pool = new EffectParticlePool(64, texture, false, undefined, false, true);
  const camera = new PerspectiveCamera(55, 1.5, .5, 5000), random = seeded(19);
  camera.position.set(20, 30, 200); camera.lookAt(0, 10, 0); camera.updateMatrixWorld();
  const aligns = ['billboard', 'velocity', 'streak', 'water'] as const;
  try {
    for (let i = 0; i < 48; i++) {
      const p = pool.emit(new Vector3((random() - .5) * 120, random() * 40, (random() - .5) * 120));
      p.life = 4; p.age = random() * 3; p.size = 1 + random() * 3; p.growth = random() * 4; p.growthDecay = i % 2 ? .5 : 0; p.diffusion = .2;
      p.velocity.set((random() - .5) * 30, random() * 20, (random() - .5) * 30); p.angle = random() * 6; p.stretch = 1 + random() * 4;
      p.align = aligns[i % 4]; p.fadeIn = i % 3 ? 0 : .5; p.opacity = .8; p.color.setRGB(random(), random(), random());
    }
    pool.publish(camera);
    const actual = new Matrix4();
    const { live, drawn } = drawnParticles(pool, index => new Vector3().setFromMatrixPosition(pool.mesh.getMatrixAt(index, actual)));
    expect(pool.count).toBeGreaterThan(30);
    // Back to front, equal distances in slot order.
    const distance = (p: EffectParticle) => p.position.distanceToSquared(camera.position);
    for (let i = 1; i < drawn.length; i++) {
      const a = distance(drawn[i - 1].p), b = distance(drawn[i].p);
      expect(a > b || (a === b && drawn[i - 1].slot < drawn[i].slot)).toBe(true);
    }
    const inverse = camera.quaternion.clone().invert(), direction = new Vector3(), matrix = new Matrix4();
    drawn.forEach(({ p }, index) => {
      // The Quaternion/Matrix4 path the pool used before composing in place.
      const expansion = p.growthDecay > 0 ? (1 - Math.exp(-p.age * p.growthDecay)) / p.growthDecay : p.age;
      const size = Math.max(.01, p.size + p.growth * expansion + p.diffusion * p.age);
      let angle = p.angle, stretch = p.stretch;
      const orientation = new Quaternion();
      if (p.align === 'water') orientation.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
      else {
        orientation.copy(camera.quaternion);
        if (p.align !== 'billboard') {
          direction.copy(p.velocity).applyQuaternion(inverse);
          angle = Math.atan2(-direction.x, direction.y);
          const speed = Math.max(.01, p.velocity.length()), across = Math.hypot(direction.x, direction.y) / speed;
          stretch = p.align === 'streak' ? 1 + (stretch - 1) * Math.min(1, speed / 20) * across : stretch * Math.max(.35, across);
        }
      }
      orientation.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle));
      matrix.compose(p.position, orientation, new Vector3(size, size * stretch, 1));
      pool.mesh.getMatrixAt(index, actual);
      expect(Array.from(new Float32Array(actual.elements))).toEqual(Array.from(new Float32Array(matrix.elements)));
      const fade = (1 - smooth((p.age / p.life - .18) / .82)) * (p.fadeIn > 0 ? smooth(p.age / p.fadeIn) : 1);
      expect(pool.mesh.geometry.getAttribute('effectOpacity').getX(index)).toBe(Math.fround(p.opacity * fade));
      expect(pool.mesh.instanceColor!.getX(index)).toBe(Math.fround(p.color.r));
      expect(pool.mesh.instanceColor!.getZ(index)).toBe(Math.fround(p.color.b));
    });
    // Fewer particles next time: the slots they vacate are cleared, as before.
    const { ages, lives } = internalsOf(pool);
    for (const { slot } of live.slice(0, 30)) ages[slot] = lives[slot];
    pool.publish(camera);
    const matrices = pool.mesh.instanceMatrix.array, alphas = pool.mesh.geometry.getAttribute('effectOpacity').array;
    expect(pool.count).toBeLessThanOrEqual(18);
    expect(Array.from(matrices.subarray(pool.count * 16)).every(v => v === 0)).toBe(true);
    expect(Array.from(alphas.subarray(pool.count)).every(v => v === 0)).toBe(true);
  } finally { pool.dispose(); texture.dispose(); }
});

test('volumes face their centre, or cover the view from inside, and carry their gas, shape and colour through the sort', () => {
  const texture = effectTexture('smoke'), pool = new EffectParticlePool(40, texture, false, new MeshBasicNodeMaterial(), false, true);
  const camera = new PerspectiveCamera(60, 1.6, .5, 8000), random = seeded(29);
  camera.position.set(10, 25, 150); camera.lookAt(0, 15, 0); camera.updateMatrixWorld();
  try {
    for (let i = 0; i < 36; i++) {
      // The last one engulfs the camera.
      const p = pool.emit(i === 35 ? camera.position.clone().add(new Vector3(1, 0, 0)) : new Vector3((random() - .5) * 80, random() * 30, (random() - .5) * 80));
      p.life = 12; p.age = random() * 8; p.size = i === 35 ? 30 : 3 + random() * 6; p.growth = 5 + random() * 20; p.growthDecay = 1.2; p.diffusion = .6;
      p.heat = random(); p.cooling = .2 + random(); p.density = 2 + random(); p.dissipationTime = i % 3 ? 3 : 0; p.seed = random() * 100;
      p.volumeAspect = 1 + random() * 2; p.volumeYaw = random() * 6; p.volumeAxisY = random() - .5; p.opacity = .9; p.color.setRGB(random(), random(), random());
    }
    pool.publish(camera);
    const sphere = pool.mesh.geometry.getAttribute('effectSphere'), volume = pool.mesh.geometry.getAttribute('effectVolume');
    const tint = pool.mesh.geometry.getAttribute('effectTint'), progress = pool.mesh.geometry.getAttribute('effectProgress');
    const { drawn } = drawnParticles(pool, index => new Vector3(sphere.getX(index), sphere.getY(index), sphere.getZ(index)));
    expect(drawn.length).toBeGreaterThan(20);
    expect(drawn.some(({ p }) => p.position.distanceTo(camera.position) < 2)).toBe(true);
    const actual = new Matrix4(), expected = new Matrix4(), f32 = (values: ArrayLike<number>) => Array.from(new Float32Array(Array.from(values)));
    drawn.forEach(({ p }, index) => {
      const expansion = (1 - Math.exp(-p.age * p.growthDecay)) / p.growthDecay, size = Math.max(.01, p.size + p.growth * expansion + p.diffusion * p.age);
      const distance = p.position.distanceToSquared(camera.position), radiusSq = size * size / 4;
      if (distance > radiusSq * 1.01) {
        const orientation = new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(camera.position, p.position, new Vector3(0, 1, 0)));
        const scale = size * Math.sqrt(distance / (distance - radiusSq));
        expected.compose(p.position, orientation, new Vector3(scale, scale, 1));
      } else {
        const center = new Vector3(0, 0, .5).unproject(camera), corner = new Vector3(1, 1, .5).unproject(camera).sub(center).applyQuaternion(camera.quaternion.clone().invert());
        expected.compose(center, camera.quaternion, new Vector3(Math.abs(corner.x) * 2, Math.abs(corner.y) * 2, 1));
      }
      expect(f32(pool.mesh.getMatrixAt(index, actual).elements)).toEqual(f32(expected.elements));
      const dispersal = p.dissipationTime > 0 ? Math.max(0, p.age - p.cooling) / p.dissipationTime : 0;
      expect(f32([sphere.getW(index), volume.getX(index), volume.getY(index), volume.getZ(index), volume.getW(index)]))
        .toEqual(f32([size / 2, p.age, p.seed, p.heat * (1 - smooth(p.age / p.cooling)), p.density]));
      expect(f32([tint.getX(index), tint.getY(index), tint.getZ(index), tint.getW(index)])).toEqual(f32([p.color.r, p.color.g, p.color.b, 1 + (p.volumeAspect - 1) * Math.exp(-p.age * .7)]));
      expect(f32([progress.getX(index), progress.getY(index), progress.getZ(index), progress.getW(index)]))
        .toEqual(f32([p.age / p.life, 1 - Math.exp(-dispersal * dispersal), p.volumeYaw, p.volumeAxisY]));
    });
  } finally { pool.dispose(); texture.dispose(); }
});

test('the particle emit returned last stays tied to its slot until the next emit', () => {
  const texture = effectTexture('smoke'), pool = new EffectParticlePool(8, texture), camera = new PerspectiveCamera(), wind = new Vector3(1, 0, 0);
  camera.position.set(0, 0, 50); camera.updateMatrixWorld();
  try {
    const p = pool.emit(new Vector3(0, 5, 0));
    p.life = 10; p.velocity.set(2, 1, 0); p.drag = .5; p.wind = 1; p.spin = .3; p.opacity = .5;
    // It follows the slot's motion...
    pool.advance(.5, wind);
    expect(p.age).toBe(.5); expect(p.position).toEqual(pool.particle(0).position); expect(p.velocity).toEqual(pool.particle(0).velocity);
    expect(p.angle).toBe(.15); expect(p.position.x).toBeGreaterThan(1);
    // ...and a change after publication reaches the next one.
    pool.publish(camera);
    expect(pool.mesh.geometry.getAttribute('effectOpacity').getX(0)).toBeGreaterThan(.49);
    p.opacity = 0; pool.publish(camera);
    expect(pool.mesh.geometry.getAttribute('effectOpacity').getX(0)).toBe(0);
    // The next emit reuses the record for the next slot and leaves the first particle as it was.
    const q = pool.emit(new Vector3(3, 3, 3));
    expect(q).toBe(p); expect(q.age).toBe(0); expect(q.opacity).toBe(1); expect(q.position.x).toBe(3);
    q.life = 2; pool.advance(.1, wind);
    expect(pool.particle(0).opacity).toBe(0); expect(pool.particle(0).age).toBe(.6); expect(pool.particle(1).age).toBe(.1);
    // Reset spends it as it spends every slot.
    pool.reset(); expect(q.age).toBe(0); expect(q.life).toBe(0); expect(pool.particle(1).life).toBe(0);
  } finally { pool.dispose(); texture.dispose(); }
});

test('thinned emissions hand out a detached particle and leave the pool as it was', () => {
  const texture = effectTexture('smoke'), pools = [new EffectParticlePool(16, texture), new EffectParticlePool(16, texture)];
  const camera = new PerspectiveCamera(), wind = new Vector3();
  camera.position.set(0, 0, 50); camera.updateMatrixWorld();
  pools[1].density = .5;
  try {
    const kept: EffectParticle[] = [];
    for (let i = 0; i < 10; i++) for (const [k, pool] of pools.entries()) {
      const p = pool.emit(new Vector3(i, 0, 0));
      p.life = 5 + i; p.size = 2;
      if (k === 1) kept.push(p);
    }
    for (const pool of pools) pool.update(0, camera, wind);
    expect(pools[0].count).toBe(10); expect(pools[1].count).toBe(5);
    // Every other request went to one scratch record, which never enters the pool.
    expect(new Set(kept).size).toBe(2);
    expect(Array.from({ length: 5 }, (_, i) => pools[1].particle(i).life)).toEqual([6, 8, 10, 12, 14]);
  } finally { for (const pool of pools) pool.dispose(); texture.dispose(); }
});

test('ageing and publication visit only the slots that may be live, and match a pass over every slot', () => {
  const texture = effectTexture('droplet'), random = seeded(41);
  // The reference marks every slot live before each pass, so it visits them all as the pool did before it kept the marks.
  const pools = [new EffectParticlePool(300, texture, false, undefined, true, true), new EffectParticlePool(300, texture, false, undefined, true, true)];
  const marks = (pool: EffectParticlePool) => (pool as unknown as { live: Int32Array }).live;
  const everySlot = (pool: EffectParticlePool) => marks(pool).fill(-1, 0, 9).fill((1 << (300 - 288)) - 1, 9);
  const camera = new PerspectiveCamera(50, 1.6, .5, 8000), wind = new Vector3(3, 0, -2);
  let fewest = Infinity;
  try {
    for (let frame = 0; frame < 400; frame++) {
      const dt = frame % 37 ? 1 / 60 : 0;
      everySlot(pools[1]);
      for (const pool of pools) pool.advance(dt, wind);
      const values = Array.from({ length: frame % 50 ? 2 : 280 }, () => Array.from({ length: 9 }, random));
      for (const pool of pools) for (const v of values) {
        const p = pool.emit(new Vector3((v[0] - .5) * 200, v[1] * 30, (v[2] - .5) * 200), v[3] < .5 ? 'a' : undefined);
        p.life = v[4] < .1 ? .05 : .3 + v[4] * .4; p.age = v[5] < .3 ? -v[5] : 0; p.size = .2 + v[6] * 3;
        p.velocity.set((v[7] - .5) * 20, v[8] * 25, 0); p.gravity = 9.81; p.drag = v[8] < .5 ? 0 : .12; p.waterline = v[3] < .4; p.align = v[6] < .5 ? 'streak' : 'billboard';
      }
      camera.position.set(Math.sin(frame / 40) * 150, 20, 120); camera.lookAt(0, 5, 0); camera.updateMatrixWorld();
      everySlot(pools[1]);
      for (const pool of pools) pool.publish(camera, frame % 3 ? undefined : 'a');
      const [a, b] = pools;
      expect(a.count).toBe(b.count);
      expect(Array.from(a.mesh.instanceMatrix.array)).toEqual(Array.from(b.mesh.instanceMatrix.array));
      expect(Array.from(a.mesh.geometry.getAttribute('effectOpacity').array)).toEqual(Array.from(b.mesh.geometry.getAttribute('effectOpacity').array));
      expect(Array.from(a.mesh.instanceColor!.array)).toEqual(Array.from(b.mesh.instanceColor!.array));
      if (frame % 50 === 49) fewest = Math.min(fewest, Array.from(marks(a)).reduce((n, word) => n + [...Array(32).keys()].filter(i => word & (1 << i)).length, 0));
    }
    // Most slots are spent before each burst: the pool then marks far fewer than its capacity.
    expect(fewest).toBeLessThan(100);
  } finally { for (const pool of pools) pool.dispose(); texture.dispose(); }
});
