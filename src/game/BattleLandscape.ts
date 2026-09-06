import * as THREE from 'three/webgpu';
import { attribute, cameraViewMatrix, color, float, mix, positionLocal, texture, triplanarTexture, vec3, vec4 } from 'three/tsl';
import { islandHeight, islandRadius, islandRim, type Island, type OceanMap } from '../maps/catalog';
import { smooth, terrainNoise } from '../maps/terrain';
import type { Quality } from './types';
import { disposeObjects } from './disposeObjects';

function terrainMaterial(map: OceanMap): THREE.MeshStandardMaterial | THREE.MeshStandardNodeMaterial {
  if (typeof document === 'undefined') return new THREE.MeshStandardMaterial({ vertexColors: true });
  const loader = new THREE.TextureLoader();
  const load = (name: string, srgb = false) => {
    const t=loader.load(`/harbor/${name}.jpg`); t.wrapS=t.wrapT=THREE.RepeatWrapping;
    t.anisotropy=8; if(srgb)t.colorSpace=THREE.SRGBColorSpace; return t;
  };
  const rockMap=load('rock-color',true), grassMap=load('meadow-color',true), macroMap=load('ground-color',true), normal=load('rock-normal');
  const material = new THREE.MeshStandardNodeMaterial({ roughness: .96 });
  const rockFine=triplanarTexture(texture(rockMap),null,null,float(1/31)).rgb;
  const rockBroad=triplanarTexture(texture(rockMap),null,null,float(1/137)).rgb;
  const rock=rockFine.mul(.45).add(rockBroad.mul(.55));
  const grass=triplanarTexture(texture(grassMap),null,null,float(1/27)).rgb;
  const masks=attribute<'vec3'>('terrainCover','vec3');
  const stone=rock.mul(color(map.land.style==='volcanic'?'#969087':'#a1a099'));
  const leafLight=grass.dot(vec3(.2126,.7152,.0722)).mul(.8).add(.12);
  const vegetation=leafLight.mul(color(map.land.style==='tropical'?'#52773c':'#67734e'));
  const ground=mix(vegetation,stone,masks.x);
  const snow=vec3(.64,.71,.74);
  const sand=rock.mul(.35).add(color(map.land.shore).mul(.52));
  const macro=texture(macroMap,positionLocal.xz.mul(1/950)).rgb.mul(.38).add(.79);
  material.colorNode=mix(mix(ground,snow,masks.y),sand,masks.z).mul(macro).mul(attribute('color','vec3'));
  if(map.land.style!=='snow'){material.normalMap=normal;material.normalScale.set(.16,.16);}
  if(map.land.style==='volcanic')material.emissiveNode=material.colorNode.mul(.55);
  // Explicit references let the common disposer release textures used only by the node graph.
  material.userData.landTextures=map.land.style==='snow'?[rockMap,grassMap,macroMap,normal]:[rockMap,grassMap,macroMap];
  return material;
}

/** The mesh resolves both watershed-scale ridges and narrow coastal terraces. */
export function createBattleLandscape(map: OceanMap, islands: readonly Island[], quality: Quality): THREE.Group {
  const root = new THREE.Group(); root.name = `${map.name} coastline`;
  if(!islands.length)return root;
  const material=terrainMaterial(map);
  const segments=quality==='medium'?320:512, rings=quality==='medium'?112:176;
  for(const island of islands) {
    const uv:number[]=[], positions:number[]=[], indices:number[]=[], colors:number[]=[], cover:number[]=[];
    for(let ring=0;ring<=rings;ring++)for(let sector=0;sector<=segments;sector++) {
      const angle=sector/segments*Math.PI*2;
      // Reserve a vertex ring at the exact coastline (r=1), with a submerged skirt.
      const fraction=ring===rings?1.08:ring/(rings-1);
      const radius=fraction*islandRim(angle,island.seed);
      const x=island.x+Math.cos(angle)*island.rx*radius,z=island.z+Math.sin(angle)*island.rz*radius;
      const h=islandHeight(island,x,z);
      positions.push(x,h,z);uv.push(x/38,z/38);
      const dx=(islandHeight(island,x+10,z)-islandHeight(island,x-10,z))/20;
      const dz=(islandHeight(island,x,z+10)-islandHeight(island,x,z-10))/20;
      const slope=Math.hypot(dx,dz), n=terrainNoise(x/160,z/160);
      const stone=map.land.style==='tropical'?smooth(.65,1.35,slope):smooth(.35,.9,slope);
      const snow=map.land.style==='snow' ? smooth(35,180,h+(n-.5)*100)*(1-smooth(.7,1.5,slope)) : 0;
      const exposed=map.land.style==='snow'?1:map.land.style==='tropical'?stone:Math.max(stone,smooth(island.height*.55,island.height*.78,h));
      // Beaches occur in low, sheltered coves instead of an identical stripe around every island.
      const sand=map.land.style==='tropical'?(1-smooth(2,12,h))*(1-smooth(.12,.3,slope)):0;
      cover.push(exposed,snow,sand);
      const shade=.79+.21*terrainNoise(x/370,z/370);
      const forest=map.land.style!=='snow'?(1-stone)*smooth(15,65,h)*(1-smooth(island.height*.5,island.height*.72,h)):0;
      const canopy=1-forest*.23;
      colors.push(shade*canopy,shade*canopy,shade*canopy);
      if(ring<rings&&sector<segments){const a=ring*(segments+1)+sector,b=a+segments+1;indices.push(a,a+1,b,a+1,b+1,b);}
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
    geometry.setAttribute('terrainCover',new THREE.Float32BufferAttribute(cover,3));
    geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,material);mesh.name=island.id;// The fleet-sized shadow map does not cover these kilometer-scale meshes.
    mesh.receiveShadow=false;root.add(mesh);
    if(map.land.style==='tropical'||map.land.style==='volcanic')addForest(root,island,quality);
  }
  return root;
}

/** Dense, irregular groves at real tree scale. Transparent crowns reuse the retained CC0 tree scan. */
function addForest(root:THREE.Group,island:Island,quality:Quality):void {
  if(typeof document==='undefined')return;
  let seed=island.seed;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const points:{x:number;y:number;z:number;size:number;width:number;depth:number;nx:number;nz:number}[]=[];
  const spacing=quality==='medium'?20:13;
  for(let x=-island.rx*1.15;x<island.rx*1.15;x+=spacing)for(let z=-island.rz*1.15;z<island.rz*1.15;z+=spacing) {
    const px=island.x+x+random()*spacing,pz=island.z+z+random()*spacing;
    if(islandRadius(island,px,pz)>.97)continue;
    const y=islandHeight(island,px,pz);
    if(y<12||y>island.height*(island.style==='tropical'?.95:.43))continue;
    const east=islandHeight(island,px+8,pz),west=islandHeight(island,px-8,pz),north=islandHeight(island,px,pz+8),south=islandHeight(island,px,pz-8);
    const nx=(west-east)/16,nz=(south-north)/16,slope=Math.hypot(nx,nz);
    if(slope>.65||random()>smooth(.25,.48,terrainNoise(px/260,pz/260)))continue;
    points.push({x:px,y:Math.min(y,east,west,north,south)-1.5,z:pz,size:18+random()*12,width:16+random()*20,depth:.7+random()*.3,nx,nz});
  }
  const map=new THREE.TextureLoader().load('/harbor/broadleaf-impostor.png');map.colorSpace=THREE.SRGBColorSpace;
  // Match diffuse lighting to the supporting slope, independent of card orientation.
  // Rotating flat billboard normals toward the sun otherwise turns entire groves black.
  const material=new THREE.MeshStandardNodeMaterial({map,alphaTest:.3,alphaToCoverage:true,side:THREE.DoubleSide,roughness:1,color:new THREE.Color(.25,.36,.17)});
  material.normalNode=cameraViewMatrix.mul(vec4(attribute<'vec3'>('groundNormal','vec3'),0)).xyz.normalize();
  if(island.style==='volcanic')material.emissiveNode=texture(map).rgb.mul(.55);
  // Two crossed, overlapping crowns retain volume from arbitrary camera headings.
  const positions:number[]=[],uv:number[]=[],indices:number[]=[];
  for(let plane=0;plane<2;plane++) {
    const angle=plane*Math.PI/2,c=Math.cos(angle)*.55,s=Math.sin(angle)*.55,base=positions.length/3;
    positions.push(-c,-.14,-s,c,-.14,s,-c,.86,-s,c,.86,s);uv.push(0,0,1,0,0,1,1,1);indices.push(base,base+1,base+2,base+2,base+1,base+3);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeVertexNormals();
  geometry.setAttribute('groundNormal',new THREE.InstancedBufferAttribute(new Float32Array(points.flatMap(p=>{const length=Math.hypot(p.nx,1,p.nz);return[p.nx/length,1/length,p.nz/length];})),3));
  const crowns=new THREE.InstancedMesh(geometry,material,points.length);crowns.name=`${island.id} forest`;
  const transform=new THREE.Object3D(),tint=new THREE.Color();
  points.forEach((p,i)=>{transform.position.set(p.x,p.y,p.z);transform.scale.set(p.width,p.size,p.width*p.depth);transform.rotation.y=random()*Math.PI;transform.updateMatrix();crowns.setMatrixAt(i,transform.matrix);crowns.setColorAt(i,tint.setScalar(.9+random()*.3));});
  crowns.computeBoundingSphere();root.add(crowns);
}

export function disposeBattleLandscape(root:THREE.Group):void {
  root.removeFromParent();
  const textures=new Set<THREE.Texture>();
  root.traverse(object=>{
    if(object instanceof THREE.InstancedMesh)object.dispose();
    if(object instanceof THREE.Mesh)for(const m of Array.isArray(object.material)?object.material:[object.material])for(const t of m.userData.landTextures??[])textures.add(t);
  });
  textures.forEach(t=>t.dispose());disposeObjects(root);
}
