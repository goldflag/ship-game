import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync('.build/cpu-replay.ts', 'utf8');
for (const [label, root] of [['before', 'C:/Users/Bill/ship-game'], ['after', 'C:/Users/Bill/ship-game-mac-diagnostics']]) {
  let entry = source.replace("import { createHash } from 'node:crypto';", "import { createHash } from 'node:crypto';\nimport { readFileSync, writeFileSync } from 'node:fs';");
  entry = entry.replace(/^const \{ CombatSimulation \}.*$/m, `import { CombatSimulation } from '${root}/src/simulation/combat.ts';`);
  entry = entry.replace(/^const \{ shipPresets, shipPreset \}.*$/m, `import { shipPresets, shipPreset } from '${root}/src/ships/presets.ts';`);
  entry = entry.replace(/new Uint8Array\(await Bun.file\((.*?)\).arrayBuffer\(\)\)/g, 'readFileSync($1)');
  entry = entry.replace('bun: Bun.version', 'node: process.version');
  entry = entry.replace('await Bun.write(destination,', 'writeFileSync(destination,');
  const path = `.build/node-${label}.ts`; writeFileSync(path, entry);
  const result = await Bun.build({ entrypoints: [path], target: 'node', outdir: '.build', naming: 'node-' + label + '.mjs' });
  if (!result.success) throw new Error(JSON.stringify(result.logs));
}
