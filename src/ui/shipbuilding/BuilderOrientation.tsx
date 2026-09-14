import type { Ref } from 'react';
import { Quaternion, Vector3, type Camera } from 'three';

const DIRECTIONS = {
  bow: new Vector3(0, 0, -1), stern: new Vector3(0, 0, 1),
  port: new Vector3(-1, 0, 0), starboard: new Vector3(1, 0, 0),
};
const OUTLINE = [[0, 0, -1], [-.3, 0, -.45], [-.3, 0, .75], [.3, 0, .75], [.3, 0, -.45]];

/** Ship-space directions projected into the camera, independent of pan, zoom and hull shape. */
export function updateBuilderOrientation(element: HTMLDivElement, camera: Camera) {
  const rotation = camera.getWorldQuaternion(new Quaternion()).invert();
  const directions = Object.fromEntries(Object.entries(DIRECTIONS).map(([name, direction]) => [name, direction.clone().applyQuaternion(rotation)])) as typeof DIRECTIONS;
  const bow = directions.bow, starboard = directions.starboard;
  const bowLength = Math.hypot(bow.x, bow.y), headOn = bowLength < .25;
  // At deck height both axes project onto one line. Keep the bow/stern labels
  // distinct and name the facing side below instead of overlapping four labels.
  const showSides = headOn || Math.abs(bow.x * starboard.y - bow.y * starboard.x) > .3;
  const point = (direction: Vector3, scale = 32) => `${(86 + direction.x * scale).toFixed(2)},${(54 - direction.y * scale).toFixed(2)}`;
  const outline = OUTLINE.map(vertex => point(new Vector3(...vertex).applyQuaternion(rotation), 27));
  element.querySelector('[data-orientation-hull]')!.setAttribute('d', `M${outline.join(' L')} Z`);

  for (const name of Object.keys(DIRECTIONS) as (keyof typeof DIRECTIONS)[]) {
    const direction = directions[name], length = Math.hypot(direction.x, direction.y);
    const longitudinal = name === 'bow' || name === 'stern';
    const visible = longitudinal ? !headOn : showSides && length > .25;
    const group = element.querySelector<SVGGElement>(`[data-orientation-direction="${name}"]`)!;
    group.style.display = visible ? '' : 'none';
    if (!visible) continue;
    const line = group.querySelector('line')!;
    line.setAttribute('x2', String(86 + direction.x * 32)); line.setAttribute('y2', String(54 - direction.y * 32));
    const label = group.querySelector('text')!;
    label.setAttribute('x', String(86 + direction.x / length * 49));
    label.setAttribute('y', String(54 - direction.y / length * 43));
  }

  const arrow = element.querySelector<SVGPathElement>('[data-orientation-arrow]')!;
  arrow.style.display = headOn ? 'none' : '';
  if (!headOn) {
    const x = 86 + bow.x * 32, y = 54 - bow.y * 32, dx = bow.x / bowLength, dy = -bow.y / bowLength;
    arrow.setAttribute('d', `M${x},${y} L${x - dx * 7 - dy * 3.5},${y - dy * 7 + dx * 3.5} L${x - dx * 7 + dy * 3.5},${y - dy * 7 - dx * 3.5} Z`);
  }
  const endOn = element.querySelector<SVGGElement>('[data-orientation-end-on]')!;
  endOn.style.display = headOn ? '' : 'none';
  endOn.querySelector<SVGCircleElement>('[data-orientation-dot]')!.style.display = bow.z > 0 ? '' : 'none';
  endOn.querySelector<SVGPathElement>('[data-orientation-cross]')!.style.display = bow.z > 0 ? 'none' : '';
  const reading = headOn ? (bow.z > 0 ? 'Bow toward you' : 'Bow away from you')
    : !showSides ? (starboard.z > 0 ? 'Starboard side' : 'Port side') : 'Bow is the front';
  element.querySelector('[data-orientation-reading]')!.textContent = reading;
  element.setAttribute('aria-label', `Ship orientation. ${reading}. Port is the left side and starboard is the right side when facing the bow.`);
  element.style.visibility = 'visible';
}

export function BuilderOrientation({ elementRef }: { elementRef: Ref<HTMLDivElement> }) {
  return <div ref={elementRef} className="sb-orientation" role="img" aria-label="Ship orientation">
    <svg viewBox="0 0 172 108" aria-hidden="true">
      <circle className="sb-orientation-ring" cx="86" cy="54" r="34"/>
      <path data-orientation-hull className="sb-orientation-hull"/>
      {Object.keys(DIRECTIONS).map(name => <g key={name} data-orientation-direction={name} className={`sb-orientation-${name}`}>
        <line x1="86" y1="54"/>
        <text textAnchor="middle" dominantBaseline="central">{name === 'starboard' ? 'Starboard' : name[0].toUpperCase() + name.slice(1)}</text>
      </g>)}
      <path data-orientation-arrow className="sb-orientation-arrow"/>
      <g data-orientation-end-on className="sb-orientation-end-on">
        <circle cx="86" cy="54" r="6"/>
        <circle data-orientation-dot cx="86" cy="54" r="2"/>
        <path data-orientation-cross d="M83 51l6 6m0-6l-6 6"/>
      </g>
    </svg>
    <span data-orientation-reading/>
  </div>;
}
