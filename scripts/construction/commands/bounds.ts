import type { CliCommand } from '../command';
import { SELECTOR_FLAGS } from '../query';

export default {
  summary:
    '[--ids a,b] [--kind kind] [--part catalog-id] [--prefix text] [--all] — approximate source-level axis-aligned boxes in ship coordinates; no selector lists hull pieces and loads, --all adds every equipment row',
  values: SELECTOR_FLAGS,
  switches: ['--all'],
  async run(ctx) {
    const { constructionBounds } = await import('../../../src/ships/constructionQuery');
    const { readDesign, emit, selector } = await import('../query');
    const { source, catalog, header } = await readDesign(ctx);
    emit({ ...header, ...constructionBounds(source, catalog, selector(ctx), ctx.has('--all')) });
  },
} satisfies CliCommand;
