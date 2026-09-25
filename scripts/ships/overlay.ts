/** `ship:overlay <id>`: our published GLB against a cached `ship:reference`, from the same camera.
 * Ours-only pixels are red, reference-only blue, shared grey; IoU per shot goes to summary.json.
 * A GameModels3D model is not centred on our midships, and its waterline datum can differ from ours, so the
 * reference is shifted: matched fore and aft on the waterline half-breadths, then refined fore and aft and up
 * and down on the side and top silhouettes. `--offset` overrides that. `--textured` renders the textured
 * reference and our model from the same cameras as paired images; `--sections` cuts both by the same planes.
 * Output: `.build/ships/<id>/overlay/`.
 * Diagnostic only: reference geometry is read here and never reaches `assets/` or `public/`. */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runBlender } from '../build/blender';
import { readReferenceMeta, referenceDirectory, selectTriangles } from '../construction/reference';
import { suggestedVehicles } from '../../tools/ship-overlay/reference';
import { cameraPin, parseCameraPose, parseVec3, type CameraPose } from '../browser/cameraPoses';
import { compareCuts, cut, drawSections, parseSections, type SectionSpec } from './sections';
import type { ShipDefinition, Vec3 } from '../../src/ships/blueprint';

const ROOT = resolve(import.meta.dir, '../..');
export const VIEWS = ['side', 'top', 'front', 'stern'] as const;
export type View = (typeof VIEWS)[number];
export const NAMED_SHOTS = [...VIEWS, 'bridge', 'aft'] as const;
type Box = [number | null, number | null, number | null, number | null, number | null, number | null];
export type Shot = { name: string; view: View; box: Box; px: number; margin?: number } | { name: string; pin: { eye: Vec3; target: Vec3; fov?: number; ortho?: number }; px: number };

export interface OverlayOptions {
  id: string;
  reference?: string;
  shots: string[];
  box?: number[];
  camera?: { pose: CameraPose; fov?: number; ortho?: number };
  parts?: string[];
  offset?: Vec3;
  align: 'silhouette' | 'fore-aft' | 'waterline' | 'none';
  px: number;
  fetch: boolean;
  textured: boolean;
  paint?: string;
  sections: SectionSpec[];
}

const HELP = `bun run ship:overlay <ship-id> [options]
  --reference <name|id>   cached ship:reference (default: the ship's suggested GameModels3D vehicle)
  --shots a,b,…            ${NAMED_SHOTS.join(', ')} (default side,top,front,bridge,aft)
  --box x0,y0,z0,x1,y1,z1  add side/top/front views of this box, clipped to it in depth
  --camera <preset|az,el[,m]> | --eye x,y,z --target x,y,z   one extra shot with this camera
  --fov <deg> | --ortho <m>  lens for that shot (perspective by default)
  --parts a,b,…            reference groups or part keys to draw (as ship:slice)
  --offset z|x,y,z         reference shift in metres instead of the fitted alignment
  --align silhouette|fore-aft|waterline|none   waterline match, then silhouette refinement fore and aft and up
                           and down (default); the same without the vertical; waterline only; none
  --textured               also render the textured reference and our model from each shot's camera under one
                           light: <shot>-reference.png, -ours.png and -pair.png in overlay/textured/
  --paint <id>             reference paint scheme for --textured (default: the source's default)
  --sections z=-40,y=6.5,x=0   cut both models by these planes (stations, plans, profiles) into
                           section-<axis><value>.png, reference blue and ours red on a metre grid
  --px <n>                 image width for full-length views (default 2400)
  --no-fetch               fail instead of running ship:reference for an uncached reference`;

export function parseOverlayArgs(argv: string[]): OverlayOptions {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    if (i < 0) return undefined;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) throw new Error(`${flag} needs a value.`);
    return next;
  };
  const switches = new Set(['--no-fetch', '--textured', '--help']);
  const id = argv.find((a, i) => !a.startsWith('--') && !(argv[i - 1]?.startsWith('--') && !switches.has(argv[i - 1]))) ?? argv[0];
  if (!id || id.startsWith('--')) throw new Error(HELP);
  const known = new Set(['--reference', '--shots', '--box', '--camera', '--eye', '--target', '--fov', '--ortho', '--parts', '--offset', '--align', '--px', '--no-fetch', '--textured', '--paint', '--sections', '--help']);
  for (const a of argv) if (a.startsWith('--') && !known.has(a)) throw new Error(`Unknown flag ${a}.\n${HELP}`);
  const shots = (value('--shots') ?? 'side,top,front,bridge,aft').split(',').map(s => s.trim()).filter(Boolean);
  for (const s of shots) if (!(NAMED_SHOTS as readonly string[]).includes(s)) throw new Error(`Unknown shot "${s}". Shots: ${NAMED_SHOTS.join(', ')}.`);
  const numbers = (flag: string, count: number[]) => {
    const text = value(flag);
    if (text === undefined) return undefined;
    const n = text.split(',').map(Number);
    if (!count.includes(n.length) || n.some(v => !Number.isFinite(v))) throw new Error(`${flag} takes ${count.join(' or ')} numbers; got "${text}".`);
    return n;
  };
  const box = numbers('--box', [6]);
  const offset = numbers('--offset', [1, 3]);
  const eye = value('--eye'), target = value('--target'), cameraText = value('--camera');
  if (eye && cameraText) throw new Error('Give either --camera or --eye/--target, not both.');
  const fov = numbers('--fov', [1])?.[0], ortho = numbers('--ortho', [1])?.[0];
  let camera: OverlayOptions['camera'];
  if (eye) camera = { pose: { eye: parseVec3(eye, '--eye'), ...(target ? { target: parseVec3(target, '--target') } : {}) }, fov, ortho };
  else if (cameraText) camera = { pose: parseCameraPose(cameraText), fov, ortho };
  else if (target || fov !== undefined || ortho !== undefined) throw new Error('--target, --fov and --ortho need --camera or --eye.');
  const align = value('--align') ?? 'silhouette';
  if (align !== 'silhouette' && align !== 'fore-aft' && align !== 'waterline' && align !== 'none') throw new Error('--align takes silhouette, fore-aft, waterline or none.');
  const sections = value('--sections');
  const px = numbers('--px', [1])?.[0] ?? 2400;
  if (px < 256 || px > 6000) throw new Error('--px takes 256 to 6000.');
  return {
    id, reference: value('--reference'), shots, box, camera, align, px, fetch: !argv.includes('--no-fetch'),
    textured: argv.includes('--textured'), paint: value('--paint'), sections: sections ? parseSections(sections) : [],
    parts: value('--parts')?.split(',').filter(Boolean),
    offset: offset ? (offset.length === 1 ? [0, 0, offset[0]] : offset) as Vec3 : undefined,
  };
}

/** Concrete shots in the runtime frame. Zooms centre on the definition's bridge viewpoint and on its
 * tallest structure abaft midships; boxes left open (null) are filled from the drawn geometry. */
export function resolveShots(options: OverlayOptions, definition: ShipDefinition): Shot[] {
  const length = definition.hull.length;
  const zoom = Math.min(56, length * .4);
  const structures = definition.structures ?? [];
  const tallestAft = structures
    .map(s => ({ z: s.footprint.reduce((n, p) => n + p[1], 0) / s.footprint.length, top: s.baseY + s.height }))
    .filter(s => s.z > length * .05)
    .sort((a, b) => b.top - a.top)[0]?.z ?? length * .22;
  const bridge = definition.viewpoints?.bridge?.[2] ?? -length * .15;
  const centred = (z: number): Box => [null, null, z - zoom / 2, null, null, z + zoom / 2];
  const shots: Shot[] = options.shots.map(name => {
    if (name === 'bridge') return { name, view: 'side' as View, box: centred(bridge), px: 1600, margin: 0 };
    if (name === 'aft') return { name, view: 'side' as View, box: centred(tallestAft), px: 1600, margin: 0 };
    return { name, view: name as View, box: [null, null, null, null, null, null] as Box, px: name === 'side' || name === 'top' ? options.px : 1200 };
  });
  if (options.box) {
    const b = options.box as Box;
    for (const view of ['side', 'top', 'front'] as View[]) shots.push({ name: `box-${view}`, view, box: b, px: 1600, margin: 0 });
  }
  if (options.camera) {
    const pin = cameraPin(options.camera.pose, length);
    shots.push({ name: 'camera', pin: { eye: pin.eye as Vec3, target: pin.target as Vec3, ...(options.camera.ortho ? { ortho: options.camera.ortho } : { fov: options.camera.fov ?? pin.fov ?? 40 }) }, px: 1600 });
  }
  return shots;
}

export async function overlay(options: OverlayOptions, root = ROOT) {
  const glb = join(root, 'public/models', options.id + '.glb');
  const definitionPath = join(root, 'public/models', options.id + '.json');
  if (!existsSync(glb) || !existsSync(definitionPath)) throw new Error(`No published model for "${options.id}". Build it with bun run ship:build ${options.id}.`);
  const definition = JSON.parse(await readFile(definitionPath, 'utf8')) as ShipDefinition;
  const reference = options.reference ?? suggestedVehicles[options.id];
  if (!reference) throw new Error(`No suggested reference for "${options.id}"; pass --reference <name|GameModels3D id>.`);
  if (!existsSync(join(referenceDirectory(root, reference), 'reference.json'))) {
    if (!options.fetch) throw new Error(`No cached reference "${reference}". Run bun run ship:reference ${reference}.`);
    console.error(`Caching reference ${reference} with ship:reference (network)…`);
    const child = Bun.spawnSync(['bun', 'scripts/construction/cli.ts', 'reference', reference], { cwd: root, stdout: 'ignore', stderr: 'inherit' });
    if (child.exitCode !== 0) throw new Error(`ship:reference ${reference} failed.`);
  }
  const meta = await readReferenceMeta(root, reference);
  const out = join(root, '.build/ships', options.id, 'overlay');
  await mkdir(out, { recursive: true });
  const hullGroup = meta.parts.some(p => p.group === 'hull') ? ['hull'] : undefined;
  const job = {
    glb, out,
    referenceMesh: join(referenceDirectory(root, reference), 'mesh.bin'),
    ranges: options.parts?.length ? selectTriangles(meta, options.parts) : [],
    hullRanges: hullGroup ? selectTriangles(meta, hullGroup) : [],
    align: options.align, offset: options.offset ?? null,
    shots: resolveShots(options, definition),
  };
  const jobFile = join(out, 'job.json');
  await writeFile(jobFile, JSON.stringify(job, null, 2) + '\n');
  const run = await runBlender(join(root, 'scripts/ships/overlay.py'), {}, { cwd: root, args: [jobFile], log: join(out, 'blender.log') });
  const line = run.stdout.split('\n').find(l => l.startsWith('OVERLAY_SUMMARY '));
  if (!line) throw new Error('Overlay render produced no summary; see ' + join(out, 'blender.log'));
  const summary = JSON.parse(line.slice('OVERLAY_SUMMARY '.length)) as OverlaySummary;
  const offset = summary.offset;
  const result: Record<string, unknown> = { ship: options.id, reference, ...summary, offsetFlag: '--offset ' + offset.join(','), hint: alignmentHint(summary, options) };
  if (options.sections.length) result.sections = await sectionCuts(root, glb, reference, offset, options, out);
  if (options.textured) {
    const { renderReference } = await import('../construction/referenceRender');
    const cameras = summary.shots.map(shot => ({ name: shot.name, ...shot.camera }));
    const rendered = await renderReference(root, meta, { cameras, model: glb, offset, paint: options.paint, parts: options.parts, out: join(out, 'textured') });
    result.textured = rendered.shots.map(shot => shot.file);
  }
  await writeFile(join(out, 'summary.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

interface OverlaySummary {
  offset: Vec3;
  fitted: boolean;
  shots: { name: string; view: string; iou: number; camera: { eye: Vec3; target: Vec3; up: Vec3; ortho?: number; fov?: number; size: [number, number]; clip?: [number, number] } }[];
}

/** A word when the side silhouettes still disagree: usually a vertical datum the fit was not allowed to find. */
export function alignmentHint(summary: Pick<OverlaySummary, 'offset' | 'fitted' | 'shots'>, options: Pick<OverlayOptions, 'align'>): string | undefined {
  const side = summary.shots.find(s => s.name === 'side');
  const [, dy, dz] = summary.offset;
  if (summary.fitted && options.align === 'silhouette')
    return Math.abs(dy) >= 0.05
      ? `The reference is drawn ${Math.abs(dy).toFixed(2)} m ${dy > 0 ? 'lower' : 'higher'} than ours (a different waterline datum); ` +
        `pass --offset ${summary.offset.join(',')} to ship:reference --render and other comparisons.`
      : undefined;
  if (side && side.iou < 0.93) return `Side IoU ${side.iou} is low. Run without --offset and with the default --align silhouette to fit the vertical datum as well (fore-and-aft shift now ${dz}).`;
  return undefined;
}

/** `--sections`: the reference (shifted by the overlay offset) and our GLB cut by each plane. */
async function sectionCuts(root: string, glb: string, reference: string, offset: Vec3, options: OverlayOptions, out: string) {
  const { readReference } = await import('../construction/reference');
  const { parseGlb } = await import('../construction/referenceFile');
  const { meshView } = await import('../construction/slice');
  const mesh = await readReference(root, reference);
  const referenceView = meshView(mesh, options.parts);
  const parts = parseGlb(await readFile(glb));
  const positions = new Float32Array(parts.reduce((n, p) => n + p.positions.length, 0));
  const index = new Uint32Array(parts.reduce((n, p) => n + p.index.length, 0));
  let vertices = 0, at = 0;
  for (const part of parts) {
    positions.set(part.positions, vertices * 3);
    for (const i of part.index) index[at++] = i + vertices;
    vertices += part.positions.length / 3;
  }
  const ours = { positions, index, ranges: [{ first: 0, count: index.length / 3 }] };
  const box = options.box && { min: options.box.slice(0, 3) as Vec3, max: options.box.slice(3) as Vec3 };
  const rows = [];
  for (const spec of options.sections) {
    const a = cut(referenceView, spec, offset, box), b = cut(ours, spec, [0, 0, 0], box);
    const drawing = drawSections(spec, a, b);
    const file = join(out, `section-${spec.axis}${spec.value}.png`);
    await writeFile(file, drawing.png);
    rows.push({ plane: `${spec.axis}=${spec.value}`, file, right: drawing.right, up: drawing.up, pixelsPerMetre: drawing.pixelsPerMetre, segments: { reference: a.length, ours: b.length }, halfBreadth: compareCuts(spec, a, b) });
  }
  return rows;
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    if (!argv.length || argv.includes('--help')) { console.log(HELP); process.exit(argv.length ? 0 : 1); }
    console.log(JSON.stringify(await overlay(parseOverlayArgs(argv)), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
