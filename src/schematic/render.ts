import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SHIP_MODEL } from '../game/shipModel';
import { formatLength, SCHEMATIC_PAGES, type DrawingChoices, type SchematicChoices } from './options';
import { layOutSchematic, type Span, type View } from './layout';

const THEMES = {
  light: { paper: '#e9e6dd', panel: '#dfddd3', ink: '#202c32', muted: '#53636a', rule: '#a1aaa8', accent: '#765b31', edge: '#35434a' },
  charcoal: { paper: '#202b34', panel: '#19242c', ink: '#edf1ec', muted: '#b2c3c9', rule: '#4d616b', accent: '#e5bf80', edge: '#c4d2d7' },
  ink: { paper: '#102b3b', panel: '#0b2230', ink: '#e5eff0', muted: '#b2cbd5', rule: '#476775', accent: '#c9dce1', edge: '#c9e3ec' },
};
const CAPTIONS: Record<View, string> = {
  side: 'Starboard elevation', plan: 'Deck plan', front: 'Bow', rear: 'Stern', hero: 'General arrangement · independent scale',
};

function basis(eye: THREE.Vector3, up = new THREE.Vector3(0, 1, 0)) {
  const forward = eye.clone().normalize().negate();
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  return { right, up: new THREE.Vector3().crossVectors(right, forward), forward };
}

// The unrotated GLB is bow +X, up +Y, starboard +Z. Bow stays right in side and deck views.
export const VIEW_BASES = {
  side: basis(new THREE.Vector3(0, 0, 1)),
  plan: basis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1)),
  front: basis(new THREE.Vector3(1, 0, 0)),
  rear: basis(new THREE.Vector3(-1, 0, 0)),
  hero: basis(new THREE.Vector3(1, 0.65, 1.8)),
};

function measureShip(model: THREE.Object3D): Record<View, Span> {
  model.updateMatrixWorld(true);
  const spans = Object.fromEntries(Object.keys(VIEW_BASES).map(key => [key, {
    minR: Infinity, maxR: -Infinity, minU: Infinity, maxU: -Infinity, near: Infinity, far: -Infinity,
  }])) as Record<View, { minR: number; maxR: number; minU: number; maxU: number; near: number; far: number }>;
  const point = new THREE.Vector3();
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      for (const key of Object.keys(VIEW_BASES) as View[]) {
        const axes = VIEW_BASES[key], span = spans[key];
        const r = point.dot(axes.right), u = point.dot(axes.up), d = point.dot(axes.forward);
        span.minR = Math.min(span.minR, r); span.maxR = Math.max(span.maxR, r);
        span.minU = Math.min(span.minU, u); span.maxU = Math.max(span.maxU, u);
        span.near = Math.min(span.near, d); span.far = Math.max(span.far, d);
      }
    }
  });
  return Object.fromEntries(Object.entries(spans).map(([key, s]) => [key, {
    width: s.maxR - s.minR, height: s.maxU - s.minU,
    centerRight: (s.minR + s.maxR) / 2, centerUp: (s.minU + s.maxU) / 2, near: s.near, far: s.far,
  }])) as Record<View, Span>;
}

function paintSheet(ctx: CanvasRenderingContext2D, choices: DrawingChoices, spans: Record<View, Span>, metersPerPixel: number) {
  const theme = THEMES[choices.stock];
  const text = (value: string, x: number, y: number, size = 17, color = theme.ink, display = false) => {
    ctx.fillStyle = color;
    ctx.font = `${display ? 500 : 400} ${size}px "${display ? 'Barlow Condensed' : 'Barlow'}", sans-serif`;
    ctx.fillText(value, x, y);
  };
  const rule = (x: number, y: number, right: number) => {
    ctx.strokeStyle = theme.rule; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(right, y); ctx.stroke();
  };
  ctx.fillStyle = theme.paper; ctx.fillRect(0, 0, 1600, 900);
  ctx.fillStyle = theme.panel; ctx.fillRect(1230, 40, 330, 820);
  ctx.strokeStyle = theme.rule; ctx.lineWidth = 1;
  ctx.strokeRect(40, 40, 1520, 820);
  ctx.beginPath(); ctx.moveTo(1230, 40); ctx.lineTo(1230, 860); ctx.stroke();

  text(SHIP_MODEL.name.toUpperCase(), 1260, 115, 55, theme.ink, true);
  text('Battleship · Germany · 1941', 1260, 149, 17, theme.muted);
  rule(1260, 176, 1530);
  text('Ship schematic', 1260, 215, 28, theme.accent, true);
  text('Full hull and deck arrangement', 1260, 249, 17, theme.muted);
  text('MODEL DIMENSIONS', 1260, 317, 15, theme.muted);
  const facts = [
    ['Length', spans.side.width], ['Beam', spans.front.width], ['Overall height', spans.side.height],
  ] as const;
  facts.forEach(([label, value], index) => {
    const y = 358 + index * 56;
    text(label, 1260, y, 17, theme.muted);
    ctx.textAlign = 'right'; text(formatLength(value, choices.units), 1530, y, 22); ctx.textAlign = 'left';
    rule(1260, y + 17, 1530);
  });
  text('Drawn from the in-game ship.', 1260, 543, 17, theme.muted);
  text('Includes hull below the waterline.', 1260, 569, 17, theme.muted);

  if (metersPerPixel > 0) {
    const step = choices.units === 'metric' ? 10 : 50;
    const segmentWidth = step * (choices.units === 'metric' ? 1 : 0.3048) / metersPerPixel;
    text('ELEVATION SCALE', 1260, 646, 15, theme.muted);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 === 0 ? theme.ink : theme.panel;
      ctx.fillRect(1260 + i * segmentWidth, 667, segmentWidth, 9);
    }
    ctx.strokeStyle = theme.ink; ctx.strokeRect(1260, 667, segmentWidth * 4, 9);
    text('0', 1260, 700, 15, theme.muted);
    ctx.textAlign = 'right';
    text(`${4 * step} ${choices.units === 'metric' ? 'm' : 'ft'}`, 1260 + 4 * segmentWidth, 700, 15, theme.muted);
    ctx.textAlign = 'left';
    text('Side, deck, bow and stern', 1260, 737, 17, theme.muted);
    text('share the scale above.', 1260, 763, 17, theme.muted);
  } else {
    text('GENERAL ARRANGEMENT', 1260, 655, 15, theme.muted);
    text('Three-quarter model view.', 1260, 691, 17, theme.muted);
  }
  rule(1260, 798, 1530);
  text('BISMARCK / SEA TRIALS', 1260, 833, 22, theme.accent, true);
  text('Model reference · not a construction drawing', 65, 886, 14, theme.muted);
}

export type ShipSchematicRenderer = {
  render(choices: DrawingChoices, signal: AbortSignal): Promise<HTMLCanvasElement>;
  dispose(): void;
};

/** One private model and renderer per dialog, reused for options and released after pending work. */
export async function createShipSchematicRenderer(signal: AbortSignal): Promise<ShipSchematicRenderer> {
  let renderer: THREE.WebGPURenderer | undefined;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const dispose = () => {
    renderer?.dispose();
    geometries.forEach(value => value.dispose());
    materials.forEach(value => value.dispose());
    textures.forEach(value => { value.dispose(); const image = value.source.data; if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close(); });
  };
  try {
    const response = await fetch(SHIP_MODEL.url, { signal });
    if (!response.ok) throw new Error('The ship model could not be loaded.');
    const bytes = await response.arrayBuffer();
    signal.throwIfAborted();
    const { scene: model } = await new GLTFLoader().parseAsync(bytes, '/models/');
    const meshes: THREE.Mesh[] = [];
    model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      meshes.push(object); geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        material.polygonOffset = true; material.polygonOffsetFactor = 1; material.polygonOffsetUnits = 1;
      }
    });
    signal.throwIfAborted();
    const spans = measureShip(model);
    const edgesMaterial = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.65 });
    const inkMaterial = new THREE.MeshBasicMaterial({ color: THEMES.ink.paper, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    materials.add(edgesMaterial); materials.add(inkMaterial);
    const originalMaterials = meshes.map(mesh => mesh.material);
    for (const mesh of meshes) {
      const edges = new THREE.EdgesGeometry(mesh.geometry, 28);
      geometries.add(edges); mesh.add(new THREE.LineSegments(edges, edgesMaterial));
    }
    const scene = new THREE.Scene();
    scene.add(model, new THREE.HemisphereLight('#ffffff', '#87949e', 2.5));
    const key = new THREE.DirectionalLight('#fff6e7', 3); key.position.set(120, 240, 180);
    const fill = new THREE.DirectionalLight('#dae9ff', 1.5); fill.position.set(-120, 80, -160);
    scene.add(key, fill);
    renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(1); renderer.setClearAlpha(0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    await renderer.init();
    signal.throwIfAborted();
    await Promise.all([document.fonts.load('400 17px "Barlow"'), document.fonts.load('500 55px "Barlow Condensed"')]);
    signal.throwIfAborted();
    const camera = new THREE.OrthographicCamera();
    let disposed = false;
    let queue: Promise<unknown> = Promise.resolve();
    const draw = async (choices: DrawingChoices, request: AbortSignal) => {
      const assertActive = () => { signal.throwIfAborted(); request.throwIfAborted(); if (disposed) throw new DOMException('Closed', 'AbortError'); };
      assertActive();
      const canvas = document.createElement('canvas');
      const page = SCHEMATIC_PAGES[choices.page], scale = page.width / 1600;
      canvas.width = page.width; canvas.height = page.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('The image canvas could not be created.');
      ctx.scale(scale, scale);
      const layout = layOutSchematic(spans, choices.layout), theme = THEMES[choices.stock];
      paintSheet(ctx, choices, spans, layout.metersPerPixel);
      edgesMaterial.color.set(theme.edge);
      edgesMaterial.opacity = choices.stock === 'ink' ? 0.95 : 0.5;
      meshes.forEach((mesh, i) => { mesh.material = choices.stock === 'ink' ? inkMaterial : originalMaterials[i]; });
      for (const view of Object.keys(layout.views) as View[]) {
        assertActive();
        const box = layout.views[view]!, span = spans[view], axes = VIEW_BASES[view];
        const mpp = view === 'hero' ? Math.max(span.width / box.width, span.height / box.height) * 1.08 : layout.metersPerPixel;
        const target = new THREE.Vector3().addScaledVector(axes.right, span.centerRight)
          .addScaledVector(axes.up, span.centerUp).addScaledVector(axes.forward, (span.near + span.far) / 2);
        const distance = span.far - span.near + 100;
        camera.position.copy(target).addScaledVector(axes.forward, -distance);
        camera.up.copy(axes.up); camera.lookAt(target);
        camera.left = -box.width * mpp / 2; camera.right = -camera.left;
        camera.top = box.height * mpp / 2; camera.bottom = -camera.top;
        camera.near = 0.1; camera.far = distance * 3; camera.updateProjectionMatrix();
        renderer!.setSize(Math.round(box.width * scale), Math.round(box.height * scale), false);
        renderer!.render(scene, camera);
        assertActive();
        ctx.drawImage(renderer!.domElement, box.x, box.y, box.width, box.height);
        ctx.fillStyle = theme.muted; ctx.font = '400 15px "Barlow", sans-serif';
        ctx.fillText(CAPTIONS[view], box.x, box.y + box.height + 25);
        // Yield between views so closing the dialog or changing options can cancel the rest.
        await new Promise<void>(resolve => window.setTimeout(resolve, 0));
      }
      assertActive();
      return canvas;
    };
    return {
      render(choices, request) {
        const result = queue.then(() => draw(choices, request));
        queue = result.catch(() => undefined);
        return result;
      },
      dispose() { if (disposed) return; disposed = true; void queue.then(dispose); },
    };
  } catch (error) { dispose(); throw error; }
}

export async function encodeSchematic(canvas: HTMLCanvasElement, format: SchematicChoices['format']) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value ? resolve(value) : reject(new Error('The image could not be encoded.')), `image/${format}`, 0.95);
  });
  // Browsers may fall back to PNG. The extension follows the actual bytes.
  if (blob.type !== 'image/png' && blob.type !== 'image/webp') throw new Error('Unsupported image format.');
  return { blob, format: blob.type === 'image/webp' ? 'webp' as const : 'png' as const };
}
