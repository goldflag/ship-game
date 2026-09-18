import { fittedLadder, ladderWallProjection } from '../ships/constructionLadders';
import { componentMaterial } from '../ships/componentMaterials';
import * as THREE from 'three';
import type { ConstructionEquipment, ConstructionEquipmentPart, ConstructionSurface, Vec3 } from '../ships/blueprint';
import { DEFAULT_PATH, railingSettings } from '../ships/constructionPaths';
import { constructionTubeGeometry } from './constructionTubeGeometry';
import { pathDistance, railingPosts, samplePath } from '../../assets/parts/construction/path_geometry';

/** Original procedural fittings, with no simulation inference from the mesh. */
export function createConstructionPathModel(part: ConstructionEquipmentPart, path: ConstructionEquipment['path'] = DEFAULT_PATH, ghost = false, mount?: { item: ConstructionEquipment; surfaces: readonly ConstructionSurface[] }): THREE.Group {
  const group = new THREE.Group(), profile = part.path;
  if(profile?.kind === 'ladder' && path === DEFAULT_PATH) path={points:[[0,0,0],[0,3,0]]};
  if (!profile || !path || path.points.length < 2 || path.points.length > 64 || path.points.some(p => p.some(v => !Number.isFinite(v) || Math.abs(v) > 1000))) return group;
  group.name = part.name;
  const surface = componentMaterial(profile.kind === 'rope' ? 'rope' : profile.kind === 'chain' ? 'edge' : 'naval');
  const color = ghost ? new THREE.Color('#e0c58d') : new THREE.Color().setRGB(...surface.color as [number, number, number]);
  const material = new THREE.MeshStandardMaterial({ color, roughness: surface.roughness, metalness: surface.metallic, transparent: ghost, opacity: ghost ? .6 : 1, depthWrite: !ghost });
  material.userData = surface.userData;
  const members: [Vec3, Vec3][] = [];
  const tubes: Vec3[][] = [];
  const points = path.points;
  const lengths = points.slice(1).map((p, i) => pathDistance(points[i], p));
  const routeLength = lengths.reduce((sum, length) => sum + length, 0);
  const settings = railingSettings(part, path);
  const bounded = lengths.every(length => length >= .05) && Number.isFinite(path.slackM ?? 0) && routeLength <= 500 && profile.diameterM > 0 && (profile.postSpacingM ?? 1.5) >= .05
    && (profile.kind !== 'railing' || Number.isFinite(settings.heightM) && settings.heightM >= .3 && settings.heightM <= 3 && [2, 3].includes(settings.railCount));
  if (!bounded) {
    // An invalid point edit remains inspectable without allocating thousands of
    // posts or links before the native diagnostic arrives.
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p))), new THREE.LineBasicMaterial({ color: '#ffb5a6' })));
    material.dispose(); return group;
  }
  const posts = profile.kind === 'railing' ? railingPosts(points, profile.postSpacingM ?? 1.5) : [];
  if (profile.kind === 'railing') {
    const { heightM: height, railCount } = railingSettings(part, path);
    for (const foot of posts) members.push([foot, [foot[0], foot[1] + height, foot[2]]]);
    for (let level = 1; level <= railCount; level++) {
      const rail = points.map(p => [p[0], p[1] + height * level / railCount - profile.diameterM / 2, p[2]] as Vec3);
      for (let i = 1; i < rail.length; i++) members.push([rail[i - 1], rail[i]]);
    }
  } else if (profile.kind === 'ladder') {
    const ladder=fittedLadder(part,mount?.item ?? {id:'preview',partId:part.id,position:[0,0,0],bearingDeg:0,path},mount?.surfaces);
    if(ladder) for (let i = 0; i < ladder.members.length; i += 3) tubes.push([ladder.members[i][0], ladder.members[i][1], ladder.members[i + 1][1], ladder.members[i + 2][1]]);
    else { material.dispose(); return group; }
  } else {
    const sampled = samplePath(points, path.slackM ?? 0);
    for (let i = 1; i < sampled.length; i++) members.push([sampled[i - 1], sampled[i]]);
  }
  const up = new THREE.Vector3(0, 1, 0), matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
  if (profile.kind === 'chain') {
    const lengths = members.map(([a, b]) => pathDistance(a, b)), total = lengths.reduce((a, b) => a + b, 0);
    const count = Math.min(6000, Math.max(2, Math.ceil(total / (profile.diameterM * 3.1))));
    const mesh = new THREE.InstancedMesh(new THREE.TorusGeometry(profile.diameterM * 1.5, profile.diameterM / 2, 6, 12), material, count);
    let segment = 0, previous = 0;
    for (let i = 0; i < count; i++) {
      const distance = total * i / (count - 1);
      while (segment < members.length - 1 && previous + lengths[segment] < distance) previous += lengths[segment++];
      const [a, b] = members[segment], start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), t = Math.min(1, (distance - previous) / Math.max(1e-9, lengths[segment]));
      rotation.setFromUnitVectors(up, end.clone().sub(start).normalize()).multiply(new THREE.Quaternion().setFromAxisAngle(up, i % 2 * Math.PI / 2));
      matrix.compose(start.lerp(end, t), rotation, new THREE.Vector3(1, 1.5, 1)); mesh.setMatrixAt(i, matrix);
    }
    mesh.computeBoundingBox(); mesh.computeBoundingSphere(); group.add(mesh);
  } else if (members.length) {
    // Balcony railings use plain square bars, with no feet or other hardware.
    const square = profile.kind === 'railing';
    const mesh = new THREE.InstancedMesh(square ? new THREE.BoxGeometry(profile.diameterM, profile.diameterM, 1) : new THREE.CylinderGeometry(profile.diameterM / 2, profile.diameterM / 2, 1, 10), material, members.length);
    members.forEach(([a, b], i) => {
      const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), direction = end.clone().sub(start);
      rotation.setFromUnitVectors(square ? new THREE.Vector3(0, 0, 1) : up, direction.clone().normalize());
      matrix.compose(start.add(end).multiplyScalar(.5), rotation, square ? new THREE.Vector3(1, 1, direction.length()) : new THREE.Vector3(1, direction.length(), 1)); mesh.setMatrixAt(i, matrix);
    });
    mesh.computeBoundingBox(); mesh.computeBoundingSphere(); group.add(mesh);
  }
  if (tubes.length) {
    const projectEnds = profile.kind === 'ladder' && mount ? ladderWallProjection(part, mount.item, mount.surfaces) : undefined;
    group.add(new THREE.Mesh(constructionTubeGeometry(tubes, profile.diameterM / 2, projectEnds), material));
  }
  group.traverse(node => { if (node instanceof THREE.Mesh) node.castShadow = node.receiveShadow = true; });
  return group;
}
