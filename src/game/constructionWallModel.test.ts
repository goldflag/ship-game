import { expect, test } from 'bun:test';
import * as THREE from 'three';
import { createConstructionWallModel } from './constructionWallModel';
import { wallNormal, projectWallPoint } from '../ships/constructionWallFittings';
import type { ConstructionEquipmentPart, ConstructionSurface, Vec3 } from '../ships/blueprint';

test('the original flat silhouette follows a sloping hull with no solid extrusion', () => {
  const template=new THREE.Group();template.add(new THREE.Mesh(new THREE.PlaneGeometry(1,1).rotateY(Math.PI),new THREE.MeshStandardMaterial()));
  const normal=new THREE.Vector3(1,-.2,0).normalize().toArray() as Vec3;
  const surfaces=[{normal,open:false,vertices:[[3.6,-2,-3],[4.4,2,-3],[4.4,2,3],[3.6,-2,3]]}] as ConstructionSurface[];
  const part={id:'window',wallMount:'window',size:[1,1,.001]} as ConstructionEquipmentPart;
  const item={id:'window',partId:part.id,position:[4,0,0] as Vec3,bearingDeg:90,wall:{version:1 as const,widthM:1.5,heightM:1}};
  const model=createConstructionWallModel(template,part,item,surfaces);model.position.fromArray(item.position);model.rotation.y=-Math.PI/2;model.updateMatrixWorld(true);
  expect(model.children.length).toBe(1);
  const mesh=model.children[0] as THREE.Mesh,positions=mesh.geometry.getAttribute('position');
  expect(positions.count).toBeGreaterThanOrEqual(6);
  expect(mesh.userData.wallSurfaceOffsetFactor).toBe(-2);
  for(let i=0;i<positions.count;i++) {
    const point=new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld).toArray() as Vec3;
    const projected=projectWallPoint(point,wallNormal(90),surfaces,.01)!;
    expect(projected).toBeDefined();expect(Math.hypot(...point.map((v,k)=>v-projected[k]))).toBeLessThan(.0006);
    expect(Math.abs(point[2])).toBeLessThanOrEqual(.750001);
  }
});

test('relief on an exported parent keeps its depth above the flush panel', () => {
  const template=new THREE.Group(),relief=new THREE.Group();relief.userData.wallRelief=true;template.add(relief);
  relief.add(new THREE.Mesh(new THREE.BoxGeometry(.2,.4,.03).translate(0,0,-.03),new THREE.MeshStandardMaterial()));
  const surfaces=[{normal:[1,0,0],open:false,vertices:[[4,-2,-3],[4,2,-3],[4,2,3],[4,-2,3]]}] as ConstructionSurface[];
  const part={id:'door',wallMount:'door',size:[1,2,.1]} as ConstructionEquipmentPart;
  const item={id:'door',partId:part.id,position:[4,0,0] as Vec3,bearingDeg:90,wall:{version:1 as const,widthM:1,heightM:2}};
  const model=createConstructionWallModel(template,part,item,surfaces),mesh=model.children[0] as THREE.Mesh;
  mesh.geometry.computeBoundingBox();expect(mesh.geometry.boundingBox!.max.z).toBeLessThan(-.014);expect(mesh.geometry.boundingBox!.min.z).toBeLessThan(-.044);
  expect(mesh.userData.wallSurfaceDetail).toBe(true);expect(mesh.userData.wallSurfaceOffsetFactor).toBe(0);
});

test('moving a detailed door only projects hardware against nearby hull panels', () => {
  const template = new THREE.Group(); template.userData.wallRelief = true;
  template.add(new THREE.Mesh(new THREE.BoxGeometry(.8, 1.8, .04).translate(0, 1, -.02), new THREE.MeshStandardMaterial()));
  let distantReads = 0;
  const nearby = { normal: [1, 0, 0], open: false, vertices: [[4,-2,-3],[4,4,-3],[4,4,3],[4,-2,3]] } as ConstructionSurface;
  const distant = Array.from({ length: 100 }, (_, i) => ({ ...nearby, get vertices() {
    distantReads++;
    const z = 10 + i * 3;
    return [[4,-2,z],[4,4,z],[4,4,z+2],[4,-2,z+2]] as Vec3[];
  } }));
  const surfaces = [nearby, ...distant];
  const part = { id: 'door', wallMount: 'door', size: [1,2,.1], boundsCenter: [0,1,-.05] } as ConstructionEquipmentPart;
  const item = { id:'door', partId:part.id, position:[4,0,0] as Vec3, bearingDeg:90, wall:{version:1 as const,widthM:1,heightM:2} };
  createConstructionWallModel(template, part, item, surfaces);
  distantReads = 0;
  const moved = { ...item, position: [4,0,.1] as Vec3 };
  const model = createConstructionWallModel(template, part, moved, surfaces);
  expect(distantReads).toBe(0);
  const expected = createConstructionWallModel(template, part, moved, [nearby]);
  expect(Array.from((model.children[0] as THREE.Mesh).geometry.attributes.position.array))
    .toEqual(Array.from((expected.children[0] as THREE.Mesh).geometry.attributes.position.array));
});

test('projection bounds retain large crossing panels, relief and resized rotated fittings', () => {
  const template = new THREE.Group(); template.userData.wallRelief = true;
  template.add(new THREE.Mesh(new THREE.BoxGeometry(.8,1.8,.04).translate(0,1,-.02), new THREE.MeshStandardMaterial()));
  const part = { id:'door', wallMount:'door', size:[1,2,.1], boundsCenter:[0,1,-.05] } as ConstructionEquipmentPart;
  const item = { id:'door', partId:part.id, position:[2,3,5] as Vec3, bearingDeg:37, wall:{version:1 as const,widthM:2,heightM:3} };
  const pose = new THREE.Matrix4().makeRotationY(-37*Math.PI/180).setPosition(...item.position);
  // None of these panel corners is inside the fitting bounds. The panel crosses
  // them and tilts through the full projection volume, so it must still be kept.
  const vertices = [[-20,-20,2],[20,-20,2],[20,20,-2],[-20,20,-2]].reverse().map(p => new THREE.Vector3(...p as Vec3).applyMatrix4(pose).toArray() as Vec3);
  const normal = new THREE.Vector3(0,-.1,-1).normalize().transformDirection(pose).toArray() as Vec3;
  const surfaces = [{ normal, open:false, vertices }] as ConstructionSurface[];
  const model = createConstructionWallModel(template,part,item,surfaces);
  model.position.fromArray(item.position); model.rotation.y=-37*Math.PI/180; model.updateMatrixWorld(true);
  const mesh = model.children[0] as THREE.Mesh, positions = mesh.geometry.attributes.position;
  for (let i=0;i<positions.count;i++) {
    const world = new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld).toArray() as Vec3;
    const hit = projectWallPoint(world,wallNormal(37),surfaces,3)!;
    expect(hit).toBeDefined();
    const depth = Math.hypot(...world.map((v,k)=>v-hit[k]));
    expect(depth).toBeGreaterThanOrEqual(.00049); expect(depth).toBeLessThan(.0406);
  }
});

test('procedural vents use their installed size when finding supporting panels', () => {
  const part = { id:'generic-louvered-vent', wallMount:'vent', size:[.5,.5,.055], boundsCenter:[0,0,-.0275] } as ConstructionEquipmentPart;
  const item = { id:'vent', partId:part.id, position:[0,0,0] as Vec3, bearingDeg:0, wall:{version:1 as const,widthM:4,heightM:2} };
  const surfaces = Array.from({length:12}, (_,i) => {
    const x = -3+i*.5;
    return {normal:[0,0,-1],open:false,vertices:[[x,-3,-.2],[x,3,-.2],[x+.5,3,-.2],[x+.5,-3,-.2]]} as ConstructionSurface;
  });
  const model = createConstructionWallModel(new THREE.Group(),part,item,surfaces);
  const backing = model.getObjectByName('vent-backing') as THREE.Mesh;
  backing.geometry.computeBoundingBox();
  expect(backing.geometry.boundingBox!.min.x).toBeCloseTo(-2,6);
  expect(backing.geometry.boundingBox!.max.x).toBeCloseTo(2,6);
});
