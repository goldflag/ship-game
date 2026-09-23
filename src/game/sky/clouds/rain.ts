import { Vector2, type Node, type Texture, type UniformNode } from 'three/webgpu';
import { If, Loop, exp, float, int, max, min, mix, select, smoothstep, texture3D, vec3 } from 'three/tsl';
import type { MarchContext } from './march';
import { localCover, type Arithmetic } from './model';
import { nodes } from './field';

type Float = Node<'float'>;
type Vec3 = Node<'vec3'>;

/** Rain shafts: the air below the base under storm cells, marched only while the scene rains. */
export interface RainUniforms {
  /** The scene's precipitation, 0 dry … 1 a downpour. */
  readonly precipitation: UniformNode<'float', number>;
  /** Unit XZ direction the wind carries the falling rain. */
  readonly drift: UniformNode<'vec2', Vector2>;
}

/** Samples along a ray's stretch below the base. */
const RAIN_STEPS = 10;
/** Extinction (1/m) of the heaviest shaft: a downpour cuts visibility to a few kilometres. */
const RAIN_EXTINCTION = .0022;
/** Rain nearer than these distances (m) fades out: the weather part's streaks and haze own the near air. */
const RAIN_NEAR = [800, 2_500] as const;
/** Farthest rain marched (m); beyond it the horizon haze has it. */
const RAIN_FAR = 45_000;
/** Metres the rain drifts downwind for every metre it falls: the shafts slant. */
const RAIN_SLANT = .35;
/** World metres one repeat of the curtains' streak texture spans across and along the fall, and the distances (m)
 * over which its streaks fade into an even shaft (farther, they would only sparkle). */
const CURTAIN_ACROSS = 2_400, CURTAIN_ALONG = 9_000, CURTAIN_FADE = [8_000, 25_000] as const;
/** How the scene's precipitation opens storm cells to rain: at full precipitation cells whose storm potential
 * passes the first value rain, at a drizzle only those past the second. */
const CELL_OPEN = [.6, .92] as const;

/** Share of a column that rains (0–1) for a weather texel's cover and storm potentials, under `coverage`. */
export function rainShare<T>(m: Arithmetic<T>, potential: T | number, storm: T | number, coverage: T | number, precipitation: T | number): T {
  const open = m.mix(CELL_OPEN[1], CELL_OPEN[0], precipitation);
  return m.mul(m.mul(m.smoothstep(open, m.add(open, .12), storm), m.smoothstep(.3, .8, localCover(m, potential, coverage))),
    m.smoothstep(0, .05, precipitation));
}

/** What the rain march reads: its uniforms, the detail volume its curtains streak from, and the cloud shadow. */
export interface RainOptions { readonly uniforms: RainUniforms; readonly detail: Texture; readonly shadow: (p: Vec3) => Float }

/** March the rain from `origin` (height `altitude`) along `direction`, under the layer, into the running
 * radiance, transmittance and depth weights of the cloud march that follows. Grey water lit by the sky's fill
 * and by what sun the clouds let through; it hangs in curtains that slant downwind. */
export function marchRain(context: MarchContext, options: RainOptions, origin: Vec3, altitude: Float, direction: Vec3, jitter: Float,
  state: { radiance: Node<'vec3'>; transmittance: Float; weighted: Float; weight: Float }): void {
  const rain = options.uniforms, shadow = options.shadow;
  const { field, sky } = context, layer = field.layer;
  If(rain.precipitation.greaterThan(0).and(altitude.lessThan(layer.base)), () => {
    // To the base going up, to the sea going down (the flat sea under the camera), and never past RAIN_FAR.
    const toBase = layer.base.sub(altitude).div(max(direction.y, 1e-4));
    const toSea = altitude.div(max(direction.y.negate(), 1e-4));
    const end = min(select(direction.y.greaterThan(0), toBase, toSea), RAIN_FAR).toVar();
    const start = float(RAIN_NEAR[0]);
    If(end.greaterThan(start), () => {
      const step = end.sub(start).div(RAIN_STEPS).toVar();
      const ambient = context.atmosphere.ambient(layer.base.mul(.5));
      const fill = mix(ambient.below, ambient.above, .6).mul(context.ambient).toVar();
      const curtains = texture3D(options.detail);
      Loop({ start: int(0), end: int(RAIN_STEPS), type: 'int' }, ({ i }) => {
        const t = start.add(step.mul(float(i).add(jitter))).toVar();
        const p = origin.add(direction.mul(t)).toVar();
        const fallen = layer.base.sub(p.y).max(0);
        // Where this drop left the cloud: upwind of here by how far it has fallen.
        const source = p.xz.sub(rain.drift.mul(fallen.mul(RAIN_SLANT)));
        const w = field.weather(vec3(source.x, layer.base, source.y));
        const share = rainShare(nodes, w.x, w.z, layer.coverage, rain.precipitation);
        If(share.greaterThan(0), () => {
          const streaks = curtains.sample(vec3(source.x.div(CURTAIN_ACROSS), p.y.div(CURTAIN_ALONG), source.y.div(CURTAIN_ACROSS))).level(float(0)) as unknown as Node<'vec4'>;
          const near = smoothstep(RAIN_NEAR[0], RAIN_NEAR[1], t);
          const streaked = mix(streaks.x.mul(1.6).sub(.3).clamp(0, 1), float(.5), smoothstep(CURTAIN_FADE[0], CURTAIN_FADE[1], t));
          const density = share.mul(share).mul(streaked).mul(near).mul(rain.precipitation.mul(.6).add(.4));
          const extinction = density.mul(RAIN_EXTINCTION);
          // Lit mostly by the sky; the sun only where the clouds above let it through, dimmed by the cell's gloom.
          const sun = context.light.night.oneMinus().mul(shadow(p)).mul(.12);
          const radiance = fill.add(sky.lightColor.mul(sun)).mul(.55);
          const absorbed = exp(extinction.mul(step).negate()).oneMinus();
          const share2 = state.transmittance.mul(absorbed);
          state.radiance.addAssign(radiance.mul(share2));
          state.weighted.addAssign(t.mul(share2)); state.weight.addAssign(share2);
          state.transmittance.mulAssign(absorbed.oneMinus());
        });
      });
    });
  });
}
