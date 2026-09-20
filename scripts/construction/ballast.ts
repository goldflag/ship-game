/** Bottom-first tank filling and the two-variable solve behind `ship:ballast`.
 *
 * The compiler is the only judge of flotation, so the solver never models the hull: it asks for a
 * compile, reads `loading`, and moves two numbers — how much ballast and where it sits fore and aft. */

export interface BallastTank {
  id: string;
  name: string;
  /** Box centre in ship metres: +X starboard, +Y up, −Z bow. */
  center: [number, number, number];
  size: [number, number, number];
  /** Most this tank holds. Defaults to its volume times the working density. */
  capacityKg: number;
}
export interface TankFill {
  id: string;
  massKg: number;
  capacityKg: number;
  /** 0–1, rounded for reporting. */
  fill: number;
}
export interface Distribution {
  fills: TankFill[];
  totalKg: number;
  /** Mass-weighted centre of the fills; `undefined` when nothing is filled. */
  centerZ?: number;
  centerY?: number;
  /** Mass the tanks could not take. */
  shortfallKg: number;
  /** How far the achieved longitudinal centre sits from the one asked for. */
  centerZErrorM: number;
}

export const tankCapacityKg = (tank: Omit<BallastTank, 'capacityKg'>, densityKgM3: number) =>
  Math.abs(tank.size[0] * tank.size[1] * tank.size[2]) * densityKgM3;

/** Fill in ascending centre height, so the lowest tanks take the mass and VCG stays as low as the plan allows. */
function fillGroup(tanks: BallastTank[], massKg: number, centerZ: number): { fills: TankFill[]; takenKg: number } {
  // Height first, because that is the rule; then the tank nearest the wanted centre, so a partly
  // filled tier does not quietly drag the ballast to whichever end sorts first by name.
  const order = [...tanks].sort(
    (a, b) => a.center[1] - b.center[1] || Math.abs(a.center[2] - centerZ) - Math.abs(b.center[2] - centerZ) || a.id.localeCompare(b.id),
  );
  let left = Math.max(0, massKg);
  const fills = order.map((tank) => {
    const taken = Math.min(tank.capacityKg, left);
    left -= taken;
    return { id: tank.id, massKg: taken, capacityKg: tank.capacityKg, fill: tank.capacityKg > 0 ? taken / tank.capacityKg : 0 };
  });
  return { fills, takenKg: Math.max(0, massKg) - left };
}

const weighted = (tanks: BallastTank[], fills: TankFill[], axis: 0 | 1 | 2) => {
  const byId = new Map(tanks.map((tank) => [tank.id, tank]));
  let mass = 0,
    moment = 0;
  for (const fill of fills) {
    mass += fill.massKg;
    moment += fill.massKg * (byId.get(fill.id)?.center[axis] ?? 0);
  }
  return mass > 0 ? moment / mass : undefined;
};

/** Split `totalKg` between the tanks forward and aft of `centerZ`, then fill each side bottom-first.
 * The split is re-solved against the centres the fills actually produce, which converges in a few
 * rounds because a side's centroid moves far less than the mass on it. A side that runs out of
 * capacity clamps, and the achieved centre is reported rather than silently accepted. */
export function distribute(tanks: BallastTank[], totalKg: number, centerZ: number, rounds = 24): Distribution {
  const forward = tanks.filter((tank) => tank.center[2] < centerZ),
    aft = tanks.filter((tank) => tank.center[2] >= centerZ);
  const capacity = (group: BallastTank[]) => group.reduce((sum, tank) => sum + tank.capacityKg, 0);
  const wanted = Math.max(0, Math.min(totalKg, capacity(tanks)));
  let forwardKg = wanted * (capacity(forward) / Math.max(1e-9, capacity(tanks)));
  let best = { fills: [] as TankFill[], takenKg: 0 };
  for (let round = 0; round < rounds; round++) {
    const f = fillGroup(forward, forwardKg, centerZ),
      a = fillGroup(aft, wanted - forwardKg, centerZ);
    best = { fills: [...f.fills, ...a.fills], takenKg: f.takenKg + a.takenKg };
    const zf = weighted(forward, f.fills, 2),
      za = weighted(aft, a.fills, 2);
    if (zf === undefined || za === undefined || Math.abs(za - zf) < 1e-6) break;
    // wF·zf + wA·za = W·centerZ with wF + wA = W.
    const next = Math.max(0, Math.min(wanted, (wanted * (za - centerZ)) / (za - zf)));
    if (Math.abs(next - forwardKg) < 1) {
      forwardKg = next;
      break;
    }
    forwardKg = next;
  }
  const fills = tanks.map(
    (tank) => best.fills.find((fill) => fill.id === tank.id) ?? { id: tank.id, massKg: 0, capacityKg: tank.capacityKg, fill: 0 },
  );
  const achieved = weighted(tanks, fills, 2);
  return {
    fills,
    totalKg: best.takenKg,
    ...(achieved === undefined ? {} : { centerZ: achieved }),
    ...(weighted(tanks, fills, 1) === undefined ? {} : { centerY: weighted(tanks, fills, 1)! }),
    shortfallKg: Math.max(0, totalKg - best.takenKg),
    centerZErrorM: achieved === undefined ? 0 : achieved - centerZ,
  };
}

export interface Flotation {
  waterlineY: number;
  /** Longitudinal centre of gravity minus longitudinal centre of buoyancy, in metres. */
  lcgOffsetM: number;
  massKg: number;
}
export interface BallastTarget {
  waterlineY: number;
  /** 0 keeps LCG over LCB (even keel). Negative trims by the bow (−Z). */
  lcgOffsetM: number;
  waterlineToleranceM: number;
  lcgToleranceM: number;
  iterations: number;
}
export interface BallastStep {
  iteration: number;
  totalKg: number;
  centerZ: number;
  waterlineY: number;
  lcgOffsetM: number;
  shortfallKg: number;
}
export interface BallastSolution {
  distribution: Distribution;
  flotation: Flotation;
  steps: BallastStep[];
  converged: boolean;
  /** Why the solve stopped short, when it did. */
  note?: string;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Two decoupled secants: total mass drives the waterline, the fore-and-aft centre drives the trim.
 * The coupling between them is weak enough that a full Jacobian would only cost extra compiles. */
export async function solveBallast(
  tanks: BallastTank[],
  target: BallastTarget,
  evaluate: (distribution: Distribution) => Promise<Flotation>,
  start?: { totalKg?: number; centerZ?: number },
): Promise<BallastSolution> {
  const capacity = tanks.reduce((sum, tank) => sum + tank.capacityKg, 0);
  const zs = tanks.map((tank) => tank.center[2]);
  const zLow = Math.min(...zs),
    zHigh = Math.max(...zs);
  let totalKg = clamp(start?.totalKg ?? capacity / 2, 0, capacity);
  let centerZ = clamp(start?.centerZ ?? (zLow + zHigh) / 2, zLow, zHigh);
  const steps: BallastStep[] = [];
  /** Set when a step asks for the fills it already has: the limit is the tank plan, not the budget. */
  let stalled = false;
  let previous: { totalKg: number; centerZ: number; waterlineY: number; lcgOffsetM: number } | undefined;
  let distribution = distribute(tanks, totalKg, centerZ),
    flotation = await evaluate(distribution);
  for (let iteration = 0; ; iteration++) {
    if (!stalled)
      steps.push({
        iteration,
        totalKg: distribution.totalKg,
        centerZ: distribution.centerZ ?? centerZ,
        waterlineY: flotation.waterlineY,
        lcgOffsetM: flotation.lcgOffsetM,
        shortfallKg: distribution.shortfallKg,
      });
    const waterlineError = flotation.waterlineY - target.waterlineY,
      lcgError = flotation.lcgOffsetM - target.lcgOffsetM;
    const done = Math.abs(waterlineError) <= target.waterlineToleranceM && Math.abs(lcgError) <= target.lcgToleranceM;
    if (done || stalled || iteration >= target.iterations) {
      const clampedMass = !done && (distribution.totalKg >= capacity - 1 || distribution.totalKg <= 1);
      return {
        distribution,
        flotation,
        steps,
        converged: done,
        ...(done
          ? {}
          : {
              note: clampedMass
                ? 'The tanks ran out of capacity before the waterline was reached; add or enlarge tanks.'
                : Math.abs(distribution.centerZErrorM) > 0.05
                  ? 'The tanks cannot put their centre where the trim needs it; the longitudinal spread is the limit.'
                  : stalled
                    ? 'The solve stopped where the tank plan pins it; nothing it can change moves the flotation further.'
                    : 'The solve used its iteration budget; raise --iterations or widen the tolerances.',
            }),
      };
    }
    // Secants from the previous iterate, with a first-step guess when there is none: a metre of
    // waterline is worth roughly the ship's own mass per metre of depth, and a metre of LCG shift
    // roughly the ballast fraction of it.
    const dMass =
      previous && Math.abs(previous.totalKg - distribution.totalKg) > 1
        ? (previous.waterlineY - flotation.waterlineY) / (previous.totalKg - distribution.totalKg)
        : undefined;
    const dCenter =
      previous && Math.abs(previous.centerZ - centerZ) > 0.05
        ? (previous.lcgOffsetM - flotation.lcgOffsetM) / (previous.centerZ - centerZ)
        : undefined;
    previous = {
      totalKg: distribution.totalKg,
      centerZ: distribution.centerZ ?? centerZ,
      waterlineY: flotation.waterlineY,
      lcgOffsetM: flotation.lcgOffsetM,
    };
    // Both responses are physically increasing — more ballast floats lower, ballast further aft pulls
    // the centre of gravity aft — so a secant that comes out flat or negative is noise and is dropped.
    const massSlope = dMass && dMass > 1e-12 ? dMass : 1 / Math.max(1, capacity);
    const centerSlope = dCenter && dCenter > 1e-6 ? dCenter : Math.max(1e-3, distribution.totalKg / Math.max(1, flotation.massKg));
    const massStep = -waterlineError / massSlope;
    const centerStep = -lcgError / centerSlope;
    totalKg = clamp(distribution.totalKg + clamp(massStep, -capacity / 2, capacity / 2), 0, capacity);
    centerZ = clamp(centerZ + clamp(centerStep, -(zHigh - zLow) / 2, (zHigh - zLow) / 2), zLow, zHigh);
    const next = distribute(tanks, totalKg, centerZ);
    // Asking for fills the solver already has costs a compile and learns nothing, so it stops instead.
    stalled = Math.abs(next.totalKg - distribution.totalKg) < 1 && Math.abs((next.centerZ ?? 0) - (distribution.centerZ ?? 0)) < 0.01;
    distribution = next;
    if (!stalled) flotation = await evaluate(distribution);
  }
}
