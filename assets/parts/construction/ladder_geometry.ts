/** Original surface ladder recipe: independent U-shaped rungs, no side rails. */
export type LadderPoint = [number, number, number];
export interface LadderProfile { widthM: number; standOffM: number; postSpacingM: number }
export function ladderRungs(points: readonly LadderPoint[], profile: LadderProfile, project: (p: LadderPoint) => LadderPoint | undefined = p => p): { members: [LadderPoint,LadderPoint][]; anchors: LadderPoint[] } | undefined {
  const members: [LadderPoint,LadderPoint][] = [], anchors: LadderPoint[] = [], centers: LadderPoint[] = [];
  for(let i=1;i<points.length;i++) {
    const a=points[i-1], b=points[i], dx=b[0]-a[0], dy=b[1]-a[1], length=Math.hypot(dx,dy);
    if(length<.05 || !Number.isFinite(length) || profile.postSpacingM<.15 || profile.widthM<=0 || profile.standOffM<=0)return;
    const count=Math.ceil(length/profile.postSpacingM);
    if(count>3334)return;
    const right=[dy/length,-dx/length,0];
    for(let j=0;j<=count;j++) {
      const c=a.map((v,k)=>v+(b[k]-v)*j/count) as LadderPoint;
      if(centers.some(p=>Math.hypot(...p.map((v,k)=>v-c[k]))<1e-6))continue;
      centers.push(c);
      const left=project(c.map((v,k)=>v-right[k]*profile.widthM/2) as LadderPoint), rightFoot=project(c.map((v,k)=>v+right[k]*profile.widthM/2) as LadderPoint);
      if(!left || !rightFoot)return;
      anchors.push(left,rightFoot);
      // Common outer depth makes the foothold straight even on a sloping hull.
      const z=Math.min(left[2],rightFoot[2])-profile.standOffM;
      const l:LadderPoint=[left[0],left[1],z],r:LadderPoint=[rightFoot[0],rightFoot[1],z];
      members.push([left,l],[l,r],[r,rightFoot]);
    }
  }
  return {members,anchors};
}
