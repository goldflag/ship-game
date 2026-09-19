import * as THREE from 'three';
import type { ConstructionSurface, Vec3 } from '../../../ships/blueprint';
import { surfaceSelectionKey } from '../../../ships/constructionEditor';
import { wallBearing } from '../../../ships/constructionWallFittings';
import { envelopeVertices } from '../../../ships/freeformShape';
import { worldVertex } from '../../../ships/constructionVertex';
import { balconyPlacement, seatBalconyOnHull } from '../balconyPlacement';
import type { BuilderPick, BuilderPlacement, BuilderScene } from '../builderScene';
import { gridCoordinate } from '../editorNumbers';
import { internalSelectionIds } from '../internalSelection';
import { baseFootprint, interiorFloor, type HullCrossing } from '../internalPlacement';
import { attachmentOffset, dominantAxis, physicalPlacementHit, placementCenter } from '../placement';
import { primitiveSnapFeatures, wallFrameSnapFeatures, DEFAULT_SNAPPING, SHIP_AXES, type SnapFeature } from '../snapping';
import { pointerRay } from './resources';

export interface PickEvent {
  clientX: number;
  clientY: number;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

/** What a raycast reads from the viewport at the moment of the pick. */
export interface PickView {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  scene: BuilderScene;
  hullMeshes: THREE.Object3D[];
  pickMeshes: THREE.Object3D[];
  /** Deck planes: floors an internal package can land on. */
  deckMeshes: THREE.Object3D[];
  surfaceTriangles: ConstructionSurface[];
  /** The balcony placement a drag began with; it keeps its side for the whole gesture. */
  heldBalcony?: BuilderPick['hullPlacement'];
  /** A selection is being moved, so the cursor piece does not snap. */
  moving: boolean;
  /** Smart alignment of the cursor piece; `workingAxis` is the support plane's axis. */
  snap(workingAxis: number, context: string, raw: Vec3, grid: Vec3, directions: Vec3[], moving: SnapFeature[]): Vec3;
}

/** Empty space is never a placement or selection surface. */
export function pickScene(view: PickView, event: PickEvent, targets: BuilderScene['pickTargets']): BuilderPick | undefined {
  const { scene } = view;
  const ray = pointerRay(event, view.canvas, view.camera);
  // Hull raycasts still support placement, but every object interaction in Internals
  // passes through the skin and external fittings to the internal packages/walls.
  const allowed =
    targets !== 'hull' && scene.pickTargets === 'internals'
      ? internalSelectionIds(scene.source, scene.catalog)
      : undefined;
  // Internal packages only fit inside the hull, so their ray passes the skin to the floor within.
  const cursor = scene.placementPiece,
    internal = targets === 'hull' && cursor?.kind === 'equipment' && cursor.inset !== undefined && !cursor.wall;
  const floor = internal ? interiorHit(view, ray) : undefined,
    direction = floor?.direction ?? ray.ray.direction;
  const hit = internal
    ? floor?.hit
    : ray
        .intersectObjects(targets === 'hull' ? view.hullMeshes : view.pickMeshes, false)
        .find((hit) => !allowed || allowed.has(hit.object.userData.sourceId));
  if (!hit) return undefined;
  const surface = hit.object.userData.hull ? view.surfaceTriangles[hit.faceIndex ?? -1] : undefined;
  const facing = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : direction.clone().negate();
  if (facing.dot(direction) > 0) facing.negate();
  const { point: raw, normal } = physicalPlacementHit({ point: hit.point.toArray() as Vec3, normal: facing.toArray() as Vec3 }, surface);
  const axis = dominantAxis(normal);
  const supportId = surface?.primitiveId.startsWith('equipment:') ? surface.primitiveId.slice('equipment:'.length) : undefined;
  const id =
    supportId && scene.source.construction.equipment.some((item) => item.id === supportId)
      ? supportId
      : (surface?.primitiveId ?? hit.object.userData.sourceId);
  const primitive = scene.source.construction.primitives.find((part) => part.id === id);
  let piece = scene.placementPiece;
  if (targets === 'hull' && piece?.kind === 'equipment' && piece.wall) {
    if (!surface || surface.open || Math.abs(normal[1]) >= 0.9 || !primitive) return undefined;
    piece = { ...piece, bearingDeg: wallBearing(normal) };
  }
  if (piece?.kind === 'hull' && piece.shape === 'balcony')
    piece = view.heldBalcony ?? balconyPlacement(piece, normal);
  const worldCorners = primitive && envelopeVertices(primitive).map((v) => worldVertex(primitive, v));
  const snapOrigin = worldCorners && ([0, 1, 2].map((k) => Math.min(...worldCorners.map((v) => v[k]))) as Vec3 | undefined);
  const settings = scene.snapping ?? DEFAULT_SNAPPING;
  const step = settings.enabled && settings.grid ? scene.gridStep : null;
  let placement = piece
    ? placementCenter(piece, { point: raw, normal, snapOrigin }, step)
    : (raw.map((value) => gridCoordinate(value, step)) as Vec3);
  if (piece && !view.moving) {
    const unsnapped = placementCenter(piece, { point: raw, normal, snapOrigin }, null);
    const moving =
      piece.kind === 'hull'
        ? primitiveSnapFeatures({
            id: 'cursor',
            kind: piece.shape,
            position: [0, 0, 0],
            rotationDeg: piece.rotationDeg,
            tilt: piece.tilt,
            size: piece.size,
            balcony: piece.balcony,
          })
        : piece.kind === 'equipment' && piece.wall
          ? wallFrameSnapFeatures('cursor', [0, 0, 0], piece.bearingDeg, piece).filter((f) => f.kind !== 'edge')
          : [
              {
                id: 'cursor:center',
                owner: 'cursor',
                point: piece.kind === 'equipment' ? attachmentOffset(piece, piece.bearingDeg) : ([0, 0, 0] as Vec3),
                kind: 'center' as const,
              },
            ];
    const free = SHIP_AXES.filter((_, k) => (piece.kind === 'boundary' ? k === 'xyz'.indexOf(piece.axis) : k !== axis));
    placement = view.snap(axis, `placement:${piece.kind}:${id}`, unsnapped, placement, free, moving);
    // Smart alignment must preserve the exact support plane, including slopes.
    if (piece.kind !== 'boundary')
      placement[axis] -= placement.reduce((sum, v, k) => sum + (v - unsnapped[k]) * normal[k], 0) / normal[axis];
  }
  if (piece?.kind === 'hull' && piece.shape === 'balcony' && surface && Math.abs(normal[1]) < 0.9)
    placement = seatBalconyOnHull(piece, placement, surface, scene.result?.surfaces ?? []);
  if (internal && piece?.kind === 'equipment') placement = clearFloor(view, piece, placement);
  return {
    id,
    hullPlacement: piece?.kind === 'hull' && piece.shape === 'balcony' ? piece : undefined,
    surface: surface && surfaceSelectionKey(surface),
    point: raw,
    normal,
    axis,
    placement,
    bearingDeg: piece?.kind === 'equipment' ? piece.bearingDeg : undefined,
    additive: !!(event.shiftKey || event.ctrlKey || event.metaKey),
  };
}

function crossings(view: PickView, ray: THREE.Raycaster): HullCrossing<THREE.Intersection>[] {
  return ray.intersectObjects([...view.hullMeshes, ...view.deckMeshes], false).map((hit) => {
    const deck = hit.object.userData.deckTopY !== undefined;
    const normal = deck
      ? undefined
      : hit.object.userData.hull
        ? view.surfaceTriangles[hit.faceIndex ?? -1]?.normal
        : hit.face?.normal.clone().transformDirection(hit.object.matrixWorld).toArray();
    if (deck) hit.point.y = hit.object.userData.deckTopY;
    return {
      point: hit.point.toArray() as Vec3,
      outward: normal ? (new THREE.Vector3(...normal).normalize().toArray() as Vec3) : [0, 1, 0],
      deck,
      source: hit,
    };
  });
}

/** The floor inside the hull under the pointer. A ray that only passes through the
 * sides lands on the floor beneath the middle of its path through the hull. */
function interiorHit(view: PickView, ray: THREE.Raycaster): { hit: THREE.Intersection; direction: THREE.Vector3 } | undefined {
  const seen = interiorFloor(crossings(view, ray), ray.ray.direction.toArray() as Vec3);
  if (seen.floor) return { hit: seen.floor.source!, direction: ray.ray.direction };
  if (!seen.span) return undefined;
  const drop = new THREE.Raycaster(
    new THREE.Vector3(...seen.span[0]).add(new THREE.Vector3(...seen.span[1])).multiplyScalar(0.5),
    new THREE.Vector3(0, -1, 0),
  );
  const beneath = interiorFloor(crossings(view, drop), [0, -1, 0], true).floor;
  return beneath && { hit: beneath.source!, direction: drop.ray.direction };
}

/** Raise a package until every corner of its base clears the floor; a hull bottom rises toward the bilges. */
function clearFloor(view: PickView, piece: Extract<BuilderPlacement, { kind: 'equipment' }>, placement: Vec3): Vec3 {
  let lift = 0;
  for (const corner of baseFootprint(piece, placement)) {
    const drop = new THREE.Raycaster(new THREE.Vector3(corner[0], corner[1] + piece.size[1], corner[2]), new THREE.Vector3(0, -1, 0));
    // Decks above the base are ceilings here, not floors.
    const beneath = interiorFloor(
      crossings(view, drop).filter((crossing) => !crossing.deck || crossing.point[1] <= corner[1] + 1e-3),
      [0, -1, 0],
      true,
    ).floor;
    if (beneath) lift = Math.max(lift, beneath.point[1] + (piece.inset ?? 0) - corner[1]);
  }
  return lift > 1e-6 ? [placement[0], placement[1] + lift, placement[2]] : placement;
}
