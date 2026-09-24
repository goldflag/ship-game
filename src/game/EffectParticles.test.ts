import { expect, test } from 'bun:test';
import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three/webgpu';
import { EffectParticlePool, effectTexture, type EffectParticle } from './EffectParticles';

const seeded = (seed: number) => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };
type Internals = { particles: EffectParticle[]; cursor: number };

/** Probing the whole ring from the cursor: the first spent slot, else the first with the largest share of its life spent. */
function probeRing({ particles, cursor }: Internals): number {
  let chosen = cursor % particles.length, spent = -Infinity;
  for (let probe = 0; probe < particles.length; probe++) {
    const index = (cursor + probe) % particles.length, p = particles[index];
    if (p.age >= p.life) return index;
    if (p.age / p.life > spent) { spent = p.age / p.life; chosen = index; }
  }
  return chosen;
}

test('a crowded pool gives up the slot that probing its whole ring would, through bursts, ties and delays', () => {
  const texture = effectTexture('smoke'), pool = new EffectParticlePool(300, texture), internals = pool as unknown as Internals;
  const random = seeded(7), wind = new Vector3(2, 0, 1);
  try {
    for (let frame = 0; frame < 120; frame++) {
      pool.advance(frame % 9 ? 1 / 30 : 0, wind);
      const burst = frame % 5 ? 12 : 400;
      for (let i = 0; i < burst; i++) {
        const expected = probeRing(internals), p = pool.emit(new Vector3(random() * 100, 0, 0));
        expect(internals.particles.indexOf(p)).toBe(expected);
        // Lives and ages as emitters set them: delayed drops, instant flashes, equal shares, already-spent slots.
        const kind = random();
        p.life = kind < .1 ? 1 : 1 + Math.floor(random() * 8);
        p.age = kind < .1 ? .5 : kind < .3 ? -random() * .3 : kind < .35 ? p.life : kind < .5 ? random() * p.life : 0;
      }
    }
    pool.reset();
    for (let i = 0; i < 5; i++) expect(internals.particles.indexOf(pool.emit(new Vector3()))).toBe(i);
  } finally { pool.dispose(); texture.dispose(); }
});

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
    const particles = (pool as unknown as Internals).particles.filter(p => p.age < p.life);
    const drawn = particles.filter(p => pool.count && p.distance > 0).sort((a, b) => b.distance - a.distance);
    expect(pool.count).toBe(drawn.length);
    const inverse = camera.quaternion.clone().invert(), direction = new Vector3(), matrix = new Matrix4(), actual = new Matrix4();
    drawn.forEach((p, index) => {
      // The Quaternion/Matrix4 path the pool used before composing in place.
      const smooth = (n: number) => { const t = Math.max(0, Math.min(1, n)); return t * t * (3 - 2 * t); };
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
    });
    // Fewer particles next time: the slots they vacate are cleared, as before.
    for (const p of particles.slice(0, 30)) p.age = p.life;
    pool.publish(camera);
    const matrices = pool.mesh.instanceMatrix.array, alphas = pool.mesh.geometry.getAttribute('effectOpacity').array;
    expect(Array.from(matrices.subarray(pool.count * 16)).every(v => v === 0)).toBe(true);
    expect(Array.from(alphas.subarray(pool.count)).every(v => v === 0)).toBe(true);
  } finally { pool.dispose(); texture.dispose(); }
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
