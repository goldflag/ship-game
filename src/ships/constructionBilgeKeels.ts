import type { ConstructionBilgeKeels, Vec3 } from './blueprint';

export const defaultBilgeKeels = (beam: number): ConstructionBilgeKeels => ({
  version: 1, enabled: true, start: .25, end: .75,
  widthM: Math.round(Math.max(.1, Math.min(2, beam * .035)) * 100) / 100,
  thicknessM: .02, placement: .35,
});
export function bilgeKeelError(k: ConstructionBilgeKeels): string | undefined {
  if (k.version !== 1 || typeof k.enabled !== 'boolean') return 'Unsupported bilge keel settings.';
  if (![k.start, k.end, k.widthM, k.thicknessM, k.placement].every(Number.isFinite)) return 'Enter finite bilge keel dimensions.';
  if (k.start < .02 - 1e-10 || k.end > .98 + 1e-10 || k.end - k.start < .02 - 1e-10) return 'Keep bilge keels between 2% and 98% of hull length, spanning at least 2%.';
  if (k.widthM < .05 || k.widthM > 3 || k.thicknessM < .005 || k.thicknessM > .1 || k.thicknessM > k.widthM) return 'Use bilge keel width 0.05–3 m and thickness 5–100 mm, no thicker than the width.';
  if (k.placement < .05 || k.placement > .8) return 'Place bilge keels 5–80% around the outline from keel to deck.';
}

/** Display counterpart of the native recipe. Roots follow the actual triangulated
 * hull panels, including their diagonals; a small embedded edge seats the plates. */
export function bilgeKeelFaces(rings: Vec3[][], stations: number[], contours: number[], k?: ConstructionBilgeKeels, cut = 1): Vec3[][] {
  if (!k?.enabled || bilgeKeelError(k) || cut <= k.start) return [];
  const q = 4 + k.placement * 4;
  let edge = (contours.length - 1) / 2;
  while (edge < contours.length - 2 && contours[edge + 1] < q) edge++;
  const u = (q - contours[edge]) / (contours[edge + 1] - contours[edge]);
  const end = Math.min(k.end, cut), taper = (k.end - k.start) * .12;
  const times = [k.start, end, k.start + taper, k.end - taper, ...stations];
  for (let i = 0; i < stations.length - 1; i++) times.push(stations[i] + u * (stations[i + 1] - stations[i]));
  const ts = [...new Set(times.filter(t => t >= k.start && t <= end))].sort((a,b) => a-b);
  const mix = (a: Vec3, b: Vec3, t: number) => a.map((v,i) => v + (b[i]-v)*t) as Vec3;
  const sections = ts.map(t => {
    let j = 0;
    while (j < stations.length - 2 && stations[j + 1] < t) j++;
    const f = (t - stations[j]) / (stations[j + 1] - stations[j]);
    const a = rings[j][edge], b = rings[j][edge+1], c = rings[j+1][edge], d = rings[j+1][edge+1];
    const root = a.map((v,i) => u >= f ? v*(1-u)+b[i]*(u-f)+d[i]*f : v*(1-f)+d[i]*u+c[i]*(f-u)) as Vec3;
    const low = mix(a,c,f), high = mix(b,d,f), dx = high[0]-low[0], dy = high[1]-low[1], length = Math.hypot(dx,dy) || 1;
    const nx = dy/length, ny = -dx/length;
    const width = k.widthM * Math.max(.08, Math.min(1, (t-k.start)/taper, (k.end-t)/taper));
    return [[-k.thicknessM,-.5], [width,-.5], [width,.5], [-k.thicknessM,.5]].map(([w,s]) =>
      [root[0]+nx*w-ny*k.thicknessM*s, root[1]+ny*w+nx*k.thicknessM*s, root[2]] as Vec3);
  });
  const faces: Vec3[][] = [];
  const triangle = (a: Vec3,b: Vec3,c: Vec3) => {
    faces.push([a,b,c], [c,b,a].map(p => [-p[0],p[1],p[2]]));
  };
  for (let j=0;j<sections.length-1;j++) for (let i=0;i<4;i++) {
    const a=sections[j][i],b=sections[j][(i+1)%4],c=sections[j+1][i],d=sections[j+1][(i+1)%4];
    triangle(a,b,c); triangle(b,d,c);
  }
  const first=sections[0],last=sections.at(-1)!;
  triangle(first[2],first[1],first[0]); triangle(first[3],first[2],first[0]);
  triangle(last[0],last[1],last[2]); triangle(last[0],last[2],last[3]);
  return faces;
}
