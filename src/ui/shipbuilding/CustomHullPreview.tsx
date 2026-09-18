import * as THREE from 'three';
import { constructionPaintColor } from '../../ships/constructionPaints';
import { outline, worldPoint, type Hull } from '../../ships/customHullModel';

/** Display-only faces for the section editor. `cut` keeps the sections from the bow to that
 * index and closes the hull there with a tinted cap, as the Section view's slice. */
export function hullGeometry(h: Hull, cut?: number) {
  const stations = cut === undefined ? h.stations : h.stations.slice(0, cut + 1), rings = stations.map(s => outline(h, s));
  const positions: number[] = [], normals: number[] = [], colors: number[] = [], surfaceCoordinates: number[] = [];
  const side = new THREE.Color(constructionPaintColor('naval-gray')), deck = new THREE.Color(constructionPaintColor('deck-gray')), slice = new THREE.Color('#3f5a54');
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
    const a = j * n + i, b = j * n + (i + 1) % n, c = a + n, d = b + n, color = i === n - 1 ? deck : side;
    if (i >= (n - 1) / 2 && i < n - 1) { triangle(a, b, d, color, i); triangle(a, d, c, color, i); }
    else { triangle(a, b, c, color, i); triangle(b, d, c, color, i); }
  }
  for (const ring of [0, stations.length - 1]) {
    const center = new THREE.Vector3();
    for (let i = 0; i < n; i++) center.addScaledVector(points[ring * n + i], 1 / n);
    const c = points.push(center) - 1, color = ring && cut !== undefined && cut < h.stations.length - 1 ? slice : side;
    coordinates.push([stations[ring].t, rings[ring].reduce((sum, p) => sum + p.y / n, 0)]);
    for (let i = 0; i < n; i++) {
      const a = ring * n + i, b = ring * n + (i + 1) % n;
      if (ring === 0) triangle(b, a, c, color); else triangle(a, b, c, color);
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

/** Builder paints: naval gray sides, deck gray deck and red oxide below the coating height. Invalid drafts show salmon. */
export function hullMaterial(h: Hull, invalid: boolean) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: !invalid, color: invalid ? '#ed8677' : '#ffffff', roughness: .72, metalness: .08, side: THREE.DoubleSide,
    // Section rings and the waterline sit exactly on the surface; keep them in front of it.
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  if (!invalid && h.redPaintY !== undefined) material.onBeforeCompile = shader => {
    shader.uniforms.hullUnderwaterColor = { value: new THREE.Color(constructionPaintColor('red-oxide')) };
    shader.uniforms.hullRedPaintY = { value: h.redPaintY! / h.depth };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 hullSurface; varying vec2 vHullSurface;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvHullSurface = hullSurface;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vHullSurface; uniform vec3 hullUnderwaterColor; uniform float hullRedPaintY;').replace('#include <color_fragment>', `#include <color_fragment>
      if (vHullSurface.y < hullRedPaintY) diffuseColor.rgb = hullUnderwaterColor;
    `);
  };
  return material;
}
