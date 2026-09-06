import type { GunPart, ShipDefinition } from './blueprint';
import { maxHullIntegrity } from '../simulation/damage';
import { KNOTS_PER_MPS } from '../simulation/ship';
import { GRAVITY } from '../simulation/weapons';
import { ballisticStep } from '../simulation/ballistics';

/** One figure on the port statistics sheet. `text` values are names, not measurements. */
export interface StatRow { label: string; value: string; unit?: string; help: string; text?: boolean }
export interface StatSection {
  id: string; title: string; headline: string; headlineUnit?: string; headlineHelp: string;
  rows: StatRow[]; notes?: { label: string; text: string }[]; collapsed?: boolean;
}
export type StatScoreId = 'survivability' | 'artillery' | 'airDefense' | 'maneuverability' | 'concealment';
export interface StatScore { id: StatScoreId; label: string; score: number; help: string }

/** Solver range cap shared with `solveBallistic`. */
const MAX_BALLISTIC_RANGE_M = 30000;
/** The 0-100 category scores compare every ship against these fixed references, not against each other. */
export const SCORE_REFERENCES = {
  hullIntegrity: 1750, armorMm: 410, mainDamagePerMinute: 2000, penetrationMm: 650,
  dualPurposeDamagePerMinute: 6000, speedKn: 40, yawRateRadPerSecond: 0.05, largestPlanRootM: 130, smallestPlanRootM: 50,
  /** Dual-purpose and light batteries at or below this bore engage aircraft. */
  dualPurposeCaliberM: 0.13,
} as const;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const barrels = (weapon: GunPart) => weapon.barrelCount ?? 2;
const salvoDamage = (weapon: GunPart) => barrels(weapon) * weapon.damage;
const damagePerMinute = (mounts: ShipDefinition['mounts']) => mounts.reduce((n, m) => n + salvoDamage(m.weapon) * 60 / m.weapon.reloadSeconds, 0);
/** Flat-water range of the low ballistic arc, limited by elevation and the solver's range cap. */
export function maximumRangeM(weapon: GunPart): number {
  const elevation = Math.min(weapon.elevationMaxDeg, 45) * Math.PI / 180;
  const drag = weapon.ballistics?.dragPerSecond ?? 0;
  if (drag < 1e-8) return Math.min(MAX_BALLISTIC_RANGE_M, weapon.muzzleSpeed ** 2 * Math.sin(2 * elevation) / GRAVITY);
  const rangeAt = (angle: number) => {
    const velocity: [number, number, number] = [weapon.muzzleSpeed * Math.cos(angle), weapon.muzzleSpeed * Math.sin(angle), 0];
    let low = 0, high = 180;
    for (let i = 0; i < 32; i++) {
      const time = (low + high) / 2;
      if (ballisticStep([0, 0, 0], velocity, time, drag).position[1] > 0) low = time; else high = time;
    }
    return ballisticStep([0, 0, 0], velocity, (low + high) / 2, drag).position[0];
  };
  // Drag shifts the maximum below 45 degrees; search the permitted low arc.
  let low = Math.max(0, weapon.elevationMinDeg) * Math.PI / 180, high = elevation;
  for (let i = 0; i < 24; i++) {
    const a = low + (high - low) / 3, b = high - (high - low) / 3;
    if (rangeAt(a) < rangeAt(b)) low = a; else high = b;
  }
  return Math.min(MAX_BALLISTIC_RANGE_M, rangeAt((low + high) / 2));
}
const knots = (metersPerSecond: number) => metersPerSecond * KNOTS_PER_MPS;
const format = (n: number, digits = 0) => n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const thickest = (def: ShipDefinition) => def.armor.reduce((best, a) => a.thicknessMm > best.thicknessMm ? a : best, def.armor[0]);
const mainMounts = (def: ShipDefinition) => def.mounts.filter(m => m.battery === 'main');
const dualPurposeMounts = (def: ShipDefinition) => def.mounts.filter(m => m.weapon.caliberM <= SCORE_REFERENCES.dualPurposeCaliberM);

/** Gameplay calibration only: each score reads the same simulation inputs the sheet prints. */
export function shipScores(def: ShipDefinition): StatScore[] {
  const r = SCORE_REFERENCES, main = mainMounts(def);
  const armorMm = def.armor.length ? thickest(def).thicknessMm : 0;
  const penetration = main.length ? Math.max(...main.map(m => m.weapon.penetrationMm)) : 0;
  const planRoot = Math.sqrt(def.hull.length * def.hull.beam);
  const score = (value: number) => Math.round(clamp(value, 0, 100));
  return [
    { id: 'survivability', label: 'Survivability', score: score(70 * maxHullIntegrity(def) / r.hullIntegrity + 30 * armorMm / r.armorMm), help: `Approximation from displacement and thickest plate against ${r.armorMm} mm. Flooding and stability determine whether the ship sinks.` },
    { id: 'artillery', label: 'Artillery', score: score(70 * damagePerMinute(main) / r.mainDamagePerMinute + 30 * penetration / r.penetrationMm), help: `Main battery damage per minute against ${format(r.mainDamagePerMinute)} and penetration against ${r.penetrationMm} mm.` },
    { id: 'airDefense', label: 'Air defense', score: score(100 * damagePerMinute(dualPurposeMounts(def)) / r.dualPurposeDamagePerMinute), help: `Damage per minute from guns of ${Math.round(r.dualPurposeCaliberM * 1000)} mm or less against ${format(r.dualPurposeDamagePerMinute)}. Ships without such guns score zero.` },
    { id: 'maneuverability', label: 'Maneuverability', score: score(40 * knots(def.handling.forwardSpeed) / r.speedKn + 60 * def.handling.maxYawRate / r.yawRateRadPerSecond), help: `Top speed against ${r.speedKn} kn and turning rate against ${(r.yawRateRadPerSecond * 180 / Math.PI).toFixed(1)}°/s.` },
    { id: 'concealment', label: 'Concealment', score: score(100 * (r.largestPlanRootM - planRoot) / (r.largestPlanRootM - r.smallestPlanRootM)), help: 'Smaller waterline plan (length × beam) scores higher. Detection is not yet simulated.' },
  ];
}

function batteryRows(mounts: ShipDefinition['mounts'], withName: boolean): StatRow[] {
  const weapon = mounts[0].weapon, count = mounts.length;
  const layout = `${count} × ${barrels(weapon)}`;
  return [
    ...(withName ? [{ label: weapon.name, value: layout, help: 'Mounts × barrels per mount.', text: true }] : [{ label: 'Layout', value: layout, help: 'Mounts × barrels per mount.' }]),
    { label: 'Reload', value: format(weapon.reloadSeconds, weapon.reloadSeconds < 10 ? 1 : 0), unit: 's', help: 'Seconds between salvos from one mount.' },
    { label: 'Salvo damage', value: format(salvoDamage(weapon) * count), help: 'Nominal AP damage budget for the full battery. Actual damage depends on the penetration path and fuze burst.' },
    { label: 'Damage per minute', value: format(damagePerMinute(mounts)), help: 'Full-battery salvo damage times salvos per minute.' },
    { label: 'Penetration', value: format(weapon.penetrationMm), unit: 'mm', help: 'AP budget at the reference speed. Velocity, impact angle and plate material determine penetration; sufficient resistance arms the fuze.' },
    { label: 'Muzzle velocity', value: format(weapon.muzzleSpeed), unit: 'm/s', help: 'Nominal launch speed before dispersion. Shells slow under drag and fall under gravity.' },
    { label: 'Shell mass', value: format(weapon.projectileMassKg, weapon.projectileMassKg < 10 ? 2 : 0), unit: 'kg', help: 'Projectile mass carried by each shot.' },
    { label: 'Maximum range', value: format(maximumRangeM(weapon) / 1000, 1), unit: 'km', help: 'Maximum flat-water range with drag over the permitted low arc, capped by the fire-control solver.' },
    { label: 'Elevation', value: `${weapon.elevationMinDeg}° to ${weapon.elevationMaxDeg}°`, help: 'Barrel elevation limits.' },
    { label: 'Traverse', value: `±${weapon.traverseDeg}° · ${weapon.traverseRateDeg}°/s`, help: 'Training arc either side of the mount bearing and training speed.' },
    { label: 'Ammunition', value: format(mounts.reduce((n, m) => n + m.weapon.ammoPerBarrel * barrels(m.weapon), 0)), unit: 'rounds', help: 'Rounds for the whole battery. Firing a salvo spends one per barrel.' },
    { label: 'Gunhouse armor', value: format(weapon.armorMm), unit: 'mm', help: 'Nominal gunhouse protection used when no authored gunhouse plates exist.' },
  ];
}

/** Everything the sheet prints is read from the compiled definition combat uses. */
export function shipStatistics(def: ShipDefinition): StatSection[] {
  const main = mainMounts(def), secondary = def.mounts.filter(m => m.battery === 'secondary');
  const hp = maxHullIntegrity(def), h = def.hull, handling = def.handling;
  const engines = def.modules.filter(m => m.kind === 'engine').length, magazines = def.modules.filter(m => m.kind === 'magazine').length, steering = def.modules.filter(m => m.kind === 'steering').length;
  const floodingM3 = def.compartments.reduce((n, c) => n + c.capacityM3, 0), pumpM3PerMinute = def.compartments.reduce((n, c) => n + c.pumpM3PerSecond, 0) * 60;
  const survivability: StatSection = {
    id: 'survivability', title: 'Survivability', headline: format(hp), headlineUnit: 'condition points', headlineHelp: 'Full equipment condition on this ship’s damage-score scale. Buoyancy and stability determine sinking; permanently losing every weapon or its ammunition can end the fight while afloat.',
    rows: [
      { label: 'Displacement', value: format(h.massKg / 1000), unit: 't', help: 'Standard-draft hull mass used for buoyancy and loading.' },
      { label: 'Reserve buoyancy', value: format(h.reserveBuoyancyM3), unit: 'm³', help: 'Nominal authored reserve. Ships with a stability profile use their actual hull geometry, loading and list to determine loss of flotation.' },
      { label: 'Compartments', value: format(def.compartments.length), help: 'Watertight spaces that can flood independently.' },
      { label: 'Flooding capacity', value: format(floodingM3), unit: 'm³', help: 'Total water the compartments can hold.' },
      { label: 'Pumping', value: format(pumpM3PerMinute, 1), unit: 'm³/min', help: 'Fixed pumps across all compartments. Damage-control teams can add portable pumping after setup.' },
      { label: 'Machinery modules', value: format(engines), help: 'Boiler, turbine and shaft modules. Damage and immersion affect their connected drive systems.' },
      { label: 'Magazines', value: format(magazines), help: 'Loss or immersion cuts ammunition supply to linked mounts. Sufficient ignition can cause a magazine explosion.' },
      { label: 'Steering modules', value: format(steering), help: 'Steering gear modules. Damage reduces rudder authority.' },
      ...(def.structuralPlating ? [{ label: 'Hull plating', value: `${def.structuralPlating.hullMm} / ${def.structuralPlating.superstructureMm}`, unit: 'mm', help: 'Ordinary steel shell and deckhouse plating. Gameplay estimates that register hits outside the armor.' }] : []),
    ],
  };
  const plate = def.armor.length ? thickest(def) : undefined;
  const maxNamed = (pattern: RegExp) => def.armor.filter(a => pattern.test(a.name)).reduce((n, a) => Math.max(n, a.thicknessMm), 0);
  const belt = maxNamed(/belt/i), deck = maxNamed(/deck/i);
  const mainIds = new Set(main.map(m => m.id));
  const gunhouse = def.armor.filter(a => a.plate?.mountId && mainIds.has(a.plate.mountId)).reduce((n, a) => Math.max(n, a.thicknessMm), 0) || (main[0]?.weapon.armorMm ?? 0);
  const materials = [...new Set(def.armor.map(a => a.plate?.material).filter((m): m is NonNullable<typeof m> => !!m))];
  const basis = ['documented', 'plan-measured', 'estimated', 'inferred'].map(kind => [kind, def.armor.filter(a => a.provenance?.basis === kind).length] as const).filter(([, n]) => n > 0);
  const armor: StatSection = {
    id: 'armor', title: 'Armor', headline: format(plate?.thicknessMm ?? 0), headlineUnit: 'mm', headlineHelp: plate ? `Thickest armor volume: ${plate.name}.` : 'No armor volumes are authored for this ship.',
    rows: [
      ...(plate ? [{ label: 'Thickest plate', value: plate.name, help: 'The armor volume with the greatest thickness.', text: true }] : []),
      { label: 'Armor volumes', value: format(def.armor.length), help: 'Plates and boxes that stop or slow shells before the interior.' },
      ...(belt ? [{ label: 'Belt', value: format(belt), unit: 'mm', help: 'Thickest volume named as belt armor.' }] : []),
      ...(deck ? [{ label: 'Deck', value: format(deck), unit: 'mm', help: 'Thickest volume named as deck armor.' }] : []),
      ...(main.length ? [{ label: 'Main gunhouse', value: format(gunhouse), unit: 'mm', help: 'Thickest authored main gunhouse plate, or the nominal gunhouse armor when none is authored.' }] : []),
      ...(materials.length ? [{ label: 'Materials', value: materials.join(' · '), help: 'Plate materials named in the armor scheme. Teak backing has no steel-equivalent resistance.', text: true }] : []),
      ...(basis.length ? [{ label: 'Evidence', value: basis.map(([kind, n]) => `${n} ${kind}`).join(' · '), help: 'How many volumes come from documents, plan measurements, estimates or inference.', text: true }] : []),
    ],
  };
  const mainBattery: StatSection | undefined = main.length ? {
    id: 'main-battery', title: 'Main battery', headline: format(Math.round(main[0].weapon.caliberM * 1000)), headlineUnit: 'mm', headlineHelp: `${main[0].weapon.name}. Caliber sets the shell and the gunhouse envelope.`,
    rows: [{ label: 'Gun', value: main[0].weapon.name, help: 'Weapon fitted to every main battery mount.', text: true }, ...batteryRows(main, false)],
  } : undefined;
  const secondaryGroups = [...new Map(secondary.map(m => [m.partId, secondary.filter(s => s.partId === m.partId)])).values()];
  const secondaryBattery: StatSection | undefined = secondary.length ? {
    id: 'secondary-battery', title: 'Secondary battery', headline: format(secondary.reduce((n, m) => n + barrels(m.weapon), 0)), headlineUnit: 'barrels', headlineHelp: 'Barrels across every secondary mount. Secondary batteries fire under their own control.',
    rows: secondaryGroups.flatMap(group => batteryRows(group, true).filter(row => secondaryGroups.length === 1 || ['Reload', 'Damage per minute', 'Maximum range', 'Penetration'].includes(row.label) || row.text)),
    collapsed: true,
  } : undefined;
  const tubes = def.torpedoTubes ?? [];
  const torpedoGroups = [...new Map(tubes.map(t => [t.partId, tubes.filter(other => other.partId === t.partId)])).values()];
  const torpedoBatteries: StatSection[] = torpedoGroups.map(group => {
    const weapon = group[0].weapon;
    return {
      id: `torpedoes-${weapon.id}`, title: 'Torpedoes', headline: format(group.length), headlineUnit: 'tubes',
      headlineHelp: `${weapon.name}. Fixed tubes launch on a straight course within their allowed bearing arcs.`, collapsed: true,
      rows: [
        { label: 'Weapon', value: weapon.name, help: 'Torpedo component fitted to these tubes.', text: true },
        { label: 'Diameter', value: format(weapon.diameterM * 1000), unit: 'mm', help: 'Diameter of the torpedo body.' },
        { label: 'Ammunition', value: format(group.reduce((n, t) => n + t.ammo, 0)), unit: 'rounds', help: 'Initial ammunition across these tubes, including reloads.' },
        { label: 'Speed', value: format(knots(weapon.speed)), unit: 'kn', help: 'Constant speed after launch; no homing or later steering.' },
        { label: 'Maximum range', value: format(weapon.rangeM / 1000, 1), unit: 'km', help: 'Maximum distance before the torpedo expires.' },
        { label: 'Running depth', value: format(weapon.runningDepthM, 1), unit: 'm', help: 'Depth below the CPU sea datum, reached gradually after launch.' },
        { label: 'Arming distance', value: format(weapon.armingDistanceM), unit: 'm', help: 'Earlier contact is a harmless dud. Provisional game tuning.' },
        { label: 'Reload', value: format(weapon.reloadSeconds), unit: 's', help: 'Physical reload time for each tube. Provisional game tuning.' },
        { label: 'Module damage', value: format(weapon.damage * .5), unit: 'max', help: 'Maximum damage to one nearby module from an armed hit. Distance reduces damage, and remaining module condition caps it. The local flooding breach is resolved separately.' },
        { label: 'Flood opening', value: format(weapon.breachAreaM2, 1), unit: 'm²', help: 'Local opening from an armed hit, capped at 4 m² per compartment across repeated strikes.' },
        { label: 'Tube bearings', value: [...new Set(group.map(t => `${t.bearingDeg}°`))].join(' / '), help: 'Fixed bearings relative to the bow; 180° points astern.' },
        { label: 'Launch arcs', value: [...new Set(group.map(t => `±${t.arcDeg}°`))].join(' / '), help: 'Allowed course offset either side of each fixed tube bearing.' },
      ],
    };
  });
  const turningDiameterM = 2 * handling.forwardSpeed / handling.maxYawRate;
  const mobility: StatSection = {
    id: 'mobility', title: 'Mobility', headline: format(knots(handling.forwardSpeed), 1), headlineUnit: 'kn', headlineHelp: 'Top speed at full ahead with undamaged machinery.',
    rows: [
      { label: 'Astern', value: format(knots(handling.reverseSpeed), 1), unit: 'kn', help: 'Top speed going astern.' },
      { label: 'Time to full speed', value: format(handling.forwardSpeed / handling.acceleration), unit: 's', help: 'From stopped to full ahead with all machinery.' },
      { label: 'Stopping time', value: format(handling.forwardSpeed / handling.braking), unit: 's', help: 'From full ahead to stopped with engines reversed.' },
      { label: 'Rudder shift', value: format(2 / handling.rudderRate, 1), unit: 's', help: 'Hard over to hard over.' },
      { label: 'Turning rate', value: format(handling.maxYawRate * 180 / Math.PI, 2), unit: '°/s', help: 'Steady rate of turn at full speed with full rudder.' },
      { label: 'Turning circle', value: format(turningDiameterM), unit: 'm', help: 'Diameter at full speed and full rudder. Machinery damage reduces speed and steering damage reduces rudder authority.' },
      { label: 'Machinery spaces', value: format(engines), help: 'Boiler, turbine and shaft modules that each supply a share of power.' },
    ],
  };
  const dimensions: StatSection = {
    id: 'dimensions', title: 'Dimensions', headline: format(h.length, 1), headlineUnit: 'm', headlineHelp: 'Length overall of the authored hull.',
    rows: [
      { label: 'Beam', value: format(h.beam, 1), unit: 'm', help: 'Maximum breadth.' },
      { label: 'Draft', value: format(h.draft, 2), unit: 'm', help: 'Keel depth below the waterline at the standard datum.' },
      { label: 'Depth', value: format(h.depth, 1), unit: 'm', help: 'Keel to upper deck.' },
      { label: 'Waterplane area', value: format(h.waterplaneAreaM2), unit: 'm²', help: 'Nominal waterline area. The stability model integrates the changing submerged hull as loading and list change.' },
      { label: 'Length to beam', value: format(h.length / h.beam, 2), help: 'Slender hulls make speed more cheaply and turn wider.' },
      { label: 'Mounts', value: format(def.mounts.length), help: 'Gun mounts of every battery.' },
    ],
    collapsed: true,
  };
  const modelBasis: StatSection = {
    id: 'model-basis', title: 'Model basis', headline: `${format(def.armor.length + def.modules.length + def.compartments.length)}`, headlineUnit: 'volumes', headlineHelp: 'Armor, module and compartment volumes simulated for this ship.',
    rows: [], collapsed: true,
    notes: [{ label: 'Exterior', text: def.accuracy.exterior }, { label: 'Internals', text: def.accuracy.internals }, { label: 'Weapons', text: def.accuracy.weapons }],
  };
  return [survivability, armor, ...(mainBattery ? [mainBattery] : []), ...(secondaryBattery ? [secondaryBattery] : []), ...torpedoBatteries, mobility, dimensions, modelBasis];
}
