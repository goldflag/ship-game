import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { disposeObjects } from '../../game/disposeObjects';
import type { HitRow } from './afterAction';

interface Props {
  /** A fresh exterior this viewer owns and disposes. */
  load(): Promise<THREE.Object3D>;
  rows: readonly HitRow[];
  selected?: number;
  onSelect(n: number): void;
  label: string;
}

/** The side the ship took the most damage on, so the first view shows it. */
export function batteredSide(rows: readonly HitRow[]): 1 | -1 {
  return rows.reduce((sum, row) => sum + Math.sign(row.hit.position[0]) * (row.hit.damage + 1), 0) < 0 ? -1 : 1;
}

/** Whether a ship-local point faces the camera: hull sides face abeam, decks and upperworks face up. */
export function facesCamera(position: readonly number[], halfBeam: number, deckY: number, toCamera: { x: number; y: number; z: number }): boolean {
  const side = Math.abs(position[0]) / Math.max(halfBeam, 1), above = position[1] >= deckY - .5;
  const x = Math.sign(position[0]) * side, y = above ? 1 : .15;
  const length = Math.hypot(x, y) || 1;
  return (x * toCamera.x + y * toCamera.y) / length > -.12;
}

/** The ship's own model on a turntable, every hit pinned where it struck. The pins are
 * buttons laid over the canvas, so they keep their size and stay clickable at any zoom. */
export function HitModel({ load, rows, selected, onSelect, label }: Props) {
  const host = useRef<HTMLDivElement>(null), pins = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const live = useRef({ rows, place: () => {} });
  live.current.rows = rows;
  const loader = useRef(load);
  loader.current = load;
  const numbered = rows.length <= 40;

  useEffect(() => {
    const element = host.current!, layer = pins.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { setState('failed'); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    element.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#edf0f2', '#4c5357', 2.4));
    const sun = new THREE.DirectionalLight('#fff2d2', 2.8); sun.position.set(-80, 150, -120); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(24, 1, 1, 4000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false; controls.enableDamping = true; controls.dampingFactor = .12; controls.maxPolarAngle = Math.PI * .62; controls.minPolarAngle = .08;
    let model: THREE.Object3D | undefined, disposed = false, frame = 0, halfBeam = 10, deckY = 5;
    const point = new THREE.Vector3(), toCamera = new THREE.Vector3(), target = new THREE.Vector3();
    const place = () => {
      const { clientWidth: width, clientHeight: height } = element;
      toCamera.copy(camera.position).sub(target).normalize();
      const current = live.current.rows;
      for (const pin of layer.children as HTMLCollectionOf<HTMLElement>) {
        const row = current[Number(pin.dataset.index)];
        if (!row) continue;
        point.set(row.hit.position[0], row.hit.position[1], row.hit.position[2]).project(camera);
        pin.style.transform = `translate(${((point.x + 1) / 2 * width).toFixed(1)}px, ${((1 - point.y) / 2 * height).toFixed(1)}px)`;
        pin.dataset.behind = String(!facesCamera(row.hit.position, halfBeam, deckY, toCamera));
      }
    };
    live.current.place = place;
    const render = () => { frame = 0; if (disposed) return; if (controls.update()) schedule(); renderer.render(scene, camera); place(); };
    const schedule = () => { frame ||= requestAnimationFrame(render); };
    const resize = () => {
      const { clientWidth: width, clientHeight: height } = element;
      if (!width || !height) return;
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); schedule();
    };
    const observer = new ResizeObserver(resize); observer.observe(element);
    controls.addEventListener('change', schedule);
    loader.current().then(loaded => {
      if (disposed) { disposeObjects(loaded); return; }
      model = loaded; scene.add(loaded); loaded.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(loaded), size = box.getSize(new THREE.Vector3());
      box.getCenter(target); target.y = box.min.y + size.y * .3;
      halfBeam = size.x / 2; deckY = box.min.y + size.y * .42;
      const distance = size.z / 2 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(camera.aspect, .8)) * 1.4;
      // Off the bow quarter of the battered side, a little above the deck.
      camera.position.copy(target).add(new THREE.Vector3(batteredSide(live.current.rows) * .74, .42, -.52).normalize().multiplyScalar(distance));
      controls.target.copy(target); controls.minDistance = distance * .18; controls.maxDistance = distance * 1.6; controls.update();
      setState('ready'); resize(); schedule();
    }).catch(() => { if (!disposed) setState('failed'); });
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); controls.dispose();
      if (model) disposeObjects(model);
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    };
  }, []);
  useEffect(() => { live.current.place(); }, [rows, state]);

  return <div ref={host} className="aar-model" data-state={state} data-crowded={!numbered} role="group" aria-label={label}>
    <div ref={pins} className="aar-pins" hidden={state !== 'ready'}>
      {rows.map((row, index) => <button key={row.n} type="button" className="aar-pin" data-index={index} data-tone={row.tone} data-size={row.size} aria-pressed={row.n === selected}
        aria-label={`Hit ${row.n}: ${row.hit.weapon} from ${row.from}, ${row.outcome.toLowerCase()}, ${Math.round(row.hit.damage)} damage`} onClick={() => onSelect(row.n)}>
        <span>{numbered || row.size !== 's' || row.n === selected ? row.n : ''}</span>
      </button>)}
    </div>
    {state === 'loading' && <p className="aar-model-note" role="status">Raising the ship…</p>}
    {state === 'failed' && <p className="aar-model-note" role="status">The ship model is unavailable. Hits are listed on the timeline below.</p>}
  </div>;
}
