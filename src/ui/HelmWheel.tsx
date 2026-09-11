import { useEffect, useMemo, useRef, useState } from 'react';
import type { Game } from '../game/Game';
import type { Telemetry } from '../game/types';
import { bindingLabel, type Keybindings } from '../game/keybindings';
import { shipPreset } from '../ships/presets';
import { KNOTS_PER_MPS } from '../simulation/ship';
import { SHIP_GLYPHS, shipClassOf } from './shipGlyphs';
import './HelmWheel.css';

/** The wheel is drawn in a 640 px square; nodes sit on a log range scale so a
 * destroyer 2 km off and a carrier 9 km back both fit inside the rose. */
export const WHEEL_SIZE = 640;
const HUB_RADIUS = 92, RIM_RADIUS = 282;
export const WHEEL_RINGS_KM = [1, 3, 6, 12] as const;
/** Formation neighbours sit half a kilometre to two apart, so the scale spends
 * most of the rose on the first few kilometres and compresses the rest. */
const rangeRadius = (km: number, maxKm: number) => HUB_RADIUS + (RIM_RADIUS - HUB_RADIUS) * Math.log(1 + km * 2) / Math.log(1 + maxKm * 2);
/** A node's footprint in wheel units: the name row and the readout under it. */
const NODE_W = 104, NODE_H = 60;
/** Ships on one bearing would stack; nudge overlapping nodes apart, mostly
 * sideways, and keep them inside the rim. Labels still carry the true figures. */
function spread(nodes: WheelNode[]): void {
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      let dx = b.x - a.x, dy = b.y - a.y;
      if (!dx && !dy) { dx = 1; }
      const d = Math.hypot(dx / NODE_W, dy / NODE_H);
      if (d >= 1) continue;
      const push = (1 - d) / Math.max(d, 1e-6) / 2;
      a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push;
      moved = true;
    }
    for (const n of nodes) {
      const cx = n.x - WHEEL_SIZE / 2, cy = n.y - WHEEL_SIZE / 2, r = Math.hypot(cx, cy);
      if (r > RIM_RADIUS) { n.x = WHEEL_SIZE / 2 + cx * RIM_RADIUS / r; n.y = WHEEL_SIZE / 2 + cy * RIM_RADIUS / r; }
    }
    if (!moved) break;
  }
}

export interface WheelNode { id: string; name: string; shipClass: keyof typeof SHIP_GLYPHS; x: number; y: number; bearing: number; km: number; kn: number; integrity: number; status: string; key: number }

/** Every friendly afloat hull except the centre one, numbered clockwise from north. */
export function wheelNodes(data: Telemetry): WheelNode[] {
  const contacts = data.combat?.contacts ?? [];
  const centre = { x: data.ship.x, z: data.ship.z };
  const others = contacts.filter(c => c.team === 'friendly' && !c.physicalLost && c.id !== data.ship.id).map(c => {
    const dx = c.x - centre.x, dz = c.z - centre.z;
    const km = Math.hypot(dx, dz) / 1000;
    // Chart convention: north is −z, east is +x; bearings run clockwise from north.
    const bearing = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
    return { c, km, bearing };
  }).sort((a, b) => a.bearing - b.bearing || a.km - b.km);
  const maxKm = Math.max(WHEEL_RINGS_KM.at(-1)!, ...others.map(o => o.km));
  const nodes = others.map(({ c, km, bearing }, index) => {
    const r = rangeRadius(km, maxKm), a = (bearing - 90) * Math.PI / 180;
    return { id: c.id, name: c.name, shipClass: shipClassOf(shipPreset(c.shipId)), x: WHEEL_SIZE / 2 + Math.cos(a) * r, y: WHEEL_SIZE / 2 + Math.sin(a) * r,
      bearing, km, kn: Math.abs(c.speed * KNOTS_PER_MPS), integrity: c.integrity, status: c.status, key: index + 1 };
  });
  spread(nodes);
  return nodes;
}

/** The node nearest the pointer, once the pointer has left the hub. */
export function nearestNode(nodes: readonly WheelNode[], px: number, py: number): WheelNode | undefined {
  const cx = px - WHEEL_SIZE / 2, cy = py - WHEEL_SIZE / 2;
  if (Math.hypot(cx, cy) < HUB_RADIUS * .55) return undefined;
  let best: WheelNode | undefined, bestD = Infinity;
  for (const node of nodes) { const d = Math.hypot(node.x - px, node.y - py); if (d < bestD) { best = node; bestD = d; } }
  return best;
}

export function HelmWheel({ data, game, bindings }: { data: Telemetry; game: Game | null; bindings: Keybindings }) {
  const wheel = data.helmWheel;
  const nodes = useMemo(() => wheelNodes(data), [data]);
  const maxKm = Math.max(WHEEL_RINGS_KM.at(-1)!, ...nodes.map(n => n.km));
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = useRef({ nodes, wheel, game }); current.current = { nodes, wheel, game };
  const highlight = wheel?.highlightId;
  useEffect(() => {
    if (!wheel) return;
    // A captured mouse moves the pick point from the hub; a free cursor is the pick point itself.
    let vx = 0, vy = 0;
    const move = (event: PointerEvent) => {
      const root = rootRef.current; if (!root) return;
      const rect = root.getBoundingClientRect(), scale = rect.width / WHEEL_SIZE;
      if (document.pointerLockElement) {
        vx += event.movementX / scale; vy += event.movementY / scale;
        const len = Math.hypot(vx, vy); if (len > RIM_RADIUS) { vx *= RIM_RADIUS / len; vy *= RIM_RADIUS / len; }
        setPointer({ x: WHEEL_SIZE / 2 + vx, y: WHEEL_SIZE / 2 + vy });
      } else setPointer({ x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale });
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !document.pointerLockElement) return;
      const id = current.current.wheel?.highlightId;
      if (id) { event.preventDefault(); event.stopImmediatePropagation(); current.current.game?.takeHelm(id); }
    };
    const key = (event: KeyboardEvent) => {
      if (document.querySelector('dialog[open]') || event.altKey || event.metaKey || event.ctrlKey) return;
      const digit = /^Digit[1-9]$/.test(event.code) ? Number(event.code.at(-1)) : 0;
      const arrow = event.code === 'ArrowRight' ? 1 : event.code === 'ArrowLeft' ? -1 : 0;
      const handled = digit || arrow || event.code === 'Escape' || event.code === 'Enter';
      if (!handled) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.repeat) return;
      const { nodes, wheel, game } = current.current;
      if (event.code === 'Escape') { game?.closeHelmWheel(); return; }
      if (digit) { const node = nodes.find(n => n.key === digit); if (node) game?.takeHelm(node.id); return; }
      if (event.code === 'Enter') { if (wheel?.highlightId) game?.takeHelm(wheel.highlightId); return; }
      const index = nodes.findIndex(n => n.id === wheel?.highlightId);
      const next = nodes[(index + arrow + nodes.length) % nodes.length];
      if (next) { setPointer({ x: next.x, y: next.y }); game?.highlightHelmCandidate(next.id); }
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); setPointer(null); };
  }, [wheel?.reason]);
  useEffect(() => {
    if (!wheel || !pointer) return;
    game?.highlightHelmCandidate(nearestNode(nodes, pointer.x, pointer.y)?.id);
  }, [pointer, nodes, wheel?.reason]);
  if (!wheel || !game) return null;
  const sunk = wheel.reason === 'sunk';
  const centreName = data.shipDefinition?.name ?? data.ship.id;
  const holdKey = bindingLabel(bindings, 'helmWheel');
  const rings = WHEEL_RINGS_KM.filter(km => km <= maxKm);
  const ray = pointer && nearestNode(nodes, pointer.x, pointer.y) ? pointer : null;
  return <div ref={rootRef} className={`helm-wheel ${sunk ? 'helm-wheel-sunk' : ''}`} role="dialog" aria-label="Choose a ship to command" aria-modal="false">
    <svg viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`} aria-hidden="true">
      <circle cx={WHEEL_SIZE / 2} cy={WHEEL_SIZE / 2} r={RIM_RADIUS + 18} className="helm-wheel-glass"/>
      {rings.map(km => <g key={km}><circle cx={WHEEL_SIZE / 2} cy={WHEEL_SIZE / 2} r={rangeRadius(km, maxKm)} className="helm-wheel-ring"/><text x={WHEEL_SIZE / 2 + 4} y={WHEEL_SIZE / 2 - rangeRadius(km, maxKm) + 11}>{km} km</text></g>)}
      {['N', 'E', 'S', 'W'].map((c, i) => { const a = (i * 90 - 90) * Math.PI / 180, r = RIM_RADIUS + 18; return <g key={c}>
        <path d={`M${WHEEL_SIZE / 2 + Math.cos(a) * HUB_RADIUS} ${WHEEL_SIZE / 2 + Math.sin(a) * HUB_RADIUS}L${WHEEL_SIZE / 2 + Math.cos(a) * r} ${WHEEL_SIZE / 2 + Math.sin(a) * r}`} className="helm-wheel-spoke"/>
        <text className="helm-wheel-cardinal" x={WHEEL_SIZE / 2 + Math.cos(a) * (r + 12)} y={WHEEL_SIZE / 2 + Math.sin(a) * (r + 12) + 4} textAnchor="middle">{c}</text></g>; })}
      {ray && <path d={`M${WHEEL_SIZE / 2} ${WHEEL_SIZE / 2}L${ray.x} ${ray.y}`} className="helm-wheel-ray"/>}
    </svg>
    <div className={`helm-wheel-centre ${sunk ? 'lost' : ''}`}>
      <b>{centreName}</b>
      <small>{sunk ? 'Sinking · choose a ship' : data.controlledShipId === data.ship.id || !data.fleetCommandMode ? 'At the helm' : 'Following · captain in command'}</small>
    </div>
    {nodes.map(node => {
      const glyph = SHIP_GLYPHS[node.shipClass];
      const hp = Math.round(node.integrity * 100);
      const on = node.id === highlight;
      return <button key={node.id} type="button" className={`helm-wheel-node ${on ? 'on' : ''} ${node.integrity < .45 ? 'critical' : node.integrity < .75 ? 'worn' : ''}`} style={{ left: `${node.x / WHEEL_SIZE * 100}%`, top: `${node.y / WHEEL_SIZE * 100}%` }}
        aria-label={`Take the helm of ${node.name} · ${hp} percent hull · ${node.km.toFixed(1)} km bearing ${String(Math.round(node.bearing)).padStart(3, '0')} · key ${node.key}`} aria-pressed={on}
        onPointerEnter={() => game.highlightHelmCandidate(node.id)} onClick={event => { event.preventDefault(); game.takeHelm(node.id); }}>
        <svg viewBox="-13 -13 26 26" aria-hidden="true"><path d={glyph.hull} className="hull"/><path d={glyph.mark} className="mark"/></svg>
        <b>{node.name}<kbd>{node.key}</kbd></b>
        <i><span style={{ width: `${hp}%` }}/></i>
        <small>{hp}% · {node.kn.toFixed(0)} kn · {node.km.toFixed(1)} km{node.status !== 'operational' ? ` · ${node.status.replaceAll('-', ' ')}` : ''}</small>
      </button>;
    })}
    <p className="helm-wheel-hint" role="status">{sunk
      ? <>Click a ship or press <kbd>1</kbd>–<kbd>{Math.min(9, nodes.length)}</kbd> to take its helm · <kbd>Esc</kbd> keeps watching</>
      : <>Move toward a ship and release <kbd>{holdKey}</kbd> to take its helm · <kbd>1</kbd>–<kbd>{Math.min(9, nodes.length)}</kbd> pick · ships sit at true bearing and range</>}</p>
  </div>;
}
