import type { CliCommand } from '../command';
import { COMMAND_OPS, CONSTRUCTION_CONVENTIONS, constructionBatchJsonSchema, suggestion } from '../../../src/ships/constructionCommandSchema';

type Json = Record<string, unknown>;
/** The contract `ship:apply` enforces, derived from `src/ships/constructionCommandSchema.ts`. */
export default {
  summary: '[--op name] — JSON Schema (draft 2020-12) of a command batch plus conventions; --op prints one command with the records it references',
  values: ['--op'],
  ship: false,
  async run({ option }) {
    const schema = constructionBatchJsonSchema() as Json & { $defs: Record<string, Json>; properties: { commands: { items: { oneOf: (Json & { title: string })[] } } } };
    const op = option('--op');
    if (op === undefined) return { conventions: CONSTRUCTION_CONVENTIONS, ops: COMMAND_OPS, schema };
    const command = schema.properties.commands.items.oneOf.find((entry) => entry.title === op);
    if (!command) throw new Error(`Unknown op ${JSON.stringify(op)}${suggestion(op, COMMAND_OPS)}. Known ops: ${COMMAND_OPS.join(', ')}`);
    const $defs: Record<string, Json> = {};
    const collect = (value: unknown): void => {
      for (const [, name] of JSON.stringify(value).matchAll(/"#\/\$defs\/([^"]+)"/g))
        if (!$defs[name]) {
          $defs[name] = schema.$defs[name];
          collect($defs[name]);
        }
    };
    collect(command);
    return { conventions: CONSTRUCTION_CONVENTIONS, schema: { $schema: schema.$schema, ...command, $defs } };
  },
} satisfies CliCommand;
