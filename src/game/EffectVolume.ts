import * as THREE from 'three/webgpu';
import { Break, Fn, If, Loop, attribute, cameraFar, cameraNear, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, cos, exp, float, mix,
  perspectiveDepthToViewZ, positionWorld, screenSize, sin, smoothstep,
  texture3D, vec3, vec4 } from 'three/tsl';

/** The ocean renders several targets: float scene depth and integer auxiliary
 * depth. WebGPU requires each viewport copy to use its source target's format. */
export class EffectDepthTextureNode extends THREE.ViewportDepthTextureNode {
  override getTextureForReference(reference: THREE.RenderTarget | THREE.CanvasTarget | null = null): THREE.Texture {
    const texture = super.getTextureForReference(reference);
    const source = reference && 'depthTexture' in reference ? reference.depthTexture : null;
    const type = source?.type ?? THREE.UnsignedIntType;
    if (texture.type !== type) { texture.type = type; texture.needsUpdate = true; }
    return texture;
  }
}

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
  sceneDepth: THREE.Node<'float'>, steps = 12, turbulent = false,
  illumination?: { direct: THREE.Node<'vec3'>; ambient: THREE.Node<'vec3'> }) {
  // Test the actual volume against opaque scene depth, not its bounding plane.
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  // This is a single bounding plane, not a closed transparent shell. Rendering
  // separate back/front passes repeats submission without adding another surface.
  material.forceSinglePass = true;
  const volume = texture3D(map);
  material.fragmentNode = Fn(() => {
    const sphere = attribute<'vec4'>('effectSphere', 'vec4');
    const state = attribute<'vec4'>('effectVolume', 'vec4'); // age, seed, heat, density
    const tint = attribute<'vec4'>('effectTint', 'vec4'); // color, major/minor axis ratio
    const evolution = attribute<'vec4'>('effectProgress', 'vec4'); // life, thinning, yaw, launch-axis Y
    const opacity = attribute<'float'>('effectOpacity', 'float');
    const radius = sphere.w.max(.001);
    const ray = positionWorld.sub(cameraPosition).normalize().toVar();
    const aspect = turbulent ? tint.w.max(1) : float(1);
    const horizontal = float(1).sub(evolution.w.mul(evolution.w)).max(0).sqrt();
    const axis = vec3(cos(evolution.z).mul(horizontal), evolution.w, sin(evolution.z).mul(horizontal)).toVar();
    const across = vec3(sin(evolution.z).negate(), 0, cos(evolution.z)).toVar();
    const up = across.cross(axis).toVar();
    const local = (vector: THREE.Node<'vec3'>) => turbulent
      ? vec3(vector.dot(axis), vector.dot(up).mul(aspect), vector.dot(across).mul(aspect)) : vector;
    const origin = local(cameraPosition.sub(sphere.xyz).div(radius)).toVar();
    const localRay = local(ray).toVar(), localSun = local(sun).toVar();
    // Intersect the oriented ellipsoid, rather than marching empty corners of
    // its bounding sphere. World ray distances still clip against scene depth.
    const rayLengthSq = localRay.dot(localRay).toVar();
    const along = origin.dot(localRay).toVar();
    const discriminant = along.mul(along).sub(rayLengthSq.mul(origin.dot(origin).sub(1))).toVar();
    discriminant.lessThanEqual(0).discard();
    const halfChord = discriminant.max(0).sqrt();
    const start = along.negate().sub(halfChord).div(rayLengthSq).max(0).toVar();
    const sceneViewZ = perspectiveDepthToViewZ(sceneDepth, cameraNear, cameraFar);
    const viewRayZ = cameraViewMatrix.mul(vec4(ray, 0)).z;
    const sceneDistance = sceneViewZ.div(viewRayZ).div(radius);
    const end = along.negate().add(halfChord).div(rayLengthSq).min(sceneDistance).toVar();
    end.lessThanEqual(start).discard();
    // Spend detail on projected size, including binocular magnification. The
    // fractional final step enters with zero weight, so camera motion never
    // switches abruptly between separate quality levels.
    const projectedRadius = screenSize.y.mul(.5).mul(cameraProjectionMatrix.mul(vec4(0, 1, 0, 0)).y).mul(radius)
      .div(cameraPosition.sub(sphere.xyz).length().max(radius));
    const detail = smoothstep(40, 180, projectedRadius).mul(float(1).sub(evolution.y.mul(.75)));
    const sampleCount = (turbulent ? mix(float(steps / 2), float(steps), detail) : float(steps)).toVar();
    const stride = end.sub(start).max(0).div(sampleCount).toVar();
    const seed = vec3(state.y, state.y.mul(.73), state.y.mul(.37)).toVar();
    const progress = turbulent ? evolution.x : float(0);
    const dissipation = turbulent ? evolution.y : float(0);
    const remaining = float(1).sub(dissipation).toVar();
    const breakup = smoothstep(.35, .98, progress).toVar();
    // All motion comes from particle age: pausing freezes both the cloud's
    // transport and its interior, independent of camera or wall-clock time.
    // Large propellant billows lose their initial energy as they expand. Slow
    // their turnover continuously, rather than cycling noise at a constant rate.
    const flowAge = state.x.mul(.6).add(1).log().div(.6).toVar();
    const phase = flowAge.mul(float(.38).add(sin(state.y).mul(.06))).toVar();
    const rolling = smoothstep(.1, 1.4, state.x).mul(float(.12).add(breakup.mul(.045))).toVar();
    const drift = vec3(flowAge.mul(.055), flowAge.mul(-.085), flowAge.mul(.036)).toVar();
    const offset = seed.add(turbulent
      ? drift.mul(.58)
      : vec3(state.x.mul(.035), state.x.mul(-.06), state.x.mul(.025))).toVar();
    const fineOffset = turbulent
      // Carry fine detail with the same flow as the large folds. Opposing noise
      // translations made the cloud appear to boil in place.
      ? seed.mul(1.3).add(drift.mul(1.85)).toVar()
      : offset.mul(1.3);
    const dilution = (turbulent ? exp(state.x.mul(-.055)).mul(remaining) : float(1)).toVar();
    const direct = illumination?.direct ?? vec3(1.25, 1.19, 1.08);
    const ambient = illumination?.ambient ?? vec3(.3, .35, .4);
    // Broad forward scattering gives backlit edges a gentle lift, without a
    // bright outline or another light march. Hoist it outside the density loop.
    const scattering = (turbulent ? float(.82).add(smoothstep(-.4, 1, ray.dot(sun)).mul(.45)) : float(1)).toVar();
    const densityAt = (point: THREE.Node<'vec3'>, detailed = true) => {
      // Unequal shears bend different parts of the cloud in different directions.
      // Warp the envelope as well as the detail, so the silhouette rolls too.
      const warped = turbulent ? point.add(vec3(
        sin(point.y.mul(3.6).add(point.z.mul(1.8)).add(phase).add(state.y)),
        sin(point.z.mul(3.2).add(point.x.mul(1.7)).sub(phase.mul(1.13)).add(state.y.mul(.73))),
        sin(point.x.mul(3.4).add(point.y.mul(1.6)).add(phase.mul(.87)).add(state.y.mul(.37)))
      ).mul(rolling)).toVar() : point;
      const base = volume.sample(warped.mul(.58).add(offset)).level(float(0)).toVar();
      // Fine erosion is restrained and advects with the large folds. Shadow
      // taps only need the packed octaves: four texture fetches per occupied
      // step, compared with five when the near shadow repeated fine erosion.
      const erosion = turbulent
        ? base.g.mul(.1).add(detailed ? volume.sample(warped.mul(1.85).add(fineOffset)).level(float(0)).g
          .mul(float(.085).add(breakup.mul(.09)).add(dissipation.mul(.1))) : base.b.mul(.045))
        : detailed ? volume.sample(warped.mul(1.85).add(fineOffset)).level(float(0)).g.mul(.22) : float(.07);
      // As gas mixes with air, erode the thin edges as well as optical density.
      // Fading only the final alpha leaves overlapping, solid-looking spheres.
      const shape = float(.71).sub(warped.length()).add(base.r.mul(.6)).sub(erosion).sub(dissipation.mul(.22));
      const worldY = turbulent ? point.x.mul(axis.y).add(point.y.mul(up.y).div(aspect)) : point.y;
      const body = smoothstep(0, .27, shape).mul(float(1).sub(smoothstep(.8, 1, point.length())))
        .mul(smoothstep(-.3, .8, sphere.y.add(worldY.mul(radius))));
      if (!turbulent) return body;
      // Air reaches the thinner folds late in the plume's life. Keep the dense
      // body connected while the edges soften, instead of rapidly punching holes.
      const threshold = breakup.mul(.22).add(dissipation.mul(.18));
      const holes = smoothstep(threshold.sub(.12), threshold.add(.26), base.g.mul(.6).add(base.b.mul(.4)));
      return body.mul(mix(float(1), holes, smoothstep(.1, .85, breakup).mul(.55)));
    };
    const transmittance = float(1).toVar(), radiance = vec3(0).toVar();
    Loop(steps, ({ i }) => {
      // Once less than 0.1% of the ray remains, further samples cannot make
      // a visible contribution. Keep the threshold low enough for hot gas too.
      If(transmittance.lessThan(.001).or(float(i).greaterThanEqual(sampleCount)), () => { Break(); });
      const stepLength = sampleCount.sub(float(i)).min(1).mul(stride).toVar();
      const point = origin.add(localRay.mul(start.add(float(i).mul(stride)).add(stepLength.mul(.5)))).toVar();
      const density = densityAt(point).toVar();
      // Empty space contributes neither light nor extinction. In particular,
      // eroded edges and the sea-level floor need no sunward density lookups.
      If(density.greaterThan(0), () => {
        const lightDepth = densityAt(point.add(localSun.mul(.24)), !turbulent).mul(.65)
          .add(densityAt(point.add(localSun.mul(.58)), false).mul(.85));
        const sunlight = exp(lightDepth.mul(-2.1).mul(remaining)).toVar();
        // Sky fill remains in shaded folds. The exposed edges scatter more sunlight.
        const lighting = ambient.add(direct.mul(sunlight).mul(scattering));
        const heat = state.z.mul(smoothstep(.08, .75, density)).toVar();
        const ember = mix(vec3(.9, .055, .004), vec3(5, .65, .022), heat);
        const emission = ember.mul(heat.mul(heat)).add(vec3(9, 6, 1.5).mul(smoothstep(.86, 1, heat)));
        const sampleAlpha = float(1).sub(exp(density.mul(state.w).mul(dilution).mul(stepLength).negate())).toVar();
        radiance.addAssign(tint.rgb.mul(lighting).add(emission).mul(sampleAlpha).mul(transmittance));
        transmittance.mulAssign(float(1).sub(sampleAlpha));
      });
    });
    const alpha = float(1).sub(transmittance).toVar();
    return vec4(radiance.div(alpha.max(.001)), alpha.mul(opacity));
  })();
  return material;
}
