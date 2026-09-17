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
  for(let i=0;i<positions.count;i++) {
    const point=new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(mesh.matrixWorld).toArray() as Vec3;
    const projected=projectWallPoint(point,wallNormal(90),surfaces,.01)!;
    expect(projected).toBeDefined();expect(Math.hypot(...point.map((v,k)=>v-projected[k]))).toBeLessThan(.0006);
    expect(Math.abs(point[2])).toBeLessThanOrEqual(.750001);
  }
});
