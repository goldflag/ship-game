/** `ship:overlay <id>`: our published GLB against a cached `ship:reference`, from the same camera.
 * Ours-only pixels are red, reference-only blue, shared grey; IoU per shot goes to summary.json.
 * A GameModels3D model is not centred on our midships, so the reference is shifted fore and aft:
 * matched on the waterline half-breadths, then refined on the side and top silhouettes. `--offset`
 * overrides that. Output: `.build/ships/<id>/overlay/`.
 * Diagnostic only: reference geometry is read here and never reaches `assets/` or `public/`. */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { runBlender } from '../build/blender';
import { readReferenceMeta, referenceDirectory, selectTriangles } from '../construction/reference';
import { suggestedVehicles } from '../../tools/ship-overlay/reference';
import { cameraPin, parseCameraPose, parseVec3, type CameraPose } from '../browser/cameraPoses';
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
  align: 'silhouette' | 'waterline' | 'none';
  px: number;
  fetch: boolean;
}

const HELP = `bun run ship:overlay <ship-id> [options]
  --reference <name|id>   cached ship:reference (default: the ship's suggested GameModels3D vehicle)
  --shots a,b,…            ${NAMED_SHOTS.join(', ')} (default side,top,front,bridge,aft)
  --box x0,y0,z0,x1,y1,z1  add side/top/front views of this box, clipped to it in depth
  --camera <preset|az,el[,m]> | --eye x,y,z --target x,y,z   one extra shot with this camera
  --fov <deg> | --ortho <m>  lens for that shot (perspective by default)
  --parts a,b,…            reference groups or part keys to draw (as ship:slice)
  --offset z|x,y,z         reference shift in metres instead of the waterline alignment
  --align silhouette|waterline|none   waterline match, then silhouette refinement (default); waterline only; none
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
  const id = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--')) ?? argv[0];
  if (!id || id.startsWith('--')) throw new Error(HELP);
  const known = new Set(['--reference', '--shots', '--box', '--camera', '--eye', '--target', '--fov', '--ortho', '--parts', '--offset', '--align', '--px', '--no-fetch', '--help']);
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
  if (align !== 'silhouette' && align !== 'waterline' && align !== 'none') throw new Error('--align takes silhouette, waterline or none.');
  const px = numbers('--px', [1])?.[0] ?? 2400;
  if (px < 256 || px > 6000) throw new Error('--px takes 256 to 6000.');
  return {
    id, reference: value('--reference'), shots, box, camera, align, px, fetch: !argv.includes('--no-fetch'),
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
  return { ship: options.id, reference, ...JSON.parse(line.slice('OVERLAY_SUMMARY '.length)) };
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
