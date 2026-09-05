import * as THREE from 'three/webgpu';
import { Fn, Loop, attribute, cameraFar, cameraNear, cameraPosition, cameraViewMatrix, exp, float, mix,
  perspectiveDepthToViewZ, positionWorld, sin, smoothstep,
  texture3D, vec3, vec4 } from 'three/tsl';

/** Original periodic Worley volumes, following Sky Pro's coarse-shape / fine-erosion approach.
 * The sky package's private material graph and baked assets are not coupled to combat. */
export function effectVolumeTexture(): THREE.Data3DTexture {
  const size = 32, pixels = new Uint8Array(size ** 3 * 4);
  const hash = (x: number, y: number, z: number, seed: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.19) * 43758.5453;
    return n - Math.floor(n);
  };
  const worley = (x: number, y: number, z: number, cells: number) => {
    x *= cells; y *= cells; z *= cells;
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
    let distance = 3;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy, cz = iz + dz;
      const wx = (cx + cells) % cells, wy = (cy + cells) % cells, wz = (cz + cells) % cells;
      const px = cx + hash(wx, wy, wz, 1) - x;
      const py = cy + hash(wx, wy, wz, 2) - y;
      const pz = cz + hash(wx, wy, wz, 3) - z;
      distance = Math.min(distance, px * px + py * py + pz * pz);
    }
    return Math.max(0, 1 - Math.sqrt(distance));
  };
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = ((z * size + y) * size + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      pixels[i + channel] = Math.round(worley((x + .5) / size, (y + .5) / size, (z + .5) / size, 4 * (channel + 1)) * 255);
    }
    pixels[i + 3] = 255;
  }
  const map = new THREE.Data3DTexture(pixels, size, size, size);
  map.minFilter = map.magFilter = THREE.LinearFilter;
  map.wrapS = map.wrapT = map.wrapR = THREE.RepeatWrapping;
  map.unpackAlignment = 1; map.needsUpdate = true;
  return map;
}

/** Local raymarched gas, with eroded 3D density, two sunward shadow taps and
 * Beer–Lambert transmittance. Geometry only bounds the march; detail lives in 3D.
 * This is a bounded visual approximation, not a fluid or combustion simulation. */
export function effectVolumeMaterial(map: THREE.Data3DTexture, sun: THREE.Node<'vec3'>,
  sceneDepth: THREE.Node<'float'>, steps = 12, turbulent = false) {
  // Test the actual volume against opaque scene depth, not its bounding plane.
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  const volume = texture3D(map);
  material.fragmentNode = Fn(() => {
    const sphere = attribute<'vec4'>('effectSphere', 'vec4');
    const state = attribute<'vec4'>('effectVolume', 'vec4'); // age, seed, heat, density
    const tint = attribute<'vec3'>('effectTint', 'vec3');
    const opacity = attribute<'float'>('effectOpacity', 'float');
    const radius = sphere.w.max(.001);
    const ray = positionWorld.sub(cameraPosition).normalize().toVar();
    const origin = cameraPosition.sub(sphere.xyz).div(radius).toVar();
    const along = origin.dot(ray).toVar();
    const discriminant = along.mul(along).sub(origin.dot(origin)).add(1).toVar();
    discriminant.lessThanEqual(0).discard();
    const halfChord = discriminant.max(0).sqrt();
    const start = along.negate().sub(halfChord).max(0).toVar();
    const sceneViewZ = perspectiveDepthToViewZ(sceneDepth, cameraNear, cameraFar);
    const viewRayZ = cameraViewMatrix.mul(vec4(ray, 0)).z;
    const sceneDistance = sceneViewZ.div(viewRayZ).div(radius);
    const end = along.negate().add(halfChord).min(sceneDistance).toVar();
    end.lessThanEqual(start).discard();
    const stride = end.sub(start).max(0).div(steps).toVar();
    const seed = vec3(state.y, state.y.mul(.73), state.y.mul(.37)).toVar();
    const progress = turbulent ? attribute<'float'>('effectProgress', 'float') : float(0);
    const breakup = smoothstep(.35, .98, progress).toVar();
    // All motion comes from particle age: pausing freezes both the cloud's
    // transport and its interior, independent of camera or wall-clock time.
    // Large propellant billows lose their initial energy as they expand. Slow
    // their turnover continuously, rather than cycling noise at a constant rate.
    const flowAge = state.x.mul(.6).add(1).log().div(.6).toVar();
    const phase = flowAge.mul(float(.38).add(sin(state.y).mul(.06))).toVar();
    const rolling = smoothstep(.1, 1.4, state.x).mul(float(.065).add(breakup.mul(.035))).toVar();
    const drift = vec3(flowAge.mul(.055), flowAge.mul(-.085), flowAge.mul(.036)).toVar();
    const offset = seed.add(turbulent
      ? drift.mul(.58)
      : vec3(state.x.mul(.035), state.x.mul(-.06), state.x.mul(.025))).toVar();
    const fineOffset = turbulent
      // Carry fine detail with the same flow as the large folds. Opposing noise
      // translations made the cloud appear to boil in place.
      ? seed.mul(1.3).add(drift.mul(1.85)).toVar()
      : offset.mul(1.3);
    const dilution = (turbulent ? exp(state.x.mul(-.055)) : float(1)).toVar();
    const densityAt = (point: THREE.Node<'vec3'>, detailed = true) => {
      // Unequal shears bend different parts of the cloud in different directions.
      // Warp the envelope as well as the detail, so the silhouette rolls too.
      const warped = turbulent ? point.add(vec3(
        sin(point.y.mul(3.6).add(point.z.mul(1.8)).add(phase).add(state.y)),
        sin(point.z.mul(3.2).add(point.x.mul(1.7)).sub(phase.mul(1.13)).add(state.y.mul(.73))),
        sin(point.x.mul(3.4).add(point.y.mul(1.6)).add(phase.mul(.87)).add(state.y.mul(.37)))
      ).mul(rolling)).toVar() : point;
      const base = volume.sample(warped.mul(.58).add(offset)).level(float(0)).toVar();
      const erosion = detailed ? volume.sample(warped.mul(1.85).add(fineOffset)).level(float(0)).g
        .mul(turbulent ? float(.22).add(breakup.mul(.12)) : .22) : float(.07);
      const shape = float(.71).sub(warped.length()).add(base.r.mul(.6)).sub(erosion);
      const body = smoothstep(0, .27, shape).mul(float(1).sub(smoothstep(.8, 1, point.length())))
        .mul(smoothstep(-.3, .8, sphere.y.add(point.y.mul(radius))));
      if (!turbulent) return body;
      // Air reaches the thinner folds late in the plume's life. Keep the dense
      // body connected while the edges soften, instead of rapidly punching holes.
      const threshold = breakup.mul(.22);
      const holes = smoothstep(threshold.sub(.12), threshold.add(.26), base.g.mul(.6).add(base.b.mul(.4)));
      return body.mul(mix(float(1), holes, smoothstep(.1, .85, breakup).mul(.55)));
    };
    const transmittance = float(1).toVar(), radiance = vec3(0).toVar();
    Loop(steps, ({ i }) => {
      const point = origin.add(ray.mul(start.add(float(i).add(.5).mul(stride)))).toVar();
      const density = densityAt(point).toVar();
      const lightDepth = densityAt(point.add(sun.mul(.24))).mul(.65)
        .add(densityAt(point.add(sun.mul(.58)), false).mul(.85));
      const sunlight = exp(lightDepth.mul(-2.1)).toVar();
      // Sky fill remains in shaded folds. The exposed edges scatter more sunlight.
      const lighting = vec3(.3, .35, .4).add(vec3(1.25, 1.19, 1.08).mul(sunlight));
      const heat = state.z.mul(smoothstep(.08, .75, density)).toVar();
      const ember = mix(vec3(.9, .055, .004), vec3(5, .65, .022), heat);
      const emission = ember.mul(heat.mul(heat)).add(vec3(9, 6, 1.5).mul(smoothstep(.86, 1, heat)));
      const sampleAlpha = float(1).sub(exp(density.mul(state.w).mul(dilution).mul(stride).negate())).toVar();
      radiance.addAssign(tint.mul(lighting).add(emission).mul(sampleAlpha).mul(transmittance));
      transmittance.mulAssign(float(1).sub(sampleAlpha));
    });
    const alpha = float(1).sub(transmittance).toVar();
    return vec4(radiance.div(alpha.max(.001)), alpha.mul(opacity));
  })();
  return material;
}
