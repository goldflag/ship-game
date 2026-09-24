/** The one headless Blender launcher for the ship, part and aircraft pipelines and the construction
 * front end. Blender always runs in the background with factory settings (no user add-ons or
 * preferences) and a Python error fails the process.
 *
 * `scripts/parts/equipment.ts` keeps its own copy for now: its text is an input of the published
 * equipment catalog identity (`scripts/parts/publish.ts`), so editing it means republishing the catalog.
 * Move it here together with the next equipment publication. */
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const MAC_APP = '/Applications/Blender.app/Contents/MacOS/Blender';

/** `BLENDER_BIN`, then the standard macOS application, then `blender` on PATH. */
export function blenderExecutable(): string {
  return process.env.BLENDER_BIN ?? (existsSync(MAC_APP) ? MAC_APP : 'blender');
}

/** The installed version string, or undefined when no Blender can be started. */
export function blenderVersion(): string | undefined {
  const probe = spawnSync(blenderExecutable(), ['--version'], { encoding: 'utf8', timeout: 60_000 });
  if (probe.status !== 0) return undefined;
  return probe.stdout.match(/Blender ([\d.]+)/)?.[1];
}

/** What an audited run may not read. `reference` is the ship pipeline's rule: the reference cache,
 * raw game model formats and the preserved Bismarck baseline. `published` adds every published model
 * and any glTF file, for scenes that must be built from source data only. */
export type BlenderForbid = 'reference' | 'published';
export interface BlenderAudit {
  /** Reads under this directory are recorded, relative to it. */
  root: string;
  /** Where the recorded reads are written as a sorted JSON list. */
  readsFile?: string;
  forbid?: BlenderForbid;
}
export interface BlenderOptions {
  cwd?: string;
  /** Install a Python audit hook before the script runs: no network, no forbidden geometry. */
  audit?: BlenderAudit;
  /** Python run before the audit hook and the script, and after it. Only with `audit`. */
  prelude?: string;
  epilogue?: string;
  /** Where stdout and stderr are written, whatever the outcome. */
  log?: string;
  /** Extra arguments after `--`, readable in the script from `sys.argv`. */
  args?: string[];
}
export interface BlenderRun {
  stdout: string;
  stderr: string;
  version: string;
}

const py = (value: string) => JSON.stringify(value);

/** The audit hook as Python. The hook sees Python-level opens only; Blender's own C file access
 * (opening a .blend) is not audited, so it supplements, not replaces, a clean rebuild. */
export function blenderAuditHook(audit: BlenderAudit): string {
  const substrings = ['/reference-cache', '/bismarck/baseline/', ...(audit.forbid === 'published' ? [audit.root + '/public/models/'] : [])];
  const suffixes = ['.model', '.geometry', ...(audit.forbid === 'published' ? ['.glb', '.gltf'] : [])];
  return `import sys, os, re, json, runpy, importlib.util
_blender_reads=set()
def _blender_audit(event,args):
 if event=='socket.connect': raise RuntimeError('Network access is not an authoring dependency')
 if event=='open' and isinstance(args[0],(str,bytes)):
  p=os.path.realpath(os.fsdecode(args[0]))
  # Python writes fresh bytecode through a temporary name.pyc.<digits> before renaming it.
  if '/__pycache__/' in p: p=re.sub(r'\\.pyc\\.\\d+$','.pyc',p)
  if p.endswith('.pyc') and '/__pycache__/' in p: p=importlib.util.source_from_cache(p)
  if any(s in p for s in ${JSON.stringify(substrings)}) or p.endswith(tuple(${JSON.stringify(suffixes)})):
   raise RuntimeError('Reference/baseline geometry is forbidden in original authoring: '+p)
  if p.startswith(${py(audit.root)}): _blender_reads.add(os.path.relpath(p,${py(audit.root)}))
sys.addaudithook(_blender_audit)
`;
}

/** Run `script` in a fresh background Blender. Throws with the log tail when Blender exits nonzero. */
export async function runBlender(script: string, env: Record<string, string> = {}, options: BlenderOptions = {}): Promise<BlenderRun> {
  const { audit } = options;
  if (!audit && (options.prelude || options.epilogue)) throw new Error('runBlender: prelude and epilogue need an audited run.');
  const python = audit
    ? [
        '--python-expr',
        (options.prelude ?? '') +
          '\n' +
          blenderAuditHook(audit) +
          `runpy.run_path(${py(script)},run_name='__main__')\n` +
          (options.epilogue ?? '') +
          (audit.readsFile ? `\nwith open(${py(audit.readsFile)},'w') as f: json.dump(sorted(_blender_reads),f,indent=2)\n` : ''),
      ]
    : ['--python', script];
  const child = Bun.spawn(
    [blenderExecutable(), '--background', '--factory-startup', '--python-exit-code', '1', ...python, ...(options.args?.length ? ['--', ...options.args] : [])],
    { cwd: options.cwd, env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' },
  );
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (options.log) await writeFile(options.log, stdout + stderr);
  if (code !== 0)
    throw new Error(`Blender failed (${code})${options.log ? '; log in ' + options.log : ''}:\n${(stdout + stderr).slice(-6000)}`);
  return { stdout, stderr, version: stdout.match(/Blender ([\d.]+)/)?.[1] ?? 'unknown' };
}
