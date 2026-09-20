import { DEFAULT_HULL_PRESET, HULL_PRESETS } from '../../src/ships/constructionHullPresets';
import type { FlagSpec } from './command';

/** Every accepted flag per command. An unknown or misspelled flag is an error, never ignored. */
export const FLAGS: Record<string, FlagSpec> = {
  templates: { ship: false },
  new: { values: ['--template', '--name'] },
  edit: { values: ['--port'] },
  inspect: { switches: ['--source', '--source-only', '--panels', '--brief'] },
  catalog: { values: ['--query', '--kind', '--ids'], switches: ['--brief'] },
  suggest: { values: ['--parts', '--out'] },
  apply: { switches: ['--dry-run', '--brief'], positionals: 1 },
  import: { values: ['--expect'], positionals: 1 },
  export: { positionals: 1 },
  render: { values: ['--view', '--part', '--out', '--pose'], switches: ['--isolate', '--published', '--quick'] },
  trial: { values: ['--seconds', '--out'], switches: ['--published'] },
  register: {},
  compile: { switches: ['--force'] },
  build: { switches: ['--force'] },
  check: { switches: ['--force'] },
  review: { switches: ['--force'] },
  thumbnail: { switches: ['--force'] },
};
export const BUILTIN_SUMMARIES = {
  templates: '— list adjustable hull presets and sandbox starters; no ship ID required',
  new: `[--template ${[...HULL_PRESETS.map((p) => p.id), 'blank', 'patrol', 'catamaran'].join('|')}] [--name name]; default ${DEFAULT_HULL_PRESET}`,
  edit: '[--port 5173] — serve the repository source in the game editor',
  inspect:
    '[--brief] [--source] [--source-only] [--panels] — revisions, native diagnostics/loading, optional source and stable panel IDs; source-only skips compilation; brief returns counts, diagnostics and loading totals only',
  catalog: '[--query text] [--kind kind] [--ids id,id] [--brief] — exact retained equipment variants, dimensions and attachment sockets; brief keeps id, name, kind, placement and dimensions',
  suggest: '--parts id,id [--out batch.json] — propose native placements as a revision-guarded batch; never saves the ship',
  apply: '<batch.json> [--dry-run [--brief]] — revision-guarded transaction; dry-run compiles the candidate without saving; brief omits per-item mass contributions',
  import: '<source.json> [--expect file-hash] — create or explicitly replace a construction source',
  export: '<output.json> — exact source backup',
  render:
    '[--view profile|plan|bow|stern|quarter] [--part id] [--isolate] [--out directory] [--published] [--pose poses.json] [--quick]; quick skips the articulation sweep',
  trial: '[--seconds 10] — real local native/WASM combat and reset',
  register: '— add an already built ship to src/ships/presets.ts',
  compile: 'native definition; also available through ship:compile',
  build: 'GLB, native definition, thumbnail and fixed review views',
  check: 'source, catalog and published artifact integrity',
  review: 'fixed views and articulation of the exact published GLB',
  thumbnail: 'refresh the published thumbnail',
} satisfies Record<keyof typeof FLAGS, string> as Record<string, string>;
/** Built-in commands as the MCP server and help see them: flags plus the one-line summary. */
export const BUILTIN_COMMANDS: Record<string, FlagSpec & { summary: string }> = Object.fromEntries(
  Object.entries(FLAGS).map(([name, spec]) => [name, { ...spec, summary: BUILTIN_SUMMARIES[name] }]),
);
