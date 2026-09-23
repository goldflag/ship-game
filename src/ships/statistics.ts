import { effectiveHandling } from './mobility';
import type { GunPart, ShipDefinition } from './blueprint';
import { ANTI_AIRCRAFT_MAX_CALIBER_M, antiAircraftRange, gunTraverseLimitsDeg, torpedoArcLabel } from './armament';
import { KNOTS_PER_MPS } from '../game/session/motion';
import { ballisticStep } from '../game/ballistics';
import { maxHullIntegrity } from './durability';
import { GRAVITY } from '../game/mountGeometry';
import { armorZones, calibreLabel, gunBatteries, type GunBattery } from './particulars';

/** One figure on the port statistics sheet. `text` values are names, not measurements. */
export interface StatRow {
  label: string;
  value: string;
  unit?: string;
  help: string;
  text?: boolean;
}
export interface StatSection {
  id: string;
  title: string;
  /** Calibre or other qualifier printed beside the title. */
  subtitle?: string;
  headline: string;
  headlineUnit?: string;
  headlineHelp: string;
  rows: StatRow[];
  notes?: { label: string; text: string }[];
  collapsed?: boolean;
}
export type StatScoreId = 'survivability' | 'artillery' | 'airDefense' | 'maneuverability' | 'concealment';
export interface StatScore {
  id: StatScoreId;
  label: string;
  score: number;
  help: string;
}

/** Solver range cap shared with `solveBallistic`. */
const MAX_BALLISTIC_RANGE_M = 30000;
/** The 0-100 category scores compare every ship against these fixed references, not against each other. */
export const SCORE_REFERENCES = {
  hullIntegrity: 73_553,
  armorMm: 410,
  mainDamagePerMinute: 2000,
  penetrationMm: 650,
  dualPurposeDamagePerMinute: 6000,
  speedKn: 40,
  yawRateRadPerSecond: 0.05,
  largestPlanRootM: 130,
  smallestPlanRootM: 50,
  dualPurposeCaliberM: ANTI_AIRCRAFT_MAX_CALIBER_M,
} as const;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const barrels = (weapon: GunPart) => weapon.barrelCount;
const salvoDamage = (weapon: GunPart) => barrels(weapon) * weapon.damage;
const damagePerMinute = (mounts: ShipDefinition['mounts']) =>
  mounts.reduce((n, m) => n + (salvoDamage(m.weapon) * 60) / m.weapon.reloadSeconds, 0);
/** Flat-water range of the low ballistic arc, limited by elevation and the solver's range cap. */
export function maximumRangeM(weapon: GunPart): number {
  const elevation = (Math.min(weapon.elevationMaxDeg, 45) * Math.PI) / 180;
  const drag = weapon.ballistics.dragPerSecond;
  if (drag < 1e-8) return Math.min(MAX_BALLISTIC_RANGE_M, (weapon.muzzleSpeed ** 2 * Math.sin(2 * elevation)) / GRAVITY);
  const rangeAt = (angle: number) => {
    const velocity: [number, number, number] = [weapon.muzzleSpeed * Math.cos(angle), weapon.muzzleSpeed * Math.sin(angle), 0];
    let low = 0,
      high = 180;
    for (let i = 0; i < 32; i++) {
      const time = (low + high) / 2;
      if (ballisticStep([0, 0, 0], velocity, time, drag).position[1] > 0) low = time;
      else high = time;
    }
    return ballisticStep([0, 0, 0], velocity, (low + high) / 2, drag).position[0];
  };
  // Drag shifts the maximum below 45 degrees; search the permitted low arc.
  let low = (Math.max(0, weapon.elevationMinDeg) * Math.PI) / 180,
    high = elevation;
  for (let i = 0; i < 24; i++) {
    const a = low + (high - low) / 3,
      b = high - (high - low) / 3;
    if (rangeAt(a) < rangeAt(b)) low = a;
    else high = b;
  }
  return Math.min(MAX_BALLISTIC_RANGE_M, rangeAt((low + high) / 2));
}
const knots = (metersPerSecond: number) => metersPerSecond * KNOTS_PER_MPS;
const format = (n: number, digits = 0) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const thickest = (def: ShipDefinition) => def.armor.reduce((best, a) => (a.thicknessMm > best.thicknessMm ? a : best), def.armor[0]);
/** Menu summaries of historical ships carry the thickest plate instead of the plates themselves. */
export function thickestArmorMm(def: ShipDefinition): number {
  if (!('armor' in def)) return (def as { armorMaxMm?: number }).armorMaxMm ?? 0;
  return def.armor.length ? thickest(def).thicknessMm : 0;
}
/** The heaviest calibre, however the design flags its batteries. */
const mainMounts = (def: ShipDefinition) => (gunBatteries(def)[0]?.mountIndexes ?? []).map((i) => def.mounts[i]);
const dualPurposeMounts = (def: ShipDefinition) => def.mounts.filter((m) => antiAircraftRange(m) > 0);

/** One figure on the builder's plate under a ship's name in port. */
export interface SpecFigure {
  label: string;
  value: string;
  unit?: string;
}
/** Principal dimensions, speed and the heaviest main guns, read from the same definition as the sheet. */
export function shipSpec(def: ShipDefinition): SpecFigure[] {
  const h = def.hull,
    main = mainMounts(def),
    speed = knots(effectiveHandling(def.handling, !!def.maneuvering).forwardSpeed);
  const caliber = main.reduce((n, m) => Math.max(n, m.weapon.caliberM), 0);
  const guns = main.filter((m) => m.weapon.caliberM === caliber).reduce((n, m) => n + barrels(m.weapon), 0);
  return [
    { label: 'Length', value: format(h.length, 1), unit: 'm' },
    { label: 'Beam', value: format(h.beam, 1), unit: 'm' },
    { label: 'Draft', value: format(h.draft, 2), unit: 'm' },
    { label: 'Displacement', value: format(h.massKg / 1000), unit: 't' },
    { label: 'Speed', value: format(Number.isFinite(speed) ? speed : 0, 1), unit: 'kn' },
    main.length
      ? { label: 'Main battery', value: `${guns} × ${format(Math.round(caliber * 1000))}`, unit: 'mm' }
      : { label: 'Main battery', value: 'None' },
  ];
}

/** One of the eight particulars under the port ratings. */
export interface Particular extends SpecFigure {
  help: string;
}
/** Protection, guns and handling at a glance, read from the same definition as the sheet. */
export function shipParticulars(def: ShipDefinition): Particular[] {
  const zones = armorZones(def),
    belt = zones.find((z) => z.id === 'belt'),
    deck = zones.find((z) => z.id === 'deck');
  const main = gunBatteries(def)[0],
    mounts = main ? main.mountIndexes.map((i) => def.mounts[i]) : [];
  const handling = effectiveHandling(def.handling, !!def.maneuvering);
  const turning = handling.forwardSpeed > 0 && handling.maxYawRate > 0 ? (2 * handling.forwardSpeed) / handling.maxYawRate : 0;
  const range = mounts.length ? Math.max(...mounts.map((m) => maximumRangeM(m.weapon))) : 0;
  return [
    { label: 'Hull integrity', value: format(maxHullIntegrity(def)), unit: 'HP', help: 'Gameplay hull durability. Reaching zero starts sinking; flooding and capsize can also sink the ship.' },
    belt
      ? { label: 'Main belt', value: format(belt.maxMm), unit: 'mm', help: `Heaviest side armor, ${format(belt.span[0])}–${format(belt.span[1])} m from the bow.` }
      : { label: 'Main belt', value: 'None', help: 'No side armor of 50 mm or more.' },
    deck
      ? { label: 'Armored deck', value: format(deck.maxMm), unit: 'mm', help: 'Heaviest horizontal protection over the machinery and magazines.' }
      : { label: 'Armored deck', value: 'None', help: 'No deck armor of 25 mm or more.' },
    main
      ? { label: 'Main battery', value: `${main.barrels} × ${format(main.calibreMm)}`, unit: 'mm', help: `${mounts.length} ${mounts.length === 1 ? 'mount' : 'mounts'} of ${mounts[0].weapon.name}.` }
      : { label: 'Main battery', value: 'None', help: 'No guns are fitted.' },
    range
      ? { label: 'Gun range', value: format(range / 1000, 1), unit: 'km', help: 'Maximum flat-water range of the main battery with drag, over the permitted low arc.' }
      : { label: 'Gun range', value: '—', help: 'No guns are fitted.' },
    { label: 'Top speed', value: format(knots(handling.forwardSpeed), 1), unit: 'kn', help: 'Full ahead with undamaged machinery.' },
    turning
      ? { label: 'Turning circle', value: format(turning), unit: 'm', help: 'Reference diameter from design speed and the full-rudder turning rate.' }
      : { label: 'Turning circle', value: '—', help: 'The ship has no way on: fit machinery to turn.' },
    { label: 'Flooding reserve', value: format(def.compartments.reduce((n, c) => n + c.capacityM3, 0)), unit: 'm³', help: `Water the ${def.compartments.length} compartments can hold.` },
  ];
}

/** Gameplay calibration only: each score reads the same simulation inputs the sheet prints. */
export function shipScores(def: ShipDefinition): StatScore[] {
  const r = SCORE_REFERENCES,
    main = mainMounts(def);
  const armorMm = thickestArmorMm(def);
  const penetration = main.length ? Math.max(...main.map((m) => m.weapon.penetrationMm)) : 0;
  const planRoot = Math.sqrt(def.hull.length * def.hull.beam);
  const score = (value: number) => Math.round(clamp(value, 0, 100));
  return [
    {
      id: 'survivability',
      label: 'Survivability',
      score: score((70 * maxHullIntegrity(def)) / r.hullIntegrity + (30 * armorMm) / r.armorMm),
      help: `Approximation from displacement and thickest plate against ${r.armorMm} mm. Flooding and stability determine whether the ship sinks.`,
    },
    {
      id: 'artillery',
      label: 'Artillery',
      score: score((70 * damagePerMinute(main)) / r.mainDamagePerMinute + (30 * penetration) / r.penetrationMm),
      help: `Main battery damage per minute against ${format(r.mainDamagePerMinute)} and penetration against ${r.penetrationMm} mm.`,
    },
    {
      id: 'airDefense',
      label: 'Air defense',
      score: score((100 * damagePerMinute(dualPurposeMounts(def))) / r.dualPurposeDamagePerMinute),
      help: `Damage per minute from registered guns of ${Math.round(r.dualPurposeCaliberM * 1000)} mm or less with at least 70° elevation, against ${format(r.dualPurposeDamagePerMinute)}. Ships without AA-capable guns score zero.`,
    },
    {
      id: 'maneuverability',
      label: 'Maneuverability',
      score: score(
        (40 * knots(def.handling.forwardSpeed)) / r.speedKn +
          (60 * effectiveHandling(def.handling, !!def.maneuvering).maxYawRate) / r.yawRateRadPerSecond,
      ),
      help: `Top speed against ${r.speedKn} kn and turning rate against ${((r.yawRateRadPerSecond * 180) / Math.PI).toFixed(1)}°/s.`,
    },
    {
      id: 'concealment',
      label: 'Concealment',
      score: score((100 * (r.largestPlanRootM - planRoot)) / (r.largestPlanRootM - r.smallestPlanRootM)),
      help: 'Smaller waterline plan (length × beam) scores higher. Detection is not yet simulated.',
    },
  ];
}

function batteryRows(mounts: ShipDefinition['mounts'], withName: boolean, definition: ShipDefinition): StatRow[] {
  const weapon = mounts[0].weapon;
  const groups = new Map<number, number>();
  for (const mount of mounts) groups.set(barrels(mount.weapon), (groups.get(barrels(mount.weapon)) ?? 0) + 1);
  const layout = [...groups].map(([barrels, count]) => `${count} × ${barrels}`).join(' + ');
  const traverse = (mount: ShipDefinition['mounts'][number]) => {
    const [low, high] = gunTraverseLimitsDeg(mount);
    return `${low === -high ? `±${high}°` : `${low}° to ${high}°`} · ${mount.weapon.traverseRateDeg}°/s`;
  };
  const travels = new Map<string, number>();
  for (const mount of mounts) travels.set(traverse(mount), (travels.get(traverse(mount)) ?? 0) + 1);
  const traverseRows = [...travels].map(([value, count]) => ({
    label: travels.size === 1 ? 'Traverse' : `Traverse · ${count} ${count === 1 ? 'mount' : 'mounts'}`,
    value,
    help: 'Travel relative to the mount’s neutral bearing and training speed.',
  }));
  return [
    ...(withName
      ? [{ label: weapon.name, value: layout, help: 'Mounts × barrels per mount.', text: true }]
      : [{ label: 'Layout', value: layout, help: 'Mounts × barrels per mount.' }]),
    {
      label: 'Reload',
      value: format(weapon.reloadSeconds, weapon.reloadSeconds < 10 ? 1 : 0),
      unit: 's',
      help: 'Seconds between salvos from one mount.',
    },
    {
      label: 'Salvo damage',
      value: format(mounts.reduce((sum, m) => sum + salvoDamage(m.weapon), 0)),
      help: 'Nominal AP damage budget for the full battery. Actual damage depends on the penetration path and fuze burst.',
    },
    { label: 'Damage per minute', value: format(damagePerMinute(mounts)), help: 'Full-battery salvo damage times salvos per minute.' },
    {
      label: 'Penetration',
      value: format(weapon.penetrationMm),
      unit: 'mm',
      help: 'AP budget at the reference speed. Velocity, impact angle and plate material determine penetration; sufficient resistance arms the fuze.',
    },
    {
      label: 'Muzzle velocity',
      value: format(weapon.muzzleSpeed),
      unit: 'm/s',
      help: 'Nominal launch speed before dispersion. Shells slow under drag and fall under gravity.',
    },
    {
      label: 'Shell mass',
      value: format(weapon.projectileMassKg, weapon.projectileMassKg < 10 ? 2 : 0),
      unit: 'kg',
      help: 'Projectile mass carried by each shot.',
    },
    {
      label: 'Maximum range',
      value: format(maximumRangeM(weapon) / 1000, 1),
      unit: 'km',
      help: 'Maximum flat-water range with drag over the permitted low arc, capped by the fire-control solver.',
    },
    { label: 'Elevation', value: `${weapon.elevationMinDeg}° to ${weapon.elevationMaxDeg}°`, help: 'Barrel elevation limits.' },
    ...(definition.mountClearance?.mounts?.some((e) => mounts.some((m) => m.id === e.mountId)) ||
    definition.mountClearance?.mountIds?.some((id) => mounts.some((m) => m.id === id))
      ? [
          {
            label: 'Motion clearance',
            value: 'Interlocked',
            help: 'Fitted guns stop before entering a platform or neighboring turret. Reachable elevation depends on bearing and nearby gun positions.',
          },
        ]
      : []),
    ...traverseRows,
    {
      label: 'Ammunition',
      value: format(mounts.reduce((n, m) => n + m.weapon.ammoPerBarrel * barrels(m.weapon), 0)),
      unit: 'rounds',
      help: 'Rounds for the whole battery. Firing a salvo spends one per barrel.',
    },
    {
      label: 'Gunhouse armor',
      value: format(weapon.armorMm),
      unit: 'mm',
      help: 'Nominal gunhouse protection used when no authored gunhouse plates exist.',
    },
  ];
}

/** Everything the sheet prints is read from the compiled definition combat uses. */
export function shipStatistics(def: ShipDefinition): StatSection[] {
  const hp = maxHullIntegrity(def),
    h = def.hull,
    handling = effectiveHandling(def.handling, !!def.maneuvering);
  const engines = def.modules.filter((m) => m.kind === 'engine').length,
    magazines = def.modules.filter((m) => m.kind === 'magazine').length,
    steering = def.modules.filter((m) => m.kind === 'steering').length;
  const floodingM3 = def.compartments.reduce((n, c) => n + c.capacityM3, 0),
    pumpM3PerMinute = def.compartments.reduce((n, c) => n + c.pumpM3PerSecond, 0) * 60;
  const survivability: StatSection = {
    id: 'survivability',
    title: 'Survivability',
    headline: format(hp),
    headlineUnit: 'HP',
    headlineHelp:
      'Gameplay hull durability. Reaching zero starts sinking; flooding and capsize can also sink the ship. Equipment condition is separate, and losing every weapon or its ammunition can end the fight while afloat.',
    rows: [
      { label: 'Displacement', value: format(h.massKg / 1000), unit: 't', help: 'Standard-draft hull mass used for buoyancy and loading.' },
      {
        label: 'Reserve buoyancy',
        value: format(h.reserveBuoyancyM3),
        unit: 'm³',
        help: 'Nominal authored reserve. Ships with a stability profile use their actual hull geometry, loading and list to determine loss of flotation.',
      },
      { label: 'Compartments', value: format(def.compartments.length), help: 'Watertight spaces that can flood independently.' },
      { label: 'Flooding capacity', value: format(floodingM3), unit: 'm³', help: 'Total water the compartments can hold.' },
      {
        label: 'Pumping',
        value: format(pumpM3PerMinute, 1),
        unit: 'm³/min',
        help: 'Fixed pumps across all compartments. Damage-control teams can add portable pumping after setup.',
      },
      {
        label: 'Machinery modules',
        value: format(engines),
        help: 'Boiler, turbine and shaft modules. Damage and immersion affect their connected drive systems.',
      },
      {
        label: 'Magazines',
        value: format(magazines),
        help: 'Loss or immersion cuts ammunition supply to linked mounts. Sufficient ignition can cause a magazine explosion.',
      },
      { label: 'Steering modules', value: format(steering), help: 'Steering gear modules. Damage reduces rudder authority.' },
      ...(def.structuralPlating
        ? [
            {
              label: 'Hull plating',
              value: `${def.structuralPlating.hullMm} / ${def.structuralPlating.superstructureMm}`,
              unit: 'mm',
              help: 'Ordinary steel shell and deckhouse plating. Gameplay estimates that register hits outside the armor.',
            },
          ]
        : []),
    ],
  };
  const plate = def.armor.length ? thickest(def) : undefined;
  const zones = armorZones(def),
    zone = (id: string) => zones.find((z) => z.id === id);
  const belt = zone('belt'),
    deck = zone('deck'),
    turrets = zone('turrets'),
    conning = zone('conning');
  const main = mainMounts(def);
  const gunhouse = turrets?.maxMm ?? main[0]?.weapon.armorMm ?? 0;
  const materials = [...new Set(def.armor.map((a) => a.plate?.material).filter((m): m is NonNullable<typeof m> => !!m))];
  const basis = ['documented', 'plan-measured', 'estimated', 'inferred']
    .map((kind) => [kind, def.armor.filter((a) => a.provenance?.basis === kind).length] as const)
    .filter(([, n]) => n > 0);
  const zoneOfThickest = plate && zones.find((z) => z.id !== 'underwater' && z.maxMm === plate.thicknessMm);
  const armor: StatSection = {
    id: 'armor',
    title: 'Armor',
    headline: format(belt?.maxMm ?? plate?.thicknessMm ?? 0),
    headlineUnit: belt ? 'mm belt' : 'mm',
    headlineHelp: belt
      ? 'Heaviest side armor. Zones are read from where each plate sits, not from its name.'
      : plate
        ? 'Thickest armor volume. This ship has no side armor of 50 mm or more.'
        : 'No armor volumes are authored for this ship.',
    rows: [
      ...(belt ? [{ label: 'Main belt', value: format(belt.maxMm), unit: 'mm', help: `Heaviest side armor, ${format(belt.span[0])}–${format(belt.span[1])} m from the bow.` }] : []),
      ...(deck ? [{ label: 'Armored deck', value: format(deck.maxMm), unit: 'mm', help: 'Heaviest horizontal protection over the machinery and magazines.' }] : []),
      ...(main.length
        ? [
            {
              label: 'Main gunhouse',
              value: format(gunhouse),
              unit: 'mm',
              help: 'Thickest authored main gunhouse plate, or the nominal gunhouse armor when none is authored.',
            },
          ]
        : []),
      ...(conning ? [{ label: 'Conning tower', value: format(conning.maxMm), unit: 'mm', help: 'Thickest plate of the armored command position.' }] : []),
      ...(plate && zoneOfThickest
        ? [{ label: 'Thickest plate', value: `${format(plate.thicknessMm)} mm · ${zoneOfThickest.label}`, help: 'The armor volume with the greatest thickness, and its zone.', text: true }]
        : []),
      { label: 'Armor volumes', value: format(def.armor.length), help: 'Plates and boxes that stop or slow shells before the interior.' },
      ...(materials.length
        ? [
            {
              label: 'Materials',
              value: materials.join(' · '),
              help: 'Plate materials named in the armor scheme. Teak backing has no steel-equivalent resistance.',
              text: true,
            },
          ]
        : []),
      ...(basis.length
        ? [
            {
              label: 'Evidence',
              value: basis.map(([kind, n]) => `${n} ${kind}`).join(' · '),
              help: 'How many volumes come from documents, plan measurements, estimates or inference.',
              text: true,
            },
          ]
        : []),
    ],
  };
  const batteries = gunBatteries(def);
  const batterySection = (battery: GunBattery, rank: number): StatSection => {
    const mounts = battery.mountIndexes.map((i) => def.mounts[i]);
    const parts = [...new Map(mounts.map((m) => [m.partId, mounts.filter((other) => other.partId === m.partId)])).values()];
    return {
      id: rank === 0 ? 'main-battery' : battery.id,
      title: battery.role === 'Main battery' ? 'Main battery' : battery.role === 'Secondary' ? 'Secondary battery' : 'Dual-purpose battery',
      subtitle: battery.label,
      headline: rank === 0 ? format(battery.calibreMm) : format(battery.barrels),
      headlineUnit: rank === 0 ? 'mm' : 'barrels',
      headlineHelp:
        rank === 0
          ? `${mounts[0].weapon.name}. Caliber sets the shell and the gunhouse envelope.`
          : `${battery.label} guns${battery.role === 'Dual-purpose' ? ', which also engage aircraft' : ''}. Every mount of this calibre, whatever battery the design assigns it to.`,
      rows:
        parts.length === 1
          ? [{ label: 'Gun', value: mounts[0].weapon.name, help: 'Weapon fitted to these mounts.', text: true }, ...batteryRows(mounts, false, def)]
          : parts.flatMap((group) =>
              batteryRows(group, true, def).filter((row) => ['Reload', 'Damage per minute', 'Maximum range', 'Penetration', 'Motion clearance'].includes(row.label) || row.text),
            ),
      collapsed: rank > 0,
    };
  };
  const heavy = batteries.filter((b, rank) => rank === 0 || b.role !== 'Light AA');
  const light = batteries.filter((b, rank) => rank > 0 && b.role === 'Light AA');
  const gunSections: StatSection[] = heavy.map((battery) => batterySection(battery, batteries.indexOf(battery)));
  if (light.length)
    gunSections.push({
      id: 'light-aa',
      title: 'Light AA',
      subtitle: light.map((b) => b.label).join(' and '),
      headline: format(light.reduce((n, b) => n + b.barrels, 0)),
      headlineUnit: 'barrels',
      headlineHelp: 'Automatic guns of 40 mm or less.',
      rows: light.flatMap((battery) => {
        const mounts = battery.mountIndexes.map((i) => def.mounts[i]);
        const parts = [...new Map(mounts.map((m) => [m.partId, mounts.filter((other) => other.partId === m.partId)])).values()];
        return parts.flatMap((group) =>
          batteryRows(group, true, def).filter((row) => ['Reload', 'Damage per minute', 'Maximum range'].includes(row.label) || row.text),
        );
      }),
      collapsed: true,
    });
  const tubes = def.torpedoTubes ?? [];
  const torpedoGroups = [...new Map(tubes.map((t) => [t.partId, tubes.filter((other) => other.partId === t.partId)])).values()];
  const torpedoBatteries: StatSection[] = torpedoGroups.map((group) => {
    const weapon = group[0].weapon;
    return {
      id: `torpedoes-${weapon.id}`,
      title: 'Torpedoes',
      headline: format(group.length),
      headlineUnit: 'tubes',
      headlineHelp: `${weapon.name}. Torpedoes keep a straight course after launch within their allowed bearing arcs.`,
      collapsed: true,
      rows: [
        { label: 'Weapon', value: weapon.name, help: 'Torpedo component fitted to these tubes.', text: true },
        { label: 'Diameter', value: format(weapon.diameterM * 1000), unit: 'mm', help: 'Diameter of the torpedo body.' },
        {
          label: 'Ammunition',
          value: format(group.reduce((n, t) => n + t.ammo, 0)),
          unit: 'rounds',
          help: 'Initial ammunition across these tubes, including reloads.',
        },
        {
          label: 'Speed',
          value: format(knots(weapon.speed)),
          unit: 'kn',
          help: 'Constant speed after launch; no homing or later steering.',
        },
        {
          label: 'Maximum range',
          value: format(weapon.rangeM / 1000, 1),
          unit: 'km',
          help: 'Maximum distance before the torpedo expires.',
        },
        {
          label: 'Running depth',
          value: format(weapon.runningDepthM, 1),
          unit: 'm',
          help: 'Depth below the CPU sea datum, reached gradually after launch.',
        },
        {
          label: 'Arming distance',
          value: format(weapon.armingDistanceM),
          unit: 'm',
          help: 'Earlier contact is a harmless dud. Provisional game tuning.',
        },
        {
          label: 'Reload',
          value: group.every((t) => t.ammo <= 1) ? 'No reloads carried' : format(weapon.reloadSeconds),
          unit: group.every((t) => t.ammo <= 1) ? undefined : 's',
          help: 'Per-tube reloads only apply when spare torpedoes are carried. Provisional game tuning.',
        },
        {
          label: 'Module damage',
          value: format(weapon.damage * 0.5),
          unit: 'max',
          help: 'Maximum damage to one nearby module from an armed hit. Distance reduces damage, and remaining module condition caps it. The local flooding breach is resolved separately.',
        },
        {
          label: 'Flood opening',
          value: format(weapon.breachAreaM2, 1),
          unit: 'm²',
          help: 'Local opening from an armed hit, capped at 4 m² per compartment across repeated strikes.',
        },
        {
          label: 'Tube bearings',
          value: def.torpedoLaunchers?.length
            ? `${def.torpedoLaunchers.length} trainable mounts`
            : [...new Set(group.map((t) => `${t.bearingDeg}°`))].join(' / '),
          help: 'Bearings relative to the bow; trainable assemblies follow your aim.',
        },
        {
          label: 'Launch arcs',
          value: torpedoArcLabel(def),
          help: 'Permitted ship-relative launch bearings. Turning launchers must align first.',
        },
      ],
    };
  });
  const charges = def.depthChargeLaunchers ?? [];
  const depthChargeBatteries: StatSection[] = [...new Set(charges.map((l) => l.partId))].map((partId) => {
    const group = charges.filter((l) => l.partId === partId),
      weapon = group[0].weapon;
    return {
      id: `depth-charges-${partId}`,
      title: 'Depth charges',
      headline: format(group.reduce((n, l) => n + l.ammo, 0)),
      headlineUnit: 'charges',
      headlineHelp: 'Initial ammunition across the stern racks and side throwers.',
      collapsed: true,
      rows: [
        { label: 'Weapon', value: weapon.name, text: true, help: 'Depth charge component fitted to these stations.' },
        {
          label: 'Release stations',
          value: format(group.length),
          help: 'Each ready rack or thrower releases one charge per firing request.',
        },
        {
          label: 'Detonation depth',
          value: format(weapon.detonationDepthM),
          unit: 'm',
          help: 'Shallow gameplay setting below the CPU sea datum. Submarines currently operate on the surface.',
        },
        { label: 'Sink speed', value: format(weapon.sinkSpeed, 1), unit: 'm/s', help: 'Constant sinking speed after entering the water.' },
        {
          label: 'Blast radius',
          value: format(weapon.blastRadiusM),
          unit: 'm',
          help: 'Damage falls with distance to the submerged hull. Allies and the launching ship can be hit. Provisional tuning.',
        },
        {
          label: 'Module damage',
          value: format(weapon.damage * 0.5),
          unit: 'max',
          help: 'Maximum damage to one nearby module. Hull distance reduces blast strength quadratically; module distance and remaining condition further limit damage.',
        },
        {
          label: 'Flood opening',
          value: format(weapon.breachAreaM2, 1),
          unit: 'm² max',
          help: 'Opening at zero hull distance; blast falloff reduces it. Repeated blasts share the 4 m² compartment cap.',
        },
        {
          label: 'Reload',
          value: format(weapon.reloadSeconds),
          unit: 's',
          help: 'Gameplay time to prepare another charge at a station with ammunition remaining.',
        },
      ],
    };
  });
  const turningDiameterM = (2 * handling.forwardSpeed) / handling.maxYawRate;
  const mobility: StatSection = {
    id: 'mobility',
    title: 'Mobility',
    headline: format(knots(handling.forwardSpeed), 1),
    headlineUnit: 'kn',
    headlineHelp: 'Top speed at full ahead with undamaged machinery.',
    rows: [
      { label: 'Astern', value: format(knots(handling.reverseSpeed), 1), unit: 'kn', help: 'Top speed going astern.' },
      {
        label: 'Acceleration reference',
        value: format(handling.forwardSpeed / handling.acceleration),
        unit: 's',
        help: 'Top speed divided by initial acceleration. Actual acceleration falls as water resistance increases; use a sea trial to measure time to speed.',
      },
      {
        label: 'Braking reference',
        value: format(handling.forwardSpeed / handling.braking),
        unit: 's',
        help: 'Top speed divided by initial full-astern deceleration. Actual stopping time depends on changing drag, thrust and loading.',
      },
      { label: 'Rudder shift', value: format(2 / handling.rudderRate, 1), unit: 's', help: 'Hard over to hard over.' },
      {
        label: 'Turning rate',
        value: format((handling.maxYawRate * 180) / Math.PI, 2),
        unit: '°/s',
        help: 'Design estimate with full rudder. Actual turning follows rudder forces, sideslip, loading and machinery condition.',
      },
      {
        label: 'Turning circle',
        value: format(turningDiameterM),
        unit: 'm',
        help: 'Reference diameter from design speed and turning estimate. Actual turning circles depend on speed loss, loading, rudder immersion and machinery condition.',
      },
      { label: 'Machinery spaces', value: format(engines), help: 'Boiler, turbine and shaft modules that each supply a share of power.' },
    ],
  };
  const dimensions: StatSection = {
    id: 'dimensions',
    title: 'Dimensions',
    headline: format(h.length, 1),
    headlineUnit: 'm',
    headlineHelp: 'Length overall of the authored hull.',
    rows: [
      { label: 'Beam', value: format(h.beam, 1), unit: 'm', help: 'Maximum breadth.' },
      { label: 'Draft', value: format(h.draft, 2), unit: 'm', help: 'Keel depth below the waterline at the standard datum.' },
      { label: 'Depth', value: format(h.depth, 1), unit: 'm', help: 'Keel to upper deck.' },
      {
        label: 'Waterplane area',
        value: format(h.waterplaneAreaM2),
        unit: 'm²',
        help: 'Nominal waterline area. The stability model integrates the changing submerged hull as loading and list change.',
      },
      { label: 'Length to beam', value: format(h.length / h.beam, 2), help: 'Slender hulls make speed more cheaply and turn wider.' },
      { label: 'Mounts', value: format(def.mounts.length), help: 'Gun mounts of every battery.' },
    ],
    collapsed: true,
  };
  const modelBasis: StatSection = {
    id: 'model-basis',
    title: 'Model basis',
    headline: `${format(def.armor.length + def.modules.length + def.compartments.length)}`,
    headlineUnit: 'volumes',
    headlineHelp: 'Armor, module and compartment volumes simulated for this ship.',
    rows: [],
    collapsed: true,
    notes: [
      { label: 'Exterior', text: def.accuracy.exterior },
      { label: 'Internals', text: def.accuracy.internals },
      { label: 'Weapons', text: def.accuracy.weapons },
    ],
  };
  const s = def.submarine;
  const diving: StatSection[] = s
    ? [
        {
          id: 'diving',
          title: 'Diving',
          headline: format(knots(s.submergedHandling.forwardSpeed), 1),
          headlineUnit: 'kn submerged',
          headlineHelp: 'Full ahead on undamaged electric motors. Diving parameters are provisional gameplay tuning.',
          collapsed: true,
          rows: [
            {
              label: 'Periscope depth',
              value: format(s.periscopeDepthM),
              unit: 'm',
              help: 'Depth below the surfaced waterline datum; the raised scope remains above water.',
            },
            {
              label: 'Operating limit',
              value: format(s.maxDepthM),
              unit: 'm',
              help: 'Maximum depth order. Pressure beyond this limit damages the hull.',
            },
            {
              label: 'Torpedo launch limit',
              value: format(s.maxTorpedoDepthM),
              unit: 'm',
              help: 'Rise to this depth or less to use torpedoes. Guns require surfacing.',
            },
            {
              label: 'Ballast capacity',
              value: format(s.ballastCapacityM3),
              unit: 'm³',
              help: 'Combined ballast and trim capacity in the simplified depth keeper. Separate from damage flooding.',
            },
            {
              label: 'Maximum dive / rise',
              value: `${format(s.maxDiveSpeed, 1)} / ${format(s.maxRiseSpeed, 1)}`,
              unit: 'm/s',
              help: 'Vertical speed limits. Filling tanks takes time; planes help when underway.',
            },
          ],
        },
      ]
    : [];
  return [
    survivability,
    armor,
    ...gunSections,
    ...torpedoBatteries,
    ...depthChargeBatteries,
    mobility,
    ...diving,
    dimensions,
    modelBasis,
  ];
}
