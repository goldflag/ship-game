import { Mesh, MeshBasicNodeMaterial, type BufferGeometry, type Node } from 'three/webgpu';
import { abs, acos, cameraPosition, clamp, dot, float, Fn, length, max, mix, normalize, output, positionWorld, smoothstep, sqrt, step, texture, vec2, vec3, vec4 } from 'three/tsl';
import type { SkySystem } from '../../vendor/threejs-sky-pro/build/index.js';
import type { WaterSystem } from '../../vendor/threejs-water-pro/build/index.js';
import type { SkyProvider } from '../../vendor/threejs-water-pro/build/components/sky/SkyProvider';

/** A shared angular haze for the sky and its water/fog samples. No depth post-fog:
 * transparent smoke keeps the material's own distance, and nearby hulls stay clear. */
export class HorizonHaze {
  private veil?: Mesh<BufferGeometry, MeshBasicNodeMaterial>;

  apply(sky: SkySystem, provider: SkyProvider, water: WaterSystem): void {
    const sampleFog = provider.createFogSampler();
    const sampleReflection = provider.createReflectionSampler();
    // Borrow the light just above the aerosol band, then give it a restrained
    // blue-gray chroma. Sampling live radiance also preserves night brightness.
    const haze = Fn(([direction]: [Node<'vec3'>]) => {
      const ray = normalize(direction);
      const above = normalize(vec3(ray.x, .08, ray.z));
      // Sky Pro 2.2's angular LUT stores sqrt(unsigned sun azimuth / PI),
      // sqrt(elevation sine). Reuse that bake: no extra atmospheric ray march.
      const horizontal = above.xz, sunHorizontal = sky.sun.direction.xz;
      const cosine = clamp(dot(horizontal, sunHorizontal).div(max(length(horizontal).mul(length(sunHorizontal)), 1e-6)), -1, 1);
      const uv = vec2(sqrt(acos(cosine).div(Math.PI)), sqrt(above.y));
      const moon = sky.timeOfDay;
      const moonFill = moon.moonColor.mul(moon.moonIntensity).mul(moon.moonAmbient).mul(moon.moonPhaseIllumination)
        .mul(max(0, moon.moonDirection.y)).mul(moon.skyDarkness);
      const radiance = texture(sky.pipeline.skyViewLUTTexture, uv).level(float(0)).rgb.mul(sky.sun.intensity).add(moonFill);
      const luminance = dot(radiance, vec3(.2126, .7152, .0722));
      return vec3(.55, .78, 1.05).mul(luminance);
    });
    const weight = (direction: Node<'vec3'>) => float(1).sub(smoothstep(.003, .045, abs(normalize(direction).y)));
    provider.createFogSampler = () => direction => {
      const ray = direction as Node<'vec3'>;
      return mix(sampleFog(ray) as Node<'vec3'>, haze(ray), weight(ray));
    };
    provider.createReflectionSampler = () => (direction, roughness) => {
      const ray = direction as Node<'vec3'>;
      return mix(sampleReflection(ray, roughness) as Node<'vec3'>, haze(ray), weight(ray));
    };

    // Finish the sky after its cirrus/low-cloud composite, which otherwise
    // brings the ungraded aerosol band back over a corrected sky material.
    // Far-plane depth keeps land and ships in front; transparent effects draw
    // later and retain their own color and opacity.
    const skyMaterial = sky.pipeline.sky.material;
    const direction = skyMaterial.viewDirOverride as Node<'vec3'>;
    const veilMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
    veilMaterial.lights = false;
    veilMaterial.vertexNode = skyMaterial.vertexNode;
    veilMaterial.depthNode = skyMaterial.depthNode;
    veilMaterial.colorNode = haze(direction);
    veilMaterial.opacityNode = weight(direction);
    const veil = new Mesh(sky.pipeline.sky.mesh.geometry.clone(), veilMaterial);
    this.veil = veil;
    veil.name = 'Naval horizon haze';
    veil.frustumCulled = false;
    veil.renderOrder = -19; // Sky Pro 2.2 atmosphere overlay is -20; scene effects are 0.
    const skyMeshes = provider.getMeshes();
    provider.getMeshes = () => [...skyMeshes, veil];
    // Water Pro 3.5.1 has no surface-material extension API. This narrow adapter
    // runs after its regular shading/fog and survives its color-graph rebuilds.
    // Fade only distant, grazing-angle water; ships and transparent effects keep
    // their own materials. Review this binding when upgrading Water Pro.
    const surface = (water as unknown as { waterMaterial: MeshBasicNodeMaterial }).waterMaterial;
    const seaRay = positionWorld.sub(cameraPosition);
    const seaWeight = weight(seaRay).mul(smoothstep(250, 1800, length(seaRay))).mul(step(0, cameraPosition.y));
    // Water Pro uses premultiplied blending. Fade the complete RGBA toward
    // opaque haze so a translucent far ring cannot add haze over the sky twice.
    surface.outputNode = mix(output, vec4(haze(seaRay), 1), seaWeight);
    surface.needsUpdate = true;
    // Far clouds dissolve before reaching the softened horizon band.
    sky.clouds.fade.applyParams({ horizonMeltStart: 16000, horizonMeltEnd: 32000 });
  }

  dispose(): void {
    this.veil?.removeFromParent();
    this.veil?.geometry.dispose();
    this.veil?.material.dispose();
    this.veil = undefined;
  }
}
