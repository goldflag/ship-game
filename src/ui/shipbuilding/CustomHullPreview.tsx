import { hullPaintBands, MAX_HULL_PAINT_BANDS } from '../../ships/hullPaintBands';
import * as THREE from 'three';
import { constructionPaintColor } from '../../ships/constructionPaints';
import { customHullBilgeKeelFaces, customHullPrimitive, outline, worldPoint, type Hull } from '../../ships/customHullModel';
import { customHullPanels } from '../../ships/constructionPanels';
import { constructionHullBasePaint } from '../../ships/constructionHullPaint';
import type { ConstructionSource } from '../../ships/blueprint';

/** Display-only faces for the section editor. `cut` keeps the sections from the bow to that
 * index and closes the hull there with a tinted cap, as the Section view's slice. */
export function hullGeometry(h: Hull, cut?: number, appearance?: ConstructionSource['construction']) {
  const stations = cut === undefined ? h.stations : h.stations.slice(0, cut + 1), rings = stations.map(s => outline(h, s));
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], surfaceCoordinates: number[] = [];
  const side = new THREE.Color(constructionPaintColor(appearance?.paint ?? 'naval-gray')), deck = new THREE.Color(constructionPaintColor('deck-gray')), slice = new THREE.Color('#3f5a54');
  const primitive = customHullPrimitive(h), panels = customHullPanels(primitive);
  const assignments = new Map(appearance?.surfaces.filter(s => s.primitiveId === h.id).map(s => [JSON.stringify([s.face, s.panelId]), s]));
  const basePaint = constructionHullBasePaint(appearance && { ...appearance, primitives: [primitive] });
  const panelColor = (index: number, fallback: THREE.Color): THREE.Color => {
    if (!appearance) return fallback;
    const panel = panels[index], assigned = assignments.get(JSON.stringify([panel.face, panel.panelId])) ?? assignments.get(JSON.stringify([panel.face, undefined]));
    return new THREE.Color(constructionPaintColor(basePaint({ ...panel, primitiveId: h.id, paint: assigned?.paint ?? appearance.paint ?? 'naval-gray' })));
  };
  const points = stations.flatMap((s, i) => rings[i].map(p => new THREE.Vector3(...worldPoint(h, s.t, p))));
  const coordinates = stations.flatMap((s, i) => rings[i].map(p => [s.t, p.y]));
  const n = rings[0].length;
  // Share lighting across each curved side, keeping the deck and keel sharp.
  // Average whole panels so the triangle diagonal cannot bias the normals
  // or break left/right symmetry.
  const sideNormals = Array.from({ length: 3 }, () => points.map(() => new THREE.Vector3()));
  const stripNormals = Array.from({ length: n }, (_, i) => sideNormals[i === n - 1 ? 2 : i < (n - 1) / 2 ? 0 : 1]);
  for (let j = 0; j < stations.length - 1; j++) for (let i = 0; i < n; i++) {
    const a = j * n + i, b = j * n + (i + 1) % n, c = a + n, d = b + n;
    const normal = points[b].clone().sub(points[a]).cross(points[c].clone().sub(points[a]))
      .add(points[d].clone().sub(points[b]).cross(points[c].clone().sub(points[b])));
    for (const vertex of [a, b, c, d]) stripNormals[i][vertex].add(normal);
  }
  sideNormals.forEach(side => side.forEach(normal => normal.normalize()));
  const triangle = (a: number, b: number, c: number, color: THREE.Color, strip?: number) => {
    // A pointed end contains coincident vertices. Omit its zero-area triangles.
    const normal = points[b].clone().sub(points[a]).cross(points[c].clone().sub(points[a]));
    if (normal.lengthSq() < 1e-18) return;
    normal.normalize();
    for (const i of [a, b, c]) {
      positions.push(...points[i].toArray()); colors.push(color.r, color.g, color.b);
      const smooth = strip === undefined ? normal : stripNormals[strip][i];
      normals.push(...(smooth.lengthSq() > 1e-18 ? smooth : normal).toArray());
      surfaceCoordinates.push(...coordinates[i]);
    }
  };
  for (let j = 0; j < stations.length - 1; j++) for (let i = 0; i < n; i++) {
    const a = j * n + i, b = j * n + (i + 1) % n, c = a + n, d = b + n, color = panelColor(j * n + i, i === n - 1 ? deck : side);
    if (i >= (n - 1) / 2 && i < n - 1) { triangle(a, b, d, color, i); triangle(a, d, c, color, i); }
    else { triangle(a, b, c, color, i); triangle(b, d, c, color, i); }
  }
  for (const ring of [0, stations.length - 1]) {
    const center = new THREE.Vector3();
    for (let i = 0; i < n; i++) center.addScaledVector(points[ring * n + i], 1 / n);
    const c = points.push(center) - 1, color = ring && cut !== undefined && cut < h.stations.length - 1 ? slice : panelColor(panels.length - (ring === 0 ? 2 : 1), side);
    coordinates.push([stations[ring].t, rings[ring].reduce((sum, p) => sum + p.y / n, 0)]);
    for (let i = 0; i < n; i++) {
      const a = ring * n + i, b = ring * n + (i + 1) % n;
      if (ring === 0) triangle(b, a, c, color); else triangle(a, b, c, color);
    }
  }
  for (const face of customHullBilgeKeelFaces(h, stations.at(-1)!.t)) {
    const indices = face.map(p => { coordinates.push([0, p[1] / h.depth]); return points.push(new THREE.Vector3(...p))-1; });
    triangle(indices[0], indices[1], indices[2], side);
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

/** Builder paints: face colors above the height coatings, using the same ordered bands as the exported model. Invalid drafts show salmon. */
export function hullMaterial(h: Hull, invalid: boolean) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: !invalid, color: invalid ? '#ed8677' : '#ffffff', roughness: .72, metalness: .08, side: THREE.DoubleSide,
    // Section rings and the waterline sit exactly on the surface; keep them in front of it.
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const bands = hullPaintBands(h);
  if (!invalid && bands.length) material.onBeforeCompile = shader => {
    shader.uniforms.hullPaintCount = { value: bands.length };
    shader.uniforms.hullPaintHeights = { value: Array.from({ length: MAX_HULL_PAINT_BANDS }, (_, i) => (bands[i]?.upperY ?? 0) / h.depth) };
    shader.uniforms.hullPaintColors = { value: Array.from({ length: MAX_HULL_PAINT_BANDS }, (_, i) => new THREE.Color(constructionPaintColor(bands[i]?.paint ?? 'naval-gray'))) };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 hullSurface; varying vec2 vHullSurface;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvHullSurface = hullSurface;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vHullSurface; uniform int hullPaintCount;
      uniform float hullPaintHeights[${MAX_HULL_PAINT_BANDS}]; uniform vec3 hullPaintColors[${MAX_HULL_PAINT_BANDS}];
    `).replace('#include <color_fragment>', `#include <color_fragment>
      for (int i = 0; i < ${MAX_HULL_PAINT_BANDS}; i++) {
        if (i < hullPaintCount && vHullSurface.y < hullPaintHeights[i]) { diffuseColor.rgb = hullPaintColors[i]; break; }
      }
    `);
  };
  return material;
}
