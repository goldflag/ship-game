import { expect, test } from 'bun:test';
import { commandLine, commands, handle, toolFor } from './mcp';
import { parseFlags } from './command';
import { FLAGS } from './builtins';

test('a misspelled flag is rejected instead of ignored', () => {
  expect(() => parseFlags(['valiant', 'batch.json', '--dryrun'], FLAGS.apply)).toThrow('Did you mean --dry-run?');
  expect(() => parseFlags(['valiant', '--view'], FLAGS.render)).toThrow('requires a value');
  expect(() => parseFlags(['valiant', 'a.json', 'b.json'], FLAGS.apply)).toThrow('Unexpected argument');
  const parsed = parseFlags(['valiant', 'batch.json', '--dry-run'], FLAGS.apply);
  expect([parsed.id, parsed.positionals, parsed.has('--dry-run')]).toEqual(['valiant', ['batch.json'], true]);
});

test('tools mirror the command line exactly', async () => {
  const all = await commands();
  expect(all.edit).toBeUndefined();
  const apply = toolFor('apply', all.apply);
  expect(apply.name).toBe('ship_apply');
  expect(apply.annotations.destructiveHint).toBe(true);
  expect(apply.inputSchema.required).toEqual(['ship']);
  expect(apply.inputSchema.oneOf).toEqual([{ required: ['batch'] }, { required: ['commands'] }]);
  expect(commandLine('apply', all.apply, { ship: 'valiant', batch: {}, dry_run: true }, '/tmp/b.json')).toEqual([
    'apply',
    'valiant',
    '/tmp/b.json',
    '--dry-run',
  ]);
  expect(() => commandLine('apply', all.apply, { ship: 'valiant', batch: {}, dryrun: true }, '/tmp/b.json')).toThrow(
    'Unknown argument dryrun',
  );
  expect(() => commandLine('apply', all.apply, { ship: 'valiant', batch: {}, dry_run: 'yes' }, '/tmp/b.json')).toThrow('boolean');
  expect(commandLine('templates', all.templates, {})).toEqual(['templates']);
  expect(toolFor('inspect', all.inspect).annotations.readOnlyHint).toBe(true);
});

test('apply accepts either inline document form and rejects ambiguous or missing input', () => {
  const line = commandLine('apply', FLAGS.apply, { ship: 'valiant', commands: '/tmp/commands.json', label: 'Refit', dry_run: true });
  const parsed = parseFlags(line.slice(1), FLAGS.apply);
  expect(parsed.positionals).toEqual([]);
  expect(parsed.option('--commands')).toBe('/tmp/commands.json');
  expect(parsed.option('--label')).toBe('Refit');
  expect(parsed.has('--dry-run')).toBe(true);
  expect(() => commandLine('apply', FLAGS.apply, { ship: 'valiant' })).toThrow('batch or commands is required');
  expect(() =>
    commandLine('apply', FLAGS.apply, { ship: 'valiant', batch: {}, commands: '/tmp/commands.json' }, '/tmp/batch.json'),
  ).toThrow('not both');
  expect(() => commandLine('import', FLAGS.import, { ship: 'valiant' })).toThrow('source is required');
});

test('the protocol lists tools and ignores notifications', async () => {
  const listed = (await handle({ id: 1, method: 'tools/list' })) as { result: { tools: { name: string }[] } };
  expect(listed.result.tools.map((tool) => tool.name)).toContain('ship_inspect');
  expect(await handle({ method: 'notifications/initialized' })).toBeUndefined();
  expect(await handle({ id: 2, method: 'nope' })).toMatchObject({ error: { code: -32601 } });
});
