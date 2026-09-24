import * as THREE from 'three/webgpu';
import {
  Break, Fn, If, Loop, abs, dot, float, int, ivec2, max, mix, mx_noise_float, mx_worley_noise_float, normalWorldGeometry, positionView, positionWorld, smoothstep,
  texture, uniform, vec3, vec4, vertexColor,
} from 'three/tsl';
import type { Node } from 'three/webgpu';
import type { ShipDefinition } from '../ships/blueprint';
import { mountFrame } from './mountFrames';
import { motionVelocity } from './session/motion';
import type { CombatEvent, Combatant } from './session/elements';
import { impactStyle } from './ShipImpactMarks';
import { raycastSurface } from './SurfaceChunks';

/** Fire damage that stays on the paint: soot climbing above every place a fire burned and the seat of it charred, heavier
 * scorch around shell strikes, and a lost ship burned out as she goes down. Visual only: every place and amount comes from
 * the frame (fires in `damage.control`, strikes in the event ring, the loss in `damage.sunk`), and nothing here reaches
 * the battle.
 *
 * The ship paint is shared across hulls and drawn in fleet batches, so nothing about one hull can live in a material, a
 * vertex or a draw. Instead one float texture (unfilterable, read with `textureLoad`, so it takes no sampler) holds a row
 * for each of the nearest scorched hulls: its bounding sphere and world-to-hull matrix, its hull-frame box and its spots.
 * A ship fragment finds its hull by position, then sums that hull's spots in the hull frame, so the soot rides every
 * batch, detail level, turret and list alike. With no scorched hull in view the paint skips all of it on one uniform. */

/** Hulls whose damage draws at once: the nearest to the camera. */
export const SCORCH_SLOTS = 16;
/** Scorched places one hull keeps: fires first, then shell strikes merged by proximity. */
export const SCORCH_SPOTS = 20;
/** Row texels: bounding sphere, three matrix rows, box, hull values, then three per spot. */
const SPHERE = 0, MATRIX = 1, BOX = 4, SHIP = 5, SPOT = 6;
export const SCORCH_TEXELS = SPOT + 3 * SCORCH_SPOTS;

/** Rates and shapes, in seconds and metres. Visual choices, not a combustion model. */
export const SCORCH = {
  /** Seconds a fire at full intensity takes to soot its plume completely; weaker fires take longer. */
  sootSeconds: 70,
  /** Seconds at full intensity to char the seat; char grows with intensity squared, so a smoulder hardly chars. */
  charSeconds: 110,
  /** A fire's heat eases up over this many seconds and cools over the second. */
  heatRise: 2, heatFall: 30,
  /** Seconds a strike's heat takes to fall to a third. */
  strikeCooling: 18,
  /** Soot lean per metre climbed at a relative wind of `leanWind` m/s: half of `lean`. */
  lean: .9, leanWind: 10,
  /** Scorch radius of a strike per metre of its impact mark (`impactStyle` width): HE bursts on the plating, AP bursts
   * inside and vents through its hole. */
  strikeRadius: { HE: 1.3, AP: .75 },
  /** Soot and char one strike leaves. */
  strikeSoot: { HE: .7, AP: .45 }, strikeChar: { HE: .35, AP: .2 },
  /** The widest a merged strike scorch grows. */
  strikeMaxRadius: 7,
  /** Seconds a lost ship takes to burn out: she settles by some ten metres in half a minute, so it must show by then. Seconds
   * her embers take to fall to a third. */
  burnoutSeconds: 12, emberSeconds: 150,
  /** How burned out a ship lost to flooding or capsize gets without fire, and the seconds of fire that take her to full. */
  floodedBurnout: .35, fullBurnoutFire: 120,
} as const;

/** One scorched place in the hull frame (metres, +X starboard, +Y up from the waterline, −Z toward the bow). */
export interface ScorchSpot {
  /** `room:<compartment>`, `mount:<mount>` or `strike`. */
  key: string;
  position: THREE.Vector3;
  /** Radius of the charred seat, the height soot climbs above it, and the seat's half-height. */
  radius: number; plume: number; seat: number;
  /** A fire's climb at full intensity: its plume reaches 0.7 to 1.3 times this as it burns weaker or fiercer. */
  climb: number;
  /** Soot over the plume and char over the seat, 0–1; heat of the embers, 0–1. */
  soot: number; char: number; heat: number;
  /** Soot's lean downwind per metre it climbs, hull frame x and z. */
  lean: [number, number];
}

/** What a hull's view offers: the frame's hull and the displayed pose. */
export interface ScorchedView {
  readonly actor: Pick<Combatant, 'motion' | 'mounts' | 'damage'>;
  readonly definition: ShipDefinition;
  readonly motion: Combatant['motion'];
  readonly root: THREE.Object3D;
  readonly model: THREE.Object3D;
  readonly renderActive?: boolean;
}

interface Hull {
  /** The damage state the spots were read from; a new one is a new battle. */
  damage: Combatant['damage'];
  spots: ScorchSpot[];
  /** Each fire's spot by `room:<i>` or `mount:<i>`; fires venting at one place share it; null when every place was taken. */
  fires: Map<string, ScorchSpot | null>;
  /** Burn-out of a lost hull, 0–1, rising to `target`; `embers` her glow, falling from 1. */
  burnout: number; target: number; embers: number; lost: boolean;
  /** Seconds of fire over the battle, weighted by intensity. */
  fire: number;
  /** Hull-frame bounds of the model and the main deck's height. */
  bounds: THREE.Box3; deck: number;
}

/** Near-black soot, charred paint and the rust-brown of paint burned off to the steel, in linear colour. */
const SOOT = [.034, .03, .026] as const, CHARCOAL = [.05, .04, .032] as const, RUST = [.17, .085, .042] as const;
/** Radiance of embers glowing in charred paint at full heat: a dull orange, well below the flames', that reads at night and
 * hardly by day. */
const EMBER = [.5, .13, .028] as const;
const FULL_BURNOUT = new Set(['hull-failure', 'magazine', 'structural-fallback']);

type NamedLoop = (range: { start: Node<'int'>; end: Node<'int'>; type: 'int'; condition: '<'; name: 'k' }, body: (inputs: { k: Node<'int'> }) => void) => void;
const scratch = { matrix: new THREE.Matrix4(), box: new THREE.Box3(), point: new THREE.Vector3(), centre: new THREE.Vector3(), size: new THREE.Vector3() };

/** The model's bounds in its hull's frame, from the geometry bounds of every surface. */
function hullBounds(view: ScorchedView): THREE.Box3 {
  view.root.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(view.root.matrixWorld).invert(), bounds = new THREE.Box3();
  view.model.traverse(object => {
    const geometry = (object as THREE.Mesh).isMesh ? (object as THREE.Mesh).geometry : undefined;
    if (!geometry?.getAttribute('position')) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    bounds.union(scratch.box.copy(geometry.boundingBox!).applyMatrix4(scratch.matrix.multiplyMatrices(inverse, object.matrixWorld)));
  });
  const hull = view.definition.hull;
  // A model that could not be measured still gets the hull's own envelope.
  if (bounds.isEmpty() || !Number.isFinite(bounds.min.x)) bounds.set(new THREE.Vector3(-hull.beam / 2, -hull.draft, -hull.length / 2), new THREE.Vector3(hull.beam / 2, hull.depth + 30, hull.length / 2));
  return bounds;
}

/** The first level surface (a deck, roof or platform) below hull-frame `from` within `drop` metres, in the hull frame. Plate
 * winding need not face outwards, so any level face will do. */
function surfaceBelow(view: ScorchedView, from: THREE.Vector3, drop: number): THREE.Vector3 | undefined {
  const world = view.root.matrixWorld, down = new THREE.Vector3(0, -1, 0).transformDirection(world);
  const ray = new THREE.Raycaster(from.clone().applyMatrix4(world), down, 0, drop), up = down.clone().negate(), normal = new THREE.Vector3();
  let nearest = Infinity, found: THREE.Vector3 | undefined;
  view.model.traverse(object => {
    const mesh = object as THREE.Mesh, geometry = mesh.isMesh ? mesh.geometry : undefined;
    if (!geometry?.getAttribute('position')) return;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!ray.ray.intersectsBox(scratch.box.copy(geometry.boundingBox!).applyMatrix4(mesh.matrixWorld))) return;
    for (const hit of raycastSurface(mesh, ray)) {
      if (hit.distance >= nearest || !hit.face || Math.abs(normal.copy(hit.face.normal).transformDirection(mesh.matrixWorld).dot(up)) < .7) continue;
      nearest = hit.distance; found = hit.point.clone();
    }
  });
  return found && view.root.worldToLocal(found);
}

/** Metres below a fire's vent to look for the deck or roof it opens onto. */
const VENT_DROP = 8;
/** Where a fire's vent opens onto the ship, in the hull frame: the first deck or roof under it. Authored vents stand at
 * a common height, several metres above some of the decks they vent through; a vent over nothing keeps its place. */
function ventSeat(view: ScorchedView, vent: readonly [number, number, number]): THREE.Vector3 {
  return surfaceBelow(view, new THREE.Vector3(vent[0], vent[1] + .5, vent[2]), VENT_DROP + .5) ?? new THREE.Vector3(...vent);
}

/** Height of the main deck above the waterline, from the definition: the lowest of the hull's deck line. A constructed hull's
 * deck line is the top of its whole volume, so the model is measured too (`measuredDeck`). */
export function mainDeckHeight(definition: ShipDefinition): number {
  const heights = definition.hull.deckHeights.map(([, height]) => height).filter(Number.isFinite);
  return heights.length ? Math.min(...heights) : definition.hull.depth - definition.hull.draft;
}

/** Height of the main deck above the waterline as the model has it: looking down at eight points along the side decks,
 * clear of the centreline turrets, the second lowest surface found (a quarterdeck below a forecastle, not a gun tub).
 * Undefined when fewer than four find a surface. */
function measuredDeck(view: ScorchedView, bounds: THREE.Box3): number | undefined {
  const { beam, length } = view.definition.hull, heights: number[] = [];
  for (const across of [-.32, .32]) for (const along of [-.36, -.14, .14, .36]) {
    const seat = surfaceBelow(view, new THREE.Vector3(across * beam, bounds.max.y + 1, along * length), bounds.max.y + 1);
    if (seat && seat.y > .5) heights.push(seat.y);
  }
  return heights.length >= 4 ? heights.sort((a, b) => a - b)[1] : undefined;
}

export class ShipScorch {
  /** False draws no damage at all (review and frame-cost measurement); the state keeps accumulating. */
  enabled = true;
  /** Row per drawn hull, `SCORCH_TEXELS` wide. Float and nearest-filtered, so three binds it without a sampler. */
  readonly data: THREE.DataTexture;
  /** Multiplies the embers' radiance (review). */
  readonly emberStrength = uniform(1);
  private readonly count = uniform(0, 'int');
  private readonly time = uniform(0);
  private readonly values: Float32Array;
  /** Soot, char, rust share and ember glow at the fragment, 0–1 each; zero off every scorched hull. */
  private readonly damage: Node<'vec4'>;
  private hulls = new WeakMap<object, Hull>();
  private sequence = 0;
  private drawn = 0;
  /** Whether any hull has damage to forget. */
  private tracked = false;
  /** Scratch: this frame's fiercest fire at each spot. */
  private readonly intensities = new Map<ScorchSpot, number>();

  constructor() {
    this.values = new Float32Array(SCORCH_TEXELS * SCORCH_SLOTS * 4);
    this.data = new THREE.DataTexture(this.values, SCORCH_TEXELS, SCORCH_SLOTS, THREE.RGBAFormat, THREE.FloatType);
    this.data.name = 'Ship scorch'; this.data.minFilter = this.data.magFilter = THREE.NearestFilter;
    this.data.generateMipmaps = false; this.data.needsUpdate = true;
    const map = texture(this.data);
    const at = (texel: Node<'int'>, slot: Node<'int'>) => map.load(ivec2(texel, slot)) as unknown as Node<'vec4'>;
    this.damage = Fn(() => {
      const result = vec4(0).toVar();
      // Declared here, in the paint's main scope: the branches below only read them, and three declares these as variables
      // where it first builds them.
      const p = positionWorld.toVar(), normal = normalWorldGeometry.toVar();
      If(this.count.greaterThan(0), () => {
        Loop({ start: int(0), end: this.count, type: 'int', condition: '<' }, ({ i }: { i: Node<'int'> }) => {
          const sphere = at(int(SPHERE), i), offset = p.sub(sphere.xyz);
          If(dot(offset, offset).lessThan(sphere.w.mul(sphere.w)), () => {
            const world = vec4(p, 1);
            const q = vec3(dot(at(int(MATRIX), i), world), dot(at(int(MATRIX + 1), i), world), dot(at(int(MATRIX + 2), i), world)).toVar();
            const box = at(int(BOX), i);
            If(abs(q.x).lessThan(box.x).and(abs(q.z).lessThan(box.y)).and(q.y.lessThan(box.z)).and(q.y.greaterThan(box.w)), () => {
              result.assign(this.hullDamage(q, i, at, p, normal));
              Break();
            });
          });
        });
      });
      return result;
    })();
  }

  /** One hull's damage at hull-frame point `q`; built fresh inside the branch that found the hull. */
  private hullDamage(q: Node<'vec3'>, slot: Node<'int'>, at: (texel: Node<'int'>, slot: Node<'int'>) => Node<'vec4'>, p: Node<'vec3'>, normal: Node<'vec3'>): Node<'vec4'> {
    const ship = at(int(SHIP), slot);
    const soot = float(0).toVar(), char = float(0).toVar(), heat = float(0).toVar();
    // Soot runs in vertical rivulets and its edges are ragged; burned paint goes in blotches a few metres across.
    const streak = mx_noise_float(q.mul(vec3(.9, .2, .9))).toVar();
    const blot = mx_noise_float(q.mul(.23).add(vec3(3.1, 7.7, 1.3))).toVar();
    // Named apart from the slot loop's `i`, which it reads. Three's typings omit the loop's `name`.
    (Loop as unknown as NamedLoop)({ start: int(0), end: int(ship.z), type: 'int', condition: '<', name: 'k' }, ({ k }) => {
      const texel = k.mul(3).add(SPOT), centre = at(texel, slot), d = q.sub(centre.xyz).toVar();
      If(dot(d, d).lessThan(centre.w.mul(centre.w)), () => {
        const shape = at(texel.add(1), slot), amount = at(texel.add(2), slot);
        // Every edge is ragged: the streaks move it by up to a fifth of the way.
        const ragged = streak.mul(.2), up = d.y.max(0);
        // Smoke leans downwind as it climbs, and leaves its soot there. Distances in seat radii and half-heights.
        const across = d.xz.sub(amount.zw.mul(up)).length().div(shape.x), height = d.y.div(shape.z);
        const seated = across.mul(across).add(height.mul(height)).sqrt().add(ragged);
        // The seat chars through; its soot reaches half as far again.
        const seat = float(1).sub(smoothstep(.35, 1.05, seated)), halo = float(1).sub(smoothstep(.3, 1.6, seated));
        // Above it the plume widens as it climbs and thins out towards its reach.
        const climbed = up.div(shape.y);
        const plume = float(1).sub(smoothstep(.45, 1.1, across.div(climbed.mul(.8).add(.8)).add(ragged)))
          .mul(smoothstep(-.3, .15, d.y.div(shape.x))).mul(float(1).sub(smoothstep(.25, 1, climbed.add(ragged.mul(.5)))));
        soot.assign(soot.add(amount.x.mul(max(halo.mul(.9), plume)).mul(soot.oneMinus())));
        char.assign(max(char, amount.y.mul(seat)));
        heat.assign(max(heat, shape.w.mul(seat).mul(seat)));
      });
    });
    const burnout = ship.x;
    If(burnout.greaterThan(0), () => {
      // A lost ship burns out: her superstructure charred and heat-browned all over and blackened in patches, her decks
      // burned through in places, and the hull above the sea scorched more thinly.
      const upper = smoothstep(ship.y.sub(.5), ship.y.add(3), q.y), afloat = smoothstep(.3, 2, q.y);
      // Decks, roofs and platforms, however the plating is wound: the normal's rise in the hull frame.
      const flat = smoothstep(.6, .9, abs(dot(at(int(MATRIX + 1), slot).xyz, normal)));
      const patches = smoothstep(-.3, .3, blot.add(streak.mul(.3)).add(upper.mul(.35)).sub(.1));
      char.assign(max(char, burnout.mul(mix(float(.3), float(.95), max(upper, flat.mul(.75)))).mul(afloat).mul(patches.mul(.5).add(.5))));
      soot.assign(max(soot, burnout.mul(max(upper, flat.mul(patches).mul(.6))).mul(smoothstep(-.5, .5, streak)).mul(.7)));
    });
    // Heavily charred paint is charcoal; lighter burns show the rust-brown of steel where the paint burned away.
    const rust = smoothstep(-.2, .6, blot.negate().add(streak.mul(.25))).mul(float(1).sub(smoothstep(.45, .85, char))).toVar();
    If(char.greaterThan(.03).and(positionView.z.greaterThan(-60)), () => {
      // Blistered and flaking paint, a hand across, where it burned; only seen close to.
      const blister = mx_worley_noise_float(q.mul(8));
      rust.assign(rust.add(blister.sub(.35).mul(.8).mul(smoothstep(-60, -25, positionView.z))).clamp(0, 1));
    });
    const glow = float(0).toVar();
    If(heat.greaterThan(.01), () => {
      // A few embers in the charred core of a seat, slowly breathing; never under the sea.
      const ember = smoothstep(.45, .8, mx_noise_float(q.mul(1.6).add(vec3(0, this.time.mul(-.2), this.time.mul(.05)))));
      glow.assign(heat.mul(ember).mul(smoothstep(.3, .8, char)).mul(smoothstep(-.3, .6, p.y)));
    });
    return vec4(soot.min(.95), char.min(1), rust, glow);
  }

  /** Paint colour under the damage. `paint` is the colour node before three multiplies in the palette's vertex colour. */
  color(paint: Node<'vec3'>): Node<'vec3'> {
    const d = this.damage, painted = (vertexColor().rgb as Node<'vec3'>).max(1e-3);
    // Three multiplies the paint's vertex colour in after this node, so the damage colours are divided by it here.
    const burnt = mix(vec3(...CHARCOAL), vec3(...RUST), d.z).div(painted), soot = vec3(...SOOT).div(painted);
    return mix(mix(paint, burnt, d.y), soot, d.x);
  }

  /** Paint roughness under the damage: soot and charred paint are matte. */
  roughness(paint: Node<'float'>): Node<'float'> { return mix(paint, float(.95), max(this.damage.x, this.damage.y).mul(.95)); }

  /** Radiance of embers glowing in charred paint. */
  get glow(): Node<'vec3'> { return vec3(...EMBER).mul(this.damage.w).mul(this.emberStrength); }

  /** Read this frame's fires, strikes and losses, and publish the nearest scorched hulls. Call after the hulls' render
   * matrices are current. `drift` is the smoke's world drift in m/s (EffectLighting.wind). A restarted battle numbers its
   * events afresh: `clear` first, as the impact marks are cleared. */
  update(views: readonly ScorchedView[], events: readonly CombatEvent[], dt: number, camera: THREE.Camera, drift: THREE.Vector3): void {
    this.time.value += dt;
    let byId: Map<string, ScorchedView> | undefined;
    for (const event of events) {
      if (event.sequence <= this.sequence) continue;
      this.sequence = event.sequence;
      if (!event.surfaceImpact || !event.shell) continue;
      byId ??= new Map(views.map(view => [view.actor.motion.id, view]));
      const view = byId.get(event.shipId);
      if (view) this.strike(this.hull(view), view, event);
    }
    for (const view of views) {
      const damage = view.actor.damage, control = damage.control, known = this.hulls.get(view);
      if (!known && !damage.sunk && !control.rooms.some(fire => fire.intensity > 0) && !control.mounts.some(fire => fire.intensity > 0)) continue;
      this.burn(this.hull(view), view, dt, drift);
    }
    this.publish(views, camera);
  }

  /** Forget every hull's damage: a new battle, a reset or the port. */
  clear(): void {
    if (!this.tracked && !this.sequence && !this.drawn) return;
    this.hulls = new WeakMap(); this.sequence = 0; this.tracked = false;
    if (this.drawn) { this.drawn = 0; this.count.value = 0; }
  }

  /** The scorched places of a hull, for tests and review. */
  spots(view: object): readonly ScorchSpot[] { return this.hulls.get(view)?.spots ?? []; }
  /** A hull's burn-out, 0–1. */
  burnout(view: object): number { return this.hulls.get(view)?.burnout ?? 0; }
  diagnostics() { return { drawn: this.drawn, texels: SCORCH_TEXELS }; }
  dispose(): void { this.data.dispose(); }

  private hull(view: ScorchedView): Hull {
    let hull = this.hulls.get(view);
    if (hull && hull.damage !== view.actor.damage) hull = undefined;
    if (!hull) {
      const bounds = hullBounds(view), authored = mainDeckHeight(view.definition), measured = measuredDeck(view, bounds);
      hull = { damage: view.actor.damage, spots: [], fires: new Map(), burnout: 0, target: 0, embers: 0, lost: false, fire: 0, bounds,
        deck: measured === undefined ? authored : Math.min(authored, measured) };
      this.hulls.set(view, hull); this.tracked = true;
    }
    return hull;
  }

  /** Scorch around a shell strike, sized as its impact mark is; one close to an earlier strike deepens that one. */
  private strike(hull: Hull, view: ScorchedView, event: CombatEvent): void {
    const impact = event.surfaceImpact!, shell = event.shell!, type = shell.type ?? 'AP';
    // A ricochet or a stopped AP shot leaves only its mark.
    if (impact.outcome === 'ricochet' || (type === 'AP' && impact.outcome !== 'penetration')) return;
    const radius = impactStyle(shell.caliberM, type, impact.outcome).width * SCORCH.strikeRadius[type];
    if (!Number.isFinite(radius) || radius <= 0) return;
    // A mount's strike is in its own frame; the event's world point, taken back to the hull, is the same place.
    const point = impact.mountId ? scratch.point.fromArray(event.position).applyMatrix4(scratch.matrix.copy(view.root.matrixWorld).invert())
      : scratch.point.fromArray(impact.position);
    if (![point.x, point.y, point.z].every(Number.isFinite)) return;
    addStrike(hull.spots, point, radius, SCORCH.strikeSoot[type], SCORCH.strikeChar[type]);
  }

  /** Fires soot and char their places while they burn; a lost ship burns out. */
  private burn(hull: Hull, view: ScorchedView, dt: number, drift: THREE.Vector3): void {
    const { actor, definition: def, motion } = view, damage = actor.damage, control = damage.control;
    // Where the smoke goes over the hull: the wind's drift less the ship's own way, in the hull frame.
    const velocity = motionVelocity(motion), rx = drift.x - velocity[0], rz = drift.z - velocity[2];
    const c = Math.cos(motion.heading), s = Math.sin(motion.heading), lx = c * rx + s * rz, lz = -s * rx + c * rz;
    const lean = SCORCH.lean / (Math.hypot(lx, lz) + SCORCH.leanWind), leanX = lx * lean, leanZ = lz * lean;
    const matrix = view.root.matrixWorld.elements;
    // A fire goes out when the sea closes over it.
    const afloat = (x: number, y: number, z: number) => matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13] > 0;
    // Several compartments vent at one place, and a magazine at its turret: each place takes its fiercest fire once.
    const fierce = this.intensities; fierce.clear();
    const place = (key: string, create: () => ScorchSpot) => {
      let spot = hull.fires.get(key);
      if (spot === undefined) {
        const made = create();
        // A fire that finds every place taken by fires is refused once, not measured again every frame.
        spot = hull.spots.find(other => other.key !== 'strike' && sharedVent(other.position, made.position)) ?? addFire(hull.spots, made) ?? null;
        hull.fires.set(key, spot);
      }
      return spot ?? undefined;
    };
    const feed = (spot: ScorchSpot | undefined, intensity: number) => { if (spot) fierce.set(spot, Math.max(fierce.get(spot) ?? 0, intensity)); };
    // Gunhouses first: a magazine venting at its turret shares the gunhouse's scorch.
    let trains: number[] | undefined;
    for (let i = 0; i < control.mounts.length; i++) {
      const fire = control.mounts[i], mount = def.mounts[i], key = `mount:${i}`;
      if (!mount || (!(fire.intensity > 0) && !hull.fires.has(key))) continue;
      const house = mount.weapon.gunhouseSize, frame = mountFrame(def, i, trains ??= actor.mounts.map(state => state.train));
      const y = frame.y + house[2] * .55, burning = fire.intensity > 0 && afloat(frame.x, y, frame.z);
      if (!burning && !hull.fires.has(key)) continue;
      const climb = house[2] + 4, spot = place(key, () => ({ key, position: new THREE.Vector3(frame.x, y, frame.z),
        // Burning inside, a gunhouse chars and soots all over, its roof and hatches most.
        radius: Math.max(house[0], house[1]) * .55, plume: climb * .7, climb, seat: house[2] * 1.1, soot: 0, char: 0, heat: 0, lean: [leanX, leanZ] }));
      // The gunhouse carries its soot round with it while it burns.
      if (spot?.key === key && burning) spot.position.set(frame.x, y, frame.z);
      feed(spot, burning ? fire.intensity : 0);
    }
    for (let i = 0; i < control.rooms.length; i++) {
      const vent = def.compartments[i]?.fire?.ventPosition, fire = control.rooms[i];
      if (!vent) continue;
      const key = `room:${i}`, burning = fire.intensity > 0 && afloat(vent[0], vent[1], vent[2]);
      if (!burning && !hull.fires.has(key)) continue;
      feed(place(key, () => {
        // The fire's own footprint (LocalizedFireEffects) with a margin of scorch round it.
        const size = def.compartments[i].size, half = THREE.MathUtils.clamp(Math.min(size[0], size[2]) * .3, 1.2, 4.5);
        const climb = 6 * THREE.MathUtils.clamp(Math.sqrt(size[0] * size[2]) / 11, .6, 1.5);
        return { key, position: ventSeat(view, vent), radius: half * 1.3, plume: climb * .7, climb, seat: 1.2, soot: 0, char: 0, heat: 0, lean: [leanX, leanZ] };
      }), burning ? fire.intensity : 0);
    }
    for (const [spot, intensity] of fierce) this.heat(hull, spot, intensity, dt, leanX, leanZ);
    for (const spot of hull.spots) if (spot.key === 'strike') spot.heat *= Math.exp(-dt / SCORCH.strikeCooling);
    if (damage.sunk) {
      if (!hull.lost) {
        hull.lost = true; hull.embers = 1;
        hull.target = damage.defeatCause && FULL_BURNOUT.has(damage.defeatCause) ? 1 : Math.min(1, SCORCH.floodedBurnout + (1 - SCORCH.floodedBurnout) * hull.fire / SCORCH.fullBurnoutFire);
      }
      hull.burnout = Math.min(hull.target, hull.burnout + dt / SCORCH.burnoutSeconds);
      hull.embers *= Math.exp(-dt / SCORCH.emberSeconds);
    }
  }

  /** One fire's step: soot and char gather while it burns, its heat eases up and cools. */
  private heat(hull: Hull, spot: ScorchSpot, intensity: number, dt: number, leanX: number, leanZ: number): void {
    if (dt <= 0) return;
    spot.heat += (intensity - spot.heat) * Math.min(1, dt / (intensity > spot.heat ? SCORCH.heatRise : SCORCH.heatFall));
    if (intensity <= 0) return;
    hull.fire += dt * intensity;
    spot.soot = Math.min(1, spot.soot + dt * intensity / SCORCH.sootSeconds);
    spot.char = Math.min(1, spot.char + dt * intensity * intensity / SCORCH.charSeconds);
    // A fiercer fire climbs higher; the soot keeps the highest reach.
    spot.plume = Math.max(spot.plume, spot.climb * (.7 + .6 * intensity));
    // The soot's lean averages the winds it burned in.
    const weight = Math.min(1, dt * intensity / 15);
    spot.lean[0] += (leanX - spot.lean[0]) * weight; spot.lean[1] += (leanZ - spot.lean[1]) * weight;
  }

  /** Write the nearest scorched hulls' rows. */
  private publish(views: readonly ScorchedView[], camera: THREE.Camera): void {
    if (!this.enabled) { if (this.drawn) { this.drawn = 0; this.count.value = 0; } return; }
    const eye = scratch.centre.setFromMatrixPosition(camera.matrixWorld);
    const drawn: { view: ScorchedView; hull: Hull; distance: number }[] = [];
    for (const view of views) {
      const hull = this.hulls.get(view);
      if (!hull || hull.damage !== view.actor.damage || view.renderActive === false || !view.root.visible || (!hull.spots.length && !hull.burnout)) continue;
      drawn.push({ view, hull, distance: Math.hypot(view.motion.x - eye.x, view.motion.z - eye.z) });
    }
    drawn.sort((a, b) => a.distance - b.distance);
    const count = Math.min(SCORCH_SLOTS, drawn.length);
    for (let slot = 0; slot < count; slot++) writeRow(this.values, slot, drawn[slot].view, drawn[slot].hull);
    if (count || this.drawn) this.data.needsUpdate = true;
    this.drawn = count; this.count.value = count;
  }
}

/** Whether two fires vent at one place: within a metre and a half across, and a gunhouse's height of each other (a magazine
 * vents at its turret, whose scorch centres on the gunhouse above the deck the vent opens onto). */
const sharedVent = (a: THREE.Vector3, b: THREE.Vector3) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2 < 2.25 && Math.abs(a.y - b.y) < 5;

/** Put a new fire's spot among a hull's spots: a fire takes the place of the weakest strike when they are full. */
function addFire(spots: ScorchSpot[], spot: ScorchSpot): ScorchSpot | undefined {
  if (spots.length < SCORCH_SPOTS) { spots.push(spot); return spot; }
  let weakest = -1;
  spots.forEach((candidate, i) => {
    if (candidate.key === 'strike' && (weakest < 0 || strength(candidate) < strength(spots[weakest]))) weakest = i;
  });
  if (weakest < 0) return undefined;
  spots[weakest] = spot;
  return spot;
}
const strength = (spot: ScorchSpot) => spot.soot * spot.radius * spot.radius;

/** A strike's scorch at hull-frame `point`: it deepens and widens a strike scorch it overlaps, or the nearest when the
 * hull's spots are full, rather than piling up spots. */
export function addStrike(spots: ScorchSpot[], point: THREE.Vector3, radius: number, soot: number, char: number): void {
  let nearest: ScorchSpot | undefined, distance = Infinity;
  for (const spot of spots) {
    if (spot.key !== 'strike') continue;
    const d = spot.position.distanceTo(point);
    if (d < distance) { distance = d; nearest = spot; }
  }
  if (nearest && (distance < (nearest.radius + radius) * .6 || spots.length >= SCORCH_SPOTS)) {
    const share = soot / (nearest.soot + soot);
    nearest.position.lerp(point, share * .5);
    nearest.radius = Math.min(SCORCH.strikeMaxRadius, Math.max(nearest.radius, radius, distance * .5 + Math.max(nearest.radius, radius) * .8));
    nearest.soot = Math.min(1, nearest.soot + soot * .6); nearest.char = Math.min(1, nearest.char + char * .6);
    nearest.heat = Math.max(nearest.heat, .5); nearest.plume = nearest.radius * 1.6; nearest.seat = nearest.radius * .9;
    return;
  }
  if (spots.length >= SCORCH_SPOTS) return;
  spots.push({ key: 'strike', position: point.clone(), radius, plume: radius * 1.6, climb: 0, seat: radius * .9, soot, char, heat: .5, lean: [0, 0] });
}

/** One hull's row: where it is, how it lies, and its spots, with a lost ship's burn-out deepening every one of them. */
function writeRow(values: Float32Array, slot: number, view: ScorchedView, hull: Hull): void {
  const row = slot * SCORCH_TEXELS * 4, set = (texel: number, a: number, b: number, c: number, d: number) => {
    const o = row + texel * 4; values[o] = a; values[o + 1] = b; values[o + 2] = c; values[o + 3] = d;
  };
  const world = view.root.matrixWorld, bounds = hull.bounds;
  const centre = bounds.getCenter(scratch.point).applyMatrix4(world), radius = bounds.getSize(scratch.size).length() / 2 + 1;
  set(SPHERE, centre.x, centre.y, centre.z, radius);
  const e = scratch.matrix.copy(world).invert().elements;
  for (let r = 0; r < 3; r++) set(MATRIX + r, e[r], e[r + 4], e[r + 8], e[r + 12]);
  set(BOX, Math.max(-bounds.min.x, bounds.max.x) + .5, Math.max(-bounds.min.z, bounds.max.z) + .5, bounds.max.y + .5, bounds.min.y - .5);
  const burnout = hull.burnout, grow = 1 + .5 * burnout, count = Math.min(SCORCH_SPOTS, hull.spots.length);
  set(SHIP, burnout, hull.deck, count, 0);
  for (let k = 0; k < count; k++) {
    const spot = hull.spots[k], texel = SPOT + 3 * k, radius = spot.radius * grow, plume = spot.plume * grow;
    const lean = Math.hypot(spot.lean[0], spot.lean[1]);
    // Far enough that the seat and the leaning plume have faded to nothing.
    set(texel, spot.position.x, spot.position.y, spot.position.z, 3 * radius + plume * (1 + lean) + spot.seat);
    set(texel + 1, radius, plume, spot.seat, Math.max(spot.heat, hull.embers * burnout * .7));
    set(texel + 2, Math.max(spot.soot, burnout * .8), Math.max(spot.char, burnout * .9), spot.lean[0], spot.lean[1]);
  }
}
