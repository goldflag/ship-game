import displayLibrary from '../generated/naval-wasm/construction-shapes.json';
import type { ConstructionPrimitive, Vec3 } from './blueprint';

type Kind = ConstructionPrimitive['kind'];
/** Emitted by the native recipes during multiplayer:prepare. Display data only. */
export const CONSTRUCTION_SHAPES = displayLibrary.shapes as Record<Kind, Vec3[][]>;
export const CONSTRUCTION_SHAPE_NAMES: Record<Kind, string> = {
  box: 'Box', wedge: 'Wedge', corner: 'Corner out', 'inverse-corner': 'Corner in', vertex: 'Freeform hull',
  ballast: '100 t ballast',
  pyramid: 'Pyramid · ⅓ hull', cylinder: 'Cylinder', 'half-cylinder': 'Half cylinder',
  'quarter-cylinder': 'Quarter cylinder', 'quarter-cylinder-wall': 'Quarter cylinder wall',
  sphere: 'Sphere', hemisphere: 'Hemisphere', 'sphere-octant': 'Eighth sphere',
  'hemisphere-shell': 'Hemisphere shell', 'half-hemisphere-shell': 'Half hemisphere shell',
  'quarter-hemisphere-shell': 'Quarter hemisphere shell', 'parabolic-shell': 'Parabolic shell',
  cone: 'Cone', 'hollow-cube': 'Round hollow cube', 'concave-corner': 'Concave corner',
  bridge: 'Bridge', 'diagonal-bridge': 'Diagonal bridge', 'rounded-bridge': 'Rounded bridge',
  'bridge-panel': 'Bridge panel', 'diagonal-bridge-panel': 'Diagonal bridge panel',
  'rounded-bridge-panel': 'Rounded bridge panel', breakwater: 'Breakwater',
};

/** Reflecting asymmetric quarter profiles also swaps their width and length. */
export function shapeMirror(kind: Kind): { yaw: number; swap: boolean } {
  if (kind === 'corner' || kind === 'inverse-corner') return { yaw: -90, swap: true };
  if (['quarter-cylinder', 'quarter-cylinder-wall', 'sphere-octant', 'quarter-hemisphere-shell',
    'concave-corner', 'rounded-bridge', 'rounded-bridge-panel', 'diagonal-bridge', 'diagonal-bridge-panel'].includes(kind)) return { yaw: 90, swap: true };
  if (kind === 'half-cylinder' || kind === 'half-hemisphere-shell') return { yaw: 180, swap: false };
  return { yaw: 0, swap: false };
}
