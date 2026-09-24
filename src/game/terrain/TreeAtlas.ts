/** Tree impostors drawn procedurally once per page into one atlas: four kinds of tree in two variants each.
 *
 * Columns: 0 broadleaf (a rainforest or woodland crown in leaf), 1 coconut palm, 2 conifer (spruce and pine),
 * 3 bare deciduous (oak, beech and birch in winter). Rows: two variants. Each cell is `CELL_WIDTH` × `CELL_HEIGHT`
 * pixels with the tree's base at the bottom centre and its top at the top edge. Colours are albedo with the crown's
 * own occlusion (darker inside and underneath); the sun's direction is left to the shader, which lights the crown as a
 * rounded volume. Deterministic, so every run draws the same forest. */
import * as THREE from 'three/webgpu';

export const TREE_KINDS = ['broadleaf', 'palm', 'conifer', 'bare'] as const;
export type TreeKind = typeof TREE_KINDS[number];
export const TREE_VARIANTS = 2;
export const CELL_WIDTH = 128, CELL_HEIGHT = 256;
/** Width over height of each kind's card, and the height of its crown's centre as a share of the tree. */
export const TREE_SHAPES: Readonly<Record<TreeKind, { aspect: number; crown: number }>> = {
  broadleaf: { aspect: .9, crown: .62 }, palm: { aspect: .75, crown: .9 }, conifer: { aspect: .42, crown: .5 }, bare: { aspect: .8, crown: .6 },
};

function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

type Context = OffscreenCanvasRenderingContext2D;
const rgba = (r: number, g: number, b: number, a = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;

function broadleaf(g: Context, w: number, h: number, rng: () => number): void {
  // Trunk and the limbs that carry the crown.
  g.strokeStyle = rgba(66, 57, 46); g.lineCap = 'round';
  for (let k = 0; k < 6; k++) {
    g.lineWidth = k ? 2.5 : 6;
    g.beginPath(); g.moveTo(w / 2, h);
    g.quadraticCurveTo(w / 2 + (rng() - .5) * 16, h * .7, w / 2 + (rng() - .5) * w * .45, h * (.42 + rng() * .14)); g.stroke();
  }
  // The crown: lobes of small leaf clumps, a cauliflower of them, each lobe darker at its core and underside and the
  // whole crown darker low down, with sky showing between lobes at the rim.
  const lobes = 6 + Math.floor(rng() * 4);
  for (let l = 0; l < lobes; l++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * .62;
    const lx = w / 2 + Math.cos(a) * r * w * .32, ly = h * .44 + Math.sin(a) * r * h * .3 - (l / lobes) * 6;
    const lr = w * (.15 + rng() * .1);
    for (let k = 0; k < 70; k++) {
      const b = rng() * Math.PI * 2, q = Math.sqrt(rng());
      const x = lx + Math.cos(b) * q * lr, y = ly + Math.sin(b) * q * lr * .85;
      if (x < 5 || x > w - 5 || y < 4) continue;
      const size = 3 + rng() * 5.5, under = Math.max(0, Math.sin(b)) * q, low = (y - h * .2) / (h * .4);
      const light = .62 + .38 * q - .32 * under - .18 * low + (rng() - .5) * .3;
      g.fillStyle = rgba(54 * light + 10, 82 * light + 12, 40 * light + 8, .96);
      g.beginPath(); g.ellipse(x, y, size, size * (.7 + rng() * .3), rng() * Math.PI, 0, Math.PI * 2); g.fill();
    }
  }
}

function palm(g: Context, w: number, h: number, rng: () => number): void {
  // A slender trunk, leaning and curving as coconut palms do.
  const lean = (rng() - .5) * w * .3, topX = w / 2 + lean, topY = h * .2;
  g.strokeStyle = rgba(104, 94, 78); g.lineCap = 'round';
  for (let k = 0; k < 16; k++) {
    const t0 = k / 16, t1 = (k + 1) / 16, width = 5 - 2.2 * t0;
    const at = (t: number) => [w / 2 + lean * t * t, h - (h - topY) * t] as const;
    const [x0, y0] = at(t0), [x1, y1] = at(t1);
    g.lineWidth = width; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  // Fronds radiating from the crown and arching down, each a spine with long leaflets hanging from both sides; the
  // ones behind the trunk darker.
  const fronds = 16;
  for (let k = 0; k < fronds; k++) {
    const angle = (k / fronds) * Math.PI * 2 + rng() * .25, side = Math.cos(angle), depth = Math.sin(angle);
    const length = w * (.4 + rng() * .1), arch = 10 + rng() * 14, fall = 26 + rng() * 34 * (1 - Math.abs(depth) * .5);
    const tone0 = depth > 0 ? .72 : 1;
    const point = (t: number) => [topX + side * length * t, topY - arch * Math.sin(Math.PI * t * .6) + fall * t * t + depth * 8 * t] as const;
    for (let s = 1; s <= 30; s++) {
      const t = s / 30, [x, y] = point(t), [px, py] = point(t - 1 / 30);
      const tone = tone0 * (.78 + .3 * rng());
      g.strokeStyle = rgba(86 * tone, 108 * tone, 52 * tone, 1); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke();
      const leaflet = (1 - t * .55) * 16;
      g.strokeStyle = rgba(80 * tone, 104 * tone, 50 * tone, .85); g.lineWidth = 1.2;
      for (const d of [-1, 1]) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + d * leaflet * .35 - side * 2, y + leaflet); g.stroke(); }
    }
  }
}

function conifer(g: Context, w: number, h: number, rng: () => number): void {
  g.fillStyle = rgba(58, 48, 38); g.fillRect(w / 2 - 2.5, h * .84, 5, h * .16);
  // Whorls of drooping branches, widest near the bottom, ragged and uneven, dark blue-green with lighter tips.
  const whorls = 26;
  for (let k = 0; k < whorls; k++) {
    const t = k / (whorls - 1), y = h * (.88 - .86 * t), half = w * .4 * (1 - t) ** .9 * (.7 + rng() * .45) + 3;
    for (let n = 0; n < 7; n++) {
      const s = rng() < .5 ? -1 : 1, reach = half * (.45 + rng() * .55);
      const tone = .55 + .45 * rng() * (1 - .3 * t);
      g.strokeStyle = rgba(30 * tone + 8, 48 * tone + 10, 38 * tone + 8, 1); g.lineWidth = 2.2 + rng() * 2;
      g.beginPath(); g.moveTo(w / 2, y - 4 - rng() * 4);
      g.quadraticCurveTo(w / 2 + s * reach * .6, y - 2, w / 2 + s * reach, y + 3 + rng() * 5); g.stroke();
    }
  }
  g.strokeStyle = rgba(40, 55, 44); g.lineWidth = 2; g.beginPath(); g.moveTo(w / 2, h * .04); g.lineTo(w / 2, h * .2); g.stroke();
}

function bare(g: Context, w: number, h: number, rng: () => number, birch: boolean): void {
  const branch = (x: number, y: number, angle: number, length: number, width: number, depth: number): void => {
    const x1 = x + Math.cos(angle) * length, y1 = y - Math.sin(angle) * length;
    const tone = birch && depth > 4 ? 196 : 76 + (7 - depth) * 6;
    g.strokeStyle = rgba(tone, tone * .93, tone * .88, depth > 2 ? 1 : .85); g.lineWidth = width;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x1, y1); g.stroke();
    if (depth === 0 || length < 3) {
      // Twigs: a fine purple-brown haze at the crown's edge, the colour a bare winter wood shows from afar.
      g.strokeStyle = rgba(92, 78, 76, .3); g.lineWidth = .8;
      for (let k = 0; k < 6; k++) { const a = angle + (rng() - .5) * 1.8; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 + Math.cos(a) * 7, y1 - Math.sin(a) * 7); g.stroke(); }
      return;
    }
    const children = depth > 5 ? 2 : 2 + (rng() < .5 ? 1 : 0);
    for (let k = 0; k < children; k++) {
      const turn = (k - (children - 1) / 2) * (.42 + rng() * .3) + (rng() - .5) * .3;
      branch(x1, y1, angle + turn, length * (.66 + rng() * .12), Math.max(.7, width * .66), depth - 1);
    }
  };
  g.lineCap = 'round';
  // The mass of fine twigs that makes a bare crown read as a rounded grey-brown dome from afar.
  const cx = w / 2, cy = h * (birch ? .42 : .5), rx = w * (birch ? .32 : .44), ry = h * (birch ? .3 : .3);
  for (let k = 0; k < 2000; k++) {
    const a = rng() * Math.PI * 2, q = Math.sqrt(rng()), x = cx + Math.cos(a) * q * rx, y = cy + Math.sin(a) * q * ry;
    const d = rng() * Math.PI * 2, tone = 70 + rng() * 30;
    g.strokeStyle = rgba(tone, tone * .86, tone * .84, .16 + .14 * (1 - q)); g.lineWidth = .9;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(d) * 6, y + Math.sin(d) * 6); g.stroke();
  }
  branch(w / 2, h, Math.PI / 2 + (rng() - .5) * .08, h * (birch ? .24 : .2), birch ? 4.5 : 6.5, 7);
}

let atlas: OffscreenCanvas | undefined;

/** The atlas canvas, drawn on first use. Undefined where there is no canvas (tests). */
export function treeAtlasCanvas(): OffscreenCanvas | undefined {
  if (atlas || typeof OffscreenCanvas === 'undefined') return atlas;
  const canvas = new OffscreenCanvas(CELL_WIDTH * TREE_KINDS.length, CELL_HEIGHT * TREE_VARIANTS);
  const g = canvas.getContext('2d');
  if (!g) return undefined;
  TREE_KINDS.forEach((kind, column) => {
    for (let row = 0; row < TREE_VARIANTS; row++) {
      g.save();
      g.translate(column * CELL_WIDTH, row * CELL_HEIGHT);
      g.beginPath(); g.rect(0, 0, CELL_WIDTH, CELL_HEIGHT); g.clip();
      const rng = random(1941 + column * 97 + row * 13);
      if (kind === 'broadleaf') broadleaf(g, CELL_WIDTH, CELL_HEIGHT, rng);
      else if (kind === 'palm') palm(g, CELL_WIDTH, CELL_HEIGHT, rng);
      else if (kind === 'conifer') conifer(g, CELL_WIDTH, CELL_HEIGHT, rng);
      else bare(g, CELL_WIDTH, CELL_HEIGHT, rng, row === 1);
      g.restore();
    }
  });
  return atlas = canvas;
}

/** The atlas as a mip-mapped texture (sRGB colour, alpha coverage). */
export function treeAtlasTexture(): THREE.Texture {
  const canvas = treeAtlasCanvas();
  const texture = canvas ? new THREE.CanvasTexture(canvas) : new THREE.DataTexture(new Uint8Array(4), 1, 1);
  Object.assign(texture, { colorSpace: THREE.SRGBColorSpace, magFilter: THREE.LinearFilter, minFilter: THREE.LinearMipmapLinearFilter,
    generateMipmaps: !!canvas, anisotropy: 4, name: 'Tree impostors' });
  texture.needsUpdate = true;
  return texture;
}
