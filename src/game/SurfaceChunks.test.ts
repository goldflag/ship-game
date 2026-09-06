import { expect, test } from 'bun:test';
import * as THREE from 'three/webgpu';
import { raycastSurface, surfaceChunks } from './SurfaceChunks';

test('chunked surface queries preserve dense indexed and non-indexed mesh hits after transforms', () => {
  for (const indexed of [true, false]) {
    const original = new THREE.BoxGeometry(100, 40, 20, 80, 32, 16);
    const geometry = indexed ? original : original.toNonIndexed();
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({side:THREE.DoubleSide}));
    mesh.position.set(70,-10,90);mesh.rotation.set(.3,1.2,-.1);mesh.scale.set(1.1,.8,1.3);mesh.updateMatrixWorld(true);
    expect(surfaceChunks(geometry)).toBe(surfaceChunks(geometry));
    expect(surfaceChunks(geometry).length).toBeGreaterThan(10);
    for(const x of [-48,-20,0,30,48,70]){
      const from=mesh.localToWorld(new THREE.Vector3(x,.37,50)),to=mesh.localToWorld(new THREE.Vector3(x,.37,-50));
      const ray=new THREE.Raycaster(from,to.clone().sub(from).normalize(),0,from.distanceTo(to));
      const a=ray.intersectObject(mesh,false),b=raycastSurface(mesh,ray).sort((a,b)=>a.distance-b.distance);
      expect(b.map(h=>({face:h.faceIndex,point:h.point.toArray(),normal:h.face?.normal.toArray(),object:h.object===mesh})))
        .toEqual(a.map(h=>({face:h.faceIndex,point:h.point.toArray(),normal:h.face?.normal.toArray(),object:h.object===mesh})));
    }
    geometry.dispose();original.dispose();mesh.material.dispose();
  }
});
