import * as THREE from 'three/webgpu';
import { Fn, attribute, cameraPosition, cameraProjectionMatrix, float, mix, positionWorld, screenSize, smoothstep, texture3D, uv, vec3, vec4 } from 'three/tsl';
import type { EffectLighting } from './EffectLighting';

/** Flame tongues for `FireBatch` in `flame` mode: an animated, tapering tongue whose temperature
 * falls from a white-yellow root through orange to a sooty red tip. The shape comes from a periodic
 * 3D noise volume scrolled by particle age, so a paused game freezes the fire mid-flicker.
 *
 * Flames write depth and reject their empty margins: the ocean's depth composite would otherwise
 * classify low flames against the sea as water and erase them. */
export function fireFlameMaterial(noise: THREE.Data3DTexture): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: true, side: THREE.DoubleSide });
  material.forceSinglePass = true;
  material.alphaTest = .03;
  material.toneMapped = false;
  const volume = texture3D(noise);
  const state = attribute<'vec4'>('fireState', 'vec4'); // seed, life fraction, temperature, opacity
  const extra = attribute<'vec4'>('fireColor', 'vec4'); // unused, age in seconds
  const shape = Fn(() => {
    const coord = uv(), x = coord.x.sub(.5).mul(2), y = coord.y, seed = state.x, age = extra.w;
    const n1 = volume.sample(vec3(x.mul(.3).add(seed.mul(.131)), y.mul(.5).sub(age.mul(1.35)), seed.mul(.071))).level(float(0)).r;
    const n2 = volume.sample(vec3(x.mul(.8).add(seed.mul(.293)), y.mul(1.2).sub(age.mul(2.7)), seed.mul(.113).add(.5))).level(float(0)).g;
    // The tongue sways more toward its tip; the ragged top tears off as it rises.
    const bend = n1.sub(.5).mul(1.15).mul(y);
    const width = mix(float(.95), float(.08), y.pow(.8));
    const edge = float(1).sub(x.add(bend).abs().div(width)).toVar();
    const top = float(1).sub(smoothstep(.38, 1, y.add(n2.sub(.5).mul(.62))));
    const body = smoothstep(0, .5, edge.add(n2.sub(.5).mul(.55))).mul(top).mul(smoothstep(0, .1, y));
    const temperature = state.z.mul(float(1).sub(y.mul(.55))).mul(edge.clamp(0, 1).mul(.45).add(.55)).toVar();
    return vec4(temperature, body, 0, 0);
  })();
  material.colorNode = Fn(() => {
    const temperature = shape.x;
    let color = mix(vec3(.42, .045, .01), vec3(1, .3, .035), smoothstep(.08, .42, temperature));
    color = mix(color, vec3(1, .62, .18), smoothstep(.42, .72, temperature));
    color = mix(color, vec3(1, .9, .68), smoothstep(.72, 1.05, temperature));
    return vec4(color.mul(temperature.mul(3.2).add(.55)), 1);
  })();
  material.opacityNode = shape.y.mul(state.w);
  return material;
}

/** Smoke puffs for `FireBatch` in `smoke` mode, shaded as lumpy spheres in the scene's light.
 *
 * Coherent 3D noise gives each puff billowing relief, the sun or moon lights the facing side through
 * `EffectLighting`, sky fill reaches the shaded folds and backlit edges thin and brighten. Young puffs
 * near the fire carry an orange underglow on their downward faces. Each puff fades out inside its
 * own quad, so it needs no scene-depth read where it rises off the deck.
 *
 * Detail follows the puff's size on screen: a puff a few pixels across keeps only its broad shape
 * and a soft, several-pixel edge, so distant columns read as continuous smoke instead of stipple.
 * The noise volume has no mip levels, so this filtering is what keeps it from aliasing. */
export function fireSmokeMaterial(noise: THREE.Data3DTexture, lighting: EffectLighting): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  material.forceSinglePass = true;
  const volume = texture3D(noise);
  const center = attribute<'vec4'>('fireCenter', 'vec4'); // centre, radius
  const state = attribute<'vec4'>('fireState', 'vec4'); // seed, life fraction, underglow, opacity
  const tint = attribute<'vec4'>('fireColor', 'vec4'); // albedo, age in seconds
  const radius = center.w.max(.01);
  const shaded = Fn(() => {
    const offset = positionWorld.sub(center.xyz).div(radius).toVar();
    const r = offset.length().toVar();
    const toEye = cameraPosition.sub(center.xyz).normalize().toVar();
    const sun = lighting.sunDirection;
    // Radius in framebuffer pixels, including binocular magnification.
    const pixels = screenSize.y.mul(.5).mul(cameraProjectionMatrix.mul(vec4(0, 1, 0, 0)).y).mul(radius)
      .div(cameraPosition.sub(center.xyz).length().max(radius)).toVar();
    // Fine erosion cells are about a sixth of the radius: full strength once they span ~10 px.
    const detail = smoothstep(14, 70, pixels).toVar();
    const broad = smoothstep(3, 18, pixels).toVar();
    // Billows roll slowly with the puff's own age, not wall time: a paused game holds still.
    const seed = vec3(state.x.mul(.137), state.x.mul(.071), state.x.mul(.043));
    const p = offset.add(seed).add(vec3(tint.w.mul(.011), tint.w.mul(-.017), tint.w.mul(.007))).toVar();
    const coarse = volume.sample(p.mul(.38)).level(float(0)).r.toVar();
    const fine = volume.sample(p.mul(.72).add(.31)).level(float(0)).g.toVar();
    // Fine erosion only where it spans enough pixels to read as texture rather than grain; small
    // puffs keep a gentler, broad lobe so the column silhouette stays one continuous body.
    const n = coarse.sub(.5).mul(mix(float(.35), float(.62), broad)).add(fine.sub(.5).mul(detail.mul(.32))).toVar();
    // Older puffs erode into thinner, ragged wisps as they mix with air.
    const shape = float(1).sub(r).add(n.mul(1.05)).sub(state.y.mul(.2));
    // The edge ramp never narrows below about four pixels, and every puff reaches zero well inside
    // its quad, so no square corner or isolated fleck can show.
    const ramp = mix(float(.8), float(.45), detail).max(float(4).div(pixels.max(1)));
    const density = smoothstep(0, ramp, shape).mul(float(1).sub(smoothstep(.72, .98, r))).toVar();
    // Self-shadow: billows that are denser a step toward the light shade this one. A value tap,
    // not a derivative, so the trilinear noise shades smoothly instead of in texel blocks.
    const toward = volume.sample(p.add(sun.mul(.42)).mul(.38)).level(float(0)).r;
    const r2 = r.mul(r);
    const occluded = toward.sub(coarse).mul(mix(float(.8), float(2.4), broad)).add(float(1).sub(r2).max(0).mul(.25)).clamp(0, .8);
    const nz = float(1).sub(r2).max(0).sqrt();
    const normal = offset.add(toEye.mul(nz)).normalize().toVar();
    const wrap = normal.dot(sun).mul(.5).add(.5).clamp(0, 1).toVar();
    const thin = float(1).sub(density);
    const backlight = toEye.negate().dot(sun).clamp(0, 1).pow(6).mul(thin).mul(.9);
    const sky = normal.y.mul(.3).add(.7);
    const relief = mix(float(1), fine.mul(.35).add(.82), detail);
    const light = lighting.ambient.mul(sky).add(lighting.direct.mul(wrap.mul(wrap).mul(float(1).sub(occluded)).mul(.95).add(backlight))).mul(relief);
    const underside = normal.y.negate().mul(.5).add(.5).clamp(0, 1);
    const glow = vec3(1, .36, .08).mul(state.z).mul(underside.mul(underside).mul(.85).add(.15)).mul(density.mul(.5).add(.5));
    return vec4(tint.rgb.mul(light).add(glow), density);
  })();
  material.colorNode = vec4(shaded.rgb, 1);
  // No scene-depth soft edge: a column layers several screens of puffs, and the depth read over
  // that overdraw tripled a burning ship's close-up cost (≈5 → 1.6 ms). Each puff already fades to
  // nothing inside its own quad, so no hard line shows where it rises off the deck.
  material.opacityNode = shaded.a.mul(state.w);
  return material;
}
