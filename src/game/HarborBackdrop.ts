/** A complete coastal naval base at meter scale, built to be explored in 3D. */
import * as THREE from 'three/webgpu';
import { HarborGeometry, loadHarborMaterials, random, v } from './HarborGeometry';
import { createHarborTerrain } from './HarborTerrain';
import { createHarborVegetation } from './HarborVegetation';
import { HarborStructures } from './HarborStructures';
import { dressHarbor } from './HarborDressing';
import type { Quality } from './types';

export class HarborBackdrop extends THREE.Group {
  private elapsed = 0;
  private birds: THREE.Group[] = [];
  private smoke?: THREE.InstancedMesh;
  private smokeOrigins: THREE.Vector3[] = [];
  private tug?: THREE.Group;
  private flag?: THREE.Mesh;
  private vegetationLevels: THREE.LOD[] = [];
  private dummy = new THREE.Object3D();
  readonly ownedTextures = new Set<THREE.Texture>();

  constructor() { super(); this.name = 'North Atlantic naval anchorage'; }

  async build(quality: Quality): Promise<void> {
    const { materials: m, textures } = await loadHarborMaterials();
    Object.values(textures).forEach(t => this.ownedTextures.add(t));
    this.add(createHarborTerrain(textures, quality));
    const g = new HarborGeometry(this), s = new HarborStructures(this,g,m), rng = random(8519);
    s.quays();
    g.box(21,.18,1370,-379,6.53,0,m.road);
    for(let z=-670;z<670;z+=15)g.box(.17,.03,6,-379,6.64,z,m.paint);
    for(const x of [-142,-147,-324,-329]) {
      g.box(.18,.22,1330,x,6.68,0,m.steel);
      for(let z=-660;z<665;z+=2.3)g.box(2.9,.14,.22,x+(x===-142||x===-324?-.75:.75),6.49,z,m.wood);
    }
    for(const [x,z,w,d] of [[-237,-450,91,156],[-228,-178,83,153],[-231,101,89,151],[-240,383,95,153]])s.warehouse(x,z,w,d);
    s.admiralty(-433,-24);
    for(const [x,z] of [[-452,-470],[-441,410],[-448,560]])s.house(x,z,29,40,3,0,'#c4bb9c');
    for(const [z,angle,height] of [[-588,.2,57],[-298,-.15,65],[247,.12,63],[601,-.25,52]])s.crane(-89,z,height,angle);
    s.railFreight();s.fuelDepot();s.shipyard();s.servicePiers();s.town();s.breakwater();
    this.smokeOrigins=s.smokeOrigins;this.userData.buildings=s.buildings;
    // Timber crates and drums fit the period; little cargo establishes human scale.
    for(let i=0;i<32;i++) {
      const x=i%3===0?-291-rng()*20:-170-rng()*23,z=-637+rng()*1290;
      const w=1.3+rng()*3,h=.9+rng()*2.4,d=1.5+rng()*3,angle=(rng()-.5)*.25;
      g.box(w,h,d,x,6.5+h/2,z,m.wood,angle,i%3?'#c2b694':'#9b9378');
      for(const side of [-1,1])g.box(.09,h+.08,d+.08,x+side*w*.35,6.5+h/2,z,m.dark,angle);
      if(i%5===0)g.box(w*.8,h*.75,d*.9,x+.2,6.5+h*1.375,z,m.wood,angle);
      if(i%4===0)for(let j=0;j<4;j++)g.cylinder(.45,1.1,x+4+j*1.1,7.05,z,i%2?m.rust:m.steel,.45,12);
    }
    for(const [x,z,a] of [[-370,-490,0],[-370,200,0],[-183,-71,Math.PI/2],[-170,464,-Math.PI/2],[-395,501,Math.PI],[-370,-240,0],[-320,-610,0]])s.truck(x,z,a);
    for(let z=-645;z<=640;z+=68){s.lamp(-119,z,13);s.lamp(-363,z+14,10);}
    this.tug=s.serviceBoat();this.tug.position.set(430,0,-330);this.add(this.tug);
    const moored=s.serviceBoat();moored.scale.setScalar(.7);moored.position.set(-16,0,360);this.add(moored);
    await dressHarbor(this,g,m);
    g.finish();
    const nature=await createHarborVegetation(quality,s.lots,s.gardenTrees);this.add(nature);
    nature.traverse(object => { if (object instanceof THREE.LOD) this.vegetationLevels.push(object); });
    this.userData.trees=nature.userData.trees;this.userData.rocks=nature.userData.rocks;
    this.atmosphere();
    this.updateMatrixWorld(true);
  }

  private atmosphere():void {
    const rng=random(112);
    const birdGeometry=new THREE.BufferGeometry();birdGeometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,.8,.08,-.35,1.8,.03,-.24,0,0,0,-1.8,.03,-.24,-.8,.08,-.35],3));birdGeometry.computeVertexNormals();
    const birdMaterial=new THREE.MeshBasicMaterial({color:'#d2d5cb',side:THREE.DoubleSide});
    for(let i=0;i<22;i++) {
      const bird=new THREE.Group();bird.add(new THREE.Mesh(birdGeometry,birdMaterial));
      bird.userData={phase:rng()*Math.PI*2,radius:95+rng()*450,height:35+rng()*75,speed:.045+rng()*.04};this.birds.push(bird);this.add(bird);
    }
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const c=canvas.getContext('2d')!;
    const gradient=c.createRadialGradient(64,64,2,64,64,62);gradient.addColorStop(0,'#9b9c9550');gradient.addColorStop(.5,'#9b9c9522');gradient.addColorStop(1,'#9b9c9500');c.fillStyle=gradient;c.fillRect(0,0,128,128);
    this.smoke=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(canvas),transparent:true,depthWrite:false,color:'#878e88'}),48);
    this.smoke.frustumCulled=false;this.smoke.name='Drifting dockyard smoke';this.add(this.smoke);
    const flagGeometry=new THREE.PlaneGeometry(5,2.6,16,4);flagGeometry.translate(2.5,0,0);
    this.flag=new THREE.Mesh(flagGeometry,new THREE.MeshStandardMaterial({color:'#c6b789',side:THREE.DoubleSide,roughness:.9}));this.flag.position.set(-421,59,-80);this.add(this.flag);
  }

  update(dt:number,camera:THREE.Camera):void {
    if(!this.visible)return;
    for (const lod of this.vegetationLevels) lod.update(camera);
    this.elapsed+=dt;
    for(const bird of this.birds) {
      const {phase,radius,height,speed}=bird.userData,a=phase+this.elapsed*speed;
      bird.position.set(Math.cos(a)*radius+80,height+Math.sin(a*2)*9,Math.sin(a)*radius-110);bird.rotation.y=-a;bird.rotation.z=Math.sin(a*3)*.16;bird.scale.y=.6+Math.sin(this.elapsed*4+phase)*.4;
    }
    if(this.tug){const t=this.elapsed*.007;this.tug.position.set(380+Math.sin(t)*125,Math.sin(this.elapsed*.8)*.16,-310+Math.cos(t)*100);this.tug.rotation.y=-t+Math.PI/2;}
    if(this.flag){const p=this.flag.geometry.getAttribute('position');for(let i=0;i<p.count;i++)p.setZ(i,Math.sin(p.getX(i)*1.8-this.elapsed*3.5)*.36*p.getX(i)/5);p.needsUpdate=true;this.flag.geometry.computeVertexNormals();}
    if(this.smoke)for(let i=0;i<48;i++) {
      const origin=this.smokeOrigins[i%this.smokeOrigins.length],t=(i/48+this.elapsed*.017)%1,size=5+t*31;
      this.dummy.position.copy(origin);this.dummy.position.x+=t*65;this.dummy.position.y+=t*57;this.dummy.position.z-=t*16;
      this.dummy.quaternion.copy(camera.quaternion);this.dummy.scale.set(size,size,1);this.dummy.updateMatrix();this.smoke.setMatrixAt(i,this.dummy.matrix);
    }
    if(this.smoke)this.smoke.instanceMatrix.needsUpdate=true;
  }
}

export async function createHarborBackdrop(quality:Quality):Promise<HarborBackdrop> {
  const harbor=new HarborBackdrop();await harbor.build(quality);return harbor;
}
