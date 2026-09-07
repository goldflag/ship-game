import { useRef, useState } from 'react';
import { coastOutline, DEFAULT_MAP, mapIslands } from '../maps/catalog';
import { shipPresets } from '../ships/presets';
import { botSelection, setupSpawns, validateSpawns, type BattleSetup, type SpawnFormation } from '../simulation/battle';

/** Naval plotting chart: numbered fleet slots, shared CPU coordinates and explicit placement. */
export function SpawnPlanner({ setup, onChange }: { setup: BattleSetup; onChange(setup: BattleSetup): void }) {
  const [selection, setSelection] = useState('friendly:0');
  const [notice, setNotice] = useState('');
  const chart = useRef<HTMLDivElement>(null);
  const dragging = useRef<string | null>(null);
  const dragRadius = useRef<number | null>(null);
  const spawns = setupSpawns(setup);
  const islands = mapIslands(setup.mapId ?? DEFAULT_MAP, setup.spawnDistance, Math.max(spawns.friendly.length, spawns.enemy.length));
  const slots = (['friendly', 'enemy'] as const).flatMap(team => spawns[team].map((pose, index) => {
    const id = team === 'friendly' && index === 0 ? setup.playerShipId : botSelection(team === 'friendly' ? setup.friendlyBots[index - 1] : setup.enemies[index]).shipId;
    return { team, index, pose, key: `${team}:${index}`, label: `${team === 'friendly' ? 'F' : 'E'}${index + 1}`, name: `${Object.values(shipPresets).find(ship => ship.id === id)?.name ?? id}${team === 'friendly' && index === 0 ? ' · You' : ''}` };
  }));
  const selected = slots.find(slot => slot.key === selection) ?? slots[0];
  // Stable while dragging; enough sea for every preset, including thirty-ship columns.
  const centerZ = -setup.spawnDistance / 2;
  const radius = dragRadius.current ?? Math.max(4000, ...slots.map(slot => Math.max(Math.abs(slot.pose.x), Math.abs(slot.pose.z - centerZ)) + 1500));
  const px = (x: number) => (x / radius + 1) * 50;
  const py = (z: number) => ((z - centerZ) / radius + 1) * 50;
  function move(key: string, x: number, z: number, heading?: number) {
    const slot = slots.find(item => item.key === key);
    if (!slot) return;
    const next = { friendly: [...spawns.friendly], enemy: [...spawns.enemy] };
    next[slot.team][slot.index] = { x: Math.round(x / 50) * 50, z: Math.round(z / 50) * 50, heading: heading ?? slot.pose.heading };
    try {
      validateSpawns(next, spawns.friendly.length, spawns.enemy.length, islands);
      onChange({ ...setup, spawns: next }); setNotice('');
    } catch (error) { setNotice((error as Error).message); }
  }
  function place(key: string, clientX: number, clientY: number) {
    const rect = chart.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    move(key, (x * 2 - 1) * radius, (y * 2 - 1) * radius + centerZ);
  }
  return <section className="spawn-planner" aria-labelledby="spawn-title">
    <div className="spawn-heading"><h3 id="spawn-title">Deployment chart</h3><span>North up · {(radius * 2 / 1000).toFixed(1)} km across</span></div>
    <div className="spawn-controls">
      <label>Formation<select value={setup.spawns ? 'custom' : setup.formation ?? 'line'} onChange={event => { onChange({ ...setup, formation: event.target.value as SpawnFormation, spawns: undefined }); setNotice(''); }}>
        {setup.spawns && <option value="custom" disabled>Custom positions</option>}
        <option value="line">Line abreast</option><option value="column">Column</option><option value="wedge">Wedge</option>
      </select></label>
      <button type="button" onClick={() => { onChange({ ...setup, spawns: undefined }); setNotice(''); }}>Reset positions</button>
    </div>
    <p id="spawn-help">Select a ship, then click the sea to place it, or drag its marker. Use arrow keys on a marker to move 50 m; hold Shift for 250 m. Formations and distance changes arrange both fleets again.</p>
    <div className="spawn-chart" ref={chart} role="group" aria-label="Ship spawn map" aria-describedby="spawn-help"
      onPointerDown={event => { if (event.target === event.currentTarget || (event.target as Element).closest('svg')) place(selected.key, event.clientX, event.clientY); }}
      onPointerMove={event => { if (dragging.current) place(dragging.current, event.clientX, event.clientY); }}
      onPointerUp={() => { dragging.current = null; dragRadius.current = null; }} onPointerCancel={() => { dragging.current = null; dragRadius.current = null; }}>
      <svg viewBox="0 0 100 100" aria-hidden="true" preserveAspectRatio="none">
        {Array.from({ length: 9 }, (_, i) => <path key={i} d={`M ${(i + 1) * 10} 0 V 100 M 0 ${(i + 1) * 10} H 100`} className="spawn-grid"/>)}
        {islands.map(island => <polygon key={island.id} points={coastOutline(island).map(([x, z]) => `${px(x)},${py(z)}`).join(' ')} className="spawn-land"/>)}
      </svg>
      <span className="spawn-north" aria-hidden="true">N</span>
      {slots.map(slot => <button key={slot.key} type="button" className={`spawn-marker ${slot.team}`} aria-pressed={selected.key === slot.key}
        aria-label={`${slot.label} ${slot.name}, select and use arrow keys to move`} title={`${slot.label} · ${slot.name}`}
        style={{ left: `${px(slot.pose.x)}%`, top: `${py(slot.pose.z)}%` }}
        onClick={() => setSelection(slot.key)}
        onPointerDown={event => { event.stopPropagation(); setSelection(slot.key); dragging.current = slot.key; dragRadius.current = radius; event.currentTarget.setPointerCapture(event.pointerId); }}
        onLostPointerCapture={() => { dragging.current = null; dragRadius.current = null; }}
        onKeyDown={event => {
          const delta = ({ ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] } as Record<string, number[]>)[event.key];
          if (delta) { event.preventDefault(); const step = event.shiftKey ? 250 : 50; move(slot.key, slot.pose.x + delta[0] * step, slot.pose.z + delta[1] * step); }
        }}><span className="spawn-bow" style={{ transform: `rotate(${slot.pose.heading}rad)` }}/><span>{slot.label}</span></button>)}
    </div>
    <div className="spawn-controls spawn-selection">
      <label>Ship<select value={selected.key} onChange={event => setSelection(event.target.value)}>{slots.map(slot => <option key={slot.key} value={slot.key}>{slot.label} · {slot.name}</option>)}</select></label>
      <label>Heading<select value={Math.round(selected.pose.heading * 180 / Math.PI)} onChange={event => move(selected.key, selected.pose.x, selected.pose.z, Number(event.target.value) * Math.PI / 180)}>
        {[0, 45, 90, 135, 180, 225, 270, 315].map(degrees => <option key={degrees} value={degrees}>{degrees}° {({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' } as Record<number, string>)[degrees] ?? ''}</option>)}
      </select></label>
    </div>
    <div className="spawn-legend"><span>F · Friendly (F1 is you)</span><span>E · Enemy</span><span>Markers enlarged for selection</span></div>
    <p className="battle-error" role="status">{notice}</p>
  </section>;
}
