import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { constructionPaintColor } from '../../ships/constructionPaints';
import { influence, outline, sampledStations, worldPoint, type Hull } from '../../ships/customHullModel';

export function hullGeometry(h: Hull) {
  const stations = sampledStations(h), rings = stations.map(s => outline(h, s));
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], surfaceCoordinates: number[] = [];
  const steel = new THREE.Color('#a3b0b5'), deck = new THREE.Color('#b9ad91');
  const points = stations.flatMap((s, i) => rings[i].map(p => new THREE.Vector3(...worldPoint(h, s.t, p))));
  const coordinates = stations.flatMap((s, i) => rings[i].map(p => [s.t, p.y]));
  const n = rings[0].length;
  // Share lighting along each longitudinal panel strip, but never across its
  // outline edges (deck, chines and keel). Average whole panels so the chosen
  // triangle diagonal cannot bias the normals or break left/right symmetry.
  const stripNormals = Array.from({ length: n }, () => points.map(() => new THREE.Vector3()));
  for (let j = 0; j < stations.length - 1; j++) for (let i = 0; i < n; i++) {
    const a = j * n + i, b = j * n + (i + 1) % n, c = a + n, d = b + n;
    const normal = points[b].clone().sub(points[a]).cross(points[c].clone().sub(points[a]))
      .add(points[d].clone().sub(points[b]).cross(points[c].clone().sub(points[b])));
    for (const vertex of [a, b, c, d]) stripNormals[i][vertex].add(normal);
  }
  stripNormals.forEach(strip => strip.forEach(normal => normal.normalize()));
  const triangle = (a: number, b: number, c: number, strip?: number) => {
    // A pointed end contains coincident vertices. Omit its zero-area triangles.
    const normal = points[b].clone().sub(points[a]).cross(points[c].clone().sub(points[a]));
    if (normal.lengthSq() < 1e-18) return;
    normal.normalize();
    const color = strip === n - 1 ? deck : steel;
    for (const i of [a, b, c]) {
      positions.push(...points[i].toArray()); colors.push(color.r, color.g, color.b);
      const smooth = strip === undefined ? normal : stripNormals[strip][i];
      normals.push(...(smooth.lengthSq() > 1e-18 ? smooth : normal).toArray());
      surfaceCoordinates.push(...coordinates[i]);
    }
  };
  for (let j = 0; j < stations.length - 1; j++) for (let i = 0; i < n; i++) {
    const a = j * n + i, b = j * n + (i + 1) % n, c = a + n, d = b + n;
    if (i >= 4 && i < 8) { triangle(a, b, d, i); triangle(a, d, c, i); }
    else { triangle(a, b, c, i); triangle(b, d, c, i); }
  }
  for (const ring of [0, stations.length - 1]) {
    const center = new THREE.Vector3();
    for (let i = 0; i < n; i++) center.addScaledVector(points[ring * n + i], 1 / n);
    const c = points.push(center) - 1;
    coordinates.push([stations[ring].t, rings[ring].reduce((sum, p) => sum + p.y / n, 0)]);
    for (let i = 0; i < n; i++) {
      const a = ring * n + i, b = ring * n + (i + 1) % n;
      if (ring === 0) triangle(b, a, c); else triangle(a, b, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('hullSurface', new THREE.Float32BufferAttribute(surfaceCoordinates, 2));
  // Only lighting is smoothed; the original flat triangles remain unchanged.
  // End caps keep face normals, separate from the adjoining side strips.
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return g;
}

function hullMaterial(h: Hull, invalid: boolean) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: !invalid, flatShading: false, color: invalid ? '#ed8677' : '#ffffff', roughness: .65, metalness: .12, side: THREE.DoubleSide });
  if (!invalid) material.onBeforeCompile = shader => {
    shader.uniforms.hullRegion = { value: new THREE.Vector4(h.region.start, h.region.end, h.region.low - .5, h.region.high - .5) };
    shader.uniforms.hullRegionColor = { value: new THREE.Color(h.region.color) };
    shader.uniforms.hullRegionEnabled = { value: h.region.enabled };
    shader.uniforms.hullUnderwaterColor = { value: new THREE.Color(constructionPaintColor('red-oxide')) };
    shader.uniforms.hullRedPaintY = { value: h.redPaintY === undefined ? -10000 : h.redPaintY / h.depth };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 hullSurface; varying vec2 vHullSurface;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvHullSurface = hullSurface;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vHullSurface; uniform vec4 hullRegion; uniform vec3 hullRegionColor; uniform vec3 hullUnderwaterColor; uniform bool hullRegionEnabled; uniform float hullRedPaintY;').replace('#include <color_fragment>', `#include <color_fragment>
      if (vHullSurface.y < hullRedPaintY) diffuseColor.rgb = hullUnderwaterColor;
      if (hullRegionEnabled && vHullSurface.x >= hullRegion.x && vHullSurface.x <= hullRegion.y && vHullSurface.y >= hullRegion.z && vHullSurface.y <= hullRegion.w) diffuseColor.rgb = hullRegionColor;
    `);
  };
  return material;
}

export function Preview({ hulls, active, selected, soft, invalid, lines, view, fit, onSelect }: {
  hulls: Hull[]; active: string; selected: string[]; soft: boolean; invalid: boolean; lines: boolean;
  view: string; fit: number; onSelect: (hull: string, station: string, multiple: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<{ scene: THREE.Scene; group: THREE.Group; camera: THREE.PerspectiveCamera; controls: OrbitControls; renderer: THREE.WebGLRenderer } | undefined>(undefined);
  const current = useRef({ hulls, onSelect }); current.current = { hulls, onSelect };
  useEffect(() => {
    const element = host.current!;
    const scene = new THREE.Scene(), group = new THREE.Group(); scene.add(group);
    const camera = new THREE.PerspectiveCamera(35, 1, .1, 5000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
    element.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
    const initialSize = element.getBoundingClientRect();
    camera.aspect = initialSize.width / Math.max(1, initialSize.height); camera.updateProjectionMatrix();
    scene.add(new THREE.HemisphereLight(0xeaf3f4, 0x77716b, 2.4));
    const sun = new THREE.DirectionalLight(0xfff1d8, 3.1); sun.position.set(-100, 130, -80); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xb6c8db, 1.4); fill.position.set(70, 25, 100); scene.add(fill);
    const resize = new ResizeObserver(() => {
      const { width, height } = element.getBoundingClientRect();
      const nextAspect = width / Math.max(1, height);
      camera.position.sub(controls.target).multiplyScalar(Math.sqrt(camera.aspect / nextAspect)).add(controls.target);
      camera.aspect = nextAspect; camera.updateProjectionMatrix(); renderer.setSize(width, height);
    }); resize.observe(element);
    const raycaster = new THREE.Raycaster(); let down = [0, 0];
    const pointerdown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; };
    const pointerup = (e: PointerEvent) => {
      if (e.button !== 0 || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const rect = element.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), camera);
      const hit = raycaster.intersectObjects(group.children).find(v => v.object.userData.hull);
      if (!hit) return;
      const h = current.current.hulls.find(v => v.id === hit.object.userData.hull)!;
      const t = hit.point.z / h.length + .5;
      const station = h.stations.reduce((a, b) => Math.abs(a.t - t) < Math.abs(b.t - t) ? a : b);
      current.current.onSelect(h.id, station.id, e.shiftKey);
    };
    element.addEventListener('pointerdown', pointerdown); element.addEventListener('pointerup', pointerup);
    let frame = 0;
    const render = () => { frame = requestAnimationFrame(render); controls.update(); renderer.render(scene, camera); }; render();
    runtime.current = { scene, group, camera, controls, renderer };
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); controls.dispose(); renderer.dispose(); renderer.forceContextLoss();
      element.removeEventListener('pointerdown', pointerdown); element.removeEventListener('pointerup', pointerup); renderer.domElement.remove();
      runtime.current = undefined;
    };
  }, []);
  useEffect(() => {
    const r = runtime.current; if (!r) return;
    hulls.forEach(h => {
      const mesh = new THREE.Mesh(hullGeometry(h), hullMaterial(h, invalid));
      mesh.userData.hull = h.id; r.group.add(mesh);
      if (lines || h.id === active) for (const s of h.stations) {
        const chosen = h.id === active && selected.includes(s.id);
        const affected = h.id === active && !chosen && influence(h, selected, s.t, soft) > 0;
        if (!lines && !chosen && !affected) continue;
        const points = outline(h, s).map(p => new THREE.Vector3(...worldPoint(h, s.t, p)));
        points.push(points[0]);
        const material = affected
          ? new THREE.LineDashedMaterial({ color: '#e0c58d', dashSize: h.depth * .06, gapSize: h.depth * .04, depthTest: false })
          : new THREE.LineBasicMaterial({ color: chosen ? '#86e4c5' : '#253537', transparent: true, opacity: chosen ? 1 : .48, depthTest: !chosen });
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
        if (affected) line.computeLineDistances();
        line.renderOrder = chosen ? 4 : 1; r.group.add(line);
      }
      const bow = worldPoint(h, 0, { x: 0, y: .75 });
      const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(...bow), h.length * .065, 0x86e4c5, h.length * .013, h.length * .007);
      r.group.add(arrow);
    });
    return () => {
      r.group.traverse(o => { const object = o as THREE.Mesh; object.geometry?.dispose(); if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(m => m.dispose()); });
      r.group.clear();
    };
  }, [hulls, active, selected, soft, invalid, lines]);
  useEffect(() => {
    const r = runtime.current; if (!r) return;
    const bounds = new THREE.Box3().setFromObject(r.group), center = bounds.getCenter(new THREE.Vector3());
    const direction = view === 'Plan' ? new THREE.Vector3(.001, 1, 0) : view === 'Profile' ? new THREE.Vector3(1, .04, 0) : view === 'Bow' ? new THREE.Vector3(.01, .12, -1) : new THREE.Vector3(.85, .65, -1);
    direction.normalize(); r.camera.position.copy(center).add(direction); r.camera.lookAt(center);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(r.camera.quaternion), up = new THREE.Vector3(0, 1, 0).applyQuaternion(r.camera.quaternion);
    const tan = Math.tan(THREE.MathUtils.degToRad(r.camera.fov / 2));
    let distance = 10;
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const v = new THREE.Vector3(x, y, z).sub(center);
      distance = Math.max(distance, Math.max(Math.abs(v.dot(up)) / tan, Math.abs(v.dot(right)) / (tan * r.camera.aspect)) + v.dot(direction));
    }
    r.camera.position.copy(center).addScaledVector(direction, distance * 1.3); r.controls.target.copy(center); r.controls.update();
  }, [view, fit]);
  return <div className="hp-scene" ref={host} aria-label="Interactive 3D hull preview. Drag to orbit, scroll to zoom; click a hull to select a section." />;
}
