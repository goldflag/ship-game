import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import type { ConstructionResult, ConstructionSource } from '../../src/ships/blueprint';
import { canonical, definitionData, hash } from './artifacts';

/** Packages a recipe may import besides Three.js. Each one's pinned version joins the hash of the recipes that use it. */
const EXTERNAL = ['fflate'];
/** Entry modules of each recipe; `recipeHash` follows their value imports. The GLB is exactly what export.ts runs (the
 * construction model, posed neutral by ShipJoints). Review images draw the published GLB through ShipRenderView,
 * not ShipView's aiming and muzzle checks. Keep ShipView, the sight and the editor's hull presets out of both. */
export const MODEL_RECIPE = ['tools/construction/export.ts'];
export const PRESENTATION_RECIPE = ['tools/construction/presentation.ts', 'tools/construction/pose.ts', 'src/game/ShipRenderView.ts'];
/** The files a recipe hashes, with the external packages they import. */
export async function recipeInputs(root: string, entries: string[]) {
  const files = new Map<string, string>(),
    externals = new Set<string>();
  const visit = async (path: string): Promise<void> => {
    if (files.has(path)) return;
    const text = await readFile(join(root, path), 'utf8');
    if (path.endsWith('.json')) { files.set(path, canonical(JSON.parse(text))); return; }
    const emitted = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true } }).outputText;
    const tree = ts.createSourceFile(path, emitted, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
    files.set(path, ts.createPrinter({ removeComments: true }).printFile(tree));
    const imports: string[] = [];
    const scan = (node: ts.Node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (!node.arguments[0] || !ts.isStringLiteral(node.arguments[0])) throw new Error('Declare dynamic recipe dependency in ' + path);
        imports.push(node.arguments[0].text);
      }
      ts.forEachChild(node, scan);
    };
    scan(tree);
    for (const specifier of imports) {
      if (!specifier.startsWith('.')) {
        const external = EXTERNAL.find((name) => specifier === name || specifier.startsWith(name + '/'));
        if (external) externals.add(external);
        else if (specifier !== 'three' && !specifier.startsWith('three/')) throw new Error('Declare external recipe dependency: ' + specifier);
        continue; // Three.js and EXTERNAL packages are pinned below; new packages must declare an identity.
      }
      const base = resolve(root, dirname(path), specifier);
      if (!base.startsWith(resolve(root) + '/')) throw new Error('Recipe import escapes repository: ' + path);
      const candidates = /\.(ts|tsx|json)$/.test(base) ? [base] : [base + '.ts', base + '.tsx', join(base, 'index.ts')];
      let found: string | undefined;
      for (const candidate of candidates) { if (await Bun.file(candidate).exists()) { found = candidate; break; } }
      if (!found) throw new Error('Missing recipe dependency: ' + path + ' -> ' + specifier);
      await visit(relative(root, found));
    }
  };
  for (const entry of entries) await visit(entry);
  return { files, externals };
}
/** Follow value imports, including new transitive helpers; types/comments aren't inputs. */
export async function recipeHash(root: string, entries: string[]) {
  const { files, externals } = await recipeInputs(root, entries);
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const sorted = [...files].sort(([a], [b]) => a.localeCompare(b, 'en'));
  // Recipes without other packages keep the hash they had before EXTERNAL existed.
  if (!externals.size) return hash([pkg.dependencies.three, sorted]);
  return hash([pkg.dependencies.three, sorted, [...externals].sort().map((name) => [name, pkg.dependencies[name]])]);
}
export async function constructionFingerprints(root: string, source: ConstructionSource, result: ConstructionResult) {
  if (!result.definition) throw new Error('Missing construction definition');
  const [modelRecipe, presentation] = await Promise.all([
    recipeHash(root, MODEL_RECIPE),
    recipeHash(root, PRESENTATION_RECIPE),
  ]);
  return {
    definition: hash(definitionData(result.definition, source.id)),
    // The compiler runs on every check. Its *outputs*, not the native simulation
    // build hash, describe model inputs. Fitted component revisions stay in source.
    model: hash([source, result.surfaces, result.propellerSupports, result.bilgeKeelSurfaces, modelRecipe]),
    presentation,
  };
}
