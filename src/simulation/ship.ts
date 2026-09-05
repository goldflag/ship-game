/** Shared, renderer-free gameplay state. Distances: meters. Time: seconds.
 * Heading is clockwise from north (-Z); X points east. */
export const FIXED_DT = 1 / 60;
export const KNOTS_PER_MPS = 1.94384449;
export const ENGINE_ORDERS = [-1, 0, 0.25, 0.5, 0.75, 1] as const;
export const ENGINE_LABELS = ['ASTERN', 'STOP', 'SLOW', 'HALF', 'THREE-QUARTER', 'FULL'];

export interface HelmCommand {
  throttle: number;
  rudder: number;
}

export interface ShipState {
  id: string;
  tick: number;
  x: number;
  z: number;
  heading: number;
  speed: number;
  rudder: number;
  yawRate: number;
  distance: number;
}

export const BISMARCK = {
  length: 250.5,
  beam: 36,
  forwardSpeed: 15.43,
  reverseSpeed: 4.12,
  acceleration: 0.32,
  braking: 0.24,
  rudderRate: 0.42,
  maxYawRate: 0.019,
} as const;

export function createShipState(id = 'player'): ShipState {
  return { id, tick: 0, x: 0, z: 0, heading: 0, speed: 0, rudder: 0, yawRate: 0, distance: 0 };
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const finite = (n: number) => Number.isFinite(n) ? n : 0;
const approach = (n: number, target: number, amount: number) => n + clamp(target - n, -amount, amount);

/** One fixed tick. Local input, a bot, or an authoritative server supplies the same command. */
export function stepShip(state: ShipState, command: HelmCommand): void {
  const throttle = clamp(finite(command.throttle), -1, 1);
  const rudder = clamp(finite(command.rudder), -1, 1);
  const targetSpeed = throttle * (throttle < 0 ? BISMARCK.reverseSpeed : BISMARCK.forwardSpeed);
  state.rudder = approach(state.rudder, rudder, BISMARCK.rudderRate * FIXED_DT);
  const braking = targetSpeed === 0 || Math.sign(targetSpeed) !== Math.sign(state.speed);
  state.speed = approach(state.speed, targetSpeed, (braking ? BISMARCK.braking : BISMARCK.acceleration) * FIXED_DT);
  // A stationary rudder has no authority; going astern reverses its effect.
  const authority = clamp(state.speed / BISMARCK.forwardSpeed, -0.4, 1);
  const targetYaw = state.rudder * BISMARCK.maxYawRate * authority;
  state.yawRate += (targetYaw - state.yawRate) * (1 - Math.exp(-FIXED_DT / 2.4));
  state.heading = (state.heading + state.yawRate * FIXED_DT + Math.PI * 2) % (Math.PI * 2);
  state.x += Math.sin(state.heading) * state.speed * FIXED_DT;
  state.z -= Math.cos(state.heading) * state.speed * FIXED_DT;
  state.distance += Math.abs(state.speed) * FIXED_DT;
  state.tick++;
}

/** Limits tab-resume catch-up while preserving a constant simulation step. */
export class SingleplayerSimulation {
  readonly ship = createShipState();
  private accumulator = 0;

  advance(dt: number, command: HelmCommand): void {
    this.accumulator += clamp(finite(dt), 0, 0.1);
    while (this.accumulator + 1e-10 >= FIXED_DT) {
      stepShip(this.ship, command);
      this.accumulator = Math.max(0, this.accumulator - FIXED_DT);
    }
  }

  reset(): void {
    Object.assign(this.ship, createShipState());
    this.accumulator = 0;
  }
}
