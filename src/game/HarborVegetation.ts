import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { attribute, cameraPosition, color, mix, positionGeometry, texture, vec3, vec4 } from 'three/tsl';
import { coastDistance, noise, terrainHeight, westCoast } from './HarborTerrain';
import { random } from './HarborGeometry';

type Placement = { x: number; y: number; z: number; scale: number; angle: number; width?:number; height?:number; depth?:number };
export function instances(root: THREE.Group, source: THREE.Object3D, positions: Placement[], name: string): void {
  source.updateMatrixWorld(true);
  const cells = new Map<string, Placement[]>();
  const isForest=name==='Fir forest clusters'||name==='Broadleaf woodland';
  const cellSize=isForest?950:350;
  for (const p of positions) { const key = `${Math.floor(p.x / cellSize)},${Math.floor(p.z / cellSize)}`; if (!cells.has(key)) cells.set(key, []); cells.get(key)!.push(p); }
  const transform = new THREE.Object3D(), matrix = new THREE.Matrix4();
  source.traverse(part => {
    if (!(part instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
      if (material instanceof THREE.MeshStandardMaterial) { material.roughness = .94; material.envMapIntensity = .65; }
    }
    for (const positions of cells.values()) {
      const geometry=isForest?part.geometry.clone():part.geometry;
      const mesh = new THREE.InstancedMesh(geometry, part.material, positions.length); mesh.name = name;
      if(isForest)geometry.setAttribute('treeOrigin',new THREE.InstancedBufferAttribute(new Float32Array(positions.flatMap(p=>[p.x,p.y,p.z,p.scale])),4));
      positions.forEach((p, i) => {
        transform.position.set(p.x, p.y, p.z); transform.rotation.set(0, p.angle, 0); transform.scale.set(p.scale*(p.width??1),p.scale*(p.height??1),p.scale*(p.depth??1)); transform.updateMatrix();
        matrix.multiplyMatrices(transform.matrix, part.matrixWorld); mesh.setMatrixAt(i, matrix);
      });
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.computeBoundingSphere(); root.add(mesh);
    }
  });
}

export async function createHarborVegetation(quality: string, lots: {x:number;z:number;w:number;d:number;angle:number}[] = [], gardenTrees: {x:number;z:number}[] = []): Promise<THREE.Group> {
  const root = new THREE.Group(); root.name = 'Coastal woodland and natural rock';
  const loader = new THREE.TextureLoader(), modelLoader = new GLTFLoader();
  const loadShape = async (name: string): Promise<{height:number;cardHeight:number;cardWidth:number}> => {
    const response = await fetch(`/harbor/${name}.json`);
    if (!response.ok) throw new Error(`Unable to load ${name} billboard dimensions`);
    return response.json();
  };
  const [firMap, leafMap, tree, rock, fir, firShape, leafShape] = await Promise.all([
    loader.loadAsync('/harbor/fir-impostor.png'), loader.loadAsync('/harbor/broadleaf-impostor.png'),
    modelLoader.loadAsync('/harbor/broadleaf.glb'), modelLoader.loadAsync('/harbor/coastal-rock.glb'), modelLoader.loadAsync('/harbor/fir.glb'),
    loadShape('fir'), loadShape('broadleaf'),
  ]);
  const rng = random(7341);
  const groundHeight = (x: number, z: number) => terrainHeight(x, z, quality);
  const forests: Placement[][] = [[], []];
  const foregroundFir:Placement[]=[];
  const spacing = quality === 'medium' ? 23 : 16;
  for (let x = -4200; x < 4000; x += spacing) for (let z = -4400; z < 2900; z += spacing) {
    const px = x + rng() * spacing, pz = z + rng() * spacing, inland = coastDistance(px, pz);
    if (inland < 45 || inland > 2700 || (px > -1130 && px < -50 && Math.abs(pz) < 890)) continue;
    if (Math.hypot(px,pz)>3400 && rng()<.45)continue;
    const density = noise(px / 220, pz / 210);
    if (rng() > THREE.MathUtils.smoothstep(density,.22,.62)*.94+.04) continue;
    const y = groundHeight(px, pz), slope = Math.abs(groundHeight(px + 9, pz) - y) + Math.abs(groundHeight(px, pz + 9) - y);
    if (slope > 16 || y > 580) continue;
    const species = y > 155 || rng() > .38 ? 0 : 1;
    const placement={ x: px, y: y - .3, z: pz, scale: species === 0 ? 1.45 + rng() * .85 : 4.1 + rng() * 2.2, angle: rng() * Math.PI };
    if(species===0 && Math.hypot(px,pz)<1200 && foregroundFir.length<(quality==='medium'?8:16))foregroundFir.push(placement);
    else forests[species].push(placement);
  }
  // Continuous groves fill gaps between the town and the lower hills.
  for (let i = 0; i < 250; i++) {
    const x = -640 - rng() * 690, z = -1150 + rng() * 2300;
    if (Math.abs(z) < 840 && x > -950) continue;
    forests[1].push({ x, y: groundHeight(x, z) - .3, z, scale: 2.3 + rng() * 2, angle: rng() * Math.PI });
  }
  for(const {x,z} of gardenTrees)forests[1].push({x,y:groundHeight(x,z) - .3,z,scale:3.7+rng()*1.6,angle:rng()*Math.PI});
  for (const z of [-650, -455, -260, -65, 130, 325, 520, 660]) {
    for (const x of [-440, -475]) forests[1].push({ x: x + rng() * 10, y: 6.3, z: z + rng() * 10, scale: 3.4 + rng(), angle: rng() * Math.PI * 2 });
  }
  const intersectsLot=(p:Placement)=>lots.some(l=>{const x=(p.x-l.x)*Math.cos(l.angle)-(p.z-l.z)*Math.sin(l.angle),z=(p.x-l.x)*Math.sin(l.angle)+(p.z-l.z)*Math.cos(l.angle);return Math.abs(x)<l.w/2+2&&Math.abs(z)<l.d/2+2;});
  forests.forEach((list,i)=>forests[i]=list.filter(p=>!intersectsLot(p)));
  const billboards: THREE.Mesh[] = [];
  [firMap, leafMap].forEach((map, species) => {
    map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
    const shape = species === 0 ? firShape : leafShape;
    const geometry = new THREE.PlaneGeometry(shape.cardWidth, shape.cardHeight).translate(0, shape.height / 2, 0);
    const material = new THREE.MeshBasicNodeMaterial({ map, alphaTest: .32, alphaToCoverage: true, side: THREE.DoubleSide, color: new THREE.Color(1.38, 1.42, 1.30) });
    if (species === 0) {
      // A distant trunk becomes thinner than one texel and disappears in the
      // alpha mipmaps. Preserve its coverage so the crown still meets the land.
      const texel = texture(map);
      const halfWidth = positionGeometry.x.fwidth().mul(.55).max(.16);
      const trunk = positionGeometry.x.abs().smoothstep(halfWidth.mul(.55), halfWidth).oneMinus()
        .mul(positionGeometry.y.greaterThanEqual(0).select(1, 0))
        .mul(positionGeometry.y.lessThan(shape.height * .56).select(1, 0));
      material.colorNode = vec4(mix(color('#4c4634'), texel.rgb.mul(vec3(1.38, 1.42, 1.30)), texel.a), texel.a.max(trunk));
    }
    // Upright GPU billboards face the current camera; no intersecting cardboard planes.
    const origin=attribute<'vec4'>('treeOrigin','vec4'),direction=cameraPosition.sub(origin.xyz);
    const right=vec3(direction.z,0,direction.x.negate()).normalize();
    material.positionNode=origin.xyz.add(right.mul(positionGeometry.x.mul(origin.w))).add(vec3(0,positionGeometry.y.mul(origin.w),0));
    const source = new THREE.Mesh(geometry, material);
    billboards.push(source);
    instances(root, source, forests[species], species === 0 ? 'Fir forest clusters' : 'Broadleaf woodland');
  });
  // Detailed foliage is expensive even when it occupies only a few pixels.
  // Keep its geometry for nearby inspection and switch each grove to billboards
  // beyond 260 m. Both levels share the same grounded positions and scale.
  const detailedGrove = (source: THREE.Object3D, positions: Placement[], species: number, name: string) => {
    const cells = new Map<string, Placement[]>();
    for (const p of positions) {
      const key = `${Math.floor(p.x / 180)},${Math.floor(p.z / 180)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key)!.push(p);
    }
    for (const placements of cells.values()) {
      const center = new THREE.Vector3();
      for (const p of placements) center.add(new THREE.Vector3(p.x, p.y, p.z));
      center.divideScalar(placements.length);
      const near = new THREE.Group(), far = new THREE.Group(), lod = new THREE.LOD();
      instances(near, source, placements, name);
      instances(far, billboards[species], placements, species === 0 ? 'Fir forest clusters' : 'Broadleaf woodland');
      near.position.copy(center).negate(); far.position.copy(near.position);
      lod.position.copy(center); lod.name = 'Coastal tree detail'; lod.autoUpdate = false;
      lod.addLevel(near, 0); lod.addLevel(far, 260, .12); root.add(lod);
    }
  };
  const garden: Placement[] = [];
  for(const z of [-320,-43,241,565])for(const x of [-202,-238,-285])garden.push({x,y:6.5,z,scale:2.2+rng(),angle:rng()*Math.PI*2});
  detailedGrove(tree.scene, garden, 1, 'Dockyard avenue trees');
  detailedGrove(fir.scene, foregroundFir, 0, 'Detailed coastal firs');
  const rocks: Placement[] = [];
  for (let z = -1530; z < 2700; z += 24) {
    if (z > -720 && z < 690) continue;
    const x = westCoast(z) + (noise(z / 160, 19) - .5) * 65;
    for (let i = 0; i < 3; i++) rocks.push({ x: x + rng() * 20 - 10, y: -1 + rng() * 2, z: z + rng() * 24, scale: 1.4 + rng() * 3, angle: rng() * Math.PI * 2 });
  }
  for (let i = 0; i < 160; i++) {
    const x = -700 - rng() * 1700, z = -1400 + rng() * 3000;
    if (coastDistance(x, z) < 150 || (x>-1180 && Math.abs(z)<910)) continue;
    rocks.push({ x, y: terrainHeight(x, z) - 2, z, scale: 2 + rng() * 4, angle: rng() * Math.PI * 2 });
  }
  for(const [cx,cz] of [[-1610,-480],[-1860,-320],[-2060,-240],[-1610,610],[-1860,750],[-2080,870],[-1580,-1080]]) {
    for(let i=0;i<4;i++) {
      const x=cx+(i-1.5)*38,z=cz+(rng()-.5)*37,scale=14+rng()*10;
      rocks.push({x,y:terrainHeight(x,z)-scale*.5,z,scale,angle:Math.PI*.25+(rng()-.5)*.3,width:1.8,height:.56,depth:1.2});
    }
  }
  instances(root, rock.scene, rocks, 'Scanned coastal outcrops');
  // Forest impostors do not cast thousands of distant shadow passes.
  root.traverse(object => { if (object.name.includes('forest') || object.name.includes('woodland')) object.castShadow = false; });
  root.userData.trees = forests[0].length + foregroundFir.length + forests[1].length + garden.length;
  root.userData.rocks = rocks.length;
  return root;
}
