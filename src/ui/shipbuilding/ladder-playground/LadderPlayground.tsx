import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createConstructionModel, disposeConstructionModel } from '../../../game/constructionModel';
import { ConstructionClient } from '../../../ships/constructionClient';
import { loadConstructionCatalog } from '../../../ships/constructionEquipment';
import type { ConstructionResult, ConstructionSource } from '../../../ships/blueprint';
import { accessLayout, type Handrails } from '../../../../assets/parts/construction/access_geometry';
import { defaults, playgroundSource, type Settings, type Variant } from './source';
import './playground.css';

type View = 'Quarter' | 'Side' | 'Front' | 'Top';
type Display = { context: boolean; wireframe: boolean; anchors: boolean };
class Viewport {
  private renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, .01, 250);
  private controls = new OrbitControls(this.camera, this.renderer.domElement);
  private model?: THREE.Group;
  private markers = new THREE.Group();
  private environment: THREE.WebGLRenderTarget;
  private resize: ResizeObserver;
  private display: Display = { context: true, wireframe: false, anchors: false };
  private target = new THREE.Vector3(0, 1.9, .8);
  private size = 5;
  constructor(private host: HTMLDivElement) {
    const r = this.renderer;
    r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.domElement.setAttribute('aria-label', 'Ladder inspection. Drag to orbit, right-drag to pan, scroll to zoom.'); host.append(r.domElement);
    this.scene.background = new THREE.Color('#242c30');
    const room = new RoomEnvironment(), pmrem = new THREE.PMREMGenerator(r);
    this.environment = pmrem.fromScene(room, .04); this.scene.environment = this.environment.texture; this.scene.environmentIntensity = .55; room.dispose(); pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight('#eaf0ef', '#697a81', 1));
    const key = new THREE.DirectionalLight('#fff2dd', 3); key.position.set(4, 10, 8); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -12, right: 12, top: 15, bottom: -8, near: .1, far: 70 }); key.shadow.normalBias = .01;
    this.scene.add(key, key.target, this.markers);
    const rim = new THREE.DirectionalLight('#d8efff', 1.3); rim.position.set(-5, 5, -6); this.scene.add(rim);
    this.controls.enableDamping = true; this.controls.minDistance = .5; this.controls.maxDistance = 60;
    this.resize = new ResizeObserver(() => { const w=host.clientWidth,h=host.clientHeight; r.setSize(w,h); this.camera.aspect=w/h; this.camera.updateProjectionMatrix(); this.view('Quarter'); });
    this.resize.observe(host); this.view('Quarter');
    r.setAnimationLoop(() => { this.controls.update(); r.render(this.scene,this.camera); });
  }
  view(view: View) {
    const direction = { Quarter:[1,.55,1.4], Side:[1,.05,0], Front:[0,.03,1], Top:[0,1,.001] }[view];
    const distance = this.size / (2*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))) * Math.max(1.4,1.15/this.camera.aspect,1.15*this.host.clientHeight/Math.max(200,this.host.clientHeight-260));
    this.controls.target.copy(this.target); this.camera.position.copy(this.target).addScaledVector(new THREE.Vector3(...direction).normalize(),distance); this.controls.update();
  }
  show(model: THREE.Group, source: ConstructionSource, settings: Settings) {
    const first = !this.model;
    if (this.model) disposeConstructionModel(this.model);
    disposeConstructionModel(this.markers); this.markers = new THREE.Group(); this.scene.add(this.markers);
    this.model = model; this.scene.add(model);
    this.target.set(0,settings.rise/2+.4,settings.run/2-.3); this.size=Math.max(settings.rise+1,settings.run+2,settings.variant==='both'?4:2);
    for (const item of source.construction.equipment) {
      const kind = item.id === 'stairs' ? 'inclined-ladder' : 'framed-ladder';
      const layout = accessLayout(kind,item.path!.points,item.path!.access!);
      for (const anchor of layout?.anchors ?? []) {
        const marker=new THREE.Mesh(new THREE.SphereGeometry(.055,12,8),new THREE.MeshBasicMaterial({color:'#e0c58d',depthTest:false}));
        marker.position.fromArray(anchor).applyAxisAngle(new THREE.Vector3(0,1,0),-item.bearingDeg*Math.PI/180).add(new THREE.Vector3(...item.position)); marker.renderOrder=9; this.markers.add(marker);
      }
    }
    this.setDisplay(this.display); if(first) this.view('Quarter');
  }
  setDisplay(display: Display) {
    this.display=display; this.markers.visible=display.anchors;
    this.model?.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      if(node.name.startsWith('hull.')) node.visible=display.context;
      for(const material of Array.isArray(node.material)?node.material:[node.material]) if(material instanceof THREE.MeshStandardMaterial) material.wireframe=display.wireframe;
    });
  }
  dispose() {
    this.renderer.setAnimationLoop(null); this.resize.disconnect(); this.controls.dispose();
    if(this.model)disposeConstructionModel(this.model); disposeConstructionModel(this.markers);
    this.scene.traverse(n=>{if(n instanceof THREE.DirectionalLight)n.shadow.dispose();});
    this.environment.dispose();this.renderer.dispose();this.renderer.domElement.remove();
  }
}
const variants: { id: Variant; name: string }[] = [{id:'both',name:'Deck access'},{id:'stairs',name:'Inclined stairs'},{id:'framed',name:'Framed ladder'}];
function download(source: ConstructionSource) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(source,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='ladder-playground.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
/** Disposable inspection UI: do these two adjustable families cover deck access?
 * Uses the actual versioned source, native compiler and production renderer. */
export default function LadderPlayground() {
  const [settings,setSettings]=useState(()=>defaults(variants.find(v=>v.id===new URLSearchParams(location.search).get('variant'))?.id));
  const [preview,setPreview]=useState<{source:ConstructionSource;result:ConstructionResult}>();
  const [display,setDisplay]=useState<Display>({context:true,wireframe:false,anchors:false});
  const [busy,setBusy]=useState(true),[error,setError]=useState(''),[view,setView]=useState<View>('Quarter');
  const host=useRef<HTMLDivElement>(null),viewport=useRef<Viewport|undefined>(undefined),client=useRef<ConstructionClient|undefined>(undefined);
  useEffect(()=>{try {viewport.current=new Viewport(host.current!);}catch(e){setError(`3D view could not start: ${String(e)}`);}client.current=new ConstructionClient();return()=>{client.current?.dispose();viewport.current?.dispose();};},[]);
  useEffect(()=>{
    const abort=new AbortController();setBusy(true);setError('');
    const timer=setTimeout(()=>{void(async()=>{
      const catalog=await loadConstructionCatalog();if(abort.signal.aborted)return;
      const source=playgroundSource(catalog,settings),result=await client.current!.compile(source,abort.signal);
      const model=await createConstructionModel(source,result,abort.signal);
      if(abort.signal.aborted){disposeConstructionModel(model);return;}
      viewport.current?.show(model,source,settings);setPreview({source,result});setBusy(false);
    })().catch(e=>{if(!abort.signal.aborted){setError(e instanceof Error?e.message:String(e));setBusy(false);}});},100);
    return()=>{clearTimeout(timer);abort.abort();};
  },[settings]);
  useEffect(()=>{viewport.current?.setDisplay(display);},[display]);
  const choose=(variant:Variant)=>{setSettings(s=>({...s,variant}));const url=new URL(location.href);url.searchParams.set('variant',variant);history.replaceState(null,'',url);};
  const cycle=(delta:number)=>choose(variants[(variants.findIndex(v=>v.id===settings.variant)+delta+variants.length)%variants.length].id);
  useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.target as HTMLElement).closest('input,select,textarea,button,[contenteditable]'))return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();cycle(e.key==='ArrowLeft'?-1:1);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[settings.variant]);
  const errors=preview?.result.diagnostics.filter(d=>d.severity==='error')??[];
  const stairs=accessLayout('inclined-ladder',[[0,0,0],[0,settings.rise,-settings.run]],settings.stairs);
  const framed=accessLayout('framed-ladder',[[0,0,0],[0,settings.rise-.32,0]],settings.framed);
  const mass=preview?.result.loading?.contributions.filter(c=>c.id==='stairs'||c.id==='framed').reduce((sum,c)=>sum+c.massKg,0);
  const range=(label:string,value:number,min:number,max:number,step:number,onChange:(v:number)=>void)=><label className="ladder-range"><span>{label}<output>{value.toFixed(2)} m</output></span><input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}/></label>;
  const setAccess=(kind:'stairs'|'framed',key:'widthM'|'standOffM'|'grabHeightM',value:number)=>setSettings(s=>({...s,[kind]:{...s[kind],[key]:value}}));
  return <main className="ladder-playground">
    <div className="ladder-stage"><div ref={host} className="ladder-canvas"/>
      <header className="ladder-heading"><h1>Ladder workshop</h1><p>Adjustable deck access · drag to inspect</p></header>
      <nav className="ladder-views" aria-label="Camera view">{(['Quarter','Side','Front','Top'] as const).map(v=><button key={v} aria-pressed={view===v} onClick={()=>{setView(v);viewport.current?.view(v);}}>{v}</button>)}<button onClick={()=>viewport.current?.view(view)}>Fit view</button></nav>
      <p className={`ladder-status ${error||errors.length?'is-error':''}`} role="status">{error||(busy?'Checking attachments…':errors.length?errors[0].message:'Deck feet and wall brackets supported · clearances checked')}</p>
      <p className="ladder-orbit-help">Drag to orbit · right-drag to pan · scroll to zoom</p>
      <nav className="ladder-switcher" aria-label="Ladder installation"><button aria-label="Previous installation" onClick={()=>cycle(-1)}><svg viewBox="0 0 24 24"><path d="m14 6-6 6 6 6"/></svg></button><span>{variants.find(v=>v.id===settings.variant)!.name}<small>{variants.findIndex(v=>v.id===settings.variant)+1} / 3</small></span><button aria-label="Next installation" onClick={()=>cycle(1)}><svg viewBox="0 0 24 24"><path d="m10 6 6 6-6 6"/></svg></button></nav>
    </div>
    <aside className="ladder-panel" aria-label="Ladder controls">
      <label className="ladder-select">Installation<select aria-label="Installation" value={settings.variant} onChange={e=>choose(e.target.value as Variant)}>{variants.map(v=><option value={v.id} key={v.id}>{v.name}</option>)}</select></label>
      <p className="ladder-description">Change the deck height. Steps, rungs and brackets refit at their original section sizes.</p>
      <fieldset><legend>Decks</legend>{range('Deck rise',settings.rise,1,8,.1,v=>setSettings(s=>({...s,rise:v})))}{settings.variant!=='framed'&&range('Stair run',settings.run,.5,8,.1,v=>setSettings(s=>({...s,run:v})))}</fieldset>
      {settings.variant!=='framed'&&<fieldset><legend>Inclined stairs</legend>{range('Stair width',settings.stairs.widthM,.35,1.5,.05,v=>setAccess('stairs','widthM',v))}<label className="ladder-select">Handrails<select aria-label="Handrails" value={settings.stairs.handrails} onChange={e=>setSettings(s=>({...s,stairs:{...s.stairs,handrails:e.target.value as Handrails}}))}>{['both','left','right','none'].map(v=><option value={v} key={v}>{v==='both'?'Both sides':v==='none'?'None':`${v[0].toUpperCase()+v.slice(1)} side`}</option>)}</select></label><p className="ladder-inline-note">{stairs?`${stairs.count} level treads · ${(stairs.spacingM*1000).toFixed(0)} mm rise · ${stairs.angleDeg.toFixed(1)}°`:'Adjust rise or run for a 30–75° incline.'}</p></fieldset>}
      {settings.variant!=='stairs'&&<fieldset><legend>Framed rung ladder</legend>{range('Ladder width',settings.framed.widthM,.35,1.5,.05,v=>setAccess('framed','widthM',v))}{range('Wall standoff',settings.framed.standOffM,.12,.4,.01,v=>setAccess('framed','standOffM',v))}{range('Grab extension',settings.framed.grabHeightM,0,1.2,.05,v=>setAccess('framed','grabHeightM',v))}<p className="ladder-inline-note">{framed?`${framed.count} rungs · ${(framed.spacingM*1000).toFixed(0)} mm spacing`:'Increase the deck rise to fit the ladder.'}</p></fieldset>}
      <fieldset><legend>Inspect</legend>{([['context','Show decks and bulkhead'],['anchors','Highlight attachments'],['wireframe','Show mesh edges']] as const).map(([key,label])=><label className="ladder-check" key={key}><input type="checkbox" checked={display[key]} onChange={e=>setDisplay(s=>({...s,[key]:e.target.checked}))}/>{label}</label>)}</fieldset>
      <div className="ladder-readout"><span>Estimated fitting mass</span><strong>{busy?'…':mass===undefined?'—':`${mass.toFixed(0)} kg`}</strong></div><p className="ladder-footnote">Generic fittings with provisional steel loading. This is a fitting study, not a powered ship.</p>
      <div className="ladder-actions"><button onClick={()=>setSettings(defaults(settings.variant))}>Reset dimensions</button><button className="ladder-download" disabled={busy||!!error||!!errors.length||!preview} onClick={()=>preview&&download(preview.source)}>Download ship source</button></div>
      <p className="ladder-footnote">Changes stay here. Reload to start over.</p>
    </aside>
  </main>;
}
