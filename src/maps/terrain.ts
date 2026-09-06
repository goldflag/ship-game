/** Original, deterministic terrain synthesis. No rendering or random global state. */
export interface TerrainRecipe { rx: number; rz: number; height: number; seed: number; style: string; }
export const TERRAIN_SIZE = 257;
const EXTENT = 1.22;
const fields = new Map<string, Float32Array>();
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export function terrainNoise(x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const hash = (a: number, b: number) => { let n = Math.imul(a, 374761393) + Math.imul(b, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}
/** Bounded below 1.2 so the fleet corridor and broad-phase collision bounds remain valid. */
export const islandRim = (angle: number, seed: number) => .86 + .14 * Math.sin(angle * 3 + seed) + .075 * Math.sin(angle * 7 - seed) + .045 * Math.sin(angle * 13 + seed * .7) + .018 * Math.sin(angle * 29 - seed * .3);

function ridgeNoise(x: number, z: number): number {
  let result = 0, amplitude = .57, weight = 1;
  for (let i = 0; i < 5; i++) {
    let signal = 1 - Math.abs(terrainNoise(x, z) * 2 - 1);
    signal *= signal; signal *= weight;
    weight = clamp(signal * 1.8);
    result += signal * amplitude;
    const nextX = x * 1.73 + z * 1.07 + 17;
    z = z * 1.73 - x * 1.07 + 31; x = nextX; amplitude *= .48;
  }
  return result;
}

/** Hydraulic transport cuts connected drainage channels; sediment settles on lower slopes. */
function erode(field: Float32Array, seed: number): void {
  const n = TERRAIN_SIZE;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const sample = (x: number, z: number) => {
    const ix = Math.floor(x), iz = Math.floor(z), u = x - ix, v = z - iz, a = iz * n + ix;
    return (field[a] * (1-u) + field[a+1] * u) * (1-v) + (field[a+n] * (1-u) + field[a+n+1] * u) * v;
  };
  for (let drop = 0; drop < 36000; drop++) {
    let x = 2 + random() * (n-5), z = 2 + random() * (n-5), dx = 0, dz = 0, speed = 1, water = 1, sediment = 0;
    for (let life = 0; life < 65; life++) {
      const ix = Math.floor(x), iz = Math.floor(z), u = x-ix, v = z-iz, a = iz*n+ix;
      const h = sample(x,z);
      if (h < .0005) break;
      const gx = (field[a+1]-field[a])*(1-v)+(field[a+n+1]-field[a+n])*v;
      const gz = (field[a+n]-field[a])*(1-u)+(field[a+n+1]-field[a+1])*u;
      dx = dx*.12-gx*.88; dz = dz*.12-gz*.88;
      const length = Math.hypot(dx,dz); if (length < 1e-9) break;
      dx /= length; dz /= length; x += dx; z += dz;
      if (x < 2 || x > n-3 || z < 2 || z > n-3) break;
      const delta = sample(x,z)-h, capacity = Math.max(-delta,.00005)*speed*water*5;
      if (sediment > capacity || delta > 0) {
        const deposit = delta > 0 ? Math.min(delta,sediment) : (sediment-capacity)*.25;
        sediment -= deposit;
        field[a] += deposit*(1-u)*(1-v); field[a+1] += deposit*u*(1-v);
        field[a+n] += deposit*(1-u)*v; field[a+n+1] += deposit*u*v;
      } else {
        const amount = Math.min((capacity-sediment)*.32,-delta);
        // A soft brush prevents isolated needle pits and keeps valley cross-sections continuous.
        for (let oz=-1; oz<=1; oz++) for (let ox=-1; ox<=1; ox++) {
          const index=(iz+oz)*n+ix+ox, weight=(ox===0?2:1)*(oz===0?2:1)/16;
          const removed=Math.min(field[index],amount*weight); field[index]-=removed; sediment+=removed;
        }
      }
      speed = Math.sqrt(Math.max(.01,speed*speed-delta*30)); water *= .975;
    }
  }
}

function buildTerrain(recipe: TerrainRecipe): Float32Array {
  const n=TERRAIN_SIZE, result=new Float32Array(n*n), seed=recipe.seed;
  for(let j=0;j<n;j++) for(let i=0;i<n;i++) {
    const x=(i/(n-1)*2-1)*EXTENT, z=(j/(n-1)*2-1)*EXTENT;
    const r=Math.hypot(x,z)/islandRim(Math.atan2(z,x),seed);
    if(r>=1) continue;
    const wx=x+(terrainNoise(x*2+seed,z*2)-.5)*.22;
    const wz=z+(terrainNoise(x*2,z*2+seed)-.5)*.18;
    const ridges=ridgeNoise(wx*4+seed,wz*5+seed*.37);
    let massif=0;
    if(recipe.style==='volcanic') {
      const vx=wx+.12, vz=wz-.08, radius=Math.hypot(vx*1.1,vz);
      const cone=Math.pow(Math.max(0,1-radius/1.05),1.45);
      const crater=.37*Math.exp(-Math.pow(radius/.12,4));
      const flank=(.84+.23*ridges)*cone;
      massif=Math.max(.015,flank-crater);
    } else {
      // Overlapping, offset massifs form a spine, saddles and asymmetrical headwalls.
      for(let peak=0;peak<5;peak++) {
        const pz=-.62+peak*.29, px=Math.sin(peak*1.9+seed)*.19;
        const dx=(wx-px)/(.34+.07*Math.sin(seed+peak)), dz=(wz-pz)/.29;
        const summit=(.68+.3*terrainNoise(peak+seed,4))*Math.exp(-(dx*dx+dz*dz)*1.55);
        massif=Math.max(massif,summit);
      }
      massif = massif * (.53+.66*ridges) + ridges * .12;
      if(recipe.style==='snow') massif=Math.pow(massif,.83);
    }
    // Narrow coastal terraces, alternating headlands and sheltered lower coves.
    const coast=smooth(0,.14,1-r), foothill=smooth(0,.45,1-r);
    const terrace=.018*coast;
    result[j*n+i]=Math.max(0,terrace + massif*coast*(.38+.62*foothill));
  }
  erode(result,seed*7919);
  return result;
}

export function terrainField(recipe: TerrainRecipe): Float32Array {
  const key=`${recipe.seed}:${recipe.style}`;
  let field=fields.get(key);
  if(!field) { field=buildTerrain(recipe); fields.set(key,field); }
  return field;
}

export function sampleTerrain(recipe: TerrainRecipe, x: number, z: number): number {
  const r=Math.hypot(x,z)/islandRim(Math.atan2(z,x),recipe.seed);
  if(r>=1) return Math.max(-45,(1-r)*500);
  const field=terrainField(recipe), n=TERRAIN_SIZE;
  const gx=clamp((x/EXTENT+1)*.5*(n-1),0,n-1.001), gz=clamp((z/EXTENT+1)*.5*(n-1),0,n-1.001);
  const ix=Math.floor(gx), iz=Math.floor(gz), u=gx-ix, v=gz-iz, a=iz*n+ix;
  const h=(field[a]*(1-u)+field[a+1]*u)*(1-v)+(field[a+n]*(1-u)+field[a+n+1]*u)*v;
  // Retain an exact shared zero contour despite grid interpolation and erosion deposits.
  const inland=(1-r)*Math.min(recipe.rx,recipe.rz);
  const exposure=terrainNoise(x*3+recipe.seed,z*3);
  const shoreSlope=recipe.style==='tropical'?.1+.5*smooth(.4,.75,exposure):.07+.62*smooth(.3,.8,exposure);
  // Wave-cut headlands alternate with low rubble slopes. Cap deposited sediment
  // by distance to sea, avoiding a uniform extruded wall around the footprint.
  const raw=h*recipe.height, beach=raw*(1-Math.exp(-inland*shoreSlope/Math.max(raw,1)));
  const coastBlend=1-smooth(60,500,inland);
  return (raw+(beach-raw)*coastBlend)*smooth(0,4,inland);
}
