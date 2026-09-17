import { expect, test } from 'bun:test';
import { localToWorld, worldToLocal, segmentBox } from './geometry';
test('rotated endpoint and grazing contacts survive world/local roundoff', () => {
 const box={center:[0,0,0] as [number,number,number],size:[2,2,2] as [number,number,number]};
 const pose={x:321.4,y:5.2,z:-5090.5,heading:Math.PI+.017,roll:.11,pitch:-.035};
 for(const epsilon of [-1e-12,0,1e-12]){
  const from=worldToLocal(localToWorld([-3,0,0],pose),pose);
  const to=worldToLocal(localToWorld([-1+epsilon,0,0],pose),pose);
  const hit=segmentBox(from,to,box);expect(hit).not.toBeNull();expect(hit!.t).toBeCloseTo(1,8);expect(hit!.normal).toEqual([-1,0,0]);
 }
 expect(segmentBox([-3,0,0],[-1.0001,0,0],box)).toBeNull();
});
