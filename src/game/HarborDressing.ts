import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HarborGeometry, harborSign, random, v, type HarborMaterials } from './HarborGeometry';
import { instances } from './HarborVegetation';

/** Loading bays and workshops are composed as work areas, not random prop scatter. */
export async function dressHarbor(root:THREE.Group,g:HarborGeometry,m:HarborMaterials):Promise<void> {
  const loader=new GLTFLoader(),rng=random(4490);
  const [crate,barrel]=await Promise.all([loader.loadAsync('/harbor/cargo-crate.glb'),loader.loadAsync('/harbor/cargo-barrel.glb')]);
  const crates:{x:number;y:number;z:number;scale:number;angle:number}[]=[],drums:typeof crates=[];
  for(const [index,z] of [-541,-319,-39,240,551].entries()) {
    // Large labeled loading bays, stacked freight and timber dunnage.
    const x=-171;
    g.box(38,.045,57,x,6.56,z,m.apron,0,index%2?'#a5aba0':'#b7b7a8');
    for(const side of [-1,1]){g.box(.16,.045,57,x+side*18.5,6.61,z,m.paint);g.box(38,.045,.16,x,6.61,z+side*28.5,m.paint);}
    for(let row=0;row<4;row++)for(let col=0;col<6;col++) {
      if(rng()<.15)continue;
      const px=x-12+row*3.8,pz=z-20+col*3.8,scale=2.7;
      for(let level=0;level<(col%3===0?3:2);level++)crates.push({x:px+(rng()-.5)*.12,y:6.64+level*scale*.465,z:pz,scale,angle:(rng()-.5)*.08});
    }
    for(let row=0;row<3;row++)for(let col=0;col<4;col++)drums.push({x:x+8+row*1.15,y:6.6,z:z+12+col*1.2,scale:1.13,angle:rng()*6.28});
    g.box(13,.55,6,x+7,6.9,z-19,m.wood);
    for(let row=0;row<5;row++)for(let col=0;col<3;col++)g.box(12,.42,.66,x+7,7.4+col*.5,z-21+row*.82,m.wood,0,'#b5a282');
    // Hose reels and water/fuel standpipes near each servicing berth.
    g.cylinder(.23,2.5,-78,7.75,z+7,m.steel,.23,12);
    g.beam(v(-78,8.9,z+7),v(-75.8,8.9,z+7),.18,m.steel);
    for(let i=0;i<4;i++)g.add(new THREE.TorusGeometry(1.15+i*.16,.075,6,40).rotateX(Math.PI/2).translate(-78,6.62,z+11),m.dark);
    g.add(new THREE.TorusGeometry(.35,.075,6,16).translate(-78,8.3,z+6.7),m.rust);
  }
  instances(root,crate.scene,crates,'Scanned timber freight');instances(root,barrel.scene,drums,'Scanned oil drums');
  // Covered engineering shops occupy the space behind the main warehouses.
  for(const z of [-553,-278,281,554]) {
    const x=-302;
    g.box(30,7.4,40,x,10.2,z,m.brick,0,'#b9aaa0');g.roof(34,5,44,x,13.9,z,m.slate);
    for(const dz of [-12,0,12]){g.box(.2,4.8,7,x+15.15,9.9,z+dz,m.dark);g.box(.3,2.1,7.8,x-15.15,11.3,z+dz,m.glass);}
    g.box(15,.6,42,x+21,13.1,z,m.slate);
    for(const dz of [-18,0,18])g.beam(v(x+28,6.5,z+dz),v(x+28,13.1,z+dz),.14,m.steel);
    harborSign(root,'MASCHINENWERKSTATT',20,2.1,v(x+15.3,13.0,z),Math.PI/2);
  }
  // Pipes, a repair gantry, cable drums and rail-side steel stock.
  for(const z of [-375,95,468]) {
    for(let row=0;row<3;row++)for(let col=0;col<4;col++) {
      g.beam(v(-350+row*1.3,7.1+col*.85,z-9),v(-350+row*1.3,7.1+col*.85,z+9),.39,m.rust);
    }
    for(const dx of [-9,9]){g.beam(v(-345+dx,6.5,z-14),v(-345+dx,17,z-14),.26,m.steel);g.beam(v(-345+dx,6.5,z+14),v(-345+dx,17,z+14),.26,m.steel);}
    g.box(22,.8,.6,-345,17,z-14,m.steel);g.box(22,.8,.6,-345,17,z+14,m.steel);
  }
  // Rail-served coal and steel yards: large, legible work areas behind the quay.
  for(const [index,z] of [-592,-347,330,611].entries()) {
    const x=-466;
    g.box(54,.1,77,x,6.59,z,m.cobbles,0,'#a4a49b');
    for(const side of [-1,1])g.box(1.1,3,76,x+side*27,8,z,m.concrete);
    g.box(54,3,1.1,x,8,z-38,m.concrete);
    for(let i=0;i<4;i++) {
      if(index%2===0) {
        const heap=new THREE.SphereGeometry(1,20,12,0,Math.PI*2,0,Math.PI/2);
        heap.scale(12+rng()*4,5+rng()*4,15+rng()*3).translate(x+(i%2-.5)*23,6.7,z+(Math.floor(i/2)-.5)*30);
        g.add(heap,m.dark,'#9a9d94');
      } else {
        for(let layer=0;layer<5;layer++)for(let row=0;row<5;row++)g.box(.6,.55,19,x-19+row*1.5+(i%2)*22,7+layer*.6,z+(Math.floor(i/2)-.5)*32,m.rust);
      }
    }
    for(let dz=-34;dz<37;dz+=8)g.beam(v(x+29,6.7,z+dz),v(x+29,10,z+dz),.07,m.steel);
    for(const y of [8.2,9.8])g.beam(v(x+29,y,z-36),v(x+29,y,z+36),.04,m.steel);
  }
  const stains=document.createElement('canvas');stains.width=512;stains.height=512;const c=stains.getContext('2d')!;
  for(let i=0;i<90;i++) {
    const x=70+rng()*360,y=70+rng()*360,r=15+rng()*60;
    const gradient=c.createRadialGradient(x,y,0,x,y,r);gradient.addColorStop(0,'#26282412');gradient.addColorStop(1,'#26282400');c.fillStyle=gradient;c.fillRect(x-r,y-r,r*2,r*2);
  }
  c.strokeStyle='#2e342a26';c.lineWidth=5;
  for(const x of [143,187,317,361]){c.beginPath();c.moveTo(x,0);c.bezierCurveTo(x-6,140,x+18,330,x+11,512);c.stroke();}
  const map=new THREE.CanvasTexture(stains);map.colorSpace=THREE.SRGBColorSpace;
  const stainMaterial=new THREE.MeshStandardMaterial({map,transparent:true,depthWrite:false,roughness:1,polygonOffset:true,polygonOffsetFactor:-1});
  const stainGeometry=new THREE.PlaneGeometry(32,65).rotateX(-Math.PI/2);
  for(const z of [-555,-306,-54,267,540]){const mesh=new THREE.Mesh(stainGeometry,stainMaterial);mesh.position.set(-110,6.66,z);root.add(mesh);}
  for(let z=-660;z<675;z+=34) {
    g.box(1.2,.025,2.1,-68,6.54,z,m.dark);
    for(let dz=-.9;dz<1;dz+=.19)g.box(1.1,.028,.06,-68,6.57,z+dz,m.steel);
  }
}
