import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The flags one command accepts. Anything else on its command line is rejected. */
export interface FlagSpec {
  /** Flags followed by a value, such as `--out file.json`. */
  values?: string[];
  /** Value flags whose value may be left out, with the value they then take (`--vs` means `--vs origin/master`). */
  defaults?: Record<string, string>;
  /** Flags that stand alone, such as `--dry-run`. */
  switches?: string[];
  /** Positional arguments allowed after the ship ID. */
  positionals?: number;
  /** False for a command that takes no ship ID. */
  ship?: boolean;
  /** True for a command that can change the repository or an account, so MCP announces it as a write. */
  writes?: boolean;
}
export interface CommandContext {
  root: string;
  id: string;
  positionals: string[];
  option(flag: string): string | undefined;
  has(flag: string): boolean;
  print(value: unknown): void;
}
/** One `scripts/construction/commands/<name>.ts` module. Its default export is a `CliCommand`.
 * Keep top-level imports light; load Vite, Playwright or the pipeline inside `run`. */
export interface CliCommand extends FlagSpec {
  summary: string;
  /** Return a value to print it as JSON; set `process.exitCode` for a failure that still reports. */
  run(context: CommandContext): Promise<unknown>;
}

const closest = (flag: string, known: string[]) => {
  const bare = (value: string) => value.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return known.find((candidate) => bare(candidate) === bare(flag) || bare(candidate).startsWith(bare(flag)) || bare(flag).startsWith(bare(candidate)));
};

export function parseFlags(input: string[], spec: FlagSpec) {
  const values = new Map<string, string>(),
    switches = new Set<string>(),
    positionals: string[] = [];
  const known = [...(spec.values ?? []), ...(spec.switches ?? [])];
  for (let i = 0; i < input.length; i++) {
    const word = input[i];
    if (!word.startsWith('--')) {
      positionals.push(word);
      continue;
    }
    if (values.has(word) || switches.has(word)) throw new Error('Flag ' + word + ' was given twice.');
    if (spec.switches?.includes(word)) switches.add(word);
    else if (spec.values?.includes(word)) {
      const next = input[i + 1];
      if (next === undefined || next.startsWith('--')) {
        const fallback = spec.defaults?.[word];
        if (fallback === undefined) throw new Error('Flag ' + word + ' requires a value.');
        values.set(word, fallback);
        continue;
      }
      values.set(word, input[++i]);
    } else {
      const hint = closest(word, known);
      throw new Error(
        'Unknown flag ' + word + '.' + (hint ? ' Did you mean ' + hint + '?' : '') + ' Accepted: ' + (known.join(', ') || 'none') + '. Nothing was changed.',
      );
    }
  }
  const id = spec.ship === false ? '' : (positionals.shift() ?? '');
  if (positionals.length > (spec.positionals ?? 0)) throw new Error('Unexpected argument ' + JSON.stringify(positionals[spec.positionals ?? 0]) + '.');
  return { id, positionals, option: (flag: string) => values.get(flag), has: (flag: string) => switches.has(flag) };
}

const directory = join(import.meta.dir, 'commands');
const valid = (name: string) => /^[a-z][a-z-]*$/.test(name);
export async function loadCommand(name: string): Promise<CliCommand | undefined> {
  if (!valid(name) || !existsSync(join(directory, name + '.ts'))) return undefined;
  return (await import(join(directory, name + '.ts'))).default as CliCommand;
}
export async function commandSummaries(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const file of (await readdir(directory).catch(() => [])).sort()) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const command = await loadCommand(file.slice(0, -3));
    if (command) result[file.slice(0, -3)] = command.summary;
  }
  return result;
}
