import { Mesh, type Node, type Object3D } from 'three/webgpu';
import { Fn, If, attribute, float, mx_noise_float, positionWorld, smoothstep, uniform, vec3 } from 'three/tsl';
import { WaterSurfaceMaterial, type WaterSystem } from '../../vendor/threejs-water-pro/build/index.js';

/** Fixed-point steps that undo the choppy sideways displacement; the vendor's buoys use three. */
const SOLVE_STEPS = 2;
type Height = (x: Node<'float'>, z: Node<'float'>) => Node<'float'>;
type Displacement = { x: Node<'float'>; y: Node<'float'>; z: Node<'float'> };

/** The FFT sea's height at a world position, as the water mesh draws it: its vertices move sideways
 * with the choppy displacement, so step back once by that offset before reading the height. */
export function oceanHeight(water: WaterSystem, scene: Object3D): Height {
  let surface: WaterSurfaceMaterial | undefined;
  scene.traverse(object => {
    if (!surface && object instanceof Mesh && object.material instanceof WaterSurfaceMaterial) surface = object.material;
  });
  const simulation = water.simulation, cascades = surface?.cascadeSampler;
  const sample: (x: Node<'float'>, z: Node<'float'>) => Displacement = cascades
    ? (() => {
      const buffers = Array.from({ length: cascades.cascadeCount }, (_, i) => simulation.getDisplacementBuffer(i)!);
      return (x, z) => cascades.sampleDisplacement(x, z, buffers as never).displacement as unknown as Displacement;
    })()
    : (x, z) => simulation.getDisplacementNodes().sampleDisplacement(x, z) as unknown as Displacement;
  return (x, z) => {
    let u = x, v = z;
    for (let i = 0; i < SOLVE_STEPS; i++) { const offset = sample(u, v); u = x.sub(offset.x); v = z.sub(offset.z); }
    return sample(u, v).y;
  };
}

/** A darker, glossier band on every hull just above the moving sea surface, read per fragment
 * from the same wave, wake and bow-wave heights the water draws. Visual only. One node graph
 * serves every shared ship paint. */
export class HullWetBand {
  /** 1 while the band draws; 0 leaves the paint exactly as authored. */
  readonly enabled = uniform(1);
  /** Albedo and roughness lost where the hull is wet. */
  readonly darkening = uniform(.45);
  readonly glossing = uniform(.6);
  /** Metres the band climbs per metre of significant wave height. */
  seaGain = .2;
  private readonly seaBand = uniform(0);
  /** Fragments above this height, band included, stay dry without reading the sea. */
  private readonly highest = uniform(8);
  /** Fragments below this height are always under or just out of the water. */
  private readonly lowest = uniform(-8);
  /** 0 dry, 1 wet. */
  readonly wetness: Node<'float'>;
  /** Albedo multiplier. */
  readonly dry: Node<'float'>;
  /** Roughness multiplier. */
  readonly gloss: Node<'float'>;

  private height?: Height;
  private crest: () => number = () => 0;
  /** Built once, at the first shader compile after the sea is attached, and shared by every paint after it. */
  private sea?: Node<'float'>;

  /** Attach the sea once the water exists. Hull paint made earlier compiles later, when first drawn.
   * `crest` is the tallest bow crest, with the heap around it, above the sea in metres. */
  setSea(height: Height, crest: () => number): void { this.height = height; this.crest = crest; this.sea = undefined; }

  constructor() {
    this.wetness = Fn(() => {
      const p = positionWorld, wet = float(0).toVar();
      if (!this.height) return wet;
      const sea = this.sea ??= this.height(positionWorld.x, positionWorld.z);
      wet.assign(1);
      // The paint palette carries each hull's rest band height with its surface finish.
      const band = attribute<'vec3'>('shipSurface', 'vec3').z.add(this.seaBand).clamp(.3, 1.6).toVar();
      If(p.y.greaterThan(this.lowest), () => {
        wet.assign(0);
        If(p.y.lessThan(this.highest.add(band)), () => {
          // Run-off breaks the band's upper edge into short uneven tongues rather than a painted stripe.
          const runoff = mx_noise_float(vec3(p.x.mul(.45), p.y.mul(.8), p.z.mul(.45))).mul(band).mul(.25);
          const above = p.y.sub(sea).add(runoff);
          wet.assign(float(1).sub(smoothstep(band.mul(.55), band, above)));
        });
      });
      return wet.mul(this.enabled);
    })();
    this.dry = float(1).sub(this.darkening.mul(this.wetness));
    this.gloss = float(1).sub(this.glossing.mul(this.wetness));
  }

  /** `seaHeight` is the significant wave height of the sea on show. */
  update(seaHeight: number): void {
    const crest = this.crest();
    this.seaBand.value = this.seaGain * seaHeight;
    // Crests rarely reach 1.3 Hs above the mean; the wake field adds up to a metre.
    this.highest.value = 1.3 * seaHeight + crest + 1;
    this.lowest.value = -1.3 * seaHeight - 2;
  }
}
