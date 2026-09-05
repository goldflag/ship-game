import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
export function random(seed = 1941): () => number {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export interface HarborMaterials {
  concrete: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  brick: THREE.MeshStandardMaterial;
  slate: THREE.MeshStandardMaterial;
  plaster: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  rust: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
  lamp: THREE.MeshBasicMaterial;
  road: THREE.MeshStandardMaterial;
  facade: THREE.MeshStandardMaterial;
  apron: THREE.MeshStandardMaterial;
  cobbles: THREE.MeshStandardMaterial;
}

export async function loadHarborMaterials(): Promise<{ materials: HarborMaterials; textures: Record<string, THREE.Texture> }> {
  const loader = new THREE.TextureLoader();
  const textures: Record<string, THREE.Texture> = {};
  await Promise.all(['ground', 'meadow', 'rock', 'brick', 'concrete', 'slate', 'apron', 'cobbles', 'asphalt'].flatMap(name => ['color', 'normal', 'roughness'].map(async channel => {
    const key = `${name}-${channel}`;
    const map = await loader.loadAsync(`/harbor/${key}.jpg`);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.anisotropy = 8;
    if (channel === 'color') map.colorSpace = THREE.SRGBColorSpace;
    textures[key] = map;
  })));
  const facadeMap = await loader.loadAsync('/harbor/period-facades.jpg');
  facadeMap.colorSpace = THREE.SRGBColorSpace;
  facadeMap.anisotropy = 8;
  textures.facades = facadeMap;
  const scanned = (name: string, tint: string, size = 6) => {
    const map = textures[`${name}-color`].clone();
    const normalMap = textures[`${name}-normal`].clone();
    const roughnessMap = textures[`${name}-roughness`].clone();
    for (const t of [map, normalMap, roughnessMap]) { t.repeat.setScalar(1 / size); t.needsUpdate = true; }
    return new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap, color: tint, roughness: .97, normalScale: new THREE.Vector2(.75, .75), vertexColors: true });
  };
  const matte = (color: string, roughness = .87, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness, vertexColors: true });
  return { textures, materials: {
    concrete: scanned('concrete', '#c6c7ba', 7), stone: scanned('rock', '#babbb0', 6), brick: scanned('brick', '#e0d3bc', 4), slate: scanned('slate', '#929c9d', 3),
    plaster: scanned('concrete', '#dbd6bc', 7), steel: matte('#54646a', .61, .55), rust: matte('#78503b', .88, .28),
    dark: matte('#202a2b'), wood: matte('#7d6a49'), glass: matte('#43636b', .22, .42), paint: matte('#cfb879'), road: scanned('asphalt', '#b5bab8', 3),
    apron: scanned('apron', '#ffffff', 5), cobbles: scanned('cobbles', '#c8cbbd', 4),
    facade: new THREE.MeshStandardMaterial({ map: facadeMap, roughness: .92, bumpMap: facadeMap, bumpScale: .065, vertexColors: true }),
    lamp: new THREE.MeshBasicMaterial({ color: '#ffe4ac', vertexColors: true }),
  } };
}

/** Static geometry is merged by material and 320 m cell for useful frustum culling. */
export class HarborGeometry {
  private batches = new Map<string, { geometry: THREE.BufferGeometry[]; material: THREE.Material; shadow: boolean }>();
  private unitBox = new THREE.BoxGeometry();
  private unitBeam = new THREE.CylinderGeometry(1, 1, 1, 8);
  private transform = new THREE.Object3D();
  private up = v(0, 1, 0);
  constructor(private root: THREE.Group) {}

  add(geometry: THREE.BufferGeometry, material: THREE.Material, tint = '#ffffff', shadow = true, preserveUV = false): void {
    // Merged geometry uses nonindexed triangles, consistent attributes, and real meter UVs.
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    const uv = new Float32Array(p.count * 2), colors = new Float32Array(p.count * 3);
    const color = new THREE.Color(tint);
    let cx = 0, cz = 0;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i)), nz = Math.abs(n.getZ(i));
      uv[i * 2] = nx > ny && nx > nz ? z : x;
      uv[i * 2 + 1] = ny >= nx && ny >= nz ? z : y;
      const occlusion = .86 + .14 * Math.max(0, n.getY(i));
      colors.set([color.r * occlusion, color.g * occlusion, color.b * occlusion], i * 3);
      cx += x; cz += z;
    }
    if (!preserveUV) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    const key = `${material.uuid}:${Math.floor(cx / p.count / 320)}:${Math.floor(cz / p.count / 320)}:${shadow}`;
    if (!this.batches.has(key)) this.batches.set(key, { geometry: [], material, shadow });
    this.batches.get(key)!.geometry.push(g);
    geometry.dispose();
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, material: THREE.Material, rotation = 0, tint = '#ffffff'): void {
    this.transform.position.set(x, y, z); this.transform.rotation.set(0, rotation, 0); this.transform.scale.set(w, h, d); this.transform.updateMatrix();
    this.add(this.unitBox.clone().applyMatrix4(this.transform.matrix), material, tint);
  }

  beam(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): void {
    this.transform.position.copy(a).add(b).multiplyScalar(.5);
    this.transform.quaternion.setFromUnitVectors(this.up, b.clone().sub(a).normalize());
    this.transform.scale.set(radius, a.distanceTo(b), radius); this.transform.updateMatrix();
    this.add(this.unitBeam.clone().applyMatrix4(this.transform.matrix), material);
  }

  cylinder(radius: number, height: number, x: number, y: number, z: number, material: THREE.Material, topRadius = radius, segments = 24): void {
    this.add(new THREE.CylinderGeometry(topRadius, radius, height, segments).translate(x, y, z), material);
  }

  roof(w: number, rise: number, d: number, x: number, y: number, z: number, material: THREE.Material, rotation = 0, tint = '#ffffff', openEnds = false): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -w/2,0,-d/2, 0,rise,-d/2, w/2,0,-d/2,
      -w/2,0,d/2, 0,rise,d/2, w/2,0,d/2,
    ], 3));
    const indices = [0,3,4, 0,4,1, 1,4,5, 1,5,2, 0,2,5, 0,5,3];
    if (!openEnds) indices.push(0,1,2, 3,5,4);
    geometry.setIndex(indices);
    const flat = geometry.toNonIndexed(); geometry.dispose(); flat.computeVertexNormals();
    flat.rotateY(rotation).translate(x,y,z);
    this.add(flat, material, tint);
  }

  hipRoof(w:number,rise:number,d:number,x:number,y:number,z:number,material:THREE.Material,rotation=0,tint='#ffffff'):void {
    const cap=Math.min(w*.4,d*.3);
    const vertices=[-w/2,0,-d/2,w/2,0,-d/2,w/2,0,d/2,-w/2,0,d/2,0,rise,-d/2+cap,0,rise,d/2-cap];
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geometry.setIndex([0,3,5,0,5,4,1,4,5,1,5,2,0,4,1,3,2,5]);
    const flat = geometry.toNonIndexed(); geometry.dispose(); flat.computeVertexNormals();
    flat.rotateY(rotation).translate(x,y,z);this.add(flat,material,tint);
  }

  /** A single storey from the four-panel facade atlas, at real architectural scale. */
  facade(width:number,height:number,position:THREE.Vector3,rotation:number,panel:number,storey:number,material:THREE.Material,tint:string):void {
    const geometry = new THREE.PlaneGeometry(width,height);
    const uv = geometry.getAttribute('uv');
    const u = (panel % 2) * .5, v = panel < 2 ? .5 : 0;
    for(let i=0;i<uv.count;i++)uv.setXY(i,u+.001+uv.getX(i)*.498,v+(storey+uv.getY(i)*.994+.003)/6);
    geometry.rotateY(rotation).translate(position.x,position.y,position.z);
    this.add(geometry,material,tint,true,true);
  }

  finish(): void {
    for (const { geometry, material, shadow } of this.batches.values()) {
      const merged = mergeGeometries(geometry, false)!;
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = 'Harbor static detail'; mesh.castShadow = shadow; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      this.root.add(mesh); geometry.forEach(g => g.dispose());
    }
    this.batches.clear(); this.unitBox.dispose(); this.unitBeam.dispose();
  }
}

export function harborSign(root: THREE.Group, text: string, width: number, height: number, position: THREE.Vector3, rotationY: number, foreground = '#ded8bb', background = '#34464a'): void {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = Math.round(1024 * height / width);
  const c = canvas.getContext('2d')!;
  c.fillStyle = background; c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = foreground; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = `600 ${canvas.height * .58}px "Barlow Condensed", sans-serif`;
  c.fillText(text, canvas.width / 2, canvas.height * .52, canvas.width * .88);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map, roughness: .95 }));
  mesh.position.copy(position); mesh.rotation.y = rotationY; root.add(mesh);
}
