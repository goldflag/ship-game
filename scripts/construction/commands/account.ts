import type { CliCommand } from '../command';

export default {
  summary:
    'list | save <ship-id> --confirm [--name text] [--design account-design-id] [--url base] — the game account ' +
    'named by NAVAL_TEST_EMAIL/NAVAL_TEST_PASSWORD in .env.local; list reads the saved library, save uploads one ' +
    'repository source as a new revision and refuses without --confirm. Credentials and the account address are ' +
    'never printed. A save replaces the revision it read, so a competing save is rejected rather than overwritten.',
  values: ['--name', '--design', '--url'],
  switches: ['--confirm'],
  // No ship ID of its own: the action is the first positional and `save` names the ship in the second.
  ship: false,
  positionals: 2,
  writes: true,
  async run(ctx) {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { emit } = await import('../query');
    const { readCredentials, signIn, listDesigns, saveDesign } = await import('../account');
    const [action, shipId] = ctx.positionals;
    if (action !== 'list' && action !== 'save') throw new Error('Provide an action: `list` (read-only) or `save <ship-id> --confirm`.');
    if (action === 'save' && !shipId) throw new Error('`save` needs the repository ship ID to upload.');
    if (action === 'list' && shipId) throw new Error('`list` takes no ship ID.');
    if (action === 'save' && !ctx.has('--confirm'))
      throw new Error('A save writes to the real account library. Re-run with --confirm once you mean it; `list` needs no confirmation.');
    const base = ctx.option('--url') ?? process.env.ACCOUNTS_URL ?? 'https://ships.tomato.gg';
    const credentials = readCredentials(
      await readFile(join(ctx.root, '.env.local'), 'utf8').catch(() => {
        throw new Error('No .env.local in this worktree. `bun run bootstrap` copies it from the main checkout.');
      }),
    );
    const session = await signIn(base, credentials);
    try {
      const heads = await listDesigns(base, session);
      if (action === 'list')
        return void emit({
          service: new URL(base).origin,
          designs: heads.length,
          library: heads.map((head) => ({
            sourceId: head.sourceId,
            name: head.name,
            revisionId: head.revisionId,
            catalogRevision: head.catalogRevision,
            updatedAt: typeof head.updatedAt === 'number' ? new Date(head.updatedAt).toISOString() : head.updatedAt,
          })),
        });
      const { readSource } = await import('../files');
      const { source } = await readSource(ctx.root, shipId!);
      // The account owns its own design identity; the repository ID is not one of its UUIDs.
      const designId =
        ctx.option('--design') ??
        heads.find((head) => head.name === (ctx.option('--name') ?? source.name))?.sourceId ??
        'design-' + crypto.randomUUID();
      const previous = heads.find((head) => head.sourceId === designId);
      const name = ctx.option('--name') ?? source.name;
      const uploaded = { ...source, id: designId, name, revision: 'revision-' + crypto.randomUUID() } as unknown as Record<string, unknown>;
      const revision = await saveDesign(base, session, {
        designId,
        name,
        source: uploaded,
        catalogRevision: source.construction.catalogRevision,
        schemaVersion: source.schemaVersion,
        expectedRevisionId: previous?.revisionId ?? null,
      });
      emit({
        service: new URL(base).origin,
        saved: true,
        shipId,
        designId,
        name,
        revisionId: revision.id,
        bytes: revision.bytes,
        replaced: previous?.revisionId ?? null,
      });
    } finally {
      await session.close();
    }
  },
} satisfies CliCommand;
