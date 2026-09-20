import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createConstructionModel, disposeConstructionModel } from '../../../game/constructionModel';
import { ConstructionClient } from '../../../ships/constructionClient';
import { loadConstructionCatalog } from '../../../ships/constructionEquipment';
import type { ConstructionResult, ConstructionSource } from '../../../ships/blueprint';
import { defaults, installations, playgroundSource, type Installation, type Settings } from './source';
import './playground.css';

type View = 'Quarter' | 'Side' | 'Stern' | 'Underneath';
type Preview = { source: ConstructionSource; result: ConstructionResult };
type Display = { cutaway: boolean; spin: boolean; wireframe: boolean };
class Viewport {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.05, 500);
  private controls = new OrbitControls(this.camera, this.renderer.domElement);
  private model?: THREE.Group;
  private environment: THREE.WebGLRenderTarget;
  private resize: ResizeObserver;
  private display: Display = { cutaway: true, spin: false, wireframe: false };
  private small = false;
  private phase = 0;
  private bounds?: THREE.Box3;
  private currentView: View = 'Quarter';
  private previousTime = 0;
  private joints: { node: THREE.Object3D; rest: THREE.Quaternion; sign: number }[] = [];
  constructor(private host: HTMLDivElement) {
    const renderer = this.renderer;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.localClippingEnabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.setAttribute('aria-label', 'Interactive propeller installation. Drag to orbit, right-drag to pan, scroll to zoom.');
    host.append(renderer.domElement);
    this.scene.background = new THREE.Color('#242a2d');
    const room = new RoomEnvironment(),
      pmrem = new THREE.PMREMGenerator(renderer);
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.45;
    room.dispose();
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight('#eaf0ef', '#7c8886', 0.8));
    const key = new THREE.DirectionalLight('#fff1d7', 2.2);
    key.position.set(10, -12, 32);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 0.1, far: 140 });
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.08;
    key.target.position.set(0, -3, 20);
    this.scene.add(key, key.target);
    const rim = new THREE.DirectionalLight('#cde4f1', 0.7);
    rim.position.set(-15, 6, 5);
    this.scene.add(rim);
    this.controls.enableDamping = true;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 180;
    this.resize = new ResizeObserver(() => {
      const width = host.clientWidth,
        height = host.clientHeight;
      renderer.setSize(width, height);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.view(this.currentView);
    });
    this.resize.observe(host);
    this.view('Quarter');
    renderer.setAnimationLoop((time) => {
      const dt = Math.min((time - this.previousTime) / 1000, 0.05);
      this.previousTime = time;
      if (this.display.spin) this.phase += dt * 1.8;
      for (const { node, rest, sign } of this.joints)
        node.quaternion.copy(rest).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.phase * sign));
      this.controls.update();
      renderer.render(this.scene, this.camera);
    });
  }
  view(view: View) {
    this.currentView = view;
    const target = this.bounds?.getCenter(new THREE.Vector3()) ?? new THREE.Vector3(0, -3.7, 22);
    const directions: Record<View, number[]> = {
      Quarter: [1, -0.35, 0.8],
      Side: [1, -0.04, 0],
      Stern: [0, -0.1, 1],
      Underneath: [0, -1, 0.08],
    };
    const direction = new THREE.Vector3(...directions[view]).normalize();
    this.camera.up.set(0, 1, 0);
    this.camera.position.copy(target).add(direction);
    this.camera.lookAt(target);
    const rotation = this.camera.quaternion.clone().invert();
    const projected = new THREE.Box3();
    if (this.bounds)
      for (const x of [this.bounds.min.x, this.bounds.max.x])
        for (const y of [this.bounds.min.y, this.bounds.max.y])
          for (const z of [this.bounds.min.z, this.bounds.max.z])
            projected.expandByPoint(new THREE.Vector3(x, y, z).sub(target).applyQuaternion(rotation));
    const size = this.bounds ? projected.getSize(new THREE.Vector3()) : new THREE.Vector3(16, 8, 18);
    const tangent = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const safeHeight = Math.max(0.48, (this.host.clientHeight - 280) / this.host.clientHeight);
    const distance = Math.max(size.y / (2 * tangent * safeHeight), size.x / (2 * tangent * this.camera.aspect * 0.84)) + size.z / 2;
    this.controls.target.copy(target);
    this.camera.position.copy(target).addScaledVector(direction, distance);
    this.controls.update();
  }
  show(model: THREE.Group, small: boolean) {
    if (this.model) disposeConstructionModel(this.model);
    const changedScale = small !== this.small;
    this.small = small;
    this.model = model;
    this.scene.add(model);
    this.joints = [];
    model.traverse((node) => {
      if (node.userData.nodeId?.endsWith('.spin'))
        this.joints.push({ node, rest: node.quaternion.clone(), sign: node.userData.nodeId.startsWith('port') ? -1 : 1 });
    });
    this.bounds = new THREE.Box3();
    model.updateMatrixWorld(true);
    for (const node of model.children) if (!node.name.startsWith('hull.')) this.bounds.expandByObject(node);
    if (changedScale || !this.previousTime) this.view('Quarter');
    else this.view(this.currentView);
    this.setDisplay(this.display);
  }
  setDisplay(display: Display) {
    this.display = display;
    this.model?.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const hull = node.name.startsWith('hull.');
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        material.clippingPlanes =
          hull && display.cutaway
            ? [new THREE.Plane(new THREE.Vector3(0, 0, 1), this.small ? -6 : -8), new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)]
            : [];
        if (material instanceof THREE.MeshStandardMaterial) material.wireframe = display.wireframe;
      }
    });
  }
  dispose() {
    this.renderer.setAnimationLoop(null);
    this.resize.disconnect();
    this.controls.dispose();
    if (this.model) disposeConstructionModel(this.model);
    this.scene.traverse((n) => {
      if (n instanceof THREE.DirectionalLight) n.shadow.dispose();
    });
    this.environment.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
function download(source: ConstructionSource) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(source, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'propeller-playground.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const initial = () => {
  const variant = new URLSearchParams(location.search).get('variant');
  return defaults(installations.find((_, i) => variant === String(i + 1)) ?? installations[0]);
};

/** Development-only, disposable inspection UI around the real custom-ship pipeline. */
export default function PropellerPlayground() {
  const [settings, setSettings] = useState(initial),
    [preview, setPreview] = useState<Preview>();
  const [display, setDisplay] = useState<Display>({ cutaway: true, spin: false, wireframe: false });
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [view, setView] = useState<View>('Quarter');
  const host = useRef<HTMLDivElement>(null),
    viewport = useRef<Viewport | undefined>(undefined),
    client = useRef<ConstructionClient | undefined>(undefined);
  useEffect(() => {
    try {
      viewport.current = new Viewport(host.current!);
    } catch (e) {
      setError(`The 3D view could not start: ${e instanceof Error ? e.message : e}`);
    }
    client.current = new ConstructionClient();
    return () => {
      client.current?.dispose();
      viewport.current?.dispose();
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setBusy(true);
    setError('');
    const timer = setTimeout(() => {
      void (async () => {
        const catalog = await loadConstructionCatalog();
        if (abort.signal.aborted) return;
        const source = playgroundSource(catalog, settings),
          result = await client.current!.compile(source, abort.signal);
        const model = await createConstructionModel(source, result, abort.signal);
        if (abort.signal.aborted) {
          disposeConstructionModel(model);
          return;
        }
        viewport.current?.show(model, settings.installation === 'Compact screw');
        setPreview({ source, result });
        setBusy(false);
      })().catch((e) => {
        if (!abort.signal.aborted) {
          setError(e instanceof Error ? e.message : String(e));
          setBusy(false);
        }
      });
    }, 180);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [settings]);
  useEffect(() => {
    viewport.current?.setDisplay(display);
  }, [display]);
  const choose = (installation: Installation) => {
    setSettings(defaults(installation));
    setView('Quarter');
    viewport.current?.view('Quarter');
    const url = new URL(location.href);
    url.searchParams.set('variant', String(installations.indexOf(installation) + 1));
    history.replaceState(null, '', url);
  };
  const cycle = (step: number) =>
    choose(installations[(installations.indexOf(settings.installation) + step + installations.length) % installations.length]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea, [contenteditable]')) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        cycle(e.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [settings.installation]);
  const errors = preview?.result.diagnostics.filter((d) => d.severity === 'error') ?? [];
  const small = settings.installation === 'Compact screw';
  const members = preview?.result.propellerSupports?.flatMap((s) => s.members) ?? [];
  const mass = preview?.result.loading?.contributions.filter((c) => c.id.endsWith('-support')).reduce((sum, c) => sum + c.massKg, 0) ?? 0;
  return (
    <main className="propeller-playground">
      <div className="propeller-stage">
        <div ref={host} className="propeller-canvas" />
        <header className="propeller-heading">
          <h1>Propeller workshop</h1>
          <p>Custom ship supports · interactive playground</p>
        </header>
        <nav className="propeller-views" aria-label="Camera view">
          {(['Quarter', 'Side', 'Stern', 'Underneath'] as const).map((v) => (
            <button
              key={v}
              aria-pressed={view === v}
              onClick={() => {
                setView(v);
                viewport.current?.view(v);
              }}
            >
              {v}
            </button>
          ))}
          <button onClick={() => viewport.current?.view(view)}>Fit view</button>
        </nav>
        <p className={`propeller-status ${errors.length || error ? 'is-error' : ''}`} role="status">
          {error || (busy ? 'Fitting supports…' : errors.length ? errors[0].message : 'Hull connections and clearances checked')}
        </p>
        <p className="propeller-orbit-help">Drag to orbit · right-drag to pan · scroll to zoom</p>
        <nav className="propeller-switcher" aria-label="Playground installation">
          <button aria-label="Previous installation" onClick={() => cycle(-1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m14 6-6 6 6 6" />
            </svg>
          </button>
          <span>
            {settings.installation}
            <small>{installations.indexOf(settings.installation) + 1} / 3</small>
          </span>
          <button aria-label="Next installation" onClick={() => cycle(1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m10 6 6 6-6 6" />
            </svg>
          </button>
        </nav>
      </div>
      <aside className="propeller-panel" aria-label="Installation controls">
        <label className="propeller-select">
          Installation
          <select value={settings.installation} onChange={(e) => choose(e.target.value as Installation)}>
            {installations.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <p className="propeller-description">
          Move the screws. Shafts, bearing housings, support fins and hull fairings refit automatically.
        </p>
        <fieldset>
          <legend>Placement</legend>
          {(
            [
              ['spacing', small ? 'Side offset' : 'Outer shaft offset', small ? -1 : 2.5, small ? 1 : 8, 0.1, 'm'],
              ['depth', 'Depth below origin', small ? 1 : 3, small ? 3 : 7, 0.1, 'm'],
              ['aft', 'Aft position', small ? 10 : 20, small ? 17 : 33, 0.1, 'm'],
              ['bearing', 'Shaft bearing', -12, 12, 1, '°'],
            ] as const
          ).map(([key, label, min, max, step, unit]) => (
            <label className="propeller-range" key={key}>
              <span>
                {label}
                <output>
                  {settings[key].toFixed(key === 'bearing' ? 0 : 1)} {unit}
                </output>
              </span>
              <input
                type="range"
                aria-label={label}
                min={min}
                max={max}
                step={step}
                value={settings[key]}
                onChange={(e) => setSettings((s) => ({ ...s, [key]: Number(e.target.value) }))}
              />
            </label>
          ))}
          <button className="propeller-reset" onClick={() => setSettings(defaults(settings.installation))}>
            Reset placement
          </button>
        </fieldset>
        <fieldset>
          <legend>Inspect</legend>
          {(
            [
              ['cutaway', 'Underwater stern only'],
              ['spin', 'Rotate propellers'],
              ['wireframe', 'Show mesh edges'],
            ] as const
          ).map(([key, label]) => (
            <label className="propeller-check" key={key}>
              <input type="checkbox" checked={display[key]} onChange={(e) => setDisplay((d) => ({ ...d, [key]: e.target.checked }))} />
              {label}
            </label>
          ))}
        </fieldset>
        <section className="propeller-readout" aria-label="Compiled installation">
          <h2>Fitted supports</h2>
          <dl>
            <div>
              <dt>Shafts</dt>
              <dd>{busy ? '…' : members.filter((m) => m.kind === 'shaft').length}</dd>
            </div>
            <div>
              <dt>Support fins</dt>
              <dd>{busy ? '…' : members.filter((m) => m.kind === 'strut').length}</dd>
            </div>
            <div>
              <dt>Hull fairings</dt>
              <dd>{busy ? '…' : members.filter((m) => m.kind === 'fairing').length}</dd>
            </div>
            <div>
              <dt>Support mass</dt>
              <dd>{busy ? '…' : `${(mass / 1000).toFixed(2)} t`}</dd>
            </div>
          </dl>
          <p>Mass uses the editor’s provisional solid-steel estimate. These inspection layouts have no engines.</p>
        </section>
        <button
          className="propeller-download"
          disabled={!preview || busy || !!errors.length || !!error}
          onClick={() => preview && download(preview.source)}
        >
          Download custom-ship source
        </button>
        <p className="propeller-footnote">Changes stay in this playground. Reload to start over.</p>
      </aside>
    </main>
  );
}
