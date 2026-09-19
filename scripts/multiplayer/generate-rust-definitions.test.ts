import { expect, test } from 'bun:test';
import { DEFINITION_PATH, renderDefinitions } from './generate-rust-definitions';

test('definition.rs is exactly what the generator produces', async () => {
  const committed = await Bun.file(DEFINITION_PATH).text();
  const generated = await renderDefinitions();
  if (committed !== generated) {
    throw new Error(`${DEFINITION_PATH} differs from the generator output. It is generated from src/ships/blueprint.ts: `
      + 'run `bun run multiplayer:definitions` and commit the result. If the file was edited by hand, move that change '
      + 'into scripts/multiplayer/generate-rust-definitions.ts (SERDE_DEFAULT_FIELDS / TYPE_OVERRIDES) first.');
  }
  expect(committed).toBe(generated);
}, 60_000);
