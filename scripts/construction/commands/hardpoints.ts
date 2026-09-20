import type { CliCommand } from '../command';

/** The reference's `HP_*` nodes as a placement list: where the source ship carries a mount, which way it faces,
 * and the deck under it. Rows are in ship metres so they can be handed to `ship:place` unchanged. */
export default {
  summary:
    '<reference-name> [--match text] [--group gun-main,…] [--part catalog-id] [--nested] [--deck-from reference] ' +
    '[--limit n] [--table] — reference hardpoints as a placement table (id, x, y, z, bearing) in ship metres; ' +
    '--table prints tab-separated rows for ship:place, otherwise JSON',
  ship: false,
  positionals: 1,
  values: ['--match', '--group', '--part', '--deck-from', '--limit'],
  switches: ['--nested', '--table'],
  async run(ctx) {
    const { readReference, readReferenceMeta } = await import('../reference');
    const { meshView, nearestDeck, probeColumn, referenceHeader, round } = await import('../slice');
    const name = ctx.positionals[0];
    if (!name) throw new Error('Name a cached reference. Run bun run ship:reference --list to see what is cached.');
    const limit = Number(ctx.option('--limit') ?? 400);
    if (!Number.isInteger(limit) || limit < 1 || limit > 4000) throw new Error('--limit must be a whole number from 1 to 4000.');
    const deckFrom = ctx.option('--deck-from');
    // The deck under a hardpoint is probed against the hull of this reference unless another one is named.
    const deckMesh = await readReference(ctx.root, deckFrom ?? name);
    const meta = deckFrom ? await readReferenceMeta(ctx.root, name) : deckMesh.meta;
    const deckView = meshView(deckMesh, deckMesh.meta.groups.hull ? ['hull'] : undefined);
    const match = ctx.option('--match')?.toLowerCase();
    const groups = ctx.option('--group')?.split(',').map((part) => part.trim()).filter(Boolean);
    const partId = ctx.option('--part');
    const { visualGroup } = await import('../reference');
    const chosen = meta.hardpoints.filter((hardpoint) => {
      if (!ctx.has('--nested') && hardpoint.nested) return false;
      if (match && !(hardpoint.id + ' ' + hardpoint.path + ' ' + (hardpoint.visual ?? '')).toLowerCase().includes(match)) return false;
      if (groups && !groups.includes(hardpoint.visual ? visualGroup(hardpoint.visual) : 'other')) return false;
      return true;
    });
    const rows = chosen.slice(0, limit).map((hardpoint) => {
      const [x, y, z] = hardpoint.position;
      const deck = nearestDeck(probeColumn(deckView, x, z), y);
      return {
        id: hardpoint.id, path: hardpoint.path, visual: hardpoint.visual, group: hardpoint.visual ? visualGroup(hardpoint.visual) : 'other',
        nested: hardpoint.nested ?? false, x: round(x, 3), y: round(y, 3), z: round(z, 3), bearingDeg: round(hardpoint.bearingDeg, 2),
        deckY: deck.below ?? null, deckOffsetM: deck.below === undefined ? null : round(y - deck.below, 3),
      };
    });
    if (ctx.has('--table')) {
      // Tab-separated so `ship:place --table` (and a spreadsheet) can read it; the header names the columns.
      const header = ['# part', 'id', 'x', 'y', 'z', 'bearing'].join('\t');
      const lines = rows.map((row) => [partId ?? '', row.id, row.x, row.y, row.z, row.bearingDeg].join('\t'));
      console.log([header, ...lines].join('\n'));
      return undefined;
    }
    return {
      ...referenceHeader(meta), measurement: 'hardpoints', ...(partId ? { part: partId } : {}),
      deckReference: deckFrom ?? name, total: meta.hardpoints.length, matched: chosen.length,
      hardpoints: rows, omitted: Math.max(0, chosen.length - rows.length),
      note: 'Positions are the source mount origins. `deckY` is the nearest up-facing hull surface at or below the mount; pass it to ship:place --y.',
    };
  },
} satisfies CliCommand;
