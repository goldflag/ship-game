import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { BUILTIN_COMMANDS } from './builtins';
import { commandSummaries, loadCommand, type FlagSpec } from './command';

/** A thin Model Context Protocol server (stdio, newline-delimited JSON-RPC) over the construction CLI.
 * Every tool is one CLI command run as a child process, so tools, flags and results cannot drift
 * from `ship:*`, guarded batches stay atomic, and a warm session is used whenever one is live. */
const root = resolve(import.meta.dir, '../..');
const cli = join(import.meta.dir, 'cli.ts');
const PROTOCOL = '2024-11-05';
/** Commands that never return (`edit`) or manage the host rather than a ship are not tools. */
const HIDDEN = new Set(['edit', 'timings']);
/** Commands that change the repository. Everything else is announced read-only. */
const WRITES = new Set(['new', 'apply', 'import', 'register', 'build', 'thumbnail', 'session']);
/** A positional JSON file becomes an inline object: the server writes it to a scratch file. */
const INLINE: Record<string, string> = { apply: 'batch', import: 'source' };
const MAX_TEXT = 60_000,
  MAX_IMAGES = 6;

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean };
}
const property = (flag: string) => flag.slice(2).replaceAll('-', '_');

export function toolFor(name: string, spec: FlagSpec & { summary: string }): Tool {
  const properties: Record<string, unknown> = {},
    required: string[] = [];
  if (spec.ship !== false) {
    properties.ship = { type: 'string', description: 'Ship ID: the directory name under assets/ships.' };
    required.push('ship');
  }
  for (const flag of spec.values ?? []) properties[property(flag)] = { type: ['string', 'number'], description: flag + ' <value>' };
  for (const flag of spec.switches ?? []) properties[property(flag)] = { type: 'boolean', description: flag };
  if (INLINE[name]) {
    properties[INLINE[name]] = { type: 'object', description: 'The JSON document this command reads. `schema` describes a batch.' };
    required.push(INLINE[name]);
  } else if (spec.positionals)
    properties.arguments = { type: 'array', items: { type: 'string' }, maxItems: spec.positionals, description: 'Positional arguments after the ship ID.' };
  return {
    name: 'ship_' + name.replaceAll('-', '_'),
    description: spec.summary.replace(/^—\s*/, ''),
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
    annotations: { readOnlyHint: !WRITES.has(name), destructiveHint: WRITES.has(name) },
  };
}

export async function commands(): Promise<Record<string, FlagSpec & { summary: string }>> {
  const result: Record<string, FlagSpec & { summary: string }> = {};
  for (const [name, spec] of Object.entries(BUILTIN_COMMANDS)) if (!HIDDEN.has(name)) result[name] = spec;
  for (const name of Object.keys(await commandSummaries())) if (!HIDDEN.has(name)) result[name] = (await loadCommand(name))!;
  return result;
}

/** Tool input to the exact command line; unknown properties are errors, like unknown CLI flags. */
export function commandLine(name: string, spec: FlagSpec, input: Record<string, unknown>, inlineFile?: string): string[] {
  const line = [name];
  const rest = new Map(Object.entries(input));
  if (spec.ship !== false) {
    if (typeof input.ship !== 'string' || !input.ship) throw new Error('ship is required.');
    line.push(input.ship);
    rest.delete('ship');
  }
  if (INLINE[name]) {
    if (!inlineFile) throw new Error(INLINE[name] + ' is required.');
    line.push(inlineFile);
    rest.delete(INLINE[name]);
  } else if (Array.isArray(input.arguments)) {
    line.push(...input.arguments.map(String));
    rest.delete('arguments');
  }
  for (const flag of spec.values ?? []) {
    const value = rest.get(property(flag));
    rest.delete(property(flag));
    if (value !== undefined && value !== null) line.push(flag, String(value));
  }
  for (const flag of spec.switches ?? []) {
    const value = rest.get(property(flag));
    rest.delete(property(flag));
    if (value === true) line.push(flag);
    else if (value !== undefined && value !== false) throw new Error(property(flag) + ' must be a boolean.');
  }
  if (rest.size) throw new Error('Unknown argument ' + [...rest.keys()].join(', ') + '. Nothing was run.');
  return line;
}

const pngPaths = (value: unknown, found: string[] = []): string[] => {
  if (typeof value === 'string' && value.endsWith('.png') && value.startsWith('/')) found.push(value);
  else if (value && typeof value === 'object') for (const child of Object.values(value)) pngPaths(child, found);
  return found;
};

async function call(name: string, spec: FlagSpec, input: Record<string, unknown>) {
  const scratch = join(root, '.build/construction/mcp');
  let inlineFile: string | undefined;
  if (INLINE[name] && input[INLINE[name]] !== undefined) {
    await mkdir(scratch, { recursive: true });
    inlineFile = join(scratch, crypto.randomUUID() + '.json');
    await writeFile(inlineFile, JSON.stringify(input[INLINE[name]]));
  }
  try {
    const line = commandLine(name, spec, input, inlineFile);
    const child = spawn(process.execPath, [cli, ...line], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (data) => (stdout += data));
    child.stderr.on('data', (data) => (stderr += data));
    const code = await new Promise<number | null>((done, fail) => (child.on('error', fail), child.on('close', done)));
    let text = stdout.trim() || stderr.trim();
    if (code !== 0 && stdout.trim() && stderr.trim()) text = stdout.trim() + '\n' + stderr.trim();
    const content: Record<string, unknown>[] = [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      /* Failures and partial output are returned as text. */
    }
    if (text.length > MAX_TEXT)
      text = text.slice(0, MAX_TEXT) + '\n… truncated ' + (text.length - MAX_TEXT) + ' characters. Use ship_summary, ship_get or narrower flags.';
    content.push({ type: 'text', text });
    for (const path of [...new Set(pngPaths(parsed))].slice(0, MAX_IMAGES))
      content.push({ type: 'image', mimeType: 'image/png', data: (await readFile(path)).toString('base64') });
    return { content, isError: code !== 0 };
  } finally {
    if (inlineFile) await rm(inlineFile, { force: true });
  }
}

export async function handle(message: { id?: unknown; method?: string; params?: Record<string, unknown> }) {
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: message.id, result });
  switch (message.method) {
    case 'initialize':
      return reply({
        protocolVersion: PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: 'ship-construction', version: '1' },
        instructions:
          'Author construction ships in this repository. Read with ship_summary, ship_get, ship_bounds and ship_near before ship_inspect. ' +
          'Edit only through ship_apply with a revision-guarded batch (ship_schema describes it); use dry_run first. ' +
          'Place equipment with ship_place and ship_reseat instead of computing heights. Look with ship_view. The native compiler is authoritative.',
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: Object.entries(await commands()).map(([name, spec]) => toolFor(name, spec)) });
    case 'tools/call': {
      const all = await commands();
      const name = Object.keys(all).find((name) => toolFor(name, all[name]).name === message.params?.name);
      if (!name) return reply({ content: [{ type: 'text', text: 'Unknown tool.' }], isError: true });
      try {
        return reply(await call(name, all[name], (message.params?.arguments as Record<string, unknown>) ?? {}));
      } catch (error) {
        return reply({ content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }], isError: true });
      }
    }
    default:
      // Notifications carry no ID and take no reply.
      return message.id === undefined ? undefined : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found.' } };
  }
}

if (import.meta.main) {
  // Calls run one at a time: guarded batches and the shared renderer must not interleave.
  let queue = Promise.resolve();
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) continue;
    queue = queue.then(async () => {
      let response;
      try {
        response = await handle(JSON.parse(line));
      } catch {
        response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } };
      }
      if (response) process.stdout.write(JSON.stringify(response) + '\n');
    });
  }
  await queue;
}
