import { Vector4, type Camera, type Node, type PerspectiveCamera } from 'three/webgpu';
import { Fn, If, Loop, atan, cameraPosition, exp, float, max, mx_noise_float, smoothstep, uniform, vec3, vec4 } from 'three/tsl';
import type { WakeShip } from './FleetWakeFoam';
import { PackedVec4Arrays } from './packedUniforms';
import { perRender } from './renderUniforms';
import { wakeHull } from './wakeHull';

const GRAVITY = 9.81;
const TAU = Math.PI * 2;
/** Hulls drawn at once; the nearest to the camera keep their bow waves. */
export const BOW_WAVE_SLOTS = 8;
/** Sections of the per-slot values. */
const POSE = 0, WAVE = 1, HULL = 2, BEND = 3;

/** Live-tunable shape of the bow wave. Visual choices, not a hydrodynamic model. */
export const BOW_WAVE_TUNING = {
  /** Stem crest height as a share of the stagnation head U²/2g. */
  crest: .3,
  /** tan of the angle at which the crest peels off the hull. */
  crestAngle: .18,
  /** Crest half-width as a share of beam, before it widens aft. */
  crestWidth: .12,
  /** Broad rise of the water around the stem, as a share of the crest height. */
  hump: .7,
  /** Kelvin amplitude as a share of U²/2g, scaled by √(beam/length). */
  kelvin: 1.6,
  transverse: .4,
  divergent: 1,
  /** Effective source depth as a share of beam; deeper sources keep only the cusp waves. */
  depth: .25,
  /** Hull lengths astern that the analytic V reaches before fading out. */
  reach: 2.6,
  foam: 1,
  /** White-water decay length along the crest, in crest lengths. */
  foamLength: 1.8,
  /** Metres the crest's white water widens per metre astern. */
  foamSpread: .08,
  /** Broken water along the hull side behind the crest. */
  wash: .6,
  washWidth: 3.5,
  /** White water on the steepest divergent Kelvin crests, from this steepness (amplitude × wavenumber) up. */
  kelvinFoam: .9,
  kelvinSteep: .008,
  /** Hull lengths over which the V's white water fades. */
  kelvinFoamLength: 2,
  /** How strongly flow-aligned streaks break the white water up. */
  breakup: 1,
  /** Mesh vertices a displaced feature must span; fewer is sharper but can crawl as the hull moves. */
  vertexFeature: 4,
  /** Multiplies the displayed speed before it sets the wavelength (1.5 would match world pace). */
  speedScale: 1,
};
export type BowWaveTuning = typeof BOW_WAVE_TUNING;
type ShaderKnob = 'crestAngle' | 'crestWidth' | 'hump' | 'transverse' | 'divergent' | 'reach' | 'foam' | 'foamLength' | 'foamSpread' | 'wash' | 'washWidth' | 'kelvinFoam' | 'kelvinSteep' | 'kelvinFoamLength' | 'breakup' | 'vertexFeature';
const SHADER_KNOBS: ShaderKnob[] = ['crestAngle', 'crestWidth', 'hump', 'transverse', 'divergent', 'reach', 'foam', 'foamLength', 'foamSpread', 'wash', 'washWidth',
  'kelvinFoam', 'kelvinSteep', 'kelvinFoamLength', 'breakup', 'vertexFeature'];

/** One Kelvin wave system from a point source, by stationary phase. `a` metres astern, `y` abeam.
 * The slope is the wave vector: the phase is stationary in the propagation angle. */
export function kelvinSystems(a: number, y: number, k0: number, depth: number): { height: number; slopeA: number; slopeY: number }[] {
  const ay = Math.abs(y), t = Math.max(ay / Math.max(a, 1e-3), 1e-3), r = Math.hypot(a, y);
  if (a <= 0 || t * t >= 1 / 8) return [];
  const root = Math.sqrt(1 - 8 * t * t), cusp = 1.5 * Math.pow(k0 * r, -1 / 3);
  // Both roots of 2t·T² − T + t = 0 (tan θ negative on the +y side, hence a − |y|T below).
  return ([[2 * t / (1 + root), Math.PI / 4], [(1 + root) / (4 * t), -Math.PI / 4]] as const).map(([T, shift]) => {
    const S2 = 1 + T * T, S = Math.sqrt(S2), k = k0 * S2;
    const phase = k0 * S * (a - ay * T) + shift;
    const cosTA = Math.max((1 - t * T) / (S * Math.sqrt(1 + t * t)), .05);
    const amp = Math.exp(-k * depth) * Math.sqrt(TAU / (k0 * r * S2 * cosTA * Math.max(Math.abs(1 - 2 * T * T), cusp)));
    return { height: amp * Math.cos(phase), slopeA: -amp * Math.sin(phase) * k0 * S, slopeY: amp * Math.sin(phase) * k0 * S * T * Math.sign(y) };
  });
}

const smooth = (value: number) => { const t = Math.max(0, Math.min(value, 1)); return t * t * (3 - 2 * t); };
const knob = (value: number) => perRender(uniform(value));

type Stage = 'vertex' | 'fragment';

/** Bow waves on the displaced ocean: a crest at the stem that peels away from the hull, the Kelvin V
 * behind it and the white water on both. Evaluated analytically in each hull's frame, so crests stay
 * sharp at any range, unlike the native wake field's metre-scale cells. Visual only. */
export class BowWaves {
  readonly tuning: BowWaveTuning = { ...BOW_WAVE_TUNING };
  enabled = true;
  /** Per slot, in one uniform buffer: pose (stem x/z, sin and cos of heading); wave (k₀, Kelvin amplitude, crest
   * height, crest decay length); hull (length, beam, source depth, speed share of full ahead); bend (track curvature,
   * 1/m, positive turning to starboard: the V follows the wake's arc, not the bow's heading). */
  private readonly packed = new PackedVec4Arrays([BOW_WAVE_SLOTS, BOW_WAVE_SLOTS, BOW_WAVE_SLOTS, BOW_WAVE_SLOTS], undefined, perRender);
  private readonly poseValues = this.packed.sections[POSE];
  private readonly waveValues = this.packed.sections[WAVE];
  private readonly hullValues = this.packed.sections[HULL];
  private readonly bendValues = this.packed.sections[BEND];
  private readonly count = perRender(uniform(0, 'int'));
  private readonly time = perRender(uniform(0));
  /** Radians per drawing-buffer pixel, for the fragment's anti-aliasing. */
  private readonly pixelAngle = perRender(uniform(.001));
  /** Finest water-mesh vertex spacing; each clipmap ring doubles it. */
  readonly vertexSpacing = perRender(uniform(4));
  private readonly knobs = Object.fromEntries(SHADER_KNOBS.map(key => [key, knob(BOW_WAVE_TUNING[key])])) as Record<ShaderKnob, ReturnType<typeof knob>>;
  private readonly speeds = new Map<WakeShip['root'], number>();
  private readonly tracks = new Map<WakeShip['root'], { x: number; z: number; heading: number; curvature: number }>();
  private readonly hullsByRoot = new WeakMap<WakeShip['root'], ReturnType<typeof wakeHull>>();
  private readonly fields = new WeakMap<object, { z: object; stage: Stage; node: Node<'vec4'> }[]>();
  private slots: { root: WakeShip['root']; speed: number }[] = [];

  /** Wake height added to the vertex displacement. */
  height(x: Node<'float'>, z: Node<'float'>): Node<'float'> { return this.field(x, z, 'vertex').x; }
  /** The water's normal with the bow waves' slope added. */
  normal(base: Node<'vec3'>, x: Node<'float'>, z: Node<'float'>): Node<'vec3'> {
    const field = this.field(x, z, 'fragment');
    return vec3(base.x.sub(field.y.mul(base.y)), base.y, base.z.sub(field.z.mul(base.y))).normalize();
  }
  /** White water on the bow crest, the hull sides and the steepest Kelvin crests. */
  foam(x: Node<'float'>, z: Node<'float'>): Node<'float'> { return this.field(x, z, 'fragment').w; }

  update(ships: readonly WakeShip[], dt: number, camera?: Camera, drawingHeight = 1080): void {
    const tuning = this.tuning;
    if (dt > 0) this.time.value += dt;
    for (const key of SHADER_KNOBS) this.knobs[key].value = tuning[key];
    const perspective = camera as PerspectiveCamera | undefined;
    if (perspective?.isPerspectiveCamera) this.pixelAngle.value = 2 * Math.tan(perspective.fov * Math.PI / 360) / (perspective.zoom || 1) / Math.max(drawingHeight, 1);
    // Smooth speed so the pattern's wavelength does not pulse with every throttle change.
    const present = new Set(ships.map(ship => ship.root));
    for (const root of this.speeds.keys()) if (!present.has(root)) this.speeds.delete(root);
    for (const root of this.tracks.keys()) if (!present.has(root)) this.tracks.delete(root);
    const candidates = ships.map(ship => {
      const surface = Math.max(0, Math.min(1, 1 + ship.motion.y / 3));
      const target = Math.max(0, ship.motion.speed) * surface;
      const previous = this.speeds.get(ship.root) ?? target;
      const speed = dt > 0 ? previous + (target - previous) * (1 - Math.exp(-dt / 2.5)) : previous;
      this.speeds.set(ship.root, speed);
      const distance = camera ? Math.hypot(ship.motion.x - camera.position.x, ship.motion.z - camera.position.z) : 0;
      return { ship, speed, distance };
    }).filter(entry => entry.speed > .5).sort((a, b) => a.distance - b.distance).slice(0, BOW_WAVE_SLOTS);
    this.slots = candidates.map(({ ship, speed }) => ({ root: ship.root, speed }));
    candidates.forEach(({ ship, speed }, slot) => {
      let hull = this.hullsByRoot.get(ship.root);
      if (!hull) { hull = wakeHull(ship.definition.hull); this.hullsByRoot.set(ship.root, hull); }
      const { length, beam, centerX, centerZ } = hull;
      const sin = Math.sin(ship.motion.heading), cos = Math.cos(ship.motion.heading);
      this.bendValues[slot].set(this.curvature(ship, dt, length), 0, 0, 0);
      // The authoring origin need not be amidships: place the stem from the hull's own extents.
      const ahead = length * .49 - centerZ;
      const stemX = ship.motion.x + cos * centerX + sin * ahead, stemZ = ship.motion.z + sin * centerX - cos * ahead;
      const head = speed * speed / (2 * GRAVITY), wavelengthSpeed = speed * tuning.speedScale;
      const k0 = GRAVITY / (wavelengthSpeed * wavelengthSpeed);
      const crest = Math.min(tuning.crest * head * Math.min(Math.max(beam / 32, .45), 1.1), 4);
      this.poseValues[slot].set(stemX, stemZ, sin, cos);
      this.waveValues[slot].set(k0, tuning.kelvin * head * Math.sqrt(beam / length), crest, Math.min(.25 * TAU / k0, .3 * length));
      this.hullValues[slot].set(length, beam, tuning.depth * beam, smooth(speed / Math.max(ship.definition.handling.forwardSpeed, 1)));
    });
    this.count.value = this.enabled ? candidates.length : 0;
  }

  /** Tallest stem crest with the heap around it, in metres above the sea. */
  crestHeight(): number {
    let crest = 0;
    for (let slot = 0; slot < this.count.value; slot++) crest = Math.max(crest, this.waveValues[slot].z * (1 + this.tuning.hump));
    return crest;
  }

  reset(): void { this.speeds.clear(); this.tracks.clear(); this.slots = []; this.count.value = 0; }

  /** Heading change per metre run, smoothed: a steady turn bends the wake onto its circle. */
  private curvature(ship: WakeShip, dt: number, length: number): number {
    const { x, z, heading } = ship.motion, track = this.tracks.get(ship.root);
    if (!track) { this.tracks.set(ship.root, { x, z, heading, curvature: 0 }); return 0; }
    const run = Math.hypot(x - track.x, z - track.z);
    if (run > 100) Object.assign(track, { x, z, heading, curvature: 0 });
    else if (dt > 0 && run > .05) {
      const turn = Math.atan2(Math.sin(heading - track.heading), Math.cos(heading - track.heading));
      const limit = 2 / Math.max(length, 1);
      track.curvature += (Math.max(-limit, Math.min(turn / run, limit)) - track.curvature) * (1 - Math.exp(-dt / 1.2));
      Object.assign(track, { x, z, heading });
    }
    return track.curvature;
  }

  diagnostics() {
    return { enabled: this.enabled, slots: this.slots.length, speeds: this.slots.map(slot => +slot.speed.toFixed(2)),
      curvatures: this.slots.map(slot => +(this.tracks.get(slot.root)?.curvature ?? 0).toFixed(5)) };
  }

  /** One evaluation per position and stage: the normal and foam reads share it. */
  private field(x: Node<'float'>, z: Node<'float'>, stage: Stage): Node<'vec4'> {
    const list = this.fields.get(x) ?? [];
    const cached = list.find(entry => entry.z === z && entry.stage === stage);
    if (cached) return cached.node;
    const node = this.evaluate(x, z, stage);
    list.push({ z, stage, node }); this.fields.set(x, list);
    return node;
  }

  /** vec4(height, ∂h/∂x, ∂h/∂z, foam) from every hull in reach. */
  private evaluate(x: Node<'float'>, z: Node<'float'>, stage: Stage): Node<'vec4'> {
    const tune = this.knobs;
    return Fn(() => {
      const height = float(0).toVar(), slopeX = float(0).toVar(), slopeZ = float(0).toVar(), foam = float(0).toVar();
      const range = vec3(cameraPosition.x.sub(x), cameraPosition.y, cameraPosition.z.sub(z)).length().max(1);
      // The shortest feature each stage can hold without shimmering: a few vertices of the water mesh
      // (its rings double in spacing away from the camera), or five pixels stretched by the grazing view.
      const finest = (stage === 'vertex'
        ? this.vertexSpacing.mul(range.add(128).div(128)).mul(tune.vertexFeature)
        : range.mul(this.pixelAngle).div(cameraPosition.y.abs().div(range).max(.04)).mul(5)).toVar();
      Loop({ start: 0, end: this.count, type: 'int' }, ({ i }) => {
        const pose = this.packed.element(POSE, i), wave = this.packed.element(WAVE, i), hull = this.packed.element(HULL, i);
        const dx = x.sub(pose.x), dz = z.sub(pose.y);
        // Ship frame: `a` metres astern of the stem, `y` to starboard.
        const a = dz.mul(pose.w).sub(dx.mul(pose.z)).toVar(), y = dx.mul(pose.w).add(dz.mul(pose.z)).toVar();
        const length = hull.x, beam = hull.y, ay = y.abs().toVar(), side = y.sign(), bend = this.packed.element(BEND, i).x;
        If(a.greaterThan(length.mul(-.06)).and(a.lessThan(length.mul(tune.reach)))
          .and(ay.lessThan(a.max(0).mul(.37).add(beam.mul(1.5)).add(bend.abs().mul(a).mul(a).mul(.5)))), () => {
          const slopeA = float(0).toVar(), slopeY = float(0).toVar(), white = float(0).toVar();
          const along = a.max(0), entrance = length.mul(.3), u = along.div(entrance).min(1);
          // Fine entrance: the waterline half-breadth grows from the stem to the shoulder.
          const halfBeam = beam.mul(.5).mul(float(1).sub(float(1).sub(u).mul(float(1).sub(u)))).toVar();
          const halfBeamRate = beam.div(entrance).mul(float(1).sub(u));
          // The crest, the stem and the hull-side wash live close to the hull; the V covers far more water.
          If(a.lessThan(length.mul(.8)).and(ay.lessThan(beam.mul(.9).add(along.mul(.3)))), () => {
            const crestHeight = wave.z, crestLength = wave.w;
            // Stem crest: climbs the stem, peels away at the crest angle, with a trough inboard of it.
            const offset = ay.sub(halfBeam.add(along.mul(tune.crestAngle))).toVar();
            const width = beam.mul(tune.crestWidth).add(1.5).add(along.mul(.05));
            const blurred = max(width, finest.mul(stage === 'vertex' ? .25 : .2)).toVar();
            const ramp = smoothstep(length.mul(-.04), length.mul(.015), a);
            const crest = crestHeight.mul(exp(along.div(crestLength).negate())).mul(ramp).mul(width.div(blurred)).toVar();
            const across = offset.div(blurred), inboard = offset.add(blurred.mul(1.8)).div(blurred.mul(1.4));
            const peak = exp(across.mul(across).negate()), trough = exp(inboard.mul(inboard).negate()).mul(.3);
            const profile = peak.sub(trough);
            // The water heaps up around the stem as a whole, not only along the crest line.
            const humpAlong = a.sub(length.mul(.02)).div(length.mul(.07)), humpAcross = ay.div(beam.mul(.55).add(along.mul(.15)));
            const hump = crestHeight.mul(tune.hump).mul(exp(humpAlong.mul(humpAlong).add(humpAcross.mul(humpAcross)).negate())).toVar();
            if (stage === 'vertex') height.addAssign(crest.mul(profile).add(hump));
            else {
              const rate = across.mul(-2).div(blurred).mul(peak).add(inboard.mul(2).div(blurred.mul(1.4)).mul(trough));
              slopeA.addAssign(crest.mul(rate).mul(halfBeamRate.add(tune.crestAngle).negate()).sub(crest.mul(profile).div(crestLength))
                .sub(hump.mul(2).mul(humpAlong).div(length.mul(.07))));
              slopeY.addAssign(crest.mul(rate).mul(side).sub(hump.mul(2).mul(humpAcross).div(beam.mul(.55).add(along.mul(.15))).mul(side)));
              // Breaking white water rides just outboard of the crest, then trails aft and spreads.
              const spread = blurred.mul(1.1).add(along.mul(tune.foamSpread));
              const band = offset.sub(blurred.mul(.2)).div(spread);
              const bow = smoothstep(.4, 1.2, crestHeight).mul(exp(along.div(crestLength.mul(tune.foamLength)).negate()))
                .mul(smoothstep(length.mul(-.03), length.mul(.005), a)).mul(exp(band.mul(band).mul(1.6).negate()))
                .mul(blurred.mul(1.1).div(spread).sqrt());
              // Water piled against the stem itself.
              const stemAlong = a.div(length.mul(.025)), stemAcross = ay.sub(halfBeam).max(0).div(3);
              const stem = smoothstep(.4, 1.2, crestHeight).mul(exp(stemAlong.mul(stemAlong).add(stemAcross.mul(stemAcross)).negate()));
              // Broken water pressed along the hull side behind the crest.
              const edge = ay.sub(halfBeam).div(tune.washWidth);
              const wash = exp(edge.mul(edge).negate()).mul(smoothstep(length.mul(.02), length.mul(.1), a))
                .mul(float(1).sub(smoothstep(length.mul(.45), length.mul(.75), a))).mul(hull.w).mul(tune.wash);
              white.assign(max(max(bow, stem), wash));
            }
          });
          // Kelvin V behind the stem, inside the 19.47° cusp, laid along the arc the stem has run:
          // `run` metres back along the track and `off` metres to starboard of it (a and y when straight).
          const cross = float(1).sub(bend.mul(y));
          const off = y.mul(2).sub(bend.mul(y.mul(y).add(a.mul(a))))
            .div(float(1).add(bend.mul(bend).mul(a).mul(a).add(cross.mul(cross)).sqrt())).toVar();
          const run = bend.abs().greaterThan(1e-6).select(atan(bend.abs().mul(a), cross).div(bend.abs().max(1e-6)), a).toVar();
          const aoff = off.abs(), offSide = off.sign();
          const turn = bend.mul(run), turnCos = turn.cos(), turnSin = turn.sin();
          const t = aoff.div(run.max(.5)).max(1e-3), t2 = t.mul(t);
          If(run.greaterThan(1).and(t2.lessThan(.125)), () => {
            const alongSlope = float(0).toVar(), offSlope = float(0).toVar();
            const k0 = wave.x;
            const r = run.mul(run).add(off.mul(off)).sqrt().max(beam).max(float(TAU * .3).div(k0));
            const root = float(1).sub(t2.mul(8)).max(0).sqrt(), cusp = k0.mul(r).pow(-1 / 3).mul(1.5);
            const reach = length.mul(tune.reach);
            const envelope = smoothstep(0, length.mul(.2), run).mul(float(1).sub(smoothstep(reach.mul(.45), reach, run)))
              .mul(float(1).sub(smoothstep(.095, .125, t2))).mul(wave.y).toVar();
            const secant = t2.add(1).sqrt();
            for (const [T, shift, gain, divergent] of [
              [t.mul(2).div(root.add(1)), Math.PI / 4, tune.transverse, false],
              [root.add(1).div(t.mul(4)), -Math.PI / 4, tune.divergent, true],
            ] as const) {
              const T2 = T.mul(T), S2 = T2.add(1), S = S2.sqrt(), k = k0.mul(S2);
              const phase = k0.mul(S).mul(run.sub(aoff.mul(T))).add(shift);
              const cosTA = float(1).sub(t.mul(T)).div(S.mul(secant)).max(.05);
              // |∂²φ/∂θ²| vanishes on the cusp; the Airy limit keeps the amplitude finite there.
              const phaseBend = float(1).sub(T2.mul(2)).abs().max(cusp);
              const resolved = smoothstep(finest.mul(.5), finest, float(TAU).div(k));
              const amp = envelope.mul(gain).mul(exp(k.mul(hull.z).negate()))
                .mul(float(TAU).div(k0.mul(r).mul(S2).mul(cosTA).mul(phaseBend)).sqrt()).mul(resolved).toVar();
              if (stage === 'vertex') { height.addAssign(amp.mul(phase.cos())); continue; }
              const swing = phase.sin().mul(amp).mul(k0).mul(S);
              alongSlope.addAssign(swing.negate());
              offSlope.addAssign(swing.mul(T).mul(offSide));
              if (divergent) {
                // Divergent crests steepen and break where they meet the transverse waves at the cusp,
                // drawing the V as a row of short feathered dashes rather than whole crest lines.
                const crestFoam = smoothstep(.55, .98, phase.cos()).mul(smoothstep(.06, .11, t2))
                  .mul(smoothstep(tune.kelvinSteep, tune.kelvinSteep.mul(3.3), amp.mul(k)))
                  .mul(exp(run.div(length.mul(tune.kelvinFoamLength)).negate())).mul(tune.kelvinFoam);
                white.assign(max(white, crestFoam));
              }
            }
            if (stage === 'fragment') {
              // The arc's frame is turned by the heading change since the stem passed this point.
              slopeA.addAssign(alongSlope.mul(turnCos).sub(offSlope.mul(turnSin)));
              slopeY.addAssign(alongSlope.mul(turnSin).add(offSlope.mul(turnCos)));
            }
          });
          if (stage === 'fragment') {
            // Rotate the ship-frame slope back to world x/z.
            slopeX.addAssign(slopeY.mul(pose.w).sub(slopeA.mul(pose.z)));
            slopeZ.addAssign(slopeA.mul(pose.w).add(slopeY.mul(pose.z)));
            If(white.greaterThan(.02), () => {
              // World-anchored streaks along the heading: the white water flows aft past the hull
              // and tears into strands instead of riding with the ship as a painted band.
              const downstream = x.mul(pose.z).sub(z.mul(pose.w)), abeam = x.mul(pose.w).add(z.mul(pose.z));
              const strands = mx_noise_float(vec3(downstream.mul(.022), abeam.mul(.16), this.time.mul(.25)));
              const clumps = mx_noise_float(vec3(downstream.mul(.07).add(7), abeam.mul(.09), this.time.mul(.4)));
              const fleck = mx_noise_float(vec3(downstream.mul(.3).add(3), abeam.mul(.45), this.time.mul(.9)));
              const noise = strands.mul(.55).add(clumps.mul(.35)).add(fleck.mul(.2)).mul(tune.breakup);
              // A noise-dithered threshold: dense at the core, torn at the edges, strands where it thins.
              const coverage = smoothstep(.35, .65, white.add(noise.mul(.55)));
              foam.assign(max(foam, coverage.mul(white.min(.85)).mul(tune.foam)));
            });
          }
        });
      });
      return vec4(height, slopeX, slopeZ, foam.min(1));
    })();
  }
}
