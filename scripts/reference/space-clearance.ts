/** Independent loft-envelope measurement for authoring reports. */
export function hullSectionHalfWidth(sections: { station: number; points: [number, number][] }[], s: number, y: number): number {
  // Eight-decimal authored cell centers/sizes can put a terminal corner a few
  // nanometres past its station. Clamp only floating-point-scale endpoint drift.
  const first=sections[0].station,last=sections.at(-1)!.station;
  if(s<first-1e-7||s>last+1e-7)return -1;
  s=Math.max(first,Math.min(last,s));
  const index=sections.findIndex((v,i)=>i<sections.length-1&&v.station<=s&&sections[i+1].station>=s);
  if(index<0)return -1;
  const a=sections[index],b=sections[index+1],t=(s-a.station)/(b.station-a.station);
  const points=a.points.map((p,i)=>p.map((n,j)=>n+(b.points[i][j]-n)*t));
  if(y<points[0][1]-.02 || y>points.at(-1)![1]+.02)return -1;
  let width=0;
  for(let i=0;i<points.length-1;i++){
    const [x0,y0]=points[i],[x1,y1]=points[i+1];
    if(y>=y0-.02&&y<=y1+.02)width=Math.max(width,Math.abs(y1-y0)<1e-8?Math.max(x0,x1):x0+(x1-x0)*(y-y0)/(y1-y0));
  }
  return width;
}
