import type { CliCommand } from '../command';
import { SELECTOR_FLAGS } from '../query';

export default {
  summary:
    '--ids a,b | --kind kind | --part catalog-id | --prefix text [--fields position,bearingDeg] [--surfaces] — exact source records by ID from any table, with both revisions to seed a guarded batch; selectors intersect; unknown IDs list the closest matches',
  values: [...SELECTOR_FLAGS, '--fields'],
  switches: ['--surfaces'],
  async run(ctx) {
    const { constructionGet } = await import('../../../src/ships/constructionQuery');
    const { readDesign, emit, selector, list } = await import('../query');
    const { source, catalog, header } = await readDesign(ctx);
    emit({ ...header, ...constructionGet(source, catalog, selector(ctx), { fields: list(ctx.option('--fields')), surfaces: ctx.has('--surfaces') }) });
  },
} satisfies CliCommand;
