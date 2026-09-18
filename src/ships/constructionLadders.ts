import type { ConstructionEquipment, ConstructionEquipmentPart, ConstructionSurface, Vec3 } from './blueprint';
import { ladderRungs } from '../../assets/parts/construction/ladder_geometry';
import { pathOf, pathWorldPoint } from './constructionPaths';
import { projectWallPoint, wallNormal } from './constructionWallFittings';

export function fittedLadder(part: ConstructionEquipmentPart, item: ConstructionEquipment, surfaces?: readonly ConstructionSurface[]) {
  const p=part.path;
  if(p?.kind!=='ladder')return;
  const r=item.bearingDeg*Math.PI/180, c=Math.cos(r),s=Math.sin(r),normal=wallNormal(item.bearingDeg);
  const project=surfaces ? (local:Vec3):Vec3|undefined=>{
    const hit=projectWallPoint(pathWorldPoint(item,local),normal,surfaces,Math.max(.15,p.widthM!*.75));
    if(!hit)return;
    const q=hit.map((v,k)=>v-item.position[k]);return [q[0]*c+q[2]*s,q[1],-q[0]*s+q[2]*c];
  }:undefined;
  return ladderRungs(pathOf(item).points,{widthM:p.widthM!,standOffM:p.standOffM!,postSpacingM:p.postSpacingM!},project);
}
