/** What covers the land: the albedo, roughness, grazing reflectance, sky occlusion and small relief of every pixel,
 * from where it lies (height, slope, relief, open sky, distance to the coast), per map style; and which trees stand
 * where (`treeCover`), from the same masks, so the forests drawn as trees are the forests painted on the ground.
 *
 * Colours are albedos in linear light, calibrated to the game's lighting (a 0.29 albedo reads mid grey in sun) and to
 * photographs of each place: rainforest canopy about 0.04–0.06, kunai grass 0.15, winter fields 0.08–0.15, fresh snow
 * 0.8, chalk 0.6, dark volcanic sand 0.07. Land use follows the ground the way it does in each place (grass on the
 * ridges and forest in the gullies of Guadalcanal's foothills, paddies on Java's plains, farmland on the gentle chalk
 * with woods on the valley sides, snow on everything in Norway but the steepest rock), and whole fields change use at
 * once, so woods, villages and plantations have the shapes of the fields around them. Every procedural pattern fades
 * to its mean where a pixel grows larger than its features, so the land keeps its brightness at every distance and
 * never shimmers. */
import type { Node } from 'three/webgpu';
import { Color } from 'three/webgpu';
import { atan, clamp, cos, dot, float, floor, log, max, mix, normalize, select, sign, sin, smoothstep, vec2, vec3 } from 'three/tsl';
import { COAST_RANGE_M, FLOW_OCTAVES, RELIEF_RANGE_M } from './TerrainField';

type Float = Node<'float'>;
type Vec2 = Node<'vec2'>;
type Vec3 = Node<'vec3'>;
type Vec4 = Node<'vec4'>;

export type LandStyle = 'tropical' | 'snow' | 'volcanic' | 'chalk' | 'rock';

/** A map's `land` block (assets/maps/environments.v1.json): the style and its palette, sRGB. */
export interface SurfaceStyle {
  readonly style: LandStyle;
  /** Beach and shore: sand, shingle or the dark rock of a snowy shore. */
  readonly shore: string;
  /** The lowland cover most of the land wears: forest canopy, or downland grass above chalk. */
  readonly low: string;
  /** Highland: bare rock, or the chalk of the cliffs. */
  readonly high: string;
  /** Unit direction on the chart (x, z) toward the equator: the side slopes face to get the most sun over a day and a
   * season. Zero in the tropics, where every aspect gets about the same. */
  readonly equator: readonly [number, number];
}

export interface SurfaceInputs {
  /** Chart metres and height of the point. */
  readonly chart: Vec2; readonly height: Float;
  /** Surface gradient (∂h/∂x, ∂h/∂z) and the smooth normal it gives, world axes. */
  readonly gradient: Vec2; readonly normal: Vec3;
  /** Metres one pixel spans on the land; 0 where every pattern should be taken at full detail (tree placement). */
  readonly footprint: Float;
  /** False for the cheaper terrain setting: no leaf clumps, fall-line streaks, furrow noise or foam froth. */
  readonly detailed?: boolean;
  readonly time: Float;
  /** Unit direction toward the sun, world axes. */
  readonly sun: Vec3;
  /** Open sky (0–1) and the raw attribute bytes (0–1): drainage, broad relief, signed coast distance, fine relief. */
  readonly sky: Float; readonly drainage: Float; readonly broad: Float; readonly coast: Float; readonly fine: Float;
  /** The noise tile (`TerrainNoise`) repeated every `metres`, turned by an angle of its own for each scale. */
  readonly noise: (metres: number) => Vec4;
  /** The noise tile at `uv`, in tiles: for patterns laid out in a frame of their own (down the fall line). */
  readonly noiseAt: (uv: Vec2) => Vec4;
  /** The detail photographs' luminance (rock, grass, sand, snow; 0.5 their mean) repeated every `metres`. */
  readonly detail: (metres: number) => Vec4;
}

export interface Surface {
  readonly albedo: Vec3;
  readonly roughness: Float;
  /** Fresnel reflectance at grazing angles, 0–1: 1 for water-wet ground, far less for canopy, grass and snow. */
  readonly specular: Float;
  /** Occlusion of the sky's light, 0–1. */
  readonly occlusion: Float;
  /** Small relief in metres, turned into a normal by its screen-space gradient. */
  readonly bump?: Float;
}

/** Linear-light colour of an sRGB hex string, as a constant. */
const rgb = (hex: string): Vec3 => { const c = new Color(hex); return vec3(c.r, c.g, c.b); };
const smooth = (low: number | Float, high: number | Float, x: Float): Float => smoothstep(low as never, high as never, x);
const one = (x: Float): Float => float(1).sub(x);
/** 1 while features of `size` metres span several pixels, falling to 0 as a pixel grows to half their size. */
const resolved = (footprint: Float, size: number): Float => one(smooth(size * .12, size * .5, footprint));

/** What every style reads of the ground: slope, signed coast distance and relief in metres, noise at four scales, and
 * the beach. */
interface Ground {
  slope: Float; coast: Float; broad: Float; fine: Float;
  /** Drainage, 0 on ridges to 1 on big valley floors (`FLOW_OCTAVES`); `gully` rises where streams begin. */
  drainage: Float; gully: Float;
  /** Sine of the slope times the cosine of its bearing from the equator: + on slopes facing the sun's side. */
  sunny: Float;
  /** Topographic wetness, ln(drained samples / tan slope): below 2 on crests and steep faces, 4–7 on open slopes,
   * 9 and more on valley floors, stream banks and wet flats. */
  wetness: Float;
  /** Hollows and knolls within a slope: 0–1 as the ground lies 1.5–8 m below or above its surroundings in 240 m. */
  hollow: Float; knoll: Float;
  /** Noise about 0 (mostly ±0.3) with features from about 25 m down to a few: every boundary is broken by it and by
   * nothing larger, so land use follows the ground. */
  jag: Float;
  patches: Float; grain: Float; speck: Float;
  beach: Float;
}
function groundOf(style: SurfaceStyle, inputs: SurfaceInputs): Ground {
  const { height, gradient } = inputs;
  const slope = gradient.length();
  // Signed coast distance, metres: stored as the signed square root of its share of the reach.
  const coastByte = inputs.coast.sub(.5).mul(2);
  const coast = sign(coastByte).mul(coastByte.mul(coastByte)).mul(COAST_RANGE_M);
  const patches = inputs.noise(930).r, grain = inputs.noise(210).r, speck = inputs.noise(47).r;
  // Beaches: low, gently sloping land by the sea; the top of the beach wanders with the noise.
  const beachTop = float(2.4).add(patches.sub(.5).mul(2.4)).add(grain.sub(.5));
  const beach = one(smooth(beachTop, beachTop.add(1.4), height)).mul(one(smooth(.16, .34, slope))).mul(one(smooth(90, 260, coast)));
  const fine = inputs.fine.sub(.5).mul(2 * RELIEF_RANGE_M.fine);
  // A gully: water gathers here, or the ground lies well below its surroundings within 240 m.
  const gully = max(smooth(.38, .55, inputs.drainage), smooth(-3, -10, fine)).mul(smooth(.08, .2, slope));
  const sunny = dot(gradient.negate(), vec2(style.equator[0], style.equator[1])).div(slope.mul(slope).add(1).sqrt());
  const wetness = inputs.drainage.mul(FLOW_OCTAVES * Math.LN2).sub(log(slope.max(.005)));
  const jag = grain.sub(.5).add(speck.sub(.5).mul(.6));
  return { slope, coast, broad: inputs.broad.sub(.5).mul(2 * RELIEF_RANGE_M.broad), fine, drainage: inputs.drainage, gully, sunny, wetness,
    hollow: smooth(-1.5, -8, fine), knoll: smooth(1.5, 8, fine), jag, patches, grain, speck, beach };
}

/** Parcels of land about `size` metres across (fields, plots, plantations): each has its own random `id` (0–1, the same
 * over the parcel), and `boundary` rises to 1 along the `edge`-metre strips between parcels (hedgerows, bunds, tracks),
 * wandering a little. `near` is how well a pixel resolves the parcels, `edgeNear` their boundaries. */
function parcels(inputs: SurfaceInputs, size: number, edge: number): { id: Float; boundary: Float; near: Float; edgeNear: Float } {
  const cells = inputs.noise(size * 16), warp = inputs.noise(size * 2.3);
  const width = edge / (size * 16) * 2;
  const boundary = one(smooth(width * .5, width * 1.5, cells.b.add(warp.r.sub(.5).mul(.03))));
  return { id: cells.a, boundary, near: resolved(inputs.footprint, size * .4), edgeNear: resolved(inputs.footprint, edge * 3) };
}

/** Noise stretched down the fall line, streaks about `across` metres apart and `along` metres long: couloirs, stains
 * and runnels. The pattern is laid out along the two of eight fixed headings (every 22.5° of the axial fall line) either
 * side of the fall line and blended between them, so each stays put on the chart (a frame turned with the local slope
 * would sweep the pattern into contours). Two samples of the tile, whose coarsest octave has eight cells a side. */
function fallStreaks(inputs: SurfaceInputs, across: number, along: number): Float {
  const fall = normalize(inputs.gradient.add(vec2(1e-4, 0)));
  // The fall line's heading in eighths of a half turn, 0–8 (a streak has no sense of up and down).
  const turns = atan(fall.y, fall.x).div(Math.PI / 8).add(16).mod(8), first = floor(turns), blend = smooth(0, 1, turns.sub(first));
  const along8 = (heading: Float): Float => {
    const angle = heading.mul(Math.PI / 8), c = cos(angle), s = sin(angle);
    const u = dot(inputs.chart, vec2(s.negate(), c)), v = dot(inputs.chart, vec2(c, s));
    return inputs.noiseAt(vec2(u.div(across * 8).add(heading.mul(.37)), v.div(along * 8).add(heading.mul(.61)))).r;
  };
  const streak = mix(along8(first), along8(first.add(1).mod(8)), blend);
  // Where a pixel spans a streak, the mean: no moiré at a distance.
  return mix(float(.5), streak, resolved(inputs.footprint, across));
}

// Where each style's land uses lie, shared by the ground's paint and the trees.

/** Vestfjord in April: the snowline stands at 150–300 m, higher on slopes facing the sun's side, lower in hollows,
 * ragged at tens of metres. Above it snow covers everything but faces steeper than about 35–40°, which stand dark
 * except down the couloirs and gullies that cut them. Below it last year's heath, birch scrub and rock, with snow lying
 * in patches: more toward the line, in hollows and on shaded slopes, fewest on sunny knolls; the low skerries and the
 * shore band the sea washes stay dark. */
function snowMasks(inputs: SurfaceInputs, g: Ground) {
  const { height } = inputs, { slope, coast, sunny, hollow, knoll, wetness, jag } = g;
  const snowline = float(230).add(sunny.mul(220)).sub(hollow.mul(60)).add(knoll.mul(25)).add(jag.mul(110));
  const above = smooth(snowline.sub(20), snowline.add(20), height);
  const shore = one(smooth(3, 22, height)).mul(one(smooth(40, 350, coast)));
  const lying = smooth(snowline.sub(260), snowline, height).mul(.35).add(.5).add(hollow.mul(.25)).sub(knoll.mul(.2)).sub(sunny.mul(.9))
    .sub(shore.mul(.45)).add(jag.mul(.6));
  const snow = max(above, smooth(.47, .53, lying));
  const chutes = max(smooth(.56, .64, fallStreaks(inputs, 45, 420)), smooth(-3, -9, g.fine).mul(.8));
  const bare = smooth(.66, .86, slope.add(jag.mul(.15))).mul(one(chutes.mul(.8)));
  const treeline = float(320).add(sunny.mul(150)).add(jag.mul(80));
  const shelter = float(.45).add(hollow.mul(.25)).sub(knoll.mul(.25)).add(smooth(4, 9, wetness).mul(.2)).add(jag.mul(.5));
  const woods = one(smooth(treeline.sub(90), treeline, height)).mul(smooth(4, 16, height)).mul(one(smooth(.6, .85, slope)))
    .mul(smooth(40, 180, coast)).mul(smooth(.35, .55, shelter));
  const tidal = one(smooth(1.2, 3.2, height.add(jag.mul(2))));
  return { snow, bare, woods, tidal, shore };
}

function chalkMasks(inputs: SurfaceInputs, g: Ground) {
  const { height } = inputs, { slope, coast, hollow, knoll, wetness, jag } = g;
  // Cliffs: the faces the sea has cut, steep and within a few hundred metres of it.
  const cliff = smooth(.3, .55, slope.add(jag.mul(.12))).mul(one(smooth(250, 700, coast))).mul(smooth(3, 10, height));
  // The foot of the coast: shingle and fallen chalk wherever the land stands within a stone's throw of the sea.
  const foot = one(smooth(50, 130, coast.add(jag.mul(50)))).mul(one(smooth(14, 30, height)));
  const fields = parcels(inputs, 260, 5);
  const gentle = one(smooth(.12, .22, slope)).mul(smooth(6, 18, height));
  // Woods: hangers on the steeper valley sides, copses in the wet hollows and along streams, and a few whole fields.
  const hanger = smooth(.13, .24, slope.add(jag.mul(.08))).mul(one(smooth(.4, .6, slope)));
  const copse = smooth(8, 10.5, wetness.add(jag.mul(2))).mul(hollow.mul(.5).add(.5));
  const woodField = smooth(.93, .94, fields.id).mul(fields.near).mul(one(knoll.mul(.5)));
  const woods = max(max(hanger, copse.mul(.9)), woodField).mul(one(cliff)).mul(smooth(6, 20, height)).mul(smooth(60, 200, coast));
  return { cliff, foot, fields, gentle, woods, hedges: fields.boundary.mul(fields.edgeNear).mul(gentle).mul(one(woods)) };
}

function volcanicMasks(inputs: SurfaceInputs, g: Ground) {
  const { height } = inputs, { slope, coast, hollow, wetness, jag, speck } = g;
  // Paddies: the flat, wet lowland plains and valley floors.
  const plain = one(smooth(.03, .07, slope)).mul(one(smooth(40, 120, height.add(jag.mul(30))))).mul(smooth(3, 7, height))
    .mul(smooth(4.5, 7, wetness.add(jag.mul(1.5))).mul(.4).add(.6));
  const plots = parcels(inputs, 80, 1.5);
  // Village groves fill whole plots among the paddies, more of them on the slightly raised, drier ground.
  const grove = smooth(.8, .82, plots.id.add(speck.sub(.5).mul(.02)).add(one(hollow).mul(.06))).mul(plots.near).add(one(plots.near).mul(.2));
  // Coconut groves: the coastal strip behind the beach, in the lowlands.
  const palms = one(smooth(8, 25, height.add(jag.mul(6)))).mul(one(smooth(350, 1100, coast.add(jag.mul(300))))).mul(smooth(2.5, 4, height));
  const steep = smooth(1.05, 1.5, slope.add(jag.mul(.3)));
  return { plain, plots, grove, palms, steep };
}

function tropicalMasks(inputs: SurfaceInputs, g: Ground) {
  const { height } = inputs, { slope, coast, broad, hollow, knoll, wetness, jag } = g;
  const montane = smooth(900, 1500, height.add(jag.mul(150)));
  // Gallery forest follows every gully and stream, and the wet feet of slopes.
  const gully = max(smooth(6.5, 9, wetness.add(jag.mul(2))), hollow);
  // Kunai: the dry, open ground of the coastal plain and the crests of the low foothill ridges, never in a gully.
  const plain = one(smooth(.03, .08, slope)).mul(one(smooth(25, 60, height))).mul(smooth(4, 8, height));
  const ridges = one(smooth(140, 300, height.add(jag.mul(60)))).mul(smooth(.55, .9, knoll.add(broad.div(240)).add(jag.mul(.4))))
    .mul(one(smooth(.3, .5, slope))).mul(one(smooth(2500, 5000, coast)));
  const kunai = max(plain.mul(smooth(.3, .6, jag.add(.55).sub(hollow))), ridges).mul(one(gully)).mul(smooth(4, 10, height)).clamp(0, 1);
  // Plantations: rows of palms in whole blocks on the flat strip behind the beaches.
  const blocks = parcels(inputs, 420, 6);
  const plantation = one(smooth(8, 22, height)).mul(one(smooth(.04, .09, slope))).mul(one(smooth(900, 2000, coast)))
    .mul(smooth(.3, .32, blocks.id)).mul(one(gully.mul(.7)));
  const scar = smooth(1.15, 1.5, slope.add(jag.mul(.4))).mul(smooth(150, 400, height));
  return { montane, gully, kunai, plantation, scar };
}

/** A layer of the land: its colour and how it reflects, and how much of the pixel it covers. */
interface Cover { color: Vec3; roughness: number | Float; specular: number | Float; bump?: Float }
/** Cover the land layer by layer, bottom up: each takes its `weight` of what lies below. */
function layered(base: Cover, layers: [Cover, Float][]): { color: Vec3; roughness: Float; specular: Float; bump: Float } {
  let color = base.color, rough: Float = float(base.roughness as never), spec: Float = float(base.specular as never), bump: Float = base.bump ?? float(0);
  for (const [cover, weight] of layers) {
    color = mix(color, cover.color, weight);
    rough = mix(rough, float(cover.roughness as never), weight);
    spec = mix(spec, float(cover.specular as never), weight);
    bump = mix(bump, cover.bump ?? float(0), weight);
  }
  return { color, roughness: rough, specular: spec, bump };
}

/** A tree canopy from above: two layers of domed crowns about `crown` metres across (the second smaller, filling the
 * first's gaps), each crown its own size and shade, dark where they part. `shade` multiplies the canopy colour with
 * mean 1; `height` (metres) is the crowns' relief for the normal; `tint` a per-crown brightness with mean 1. All three
 * fade to their means as the crowns shrink under a pixel. */
function canopy(inputs: SurfaceInputs, crown: number, relief: number): { shade: Float; height: Float; tint: Float } {
  const a = inputs.noise(crown * 16), b = inputs.noise(crown * 16 * .63);
  const sizeA = a.a.mul(.45).add(.85), sizeB = b.a.mul(.45).add(.8);
  const domeA = one(a.g.div(sizeA).min(1).pow(2)).mul(sizeA), domeB = one(b.g.div(sizeB).min(1).pow(2)).mul(sizeB).mul(.8);
  // Leaf clumps a few metres across break every crown's outline and top: fractal noise whose coarsest cells are a
  // fifth of a crown.
  const clumps = inputs.detailed === false ? float(0) : inputs.noise(crown * 1.6).r.sub(.5).mul(resolved(inputs.footprint, crown * .3));
  const dome = max(domeA, domeB).add(clumps.mul(.55)).max(0);
  const near = resolved(inputs.footprint, crown);
  // The pattern's mean is 0.84 over the noise tile: divided by it, the canopy keeps its brightness as it fades.
  const raw = dome.min(1).sqrt().mul(.58).add(.42).mul(mix(float(.55), float(1), smooth(0, .12, dome))).div(.84);
  const tint = mix(b.a, a.a, smooth(-.05, .05, domeA.sub(domeB))).mul(.34).add(.83);
  return { shade: mix(float(1), raw, near).mul(clumps.mul(.5).add(1)), height: dome.mul(relief).mul(near), tint: mix(float(1), tint, near) };
}

/** One of `colors` by a parcel's `id`, with variation within the field, ploughed furrows 4 m apart along the parcel's
 * own heading on the first colour, and the mean colour where the parcels are too small to see. */
function crops(inputs: SurfaceInputs, land: ReturnType<typeof parcels>, colors: Vec3[]): { color: Vec3; furrows: Float } {
  let crop: Vec3 = colors[0];
  for (let k = 1; k < colors.length; k++) crop = mix(crop, colors[k], smooth(k / colors.length - .005, k / colors.length + .005, land.id));
  const heading = land.id.mul(37.7);
  const along = dot(inputs.chart, vec2(cos(heading), sin(heading))).div(4).mul(2 * Math.PI);
  const ploughed = one(smooth(1 / colors.length - .005, 1 / colors.length + .005, land.id));
  const furrows = sin(along).mul(resolved(inputs.footprint, 4)).mul(ploughed);
  crop = crop.mul(furrows.mul(.14).add(1));
  if (inputs.detailed !== false) crop = crop.mul(inputs.noise(90).r.sub(.5).mul(.3).add(1));
  const mean = colors.reduce((sum: Vec3, c) => sum.add(c), vec3(0) as Vec3).div(colors.length);
  return { color: mix(mean, crop, land.near), furrows };
}

/** Rock with the photograph's structure and larger blotches of its own, weathered toward `stain` in streaks down the
 * fall line. */
function rock(inputs: SurfaceInputs, color: Vec3, stain: Vec3): { color: Vec3; height: Float } {
  const detail = inputs.detail(50).r, coarse = inputs.detail(190).r;
  const structure = mix(float(1), detail.mul(1.2).add(coarse.mul(.8)), resolved(inputs.footprint, 30));
  const blotch = inputs.noise(140).r;
  // Streaks run down the slope: noise stretched along the fall line.
  const streak = inputs.detailed === false ? float(0) : smooth(.55, .8, fallStreaks(inputs, 9, 90).mul(.7).add(inputs.noise(30).r.mul(.3)));
  const tinted = mix(color.mul(blotch.mul(.5).add(.75)), stain, streak.mul(.45).mul(resolved(inputs.footprint, 12)));
  return { color: tinted.mul(structure), height: detail.mul(1.5).mul(resolved(inputs.footprint, 8)) };
}

export function terrainSurface(style: SurfaceStyle, inputs: SurfaceInputs): Surface {
  const { height, footprint } = inputs;
  const g = groundOf(style, inputs), { slope, fine, grain, beach } = g;
  const grassDetail = inputs.detail(15).g.mul(2), sandDetail = inputs.detail(30).b.mul(2), snowDetail = inputs.detail(80).a.mul(2);
  // Detail photographs lend structure only where the pixel is small enough to hold it.
  const texture = (value: Float, size: number, strength = 1): Float => mix(float(1), value, resolved(footprint, size).mul(strength));
  const shore = rgb(style.shore), low = rgb(style.low), high = rgb(style.high);
  let land: ReturnType<typeof layered>, occlusion: Float = float(1);

  if (style.style === 'snow') {
    // Vestfjord in April 1940: snow over the mountains down to a ragged line a few hundred metres up, the steepest
    // faces dark between white couloirs; below it last year's brown heath and grey rock with snow lying in patches,
    // birch scrub on the sheltered lower slopes (grey-brown twigs over snow or heath), dark skerries, and a band of
    // wet rock and weed along the tidal shore.
    const m = snowMasks(inputs, g);
    const stone = rock(inputs, high, rgb('#6d706e'));
    const heath = mix(rgb('#38352f'), rgb('#44433f'), grain).mul(texture(grassDetail, 15));
    const ground = mix(heath, stone.color, smooth(.25, .6, slope).mul(.7).add(m.shore.mul(.6)).min(1));
    const snow = rgb('#e8edf1').mul(texture(snowDetail, 60, .45)).mul(mix(float(.95), float(1.02), grain));
    // Leafless birch: twigs and trunks over whatever lies beneath, snow or heath; from afar about half the ground.
    const trees = canopy(inputs, 5, 4);
    const wood = mix(mix(ground, snow, m.snow), rgb('#3b332e').mul(trees.tint), trees.shade.mul(.35).add(.3).min(.8));
    land = layered({ color: ground, roughness: .95, specular: .3, bump: stone.height.mul(smooth(.25, .6, slope)) }, [
      [{ color: snow, roughness: .75, specular: .45 }, m.snow],
      [{ color: wood, roughness: .95, specular: .25, bump: trees.height }, m.woods],
      [{ color: stone.color, roughness: .85, specular: .5, bump: stone.height }, m.bare],
      [{ color: shore.mul(texture(inputs.detail(40).r.mul(2), 40)), roughness: .5, specular: .8 }, m.tidal],
    ]);
    occlusion = mix(float(1), trees.shade.min(1), m.woods.mul(.4));
  } else if (style.style === 'chalk') {
    // Kent and the Pas-de-Calais in February: white chalk cliffs straight from the sea, downland grass on the steep
    // chalk above them, winter farmland of ploughland, young wheat, pasture and stubble between hedgerows, bare woods
    // filling whole fields on the valley sides, shingle under the cliffs and sand across the flat bays.
    const m = chalkMasks(inputs, g);
    // Chalk: off-white, streaked grey-green down the face where water runs, darker bands of flint across it.
    const streaks = inputs.detailed === false ? float(.5) : fallStreaks(inputs, 6, 60);
    const chalk = { color: high.mul(mix(float(.78), float(1.05), streaks)).mul(texture(inputs.detail(50).r, 30, .5).mul(.3).add(.85)),
      height: streaks.mul(2.5).mul(resolved(footprint, 6)) };
    const downs = low.mul(texture(grassDetail, 15)).mul(mix(float(.88), float(1.08), grain));
    const farm = crops(inputs, m.fields, [rgb('#66584a'), rgb('#56603f'), rgb('#626b48'), rgb('#77705a'), rgb('#5a6446'), rgb('#675d4a')]);
    const hedgerow = rgb('#34362c');
    const trees = canopy(inputs, 9, 6);
    const wood = rgb('#4a433d').mul(trees.shade).mul(trees.tint);
    const bayFlat = one(smooth(.025, .07, slope));
    const sand = rgb('#a6977b').mul(texture(sandDetail, 30)), shingle = shore.mul(texture(inputs.detail(12).r.mul(2), 12));
    const hedges = m.fields.boundary.mul(m.fields.edgeNear);
    land = layered({ color: downs, roughness: .92, specular: .35 }, [
      [{ color: mix(farm.color, hedgerow, hedges), roughness: .95, specular: .35, bump: hedges.mul(3).add(farm.furrows.mul(.15)) }, m.gentle],
      // Beyond the distance where hedgerows resolve, their share of the land still darkens it.
      [{ color: mix(hedgerow, wood, .6), roughness: .95, specular: .25 }, m.gentle.mul(one(m.fields.edgeNear)).mul(.1)],
      [{ color: wood, roughness: .95, specular: .25, bump: trees.height }, m.woods],
      [{ color: chalk.color, roughness: .8, specular: .5, bump: chalk.height.mul(2) }, m.cliff],
      [{ color: mix(shingle, sand, bayFlat), roughness: .85, specular: .5 }, beach],
      // Grey shingle and fallen chalk at the foot of every cliff.
      [{ color: shingle.mul(1.1), roughness: .85, specular: .5 }, max(m.foot, m.cliff.mul(one(smooth(4, 9, height.add(g.jag.mul(3))))))],
    ]);
    occlusion = mix(float(1), trees.shade.min(1), m.woods.mul(.4));
  } else if (style.style === 'volcanic') {
    // West Java in February, the wet season: black volcanic sand, coconut palms along the shore, green and flooded
    // rice paddies across the plains with village groves filling whole plots among them, forest and plantation over
    // the hills, bare rock only where the slopes are too steep to hold soil.
    const m = volcanicMasks(inputs, g);
    const trees = canopy(inputs, 13, 4);
    const forest = low.mul(trees.shade).mul(trees.tint).mul(mix(float(.94), float(1.08), g.knoll)).mul(g.jag.mul(.12).add(1))
      .mul(mix(float(1.06), float(.9), smooth(-8, 8, fine.negate())));
    const paddy = crops(inputs, m.plots, [rgb('#5a6f45'), rgb('#557536'), rgb('#62823a'), rgb('#4d6d2d'), rgb('#6f8a44')]);
    // Palm crowns are smaller and paler than the forest's; the forest's crown pattern, finer, stands in for them.
    const palm = { shade: trees.shade.mul(.85).add(.15), height: trees.height.mul(.6) };
    const palmColor = rgb('#4f6636').mul(palm.shade).mul(trees.tint);
    const stone = rock(inputs, high, rgb('#6b6356'));
    land = layered({ color: forest, roughness: .95, specular: .25, bump: trees.height }, [
      [{ color: mix(paddy.color, rgb('#48533a'), m.plots.boundary.mul(m.plots.edgeNear).mul(.8)), roughness: .75, specular: .55 }, m.plain],
      [{ color: forest.mul(.92), roughness: .95, specular: .25, bump: trees.height }, m.plain.mul(m.grove)],
      [{ color: palmColor, roughness: .95, specular: .25, bump: palm.height }, m.palms],
      [{ color: stone.color, roughness: .85, specular: .5, bump: stone.height }, m.steep],
      // Black volcanic sand, glinting a little where the swash has left it wet.
      [{ color: shore.mul(.8).mul(texture(sandDetail, 30)), roughness: .7, specular: .6 }, beach],
    ]);
    occlusion = mix(trees.shade.min(1).mul(.3).add(.7), float(1), max(m.plain.mul(one(m.grove)), beach));
  } else {
    // Guadalcanal and the Florida Islands in 1942: rainforest canopy from the gullies to the summits; kunai grass on
    // the plains and on the ridges and spurs of the northern foothills, with gallery forest down every gully; coconut
    // plantations laid out in rows across the coastal flats; dark grey sand beaches; landslide scars on the steepest
    // mountain faces.
    const m = tropicalMasks(inputs, g);
    const trees = canopy(inputs, 15, 5);
    const forest = mix(low, low.mul(vec3(.82, .92, 1.04)), m.montane).mul(trees.shade).mul(trees.tint)
      .mul(mix(float(.94), float(1.08), g.knoll)).mul(mix(float(1.03), float(.86), m.gully)).mul(g.jag.mul(.12).add(1));
    // Kunai: warm yellow-green, paler on the dry crests, with darker tussocks and burnt patches at tens of metres.
    const grass = mix(rgb('#6c7a38'), rgb('#848843'), g.knoll.mul(.6).add(grain.mul(.4))).mul(texture(grassDetail, 15)).mul(g.jag.mul(.2).add(1));
    const rowPhase = inputs.chart.div(9).mul(2 * Math.PI);
    const rows = sin(rowPhase.x).mul(sin(rowPhase.y)).mul(.5).add(.5).mul(resolved(footprint, 9));
    const palmColor = mix(rgb('#56663a'), rgb('#6a7042'), grain).mul(mix(float(1), rows.mul(.5).add(.75), resolved(footprint, 9)));
    const stone = rock(inputs, high, rgb('#7a5e46'));
    land = layered({ color: forest, roughness: .95, specular: .25, bump: trees.height }, [
      [{ color: grass, roughness: .95, specular: .35 }, m.kunai],
      [{ color: palmColor, roughness: .95, specular: .3, bump: rows.mul(4) }, m.plantation],
      [{ color: stone.color, roughness: .9, specular: .45, bump: stone.height }, m.scar],
      [{ color: shore.mul(texture(sandDetail, 30)), roughness: .85, specular: .5 }, beach],
    ]);
    occlusion = mix(trees.shade.min(1).mul(.3).add(.7), float(1), max(m.kunai, beach));
  }

  // Under water: the style's sand, silted darker with depth, rock where the floor is steep.
  const floor = mix(shore.mul(1.15), shore.mul(.55), smooth(3, 25, height.negate())).mul(texture(sandDetail, 30));
  const seabed = mix(floor, high.mul(.5), smooth(.35, .7, slope));
  const underwater = one(smooth(-1.2, .2, height));
  let color = mix(land.color, seabed, underwater);
  // The wet band the waves wash: darker, glossy and a full mirror at grazing angles, wandering with the swash.
  const wet = one(smooth(.25, 1.5, height.add(grain.sub(.5).mul(.7)).add(g.speck.sub(.5).mul(.3)))).mul(one(underwater.mul(.6)));
  color = color.mul(mix(float(1), float(.55), wet));
  // The foam line: broken white water where the swell breaks on the shore, a few metres wide, reaching further up
  // gentle beaches; beyond the distance it resolves, its share of the pixel.
  const reach = float(.5).add(one(smooth(.05, .3, slope)).mul(.8));
  const band = smooth(-.5, -.1, height).mul(one(smooth(reach.mul(.4), reach, height.add(g.jag.mul(.4)))));
  const froth = inputs.detailed === false ? float(.45) : smooth(.4, .7, inputs.noise(23).r.add(g.speck.sub(.5).mul(.6)));
  const foam = band.mul(mix(float(.45), froth, resolved(footprint, 8))).mul(.85);
  color = mix(color, vec3(.72, .74, .74), foam);
  const roughness = mix(mix(land.roughness, float(.3), wet.mul(.85)), float(.7), foam);
  const specular = mix(mix(land.specular, float(1), wet), float(.4), foam);
  // Open sky: valleys and the feet of slopes receive less of the sky's light.
  const sky = clamp(inputs.sky, 0, 1);
  return { albedo: color, roughness, specular, occlusion: occlusion.mul(sky.mul(sky.sqrt())), bump: land.bump };
}

/** Kinds of tree in the impostor atlas (`TreeAtlas.TREE_KINDS`). */
export const TREE_KIND = { broadleaf: 0, palm: 1, conifer: 2, bare: 3 } as const;

export interface TreeCover {
  /** Chance a tree stands on this spot, 0–1. */
  readonly density: Float;
  /** Its kind (`TREE_KIND`), chosen with `pick`, a random value of the tree's own (0–1). */
  readonly kind: Float;
  /** Height in metres at the middle of its range; the tree's own random scales it by 0.75–1.25. */
  readonly height: Float;
  /** Albedo tint multiplying the impostor's colours, so the trees wear the canopy's colour beneath them. */
  readonly tint: Vec3;
}

/** Which tree stands at a point, from the same land-use masks the ground is painted with. `pick` (0–1) is the tree's
 * own random value; `inputs.footprint` should be 0, so fields and plots are read at full detail. */
export function treeCover(style: SurfaceStyle, inputs: SurfaceInputs, pick: Float): TreeCover {
  const { height } = inputs, g = groundOf(style, inputs);
  // No tree on the beach, in the sea or on bare rock and cliffs.
  const land = smooth(2.5, 5, height).mul(one(g.beach)).mul(one(smooth(.45, .6, g.slope)));
  const kind = (id: number) => float(id);
  if (style.style === 'snow') {
    const m = snowMasks(inputs, g);
    const conifer = pick.lessThan(g.hollow.mul(.3).add(.15));
    return { density: m.woods.mul(one(m.bare)).mul(land).mul(.8), kind: select(conifer, kind(TREE_KIND.conifer), kind(TREE_KIND.bare)),
      height: select(conifer, float(15), float(11)), tint: select(conifer, vec3(.95, 1, 1), vec3(1.15, 1.1, 1.05)) };
  }
  if (style.style === 'chalk') {
    const m = chalkMasks(inputs, g);
    const conifer = pick.lessThan(.12);
    const density = max(m.woods.mul(.95), m.hedges.mul(.35)).mul(one(m.cliff)).mul(land);
    return { density, kind: select(conifer, kind(TREE_KIND.conifer), kind(TREE_KIND.bare)), height: select(conifer, float(18), float(19)),
      tint: select(conifer, vec3(.85, .9, .88), vec3(1.25, 1.2, 1.15)) };
  }
  if (style.style === 'volcanic') {
    const m = volcanicMasks(inputs, g);
    const fringe = one(smooth(150, 400, g.coast)).mul(smooth(2, 4, height)).mul(one(smooth(12, 25, height)));
    const palmShare = max(max(m.palms, fringe), m.plain.mul(m.grove).mul(.5));
    const palm = pick.lessThan(palmShare);
    const density = max(one(m.plain).mul(one(m.steep)).mul(.95), max(m.plain.mul(m.grove).mul(.85), max(m.palms.mul(.7), fringe.mul(.8)))).mul(land);
    return { density, kind: select(palm, kind(TREE_KIND.palm), kind(TREE_KIND.broadleaf)), height: select(palm, float(20), float(24)),
      tint: select(palm, vec3(.92, .95, .9), vec3(.95, .97, .95)) };
  }
  const m = tropicalMasks(inputs, g);
  const fringe = one(smooth(120, 350, g.coast)).mul(smooth(1.8, 4, height)).mul(one(smooth(10, 25, height)));
  const palmShare = max(m.plantation, fringe);
  const palm = pick.lessThan(palmShare);
  const forest = one(m.kunai).mul(one(m.plantation)).mul(one(m.scar));
  const density = max(forest.mul(.95), max(m.plantation.mul(.85), max(fringe.mul(.75), m.kunai.mul(.03)))).mul(smooth(1.5, 3, height));
  return { density, kind: select(palm, kind(TREE_KIND.palm), kind(TREE_KIND.broadleaf)),
    height: select(palm, float(22), mix(float(30), float(20), m.montane)), tint: select(palm, vec3(.95, .95, .88), vec3(.95, 1, .98)) };
}
