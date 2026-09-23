import { ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter, MeshBasicNodeMaterial, NoBlending, QuadMesh, RenderTarget, RepeatWrapping, RGBAFormat,
  UnsignedByteType, type Node, type WebGPURenderer } from 'three/webgpu';
import { Fn, abs, asin, atan, cos, exp, float, max, mix, mx_fractal_noise_float, mx_noise_float, mx_noise_vec3, pow, smoothstep, sqrt, texture, uv, vec2, vec3,
  vec4 } from 'three/tsl';

/** Texels of the band: longitude across, sin(latitude) down (equal area, finest along the plane): 0.18° at
 * the plane, well under the five pixels a degree spans at the game's normal field of view. */
const SIZE = { width: 2048, height: 512 };
/** The texture holds sqrt(radiance / ENCODING) in eight bits: the faint outskirts keep their gradations. */
const ENCODING = 2;
const DEGREES = Math.PI / 180;

/** Galactic longitude and latitude (radians) of a unit vector in the galactic frame. */
const galacticAngles = (g: Node<'vec3'>) => ({ l: atan(g.y, g.x), b: asin(g.z.clamp(-1, 1)) });
/** A soft blob in (l, b) degrees, `size` its σ in degrees, stretched by `aspect` along `tilt` (degrees). */
function blob(l: Node<'float'>, b: Node<'float'>, centre: [number, number], size: number, aspect = 1, tilt = 0): Node<'float'> {
  const c = Math.cos(tilt * DEGREES), s = Math.sin(tilt * DEGREES);
  const dl = l.div(DEGREES).sub(centre[0]), db = b.div(DEGREES).sub(centre[1]);
  const along = dl.mul(c).add(db.mul(s)).div(aspect), across = db.mul(c).sub(dl.mul(s));
  return exp(along.mul(along).add(across.mul(across)).div(-2 * size * size));
}

/** Thin dust filaments: ridges of warped noise, sharpened. */
const ridges = (p: Node<'vec3'>, sharpness: number) => pow(float(1).sub(abs(mx_noise_float(p))), sharpness);

/** The Milky Way's radiance (relative: about 1 in the bright bulge) toward a direction in the galactic frame.
 * A thin disc thickening and brightening toward the centre, a bulge in Sagittarius, the bright star clouds of
 * Sagittarius, Scutum, Cygnus and Carina, lumpy structure and the grain of unresolved stars. Dust dims and reddens
 * what lies behind it: the Great Rift splitting the band from Cygnus to Scorpius, the lane across the bulge and the
 * dark clouds of Ophiuchus above it, the Coalsack, Taurus, and filaments along the plane. A warm old-star core,
 * cooler arms, and faint hydrogen-red nebulae. Evaluated once into a texture. */
function milkyWay(g: Node<'vec3'>): Node<'vec3'> {
  const { l, b } = galacticAngles(g), height = abs(b), lDegrees = l.div(DEGREES), bDegrees = b.div(DEGREES);
  const toward = pow(cos(l).mul(.5).add(.5), 1.6);
  // The disc: its apparent thickness grows toward the centre, and so does its surface brightness.
  const thickness = toward.mul(4.2).add(2.4).mul(DEGREES);
  const disc = toward.mul(.62).add(.14).mul(exp(height.div(thickness).negate()));
  const thick = toward.mul(.7).add(.3).mul(.07).mul(exp(height.div(15 * DEGREES).negate()));
  // The bulge, broader than tall, and the star clouds along the plane.
  const bulge = blob(l, b, [0, -1], 5.5, 1.45).mul(1.05).add(blob(l, b, [0, -1], 12, 1.3).mul(.3));
  const starClouds = blob(l, b, [3, -4.5], 3.2, 1.3).mul(.55) // the great Sagittarius star cloud
    .add(blob(l, b, [27, -2], 2.6, 1.5).mul(.4)) // Scutum
    .add(blob(l, b, [75, 1], 5, 2.2).mul(.28)) // Cygnus
    .add(blob(l, b, [-73, -1], 4, 2).mul(.3)) // Carina
    .add(blob(l, b, [-30, -1], 4, 2.5).mul(.22)); // Norma
  // Lumpy structure on the sphere (no seam at l = 180°) and the grain of unresolved stars.
  const lumps = smoothstep(-.5, .8, mx_fractal_noise_float(g.mul(5.5), 5, 2.1, .55)).mul(.8).add(.5);
  const fine = mx_fractal_noise_float(g.mul(30).add(7.3), 4, 2.2, .55).mul(.3).add(1);
  const grain = mx_noise_float(g.mul(430)).mul(.25).add(1);
  const light = disc.mul(lumps).add(starClouds.mul(lumps.mul(.5).add(.6))).mul(fine).add(bulge.mul(lumps.mul(.25).add(.8))).mul(grain).add(thick);
  // Dust: warped noise for filaments, and lanes that wander about a centre line. Dust clouds are sheared along the
  // plane by the galaxy's rotation, so the noise is squeezed across it and its features stretch along the band.
  const warped = g.add(mx_noise_vec3(g.mul(3.3)).mul(.065)).add(mx_noise_vec3(g.mul(9.1).add(3)).mul(.018));
  const along = warped.mul(vec3(1, 1, 4));
  const filaments = ridges(along.mul(10), 4).mul(.6).add(ridges(along.mul(21).add(1.9), 4).mul(.4));
  const mottled = smoothstep(-.2, .7, mx_fractal_noise_float(along.mul(7).add(2.7), 4, 2.1, .55));
  const lane = (centre: Node<'float'>, width: Node<'float'> | number, strength: Node<'float'>) => {
    const t = bDegrees.sub(centre).div(width);
    return exp(t.mul(t).negate()).mul(strength);
  };
  const wander = mx_fractal_noise_float(vec3(l.mul(2.2), 3.1, 0), 3, 2, .5).mul(1.3);
  // The Great Rift, from Cygnus (l ≈ 85°) through Aquila into Ophiuchus and Scorpius, a little north of the plane.
  const rift = lane(wander.add(smoothstep(80, 10, lDegrees).mul(-1.4)).add(2), toward.mul(1.6).add(1.4),
    smoothstep(92, 78, lDegrees).mul(smoothstep(-22, -4, lDegrees)).mul(2.1));
  // The lane across the bulge and the southern lanes toward Carina.
  const central = lane(wander.mul(.4).sub(.6), 1.1, smoothstep(-30, -10, lDegrees).mul(smoothstep(20, 8, lDegrees)).mul(1.6));
  const southern = lane(wander.sub(.4), 1.4, smoothstep(-160, -120, lDegrees).mul(smoothstep(-20, -40, lDegrees)).mul(1.1));
  // Lanes break up along their length: thick in places, thin or gone in others.
  const breakup = smoothstep(-.35, .45, mx_fractal_noise_float(vec3(l.mul(3.4), bDegrees.mul(.05), 7.7), 3, 2, .5)).mul(.75).add(.25);
  const lanes = rift.add(central).add(southern).mul(filaments.mul(.8).add(.35)).mul(breakup);
  const clouds = blob(l, b, [-57, -.6], 1.9).mul(1.8) // the Coalsack
    .add(blob(l, b, [3, 6.5], 2, 3.4, 58).mul(1.5)) // the Pipe and the dark clouds of Ophiuchus
    .add(blob(l, b, [-4, 16], 2.4, 2.4, 38).mul(1))
    .add(blob(l, b, [173, -15], 4.5, 1.8, -25).mul(.8)); // Taurus
  const patches = mottled.mul(filaments).mul(.9).mul(exp(height.div(7 * DEGREES).negate())).mul(toward.mul(.7).add(.3));
  const depth = lanes.add(clouds.mul(filaments.mul(.7).add(.5))).add(patches);
  const transmit = exp(vec3(1, 1.25, 1.6).mul(depth).negate());
  // Old stars warm the core; the arms are young and bluer.
  const warm = max(bulge.mul(1.5), toward.mul(toward).mul(.5)).clamp(0, 1);
  const tint = mix(vec3(.82, .89, 1), vec3(1, .82, .6), warm);
  // Hydrogen-alpha glow of a few emission nebulae: the Lagoon and Trifid, Eta Carinae, the North America nebula, Orion.
  const nebulae = blob(l, b, [6, -1.2], .8).add(blob(l, b, [-72.4, -.6], 1.1)).add(blob(l, b, [85, -1], 1.5).mul(.7)).add(blob(l, b, [-151, -19], 3, 1.6, 40).mul(.5));
  return light.mul(tint).mul(transmit).add(vec3(1, .3, .4).mul(nebulae).mul(.06));
}

/** The Milky Way, rendered once into an equal-area band in galactic coordinates, and its lookup. */
export class MilkyWay {
  private readonly target = new RenderTarget(SIZE.width, SIZE.height, {
    type: UnsignedByteType, format: RGBAFormat, depthBuffer: false, generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, wrapS: RepeatWrapping, wrapT: ClampToEdgeWrapping,
  });
  private baked = false;

  constructor() { this.target.texture.name = 'Milky Way'; }

  /** Renders the band on the first call. */
  bake(renderer: WebGPURenderer): void {
    if (this.baked) return;
    this.baked = true;
    const material = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
    material.blending = NoBlending; material.toneMapped = false; material.fog = false;
    material.fragmentNode = Fn(() => {
      const longitude = uv().x.sub(.5).mul(2 * Math.PI), sine = uv().y.mul(2).sub(1), ring = sqrt(float(1).sub(sine.mul(sine)).max(0));
      const radiance = milkyWay(vec3(ring.mul(cos(longitude)), ring.mul(longitude.sin()), sine));
      return vec4(sqrt(radiance.div(ENCODING).clamp(0, 1)), 1);
    })();
    const quad = new QuadMesh(material), previous = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    quad.render(renderer);
    renderer.setRenderTarget(previous);
    material.dispose();
  }

  /** Relative radiance along a galactic direction; `level` picks a mip for coarse lookups such as the bake. */
  sample(g: Node<'vec3'>, level: Node<'float'> | number = 0): Node<'vec3'> {
    const at = vec2(atan(g.y, g.x).div(2 * Math.PI).add(.5), g.z.mul(.5).add(.5));
    const encoded = texture(this.target.texture).sample(at).level(typeof level === 'number' ? float(level) : level).rgb;
    return encoded.mul(encoded).mul(ENCODING);
  }

  /** Mip level whose texels match `texelAngle` radians along the plane. */
  static level(texelAngle: number): number { return Math.max(0, Math.log2(texelAngle / (2 * Math.PI / SIZE.width))); }

  dispose(): void { this.target.dispose(); }
}
