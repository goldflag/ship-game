import * as THREE from 'three';
import { paintedHullFace } from '../ships/constructionHullPaint';
import type { ConstructionEquipment, ConstructionEquipmentPart, ConstructionPrimitive, ConstructionSurface, Vec3 } from '../ships/blueprint';
import { wallNormal, wallProjectionDepth, wallScale, wallSurface } from '../ships/constructionWallFittings';

/** Clip a polygon against a half-plane in the original fitting's projected plane. */
function clip(polygon: THREE.Vector3[], distance: (p: THREE.Vector3) => number): THREE.Vector3[] {
  const result: THREE.Vector3[] = [];
  for (let i=0; i<polygon.length; i++) {
    const a=polygon[i], b=polygon[(i+1)%polygon.length], da=distance(a), db=distance(b);
    if (da >= -1e-9) result.push(a);
    if ((da >= 0) !== (db >= 0)) result.push(a.clone().lerp(b,da/(da-db)));
  }
  return result;
}

/** Project the original component's front triangles onto native hull panels.
 * This preserves its authored silhouette/materials while giving it no solid rim
 * or thickness. A 0.5 mm render bias prevents coplanar flicker, including in GLB.
 * Returned geometry is local to the installation; dimensions are already applied.
 */
export function createConstructionWallModel(template: THREE.Group, part: ConstructionEquipmentPart, item: ConstructionEquipment, surfaces: readonly ConstructionSurface[], primitives: readonly ConstructionPrimitive[] = []): THREE.Group {
  const group = new THREE.Group(), n=wallNormal(item.bearingDeg), scale=wallScale(part,item);
  const pose=new THREE.Matrix4().makeRotationY(-item.bearingDeg*Math.PI/180).setPosition(...item.position), inverse=pose.clone().invert();
  const depth=wallProjectionDepth(part.size[0]*scale[0],part.size[1]*scale[1]);
  // Match the hull renderer's triangle fan before clipping. Clipping an entire
  // warped quad would introduce a different diagonal and bury part of the mark.
  const primitiveById=new Map(primitives.map(p=>[p.id,p]));
  const panels=surfaces.filter(s=>wallSurface(s,n)).flatMap(s=>paintedHullFace(s,primitiveById.get(s.primitiveId)).map(face=>({...s,vertices:face.vertices}))).flatMap(s=>{
    const normal=new THREE.Vector3(...s.normal).transformDirection(inverse);
    const vertices=s.vertices.map(p=>new THREE.Vector3(...p).applyMatrix4(inverse));
    return vertices.slice(1,-1).map((_,i)=>({normal,vertices:[vertices[0],vertices[i+1],vertices[i+2]]}));
  }).filter(s=>s.vertices.some(p=>Math.abs(p.z)<=depth) || Math.min(...s.vertices.map(p=>p.z))<0&&Math.max(...s.vertices.map(p=>p.z))>0);
  template.updateMatrixWorld(true);
  template.traverse(node=>{
    if (!(node instanceof THREE.Mesh)) return;
    const source=node.geometry, position=source.getAttribute('position'), index=source.index;
    if (!position) return;
    const points:number[]=[], normals:number[]=[];
    for(let i=0;i<(index?.count??position.count);i+=3){
      const triangle=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(position,index?index.getX(i+k):i+k).applyMatrix4(node.matrixWorld).multiply(new THREE.Vector3(...scale)));
      // Only outward-facing triangles define the flat silhouette of retained models.
      if (triangle[1].clone().sub(triangle[0]).cross(triangle[2].clone().sub(triangle[0])).z >= -1e-10) continue;
      for(const panel of panels){
        let polygon=clip(clip(panel.vertices,p=>depth-p.z),p=>depth+p.z);
        for(let k=0;k<3&&polygon.length;k++){
          const a=triangle[k],b=triangle[(k+1)%3];
          polygon=clip(polygon,p=>-((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x)));
        }
        for(let k=1;k+1<polygon.length;k++)for(const p of [polygon[0],polygon[k],polygon[k+1]]){
          points.push(p.x+panel.normal.x*.0005,p.y+panel.normal.y*.0005,p.z+panel.normal.z*.0005);normals.push(...panel.normal.toArray());
        }
      }
    }
    if (!points.length) return;
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
    const clone=(m:THREE.Material)=>{const material=m.clone();material.side=THREE.DoubleSide;material.polygonOffset=true;material.polygonOffsetFactor=-2;material.polygonOffsetUnits=-2;return material;};
    const mesh=new THREE.Mesh(geometry,Array.isArray(node.material)?node.material.map(clone):clone(node.material));
    mesh.name=node.name;mesh.userData={...node.userData,sharedPreviewResources:false,wallSurfaceDetail:true};group.add(mesh);
  });
  return group;
}
