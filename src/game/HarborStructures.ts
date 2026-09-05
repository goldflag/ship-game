import * as THREE from 'three/webgpu';
import { HarborGeometry, harborSign, random, v, type HarborMaterials } from './HarborGeometry';
import { terrainHeight } from './HarborTerrain';

/** Reusable architectural parts, all dimensions in meters. */
export class HarborStructures {
  readonly smokeOrigins: THREE.Vector3[] = [];
  readonly lots: {x:number;z:number;w:number;d:number;angle:number}[] = [];
  readonly gardenTrees: {x:number;z:number}[] = [];
  buildings = 0;
  constructor(readonly root: THREE.Group, readonly g: HarborGeometry, readonly m: HarborMaterials) {}

  quays(): void {
    const {g,m}=this, rng=random(1189);
    g.box(462,15,1380,-284,-1.1,0,m.stone);
    g.box(317,.2,1376,-354.5,6.4,0,m.apron);
    g.box(62,.08,1373,-417,6.52,0,m.cobbles);
    g.box(25,.08,1330,-329,6.54,0,m.cobbles);
    // The repair slabs form the apron surface, with real expansion joints.
    // They no longer sit a few millimetres above another full concrete surface.
    for(let z=-688;z<688;z+=12)for(let x=-196;x<-55;x+=16) {
      const shade=new THREE.Color().setScalar(.9+rng()*.10);
      const width=Math.min(16,-55-x),depth=Math.min(12,688-z);
      g.box(width-.04,.2,depth-.04,x+width/2,6.4,z+depth/2,m.apron,0,`#${shade.getHexString()}`);
    }
    for(let z=-680;z<686;z+=6) {
      g.box(2.8,1.05,5.92,-54,6.8,z,m.concrete,0,z%5===0?'#aaaa97':'#d1cbb6');
      g.box(.12,3.3,4.7,-52.4,1.2,z,m.stone,0,'#566453');
    }
    for(let z=-675;z<686;z+=17) {
      g.box(140,.025,.08,-125,6.52,z,m.dark);
      g.box(.025,8,.11,-52.4,1.5,z,m.dark);
    }
    for(let z=-650;z<670;z+=32) {
      g.cylinder(.65,1.25,-58,7.3,z,m.dark,.85,12);
      g.box(2.3,.4,.75,-58,7.8,z,m.dark);
      g.box(1.4,6.4,2.5,-51.9,1.6,z+11,m.dark);
      for(const offset of [-.85,.85]) g.add(new THREE.TorusGeometry(.91,.25,8,16).rotateY(Math.PI/2).translate(-50.9,3,z+10+offset),m.dark);
      g.box(.55,.04,5,-56,7.34,z+14,m.paint);
    }
    for(let z=-625;z<680;z+=144) {
      for(const dz of [-.55,.55]) g.beam(v(-51.5,-1,z+dz),v(-51.5,7.8,z+dz),.055,m.rust);
      for(let y=-.5;y<7.6;y+=.36) g.beam(v(-51.3,y,z-.55),v(-51.3,y,z+.55),.04,m.rust);
    }
  }

  warehouse(x:number,z:number,w:number,d:number): void {
    const {g,m}=this, y=Math.max(6.5,terrainHeight(x,z)), h=17;
    this.buildings++;
    g.box(w+4,1.1,d+5,x,y+.35,z,m.concrete);
    g.box(w,h,d,x,y+h/2,z,m.brick);
    g.box(w+1.5,.55,d+1.5,x,y+h-.2,z,m.plaster);
    g.roof(w+5,9,d+5,x,y+h,z,m.slate);
    g.box(9,3,d-14,x,y+h+7,z,m.glass);
    g.roof(12,2,d-10,x,y+h+8.5,z,m.slate);
    for(const side of [-1,1]) {
      const front=x+side*(w/2+.1);
      g.beam(v(front,y+h,z-d/2),v(front,y+h,z+d/2),.16,m.steel);
      for(let dz=-d/2+10;dz<d/2;dz+=20) {
        g.box(1.05,h,1.35,front,y+h/2,z+dz-9,m.brick,0,'#cdc1a0');
        g.box(.25,7.4,9.1,front+side*.15,y+4.1,z+dz,m.dark);
        g.box(.28,6.6,8.2,front+side*.32,y+4.0,z+dz,m.steel);
        for(let a=-3.7;a<4;a+=1.3) g.box(.11,6.5,.08,front+side*.5,y+4.1,z+dz+a,m.dark);
        g.box(.31,3.3,10.2,front+side*.20,y+12.5,z+dz,m.plaster);
        g.box(.34,2.75,9.5,front+side*.37,y+12.5,z+dz,m.glass);
        for(let a=-4;a<=4;a+=2) g.box(.1,2.85,.13,front+side*.59,y+12.5,z+dz+a,m.plaster);
        g.box(.1,.12,9.6,front+side*.59,y+12.6,z+dz,m.plaster);
        g.box(5,.36,12,front+side*2,y+8.5,z+dz,m.slate);
        g.beam(v(front+side*.4,y+8.3,z+dz-4),v(front+side*3,y+7.2,z+dz-4),.07,m.steel);
      }
      for(const dz of [-d/2+1,d/2-1]) g.beam(v(front+side*.3,y,z+dz),v(front+side*.3,y+h,z+dz),.12,m.rust);
    }
    for(const dz of [-d*.32,0,d*.32]) { g.cylinder(.8,3,x-8,y+h+7,z+dz,m.steel); g.cylinder(1.3,.35,x-8,y+h+8.6,z+dz,m.dark); }
    harborSign(this.root, `MARINEWERFT   ${z<0?'LAGER':'WERKHALLE'} ${Math.round((z+550)/120)+1}`,25,3.2,v(x+w/2+.65,y+16,z),Math.PI/2,'#d9d0b2','#454b47');
  }

  house(x:number,z:number,w:number,d:number,floors:number,angle=0,tint='#ddd1b4'):void {
    const {g,m}=this, ground=Math.max(6.4,...[-1,1].flatMap(sx=>[-1,1].map(sz=>terrainHeight(x+sx*w/2,z+sz*d/2))))+.08, h=floors*3.6+1;
    const variant=Math.abs(Math.floor(x*7+z*3))%6;
    this.buildings++;
    this.lots.push({x,z,w:w+6,d:d+6,angle});
    const local=(lx:number,ly:number,lz:number)=>v(x+lx*Math.cos(angle)+lz*Math.sin(angle),ground+ly,z-lx*Math.sin(angle)+lz*Math.cos(angle));
    const box=(bw:number,bh:number,bd:number,lx:number,ly:number,lz:number,mat:THREE.Material,t=tint)=>{const p=local(lx,ly,lz);g.box(bw,bh,bd,p.x,p.y,p.z,mat,angle,t);};
    box(w+1,6,d+1,0,-2,0,m.stone,'#b7b6a4');
    // Facade bays form the walls themselves. A second box here fought with
    // them in the depth buffer across every building in the distant town.
    const roofTint=variant===2?'#c7a08d':variant===4?'#a8bbb3':'#c3c7c3';
    if(variant%3===0)g.hipRoof(w+1.6,w*.33,d+1.6,x,ground+h,z,m.slate,angle,roofTint);
    else {
      const rise=w*(variant===4?.43:.27);
      g.roof(w+1.6,rise,d+1.6,x,ground+h,z,m.slate,angle,roofTint,true);
      for(const side of [-1,1]) {
        const geometry=new THREE.BufferGeometry();
        geometry.setAttribute('position',new THREE.Float32BufferAttribute([-w/2,0,0,w/2,0,0,0,rise,0],3));
        geometry.computeVertexNormals();geometry.rotateY(side===1?0:Math.PI).translate(0,h,side*d/2).rotateY(angle).translate(x,ground,z);
        g.add(geometry,m.plaster,tint);
        box(1.9,2.1,.18,0,h+rise*.30,side*(d/2+.12),m.plaster,'#e2ddcc');
        box(1.3,1.6,.19,0,h+rise*.30,side*(d/2+.22),m.glass,'#bac6c2');
      }
    }
    box(w+1,.35,d+1,0,h-.3,0,m.plaster,'#e7dfc4');
    const panel = variant % 4, storeyHeight = h / floors;
    const facadeTint = ['#ffffff','#e8ecdf','#f2e9db','#eef0ec','#e4e7e2','#e8e2db'][variant];
    // Repeat complete architectural bays, not a stretched texture over the box.
    // The atlas supplies recessed glazing and weathering; projecting sills,
    // cornices, gutters and roofs still create real silhouette and shadows.
    for(const side of [-1,1])for(const axis of ['x','z'] as const) {
      const length=axis==='x'?d:w, sections=Math.max(1,Math.round(length/17)), span=length/sections;
      for(let section=0;section<sections;section++)for(let floor=0;floor<floors;floor++) {
        const along=-length/2+span*(section+.5), level=(floor+.5)*storeyHeight;
        const position=axis==='x'?local(side*w/2,level,along):local(along,level,side*d/2);
        const rotation=angle+(axis==='x'?side*Math.PI/2:side===1?0:Math.PI);
        const storey=floor===0&&axis==='x'&&side===1?0:floor===floors-1?2:1;
        g.facade(span,storeyHeight,position,rotation,panel,storey,m.facade,facadeTint);
        for(let bay=0;bay<4;bay++) {
          const offset=along+span*((bay+.5)/4-.5), sill=floor*storeyHeight+storeyHeight*.19;
          if(axis==='x')box(.30,.11,span*.17,side*(w/2+.12),sill,offset,m.plaster,'#e8e2d4');
          else box(span*.17,.11,.30,offset,sill,side*(d/2+.12),m.plaster,'#e8e2d4');
        }
      }
    }
    // Recessed entrances, cornices, rainwater goods and occasional balconies.
    box(2.4,.27,3.2,w/2+.7,3.1,0,m.slate,'#c1c0b4');
    box(2.8,.28,3.5,w/2+.7,.1,0,m.concrete,'#b5b2a1');
    for(const side of [-1,1]) {
      const a=local(side*(w/2+.16),h-.5,-d/2),b=local(side*(w/2+.16),h-.5,d/2);g.beam(a,b,.10,m.steel);
      for(const dz of [-d/2+.3,d/2-.3])g.beam(local(side*(w/2+.24),.3,dz),local(side*(w/2+.24),h-.5,dz),.075,m.steel);
    }
    if(variant===1||variant===5) {
      for(const dz of [-d*.22,d*.22]) {
        box(2.1,.25,3.8,w/2+.9,4.1,dz,m.concrete,'#d2c8b1');
        for(let r=-1.7;r<=1.7;r+=.45)g.beam(local(w/2+1.85,4.2,dz+r),local(w/2+1.85,5.3,dz+r),.034,m.steel);
        g.beam(local(w/2+1.85,5.3,dz-1.8),local(w/2+1.85,5.3,dz+1.8),.045,m.steel);
      }
    }
    if(variant===2||variant===4)for(const dz of [-d*.22,d*.22]) {
      const p=local(w*.23,h+w*.12,dz);g.box(w*.22,2.2,3.2,p.x,p.y,p.z,m.plaster,angle,tint);
      g.roof(w*.25,1.7,3.8,p.x,p.y+1.1,p.z,m.slate,angle,roofTint);
      box(.14,1.45,2,w*.34,h+w*.12,dz,m.glass,'#d0d9cf');
    }
    for(const dz of [-d*.3,d*.28]) {
      box(1.25,w*.24,1.3,-w*.19,h+w*.10,dz,m.brick,'#a69c83');
      box(1.65,.35,1.6,-w*.19,h+w*.225,dz,m.plaster,'#d1cab5');
    }
  }

  admiralty(x:number,z:number):void {
    const {g,m}=this;
    this.house(x,z,54,84,5,0,'#bcbaa7');
    this.house(x+12,z-56,26,27,8,0,'#c7c7ae');
    g.roof(30,16,30,x+12,36.2,z-56,m.slate);
    g.beam(v(x+12,48,z-56),v(x+12,63,z-56),.16,m.steel);
    harborSign(this.root,'HAFENKOMMANDANTUR',35,3,v(x+27.35,23,z),Math.PI/2);
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const c=canvas.getContext('2d')!;
    c.fillStyle='#d4c9a5';c.beginPath();c.arc(128,128,118,0,Math.PI*2);c.fill();c.strokeStyle='#303c3b';c.lineWidth=6;
    for(let i=0;i<12;i++){const a=i*Math.PI/6;c.beginPath();c.moveTo(128+Math.sin(a)*93,128+Math.cos(a)*93);c.lineTo(128+Math.sin(a)*109,128+Math.cos(a)*109);c.stroke();}
    c.lineWidth=8;c.beginPath();c.moveTo(128,62);c.lineTo(128,128);c.lineTo(175,155);c.stroke();
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
    const clock=new THREE.Mesh(new THREE.CircleGeometry(3.1,40),new THREE.MeshStandardMaterial({map,roughness:.85}));clock.position.set(x+25.3,30,z-56);clock.rotation.y=Math.PI/2;this.root.add(clock);
  }

  crane(x:number,z:number,h:number,angle:number):void {
    const {g,m}=this;
    const p=(dx:number,y:number,dz:number)=>v(x+dx*Math.cos(angle)+dz*Math.sin(angle),y,z-dx*Math.sin(angle)+dz*Math.cos(angle));
    const beam=(a:number[],b:number[],r=.25)=>g.beam(p(a[0],a[1],a[2]),p(b[0],b[1],b[2]),r,m.steel);
    for(const sx of [-1,1])for(const sz of [-1,1]) {
      beam([sx*12,7,sz*12],[sx*7,h,sz*7],.78);
      for(let y=8;y<h-8;y+=9) {
        const a=12-5*(y-7)/(h-7),b=12-5*(y+9-7)/(h-7);
        beam([sx*a,y,sz*a],[-sx*b,y+9,sz*b],.18);
        beam([sx*a,y,sz*a],[sx*b,y+9,-sz*b],.18);
      }
      g.cylinder(1.6,1.3,x+sx*12,7.2,z+sz*12,m.dark,1.6,16);
    }
    g.cylinder(8.5,2,x,h,z,m.steel);
    const cabin=p(5,h+4,4);g.box(8,6,7,cabin.x,cabin.y,cabin.z,m.plaster,angle,'#9ea89e');
    const glass=p(9.05,h+4.7,4);g.box(.15,2.8,5.8,glass.x,glass.y,glass.z,m.glass,angle);
    const ballast=p(-20,h+5,0);g.box(13,8,12,ballast.x,ballast.y,ballast.z,m.concrete,angle,'#9b9b8b');
    for(const side of [-1,1]) {
      beam([-25,h+3,side*3],[76,h+24,side*1.8],.43);
      beam([-25,h+8,side*3],[76,h+28,side*1.8],.43);
      for(let i=0;i<14;i++) {
        const a=-25+i*7.2,b=a+7.2;
        beam([a,h+3+(a+25)*.208,side*3],[b,h+8+(b+25)*.198,side*2.8],.17);
        beam([a,h+8+(a+25)*.198,side*3],[b,h+3+(b+25)*.208,side*2.8],.17);
      }
      beam([0,h+2,side*3],[-3,h+24,side*1.6],.45);
      beam([-3,h+24,side*1.6],[66,h+26,side*1.8],.085);
      beam([-3,h+24,side*1.6],[-25,h+5,side*3],.085);
    }
    beam([64,h+24,0],[64,20,0],.07);beam([65,h+24,0],[65,20,0],.07);
    const hook=p(64.5,19.5,0);g.add(new THREE.TorusGeometry(.8,.19,8,16,Math.PI*1.65).translate(hook.x,hook.y,hook.z),m.dark);
    for(let y=10;y<h;y+=.55) beam([-7,y,7],[-6,y,7],.035);
  }

  town():void {
    const {g,m}=this,rng=random(2168),tints=['#e2d4b5','#b4b7a5','#c6c4af','#d1b496','#b5b4ab','#d6ccb0'];
    let count=0;
    const streets=[
      [[-553,-830],[-580,-420],[-557,20],[-627,420],[-597,810]],
      [[-698,-820],[-726,-400],[-706,30],[-775,420],[-746,810]],
      [[-843,-790],[-875,-440],[-858,70],[-925,480],[-906,840]],
      [[-995,-760],[-1019,-400],[-1010,70],[-1080,480],[-1058,840]],
    ];
    for(const [streetIndex,points] of streets.entries()) {
      const curve=new THREE.CatmullRomCurve3(points.map(([x,z])=>v(x,0,z)));
      const road=curve.getPoints(110);
      for(let i=1;i<road.length;i++)this.road(road[i-1].x,road[i-1].z,road[i].x,road[i].z,streetIndex===0?13:9);
      const length=curve.getLength(),steps=Math.floor(length/36);
      for(let i=1;i<steps;i++)for(const side of [-1,1]) {
        const t=(i+(side===1?.2:-.2))/steps,p=curve.getPointAt(t),tangent=curve.getTangentAt(t),angle=Math.atan2(tangent.x,tangent.z);
        if(rng()<.06)continue;
        const w=19+rng()*9,d=27+rng()*5,offset=12+w/2;
        const x=p.x+Math.cos(angle)*side*offset,z=p.z-Math.sin(angle)*side*offset;
        if(Math.abs(z+142)<78&&Math.abs(x+888)<86)continue;
        if([-560,0,560].some(cross=>Math.abs(z-cross)<24))continue;
        this.house(x,z,w,d,2+Math.floor(rng()*3),angle,tints[count++%tints.length]);
        const treeX=p.x+Math.cos(angle)*side*(offset+w/2+8),treeZ=p.z-Math.sin(angle)*side*(offset+w/2+8);
        this.gardenTrees.push({x:treeX,z:treeZ});
        if(i%2===0)for(const depth of [18,32])this.gardenTrees.push({x:treeX+Math.cos(angle)*side*depth,z:treeZ-Math.sin(angle)*side*depth});
        // Walled back gardens and occasional paved forecourts give buildings real lots.
        if(i%3===0) {
          const y=terrainHeight(treeX,treeZ)+.7;
          g.box(.45,1.3,d+9,treeX+Math.cos(angle)*side*5,y,treeZ-Math.sin(angle)*side*5,m.stone,angle,'#b9b5a1');
        }
        if(side===1 && i%3===0)this.lamp(p.x+Math.cos(angle)*8,p.z-Math.sin(angle)*8,7,terrainHeight(p.x,p.z));
      }
    }
    for(const z of [-560,0,560])this.road(-1150,z,-378,z,11);
    // Looser villas at the tree line contrast with the compact workers' streets.
    for(let i=0;i<15;i++) {
      const x=-1160-rng()*130,z=-730+i*99;
      this.house(x,z,17+rng()*7,22+rng()*9,2,(rng()-.5)*.45,tints[i%tints.length]);
      for(const side of [-1,1])this.gardenTrees.push({x:x+side*24,z:z+16});
    }
    const x=-888,z=-142,y=terrainHeight(x,z);
    g.box(95,4,115,x,y-1,z,m.stone);this.house(x,z,33,67,4,0,'#b6b5a5');
    g.box(15,42,17,x+1,y+21,z+32,m.brick,0,'#c4bca5');g.cylinder(11,32,x+1,y+58,z+32,m.slate,0,8);
    for(const side of [-1,1])for(const offset of [-3,3]) {
      g.box(.24,9,2.5,x+1+side*7.62,y+34,z+32+offset,m.dark);
      g.box(2.5,9,.24,x+1+offset,y+34,z+32+side*8.62,m.dark);
    }
    g.beam(v(x+1,y+71,z+32),v(x+1,y+81,z+32),.12,m.steel);g.beam(v(x-1.5,y+77,z+32),v(x+3.5,y+77,z+32),.12,m.steel);
    for(const offset of [-90,95]) {
      const py=terrainHeight(-760,690+offset);
      g.box(38,26,54,-760,py+13,690+offset,m.brick);g.cylinder(3.5,68,-747,py+34,690+offset,m.brick,2.3,24);g.cylinder(2.8,1.5,-747,py+68,690+offset,m.dark);
      this.smokeOrigins.push(v(-747,py+69,690+offset));
    }
  }

  private road(ax:number,az:number,bx:number,bz:number,width:number):void {
    const length=Math.hypot(bx-ax,bz-az),steps=Math.ceil(length/10),dx=-(bz-az)/length*width/2,dz=(bx-ax)/length*width/2;
    const positions:number[]=[],indices:number[]=[];
    for(let i=0;i<=steps;i++) {
      const x=THREE.MathUtils.lerp(ax,bx,i/steps),z=THREE.MathUtils.lerp(az,bz,i/steps);
      for(const side of [-1,1]){const px=x+side*dx,pz=z+side*dz;positions.push(px,Math.max(6.5,terrainHeight(px,pz))+.12,pz);}
      if(i<steps){const n=i*2;indices.push(n,n+1,n+2,n+1,n+3,n+2);}
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();this.g.add(geometry,this.m.road);
    for(const side of [-1,1]) {
      const a=v(ax+dx*side,Math.max(6.5,terrainHeight(ax+dx*side,az+dz*side))+.24,az+dz*side);
      const b=v(bx+dx*side,Math.max(6.5,terrainHeight(bx+dx*side,bz+dz*side))+.24,bz+dz*side);
      this.g.beam(a,b,.18,this.m.concrete);
    }
  }

  fuelDepot():void {
    const {g,m}=this;
    for(const [x,z,r,h] of [[-307,-738,19,19],[-361,-756,22,24],[-305,-798,17,18],[-364,-824,20,22]]) {
      const y=Math.max(6.3,terrainHeight(x,z));
      g.cylinder(r+4,3,x,y,z,m.concrete);g.cylinder(r,h,x,y+h/2,z,m.plaster,r,40);g.cylinder(r+.4,1.2,x,y+h,z,m.steel,r*.3,40);
      for(const height of [y+1,y+h*.5,y+h-1])g.add(new THREE.TorusGeometry(r+.1,.12,6,48).rotateX(Math.PI/2).translate(x,height,z),m.steel);
      for(let step=0;step<h;step+=.45)g.beam(v(x+r+.3,y+step,z-.4),v(x+r+.3,y+step,z+.4),.045,m.steel);
      g.beam(v(x+r+1,y+2,z),v(-276,y+2,z),.48,m.rust);
    }
  }

  railFreight():void {
    const {g,m}=this;
    for(let i=0;i<7;i++) {
      const z=-185+i*15,x=-326.5;
      g.box(3.8,.8,12,x,8.05,z,m.dark);g.box(3.7,2.7,11.7,x,9.4,z,m.rust);g.box(3.15,.3,10.8,x,10.6,z,m.dark);
      for(const dz of [-4,4])for(const side of [-1,1])g.add(new THREE.CylinderGeometry(.65,.65,.35,12).rotateZ(Math.PI/2).translate(x+side*1.65,7.3,z+dz),m.dark);
      for(let dz=-5.5;dz<6;dz+=1.8)for(const side of [-1,1])g.box(.12,2.6,.16,x+side*1.9,9.4,z+dz,m.steel);
    }
  }

  servicePiers():void {
    const {g,m}=this;
    for(const [z,length] of [[-568,235],[572,180]]) {
      const x=-55+length/2;
      g.box(length,11,29,x,.3,z,m.stone);g.box(length,1,28,x,6.2,z,m.apron);
      for(let px=-43;px<-55+length;px+=20)for(const side of [-1,1]) {
        g.cylinder(.5,1,px,7.2,z+side*12,m.dark,.65,12);
        g.box(2.3,5,.9,px,2.7,z+side*15,m.dark);
      }
      for(const side of [-1,1])g.box(length-.6,.3,.65,x,6.9,z+side*13.6,m.concrete);
      for(const offset of [-1,1])g.box(length-15,.16,.08,x,6.79,z+offset*.85,m.steel);
      this.lamp(x+length/2-12,z,10,6.7);
      this.crane(x+length/2-38,z,27,z<0?Math.PI/2:-Math.PI/2);
      for(let i=0;i<7;i++)g.box(3.2,1.3+i%2,4.5,x-30+i*7,7.4,z+2,m.wood,0,'#b8ab8a');
    }
  }

  truck(x:number,z:number,a:number):void {
    const {g,m}=this;
    const local=(lx:number,y:number,lz:number)=>v(x+lx*Math.cos(a)+lz*Math.sin(a),y,z-lx*Math.sin(a)+lz*Math.cos(a));
    const box=(w:number,h:number,d:number,lx:number,y:number,lz:number,mat:THREE.Material)=>{const p=local(lx,y,lz);g.box(w,h,d,p.x,p.y,p.z,mat,a);};
    box(2.3,.35,7,0,7.4,0,m.dark);box(2.25,1.6,3.8,0,8.3,1.2,m.wood);box(2.2,2.1,1.8,0,8.55,-1.6,m.steel);box(1.8,.9,1.2,0,8.1,-3,m.steel);box(2,.66,.05,0,9,-2.54,m.glass);
    for(const side of [-1,1])for(const dz of [-2.1,2.1]) { const p=local(side*1.1,7.25,dz);g.add(new THREE.CylinderGeometry(.64,.64,.35,12).rotateZ(Math.PI/2).rotateY(a).translate(p.x,p.y,p.z),m.dark); }
  }

  lamp(x:number,z:number,height:number,ground=6.5):void {
    const {g,m}=this;
    g.cylinder(.35,.9,x,ground+.45,z,m.concrete,.32,10);g.beam(v(x,ground,z),v(x,ground+height,z),.10,m.steel);g.beam(v(x,ground+height,z),v(x+2.5,ground+height-.1,z),.085,m.steel);
    g.box(1.4,.35,.65,x+2.5,ground+height-.25,z,m.dark);g.box(1.15,.12,.52,x+2.5,ground+height-.46,z,m.lamp);
  }

  shipyard():void {
    const {g,m}=this;
    g.box(665,13,43,185,-.5,-866,m.stone);g.box(665,1,43,185,6.5,-866,m.concrete);
    g.box(55,13,265,490,-.5,-977,m.stone);g.box(55,1,265,490,6.5,-977,m.concrete);
    for(let x=-130;x<510;x+=27){g.cylinder(.8,1,x,7.5,-846,m.dark);this.lamp(x,-876,11);}
    this.crane(267,-866,51,-Math.PI/2);this.warehouse(-148,-1035,96,142);
    const y=terrainHeight(-280,-1160);
    g.box(151,15,250,-275,y+2,-1190,m.concrete);
    for(const x of [-329,-222]) {
      g.box(7,78,9,x,y+42,-1140,m.steel);g.box(11,6,34,x,y+6,-1140,m.steel);
      for(let h=10;h<79;h+=12) g.beam(v(x-3,y+h,-1144),v(x+3,y+h+10,-1136),.24,m.rust);
    }
    g.box(130,11,10,-275,y+81,-1140,m.steel);harborSign(this.root,'NORDWERFT',66,6,v(-275,y+81,-1134.9),0,'#c9c8b0','#596667');
    g.beam(v(-273,y+76,-1140),v(-273,y+24,-1140),.12,m.dark);
  }

  breakwater():void {
    const {g,m}=this,points=[v(-276,0,890),v(80,0,1020),v(500,0,1060)];
    for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i],mid=a.clone().lerp(b,.5),length=a.distanceTo(b),angle=Math.atan2(b.x-a.x,b.z-a.z);
      g.box(31,14,length+12,mid.x,-2,mid.z,m.stone,angle);g.box(20,1.8,length+12,mid.x,5.1,mid.z,m.concrete,angle);
      for(let t=0;t<1;t+=.024) {
        const p=a.clone().lerp(b,t);
        for(const s of [-1,1])g.add(new THREE.DodecahedronGeometry(4.4,1).scale(1.1,.8,1.2).rotateY(t*41).translate(p.x+Math.cos(angle)*s*17,.3,p.z-Math.sin(angle)*s*17),m.stone,'#aaa997');
      }
    }
    const x=501,z=1060;
    g.cylinder(19,3,x,6,z,m.concrete,19,48);g.cylinder(5.8,28,x,21,z,m.plaster,3.7,40);g.cylinder(4.25,5,x,28,z,m.rust,3.9,40);
    g.cylinder(5.7,1.2,x,35,z,m.concrete,5.7,40);g.cylinder(3.7,5,x,38,z,m.glass,3.7,20);g.cylinder(5,3.5,x,42.1,z,m.slate,0,32);g.cylinder(.85,2.3,x,38,z,m.lamp,.85,20);
    for(let i=0;i<16;i++){const a=i*Math.PI/8;g.beam(v(x+Math.sin(a)*5.4,35.5,z+Math.cos(a)*5.4),v(x+Math.sin(a)*5.4,37,z+Math.cos(a)*5.4),.055,m.steel);}
    g.add(new THREE.TorusGeometry(5.4,.07,6,48).rotateX(Math.PI/2).translate(x,37,z),m.steel);
  }

  serviceBoat():THREE.Group {
    const {m}=this,root=new THREE.Group(),g=new HarborGeometry(root);
    const shape=new THREE.Shape();shape.moveTo(-4,-11);shape.lineTo(-4,7);shape.quadraticCurveTo(-3.5,12,0,15);shape.quadraticCurveTo(3.5,12,4,7);shape.lineTo(4,-11);shape.quadraticCurveTo(0,-13,-4,-11);
    const hull=new THREE.ExtrudeGeometry(shape,{depth:3.2,bevelEnabled:true,bevelSize:.7,bevelThickness:.4,bevelSegments:3,steps:1});hull.rotateX(Math.PI/2).translate(0,2.4,0);g.add(hull,m.dark);
    g.box(6.8,.35,17,0,2.4,0,m.wood);g.box(5,3,7,0,4,1,m.plaster);g.box(5.3,.4,7.4,0,5.7,1,m.steel);g.box(4.3,1,4,0,6,2,m.glass);g.box(4.8,.4,4.5,0,6.7,2,m.steel);
    g.cylinder(.9,6,0,7,-4,m.rust);g.cylinder(1,.45,0,10,-4,m.dark);g.beam(v(0,5,6),v(0,13,6),.095,m.steel);g.beam(v(-2,11,6),v(2,11,6),.065,m.steel);
    for(const side of [-1,1])for(let z=-9;z<10;z+=3)g.add(new THREE.TorusGeometry(.58,.18,7,12).rotateY(Math.PI/2).translate(side*4.1,1.8,z),m.dark);
    g.finish();return root;
  }
}
