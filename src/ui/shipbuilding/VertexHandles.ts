import * as THREE from 'three';
import type { ConstructionPrimitive, ConstructionSource, Vec3 } from '../../ships/blueprint';
import { cornerVertices, editableCorners, rotateVertex, vertexEdit, worldVertex, type MirrorAxes } from '../../ships/constructionVertex';

export interface BuilderVertexOptions {
  id: string; corner: number; symmetry: boolean; axes: MirrorAxes; unit: number; axis: boolean; snap: boolean;
  onSelect(corner: number): void;
  onCommit(replacements: ConstructionPrimitive[]): void;
}
interface Drag {
  pointer: number; target: HTMLButtonElement; source: ConstructionSource; options: BuilderVertexOptions;
  primitive: ConstructionPrimitive; corner: number; x: number; y: number; anchor: THREE.Vector3;
  plane?: THREE.Plane; origin?: THREE.Vector3; axis?: number; blocked?: number;
  replacements: ConstructionPrimitive[];
}
/** Screen-sized, keyboard-focusable handles. Only pointer release writes source/history. */
export class VertexHandles {
  readonly element = document.createElement('div');
  private buttons: HTMLButtonElement[];
  private drag?: Drag;
  private source!: ConstructionSource;
  private options?: BuilderVertexOptions;
  constructor(private host: HTMLElement, private camera: () => THREE.Camera,
    private preview: (replacements?: ConstructionPrimitive[]) => void) {
    this.element.className = 'sb-vertex-handles';
    this.buttons = Array.from({length:8},(_,i) => {
      const b=document.createElement('button'); b.className='sb-vertex-handle'; b.type='button'; b.setAttribute('aria-label',`Hull corner ${i+1}`);
      b.addEventListener('pointerdown',e=>this.down(e,i));
      b.addEventListener('pointermove',this.move); b.addEventListener('pointerup',this.up);
      b.addEventListener('pointercancel',this.cancel); b.addEventListener('lostpointercapture',()=>{if(this.drag?.target===b)this.cancel();});
      b.addEventListener('click',()=>this.options?.onSelect(i));
      b.addEventListener('contextmenu',e=>e.preventDefault());
      this.element.append(b); return b;
    });
    host.append(this.element); window.addEventListener('keydown',this.key,true); window.addEventListener('blur',this.cancel);
    window.addEventListener('pointerdown',this.secondary,true);
  }
  get dragging() {return !!this.drag;}
  update(source: ConstructionSource, options?: BuilderVertexOptions) {
    if (this.drag && (source.revision!==this.source.revision || options?.id!==this.options?.id || options?.unit!==this.options?.unit || options?.axis!==this.options?.axis || options?.snap!==this.options?.snap || options?.symmetry!==this.options?.symmetry || JSON.stringify(options?.axes)!==JSON.stringify(this.options?.axes))) this.cancel();
    this.source=source; this.options=options; this.frame();
  }
  private project(v: THREE.Vector3) {
    const p=v.clone().project(this.camera());
    return new THREE.Vector2((p.x+1)*this.host.clientWidth/2,(1-p.y)*this.host.clientHeight/2);
  }
  frame() {
    const o=this.options, p=this.drag?.replacements.find(p=>p.id===o?.id) ?? this.source?.construction.primitives.find(p=>p.id===o?.id);
    const visible=o&&p?editableCorners(o.symmetry,o.axes):[];
    this.buttons.forEach((b,i)=> {
      b.hidden=!visible.includes(i); if(b.hidden||!p||!o)return;
      const v=new THREE.Vector3(...worldVertex(p,cornerVertices(p)[i])); const projected=v.clone().project(this.camera());
      if(projected.z < -1 || projected.z > 1){b.hidden=true;return;}
      const pos=this.project(v); b.style.transform=`translate(${pos.x}px,${pos.y}px)`;
      b.setAttribute('aria-pressed',String((this.drag?.corner??o.corner)===i));
      b.title=`Corner ${i+1} · drag to shape · select for coordinates`;
    });
  }
  private ray(x:number,y:number) {
    const r=this.host.getBoundingClientRect(),ray=new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x-r.left)/r.width*2-1,-(y-r.top)/r.height*2+1),this.camera());return ray.ray;
  }
  private down(e:PointerEvent,corner:number) {
    if(e.button!==0||!this.options)return;
    const primitive=this.source.construction.primitives.find(p=>p.id===this.options!.id);if(!primitive)return;
    e.preventDefault();e.stopPropagation();const target=e.currentTarget as HTMLButtonElement;
    this.drag={pointer:e.pointerId,target,source:this.source,options:this.options,primitive,corner,x:e.clientX,y:e.clientY,
      anchor:new THREE.Vector3(...worldVertex(primitive,cornerVertices(primitive)[corner])),replacements:[]};
    target.setPointerCapture(e.pointerId);this.options.onSelect(corner);
  }
  private move=(e:PointerEvent)=> {
    const d=this.drag;if(!d||e.pointerId!==d.pointer)return;
    const dx=e.clientX-d.x,dy=e.clientY-d.y;if(!d.plane&&Math.hypot(dx,dy)<5)return;
    if(!d.plane){
      const direction=this.camera().getWorldDirection(new THREE.Vector3());
      const axes=[0,1,2].map(k=>new THREE.Vector3(...rotateVertex([k===0?1:0,k===1?1:0,k===2?1:0],d.primitive.rotationDeg)));
      let normal:THREE.Vector3;
      if(d.options.axis){
        const a=this.project(d.anchor),screen=axes.map(axis=>this.project(d.anchor.clone().add(axis)).sub(a));
        const longest=Math.max(...screen.map(v=>v.length()));
        const scores=screen.map(v=>v.length()<longest*.18?-1:Math.abs(v.dot(new THREE.Vector2(dx,dy)))/v.length());
        d.axis=scores.indexOf(Math.max(...scores));normal=direction.clone().addScaledVector(axes[d.axis],-direction.dot(axes[d.axis]));
      }else{
        const facing=axes.map(v=>Math.abs(v.dot(direction)));d.blocked=facing.indexOf(Math.max(...facing));normal=axes[d.blocked];
      }
      if(normal.lengthSq()<1e-8)return;
      d.plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal.normalize(),d.anchor);
      d.origin=this.ray(d.x,d.y).intersectPlane(d.plane,new THREE.Vector3())??d.anchor.clone();
    }
    const hit=this.ray(e.clientX,e.clientY).intersectPlane(d.plane,new THREE.Vector3());if(!hit)return;
    const local=rotateVertex(hit.sub(d.origin!).toArray() as Vec3,-d.primitive.rotationDeg);
    const delta=local.map((v,k)=>(d.axis===undefined?k!==d.blocked:k===d.axis)?Math.round(v/d.options.unit)*d.options.unit:0) as Vec3;
    d.replacements=vertexEdit(d.source,d.options.id,d.corner,delta,d.options.symmetry,d.options.axes,d.options.snap);
    this.preview(d.replacements);this.frame();
  };
  private up=(e:PointerEvent)=>{
    const d=this.drag;if(!d||e.pointerId!==d.pointer||e.button!==0)return;
    this.cancel();if(d.replacements.length)d.options.onCommit(d.replacements);
  };
  cancel=()=>{
    const d=this.drag;this.drag=undefined;
    if(d?.target.hasPointerCapture(d.pointer))d.target.releasePointerCapture(d.pointer);
    if(d)this.preview();this.frame();
  };
  private secondary=(e:PointerEvent)=>{if(e.button===2&&this.drag){e.preventDefault();e.stopImmediatePropagation();this.cancel();}};
  private key=(e:KeyboardEvent)=>{
    if(this.drag&&(e.key==='Escape'||((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'))){e.preventDefault();e.stopImmediatePropagation();this.cancel();}
  };
  dispose(){this.cancel();this.element.remove();window.removeEventListener('keydown',this.key,true);window.removeEventListener('blur',this.cancel);window.removeEventListener('pointerdown',this.secondary,true);}
}
