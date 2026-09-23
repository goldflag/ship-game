/** Ship-relative camera poses for harness captures, shared by the page (`review.placeCamera`) and `ui:shot --camera`.
 * A pose is a preset name, an eye and target in the hull's own frame, or an orbit about her centre. The frame is the
 * hull's waterline position and heading (metres: +X starboard, +Y up, −Z toward the bow); the camera does not heave,
 * roll or pitch with her. */
import type { CameraPin } from '../../src/game/Game';
import type { Vec3 } from '../../src/ships/blueprint';

/** Azimuth in degrees clockwise from the bow (0 looks back at her from ahead, 90 from starboard), elevation in degrees
 * above the horizon, distance in hull lengths. `top` looks down from just astern, so her bow points up the frame. */
export const CAMERA_PRESETS = {
  bow: [0, 8, 1.1], bowQuarter: [35, 12, 1.25], broadside: [90, 6, 1.35], sternQuarter: [145, 12, 1.25], astern: [180, 10, 1.2], top: [180, 89, 1.5],
} as const satisfies Record<string, readonly [number, number, number]>;
export type CameraPreset = keyof typeof CAMERA_PRESETS;

interface PoseCommon { target?: Vec3; fov?: number; /** A ship's motion id; default the hull the camera rides. */ ship?: string }
export type CameraPose = CameraPreset | PoseCommon & ({ preset: CameraPreset } | { eye: Vec3 }
  | { azimuth: number; elevation: number; /** Metres; default 1.3 hull lengths. */ distance?: number });

/** The pin `Game.placeCamera` holds for `pose` about a hull `hullLength` metres long, aimed at her centre a little above the waterline. */
export function cameraPin(pose: CameraPose, hullLength: number): CameraPin {
  if (typeof pose === 'string') pose = { preset: pose };
  if ('preset' in pose) {
    const preset = CAMERA_PRESETS[pose.preset];
    if (!preset) throw new Error(`Unknown camera preset "${pose.preset}". Presets: ${Object.keys(CAMERA_PRESETS).join(', ')}.`);
    pose = { ...pose, azimuth: preset[0], elevation: preset[1], distance: preset[2] * hullLength };
  }
  const target: Vec3 = pose.target ? [...pose.target] : [0, hullLength * .03, 0];
  const common = { target, ...(pose.fov ? { fov: pose.fov } : {}), ...(pose.ship ? { shipId: pose.ship } : {}) };
  if ('eye' in pose) return { eye: [...pose.eye], ...common };
  const azimuth = pose.azimuth * Math.PI / 180, elevation = pose.elevation * Math.PI / 180, distance = pose.distance ?? hullLength * 1.3;
  const across = distance * Math.cos(elevation);
  return { eye: [target[0] + across * Math.sin(azimuth), target[1] + distance * Math.sin(elevation), target[2] - across * Math.cos(azimuth)], ...common };
}

/** `--camera` text: a preset name or `azimuth,elevation[,distance in metres]`. */
export function parseCameraPose(text: string): CameraPose {
  if (text in CAMERA_PRESETS) return text as CameraPreset;
  const numbers = text.split(',').map(Number);
  if (numbers.length < 2 || numbers.length > 3 || numbers.some(value => !Number.isFinite(value)))
    throw new Error(`--camera takes a preset (${Object.keys(CAMERA_PRESETS).join(', ')}) or azimuth,elevation[,distance]; got "${text}".`);
  return { azimuth: numbers[0], elevation: numbers[1], ...(numbers.length === 3 ? { distance: numbers[2] } : {}) };
}

/** `x,y,z` in metres. */
export function parseVec3(text: string, flag: string): Vec3 {
  const numbers = text.split(',').map(Number);
  if (numbers.length !== 3 || numbers.some(value => !Number.isFinite(value))) throw new Error(`${flag} takes x,y,z in metres; got "${text}".`);
  return numbers as Vec3;
}
