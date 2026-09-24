import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { disposeObjects } from '../../game/disposeObjects';
import { whole, type HitRow } from './afterAction';
import './ShipDrawing.css';

type View = 'profile' | 'plan';
/** The drawing's frame in ship metres: bow toward `-z`, starboard `+x`, up `+y`. */
export interface DrawingFrame { bow: number; stern: number; top: number; bottom: number; halfBeam: number }
interface Props {
  /** A fresh exterior this drawing owns and disposes once drawn. */
  load(): Promise<THREE.Object3D>;
  rows: readonly HitRow[];
  /** All damage the ship took, for the heavy-hit threshold. */
  taken: number;
  views?: readonly View[];
  /** Damage along the hull under the drawing. */
  strip?: boolean;
  onSelect?(n: number): void;
  label: string;
}

const PAD = 3;
/** Where a ship-local point falls on a view, as fractions of its width and height. Profile is seen from starboard with
 * the bow to the right; plan from above with the bow to the right and starboard below. */
export function drawingPoint(frame: DrawingFrame, view: View, [x, y, z]: readonly number[]): [number, number] {
  const across = (-z - -frame.stern) / (frame.stern - frame.bow);
  return [across, view === 'profile' ? (frame.top - y) / (frame.top - frame.bottom) : (frame.halfBeam + x) / (2 * frame.halfBeam)];
}
/** Damage in equal lengths of hull, bow last. */
export function hullBins(frame: DrawingFrame, rows: readonly HitRow[], bins = 24): number[] {
  const sums = new Array<number>(bins).fill(0);
  for (const row of rows) {
    const [across] = drawingPoint(frame, 'profile', row.hit.position);
    sums[Math.min(bins - 1, Math.max(0, Math.floor(across * bins)))] += row.hit.damage;
  }
  return sums;
}
const aspect = (frame: DrawingFrame, view: View) => (frame.stern - frame.bow) / (view === 'profile' ? frame.top - frame.bottom : 2 * frame.halfBeam);

/** The ship's own model drawn flat, in profile and plan, every hit marked where it struck. A hit worth 3% of the damage
 * taken is drawn large and can be picked; the rest are dots. The model is rendered once to images and let go. */
export function ShipDrawing({ load, rows, taken, views = ['profile', 'plan'], strip = false, onSelect, label }: Props) {
  const host = useRef<HTMLElement>(null);
  const loader = useRef(load);
  loader.current = load;
  const [drawn, setDrawn] = useState<{ frame: DrawingFrame; images: Partial<Record<View, string>> } | 'failed'>();

  useEffect(() => {
    let disposed = false;
    loader.current().then(model => {
      if (disposed) { disposeObjects(model); return; }
      let renderer: THREE.WebGLRenderer;
      try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); }
      catch { disposeObjects(model); setDrawn('failed'); return; }
      renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene();
      scene.add(model, new THREE.HemisphereLight('#eef2f4', '#3b4448', 2.6));
      const sun = new THREE.DirectionalLight('#fff4dc', 2.4); sun.position.set(60, 140, -40); scene.add(sun);
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const frame: DrawingFrame = { bow: box.min.z - PAD, stern: box.max.z + PAD, top: box.max.y + PAD, bottom: box.min.y - PAD,
        halfBeam: Math.max(-box.min.x, box.max.x) + PAD };
      const width = Math.min(2400, Math.round((host.current?.clientWidth || 1000) * Math.min(devicePixelRatio, 2)));
      const images: Partial<Record<View, string>> = {};
      for (const view of views) {
        renderer.setSize(width, Math.round(width / aspect(frame, view)), false);
        // Screen right is the bow (-z) in both views.
        const camera = view === 'profile'
          ? new THREE.OrthographicCamera(-frame.stern, -frame.bow, frame.top, frame.bottom, 1, 4000)
          : new THREE.OrthographicCamera(-frame.stern, -frame.bow, frame.halfBeam, -frame.halfBeam, 1, 4000);
        if (view === 'profile') camera.position.set(1000, 0, 0); else { camera.position.set(0, 1000, 0); camera.up.set(-1, 0, 0); }
        camera.lookAt(0, 0, 0); camera.updateProjectionMatrix();
        renderer.render(scene, camera);
        images[view] = renderer.domElement.toDataURL('image/png');
      }
      renderer.dispose(); renderer.forceContextLoss(); disposeObjects(model);
      setDrawn({ frame, images });
    }).catch(() => { if (!disposed) setDrawn('failed'); });
    return () => { disposed = true; };
  }, []);

  const heavy = (row: HitRow) => row.hit.damage / Math.max(taken, 1) >= .03;
  const ordered = [...rows].sort((a, b) => a.hit.damage - b.hit.damage);
  const frame = drawn && drawn !== 'failed' ? drawn.frame : undefined;
  const bins = frame && strip ? hullBins(frame, rows) : undefined;
  const peak = bins ? Math.max(...bins, 1) : 1;
  return <figure ref={host} className="aar-drawing" data-state={!drawn ? 'loading' : drawn === 'failed' ? 'failed' : 'ready'} aria-label={label}>
    {frame ? views.map(view => <div key={view} className="aar-drawing-view" data-view={view} style={{ aspectRatio: String(aspect(frame, view)) }}>
      <img src={(drawn as { images: Record<View, string> }).images[view]} alt="" />
      {ordered.map(row => {
        const [left, top] = drawingPoint(frame, view, row.hit.position);
        const style = { left: `${(left * 100).toFixed(2)}%`, top: `${(top * 100).toFixed(2)}%` };
        const far = view === 'profile' && row.hit.position[0] < 0 || undefined;
        const title = `${row.time} · ${row.hit.weapon} from ${row.from} · ${row.outcome} · ${whole(row.hit.damage)} damage`;
        return heavy(row) && onSelect
          ? <button key={row.n} type="button" className="aar-dot" data-tone={row.tone} data-heavy={row.size} data-far={far} style={style} title={title}
            aria-label={`Hit ${row.n}: ${title}`} onClick={() => onSelect(row.n)} />
          : <i key={row.n} className="aar-dot" data-tone={row.tone} data-heavy={heavy(row) ? row.size : undefined} data-far={far} style={style} title={title} />;
      })}
    </div>) : <p className="aar-drawing-note" role="status">{drawn === 'failed' ? 'The drawing is unavailable.' : 'Drawing the ship…'}</p>}
    {bins && <div className="aar-strip" role="img" aria-label="Damage along the hull, stern to bow">
      {bins.map((value, index) => <i key={index} style={{ height: `${Math.max(1.5, value / peak * 100)}%`, opacity: .35 + .65 * value / peak }} title={`${whole(value)} damage`} />)}
    </div>}
    {frame && <figcaption><span>Stern</span>
      <span>{[views.includes('profile') && 'Profile from starboard, port-side hits faint', views.includes('plan') && 'plan from above', strip && 'damage along the hull'].filter(Boolean).join(' · ')}</span>
      <span>Bow</span></figcaption>}
  </figure>;
}
